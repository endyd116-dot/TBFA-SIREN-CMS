# R45 최종 점검 — 어드민(admin) 티어 (A)

> 감사자: Opus 4.8 / 2026-05-29 / 베이스 9040dfb (audit/r45-a)
> 점검: 어드민 도메인 API 약 160개(회원·후원·효성·재정·SIREN·전문가·유족지원·딥릴리프·발송·추모·기관·뉴스) · 관련 public/js·html · db/schema · lib 가드
> 방법: 워크플로우 38개 서브에이전트(14 도메인 10차원 심층 + P0/P1 적대검증 + 갭후보 10 전담 + 권한경계) → 메인이 P0/P1·경계·갭을 **직접 코드 재검증**하며 허위양성·허위안심 정정
> 커버리지: 자기 티어 게이트(`requireRole(...,"admin")` + operator 차단 `canAccess` + `requireAdmin` 어드민 흐름) 매칭 함수 전수 enumerate ✅

---

## 요약

**원시 158건 → 정정·중복통합 후 집계** (감사자 직접검증 반영):

| 구분 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| **[결함]** | 0 | 13 | 약 33 | 약 20 |
| **[갭]** | 0 | 19 | 약 23 | 약 8 |
| **[경계]** | 0 | (AD-001로 흡수) | 약 10 | 약 11 |

> ⚠️ **워크플로우가 P0로 보고한 1건(권한정책 PATCH "위조 가능한 JWT")은 메커니즘 오진**이라 메인이 정정 — 위조가 아니라 **관리자 모드 진입(elevate)이 모든 어드민에게 super_admin JWT를 발급**하는 것이 근본원인. 실제로는 권한 상승이 맞으나 P0가 아닌 **P1**로 재분류(아래 AD-001). 정정 상세는 마지막 §「감사자 정정」 참조.

### 최우선 5건

1. **AD-001 〔결함·P1〕** — `ctx.admin.role`(JWT) 신뢰 게이트 무력화. 관리자 모드 진입 시 `members.type='admin'`인 모든 계정(=어드민·운영자 전원)에 JWT role='super_admin'이 발급되어, **권한정책 매트릭스 수정·기타수입 승인/반려·후원통과 권한** 등 super_admin 전용 통제를 일반 어드민·운영자가 통과. 같은 모듈의 지출 승인은 DB role로 정확히 차단되는데 수입 승인만 뚫림.
2. **AD-003 〔결함·P1〕** — 익명 신고자 신원열람(실명·전화·이메일)이 **운영자(operator)도 버튼 한 번으로 가능**. 운영 매뉴얼은 "슈퍼어드민 전용"이라 안내하나 가드는 `requireAdmin`만 — SIREN 익명성·PII 보호의 핵심 통제 부재.
3. **AD-014 + AD-015 〔결함/갭·P1〕** — SIREN 신고를 **답변 없이 상태만 바꾸면(반려·종결 포함) 신고자에게 메일·벨 통지가 0건**. 게다가 단계 변경 이력·알림을 보장하는 전용 API(`admin-report-status-update`)와 이력 조회·사용자 타임라인이 **어디서도 호출되지 않는 고아**라 진행 이력이 영구히 안 쌓임.
4. **AD-009 + AD-010 + AD-011 〔결함/갭·P1〕** — 효성 자동이체 운영 단절: **대량등록 CSV 추출이 기본 '대기' 필터에서 항상 0건**(상태값 불일치)이라 일괄 등록을 시작조차 못 함 + **출금 실패(미납) 후원자 알림·재시도 없음** + **매칭없음/중복매칭 수동 연결 화면·API 부재**(안내문구는 "수동 매칭하세요"인데 기능이 없음).
5. **AD-018 + AD-019 〔결함/갭·P1〕** — 전문가·변호사를 직접 배정해도 **원본 신청서(유족지원·법률)에 반영 안 됨**(계속 '미배정' 표시·중복 배정 유발) + **배정·세션종료 시 유가족·전문가 어느 쪽에도 알림 0**(채팅방만 조용히 생성) → 매칭이 사실상 사장.

### 점검했으나 정상인 핵심 시나리오 (안심 목록)

- **발송 부분전송 멱등성**: 진행 중 취소·전체 재시작·실패자 재발송 모두 이미 보낸(sent) 수신자를 보존하고 미발송만 처리. 디스패처가 수신자별 `pending→sending` 원자 마킹 + 90초 고아 복구 + 건별 15초 타임아웃 → **동일인 중복발송 방지가 견고**. (개별 1명 재발송 버튼만 결함 = AD-028)
- **카카오 알림톡 내부 검수 상태 관리 완비**(갭 후보 기각): draft→등록→inspecting→approved/rejected 전 단계 + pfId 자동 연동 + 매시 cron 상태 추적 + 통합 CMS 4곳 등록. 환경변수는 DB 미등록 시 폴백일 뿐 단일 출처는 CMS.
- **익명 신고 화면 마스킹 + 신고 IDOR 차단**: 목록·상세 응답에서 익명이면 회원명·이메일·전화 null 처리, 사용자측은 본인 신고만 조회. (신원열람 API 권한만 문제 = AD-003)
- **대다수 super_admin 전용 게이트 정확**: 감사로그·예산안 승인/반려·후원정책·회원등급·순직 인정요건 CRUD·사건 삭제·운영자 관리(마지막 super_admin 보호 포함)·AI 도구권한은 모두 **DB role(`ctx.member`)** 기준으로 정확히 차단. 깨진 건 JWT role을 쓴 소수(AD-001)뿐.
- **후원/효성 통과 중복 방지**: (효성회원번호+청구월) 조합 후원 중복 생성 차단 + 통과 후 donor_type 재평가 자동 연결 + 효성 계약 memberNo UNIQUE UPSERT 멱등.
- **딥릴리프 안정성**: 개별 자료 삭제 시 R2 원본+RAG 청크+blob 동반 정리, 기한 알림 cron(KST 08:00), 검토 결정 동시성 가드(pending 원자전이), 모든 background INTERNAL_TRIGGER_SECRET fail-closed. (사건 통째 삭제 경로만 정리 누락 = AD-020)

---

## P1 결함·갭 (상세)

### [AD-001] `ctx.admin.role`(JWT) 신뢰 인가 무력화 — super_admin 전용 통제가 일반 어드민·운영자에게 노출  〔결함·P1·확실〕
- **역할/시나리오**: 일반 어드민(또는 권한 낮은 운영자)이 관리자 모드로 들어와 "권한 정책 매트릭스 수정"·"기타수입 최종 승인/반려"를 시도하면, 슈퍼어드민 전용이어야 할 이 작업들이 그대로 실행된다.
- **위치**:
  - 근본원인: `netlify/functions/auth-admin-elevate.ts:48-53` — `role: isAdmin ? "super_admin" : "operator"` (`isAdmin = type==='admin'`). 운영자 승급은 role과 무관하게 `type='admin'` 부여(`admin-operators.ts:171`) → **어드민·운영자 전원이 JWT super_admin**.
  - 깨진 게이트: `admin-role-permissions.ts:27-28`(권한표 PATCH), `admin-revenue-approve.ts:17`(수입 승인/반려), `admin-expense-category-update.ts:17`(지출 카테고리 수정), `admin-donation-confirm.ts:306·310`(`canAccess(admin.role,…)`=항상 super_admin→게이트 무력), `admin-expense-update.ts:55`/`admin-revenue-update.ts:54`(owner-or-super 분기).
- **증상**: 슈퍼어드민만 손대야 할 "누가 어떤 기능을 쓰는가" 정책과 재정 수입 결재를 일반 어드민·운영자가 바꿀 수 있다. 후원 통과 권한 토글도 항상 통과되어 슈퍼어드민이 제한할 수 없다.
- **근거**: 코드베이스 자체가 규칙을 명시함 — `admin-operators.ts:55` 주석 *"DB role(ctx.member.role)로 판정 — admin JWT role은 type=admin이면 전부 super_admin이라 신뢰 불가."* 올바른 형제는 `admin-expense-approve.ts:17 requireRole(auth.ctx.member,"super_admin")`(DB값). 깨진 함수들만 `auth.ctx.admin.role`(JWT)을 신뢰.
- **권장 수정**: `ctx.admin.role` 기반 인가를 전부 `ctx.member.role`(DB)로 교체 — `requireRole(auth.ctx.member, "super_admin")`/`canAccess(auth.ctx.member.role, key)` 패턴 통일. (근본 교정으로 `auth-admin-elevate`가 DB role을 그대로 JWT에 실어주는 방안도 검토하되, 그래도 인가는 DB값으로 하는 것이 안전.) **Swain 판단: 운영상 실제로 `role='admin'` 어드민·운영자를 둘 계획이면 P0 취급 권장.**
- **확신도**: 확실 (elevate·operators·각 게이트 직접 정독으로 메커니즘 확정)

### [AD-002] 권한 정책 행(role_permissions) 시드·생성 경로 전무 → canAccess 게이트가 사실상 admin 고정, 운영자 위임·슈퍼어드민 토글 불가  〔갭·P1·확실〕  [S 도메인 교차]
- **역할/시나리오**: 슈퍼어드민이 권한 정책 화면에서 "운영자에게 후원 통과/발간 export 권한을 켜준다"를 하려 해도 켤 행이 없고, 일반 어드민에게서 민감기능을 빼지도 못한다.
- **위치**: `lib/role-permission-check.ts:33` `if (!perm) return role === "admin"`(미등록=admin 허용·operator 차단). `admin-role-permissions.ts`는 GET/PATCH만(INSERT 없음). `role_permissions` INSERT는 코드·마이그 어디에도 없음(docs SQL 1건은 미실행).
- **증상**: `finance_refund`·`martyrdom_publication`·`martyrdom_pub_export`·`ai_config_prompt`·`seo_edit`·`donation_confirm` 등 canAccess 게이트가 전부 "일반 admin 허용·operator 차단" 기본값에 고정. 운영자에게 권한을 위임할 수 없고(예: 발간 export 운영자 안내문구는 '가능'인데 항상 403=AD-035), 매트릭스 UI는 토글할 행이 없어 빈 화면.
- **근거**: 위 grep 결과 + `admin-martyrdom-export.ts:44`/`admin-martyrdom-package.ts:44`가 operator 안내와 달리 403, donation_confirm 주석(:308-309)의 "operator 허용·super 제한 가능"이 실제로 불가능.
- **권장 수정**: 49개 featureKey 시드 마이그 + 라벨/카테고리/기본 admin·operator 허용값 INSERT(멱등). 매트릭스 UI를 '미등록 키 자동 노출/생성'으로 보강. **메인(R45-S) 권한 정합 수합과 함께 처리 권장.**
- **확신도**: 확실 (DB 실데이터는 직접 못 봤으나 시드 코드 부재는 확정 — 수동 INSERT 안 했다면 빈 테이블)

### [AD-003] 익명 신고자 신원열람(reveal)이 운영자·일반 어드민도 가능 — 가장 민감한 PII에 역할 가드 부재  〔결함·P1·확실〕
- **역할/시나리오**: 권한 낮은 운영자가 익명 신고 상세에서 '신원 식별' 버튼 + 사유 입력만으로 제보자 실명·전화·이메일을 즉시 본다.
- **위치**: `netlify/functions/admin-anonymous-reveal.ts:35-37`(가드=requireAdmin만), :108-141(PII 반환). 감사로그 조회도 동일(`admin-anonymous-reveal-logs.ts:25-26`).
- **증상**: SIREN 신뢰의 핵심인 익명성이 권한 통제 없이 풀린다. 매뉴얼(`manual-admin.html:568,573`)은 "슈퍼어드민 권한 필수"라 안내하나 코드와 불일치.
- **근거**: `requireAdmin`은 어드민 로그인 전체(operator 포함) 통과. reveal 함수에 `requireRole`/`canAccess` grep 0건. (열람 행위 감사로그 기록은 정상이나 사전 차단이 없음.)
- **권장 수정**: reveal·reveal-logs에 `requireRole(ctx.member,"super_admin")` 또는 전용 canAccess 키 적용. 부수: 신원열람 화면이 통합 CMS 미등록(레거시 admin.html 전용)이라 함께 이관 = AD-038.
- **확신도**: 확실 (그룹 적대검증 + 갭 전담 양쪽 확인)

### [AD-004] 통합 어드민(cms-tbfa)에 회원 블랙리스트 차단/해제 기능 자체가 없음  〔갭·P1·확실〕
- **역할/시나리오**: 운영자가 통합 어드민에서 문제 회원을 차단하려 하나 회원 상세 모달에 차단 버튼이 없어, 옛 admin.html로 따로 들어가야만 차단 가능.
- **위치**: `public/cms-tbfa.html:2362-2366`(모달 탭 info/donations/hyosung 3개뿐), `public/js/cms-tbfa.js:728-809`(상세 모달에 차단 액션 없음). `admin-members-blacklist` 호출은 `admin.js`에만.
- **증상**: 통합 어드민 회원 상세에 차단 버튼·블랙리스트 목록 화면 부재.
- **근거**: `cms-tbfa.js`에서 `admin-members-blacklist` grep 0건. 백엔드 API는 정상 실재(가드·감사로그 완비).
- **권장 수정**: cms-tbfa 회원 상세 모달에 '블랙 처리/해제' 액션 + 블랙리스트 목록 섹션 추가, `admin-members-blacklist` POST/DELETE 연결(CLAUDE.md §6.18).
- **확신도**: 확실

### [AD-005] 통합 어드민에 교원 자격변경 심사(승인/반려)·강제변경 화면 없음 — 레거시 admin.html 전용  〔갭·P1·확실〕
- **역할/시나리오**: 회원이 자격 변경을 신청해도 운영자가 통합 어드민에서 대기 건을 볼 수 없고 승인/반려 버튼도 없다.
- **위치**: `public/js/admin-eligibility.js:81-93`(컨테이너 `#adm-eligibility`=admin.html:4757 전용). `cms-tbfa.html`·`cms-tbfa.js`에 eligibility/자격 grep 0건.
- **증상**: 통합 어드민에서 자격 심사 진입 불가.
- **근거**: 위 grep + admin-eligibility-list/review/force-change 호출이 cms-tbfa에 없음.
- **권장 수정**: 통합 CMS에 '교원 자격 심사' iframe 4곳 등록 + 대기 뱃지 노출, 강제변경을 회원 상세 모달에 통합.
- **확신도**: 확실

### [AD-006] 자격 강제변경: 어드민 UI 값(active_teacher 등)을 서버가 거부 — 교원/일반 4종 항상 실패  〔결함·P1·확실〕
- **역할/시나리오**: 운영자가 회원 자격을 '현직/은퇴/예비/일반'으로 직접 바꾸면 무조건 "유효하지 않은 자격 유형" 오류. 변호사/상담사만 변경됨.
- **위치**: `public/js/admin.js:3954-3957`(option value=active_teacher/retired_teacher/pre_teacher/general) ↔ `admin-eligibility-force-change.ts:17` `VALID_TYPES=['현직','은퇴','예비','일반','lawyer','counselor']`.
- **증상**: 영문 4종이 서버 한글 enum과 불일치해 거부.
- **근거**: 사용자 신청(`eligibility-request.ts` ALLOWED_TYPES)·마이페이지(`mypage-eligibility.js`)는 이미 한글 → 한글로 통일이 정합적.
- **권장 수정**: admin.js option value를 서버 VALID_TYPES(한글)와 통일.
- **확신도**: 확실 (그룹 적대검증 통과)

### [AD-007] 잘못 통과(confirm)한 입금 건을 되돌리는 경로 전무 — 막다른 워크플로우  〔갭·P1·확실〕
- **역할/시나리오**: 입금을 잘못 통과시켜 후원/회원이 생성된 뒤 실수를 깨달아도, 통과 화면에서 미확정 복귀·취소가 불가능하다.
- **위치**: `admin-donation-confirm.ts:325`(action=confirm/ignore/rematch만), :395-396(confirmed 재처리 거부), `public/js/cms-tbfa-import.js:345-351`(confirmed 행은 '후원 보기'만). 후원 취소/환불해도 원본 미확정행은 'confirmed' 잔존 + confirmed_donation_id가 취소 후원을 계속 가리킴(정합 깨짐).
- **증상**: 통과 실수 복구 불가, 통계·재대조 시 불일치.
- **권장 수정**: confirmed→미확정 되돌리기 액션(연결된 donations 처리 포함) 추가. 후원 취소·환불 시 pending_donations 상태 동기.
- **확신도**: 확실

### [AD-008] 입금내역 파일 재import 멱등성 없음 — 중복 적재·이중 후원  〔갭·P1·확실〕
- **역할/시나리오**: 같은 입금 파일을 두 번 업로드하면 동일 행이 미확정 목록에 두 벌 쌓이고, 둘 다 통과시키면 같은 후원이 2건 생성된다.
- **위치**: `admin-donation-import.ts:106-123·182-199·345-373`(무조건 INSERT, 중복 경고/스킵 없음). 추가로 IBK/레거시 통과에 더블클릭 중복 가드 부재(`admin-donation-confirm.ts:249-295·393-429`).
- **증상**: 후원 합계·대시보드 금액 부풀려짐.
- **근거**: 효성 수납·계약 경로엔 멱등이 있으나 IBK/레거시 import·confirm엔 없음.
- **권장 수정**: import 시 (source+파일+행해시) 또는 거래 키로 중복 스킵, IBK 통과에 동일입금 존재 검사·행 단위 트랜잭션.
- **확신도**: 확실

### [AD-009] 효성 대량등록 CSV 추출이 기본 '대기' 필터에서 항상 0건 — 일괄 등록 시작 불가  〔결함·P1·확실〕
- **역할/시나리오**: 신규 신청(대기) 건을 효성에 일괄 등록하려 추출하면 CSV에 한 건도 안 담겨, 등록 자체를 시작 못 한다(목록엔 대기 건이 보여 더 혼란).
- **위치**: `admin-hyosung-export.ts:233,252-257` ↔ `public/js/admin.js:2133-2134`·`admin.html:4303-4304` (상태값 불일치). 실제 저장 상태는 `donate-hyosung-intent.ts:66` 참조.
- **증상**: 대기 필터 추출 = 0건.
- **권장 수정**: export의 대기 상태 필터값을 실제 저장 상태값과 일치시킴.
- **확신도**: 확실

### [AD-010] 효성 출금(수납) 실패·미납 후원자 알림·재시도·후속처리 워크플로우 부재  〔갭·P1·확실〕
- **역할/시나리오**: 출금 실패(미납)가 나도 후원자에게 안내가 안 가고, 운영자가 재출금·연락·미납 추적할 동선이 없어 미납이 방치된다.
- **위치**: `admin-hyosung-import-billings.ts:238-243`(완납 아니면 skip), `cms-tbfa.js:1461-1479`(미납 배지만·액션 없음). 알림·재청구 코드 grep 0건.
- **권장 수정**: 미납 목록 화면 + 후원자 알림(메일/알림톡) + 재출금/연락 처리 동선.
- **확신도**: 확실

### [AD-011] 효성 계약 '매칭없음/중복매칭' 수동 연결 화면·API 부재 — 안내문구와 불일치·막다른 화면  〔갭·P1·확실〕
- **역할/시나리오**: 화면은 "수동 매칭하세요"라 안내하는데 실제 수동 매칭 버튼·화면·API가 없어 미매칭 계약이 영구 방치된다.
- **위치**: `cms-tbfa.js:1339-1341·1736·2444-2445`(안내문구만), `admin-hyosung-import-contracts.ts:30-124`(자동 매칭만).
- **권장 수정**: 미매칭/중복매칭 계약을 회원에 수동 연결하는 화면 + API.
- **확신도**: 확실

### [AD-012] 반려된 지출·수입 항목 수정·재제출 경로 전무 — 막다른 상태(전표·예산안은 재상신 됨)  〔갭·P1·확실〕
- **역할/시나리오**: 반려당한 지출·수입을 고쳐 다시 결재 올릴 방법이 없어, 운영자가 매번 새 건을 등록하고 반려 건은 목록에 쌓인다.
- **위치**: `admin-expense-update.ts:50-52`·`admin-revenue-update.ts:49-51`(rejected 수정 분기 없음), `public/js/admin-expenses.js:696,700`·`admin-other-revenues.js`(재제출 버튼 없음). 같은 시스템의 전표·예산안은 재상신 지원.
- **권장 수정**: rejected→draft 재제출 전이 + 수정 허용 + 사유 표시(수입 상세에 rejectionReason 행 추가=AD-024 계열).
- **확신도**: 확실

### [AD-013] 운영성과표 PDF가 후원 수입 귀속일을 화면 손익과 다르게 집계 — 같은 보고서 화면값·PDF값 불일치  〔결함·P1·확실〕
- **역할/시나리오**: 공식 PDF 보고서의 후원 수입 금액·기간이 화면 손익 요약과 어긋나 대외 보고 신뢰도 훼손.
- **위치**: `admin-finance-report-pdf.ts:55·66` `COALESCE(hyosungPaidDate, createdAt)`(paidAt 누락) vs `admin-finance-pl-summary.ts:42·49` `COALESCE(paidAt, hyosungPaidDate, createdAt)`.
- **증상**: 토스 일시·CMS 빌링 후원(paidAt만 있음)이 PDF에서만 등록일 기준으로 잘못 분류돼 기간 합계 틀어짐.
- **권장 수정**: PDF 집계도 `COALESCE(paidAt, hyosungPaidDate, createdAt)`로 통일.
- **확신도**: 확실

### [AD-014] SIREN 신고 상태만 변경(반려/종결 포함) 시 신고자에게 메일·벨 통지 0건  〔결함·P1·확실〕
- **역할/시나리오**: 운영자가 답변 본문 없이 상태만 바꾸면(흔한 시나리오), 신고자는 처리 사실을 전혀 모르고 계속 기다린다. 반려는 사유 전달이 핵심인데 통보 수단·사유 필드도 없음.
- **위치**: `admin-incident-report-detail.ts:132·148`(메일/벨이 adminResponse 있을 때만), `admin-harassment-report-detail.ts:120·135`, `admin-legal-consultation-detail.ts:129·145` 동일. 유족지원 '빠른 단계 변경'도 동일(`admin-support.ts:165-189`).
- **증상**: 답변 미작성 상태변경 = 무음.
- **근거**: 알림 발송이 `sendNotifyFlag && adminResponse && member…` 조건에 묶임.
- **권장 수정**: 상태 전이 자체에 사용자 알림(인앱+이메일/알림톡, 동의 기반) 발송. 반려 사유 필드 추가(아래 AD-017 계열·incident/harassment/legal에 rejected_reason).
- **확신도**: 확실

### [AD-015] 신고 단계변경 이력·알림 전용 API와 사용자 타임라인이 고아 — 진행 이력 영구 미기록  〔갭·P1·확실〕
- **역할/시나리오**: 어드민이 단계를 바꿔도 "언제 누가 어떤 단계로 바꿨는지"가 저장되지 않아, 신고자 마이페이지 타임라인의 단계별 일시가 영구 공란.
- **위치**: `admin-report-status-update.ts`(reportStatusLogs INSERT·알림·감사로그 완비하나 **호출처 0**), `admin-report-status-logs.ts`(조회·호출처 0), `user-my-report-detail.ts:79-96`(타임라인 조회·호출처 0). 실제 상세 화면은 `*-report-detail.ts`가 이력 없이 직접 처리.
- **증상**: 단계 이력 화면 항상 빈 결과, 타임라인 일시 공란.
- **근거**: `admin-report-status-update`는 화이트리스트·from===to 가드·notifiedAt 갱신까지 완성돼 있는데 어느 화면도 안 부름.
- **권장 수정**: 신고 상세의 상태변경을 `admin-report-status-update` 경유로 통일(AD-014 무통보도 함께 해소) + 사용자 타임라인이 `user-my-report-detail`를 호출하도록 연결.
- **확신도**: 확실

### [AD-016] SIREN 신고 담당 운영자 변경 드롭다운이 항상 비어 배정 불가  〔결함·P1·확실〕
- **역할/시나리오**: 신고 상세의 담당자 변경 박스에서 운영자 목록이 비어, 다른 운영자로 인계가 안 된다.
- **위치**: `public/js/admin-service-assignee.js:124-134`(getMembers) ↔ `admin-workspace-member-list.ts:45`(`ok({ data: rows })`) — 응답 언랩 키 불일치. 추가로 현재 담당자 표시도 항상 '미할당'(`admin-service-assignee.js:151-153` ↔ `admin-siren.js` 렌더러가 `data-current-assignee-uid` 미출력).
- **권장 수정**: getMembers 응답 키 정합(res.data.data ?? res.data) + 상세 렌더러에 현재 담당자 속성 출력 + 저장 후 갱신 함수(reloadSirenDetail) 정의.
- **확신도**: 확실

### [AD-017] 법률상담 자동배정 알림이 존재하지 않는 페이지로 연결 — 클릭 시 404  〔결함·P1·확실〕
- **역할/시나리오**: 변호사 배정 알림을 눌러도 없는 주소라 화면이 안 떠 신청자가 배정 내용을 못 본다.
- **위치**: `legal-consultation-create.ts:191` `link: "/mypage-siren.html#legal-${id}"` (해당 페이지 미존재).
- **권장 수정**: 실제 경로(`/mypage.html#support` 또는 신고 추적 화면)로 수정.
- **확신도**: 확실

### [AD-018] 전문가/변호사 직접 배정이 원본 신청서에 미반영 — '미배정' 유지 + 중복 배정 유발  〔결함·P1·확실〕
- **역할/시나리오**: 유족지원/법률에서 전문가·변호사를 배정·채팅방까지 만들어도 신청 화면엔 계속 '미배정/—'으로 남아, 운영자가 실패한 줄 알고 같은 건을 또 배정하려 한다.
- **위치**: `admin-expert-direct-assign.ts:159-205`(expert_matches·chat_rooms만 INSERT, support_requests/legalConsultations 미갱신). 표시 판정 `public/js/admin.js:3184-3190`·`admin-siren.js:312-323`.
- **증상**: 배정 완료 표식 안 뜸, 중복 배정 시도(서버 중복가드가 막아주나 운영자 혼란).
- **권장 수정**: 직접배정 트랜잭션에 원본 신청(`support_requests.assignedMemberId/assignedExpertName/status`, `legalConsultations.assignedLawyerId`) 갱신 포함.
- **확신도**: 확실

### [AD-019] 전문가 배정·세션종료 시 유가족·전문가 어느 쪽에도 알림 0  〔갭·P1·확실〕
- **역할/시나리오**: 배정·채팅방 개설·상담 종료가 모두 조용히 처리돼, 유가족은 새 채팅방이 열린 줄도 모르고 전문가는 자기 배정 건을 모른다.
- **위치**: `admin-expert-assign.ts:190-205`·`admin-expert-direct-assign.ts:207-214`(트랜잭션 후 곧장 Response). notify/sendEmail/sendKakao/systemMessage grep 0건.
- **권장 수정**: 배정 완료·종료 시 양 당사자에 인앱+이메일/알림톡 + 채팅방 시작 안내.
- **확신도**: 확실

### [AD-020] 순직 사건 통째 삭제 시 RAG 청크·R2 원본(민감 PII)·외부자료 역참조 고아 잔존  〔갭·P1·확실〕
- **역할/시나리오**: 사건을 삭제해도 그 사건의 인물·학교·정황이 RAG 코퍼스에 남아 다른 사건의 AI 분석·서면·검색에 계속 인용되고, R2의 진료기록·진술서 원본이 영구 잔존한다.
- **위치**: `admin-martyrdom-cases.ts:265-283`(DELETE — 자식 정리 없음). 대조: 개별 자료 삭제(`admin-martyrdom-doc-delete.ts`)는 R2+RAG청크+blob 정리. `ai_rag_documents.caseId`(schema:4176) FK·cascade 없음. 승급 사건 삭제 시 외부자료 `promoted_case_id` 역참조도 고아(`lib/martyrdom-external.ts:371-408`).
- **권장 수정**: 사건 DELETE에 doc-delete와 동일한 R2+RAG청크+blob+자식행 정리(트랜잭션), 외부자료 역참조 해제/되돌림. (삭제 권한은 super_admin = 경계, 정상)
- **확신도**: 확실

### [AD-021] 검토 승인/수정요청을 배정받지 않은 운영자도 API로 결정 가능 — 서버 배정자 검증 누락  〔결함·P1·확실〕
- **역할/시나리오**: 검토 책임자가 아닌 사람이 초안을 '검토 승인'으로 확정해 산출물이 발간 단계로 넘어가고, 누가 실제 검토했는지 책임 추적이 흐트러진다.
- **위치**: `admin-martyrdom-review.ts:85-132`(PATCH가 reviewId만으로 처리, `assigned_to===admin.uid` 검증 없음). UI만 막아둠(`admin-martyrdom.js:1563-1564`).
- **권장 수정**: PATCH에 배정 검토자 본인(또는 super_admin) 검증 추가.
- **확신도**: 확실

### [AD-022] 딥릴리프 발간물(외부 공개) 검수자 배정·검수의견 단계 부재 — 자기검수·자기발간 가능  〔갭·P1·확실〕
- **역할/시나리오**: 발간물 '검수'가 별도 검수자 배정·의견 수렴이 아니라, 만든 본인(또는 같은 권한자 누구나)이 '검수 완료'→'발간 확정'을 혼자 처리 → 외부 공개 전 제3자 검수 게이트가 실질 부재.
- **위치**: `admin-martyrdom-publication.ts:183-225`(reviewed/published 모두 동일 canAccess만, reviewed_by/published_by=본인 uid, created_by와 비교 없음). (개별 사건 초안 검수=`martyrdom_reviews`는 배정·의견 완비 — 발간물 경로만 누락.)
- **권장 수정**: 발간물에 검수자 배정·의견 수집 단계 도입 + 생성자≠검수자≠발간자 분리 검증.
- **확신도**: 확실

### [AD-023] 발간물·서면 초안 내보내기(PDF/HTML/Word)가 검수·발간 상태와 무관하게 가능 — 검수 게이트 우회  〔결함·P1·확실〕
- **역할/시나리오**: 외부 공개 전 사람 검수 게이트가 '발간' 버튼엔 걸려 있으나, 파일이 실제로 빠져나가는 '내보내기'엔 상태 검사가 없어 미검수 draft를 그대로 PDF로 받아 외부 배포 가능.
- **위치**: `admin-martyrdom-publication-export.ts:188-238`(status 미검사), `admin-martyrdom-export.ts`(서면 초안 review 상태 무관) ↔ UI는 draft에서도 버튼 활성(`admin-martyrdom.js:3266-3300·1497-1502`).
- **권장 수정**: 내보내기 함수에 status(published/reviewed) 게이트 + 비식별화 확인.
- **확신도**: 확실

### [AD-024] 발간물 생성 시 출처 사건(caseIds) 선택 화면 없음 — '익명 사례 연구'가 사례 내용 없이 생성  〔갭·P1·확실〕
- **역할/시나리오**: '익명 사례 연구'를 만들어도 실제 사건의 인정 논리가 안 들어가고 전체 통계만 든 일반 문서가 나와, '사례 연구' 유형의 목적을 못 이룬다.
- **위치**: `public/js/admin-martyrdom.js:1943-1972`(발간 폼에 사건 선택 입력 없음), :618-625(body에 caseIds 미포함).
- **권장 수정**: 발간 폼에 출처 사건 다중선택 + 생성 body에 caseIds 전달.
- **확신도**: 확실

### [AD-025] 서면 '목차 다시 제안' 한 번에 작성·편집한 본문이 경고 없이 삭제  〔결함·P1·확실〕
- **역할/시나리오**: 목차를 다시 제안받으면 AI가 섹션 키를 다르게 내놓을 때 공들여 쓴 섹션 본문이 통째로 사라진다(확인창·복구 없음).
- **위치**: `public/js/admin-martyrdom.js:1679-1690`(genDraftOutline — confirm 없이 즉시 POST), 서버 `admin-martyrdom-draft-outline.ts`가 섹션 재구성.
- **권장 수정**: 기존 본문 존재 시 확인창 + 본문 보존(섹션 키 매핑) 또는 백업.
- **확신도**: 확실

### [AD-026] 외부 자동수집 설정(화이트리스트·기본 검색어) 편집 UI 부재 → 격주 크론 영구 'no-queries'  〔갭·P1·확실〕
- **역할/시나리오**: 2주 자동 외부수집이 검색어가 없어 한 번도 실제 검색을 못 한다. 신뢰 도메인·검색어를 코드 없이 등록할 화면이 없음(백엔드는 완비).
- **위치**: `cron-martyrdom-external.ts:58-61`(queries 비면 종료), `public/js/admin-martyrdom.js:3609-3613`(설정 헬퍼 정의되나 호출처 0). 백엔드 `admin-martyrdom-external-settings.ts`는 완전 동작.
- **권장 수정**: 외부수집 설정 편집 UI(도메인·검색어)를 외부 자료 탭에 추가해 settings API 연결.
- **확신도**: 확실

### [AD-027] AI 수집 승급 사건이 사건 목록에서 일반 사건과 구분 안 됨  〔갭·P1·확실〕
- **역할/시나리오**: 승급 사건이 목록에서 '🤖 AI 수집' 배지 없이 일반 사건처럼 보이고, 'AI 분석 Y' 합산이 항상 0.
- **위치**: `public/js/admin-martyrdom.js:683·696·807`(`c.promotedFromExternalId` 의존) ↔ `admin-martyrdom-cases.ts:91-128`(목록 SELECT/map에 해당 필드 없음).
- **권장 수정**: 목록 응답에 `promotedFromExternalId`(또는 case_kind='reference'+출처) 포함.
- **확신도**: 확실

### [AD-028] 개별 수신자 '재발송' 버튼이 작업번호를 수신자번호로 전달 — 엉뚱 재발송/404  〔결함·P1·확실〕
- **역할/시나리오**: 실패한 한 명만 재발송하려 눌러도 대부분 '수신자를 찾을 수 없습니다(404)'거나, 우연히 같은 ID 수신자가 있으면 엉뚱한 사람이 재발송된다(의도한 사람은 개별 버튼으로 영원히 안 됨).
- **위치**: `public/js/admin-send-job-detail.js:385`(doRetryOne) ↔ `admin-send-job-retry.ts:28-43`(서버는 recipientId 기대). (일괄 '실패자 재발송'·'재시작'은 정상.)
- **권장 수정**: doRetryOne이 수신자 ID를 전달하도록 수정.
- **확신도**: 확실

### [AD-029] 대량 발송 생성·취소·재시작·재발송에 admin 전용 권한 게이트 없음 — operator도 전 회원 대량 발송·취소 가능  〔갭·P1·확실〕
- **역할/시나리오**: 비용·평판이 걸린 비가역 작업(전 회원 대량 발송, 진행 중 취소, 재시작)을 일반 어드민과 운영자 구분 없이 어드민 로그인만으로 누구나 실행.
- **위치**: `admin-send-job-create.ts:36`·`-cancel.ts:36`·`-restart.ts:33`·`-retry.ts:16`·`-retry-failed.ts`(모두 requireAdmin만). 대조: 카카오 템플릿은 requireRole admin 적용.
- **권장 수정**: 발송 생성·취소·재시작·재발송에 `requireRole(ctx.member,"admin")` 또는 canAccess 키 적용(정책 결정 Swain).
- **확신도**: 확실

### [AD-030] 추모 선생님 삭제 시 헌화·방명록·편지가 고아로 잔존 — '함께 정리됩니다' 거짓 안내  〔갭·P1·확실〕
- **역할/시나리오**: 선생님을 삭제해도 그분께 남긴 헌화·메시지·편지가 DB에 남고(안내는 '함께 정리'), 모더레이션 목록에 계속 노출되며 동명 선생님 재등록 시 섞일 수 있다.
- **위치**: `admin-memorial-teachers.ts:139-146`(DELETE), `db/schema.ts:4116-4156`(memorialOfferings/Messages/Letters teacher_id FK 없음), `public/js/admin-memorial.js`(삭제 확인문구).
- **권장 수정**: 선생님 DELETE 시 자식(헌화/방명록/편지/좋아요) 동반 삭제 또는 soft-delete + 안내문구 정정.
- **확신도**: 확실

### [AD-031] 여론·뉴스 자동수집 시각(cron_hour_kst)이 죽은 설정 + 입력란 부재(크론 하드코딩)  〔갭·P1·확실〕
- **역할/시나리오**: 자동수집 시각을 바꿔도 항상 KST 09:00에만 돌고, 설정 화면엔 시각 입력란조차 없다.
- **위치**: `cron-org-news.ts:19-21`(schedule 하드코딩), `admin-org-news-settings.ts:25·55·98·112·118`(cron_hour_kst 저장·반환), `public/` 전체에 입력란 없음. 추가로 설정 저장 시 perCombo·cronHourKst 미전송으로 매번 기본값 초기화(`admin-org-news.js:474`).
- **권장 수정**: 시각을 코드 schedule로 못 바꾸므로 설정 항목 자체를 제거하거나(혼란 방지), 다회 schedule + 게이트 방식으로 구현. 설정 저장 시 전체 필드 전송.
- **확신도**: 확실

---

## P2 결함·갭 (요약)

> 형식: ID 〔구분·확신도〕 제목 — 위치 / 한 줄 증상 · 권장.

**권한·경계**
- [AD-032] 〔경계·확실〕 재정 환불(지출·수입)이 admin 허용 — 승인은 super 전용이라 통제 비일관 / `admin-expense-refund.ts:20`·`admin-revenue-refund.ts:20` canAccess(finance_refund) · 승인=super인데 환불=admin → 승인금액을 일반 admin이 차감 가능. 정책 정합(환불도 super 또는 시드로 통제).
- [AD-033] 〔경계·확실〕 외부 발간물 발행이 헤더 문서(super_admin)와 달리 admin 허용 / `admin-martyrdom-publication.ts:7-8`(문서)↔:108·184·244(canAccess admin ON) · 외부 공개물 발행 책임 주체 미좁힘. (AD-002 시드와 연동)
- [AD-034] 〔결함·확실〕 수입 카테고리 생성·수정·순서변경이 operator도 가능 — 지출 카테고리(super 전용)와 비대칭 / `admin-revenue-category-create/update/reorder.ts`(requireAdmin만).
- [AD-035] 〔결함·확실〕 빌링키 일괄관리 PATCH/DELETE에 역할 가드 없음 — operator가 재활성·금액변경·강제해지 / `admin-billing-keys.ts:16-18·154-185·202-217`(전용 재활성 API는 차단인데 일반관리는 무방비).
- [AD-036] 〔결함·확실〕 효성 import/export에 operator 권한 게이트 없음 — 대량 PII 추출·상태변경 무제한 / `admin-hyosung-import-billings/contracts.ts`·`admin-hyosung-export.ts`(requireAdmin만).
- [AD-037] 〔결함·확실〕 CSV 입금 import에 세부 권한 없음 — 통과엔 게이트, import엔 없음(비대칭) / `admin-donation-import.ts:218-220`.
- [AD-038] 〔갭·확실〕 익명 신원열람·감사로그 화면이 통합 CMS 미등록(레거시 admin.html 전용) — 가장 민감한 기능이 통합 어드민 밖 / `cms-tbfa.js` anon/reveal grep 0건.
- [AD-039] 〔경계·확실〕 신원 식별 감사로그 조회도 operator 가능 — 감사기록 자체가 민감한데 상위 제한 없음 / `admin-anonymous-reveal-logs.ts:25-26`.
- [AD-040] 〔경계·확실〕 사건 제보 상세(상태변경·신고자 메일)에 operator 차단 게이트 없음 / `admin-incident-report-detail.ts:24-26`(requireAdmin만).
- [AD-041] 〔갭·추정〕 유가족 지원 관리에 세부 권한 게이트 없음 — 운영자도 가족 민감사례 답변·메일 전권 / `admin-support.ts:20-22`.
- [AD-042] 〔결함·확실〕 익명 제보 상세·목록이 memberId를 그대로 반환 — 감사 없이 우회 식별 통로 / `admin-incident-report-detail.ts:78-89`·`admin-incident-reports.ts:59,81`.
- [AD-043] 〔경계·확실〕 발송 모듈 권한 불일치 — 카카오만 admin+, 수신자그룹·템플릿 CRUD는 operator 가능 / `admin-recipient-group-*`·`admin-template-*`(requireAdmin) vs `admin-kakao-templates.ts:112`.

**워크플로우 완결성·알림**
- [AD-044] 〔결함·확실〕 자격변경 승인/반려가 operator도 가능 + 결과가 인앱 알림만(이메일 미연결, 템플릿은 준비됨) / `admin-eligibility-review.ts:35-37·124-149` · `MEMBER_ELIGIBILITY_DECIDED` 다채널 미배선.
- [AD-045] 〔갭·확실〕 다채널 알림 이벤트(지원회신·SIREN할당·자격결정)가 정의·템플릿·어드민 설정까지 있는데 어떤 핸들러도 발사 안 함 — '죽은' 이벤트 / `lib/notify-events.ts:21-23` 발사처 0.
- [AD-046] 〔갭·확실〕 추모 글 숨김·삭제 시 작성 회원 통지 없음 — 막다른 처리 / `admin-memorial-moderation.ts:79-126`.
- [AD-047] 〔갭·확실〕 외부기관 인계 상태 갱신이 원본 신고에 미반영·미통지 — 신고 화면과 단절 / `admin-referral-status-update.ts:62-85`·`admin-referral-create.ts`(원본에 인계 플래그 미기록).
- [AD-048] 〔결함·확실〕 반려 사유 저장 필드 부재(harassment/legal/incident) — 사용자 타임라인 '반려 사유' 항상 공란 / `my-reports.js:101` `rejectedReason` ↔ schema에 rejected_reason 없음.
- [AD-049] 〔결함·추정〕 법률 변호사 자동배정이 사용자 매칭 confirm 이전에 실행 — 원치 않아도 배정·알림 / `legal-consultation-create.ts:174-197` vs `legal-consultation-confirm.ts:47`.
- [AD-050] 〔갭·확실〕 검토 '수정요청' 후 재배정·재검토 사이클 미완결 — 다음 액션 동선 모호 / `admin-martyrdom-review.ts:104-111`·`admin-martyrdom.js:1576-1588`.
- [AD-051] 〔결함·확실〕 무시(ignore)한 입금 '복원' 버튼이 안내 토스트만 띄우는 미구현 스텁 / `cms-tbfa-import.js:382-384`·서버 restore 액션 없음.
- [AD-052] 〔갭·확실〕 검토 상태에 '보류(held)' 단계 부재 — 판단 유보 건 격리 불가 / `pending_donations.status` 4종뿐.
- [AD-053] 〔결함·확실〕 통과를 트랜잭션 없이 다단계 쓰기 — 중간 실패 시 부분반영(회원/계약 생성됐는데 미확정 잔존) / `admin-donation-confirm.ts:60-143·393-444`.
- [AD-054] 〔결함·확실〕 IBK/레거시 통과에 중복 방지 가드 부재 — 더블클릭·동시요청 시 후원 중복 생성 / `admin-donation-confirm.ts:249-295`.
- [AD-055] 〔결함·확실〕 매칭 관리 '대기' 배지 항상 0(서버가 counts 미제공) — 신규 매칭 인지 못 함 / `admin-expert.js:229-245` vs `admin-expert-list.ts:160`.
- [AD-056] 〔갭·확실〕 배정된 1:1 상담 모니터링·에스컬레이션 진입점 없음(채팅 보기 = 토스트) / `admin-expert.js:624-630`.
- [AD-057] 〔갭·확실〕 대기 매칭 신청 '반려' 수단 없음 — 부적절 신청 처리 출구 부재 / `admin-expert.js:149-153`·rejected 전이 함수 없음.
- [AD-058] 〔결함·확실〕 발송 상세에 '발송 안 함(정책 스킵)' 집계 칸 없어 카카오 결과가 수치에서 사라짐 / `admin-send-job-detail.ts:40` vs dispatcher status='skipped'.
- [AD-059] 〔결함·확실〕 실패자 전체 재발송 성공 토스트 인원수 항상 '?' / `admin-send-job-detail.js:379-380` vs `admin-send-job-retry-failed.ts:103`.
- [AD-060] 〔갭·확실〕 발송 작업 목록·상세 엑셀/CSV 내보내기 부재 — 실패 명단 외부 보고 불가 / 해당 핸들러 없음.
- [AD-061] 〔갭·확실〕 수신자그룹·템플릿 삭제 시 '사용 중' 경고·차단 부재 — 예약 발송이 발송시점에 조용히 실패 / `admin-recipient-group-delete.ts`·`admin-template-delete.ts`.
- [AD-062] 〔갭·확실〕 카카오 템플릿 신규 등록 멱등성 없음 — 더블클릭 시 솔라피 중복 등록·고아 / `admin-kakao-templates.ts:163-214`(트랜잭션·중복검사 없음).
- [AD-063] 〔갭·확실〕 SIREN·법률 신고 목록 엑셀/CSV 내보내기 부재 / `admin-siren.js` export grep 0건.

**데이터 정합·기능**
- [AD-064] 〔결함·확실〕 통합 어드민 회원목록: 차단(suspended) 회원이 '활성'으로 표시(존재 않는 status 'blacklist' 비교) / `cms-tbfa.js:622`.
- [AD-065] 〔결함·확실〕 회원 차단 시 사유가 선택 — critical 작업인데 사유 없이 차단 가능 / `admin-members-blacklist.ts:71`(필수 검증 없음).
- [AD-066] 〔갭·확실〕 통합 어드민 회원 상세에 포인트·발송이력·지원신청·등급 탭 부재(API 미사용) / `cms-tbfa.html:2363-2365`.
- [AD-067] 〔결함·확실〕 수입 반려 안내는 '선택'인데 서버는 '필수' — 빈 사유로 반려 불가(지출과 불일치) / `admin-other-revenues.js:842-843` vs `admin-revenue-approve.ts:39-41`.
- [AD-068] 〔결함·확실〕 반려된 매출 상세에 반려 사유 행 없음(지출은 표시) — 무엇을 고칠지 모름 / `admin-other-revenues.js:755-765`.
- [AD-069] 〔결함·확실〕 예산 편성 API가 폐기된 budgets 테이블에 쓰기 — 호출 시 항상 실패(고아) / `admin-finance-budget-upsert.ts:24-29`.
- [AD-070] 〔결함·확실〕 계약 import 미리보기 매칭 예측과 실제 매칭 로직 불일치 — 예측 빗나감 / `admin-hyosung-import-contracts.ts:157-176` vs `lib/hyosung-members-parser.ts:71-103`.
- [AD-071] 〔결함·확실〕 두 효성 수납 import 경로가 다른 테이블·중복키 — 혼용 시 동일 결제 이중 계상 / `admin-hyosung-import.ts` vs `admin-hyosung-import-billings.ts`.
- [AD-072] 〔갭·확실〕 효성 대량등록 CSV 추출이 신 CMS(cms-tbfa)에 없어 import/export 동선 단절 / `cms-tbfa.js` hyosung-export grep 0건.
- [AD-073] 〔결함·확실〕 사건 상세 '담당자' 박스 항상 '미할당' + 변경 후 갱신 깨짐 / `admin-service-assignee.js:151-153·223-228` ↔ `admin-siren.js:436-466`. (AD-016과 동근원)
- [AD-074] 〔갭·확실〕 단순 단계변경(답변 없이 검토중 등) 사용자 알림 없음 / `admin-incident-report-detail.ts:148`. (AD-014 산하)
- [AD-075] 〔결함·확실〕 신원 식별 화면이 서버 미제공 항목(주소·가입일·회원번호) 표시 시도 → 영구 공란 / `admin-anon-reveal.js:227-229` vs `admin-anonymous-reveal.ts:126-141`.
- [AD-076] 〔결함·확실〕 신원 식별 목록 '단계' 배지·필터 동작 안 함(항상 0단계) / `admin-anon-reveal.js:60-86` vs `admin-report-list-by-status.ts:48-56`.
- [AD-077] 〔갭·확실〕 익명 신원 식별에 요청→검토→승인 단계 없음 — 운영자 1인이 즉시 전체 PII 열람(사후 감사로그만) / `admin-anonymous-reveal.ts:108-141`. (AD-003 보강)
- [AD-078] 〔갭·확실〕 익명 신고자 본인의 '실명 전환 요청' 진입점 전무 — 익명→실명은 100% 어드민 일방 열람만 / `my-reports.js`에 reveal/실명 grep 0건. (설계 의도면 P3·정책 확인)
- [AD-079] 〔결함·확실〕 신원 식별 시 신고자 본인에게 통지 없음 — 본인 모르게 익명성 해제 / `admin-anonymous-reveal.ts:108-141`.
- [AD-080] 〔갭·확실〕 발간물 본문 자동생성 실패해도 검수·발간 버튼 정상 노출 — '(생성 실패)' 더미가 발간될 수 있음 / `admin-martyrdom-publication-generate-background.ts:70-83`·`admin-martyrdom.js:3260-3265`.
- [AD-081] 〔결함·확실〕 발간 마스킹 '강' 선택이 실제론 중간 적용 — 최강 비식별화(full) UI에서 요청 불가 / `admin-martyrdom.js:1964-1967·3126` vs `admin-martyrdom-publication.ts:119`.
- [AD-082] 〔갭·확실〕 서면 초안 생성·편집·검토배정에 권한 게이트 없음 — operator가 민감 법적 서면 전부 작성·배정 / `admin-martyrdom-draft-*`·`review.ts`(requireAdmin만).
- [AD-083] 〔결함·확실〕 외부 자료 검토 탭 노출이 서버 권한과 무연동 — 권한 없는 운영자에게도 탭·버튼 노출 / `admin-martyrdom.js:255`(canExternalReview=true 고정).
- [AD-084] 〔결함·확실〕 외부 자료 영구삭제에 canAccess 게이트 없음 — 검토 못하는 운영자가 삭제는 가능 / `admin-martyrdom-external-delete.ts:30-39`.
- [AD-085] 〔갭·확실〕 승급 사건 삭제 시 외부자료 역참조·RAG 청크 고아 / `admin-martyrdom-cases.ts:273`·`lib/martyrdom-external.ts:371-408`. (AD-020 산하)
- [AD-086] 〔결함·확실〕 여론·뉴스 설정 저장 시 수집건수·자동수집시각이 매번 기본값으로 초기화 / `admin-org-news.js:474`·`admin-org-news-settings.ts:96-98`.
- [AD-087] 〔경계·확실〕 권한 정책 변경 후 다른 서버 인스턴스의 옛 권한 최대 5분 잔존(다중 인스턴스 캐시 미동기) / `lib/role-permission-check.ts:5-10·40-42`. (AD-001/002 처리 후 영향 축소)

---

## P3 결함·갭 (목록)

> 품질·일관성·드문 경계·성능. 위치 / 한 줄.

- [AD-088]〔결함〕 기타수입 수정의 super_admin 분기가 JWT role 의존(AD-001 산하·draft 한정) — `admin-revenue-update.ts:54-58`.
- [AD-089]〔경계〕 입금 통과(계좌이체/CMS)로 후원 생성돼도 후원자 확인 알림 없음(타입은 정의됨) — `admin-donation-confirm.ts` 발송 트리거 없음.
- [AD-090]〔결함〕 pending_donations.source 주석('hyosung'|'ibk')과 실제 저장값(4종) 불일치(동작은 정상) — `schema.ts:2025` vs import.
- [AD-091]〔경계〕 입금 통과 흐름과 은행대사(전표)흐름 병존 — 같은 입금 이중 처리 여지 — `admin-donation-import.ts` vs `admin-bank-reconcile.ts`.
- [AD-092]〔경계〕 미사용 중복 import 엔드포인트(import-v3)가 검토 건너뛰고 회원·후원 직접 생성(orphan, 경로 활성) — `admin-donation-import-v3.ts`.
- [AD-093]〔결함〕 환불에 행 잠금·트랜잭션 없음 — 동시 클릭 시 누적 환불 상한 초과 가능 — `admin-expense-refund.ts:38-80`·`admin-revenue-refund.ts:39-83`.
- [AD-094]〔갭〕 승인된 지출·수입 환불이 현금흐름표·재정상태표에 미반영(손익만 반영) — `admin-revenue-refund.ts:77-83`·`admin-finance-cashflow.ts`.
- [AD-095]〔결함〕 구 효성 수납 import의 결제일·금액 파싱 미정규화 — 수입 그래프 날짜 틀어질 수 있음 — `admin-hyosung-import.ts:266·120`.
- [AD-096]〔결함〕 EUC-KR 효성 CSV 신 경로에서 깨짐/0건 가능 — `lib/hyosung-parser.ts:102-114`·`cms-tbfa.js:1508-1519`.
- [AD-097]〔경계〕 전문가 배정·세션종료·프로필수정에 canAccess 세분 통제 여지(operator 통과는 정상) — `admin-expert-assign.ts:81` 등.
- [AD-098]〔경계〕 matched→active 자동 전이 경로 없어 '진행중' 탭 빈 채 — `lib/expert-match.ts:18-24`.
- [AD-099]〔경계〕 support_requests.assignedMemberId가 검증·서버엔 있으나 UI 설정 경로 없어 사실상 공란(담당은 expert_matches로만) — `admin-support.ts:200`.
- [AD-100]〔갭〕 검토자 배정 후보 목록(active+operator)과 배정 검증 조건 불일치(직접 호출 시 퇴직 계정 배정 가능) — `admin-martyrdom-reviewers.ts:22-27` vs `review.ts:54`.
- [AD-101]〔갭〕 외부 자료 승급 되돌리기 경로 없음(단방향 pending→approved/rejected) — `admin-martyrdom-external-review.ts:62`.
- [AD-102]〔결함〕 외부 검색 결과 중복 방지가 SELECT-후-INSERT + source_url UNIQUE 부재 — 동시 실행 시 중복 — `lib/martyrdom-external.ts:230-251`·`schema.ts:4451`.
- [AD-103]〔결함〕 외부 검색 트리거 직후 2초 새로고침은 결과 도착 전이라 빈 목록(안내 30~60초와 불일치) — `admin-martyrdom.js:3577-3579`.
- [AD-104]〔경계〕 외부 자료 'reviewing' 상태가 정의·조회만 되고 기록처 없는 死상태 — `schema.ts:4458` 등.
- [AD-105]〔갭〕 네이버 검색 환경변수(NAVER_SEARCH_CLIENT_ID/SECRET)가 CLAUDE.md §5 미문서화 — `lib/martyrdom-external.ts:84-98`.
- [AD-106]〔결함〕 검토 결정 API가 배정 검토자 본인 확인 안 함(서면, UI만 제한) — `admin-martyrdom-review.ts:85-132`. (AD-021과 동근원)
- [AD-107]〔결함〕 회원 상세 '블랙리스트' 표시(chatBlacklist)와 차단 버튼(members.blacklisted) 두 시스템 혼선 — `admin-member-detail.ts:109-129` ↔ `admin.js:3918`.
- [AD-108]〔경계〕 회원목록 donorType 필터가 members×donations 풀스캔 후 inArray — 대량 시 성능 — `admin-members.ts:277-310`.
- [AD-109]〔결함〕 여론·뉴스 '최신 재조사' 버튼이 admin에게도 보이나 실행은 super 전용(혼란) — `admin-org-news-refresh.ts:22-25`·`admin-org-news.html:86`.
- [AD-110]〔결함〕 외부기관 인계 중복방지 비원자적 — 더블클릭 시 중복 PDF·이력 — `admin-referral-create.ts:215-296`.
- [AD-111]〔갭〕 발송 미리보기 '수신자 0명' 경고만, 0명 발송 등록 자체는 차단 안 됨(즉시 completed) — `admin-send-job-create.ts:106-132`.
- [AD-112]〔갭〕 카카오 채널 템플릿(communication_templates) 변수 검증 누락(#{변수} 우회) — `admin-template-create.ts:86-98`.
- [AD-113]〔결함〕 메시지 템플릿 빌더 카카오 검수상태(alimtalkReviewStatus) 자유 입력 — 검증·동기화 없는 장식 — `admin-template-create.ts:121-123`.
- [AD-114]〔갭〕 수신자그룹·메시지 템플릿 CRUD에 감사로그 없음(카카오만 있음) — `admin-recipient-group-*`·`admin-template-*`.
- [AD-115]〔결함〕 메시지 템플릿 이름 중복 무방지(수신자그룹은 막힘) — `admin-template-create.ts:32-98`.
- [AD-116]〔경계〕 카카오 등록 시 연동 채널을 항상 첫 번째만 사용(다중 채널 선택 불가) — `admin-kakao-templates.ts:182-184`.
- [AD-117]〔결함〕 외부기관 인계 후 신고 원본 상태에 인계 사실 미반영 — 중복 처리·누락 위험 — `admin-referral-create.ts:280-296`. (AD-047 동근원)
- [AD-118]〔결함〕 사용자 처리단계 타임라인에 실제 없는 상태 단계 혼입(harassment 'responding', legal 'completed') — `my-reports.js:33-37`.
- [AD-119]〔결함〕 사건 삭제 확인창이 '관련 제보도 모두 삭제' 오안내(실제 set null로 잔존) — `admin-incidents-crud.js:202` ↔ `schema.ts:827`.
- [AD-120]〔갭〕 같은 이벤트에 승인 카카오 템플릿 2개 연결 시 경고 없음(자동발송은 최신 1개) — `admin-kakao-templates.ts:223`.
- [AD-121]〔결함〕 신원 식별 화면 '익명 단계(anonLevel)' 항상 0(DB 컬럼 없음) — 표시·필터 무의미 — `admin-anon-reveal.js:76·86`.
- [AD-122]〔결함〕 발송 취소 시 외부발송 진행 중(sending)이던 수신자가 '취소됨'으로 잘못 기록(성공 수 누락) — `admin-send-job-cancel.ts:87-93`.
- [AD-123]〔경계〕 신고 담당 풀에서 operator 제외 — operator에게 신고 직접 배정 불가 — `admin-workspace-member-list.ts:38`·`admin-service-assignee.ts:70-72`.
- [AD-124]〔결함〕 신고 처리 통지가 이메일 단일 채널 + opt-in 기본 꺼짐 — 전화만 있는 신고자엔 통지 불가 — `admin-incident-report-detail.ts:140`·`admin-support.ts:244`.
- [AD-125]〔결함〕 AI 미실행(skipAi) 직접검토 제보가 'submitted'에서 멈춤 — 사용자측 진행 트리거 없음 — `incident-report-create.ts:142-157`.
- [AD-126]〔갭〕 미디어 전사 후 추출 실패 자료 재시도가 원본 부재로 막힐 수 있음 — `admin-martyrdom-extract-background.ts:255-266`.

---

## 감사자 정정 (메인 수합 시 반영 필수)

워크플로우 서브에이전트 보고 중 **메인이 직접 코드 재검증하여 정정**한 항목 — 메인이 fix·수합 시 아래를 기준으로 할 것:

1. **[P0→P1 재분류·메커니즘 정정]** 경계 에이전트가 권한정책 PATCH를 *"위조 가능한 JWT 역할(P0)"*로 보고했으나, **JWT는 서명되어 위조 불가**(`lib/auth.ts:60-72`). 실제 근본원인은 **`auth-admin-elevate.ts:51`이 `type='admin'` 전원에 JWT role='super_admin'을 발급**하는 것 → `ctx.admin.role` 검사 게이트가 어드민·운영자 전원을 통과시킴. AD-001로 통합, 위조 표현 삭제, P1(운영상 role='admin' 어드민 둘 계획이면 P0).
2. **[결론 반대 정정]** 후원 에이전트가 *"donation_confirm이 operator를 영구 차단"*이라 보고했으나, 실제는 `admin-donation-confirm.ts:310`이 **JWT role(항상 super_admin)을 canAccess에 넘겨 게이트가 항상 통과**(operator 차단 X, super_admin 토글 무효). AD-001 산하.
3. **[허위안심 2건 제외]** ① 재정 에이전트의 *"수입 승인이 super_admin으로 정상 제한됨"*(reassuring) → 실제 `admin-revenue-approve.ts:17`은 JWT role 사용으로 **깨짐**(AD-001). ② perm-cache 에이전트의 *"권한정책 PATCH가 정확히 게이트됨"* → 동일 JWT 버그로 **깨짐**(AD-001). 두 안심은 무효.
4. **[경계 정상 확인]** 반대로 **대다수 super_admin 게이트는 DB role(`ctx.member`)로 정확**: 감사로그·예산승인/반려·후원정책·등급·요건CRUD·사건삭제·운영자관리·AI설정·지출승인. 깨진 건 §AD-001 목록(role-permissions PATCH·revenue-approve·expense-category-update·donation_confirm canAccess·expense/revenue-update owner분기)에 한정.

> **권한 경계 종합**: A 도메인 관점에서 admin이 *막혀야 하는* super_admin 전용은 대체로 정상 차단되나, **AD-001 클러스터(JWT role 신뢰)** 와 **AD-002(role_permissions 미시드)** 가 결합해 (1) 일부 super_admin 통제가 어드민·운영자에 노출되고 (2) canAccess 위임 자체가 불가능한 상태. 이 두 건이 R45 운영 전 **권한 정합의 핵심 수선 대상**이며 메인(R45-S) 권한 전수와 함께 처리 권장.

---

**보고 끝** — audit/r45-a, push 안 함. 메인 수합 대기.
