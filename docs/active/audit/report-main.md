# R41 전수 감사 — Q1 정체성·돈 (메인)

> 감사자: Opus 4.7 / 2026-05-27 / 베이스 788d356(main @ 38ab38e 코드)
> 점검: 결제(KICC register/approve/fail/webhook·billing·cron-billing)·인증(login/signup/admin-login/password-reset)·핵심 가드 4종·등급/후원자상태 lib·수동 후원확정·대시보드 KPI·Q1 cron 9종·전역 가드/404 footgun 스캔
> 커버리지: 핵심 위험 경로 정독 + 가드·config·footgun 전수 grep 완료 [O] / 회원CRUD·게이미·영수증·효성import 상세는 대표 표본 점검(전수 X)

## 요약
- **P0 0건** · **P1 1건** · **P2 4건** · **P3 4건**
- 최우선:
  1. **Q1-001 (P1)** 정기결제 실패 시 매일 재청구·자동해지 영원히 안 됨 (에스컬레이션 붕괴)
  2. **Q1-002 (P2)** 정기 1회차 결제 멱등키 없음 → returnUrl 중복 수신 시 이중청구 가능
  3. **Q1-003 (P2)** KICC 웹훅 서명 미검증 + 완료→취소 다운그레이드 허용 → 위조 노티로 후원 취소·환불 표시
  4. **Q1-004 (P2)** login.html 부재 → 5곳에서 401·로그아웃 시 404 (사용자 로그인 막힘)
  5. **Q1-005 (P2)** 일시 후원 "해지"가 빌링키를 끄지 않아 청구 지속 가능

- **안심(점검 후 정상)**: 로그인 잠금·타이밍 공격 방어, 비밀번호 재설정(SHA-256·30분·rate limit·1회용·enumeration 방지), 결제 해지 본인 소유 검증(IDOR 없음), 일시결제 승인 금액 대조·멱등, signup operatorActive=false 명시, 가드 `auth.res` 오용·`config path` 누락 전역 0건.

---

## 결함 목록

### [Q1-001] 정기 후원 실패 시 매일 무한 재청구 + 3회 자동해지 미작동 〔P1〕
- **영역/단계**: 정기결제 자동청구 cron — 결제 실패 → 재시도 → 자동해지 흐름
- **위치**: `netlify/functions/cron-kicc-billing.ts:338`(handleFailure가 `next_billing_date`를 재시도일로 설정) ↔ `:116-128`(collectScheduledTargets는 `next_billing_date=오늘`을 정기로 포착) ↔ `:69-76`(dedup이 scheduled 우선)
- **증상**: 카드 잔액부족 등으로 정기 후원 결제가 실패하면, 다음 날 "정상 정기결제(1회차)"로 다시 잡혀 매일 재시도된다. 결제 시도 횟수가 항상 1로 고정돼 **1일→3일 간격 에스컬레이션이 작동하지 않고, 3회 연속 실패 시 자동 해지도 영원히 발생하지 않는다.** 죽은 카드를 가진 회원이 매일 실패 알림을 받고 무한 재청구된다.
- **워크플로우 영향**: 의도된 "1차 실패→+1일→2차→+3일→3차→자동해지" 흐름의 2·3차·자동해지 분기가 전부 도달 불가(dead). 운영자가 수동 개입하지 않으면 실패 빌링키가 영구히 살아있음.
- **근거**: handleFailure(비해지) 분기가 `UPDATE members SET next_billing_date = ${nextRetryStr}` 실행 → 다음 cron의 `collectScheduledTargets`(`WHERE m.next_billing_date = 오늘`)가 이 회원을 attemptNumber=1로 포착 → `collectRetryTargets`도 attemptNumber=2로 포착하나 dedup `for (const t of [...scheduled, ...retries])`가 scheduled(1) 우선 → retry(2) 폐기. 결과 `target.attemptNumber`는 항상 1 → `newRetryCount=1`, `shouldCancel(newRetryCount>=3)` 절대 false. 게다가 attempt1의 주문번호 `generateBillingOrderId(memberId, ym, 1)` = `SIREN-BILL-{ym}-{memberId}`(접미사 없음)가 같은 달 내내 동일 → KICC `shopTransactionId` 멱등에 막혀 정상 카드도 재청구 실패 가능.
- **권장 수정**: handleFailure에서 `next_billing_date`를 재시도일로 덮어쓰지 말 것(원래 월 약정일 유지 또는 NULL). 재시도는 `collectRetryTargets`(`billing_logs.next_retry_at`) 경로로만 처리. 또는 collectScheduledTargets에 "해당 회원에 미완료 실패 retry가 없을 것" 조건 추가. dedup 우선순위를 retry 우선으로 바꾸면 attemptNumber 정상 증가. 재시도 주문번호는 attemptNumber 접미사가 이미 분기되므로 그대로.
- **확신도**: 확실 (코드 경로 추적)

### [Q1-002] 정기 후원 1회차 결제에 멱등키 없음 → 이중청구 가능 〔P2〕
- **영역/단계**: 정기 빌키 등록 복귀(returnUrl) → 1회차 즉시결제
- **위치**: `netlify/functions/billing-approve.ts:129` (`const chargeOrderNo = generateShopOrderNo("SIREN-BILL")` — 랜덤)
- **증상**: KICC가 빌키 등록 완료 후 returnUrl(`/api/billing-approve`)로 복귀 POST를 (네트워크 재시도 등으로) 두 번 보내거나 사용자가 페이지를 중복 로드하면, 첫 회차 결제가 **두 번 청구될 수 있다.**
- **워크플로우 영향**: 일시결제 승인(`donate-kicc-approve`)은 `makeTxId(pgOrderNo,"AP")`로 멱등이 보장되지만, 정기 1회차만 매 호출 랜덤 주문번호를 생성 → KICC가 별개 거래로 인식 → 중복 청구.
- **근거**: `chargeWithBillingKey({ shopOrderNo: chargeOrderNo, ... })` → `shopTransactionId = makeTxId(chargeOrderNo,"BT")`. chargeOrderNo가 호출마다 랜덤이라 멱등 무력화. 동시 진입 시 `:99-106` 활성 빌키 1개 검사(TOCTOU)도 두 요청 모두 통과 가능.
- **권장 수정**: 1회차 주문번호를 `pgOrderNo`(pending 주문) 기반 결정값으로(예: `makeTxId(pgOrderNo, "BT1")`) 생성 → 중복 returnUrl이 같은 거래로 멱등 처리되게.
- **확신도**: 확실(멱등 부재) / 발생 빈도는 추정(중복 POST 의존)

### [Q1-003] KICC 웹훅 서명 미검증 + 완료→취소/환불 다운그레이드 허용 〔P2〕
- **영역/단계**: 결제 결과 비동기 노티 수신 → 후원 상태 동기화
- **위치**: `netlify/functions/kicc-webhook.ts:103-121` (downgradeAllowed + 무서명)
- **증상**: 내부 식별자(pgCno·shopOrderNo)를 아는 사람이 위조 "취소/환불" 노티를 보내면, 실제 환불이 없었는데도 완료된 후원이 DB상 **취소·환불 상태로 표시**될 수 있다 (회계·영수증·후원자 통계 오염).
- **워크플로우 영향**: 완료→취소 승격을 막는 금액 일치 게이트(`:93-101`)는 *완료 승격* 경로만 보호하고, *완료→취소/환불 다운그레이드* 경로는 무방비. KICC EP9 노티에 서명이 없어 진위 확인 불가.
- **근거**: `downgradeAllowed = donation.status==="completed" && (newStatus==="cancelled"||"refunded")` → 우선순위 후퇴 차단을 우회. 상단 주석도 "서명 검증 없음" 명시.
- **권장 수정**: (1) KICC 노티 출처 IP 허용목록 또는 (2) 취소/환불 다운그레이드는 우리 측 `cancelPayment` 호출로 만든 기록(또는 KICC 거래조회 `retrieveTransaction`로 실제 상태 재확인)일 때만 반영. 단독 노티만으로 완료건 다운그레이드 금지.
- **확신도**: 확실(무방비 경로) / 악용은 내부 ID 필요 → 가능성 낮음

### [Q1-004] login.html 부재 — 5곳에서 401·로그아웃 시 404 〔P2〕  ※크로스영역
- **영역/단계**: 인증 만료·미인증 시 로그인 화면 유도
- **위치**: 참조 5곳 — `public/js/my-send-history.js:37`, `public/resources.html:276`, `public/js/workspace-attendance.js:1007`, `public/js/workspace-milestones.js:82`, `netlify/functions/auth-signup.ts:478`(가입 환영 메일 "로그인하기" 버튼). 실제 `public/login.html` 파일 없음(표준 로그인은 헤더의 `loginModal`).
- **증상**: 위 페이지에서 401(세션 만료)·미로그인 상태가 되면 `/login.html`로 보내는데 그 페이지가 없어 **404**. 신규(즉시활성) 가입자가 받는 환영 메일의 "로그인하기" 버튼도 404.
- **워크플로우 영향**: 사용자가 로그인 화면 대신 404를 만나 흐름이 끊김. 정상 진입점은 index/헤더의 모달이므로 `/index.html`로 보내거나 모달을 열어야 함.
- **권장 수정**: 5곳의 `/login.html`을 `/index.html`(또는 모달 오픈 트리거)로 교체. 메일 버튼은 `${SITE_URL}/`로. ※영역 분담: 메인=auth-signup, C=my-send-history·resources, B=workspace-attendance·workspace-milestones.
- **확신도**: 확실

### [Q1-005] 일시 후원 "해지"가 빌링키를 끄지 않아 청구 지속 가능 〔P2〕
- **영역/단계**: 마이페이지 후원 해지
- **위치**: `netlify/functions/donations-cancel.ts:100-115` (donation 레코드만 cancelled, 빌링키 미처리)
- **증상**: `/api/donations/cancel`은 후원 *레코드 1건*을 cancelled로 바꾸고 "정기 후원이 해지되었습니다"라고 응답하지만, **빌링키(billing_keys)는 비활성화하지 않아** 다음 달 자동청구가 계속될 수 있다. 실제 해지는 `/api/billing-cancel`이 담당.
- **워크플로우 영향**: 프론트가 어느 API를 부르는지에 따라 회원이 "해지했는데 또 청구됨" 경험 가능. "해지" 의미가 두 엔드포인트에서 불일치.
- **근거**: donations-cancel에 `billingKeys` 비활성화·`safeReevaluate` 호출 없음. billing-cancel만 빌키 해지+KICC removeBatchKey 수행.
- **권장 수정**: 마이페이지 정기해지는 billing-cancel로 일원화하거나, donations-cancel(type=regular)이 연결 빌링키도 함께 비활성화하도록 보강. 프론트 호출부 확인 필요.
- **확신도**: 추정(프론트 호출 경로 확인 시 확정)

### [Q1-006] 마이그레이션 후에도 정기 채널을 "toss"로 라벨링 (stale) 〔P3〕
- **위치**: `lib/donor-status.ts:69-71`(`channels.push("toss")`), 대응 bulk SQL `:160-166`, `lib/grade-calculator.ts:209-231` 주석
- **증상**: 결제는 KICC로 전환됐지만 후원자 채널 데이터(`donor_channels`)에 KICC 빌링키를 여전히 `"toss"`로 저장. 운영자/통계에 "toss" 채널로 노출될 수 있음(기능 영향 없음, 라벨만 부정확).
- **권장 수정**: 채널 라벨을 `"kicc"` 또는 중립적 `"card"`로 통일(과거 데이터 마이그 포함) 또는 표시 매핑.
- **확신도**: 확실(라벨 정확성)

### [Q1-007] 대시보드 prev_donors 서브쿼리가 항상 0 (모순 조건·미사용) 〔P3〕
- **위치**: `netlify/functions/admin-dashboard-kpi.ts:62-74`
- **증상**: `prev_donors` FILTER가 `created_at >= NOW()-Nd AND created_at < NOW()-2Nd`로 상호배타(항상 0)이며, 바깥 WHERE도 최근 N일로 한정돼 절대 매칭 안 됨. 다행히 응답 객체에 포함되지 않아 화면 영향은 없음(죽은·잘못된 코드).
- **권장 수정**: 미사용이면 제거, 직전기간 비교가 필요하면 별도 쿼리로 올바르게 계산.
- **확신도**: 확실

### [Q1-008] 통계 집계가 UTC 기준 (KST 월/주 경계 9시간 오차) 〔P3〕
- **위치**: `netlify/functions/admin-dashboard-kpi.ts`의 `DATE_TRUNC('month'/'week', created_at)` (월별·주별 트렌드 전반)
- **증상**: created_at을 UTC로 잘라 월/주 경계가 KST와 9시간 어긋남. 매월·매주 경계 자정~오전 9시 발생 건이 인접 구간으로 분류될 수 있음(KST 03시 결제 등).
- **권장 수정**: `DATE_TRUNC('month', created_at AT TIME ZONE 'Asia/Seoul')` 등 KST 기준 집계로 통일. (Q1 외 통계 함수에도 동일 패턴 다수 추정 — 다른 영역도 점검 권장.)
- **확신도**: 확실(경계 케이스)

### [Q1-009] 재정성 쓰기(후원 확정 등)에 세분 권한(canAccess) 게이트 없음 〔P3〕
- **위치**: `netlify/functions/admin-donation-confirm.ts:303` (requireAdmin만 — operator 포함 통과)
- **증상**: 미확정 후원을 통과시켜 **실제 후원 기록·신규 회원을 생성**하는 민감 작업이 `requireAdmin`만 거쳐 일반 운영자(role=operator, type=admin)도 수행 가능. 권한 정책상 운영자 허용 의도면 정상이나, 재정 쓰기에 `canAccess(featureKey)` 게이트가 없어 세분 통제 불가.
- **권장 수정**: 후원/재정 쓰기 API에 `canAccess(role, "donation_confirm")` 등 featureKey 게이트 도입 여부를 권한 정책(roles-and-permissions)과 대조해 결정.
- **확신도**: 정책 확인 필요(설계 결정)

---

## 메인 수합 메모 (FIX 단계 참고)
- Q1-004는 B·C 영역 파일도 포함 — A·B·C 보고서 수합 시 같은 `/login.html` 패턴 전역 일괄 교체.
- Q1-008(UTC 집계)은 다른 영역 통계에도 광범위 가능 — C(재정 보고서)·B(근태/급여 집계) 보고서와 교차 확인.
- Q1-001은 라이브 결제에 직접 영향 → FIX 우선순위 최상위. 단 수정 후 정기결제 cron은 라이브 검증 필요(테스트 빌키).
