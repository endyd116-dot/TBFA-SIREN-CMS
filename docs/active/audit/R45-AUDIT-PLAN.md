# R45 — 운영 시작(06.01) 전 최종 점검 (역할 4티어 전수 감사)

> **작성**: 2026-05-29 / 메인(Opus)
> **베이스**: 로컬 `main` (이 plan 커밋 직후 HEAD = 감사 대상 = 현재 라이브)
> **목적**: 운영 시작 직전, **사용자/슈퍼어드민/어드민/운영자 4역할 입장에서 활동했을 모든 시나리오**를 완주하며 ① **빠진 기능·워크플로우(갭)** ② **결함**을 전수 발굴.
> **R41(2026-05-27) 전수 감사 이후** 추가된 SEO(R42)·딥릴리프 외부검색(R43)·서면 출처분리(R44)·카카오 알림톡 자동 CRUD·SSO·RAG·자료추출까지 포함.
> **FIX는 안 한다.** 각 채팅은 **읽기 전용 감사 + 보고서**만. 4개 보고서를 메인이 수합해 **한 번에** 수정.
> **배포 0회**: plan·보고서는 로컬 commit만. fix 완성 후 메인이 검증 단위로 1회 push (06.01 전).

규모: 함수 581 · 페이지 97 · JS 130 · lib 93 · cron 39 + background 12 · 테이블 167 · featureKey 약 49.

---

## 1. 분할 개요 — 권한 티어 = 소유 경계

R41은 도메인 4분할이었으나, R45는 **역할 관점 재편**(Swain 결정 2026-05-29). 권한 게이트가 곧 소유 경계다 — **각 티어가 접근 가능한 기능 전부**를 그 티어 담당이 시나리오로 완주한다.

| 영역 | 담당 | 역할 | 소유 범위 (게이트 기준) |
|---|---|---|---|
| **R45-S** | **메인** | 슈퍼어드민 | `requireRole(super_admin)` 전용 + **권한계층 정합·cron 전수·featureKey 시드↔게이트 정합·4영역 수합** |
| **R45-A** | **A** | 어드민 | `requireRole(admin)` + operator 차단 featureKey (회원·후원·SIREN·유족지원·딥릴리프·발송·재정·추모) |
| **R45-O** | **B** | 운영자 | `requireAdmin` 단독 + `requireOperator` + operator 허용 featureKey (캠페인·게시판·워크스페이스·근태/성과 본인·AI비서) |
| **R45-U** | **C** | 일반 사용자 | `requireActiveUser` + public (가입·후원·SIREN 신고·유족지원·게시판·추모·채팅·마이페이지·영수증) |

**권한 모델 (확정)**:
- `requireAdmin` = 어드민 로그인 전체(super_admin/admin/operator 모두 통과)
- `requireRole(member,"admin")` = admin·super_admin만 / `requireRole(member,"super_admin")` = super_admin만
- `canAccess(role, featureKey)` = super_admin 항상 true; `role_permissions`의 adminAllowed/operatorAllowed; **미등록 featureKey면 admin 허용·operator 불가**
- `requireActiveUser` = 회원(블랙 차단) / `requireOperator` = type='admin' 또는 operatorActive=true

**소유 규칙 (중복 최소화)**: 한 기능은 **그 기능을 게이트하는 가장 낮은 티어**가 소유한다.
- operator도 되는 것 → R45-O(B) / admin은 되고 operator는 안 되는 것 → R45-A(A) / super_admin만 → R45-S(메인) / 회원·공개 → R45-U(C).
- **권한 경계는 양쪽이 본다**: 각 어드민 티어는 "내가 **할 수 있어야 할** 것을 다 할 수 있나"(완결성) + "**위 티어 전용**에 내가 막히나"(상승 차단)를 함께 점검. 애매한 경계 항목은 자기 관점에서 점검하고 보고서에 `경계` 태그.

> **모델 권장**: 전 영역 **Opus**. 이 작업의 가치는 "미묘한 갭·결함을 찾는 것"이라 탐지 깊이가 중요.

---

## 2. 영역별 시작 시드맵 (기능 지도 — 빠짐없이 enumerate의 출발점)

> 아래 표는 **출발 지도**일 뿐. 각 담당은 자기 티어 게이트에 매칭되는 **모든 함수·페이지를 직접 enumerate**(grep)한 뒤 감사. 표에 없는 것도 찾아낼 것.

### 2-S. 메인 — 슈퍼어드민 (R45-S)

**전용 기능(grep `requireRole(...,"super_admin")` / `roleForbidden("super_admin")` 전부 enumerate)**:

| 기능 | 진입 | 핵심 함수 | 점검 포인트 |
|---|---|---|---|
| AI 비서 도구 권한·프롬프트 설정 | admin AI 설정 | `admin-ai-config` | 22개 도구 enabled·requiredRole 토글, 시스템 프롬프트 |
| 회원 등급 정책 | 설정 | `admin-grades` | 등급 최소금액·월수 |
| 감사 로그 조회·CSV | 감사 | `admin-audit*` | super_admin만 접근 확인 |
| 지출 결의 승인 / 예산안 승인 | 예산·회계 | `admin-expense-approve`, `admin-budget-plan-approve` | draft→approved/rejected 전이·거절 사유 |
| 지출 카테고리 생성 | 예산·회계 | `admin-expense-category-create` | — |
| 순직 사건 삭제 / 인정요건 CRUD·AI파싱 | 딥릴리프 | `admin-martyrdom-cases`(DELETE), `admin-martyrdom-criteria*` | 삭제 시 자식(자료·RAG청크) 처리 |
| 후원 정책 수정 | 설정 | `admin-donation-policy` | 금액·은행·효성·모달 |
| 운영자 승급/수정/강등 | 운영자 관리 | `admin-operators` (POST/PATCH/DELETE) | **마지막 super_admin 강등 방어**·자기강등 금지·UI 경고 |
| 권한 정책 CRUD | 권한 정책 | `admin-role-permissions` | adminAllowed/operatorAllowed 토글·**UI 진입점 존재 여부** |
| SEO 메타 발행 | 콘텐츠 SEO | `admin-seo-publish` | Build Hook 트리거 |
| 회원 기본연봉 설정 | 회원 상세 | `cms-tbfa.js saveBaseSalary` | 저장 함수 정합 |
| 함께워크 ON SSO | — | `sso-on` | 60초 HS256·`SIREN_SSO_SECRET` fail-closed |

**슈퍼어드민 책임(영역 무관·메인 단독)**:
- **권한 계층 정합 전수**: `requireRole`/`canAccess`/`requireAdmin`/`requireOperator`/`requireActiveUser` 5가드가 모든 민감 API에 정확히 걸렸나. 상위가 하위 포함, 자기강등·마지막 super_admin 방어.
- **featureKey 시드↔게이트 정합 (약 49개·아래 §2 perm 표)**: 코드가 `canAccess(...,key)` 부르는데 `role_permissions`에 시드 안 된 key → 의도와 다른 기본값(operator 차단/admin 허용). 또는 게이트 없이 `requireAdmin`만 걸려 operator가 보면 안 될 걸 보는지.
- **cron 39 + background 12 전수**: netlify.toml schedule 등록·`INTERNAL_TRIGGER_SECRET` fail-closed·멱등(중복/재시도)·시간대.
- **4영역 수합**: A·B·C 보고서를 R45-MASTER로 통합·우선순위·중복제거.

**featureKey 카탈로그 (시드 정합 점검용·미시드는 admin 허용/operator 차단 기본)**: ai_agent_chat, ai_rag_search, ai_config_prompt, expert_match_generation, expert_recommendation, similar_cases, memorial_story_detail, campaign_ai_copy, churn_reengage_ai, report_ai_summary, donation_confirm, finance_refund, settlement_view, seo_edit, martyrdom_publication, martyrdom_pub_export, martyrdom_external_review, martyrdom_ai, martyrdom_ai_external, milestone_insight, milestone_match, milestone_matrix_mapping, payroll_ai_summary, ms_ai_classify, ms_ai_coaching, att_ai_daily_summary, att_ai_insight, att_remote_draft, daily_briefing_generation, weekly_report_generation, donor_data_extraction, schedule_runner, org_news_analysis 등.

**갭 후보(검증)**: 권한 정책 수정 UI 진입점 / 시스템 환경설정 UI 부재 / `ai_agent_chat`·`ai_rag_search` canAccess 미호출(권한 게이트 누락 의심) / `settlement_view` 게이트 일관성(admin-payroll·cron-agent-9 미적용 의심) / `seo_edit` 조회·편집 미분리 / 마지막 super_admin 강등 UI 경고.

### 2-A. A — 어드민 (R45-A)

**기능(grep `requireRole(...,"admin")` + operator 차단 `canAccess` 전부 enumerate)**:

| 기능 | 진입 | 핵심 함수 | operator 차단 |
|---|---|---|---|
| 회원 블랙리스트 / 자격 강제변경 | CMS 회원 / admin 교원자격 | `admin-members-blacklist`, `admin-eligibility-force-change` | requireRole admin |
| 후원 입금 통과 처리 | CMS 입금매칭 | `admin-donation-confirm` | canAccess `donation_confirm` |
| 후원/환불 관리·효성 import/export | CMS 후원·재정 | `admin-donations*`, `admin-hyosung-*`, `admin-finance-budget-upsert`, `admin-expense-*`, `admin-revenue-*` | canAccess `finance_refund` |
| SIREN 신고 처리 3종 | CMS SIREN | `admin-report-*`, `admin-incident*`, `admin-harassment*`, `admin-legal*` | requireAdmin |
| 익명→실명 전환(reveal) | — | `admin-anonymous-reveal*` | requireAdmin + audit |
| 전문가 배정 매칭 | 전문가매칭 | `admin-expert-assign`, `admin-experts-for-match`, `admin-ai-expert-*` | requireAdmin |
| 유가족 지원 운영 | CMS 지원 | `admin-support` | requireAdmin |
| 딥릴리프(순직) 운영·발간·외부검색 | CMS 딥릴리프 | `admin-martyrdom-*` (37개), `admin-martyrdom-external-*` | canAccess `martyrdom_publication`/`martyrdom_external_review` |
| 발송 작업·수신자그룹·템플릿·카카오 | CMS 발송 | `admin-send-*`, `admin-recipient-group-*`, `admin-template*`, `admin-kakao-templates` | requireAdmin / requireRole admin |
| 추모관 운영 | CMS 추모관 | `admin-memorial-*`, `admin-family-stor*` | requireAdmin |
| 기관·추천 관리 | admin 외부기관 | `admin-agency-*`, `admin-referral-*` | requireAdmin |
| 뉴스·여론 분석 | CMS 여론뉴스 | `admin-org-news*` | requireAdmin |
| 정기결제 빌링키 재활성 | 결제 | `admin-billing-key-reactivate` | requireRole admin |

**워크플로우 완결성 갭 후보(검증)**: 후원 import→confirm 사이 상태체계 / 발송 processing 중 취소·재시도 부분전송 / SIREN ai_analyzed→responding 배정자 지정 / 전문가 배정 후 상담 모니터링·에스컬레이션 / **익명 reveal 요청→검토→승인 워크플로우 부재** / **유족지원 신청→담당자 배정 API 부재** / 딥릴리프 발간 검수자 배정 단계 / 재정 거절 사유·재요청 / 카카오 템플릿 내부 검수 상태 / 권한 변경 후 5분 캐시 레이스.

**권한 경계**: admin이 `requireRole(super_admin)` 전용(권한정책·후원정책 수정·감사로그·예산/지출 승인·운영자관리·등급)에 **막히는지** 확인.

### 2-O. B — 운영자 (R45-O)

**기능(`requireOperator` 전부 enumerate + `requireAdmin` 단독 + operator 허용 featureKey)**:

| 기능 | 진입 | 핵심 함수 | 게이트 |
|---|---|---|---|
| 근태(출퇴근·휴가·재택·정정·통계) | workspace-attendance | `att-*` (21개) | requireOperator |
| 성과(본인 마일스톤·완료카드 분류·정산조회) | workspace-milestones | `workspace-milestone-*`, `milestone-*` | requireOperator |
| 급여 명세(본인) | workspace | `payroll-my`, `payroll-my-pdf` | requireOperator |
| 워크스페이스(칸반·캘린더·파일·템플릿·알림·메모) | workspace-* | `workspace-*` (30개) | requireOperator |
| Task(작업카드)·승인 대기 | workspace | `admin-task-*`, `admin-pending-approvals` | requireAdmin/requireOperator |
| AI 비서(읽기 도구) | admin AI | `admin-ai-agent*` | requireAdmin(canAccess `ai_agent_chat`?) |
| 채팅 | mypage | `chat-*` | requireActiveUser |
| 캠페인·게시판·공지·자료실 관리 | CMS/admin | `admin-campaigns`, `admin-board-posts`, `admin-notices`, `admin-resources` | requireAdmin 단독(operator 차단 여부 확인) |

**권한 경계 위험(검증)**: requireAdmin 단독 게이트가 operator를 통과시키는지(통과시키면 admin 전용 침해) / `milestone-settlement`·workspace task가 super_admin/admin/operator 동일 권한(타인 할당·마감 강제변경 제한 부재) / `att-ai-draft`·`chat-mine` operator 사용 정책 / operator가 남의 근태·성과·급여를 볼 수 있나(IDOR).

**워크플로우 갭 후보(검증)**: operator 공지/자료실 게시 불가·게시판 중재 불가·캠페인 발송 불가(권한 정책 의도 확인) / 근태 승인(타인 휴가/정정 승인) 워크플로우 부재 / 성과 관리자 승인·조정 부재 / 급여 이의제기 채널 부재.

### 2-U. C — 일반 사용자 (R45-U)

**페이지(public/*.html 중 admin-*·cms-*·workspace-* 제외 전부 enumerate)** + **여정 완결성**:

| 여정 | 시작 페이지 | 핵심 API | 완료 후 후속 | 끊김/누락 의심 |
|---|---|---|---|---|
| 회원가입 | index | 휴대폰/이메일 인증 → `auth-signup` | 환영메일·슈퍼어드민 알림 | signup_source_id 기록 |
| 로그인/비번재설정/탈퇴 | index·password-reset·mypage | `auth-login`/`auth-password-reset*`/`auth-withdraw` | 토큰만료 안내·탈퇴 후 복구정책 | 토큰만료 안내·복구정책 불명 |
| 일시 후원 | campaigns·index | `donate` (card/cms/bank) | 감사메일·기록 | **비회원 영수증 발급 불가** |
| 정기 후원 | billing-register | `donate-kicc-*`/`billing-*` | 정기납부·실패 알림 | **해지 셀프 경로 UX 불명** |
| 영수증 | payment-success·billing-mine | `donation-receipt` | PDF·R2 | 자동발급 트리거 불명 |
| SIREN 신고 3종(익명 지원) | incident·report·legal-support | `incident-*`/`harassment-*`/`legal-*` create→confirm | 워크스페이스 카드·운영자 알림 | **신고 후 진행상황 알림 없음** |
| 내 신고 조회 | my-reports | `user-my-reports`, `*-mine` | — | 결과 알림 메커니즘 |
| 유가족 지원 신청 | form·support | `support-create` | 신청자·운영자 메일 | **배정·상태변경 알림 없음** |
| 자격 변경 신청 | eligibility-status | `eligibility-request` | — | 승인/반려 알림 불명 |
| 추모관 헌화·방명록·편지 | memorial | `memorial-offering`/`memorial-messages`/`memorial-letters` | 카운트·게시 | 비공개·삭제 셀프제어 불명 |
| 게시판 열람·작성·댓글·신고·구독 | board* | `board-*`/`comment-*`/`user-post-subscriptions` | 알림 | 댓글신고 후 처리 불명 |
| 캠페인 참여·서명 | campaigns·campaign | `campaigns`/`donate` | 감사메일 | 서명 vs 후원 구분·참여내역 조회 부재 |
| 채팅(상담) | mypage | `chat-*` | 전문가 배정 | 종료/아카이빙 자동화 부재 |
| 마이페이지(포인트·뱃지·랭킹·알림설정) | mypage·mypage-points·ranking | `auth-me`/`mypage-points`/`notification-preferences` | 포인트 갱신 | 알림설정↔실제발송 정합 |

**권한·보안(C 핵심)**: 비로그인 접근 가능 페이지가 적절한가 / **타인 데이터 접근(IDOR)** — 내 신고·후원·채팅·지원만 보이나(소유자 검증) / **익명 신고의 익명성**(목록·상세·알림에 신원 노출 0) / 휴대폰·이메일 인증 우회 / 토큰 만료.

**사용자 관점 갭 후보(검증·12)**: 신고 진행상황 실시간 알림 / 정기후원 해지 셀프 UX / 비회원 영수증 / 법률상담 피드백 수신 / 탈퇴 후 복구 / 후원 캠페인별 추적 / 채팅 종료 자동화 / 알림설정↔발송 정합 / 유족지원 상태 알림 / 다국어·접근성 / 추모 글 공개범위 제어 / 캠페인 참여내역·참여증명.

---

## 3. 감사 방법론 — 역할 시나리오 완주 + 갭 발굴(1순위) + 10차원 결함스캔

> **핵심 원칙 1 (역할 시나리오 완주)**: 파일을 따로 읽지 말고 **그 역할이 실제로 할 일을 처음부터 끝까지 따라간다.** "내가 이 역할로 로그인했다 → 무엇을 하려 할까 → 그 흐름이 끊김 없이 완결되나 → **하려는데 기능이 없나(갭)**."
> **핵심 원칙 2 (갭 발굴 1순위)**: 이번 점검의 1순위는 **빠진 기능·워크플로우**. "이 역할이 당연히 필요로 할 동작인데 화면·API·후속이 없는 것"을 적극적으로 찾는다. 결함(버그)은 그 다음.

각 여정의 각 단계에서 아래 **10차원**을 점검:

1. **워크플로우 완결성** — 시작→완료 끊김 없나? 상태 전이(신청→검토→승인→완료/반려)가 **모든 경로**에서 가능? 막다른 화면·되돌릴 수 없는 단계·"다음" 누락·완료 후 후속(알림·정산·반영·영수증) 누락. 반려·취소·재신청 경로?
2. **기능 동작** — 버튼·폼·필터·정렬·페이지네이션·검색·엑셀·업/다운로드 실제 동작? 빈 onclick·미구현 핸들러·죽은 링크? 빈/로딩/에러 UI?
3. **API 계약 정합** — 클라 body 필드 ↔ 서버 검증 일치? 응답 다중 fallback? `export const config = { path }`(없으면 404)? 메서드·경로?
4. **권한·보안** — 5가드 정확? `canAccess` 게이트가 쓰기·민감 작업에 걸렸나? **IDOR**(남의 데이터)? **익명성**? 토큰·쿠키·PII 노출? **운영자가 봐선 안 될 것 노출**?
5. **로직·계산** — 금액·등급·정산·급여·포인트·통계·기간필터 정확? 경계값(0·음수·빈·최대)·반올림·통화·퍼센트? **KST↔UTC**? 멱등(중복 제출·재시도·더블클릭)?
6. **데이터 정합** — DB 제약(NOT NULL·UNIQUE·FK·DEFAULT)↔코드 충돌? 부모 삭제 시 자식(고아)? soft-delete 일관성? 트랜잭션 누락? 동시성?
7. **에러 처리** — `step`/`detail`/`stack` 표준? 빈 catch(삼킴)? 토스트에 detail? 외부의존(PG·SMS·카카오·AI·R2) 실패 graceful? 보조 SELECT 실패가 메인 죽이나?
8. **회귀 위험** — schema.ts ↔ 실제 DB 컬럼 불일치(SELECT 깨짐)? leftJoin 체인? 헬퍼 필드명 불일치(`user.id` vs `uid`)? 캐시버스터 누락? append-only 위반?
9. **크론·백그라운드** — schedule 정확? `INTERNAL_TRIGGER_SECRET` fail-closed? 중복/누락? 타임아웃? 재시도·알림? 멱등?
10. **운영 자립성** — 공개 페이지 동적 콘텐츠가 어드민 CMS에서 관리되나(**하드코딩 금지**)? cms-tbfa iframe 4곳 등록? 운영자가 코드 없이 수정·발행?

---

## 4. 심각도 척도 (결함·갭 공통)

각 항목 앞에 `[결함]` 또는 `[갭]` 태그 + P0~P3.

| 등급 | 결함 의미 | 갭 의미 |
|---|---|---|
| **P0** | 즉시 운영/사용자 피해(다운·이중결제·인증불능·데이터유실·발송전체실패·PII노출) | 운영 시작 자체가 불가능한 필수 기능 부재 |
| **P1** | 핵심 기능 불능(버튼 무반응·404/500·저장 실패·권한 우회·워크플로우 단절) | 핵심 역할 시나리오가 막히는 워크플로우 부재(예: 신청은 되는데 처리 화면 없음) |
| **P2** | 부분 결함(빈상태·미세오차·일부 게이트 누락·시간대·특정필터) | 있으면 운영 품질 크게 오르는 누락(예: 진행상황 알림) |
| **P3** | 품질·일관성·성능·자립성 | 선택적 개선(다국어·참여증명 등) |

---

## 5. 산출물 형식

각 담당은 `docs/active/audit/R45-report-{S=메인|A|B|C}.md` 작성. 결함/갭 ID prefix = **티어 코드**:
- 메인 슈퍼어드민 = `SU-001` / A 어드민 = `AD-001` / B 운영자 = `OP-001` / C 사용자 = `US-001`

```markdown
# R45 최종 점검 — {역할명} ({담당})
> 감사자: {모델} / 2026-05-29 / 베이스 {HASH}
> 점검: API {n} · 페이지 {n} · JS {n} · lib {n} · cron {n}
> 커버리지: 자기 티어 게이트 매칭 함수 전부 enumerate [O/X]

## 요약
- [결함] P0 {n} P1 {n} P2 {n} P3 {n} / [갭] P0 {n} P1 {n} P2 {n} P3 {n}
- 최우선 5건: {ID}(한 줄), ...
- 점검했으나 정상인 핵심 시나리오(안심 목록): {3~5개}

## 결함·갭 목록
### [US-001] {제목}  〔갭·P1〕
- **역할/시나리오**: {역할이 무엇을 하려다 어디서 막히나}
- **위치**: `netlify/functions/foo.ts:123` / `public/js/bar.js:45` (갭이면 "해당 화면·API 없음")
- **증상**: {사용자·운영자가 겪는 문제 — 기능·로직 위주, 코드 용어 최소 (§6.14)}
- **근거**: {코드 인용 2~5줄 또는 "X를 grep했으나 없음" + 왜 결함/갭인지}
- **권장 수정**: {메인이 fix할 방향 — 구체적으로}
- **확신도**: 확실 / 추정(재현 필요)
```

> **표현 규칙(§6.14)**: 증상·영향은 사용자/역할 시나리오 위주. 단 **위치·근거·권장수정은 정확한 파일·라인·코드** 명시(메인이 바로 fix).

---

## 6. 수행 프로세스 (배포 0회)

```
1. 메인: 이 plan을 로컬 main에 commit (push X) → BASE_HASH 확정
2. A·B·C: 자기 워크트리에서 clean 확인 후
     git checkout -B audit/r45-{A|B|C} main      ← 로컬 main(plan 포함) 분기
     git log --oneline -1                          ← BASE_HASH 확인
3. 각자 자기 티어 전수 감사 → docs/active/audit/R45-report-{A|B|C}.md 작성
4. 자기 브랜치에 commit (push X)
5. 메인에 보고: 브랜치명·커밋 해시 + 요약(결함/갭 P0/P1 건수·최우선 5건)
6. 메인: 4개 보고서 수합(같은 .git) → R45-MASTER (우선순위·중복제거·경계항목 재배정)
7. 메인: 한 번에 fix → tsc → 검증 단위로 1회 push (06.01 전 단일 배포)
```

- **읽기 전용**: A·B·C는 코드 수정·fix·마이그·push **안 함**. 보고서 1파일만 commit.
- A·B·C 자율주행(CLAUDE.md §6.17): Read/Grep/Glob/git log·diff·add·commit 자유. push·force·hard reset·lib/auth·admin-guard·hyosung-parser 수정 금지.

---

## 7. 트리거 (Swain 복붙용)

3개 트리거(A·B·C)는 메인 채팅 응답에 전문 출력. 본 문서는 공통 기준. 메인은 R45-S(슈퍼어드민) 자체 감사 병행.

**마지막 갱신**: 2026-05-29 — R45 운영전 최종 점검 설계(역할 4티어).
