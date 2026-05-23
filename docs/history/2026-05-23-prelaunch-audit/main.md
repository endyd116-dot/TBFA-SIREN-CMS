# 메인 영역(인증·후원·결제·알림) 전수 검수 리포트
> 2026-05-23 / 메인(총괄) 검수자 — Opus 깊이 검수
> 도메인: 인증/회원 · 후원/결제(KICC·효성·계좌이체) · 알림 발송 엔진(솔라피·Resend) · 발송 cron

## 요약: P0 1건 / P1 3건 / P2 5건

> 핵심: 코드 로직은 전반적으로 견고하다. **운영 즉시 장애는 코드 결함이 아니라 "운영 전 환경변수 게이트"(이메일 redirect·솔라피 알림톡 env)에 집중**된다. 토스→KICC·알리고/프록시→솔라피 두 전환의 잔재는 대부분 라벨·죽은 코드 수준(기능 영향 없음)이나, 카드 만료 사전 안내가 KICC에서 무작동하는 실질 단절 1건이 있다.

---

## 검수한 워크플로우 (시나리오 + PASS/이슈)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 회원가입 5종(일반/유가족/교원/변호사/상담사) + 효성 후원자 전화인증 매칭 활성화 | ✅ PASS (전화인증 SMS 솔라피 정상·운영자 알림·감사로그·가입메일·즉시활성/승인대기 분기) — 단 만료 안내 문구 불일치(P2) |
| 2 | 로그인 (이메일/admin ID 매핑·계정잠금 5회/30분·타이밍공격 방어·remember 쿠키) | ✅ PASS |
| 3 | 비밀번호 재설정 (요청→SHA256 토큰→메일→1회용 검증→전체 무효화) | ✅ PASS (enumeration 방지·rate limit·토큰 해시 저장 모범) |
| 4 | 관리자 모드 승격 (auth/admin-elevate — operator/super_admin 토큰) | ✅ PASS |
| 5 | 일시 카드 후원 (donate-kicc-register→authPageUrl→approve→금액대조→completed→영수증·메일·포인트·배지) | ✅ PASS (pending 선저장 서버금액 신뢰·승인금액 대조·멱등) |
| 6 | 정기 카드 후원 (billing-register→빌키발급→1회차 즉시청구→billing_keys 활성→등급재계산·donor_type 재평가) | ✅ PASS (회원당 활성 빌키 1개 중복차단·1회차 실패 시 비활성 빌키 기록) |
| 7 | 자동 청구 (cron-kicc-billing→약정일+재시도 dedup→성공/실패/3회 자동해지→알림 dispatch) | ✅ PASS (memberId Set dedup으로 이중청구 차단·재시도 1일/3일·멱등 주문번호) |
| 8 | 정기 해지 (billing-cancel→removeBatchKey 빌키삭제→donor 재평가) | ✅ PASS (KICC 빌키 삭제 실패해도 DB 해지 유지) |
| 9 | KICC 결제 노티 웹훅 (멱등·상태 우선순위·후퇴 방지) | ⚠️ 이슈: 서명 검증 없음(P1) |
| 10 | 계좌이체 일시 (donate-bank-intent→pending_bank→운영자 알림→수동 승인) | ✅ PASS |
| 11 | 효성 CMS+ 일시/정기 의향 (donate-hyosung-intent→pending_hyosung→CSV 매칭 completed) | ✅ PASS |
| 12 | 알림 발송 엔진 (dispatch→채널결정(사용자설정/어드민기본/정책 폴백)→어댑터→재시도 백오프→DB 템플릿 폴백) | ✅ PASS (fire-and-forget·강제채널·전화미인증 sms/kakao 제외) |
| 13 | 발송 cron (billing-upcoming·receipt-annual·notification-retry·communication-send-dispatcher) | ✅ PASS (dispatch 연결·KST 보정·멱등) |
| 14 | 카드 만료 사전 안내 (cron-billing-card-expiry) | ⚠️ 이슈: KICC 빌키에서 무작동(P1) + toml 미등록(P1) |
| 15 | SMS/알림톡 솔라피 전환 (aligo-client 위임·placeholder 폴백) | ✅ PASS — 단 파일명 잔재(P2)·미설정 시 silent ok(P2) |

---

## 발견사항

### P0 — 운영 즉시 장애

- **[P0] 이메일 발송이 "테스트 redirect 모드"에 묶여 있으면 모든 사용자 이메일이 실제 수신자에게 안 감** | 위치 `lib/email.ts:6,17,28~45`
  - 증상: `RESEND_TEST_RECIPIENT` 환경변수가 설정돼 있으면 **모든 메일(비밀번호 재설정·후원 영수증·결제 성공/실패 알림·가입 환영·연간 영수증 안내)이 그 단일 테스트 주소로 redirect**되고 제목에 `[TEST → 원수신자]`가 붙는다. 또 `EMAIL_FROM` 미설정 시 기본값이 `onboarding@resend.dev`(Resend 샌드박스 — 계정 소유자에게만 배달 가능).
  - 기대: 운영 시 실제 사용자에게 직접 발송.
  - 근거: CLAUDE.md §1·메모리에 "Resend redirect 모드" 명시 → 현재 redirect 모드가 켜져 있을 개연성 높음. 코드는 env로만 제어되므로 **운영 전 ① Resend 도메인 검증 ② `RESEND_TEST_RECIPIENT` 제거 ③ `EMAIL_FROM`=검증 도메인 설정**을 반드시 확인해야 함. 이메일은 결제 실패/카드 만료의 **강제 채널(FORCED_CHANNELS)**이라 이게 막히면 핵심 결제 알림의 백업 채널도 동시에 무력화됨.
  - 성격: 코드 결함이 아니라 **운영 전 환경변수 게이트**(Swain 확인 항목). 검수 환경에서 실제 Netlify env 값은 확인 불가.

### P1 — 기능 오작동·워크플로우 단절

- **[P1] 카드 만료 사전 안내가 KICC 빌키에서 영구 무작동** | 위치 `billing-approve.ts:186~202`(빌키 INSERT) + `cron-billing-card-expiry.ts:113~206`
  - 증상: 빌키 발급(billing-approve)·자동청구(cron-kicc-billing) 어디서도 `billing_keys.card_expiry_month`를 저장하지 않음. 그런데 만료 알림 cron은 `card_expiry_month`로만 대상을 조회(30일/14일/만료) → KICC 빌키는 항상 NULL → **카드 만료 사전 안내가 단 한 건도 발송되지 않음**.
  - 기대: 카드 만료 30/14일 전·만료 후 회원에게 갱신 안내 → 만료로 인한 정기결제 실패·이탈 예방.
  - 근거: `lib/kicc.ts`의 `ApproveResult`에 카드 만료월 필드 자체가 없음(cardCompany·cardNumberMasked·cardType·billKey만). KICC 빌키발급 응답이 만료월을 주는지 명세 확인 필요 — 준다면 캡처·저장 누락(수정 가능), 안 주면 cron 자체가 KICC에 대해 dead. 어느 쪽이든 기능 미작동.

- **[P1] KICC 웹훅 서명 검증 부재 — 위조 노티로 미결제 후원을 completed로 전이 가능** | 위치 `kicc-webhook.ts:6,50,88~108`
  - 증상: 웹훅에 서명/IP 검증이 없음(코드 주석도 "서명 검증 없음" 인정). 유효한 `pgOrderNo`를 아는 자가 `resCd:"0000"`로 위조 POST하면 pending(미결제) 후원 레코드를 completed로 승격 가능(상태 우선순위 pending<completed라 허용).
  - 기대: 결제 노티 무결성 검증 후 상태 반영.
  - 근거: 영수증·포인트는 웹훅 경로에서 발급 안 하므로 영향이 제한적이고, `pgOrderNo`(SIREN-YYYYMM-10자 랜덤)가 추측 난해해 실위험은 낮음. 그러나 재무 데이터(가짜 completed 후원) 무결성 훼손 가능 → 하드닝 권장(webhook 완료 시 KICC 거래조회 `retrieveTransaction`로 실재·금액 재확인).

- **[P1] 발송 cron 일부가 netlify.toml 미등록 (in-file schedule 단독 의존)** | 위치 `cron-billing-card-expiry.ts:21~23` vs `netlify.toml`
  - 증상: `cron-billing-card-expiry`는 netlify.toml에 등록이 없고 파일 내 `export const config={schedule}`에만 의존. netlify.toml 주석(L180~182)이 "함수 파일 내 schedule이 **일부 환경에서 인식 안 됨**"을 명시하고 핵심 cron은 toml 이중 등록을 함.
  - 기대: 모든 운영 cron이 확실히 스케줄되어야 함.
  - 근거: **B 리포트가 동일 패턴(cron-payroll-monthly·cron-agent-8·cron-task-risk 미등록)을 P1로 보고** → 전사 교차 패턴. 인프라 담당 C가 전체 cron 1:1 대조 필요. (내 도메인 해당분 = card-expiry, 단 P1①로 이미 무작동이므로 이중 이슈)

### P2 — 개선·정합·잔재

- **[P2] `/api/donate`(donate.ts)는 죽은 레거시 엔드포인트 + 토스 라벨 잔재** | 위치 `donate.ts:54,115`
  - 증상: 카드 결제를 `pgProvider:"toss"`로 라벨하고 KICC 연동이 전혀 없음(결제 없이 donations 레코드만 INSERT). 프론트(`donate.js`)는 이 엔드포인트를 호출하지 않음(donate-kicc-register/bank/hyosung만 호출) — 호출처 0.
  - 기대: 미사용 엔드포인트 제거 또는 비활성화.
  - 근거: `public/` 전수 grep 결과 `/api/donate`(정확) 호출 0건. 살아있는 공개 POST라 직접 호출 시 결제 없는 후원 레코드 생성 가능 → 제거 권장.

- **[P2] 휴대폰 인증 만료 안내 문구 불일치 (실제 3분 / 안내 "5분")** | 위치 `auth-phone-verify-check.ts:53`
  - 증상: 만료 에러 메시지가 `"인증번호가 만료되었습니다 (5분)"`인데 실제 코드 만료는 3분(`phone-verify.ts:21` `CODE_EXPIRES_MS=3*60*1000`). 발송 메시지·rate limit 안내는 모두 "3분"으로 정상.
  - 기대: 안내 문구도 "3분".
  - 근거: 인증 유효시간 10분→3분 단축 커밋(`59ce13e`) 후 이 한 줄만 미갱신.

- **[P2] 후원 채널 라벨 "toss" 잔재 — KICC인데 운영자·통계에 "토스"로 표기** | 위치 `lib/donor-status.ts:8,26,41,62,70,150~167` + `admin-donation-dashboard.ts`·`admin-donor-regular-list.ts`·`admin-donor-prospect-list.ts`(DonorChannel = "toss"|"hyosung")
  - 증상: 활성 빌키(현재 KICC)를 채널 `"toss"`로 분류·저장(`donor_channels='["toss"]'`)하고 변수명·KPI 라벨이 전부 `toss_*`. 기능은 동작(빌키=카드 채널 식별)하나 KICC 후원이 통계·목록에서 "토스"로 표시됨.
  - 기대: "card"/"kicc" 등 PG 비종속 라벨.
  - 근거: 토스→KICC 전환 시 채널 명명만 잔존. **C 도메인(어드민 통계)과 교차** — 표시 라벨 정정은 C, 저장값 의미는 공유. 운영자 혼동 외 기능 영향 없음.

- **[P2] 발송 래퍼 파일명·식별자가 레거시("aligo")** | 위치 `lib/aligo-client.ts`·`lib/notify-adapters/sms-aligo.ts`·`lib/notify-adapters/kakao-aligo.ts`
  - 증상: 내용은 솔라피 위임(`solapiSendSms`/`solapiSendMms`/`solapiSendAlimtalk`)인데 파일명·export명·어댑터명이 `aligo`. 어댑터 라우팅 테이블도 `smsAligoAdapter`/`kakaoAligoAdapter`.
  - 기대: 동작 무관하나 향후 유지보수 혼동 소지 → 점진 리네이밍 권장.
  - 근거: `aligo-client.ts` 헤더 주석이 "파일명은 레거시이나 호출부 다수 참조로 유지"라고 명시(의도적 보존).

- **[P2] 카카오 알림톡 미설정 시 silent ok:true (관측성 — 실패가 성공으로 기록)** | 위치 `lib/notify-adapters/kakao-aligo.ts:247~253`
  - 증상: `SOLAPI_TPL_*`/`SOLAPI_KAKAO_PFID` env 미설정 시 placeholder로 `ok:true` 반환 → 발송 로그가 "sent"로 기록되나 실제 미발송·SMS 대체발송도 안 함. 모니터링상 성공처럼 보임.
  - 기대: 미발송이면 로그상 구분(또는 운영 전 env 설정으로 실발송).
  - 근거: HANDOFF §8 — 알림톡 6종은 카카오 검수 승인 후 env 설정 대기 중. 결제 실패·카드 만료는 FORCED inapp+email로 백업되어 기능 영향 제한적이나, **출금 예정 안내·후원 변경 알림은 정책상 inapp+kakao뿐이라 카카오 미설정 시 인앱만 남음**. 운영 전 솔라피 env 7개(pfId+templateId 6) 설정 확인 필요.

---

## 검수 못 한/불확실 영역 (시간·정보 부족)

- **실제 Netlify 환경변수 값 확인 불가**: KICC(MALL_ID·SECRET_KEY·API_DOMAIN·MODE)·SOLAPI(API_KEY·SECRET·SENDER·PFID·TPL 6)·RESEND(API_KEY·TEST_RECIPIENT·EMAIL_FROM) — 코드상 의존성만 명시. **운영 전 Swain 핸즈온 확인 필수**(P0·P2-알림톡과 직결).
- **인증 보조 함수 깊이 미검수**: `auth-withdraw`·`auth-email-verify(-request)`·`auth-me`·`auth-logout`·`auth-password` — 라우팅·import만 확인, 로직 정밀 미검수. (탈퇴 시 status='withdrawn'와 withdrawn_at 동시 세팅 정합 확인 권장 — 로그인은 status, requireActiveUser는 withdrawn_at으로 판정)
- **효성 CMS+ CSV 매칭 파이프라인**: `hyosung-parser/mapper/merge/billings-parser/members-parser` 깊이 미검수 — 일시/정기 의향이 CSV 매칭으로 completed 전환되는 정확도. (재정·import는 C 경계와 겹침)
- **communication-send 발송 큐**: `lib/communication-send.ts`·`cron-communication-send-dispatcher`·`communication-auto-trigger` 큐 픽업·발송 깊이 미검수.
- **grade-calculator·badge-checker·donor-status bulk SQL**: 후원 후크가 부르는 등급/배지/분류 계산 로직 정밀 미검수.

---

## 도메인 경계 교차 메모 (총괄)
- **채널 "toss" 라벨(P2-3)**: 어드민 통계·목록 표시는 **C**, 저장값·후크는 메인 — 정정 시 양쪽 동기.
- **cron netlify.toml 등록(P1-3)**: 전체 cron 1:1 대조는 **C 인프라** 담당. 메인은 card-expiry만 보고.
- **AI 무한호출 P0(B 리포트)**: 발송 엔진과 무관하나 동일 "env 게이트" 성격 — 마스터표에서 함께 우선.
