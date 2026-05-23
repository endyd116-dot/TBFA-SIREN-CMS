# 🟧 C 영역 전수 검수 리포트 — 어드민 CMS·재정·권한·콘텐츠빌더·인프라

> 검수자: C (검수전용) / 2026-05-23
> 검수 베이스: **main 최신 코드** (audit/c-prelaunch = main 17a7eb3 기준. 워크트리가 117커밋 뒤처진 `verify/r37-stages`였어 main에서 검수 브랜치 분기)
> 방식: Explore 에이전트 5개 1차 fan-out → **C가 모든 P0/P1 주장을 코드로 직접 재검증**(§0.4 증거 기반·추측 금지). 에이전트 오탐 다수 정정.

## 요약: P0 1건 / P1 1건 / P2 7건 + 교차검증 메모 1건

- **에이전트 1차 보고 P0 6건·P1 11건 중 → 실제 검증 후 P0 1건·P1 1건만 확정.** 나머지는 거짓/과장(아래 "오탐 정정" 표 참조). 메인 취합 시 에이전트 원보고가 아닌 본 리포트의 확정 건만 마스터표에 반영 권장.
- 확정 P0: 운영자 관리 API 권한 상승(operator → super_admin 자가 승격 가능)
- 확정 P1: 빌링키·빌링로그 관리 화면 API 경로 미등록(생성 시점부터 404)

---

## 검수한 워크플로우 (시나리오 + PASS/이슈)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 어드민 대시보드 진입 → 통계·이탈위험·KPI 로드 | **PASS** (응답키 다중 fallback `res.data.data \|\| res.data` 정상, config path 존재) |
| 2 | 회원 목록 → 상세 → 내보내기(CSV/계약) → 승인대기 처리 | **PASS** (가드·응답 구조 정상) |
| 3 | 전표 작성(draft) → 제출 → 승인 → 장부/손익·대차·현금흐름 보고서 | **PASS** (타입·가드·금액 합계 정상) |
| 4 | 지출/수입 작성 → 승인 | **PASS** (에이전트가 P0 타입오류로 오인 → 실제 정상, 오탐 정정 참조) |
| 5 | 예산안 작성 → 제출 → 승인 / 반복전표 자동생성(cron) | **PASS** |
| 6 | 은행거래 업로드 → 매칭 → 결산 체크 | **PASS** (단 전표↔예산/은행 FK 미설정 — P2-2) |
| 7 | 운영자 승급/강등/역할변경 | **이슈 P0-1** (권한 상승) |
| 8 | 자격(eligibility) 변경 심사 승인/반려 | **PASS** (단 역할 제한 검토 권장 — P2-7) |
| 9 | 발송: 수신자그룹 생성→미리보기→잡 생성(preflight)→진행률→재시도→분석 | **PASS** (상태머신·가드·중복방지 견고) |
| 10 | 빌링키·빌링로그 관리 화면(KICC 빌링 탭) | **이슈 P1-1** (API 404) |
| 11 | 폼빌더 생성→공개→응답 제출→수집 | **PASS** (단 file 필드 미완성 — P2-6) |
| 12 | 홈섹션·팝업·네비·관련사이트·큐레이션 편집 → 공개 반영 | **PASS** |
| 13 | iframe 4곳(admin·cms-tbfa·site-builder·workspace) 18개 타깃 라우팅 | **PASS** (전 타깃 HTML 존재, 404 iframe 0) |
| 14 | 전체 cron 35개 스케줄 등록 | **PASS** (전부 인라인 `config.schedule` 보유 — P2-3 주석 리스크만) |

---

## 발견사항

### [P0] 운영자 관리 API 권한 상승 — operator가 자신/타인을 super_admin으로 승격 가능
- **위치**: `netlify/functions/admin-operators.ts:51`(가드), `:139-140`(POST role), `:197-198`(PATCH role)
- **증상**: `requireAdmin`만 통과하면(=`members.type='admin'`이면) POST로 임의 회원을 `super_admin`으로 승급, PATCH로 임의 운영자의 역할을 `super_admin`으로 변경 가능. operator 등급도 type=admin이라(승급 시 line 165에서 모든 등급이 `type:'admin'`) 이 API에 접근 → 4계층 권한 경계 무력화.
- **기대**: 역할 변경·승급은 `super_admin` 전용이어야 함. 형제 함수들이 이 패턴을 강제함 — `admin-service-rnr.ts:42·96·158`(`isSuperAdmin` 체크 후 거절), `admin-role-permissions.ts:28`(`admin.role !== 'super_admin'` → 403).
- **근거**: admin-operators.ts에는 super_admin 역할 체크가 전혀 없음(자기 자신 강등 방지·마지막 super_admin 보호 로직만 존재). 동일 코드베이스의 권한 변경 API는 모두 super_admin을 강제하는데 이 함수만 누락.
- **전제·심각도 메모**: 익명/일반 사용자 공격은 아님 — 이미 admin-type(operator 포함) 계정이 있어야 함. **operator 등급을 실제로 발급하지 않고 super_admin·admin만 운영하면 실 위험은 낮음.** 단 operator 등급(카테고리 제한 최소권한)을 1명이라도 발급하는 순간 즉시 P0. NPO 특성상 유가족 PII·신고·재정 접근 경계이므로 운영 전 차단 권장.

### [P1] 빌링키·빌링로그 관리 화면 API 경로 미등록 → 404 (생성 이래 비동작)
- **위치**: `netlify/functions/admin-billing-keys.ts`, `netlify/functions/admin-billing-logs.ts` (둘 다 `export const config` 부재)
- **증상**: 클라이언트(`public/js/cms-tbfa.js:2580·2599·2648·2705·2720·2736·2765·2814·2836`)는 `/api/admin/billing-keys`·`/api/admin/billing-logs`를 호출하지만, 두 함수에 `export const config = { path }`가 없음. netlify.toml·`public/_redirects`에 `/api/*` 일반 리다이렉트도 없어(catch-all 404만 존재) → 해당 경로는 `404.html`로 떨어짐.
- **연결**: cms-tbfa 어드민의 **"💳 KICC 빌링 (자동 청구)" 탭**(`cms-tbfa.js:276`, `:310 loadTbKeys()`)이 이 엔드포인트를 호출 → 탭 진입 시 빌링키 목록·통계·해지·로그 전부 불러오기 실패.
- **기대**: 정상 함수처럼 `export const config = { path: "/api/admin/billing-keys" }` 선언 필요(비교: `admin-stats.ts:91`).
- **근거**: git 이력상 Phase 2 생성(86f8445) 이후 TS 에러 수정(f0d32d9)만 거쳤고 config는 추가된 적 없음 → **생성 시점부터 줄곧 404**. 다만 실제 KICC 정기청구 cron(`cron-kicc-billing`)은 이 화면과 무관하게 독립 동작하므로, 영향은 "어드민이 빌링키 현황을 화면에서 못 봄"에 한정.
- **경계 메모**: 빌링은 형식상 메인 도메인이나 어드민 CMS 화면이라 C가 발견. 메인 교차검증 요망.

### [P2-2] 전표(voucher)의 예산·은행거래 FK 미설정 — orphan 가능
- **위치**: `db/schema.ts:3058`(`budgetLineId: integer` — FK 주석 "머지 후 별도 추가"), `:3061`(`bankTxnId: integer` — "R2에서 활성화")
- **증상**: budget_line_id·bank_txn_id가 정수 컬럼이나 FK 제약 없음 → 삭제된 예산항목·은행거래를 가리키는 고아 전표 가능. 무결성은 애플리케이션 코드에만 의존.
- **근거**: 같은 테이블의 `expenseId`는 `.references(() => expenses.id)`로 FK 설정됨(대비). 운영 전 위험은 낮으나 정합 보강 권장.

### [P2-3] 일부 cron이 netlify.toml 미등록(인라인 config만 의존) — 발송 디스패처 주석의 자기경고
- **위치**: `netlify.toml:180-184`(주석: 인라인 schedule이 "일부 환경에서 인식 안 됨"이라 디스패처·재시도만 이중 등록)
- **증상**: cron 35개 전부 인라인 `config.schedule`은 보유하나, netlify.toml에는 약 13개만 등록. 1분 주기 핵심(dispatcher·retry)은 이중 등록했지만 `cron-billing-card-expiry`·`cron-task-risk`·`cron-payroll-monthly`·`cron-ms-*`·`cron-att-late-streak`·`cron-att-remote-streak`·`cron-auto-trigger-evaluator`·`cron-tracking-stats-rollup`·`cron-workspace-trash-cleanup`·`cron-milestone-quarter`는 인라인만 의존.
- **근거**: 프로젝트 본인 주석이 인라인 인식 불안정을 명시한 마당에 시간 비핵심 cron들은 인라인만 둠. 인라인이 정상 작동하면 무해(Netlify 공식 동작)하나, 주석 우려가 실재한다면 급여 월결산·카드만료알림 등이 조용히 미실행될 잠재 리스크. 운영 후 실제 실행 로그로 1회 확인 권장.

### [P2-4] migrate-* 1회용 마이그레이션 9개 잔존 — 정책 위반(삭제 대상)
- **위치**: `netlify/functions/migrate-ai-agent.ts`·`migrate-ai-agent-settings.ts`·`migrate-ai-cost-tracking.ts`·`migrate-ai-tools-f7.ts`·`migrate-ai-tools-readplus.ts`·`migrate-ai-tools-x.ts`·`migrate-phase22a-c-seed.ts`·`migrate-potential-donors.ts`·`migrate-static-pages.ts`
- **증상**: CLAUDE.md §9.1.2 "1회용·호출 후 즉시 삭제" 정책상 잔존. 9개 모두 `requireAdmin` 가드는 보유(보안 구멍 아님)하나 공격 표면·코드 청결성 저하.
- **근거**: 정책 명문 위반. 운영 전 일괄 삭제 권장(가드는 있으므로 P2).

### [P2-5] 발송잡 template_id 타입 폭 불일치
- **위치**: `db/schema.ts:2300`(`communicationSendJobs.template_id: integer notNull`) vs `communicationTemplates.id: bigserial`
- **증상**: FK 대상은 bigserial인데 참조 컬럼은 integer. 현 규모(수천 건) 무해하나 21억 초과 시 위험·조인 정합 저하.
- **근거**: 타입 통일(bigint) 권장. 즉각 장애 아님.

### [P2-6] 폼빌더 file 필드 미완성 — 첨부해도 저장 안 됨(조용한 데이터 손실)
- **위치**: `netlify/functions/admin-form-save.ts:25`(VALID_TYPES에 `"file"` 포함), `public/form.html:113`(file input 렌더 + "D5 단계 지원 예정" 안내), `netlify/functions/form-submit.ts`(file 처리 코드 없음)
- **증상**: 운영자가 폼빌더에서 file 타입 필드를 만들 수 있고 사용자에게 파일 선택기가 보이지만, 제출 시 파일은 업로드·저장되지 않음. 운영자/사용자 모두 "첨부됐다"고 오인 가능.
- **기대**: 구현 전까지 빌더의 file 타입 비활성 또는 명확한 미지원 경고. 문서 제출이 필요한 폼이면 영향 큼.
- **근거**: VALID_TYPES 허용 ↔ 제출 미처리 불일치.

### [P2-7] 자격(eligibility) 변경 심사에 역할 제한 없음 — volunteer 자동 승격 포함
- **위치**: `netlify/functions/admin-eligibility-review.ts:35`(requireAdmin만)
- **증상**: 모든 admin-type(operator 포함)이 자격 변경 승인 가능. 승인 시 변호사·심리상담사는 `type='volunteer'`+`secondary_verified=true`로 자동 승격되어 전문가 매칭 풀에 등록(line 101-113) — 다소 특권적 작업.
- **판정**: requireAdmin은 적용돼 있으므로 P0/P1 아님(에이전트는 P1로 오분류). 단 자격 승인을 super_admin/특정 역할로 제한할지 운영 정책 결정 권장 → P2.

### [P2-8] cms-tbfa 'toss-billing' 내부 키 레거시 네이밍 잔재
- **위치**: `public/js/cms-tbfa.js:276`(탭 키 `'toss-billing'`, 라벨은 "KICC 빌링"), `:310`
- **증상**: 토스→KICC 전환 후에도 내부 탭 키·함수명(`loadTbKeys`)이 toss 명칭. 사용자 노출 라벨은 KICC로 정정됨(비기능). 정합·가독성 차원.

### [교차검증 메모] 발송 어댑터 알리고(aligo) import 잔존 — 솔라피 전환 대상
- **위치**: `netlify/functions/admin-system-notification-list.ts:18-19`(`lib/notify-adapters/sms-aligo`·`kakao-aligo` import)
- **메모**: 발송 엔진·어댑터는 메인 도메인이라 C가 판정하지 않음. `docs/active/2026-05-23-solapi-migration.md`(전환 진행 중) 존재 → 알리고가 현역인지 전환 잔재인지 메인이 확인 필요. SMS/카카오 실제 발송 경로 정합 교차검증 요망.

---

## 🔧 오탐 정정 (에이전트 1차 보고 → C 직접 검증 결과 거짓/과장)

> 메인 취합 시 마스터표에 **넣지 말 것**. 이미 검증해 기각함.

| 에이전트 보고 | 분류 | 검증 결과 | 근거 |
|---|---|---|---|
| 재정: expense/revenue `recordedBy`/`approvedBy` integer↔uid 문자열 타입오류 | P0 | **거짓** | `AdminPayload.uid`는 `number`(lib/auth.ts:39). `auth.ctx.admin.uid`를 integer 컬럼에 INSERT — 정상. (admin-expense-create.ts:62, admin-expense-approve.ts:62) |
| 재정: voucher `approvedBy` varchar에 email 저장 = 타입불일치 | P0 | **거짓** | vouchers.createdBy/approvedBy는 varchar(100)(schema:3068·3071), 코드도 `String(email)` 저장(admin-voucher-create.ts:72) — 일치. expense/revenue(integer)와 식별자 방식이 다를 뿐(→ P2 정합 정도) |
| 재정: anomaly 전월동기 날짜계산 `prevSyncEnd = prevStart` 무의미 | P2 | **거짓** | `prevSyncEnd`(전월1일)에 SQL에서 `+ dayOfMonth일`을 더함(admin-finance-anomaly.ts:64). 로직 정상 |
| 발송: `adminId` null 저장 가능 | P1 | **거짓** | `created_by`는 nullable integer(schema:2314, FK set null) + `auth.ok` 통과 후 `ctx.admin.uid`는 항상 number(send-job-create.ts:40) |
| 발송: `templateId` 0/NaN INSERT 우려 | P1 | **과장** | `validateSendJob`가 비활성/없는 템플릿을 검증 단계 400으로 차단(send-job-create.ts:109-129). 무해 |
| 운영: admin-dashboard-churn 응답키 미동기 / admin-stats path 불일치 | P0/P1 | **거짓** | 클라이언트가 `res.data.data \|\| res.data` 다중 fallback 사용(admin-unified-dashboard.js:338), config path 존재(churn:119, stats:91) |
| 운영: admin-security-alert super_admin 필요 / admin-password 세션무효화 등 | P1 | **추측·기각** | "~가능성"·"~필요할 수도" 류 근거 부재. requireAdmin 적용 확인됨 |
| 권한: eligibility-review 역할체크 누락 | P1 | **강등→P2** | requireAdmin 적용됨. 운영성 업무로 super_admin 전용일 필연성 없음(P2-7로 재분류) |

---

## ✅ 통과 확인된 축 (PASS)

- **cron 등록**: 35개 전부 인라인 `config.schedule` 보유 — 미등록 cron 0 (P2-3 주석 리스크만 잔존).
- **iframe 4곳**: admin·cms-tbfa·admin-site-builder·workspace의 iframe 타깃 18개 전부 존재 HTML — 404 iframe 0.
- **깨진 자산**: 주요 어드민 페이지의 로컬 JS/CSS 참조 중 누락(404) 0건.
- **인증 계약**: C영역 함수에서 `auth.response` 오용 0건(전부 `.res`), `requireAdmin` 호출 후 `.ok`/`guardFailed` 미체크 0건.
- **mock/DEMO**: 라이브 mock·DEMO 데이터 없음(cms-tbfa.js:62 제거 이력 주석만).
- **토스 잔재**: finance-income-summary·cms-tbfa의 toss/hyosung 채널 표시는 과거 결제 이력 표시용 — 정당(잔재 아님).
- **응답 봉투**: `ok()` = `{ok,message,data}`, 클라이언트 `res.data.data` 접근 — 일관.

---

## 🚧 검수 못 한 / 불확실 영역 (시간·정보 부족)

- **환경변수 정합**: Netlify 콘솔 접근 불가 → `process.env.*` 키가 실제 설정됐는지 미확인. 코드상 참조 키 목록 추출은 가능하나 값 존재 검증 불가. **메인/Swain의 Netlify 콘솔 대조 필요.**
- **재정 P2 외 세부 흐름**: 예산 대비 실적 계산식·대차대조표 비현금 자산 범위·결산 마감(lock) 기능 유무는 에이전트 보고에 의존(C 직접 깊이검증은 P0/P1 후보 위주로 진행). balance-sheet가 현금성 자산만 반영하는 점은 설계 범위 확인 필요.
- **콘텐츠빌더 P2 다수**: 팝업 layoutConfig 공개응답 포함 여부·메뉴 Draft/즉시반영 정책 일관성·폼 정원 실시간 표시 등은 에이전트 보고(미재검증). 운영 영향 낮아 후순위.
- **KPI·admin-hub 화면 렌더링**: 함수 응답 구조는 PASS 확인했으나 실제 화면 렌더링·차트 표시는 라이브 검증 필요(정적 검수 한계).
- **캐시버스터 ?v= 일관성**: 깨진 참조(404)는 없음 확인. 다만 "변경된 JS인데 ?v= 미갱신으로 구버전 캐시" 류는 정적 분석으로 판정 불가(런타임/배포 시점 의존).

---

## 메인 인계 요약 (3줄)
1. **즉시 결정 필요(P0)**: operator 권한 상승(admin-operators super_admin 체크 누락). operator 등급 발급 계획 있으면 운영 전 필수 차단.
2. **운영 전 권장(P1)**: KICC 빌링 관리 탭 404(billing-keys/logs config.path 누락). 빌링 cron 자체는 정상이라 화면만 영향.
3. **에이전트 1차 보고의 P0 6·P1 11 중 실제는 P0 1·P1 1.** 나머지는 오탐 정정표 참조 — 마스터표 작성 시 중복 반영 주의.
