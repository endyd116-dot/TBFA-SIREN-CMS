# R41 — 플랫폼 전수 디버그 감사 (4분할)

> **작성**: 2026-05-27 / 메인(Opus 4.7)
> **베이스**: 로컬 `main` @ `38ab38e` (현재 라이브 상태 = 감사 대상)
> **목적**: SIREN 플랫폼 전체(562 함수·90+ 페이지·100+ JS·90 lib·56+ 테이블)를 4등분 전수 감사.
> 워크플로우 결함·기능 결함·로직 오류·API 정합·권한·데이터 정합·에러처리·회귀·크론·운영자립까지 **모든 결함**을 찾아 보고.
> **FIX는 안 한다.** 각 채팅은 **읽기 전용 감사 + 보고서**만. 4개 보고서를 메인이 수합해 **한 번에** 수정.
> **배포 0회**: plan·보고서는 로컬 commit만. fix 완성 후 메인이 검증 단위로 1회 push.

---

## 1. 분할 개요

| 영역 | 담당 | 테마 | 대략 규모 |
|---|---|---|---|
| **Q1** | **메인 (Opus 4.7)** | 정체성·돈(들어오는) — 인증·권한·회원·후원·결제·통계 | API ~120 |
| **Q2** | **A (Opus 4.7 권장)** | 공익 서비스 — SIREN 신고·유가족 지원·딥릴리프·추모·게시판 | API ~140 |
| **Q3** | **B (Opus 4.7 권장)** | 내부 운영·생산성 — 워크스페이스·근태·급여·성과·채팅·AI 비서 | API ~150 |
| **Q4** | **C (Opus 4.7 권장)** | 백오피스 — 재정·회계·발송·알림·사이트 콘텐츠 CMS | API ~155 |

> **모델 권장**: 전 영역 **Opus 4.7**. 이 작업의 가치는 "미묘한 결함을 찾아내는 것"이라 Sonnet은 탐지 깊이가 떨어진다. 비용 우려 시 A·B만 Sonnet 가능(탐지율 하락 감수).
> **경계 중복 허용**: 도메인 경계(예: 정산=재정 vs 마일스톤, eligibility=후원자격 vs 유족지원)는 겹쳐도 됨. **빠뜨리는 것보다 둘이 보는 게 낫다.** 애매하면 자기 영역 관점에서 점검하고 메인에 "경계 항목" 표시.

---

## 2. 영역별 상세 범위

> 범위는 **함수 prefix(권위 기준)** + **대표 페이지** + **lib** + **cron**. 각 담당은 자기 prefix에 매칭되는 **모든 함수를 먼저 enumerate**(빠짐없이 목록화)한 뒤 감사.
> 페이지의 JS는 해당 HTML의 `<script src>`를 grep해서 추적(직접 나열 안 함 — 누락 방지).

### Q1 — 메인 (인증·회원·후원·결제·통계)

| 묶음 | 함수 prefix / 이름 |
|---|---|
| 인증·세션·권한 | `auth-*`, `admin-login`, `admin-logout`, `admin-session`, `admin-me`, `admin-me-update`, `admin-operators`, `admin-role-permissions`, `admin-user-preferences`, `auth-admin-elevate`, `sso-on` |
| 회원·등급 | `admin-members*`, `admin-member-*`, `admin-grades`, `admin-signup-sources`, `admin-members-source-kpi`, `admin-members-blacklist`, `admin-members-export`, `admin-members-search`, `admin-members-contract-export` |
| 게이미피케이션 | `admin-point-*`, `my-points`, `my-badges`, `admin-badge-definitions`, `admin-rewards`, `admin-reward-redemptions`, `reward-redeem`, `rewards-list`, `ranking` |
| 후원자격·해지 | `eligibility-request`, `eligibility-status`, `admin-eligibility-*` (=후원/정기결제 자격·해지. 유족지원 자격은 Q2) |
| 후원 | `donate-*`, `donation-*`, `donations-*`, `admin-donation-*`, `admin-donations*`, `admin-donor-*`, `admin-potential-donor-*`, `admin-prospect-donor-*`, `donation-policy`, `admin-donation-policy`, `me-donor-status` |
| 결제·PG·효성 | `billing-*`, `admin-billing-*`, `kicc-webhook`, `donate-kicc-*`, `donate-hyosung-intent`, `donate-bank-intent`, `admin-hyosung-*` |
| 영수증 | `donation-receipt`, `admin-receipt-*`, `cron-donation-receipt-annual` |
| 통계·대시보드·감사 | `admin-dashboard-*`, `admin-stats`, `admin-anniversary-stats`, `admin-audit*`, `admin-security-alert`, `admin-churn-*` |
| cron | `cron-billing-*`, `cron-kicc-billing`, `cron-donor-status-sync`, `cron-grade-recalc`, `cron-churn-predictor`, `cron-anniversary-check`, `cron-phone-verify-cleanup`, `cron-cleanup-audit-logs`, `cron-donation-receipt-annual` |
| lib | `auth`, `admin-guard`, `operator-guard`, `admin-role`, `role-permission-check`, `kicc`, `hyosung-*`, `donor-*`, `donation-matcher`, `bank-reconcile`, `grade-calculator`, `member-classifier`, `phone-verify`, `receipt-number`, `pdf-receipt`, `churn-predictor`, `badge-checker`, `masking`, `pii-mask` |
| 대표 페이지 | `index`, `mypage`, `mypage-points`, `donate`, `billing-register`, `billing-success`, `billing-fail`, `payment-success`, `payment-fail`, `ranking`, `email-verify`, `password-reset`, `admin.html`(코어 대시보드), `admin-hub`, `admin-gamification`, `admin-role-policy` |

### Q2 — A (SIREN 신고·유가족 지원·딥릴리프·추모·게시판)

| 묶음 | 함수 prefix / 이름 |
|---|---|
| SIREN 신고 3종 | `incident-*`, `admin-incident-*`, `admin-incidents-crud`, `admin-incident-stats`, `incidents`, `incident-comments`, `harassment-*`, `admin-harassment-*`, `legal-*`, `admin-legal-*` |
| 통합 신고처리 | `admin-report-*`(board/detail/generate/list/list-by-status/send-email/status-*), `admin-report-board` |
| 익명·실명전환 | `admin-anonymous-reveal*`, `admin-anonymous-reveal-logs` |
| 유가족 지원 신청 | `support-*`, `admin-support` |
| 전문가 매칭 | `expert-match-*`, `expert-session-end`, `admin-expert-*`, `admin-experts-for-match`, `admin-ai-expert-*`, `user-match-feedback*` |
| 기관·추천 | `admin-agency-*`, `admin-referral-*` |
| 딥릴리프(순직) | `admin-martyrdom-*` (전부 36개), `cron-martyrdom-deadline` |
| 추모·유가족 사연 | `memorial-*`, `admin-memorial-*`, `family-stories-*`, `family-story-*`, `admin-family-stories`, `admin-family-story-ai` |
| 게시판·댓글 | `board-*`, `admin-board-posts`, `comment-*`, `admin-comment-report*`, `comment-vote`, `comment-report` |
| lib | `ai-ocr`, `ai-incident`, `ai-harassment`, `ai-legal`, `ai-priority`, `expert-match`, `martyrdom-ai`, `martyrdom-export`, `martyrdom-notify`, `report-data-collector`, `report-collector`, `anniversary-checker`, `pdf-activity-report` |
| 대표 페이지 | `incident`, `incidents`, `report`, `report-harassment`, `legal-support`, `support`, `my-reports`, `my-subscriptions`, `admin-martyrdom`, `admin-anon-audit`, `admin-anon-reveal`, `memorial`, `memorial-teacher`, `family-story`, `family-stories`, `admin-memorial`, `admin-family-stories`, `board`, `board-view`, `board-write`, `admin-comment-reports` |

### Q3 — B (워크스페이스·근태·급여·성과·채팅·AI 비서)

| 묶음 | 함수 prefix / 이름 |
|---|---|
| 워크스페이스 | `workspace-*`, `admin-workspace-*` (전부 30개), `workspace-milestone-*`, `admin-pending-approvals` |
| 근태·휴가·재택 | `att-*` (전부 21개), `admin-att-*` (전부 20개) |
| 급여 | `payroll-my`, `payroll-my-pdf`, `admin-payroll-*` |
| 마일스톤·성과·정산 | `milestone-*`, `admin-milestone-*`, `ms-ai-classify`, `ms-ai-coaching`, `ai-milestone-insight`, `ai-task-*-background`, `admin-task-*`, `admin-task-ai-regenerate`, `admin-task-due-changes` |
| 채팅 | `chat-*`, `admin-chat-*`, `cleanup-chat-images` |
| 구글 연동 | `google-calendar-*` |
| AI 비서·RAG·자동화 | `admin-ai`, `admin-ai-agent`, `admin-ai-agent-stream`, `admin-ai-config`, `admin-ai-conversation*`, `admin-ai-cost-stats`, `admin-ai-features`, `admin-ai-logs-list`, `admin-ai-usage-logs`, `admin-ai-reply*`, `admin-ai-similar-cases`, `admin-rag-*`, `admin-daily-briefing`, `admin-auto-trigger*` |
| cron | `cron-workspace-*`, `cron-att-*`, `cron-payroll-monthly`, `cron-ms-*`, `cron-milestone-quarter`, `cron-task-risk`, `cron-agent-8`, `cron-agent-9`, `cron-ai-*`, `cron-auto-trigger-evaluator` |
| lib | `workspace-logger`, `workspace-sync`, `att-session`, `att-utils`, `payroll-calc`, `payroll-pdf`, `milestone-roles`, `ai-task`, `mention-helper`, `ai-agent-tools`, `ai-agent-config`, `ai-embedding`, `ai-rate-limit`, `ai-prompt-cache`, `ai-cache`, `natural-search`, `gemini-stream`, `sse-writer`, `ai-feature`, `ai-gemini`, `ai-cost-monitor`, `ai-report-generator`, `ai-reply` |
| 대표 페이지 | `workspace`, `workspace-kanban`, `workspace-calendar`, `workspace-files`, `workspace-templates`, `workspace-milestones`, `workspace-notifications`, `workspace-attendance`, `admin-workspace-management`, `admin-attendance-settings`, `admin-payroll`, `admin-milestones`, `admin-ai-assistant`, `admin-ai-config`, `admin-ai-cost`, `admin-auto-triggers`, `admin-auto-trigger-edit` |

### Q4 — C (재정·회계·발송·알림·사이트 콘텐츠 CMS)

| 묶음 | 함수 prefix / 이름 |
|---|---|
| 재정·회계 | `admin-account-code*`, `admin-bank-*`, `admin-budget-*`, `admin-counterpart*`, `admin-expense-*`, `admin-finance-*`, `admin-revenue-*`, `admin-voucher-*`, `cron-voucher-recurring` |
| 발송·알림·추적 | `admin-send-*`, `admin-template-*`, `admin-templates-list`, `admin-recipient-group-*`, `track-*`, `admin-notification-*`, `admin-notify-subscribers`, `admin-system-notification-*`, `admin-kakao-templates`, `notifications-mine`, `notifications-read`, `notification-preferences`, `user-mention*`, `user-my-send-history`, `admin-member-send-history` |
| 발송 cron | `cron-kakao-template-status`, `cron-communication-send-dispatcher`, `cron-tracking-stats-rollup`, `cron-notification-retry`, `cron-org-news`, `cron-campaign-slump-check` |
| 사이트 콘텐츠 CMS | `admin-campaigns`, `campaigns`, `admin-campaign-stats`, `admin-campaign-ai-copy`, `admin-curations`, `site-curations`, `admin-popups`, `site-popups`, `admin-org-news-*`, `admin-content-pages`, `content-pages`, `admin-nav-menus`, `public-nav-menus`, `admin-related-sites`, `public-related-sites`, `admin-faqs`, `faqs`, `admin-resources`, `admin-resource-categories`, `resources`, `admin-notices`, `notices`, `admin-media-posts`, `media-posts`, `admin-activity-posts`, `activity-posts`, `public-home-content`, `public-mypage-content`, `public-stats`, `public-activity-reports`, `admin-site-settings`, `site-config`, `admin-site-builder` |
| 응답폼·신청폼 빌더 | `form`, `form-submit`, `admin-forms-list`, `admin-form-save`, `admin-form-delete`, `admin-form-submission*`, `admin-form-submissions-list` |
| lib | `csv-export`, `site-settings`, `naver-search`, `cache`, `communication-tracking`, `communication-auto-trigger`, `communication-send`, `recipient-resolve`, `template-render`, `notify`, `notify-dispatcher`, `notify-events`, `notify-adapters/*`, `solapi-client`, `aligo-client`, `org-news-analyze`, `image-compress` |
| 대표 페이지 | `cms-tbfa`(통합 CMS — 거대·iframe 다수), `campaigns`, `campaign`, `admin-send-jobs`, `admin-send-job-create`, `admin-send-job-detail`, `admin-send-analytics`, `admin-templates`, `admin-template-edit`, `admin-recipient-groups`, `admin-recipient-group-edit`, `admin-notification-defaults`, `admin-notification-logs`, `admin-system-notification`, `admin-kakao-templates`, `admin-org-news`, `admin-curations`, `admin-popups`, `admin-site-builder`, `admin-forms`, `admin-form-submissions`, `news`, `about`, `activity`, `activities`, `resources` |

### 공용 인프라 (각 영역이 자기 사용처에서 함께 점검 · 미할당 잔여는 메인 수합)

`blob-*`, `lib/r2-*`, `lib/image-compress`, `lib/validation`, `lib/response`, `lib/audit`, `lib/datetime`, `lib/cache`, `lib/site-settings`, `lib/sse-writer` — 공용. 자기 도메인에서 호출하는 부분을 함께 점검하고, 인프라 자체 결함은 발견 시 보고(영역 무관).

---

## 3. 감사 방법론 — 10대 차원 (전 영역 공통)

> **핵심 원칙**: 파일을 따로따로 읽지 말고 **워크플로우(여정)를 추적**하라.
> 각 도메인마다 ① **여정 지도**부터 그린다: `진입 페이지 → JS 이벤트 → API → DB → cron/백그라운드 → 알림/후속`.
> ② 그 흐름의 **각 단계**에서 아래 10개 차원을 점검한다. 단순 파일별 버그가 아니라 **흐름이 끊기는 지점**을 찾는 게 1순위.

1. **워크플로우 완결성** — 시작→완료까지 끊김 없나? 상태 전이(신청→검토→승인→완료/반려)가 **모든 경로**에서 가능한가? 막다른 화면, 되돌릴 수 없는 단계, "다음" 버튼·링크 누락, 완료 후 후속(알림·정산·반영·영수증) 누락. 반려·취소·재신청 경로 존재?

2. **기능 동작** — 모든 버튼·폼·필터·정렬·페이지네이션·검색·엑셀·업/다운로드가 실제 동작? 빈 `onclick`·미구현 핸들러·죽은 링크? 빈 데이터(0건)·로딩·에러 상태 UI 존재? 모달 열고 닫힘·저장 후 갱신?

3. **API 계약 정합** — 클라가 보내는 body 필드명·타입 ↔ 서버 검증·사용 필드 일치? 클라가 응답을 다중 fallback(`data.data.X || data.X || X`)으로 받나? `export const config = { path }` 존재(없으면 404)? 메서드(GET/POST) 일치? 경로 오타?

4. **권한·보안** — 모든 admin API에 `requireAdmin`(반환 `auth.res`)? 사용자 진입 API에 `requireActiveUser`(블랙 차단)? 세분 권한 `canAccess(role, featureKey)` 게이트가 **쓰기·민감 작업**에 걸렸나? 남의 데이터 접근(IDOR — 본인 소유·작성자 검증 누락)? 익명 신고의 **익명성** 보장? 토큰·쿠키·PII 노출? 운영자(operator)가 봐선 안 될 것 노출?

5. **로직·계산 정확성** — 금액·등급·정산·급여·포인트·통계·기간필터 계산 정확? 조건 분기·경계값(0·음수·빈값·최대)·반올림·통화 단위·퍼센트? **시간대(KST↔UTC)** 처리? 멱등성(중복 제출·재시도·더블클릭)?

6. **데이터 정합성** — DB 제약(NOT NULL·UNIQUE·FK·DEFAULT)과 코드 충돌? 부모 삭제 시 자식 처리(고아 레코드)? soft-delete 일관성(삭제됐는데 목록·통계에 잡힘)? 트랜잭션 누락(부분 실패 시 정합 깨짐)? 동시성(race)?

7. **에러 처리·복원력** — §6.2 표준(`step`/`detail`/`stack`)? 빈 `catch`(에러 삼킴)? 사용자에게 의미 있는 피드백(토스트에 detail)? 외부 의존(PG·SMS·카카오·AI·R2) 실패 시 graceful? 보조 SELECT 실패가 메인 응답을 죽이나?

8. **회귀 위험 (CLAUDE.md §9.1)** — schema.ts 정의 ↔ 실제 DB 컬럼 불일치(SELECT 깨짐)? drizzle 다중 leftJoin 체인? 헬퍼 함수 사용처 필드명 불일치(예: `user.id` vs `uid`)? 캐시버스터(`?v=N`) 누락으로 옛 JS 캐시? schema append-only 위반?

9. **크론·백그라운드** — 스케줄 표현식(`schedule`) 정확? `INTERNAL_TRIGGER_SECRET` fail-closed? 중복/누락 실행? 장시간 작업 타임아웃(Netlify 함수 한계)? 실패 시 재시도·알림? 멱등(같은 날 두 번 돌아도 안전)?

10. **운영 자립성 (CLAUDE.md §6.18)** — 공개 페이지 동적 콘텐츠가 어드민 CMS에서 관리되나(**하드코딩 콘텐츠 금지**)? 통합 CMS(cms-tbfa) iframe 4곳 등록? 운영자가 코드 없이 수정·발행 가능?

---

## 4. 심각도 척도

| 등급 | 의미 | 예시 |
|---|---|---|
| **P0** 운영장애 | 즉시 사용자/운영 피해 | 사이트 다운, 결제 실패·이중결제, 인증 불능, 데이터 유실, 발송 전체 실패, 개인정보 노출 |
| **P1** 기능 불능 | 핵심 기능이 동작 안 함 | 버튼 무반응, API 404/500, 저장 실패, 권한 우회(남의 데이터 접근), 워크플로우 단절(다음 단계 불가) |
| **P2** 부분 결함 | 일부 케이스·경계·UX | 빈 상태 미처리, 계산 미세 오차, 일부 권한 게이트 누락, 시간대 오차, 특정 필터에서만 깨짐 |
| **P3** 개선 | 품질·일관성·성능·자립성 | 에러 메시지 불친절, 응답 fallback 누락(잠재 위험), 하드코딩 콘텐츠, 성능(N+1) |

---

## 5. 산출물 형식

각 담당은 `docs/active/audit/report-{Q1메인=main|A|B|C}.md` 작성. **결함 ID는 영역 prefix**(`Q1-001`, `Q2-001`, `Q3-001`, `Q4-001`)로 — 메인이 합칠 때 충돌 없음.

```markdown
# R41 전수 감사 — {영역명} ({담당})

> 감사자: {모델} / 2026-05-27 / 베이스 38ab38e
> 점검: API {n}개 · 페이지 {n}개 · JS {n}개 · lib {n}개 · cron {n}개
> 커버리지: 자기 prefix 매칭 함수 전부 enumerate 완료 여부 [O/X]

## 요약
- P0 {n} · P1 {n} · P2 {n} · P3 {n}
- 최우선 5건: Q?-00X(한 줄), ...
- 점검했으나 정상인 핵심 흐름(안심 목록): {3~5개}

## 결함 목록

### [Q?-001] {제목}  〔P1〕
- **영역/단계**: {도메인 · 워크플로우 어느 단계}
- **위치**: `netlify/functions/foo.ts:123` / `public/js/bar.js:45`
- **증상**: {운영자·사용자가 겪는 문제 — 기능·로직 위주, 코드 용어 최소 (§6.14)}
- **워크플로우 영향**: {여정의 어디가 어떻게 끊기나}
- **근거**: {코드 인용 2~5줄 + 왜 결함인지}
- **권장 수정**: {메인이 fix할 방향 — 구체적으로}
- **확신도**: 확실 / 추정(재현 필요)
```

> **표현 규칙 (§6.14)**: 증상·영향은 사용자/운영자 시나리오 위주. 단 **위치·근거·권장수정은 정확한 파일·라인·코드** 명시(메인이 바로 fix해야 하므로 정확성 우선).

---

## 6. 수행 프로세스 (배포 0회)

```
1. 메인: 이 plan을 로컬 main에 commit (push X)
2. A·B·C: 자기 워크트리에서
     cd ../tbfa-mis-{A|B|C}
     git stash 또는 clean 확인 (이전 작업 정리)
     git checkout -B audit/r41-{A|B|C} main      ← 로컬 main(38ab38e + plan) 분기
     git log --oneline -1                          ← 38ab38e 확인
3. 각자 영역 전수 감사 → docs/active/audit/report-{A|B|C}.md 작성
4. 자기 브랜치에 commit (push X)
5. 메인에 보고: 브랜치명·커밋 해시 + 채팅 요약(P0/P1 건수·최우선 5건)
6. 메인: 4개 보고서 수합(같은 .git이라 fetch 불요) → 마스터 결함 리스트(우선순위 정렬)
7. 메인: 한 번에 fix → tsc/검증 → **검증 단위로 1회 push** (여기서 첫 배포)
```

- **읽기 전용**: A·B·C는 코드 수정·fix·마이그·push **안 함**. 보고서 파일 1개만 commit.
- **같은 .git 공유**: 메인은 `git show audit/r41-A:docs/active/audit/report-A.md`로 바로 읽거나, 보고서가 서로 다른 파일이라 4개 브랜치 충돌 없이 merge 가능.

---

## 7. 메인(Q1) 자체 감사 체크리스트

A·B·C에 트리거 분배 후, 메인도 Q1을 동일 방법론으로 감사 → `report-main.md`.

- [ ] 인증: `auth-login`/`signup`/`password-reset`/`phone-verify`/`email-verify`/`withdraw` 흐름 단절·검증·중복가입·재설정 토큰 만료
- [ ] 세션·권한: `admin-session`(방금 개편한 타이머 백엔드)·`requireAdmin`/`requireActiveUser`/`canAccess` 게이트 누락 전수
- [ ] 회원·등급: 목록·검색·상세·블랙리스트·엑셀·등급 재계산(cron) 정합
- [ ] 후원: 일시/정기/계좌이체/효성/KICC 결제 → 승인 → 영수증 → 후원자 상태 동기 전 구간
- [ ] 결제 멱등·이중결제·취소·환불·빌링키·카드만료 cron
- [ ] 게이미피케이션: 포인트 적립·차감·뱃지·랭킹 계산 정확성
- [ ] 통계·대시보드: KPI·코호트·이탈 수치 계산·기간필터·시간대
- [ ] Q1 cron 9종 fail-closed·멱등·중복

---

## 8. 트리거 (Swain 복붙용)

3개 트리거(A·B·C)는 메인 채팅 응답에 별도 출력. 본 문서는 그 공통 기준(범위·방법론·형식·프로세스).

**마지막 갱신**: 2026-05-27 — R41 전수 감사 설계
