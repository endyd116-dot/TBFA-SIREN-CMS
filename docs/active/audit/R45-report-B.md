# R45 최종 점검 — 운영자(operator) (B)

> 감사자: Opus 4.8 (1M) + 16-에이전트 워크플로우(8 도메인 finder + 도메인별 adversarial verifier) / 2026-05-29 / 베이스 `9040dfb`
> 점검: API(operator 접근면) 약 130 · 페이지/JS(workspace·admin-chat·cms-tbfa·kanban) 일부 · lib(auth·admin-guard·operator-guard·role-permission-check·ai-feature·ai-agent-config·payroll-calc·workspace-sync) · cron(workspace 3·payroll·milestone)
> 커버리지: `requireOperator` 전부(26개) + `requireAdmin` 단독 운영자 통과면(admin-* 약 200개 중 민감 카테고리 전수) + operator 허용 featureKey + 권한 경계 양방향 enumerate — **[O]**
> 읽기 전용. 코드 0수정. 보고서 1파일만 commit.

---

## 요약

- **총 78건** = [결함] 50 · [갭] 28
- 심각도: **P0 5건**(결함4·갭1) / **P1 19건**(결함10·갭9) / **P2 32건** / **P3 22건**
- **권한 상승(escalation) 위험 9건** (R41 P0 유형) — 모두 `auth-admin-elevate`가 운영자에게 `super_admin` JWT를 발급하는 단일 근본 원인에서 파생.

### 최우선 5건 (권한 상승·익명성 우선)
1. **OP-001 [결함·P0]** — `auth-admin-elevate`가 운영자(type=admin/role=operator)에게 **`super_admin` JWT를 발급**. JWT role을 신뢰하는 모든 게이트가 무력화되는 근본 원인. (메인 R45-S와 공유 — operator 영역 종착점이 OP-002·003.)
2. **OP-002 [결함·P0]** — 권한정책 변경(`admin-role-permissions` PATCH)이 **JWT role**을 신뢰 → 운영자가 elevate 후 임의 기능의 `operatorAllowed=true`를 **자가부여**해 사이트 전역 `canAccess` 게이트를 연쇄 무력화. (가장 폭발력 큰 종착점)
3. **OP-007 [결함·P0]** — 익명 SIREN 신고 **목록·상세에서 제보자 실명이 마스킹 없이 노출**. 신원 식별 전용 감사 흐름(`admin-anonymous-reveal`)을 우회.
4. **OP-008 [갭·P0]** — 익명 신고 **실명 전환을 일반 운영자가 단독 실행** 가능 + super_admin 통지 없음(내부고발자·피해자 보호 통제선 부재).
5. **OP-003 [결함·P0]** — AI 비서 **도구 권한 게이트가 JWT role**을 신뢰 → 운영자가 elevate 후 super_admin 전용 도구(재무·차단·발송)를 AI 비서로 우회 실행.

### 점검했으나 정상인 핵심 시나리오 (안심 목록)
- **운영자 승급/강등/정보수정**(`admin-operators` POST/PATCH/DELETE)은 **DB role**(`ctx.member.role==='super_admin'`)로 판정 → elevate 우회 불가. R41 "P0-2 fix"가 정상 작동(자기강등·마지막 super_admin 방어 포함).
- **근태 관리 어드민 17개**(`admin-att-*`)는 전부 **DB role** super_admin 게이트 → elevate 우회 불가(강한 방어). 단 이 강한 게이트가 OP-019 갭의 원인.
- **지출 승인**(`admin-expense-approve`)·**재정 환불**(`admin-expense-refund`·`admin-revenue-refund`)은 `requireRole`/`canAccess`를 **DB role**로 사용 → 안전. (수입 승인 OP-004와 대조 — 같은 결재인데 비대칭.)
- **본인 급여 명세**(`payroll-my`)·**재택 보고서 초안**(`att-ai-draft`)은 호출자 uid로 고정 → 타인 데이터 노출 없음.
- **워크스페이스 작업 쓰기**(subtask-create·checklist·comments·reports의 POST/PATCH)는 Q3-004 `canEdit`/`canView` 검증 적용 → 읽기 경로(OP-033·034·035)만 누락.

> **표기**: 〔결함/갭·P등급〕 · `escalation`=운영자가 상위 전용에 도달 · `boundary`=운영자 직무 범위 설계 결정 필요(애매) · 확신도 확실/추정.

---

# 결함·갭 목록

## A. 권한 상승(escalation) — JWT role 신뢰 체인 〔최우선〕

> 운영자는 DB상 `type='admin', role='operator'`로 저장된다(`admin-operators` 승급 시). `requireAdmin`은 `type==='admin'`만 보고 role을 무시하므로 운영자는 모든 requireAdmin 단독 게이트를 통과한다. 그 위에 super_admin/admin을 가르는 게이트가 **DB role(`ctx.member.role`)을 보면 안전**, **JWT role(`ctx.admin.role`)을 보면 OP-001 때문에 우회 가능**하다.

### [OP-001] elevate가 운영자에게 super_admin JWT를 발급 (근본 원인) 〔결함·P0·escalation〕
- **역할/시나리오**: 운영자가 "관리자 모드 진입"(cms-tbfa의 elevate)을 누르면 관리자 토큰을 받는데, 그 토큰의 권한 등급이 본인 실제 등급(operator)이 아니라 **최고 등급(super_admin)**으로 찍혀 나온다.
- **위치**: `netlify/functions/auth-admin-elevate.ts:42,51`
- **증상**: type=admin인 사람은 누구든(운영자 포함) 관리자 모드 진입만 하면 토큰상 슈퍼관리자가 된다. JWT 등급을 신뢰하는 모든 화면·도구가 이 사람을 슈퍼관리자로 대접한다.
- **근거**: `const isAdmin = user.type === "admin";`(42) → `role: isAdmin ? "super_admin" : "operator"`(51). 운영자는 type='admin'이라 super_admin JWT를 받음. 정상 로그인(`admin-login.ts:123`)은 `role: user.role ?? "operator"`로 실제 DB role을 넣는데, elevate 경로만 type 기반으로 super_admin을 부여.
- **권장 수정**: elevate도 `role: members.role`(DB 실제값)으로 발급. type만으로 super_admin을 주지 말 것. **이 한 줄 수정이 OP-002~006의 근본 차단.** (메인 R45-S 확정 P0와 동일 근원 — operator 영역 종착점이 아래 항목들.)
- **확신도**: 확실

### [OP-002] 권한정책 변경이 JWT role을 신뢰 → 운영자 자가부여 〔결함·P0·escalation〕
- **역할/시나리오**: 운영자가 elevate 후 권한정책 화면에서 임의 기능의 "운영자 허용"을 켠다. 그 순간 후원확정·재정환불·AI설정 등 운영자를 막던 모든 세분 게이트가 본인에게 열린다.
- **위치**: `netlify/functions/admin-role-permissions.ts:27-28` · 체인 `auth-admin-elevate.ts:51` · 영향 `lib/role-permission-check.ts:30,33-36`
- **증상**: 권한 정책은 슈퍼관리자만 바꿔야 하는데, 운영자가 우회 토큰으로 자기 권한을 스스로 확장한다.
- **근거**: `const admin = (auth as any).ctx?.admin;`(27, JWT payload) → `if (admin?.role !== "super_admin") return forbidden(...)`(28) → `rolePermissions.update({adminAllowed/operatorAllowed})`(41-45). `role-permission-check.ts:30` `role==='super_admin' return true`로 자가부여 즉시 효력(48 `invalidatePermissionCache`로 5분 캐시도 즉시 초기화).
- **권장 수정**: 28행을 `requireRole(auth.ctx.member, "super_admin")`(DB role)로 교체. OP-001과 함께 적용.
- **확신도**: 확실

### [OP-003] AI 비서 도구 권한 게이트가 JWT role을 신뢰 〔결함·P0·escalation〕
- **역할/시나리오**: 운영자가 elevate 후 AI 비서에 "캠페인 N번 종료", "회원 N번 차단", "필터 이메일 발송" 같은 변경 명령을 내리면, 슈퍼관리자 전용으로 막아야 할 도구가 그대로 실행된다.
- **위치**: `netlify/functions/admin-ai-agent.ts:659,835` · `admin-ai-agent-stream.ts:70` · `lib/ai-agent-config.ts:329,342-351`
- **증상**: AI 비서를 통해 우회 실행. 직접 호출하면 막힐 슈퍼관리자 전용 작업을 AI 도구로 수행.
- **근거**: `adminRole = (auth as any).ctx?.admin?.role`(659, JWT) → `checkToolAllowed(toolName, adminRole)`(835) → `ai-agent-config.ts:348-351` RANK super_admin=3 비교. 변경 도구 대다수(`tool_membersBlock:1976`, `tool_emailSend:1584` 등)에는 DB-role 백스톱 `ensureRole`이 없음 — `ensureRole(['super_admin'])`는 재무 6곳뿐(`lib/ai-agent-tools.ts`).
- **권장 수정**: 두 핸들러에서 `checkToolAllowed`에 넘기는 역할을 `ctx.member.role`(DB)로 교체. 또는 변경 도구 본문에 `ensureRole` DB-role 백스톱 일괄 추가.
- **확신도**: 확실

### [OP-004] 수입 승인·반려가 JWT role을 신뢰 〔결함·P1·escalation〕
- **역할/시나리오**: 운영자가 elevate 후 기타수입 draft를 승인/반려한다. 같은 결재인 **지출**은 DB role로 막히는데 **수입**만 뚫리는 비대칭.
- **위치**: `netlify/functions/admin-revenue-approve.ts:13-19` (대조 `admin-expense-approve.ts:17`)
- **증상**: 재무 결재(수입 승인)를 슈퍼관리자 전용으로 의도했으나 운영자가 우회.
- **근거**: `if (auth.ctx.admin.role !== "super_admin")`(17, JWT) → `status approved/rejected` update(63-76). 대조 `admin-expense-approve.ts:17` `requireRole(auth.ctx.member, "super_admin")`(DB role, 안전).
- **권장 수정**: 17행을 `requireRole(auth.ctx.member, "super_admin")`로 교체(지출 승인과 정합). `approvedBy`는 `ctx.member.id` 사용.
- **확신도**: 확실

### [OP-005] 수입·지출 항목 수정이 JWT role을 신뢰 → '등록자 본인' 제한 우회 〔결함·P1·escalation〕
- **역할/시나리오**: 수입/지출 draft는 "슈퍼관리자 또는 등록자 본인"만 수정해야 하는데, 운영자가 elevate하면 본인이 등록하지 않은 타인의 전표도 수정한다.
- **위치**: `netlify/functions/admin-expense-update.ts:55-58` · `admin-revenue-update.ts:54-57` · `admin-expense-category-update.ts:17`
- **증상**: 등록자 본인 제한이 무력화돼 운영자가 남의 재무 전표를 임의 수정. 계정과목 수정(super_admin 전용)도 운영자가 변경.
- **근거**: `const adminRole = auth.ctx.admin.role;`(expense-update:55, JWT) → `if (adminRole !== "super_admin" && exp.recordedBy !== adminUid)`(57) — elevate 시 첫 조건이 false라 OR 단락으로 통과. revenue-update:54-56 동일. category-update:17 `auth.ctx.admin.role !== "super_admin"`(JWT).
- **권장 수정**: 세 함수 모두 `auth.ctx.admin.role` → `auth.ctx.member.role`(DB). recordedBy 비교 uid도 `ctx.member.id`로 통일.
- **확신도**: 확실

### [OP-006] 후원 통과처리 canAccess가 JWT role을 신뢰 〔결함·P2·escalation〕
- **역할/시나리오**: 슈퍼관리자가 "후원 통과처리"를 운영자 비허용으로 정책을 꺼도, 운영자가 elevate하면 정책 토글이 먹지 않고 계속 처리한다.
- **위치**: `netlify/functions/admin-donation-confirm.ts:306,310`
- **증상**: 권한 정책 토글이 설계대로 작동하지 않음. (현재 시드 기본값이 operator 허용이라 즉시 피해는 없으나 통제 불가.)
- **근거**: `const { admin, member: adminMember } = (auth as any).ctx;`(306, DB role 있는데) → `canAccess(admin.role ?? "", "donation_confirm")`(310, JWT 사용). 대조 `admin-expense-refund.ts:20`·`admin-revenue-refund.ts`는 `canAccess(auth.ctx.member.role, ...)`(DB, 안전).
- **권장 수정**: 310행 인자를 `adminMember.role`(DB)로 교체. `canAccess` 호출 전반에서 JWT role 인자 사용 일괄 점검.
- **확신도**: 확실

---

## B. 익명성·민감정보 노출 〔최우선〕

### [OP-007] 익명 SIREN 신고 목록·상세에서 제보자 실명이 마스킹 없이 노출 〔결함·P0〕
- **역할/시나리오**: 운영자가 사건·괴롭힘·법률 신고를 검토하려고 목록/상세를 여는 순간, 익명 제보자가 폼에 적은 이름이 그대로 보인다. 신원 식별(감사기록 남김) 버튼을 누르지 않아도 신원이 드러난다.
- **위치**: 목록 `admin-incident-reports.ts:58,81` · `admin-harassment-reports.ts:55,76` / 상세 `admin-incident-report-detail.ts:80,83-85` · `admin-harassment-report-detail.ts:74-77` · `admin-legal-consultation-detail.ts:73-77`
- **증상**: 익명 신고의 신원 보호가 무력화됨. 운영자가 신원 식별 전용 흐름을 거치지 않고도 제보자 실명을 본다.
- **근거**: 목록 — `reporterName: incidentReports.reporterName`(58) SELECT, `maskedList = list.map(r => r.isAnonymous ? {...r, memberName:null} : r)`(81) — **memberName만 null, reporterName은 그대로**. 상세 — `report:{ ...r, ...}`(80)에서 incidentReports 전체 행 spread → `reporterName/Phone/Email`(schema.ts:833-835) 포함, 마스킹(83-85)은 join된 `memberName/Email/Phone`만 처리. 대조 `admin-anonymous-reveal.ts:138-140`은 이 reporter* 필드를 `revealLevel>=2`일 때만 감사기록 후 노출.
- **정정(verifier)**: `admin-legal-consultations.ts`(목록)는 reporterName을 SELECT하지 않아 목록 누출 없음 — 법률 도메인 누출은 **상세**(legal-consultation-detail)에서 발생.
- **권장 수정**: 목록 마스킹 라인에 `reporterName` null 처리 추가. 상세는 `...r` 무차별 spread 중단, `isAnonymous`일 때 `reporterName/Phone/Email` 명시 제거. 3개 신고 도메인 동일 패치. 신원은 오직 `admin-anonymous-reveal` 감사 흐름으로만.
- **확신도**: 확실

### [OP-008] 익명 신고 실명 전환을 운영자 단독 실행 + super_admin 통지 부재 〔갭·P0·escalation〕
- **역할/시나리오**: 운영자가 신원 식별 API를 호출해 익명 제보자(내부고발자·피해자)의 이름·이메일·전화를 단계적으로 끌어낸다. 막는 게이트가 없고, super_admin 승인도 필요 없으며, 누가 신원을 깠다는 경보도 가지 않는다.
- **위치**: `netlify/functions/admin-anonymous-reveal.ts:35-37` (requireAdmin 단독) · 알림 부재(파일 내 notify/alert/securityAlert 0건)
- **증상**: 내부고발자 보호의 최후 통제선을 일반 운영자가 혼자 누를 수 있고, 그 사실이 상급자에게 통지되지 않는다.
- **근거**: `requireAdmin(req)`(35) + `guardFailed`(36)만 — role 미검사로 운영자 통과. 감사기록은 `anonymousRevealLogs` INSERT(110-117)로 남지만 super_admin 통지 코드 0건. 로그 조회 `admin-anonymous-reveal-logs.ts:25-26`도 requireAdmin 단독 → 운영자가 누가 신원을 깠는지까지 열람. 대조: `admin-voucher-approve.ts:26`은 민감 작업에 DB role super_admin 게이트.
- **권장 수정**: `requireRole(ctx.member,'super_admin')` 또는 `canAccess('anonymous_reveal')`(DB role) 쓰기 게이트 추가. 실명 전환 시 `admin-security-alert`로 super_admin 즉시 통지(누가·어느 신고·사유). reveal-logs 조회도 super_admin 한정 검토.
- **확신도**: 확실

### [OP-009] AI 비서 대화 이력 목록이 호출자로 필터되지 않음 (IDOR·PII) 〔결함·P1〕
- **역할/시나리오**: 운영자가 AI 대화 이력 화면을 열면 본인 대화뿐 아니라 모든 관리자(슈퍼·타 운영자)의 대화 제목·검색 결과가 보이고, q 검색으로 대화 본문(회원 PII·후원·재정·순직 도구 결과)까지 텍스트 검색된다.
- **위치**: `netlify/functions/admin-ai-conversations-list.ts:25,35-44`
- **증상**: 상급자가 AI에게 한 질의(회원 PII·재무·인사)가 운영자에게 노출. 헤더 주석이 약속한 '본인+super_admin만' 범위가 코드에 없음.
- **근거**: `requireAdmin(req)`(25) 후 `adminFilter`는 선택 쿼리값일 뿐 강제 아님(36). 미지정 시 where 빈 절 → 전체 대화 SELECT(47-56). `c.messages::text ILIKE`(40)로 남의 대화 본문 검색.
- **권장 수정**: `ctx.member.role`(DB)로 super_admin 아니면 `admin_id = 본인 uid` 강제, adminFilter 무시. 상세에도 동일.
- **확신도**: 확실

### [OP-010] AI 대화 상세가 소유자 검사 없음 (IDOR) 〔결함·P1〕
- **역할/시나리오**: 운영자가 대화 상세 API의 id를 1,2,3…으로 바꾸면 남의 AI 대화 전문과 그 안에서 실행된 도구의 입력·결과(회원·후원·재정 질의 결과)를 그대로 받는다.
- **위치**: `netlify/functions/admin-ai-conversation-detail.ts:28-33,38-44`
- **증상**: 대화 번호만 증가시키며 호출하면 남의 AI 대화 전체와 도구 입출력이 노출.
- **근거**: `WHERE c.id = ${id} LIMIT 1`(28-33) — admin_id 조건 없음. `ai_agent_logs`도 conversation_id로만 조회(38-43). 대조 `admin-ai-agent.ts:548`은 대화 로드 시 `AND admin_id = ${adminId}`로 막음.
- **정정(verifier)**: 로그 SELECT 컬럼에 `rollback_data`는 미포함(id·tool_name·input_args·output·status·duration_ms·error만). `input_args+output`(회원·후원·재정 PII)만으로 IDOR 성립.
- **권장 수정**: `WHERE c.id=${id} AND (c.admin_id=본인 OR super_admin)` 소유자 게이트 추가.
- **확신도**: 확실

---

## C. 운영자 권한 경계 — requireAdmin 단독 노출 (대부분 boundary, 설계 결정 필요)

### [OP-011] 운영자가 빌링키·은행거래·효성·재무제표 전체 열람 〔갭·P2·boundary〕
- **역할/시나리오**: 운영자가 재무 화면에서 재무상태표·현금흐름·손익, 은행 거래내역, 효성 CMS 자료, 회원별 **빌링키(정기결제 토큰)**까지 모두 조회한다.
- **위치**: `admin-billing-keys.ts:17,62-63` · `admin-finance-balance-sheet/cashflow/pl-summary/income-summary.ts` · `admin-bank-transactions-list.ts:29` · `admin-hyosung.ts:45` (모두 requireAdmin 단독)
- **증상**: 운영자가 봐선 안 될 결제 자격증명·전사 재무를 본다. 빌링키 평문 토큰 노출은 정기결제 오남용 위험.
- **근거**: `billingKey: billingKeys.billingKey`(62, PG 평문 토큰), `customerKey`(63) 반환(카드번호는 마스킹되나 billingKey는 평문). 재무·은행·효성 함수 모두 role 게이트 없음.
- **권장 수정**: 빌링키 조회는 평문 토큰을 응답에서 제외하거나 super_admin 한정. 전사 재무·은행·효성 열람은 `canAccess('finance_view')` 정책으로 운영자 노출 토글화.
- **확신도**: 확실

### [OP-012] 회계 전표·계정과목 생성/수정·은행 임포트에 게이트 부재 〔갭·P2·boundary〕
- **역할/시나리오**: 운영자가 회계 전표 생성·수정, 계정과목 생성·수정, 은행거래 임포트·배치전표 생성을 제한 없이 수행한다. 전표 '승인'만 super_admin이고 그 앞단(생성·임포트)은 무방비.
- **위치**: `admin-account-code-create.ts:24` · `admin-voucher-create.ts` · `admin-bank-batch-voucher.ts` · `admin-bank-import.ts` (finer 게이트 0건)
- **증상**: 운영자가 장부 기초데이터(계정과목·전표·은행거래)를 만들고 수정 → 회계 정합성 통제가 승인 단계에만 있어 입력단 오염 여지.
- **근거**: 각 파일 role/canAccess/super_admin grep 0건(requireAdmin 단독). 대조 `admin-voucher-approve.ts:26` `auth.ctx.member.role !== "super_admin"`(DB)로 승인만 통제.
- **권장 수정**: 회계 기초데이터 쓰기에 `canAccess('finance_bookkeeping')` 또는 `requireRole(ctx.member,'admin')` 게이트. 계정과목은 보고서 분류 체계라 super_admin 검토 권장(정책 결정 필요).
- **확신도**: 추정

### [OP-013] 운영자가 전체 회원 디렉터리 PII를 검색·열람 〔갭·P2·boundary〕
- **역할/시나리오**: 운영자가 운영자 관리 화면의 "후보 검색"으로 admin이 아닌 전 회원을 이름·이메일로 검색하고 전화번호까지 받아본다. 회원 목록·상세·내보내기도 운영자에게 열려 있다.
- **위치**: `admin-operators.ts:51,67-98`(candidates) · `admin-members.ts:170` · `admin-member-detail.ts:19` · `admin-members-export.ts:60` · `admin-members-search.ts:33`
- **증상**: 운영자가 운영 직무 이상으로 전 회원 PII와 명단 내보내기에 접근. (변경 작업=승급/강등은 DB role로 방어됨.)
- **근거**: candidates 검색(67-98)은 `isSuperAdmin` 체크 없이 실행 → `id/name/email/phone` 반환(84-96). 회원 PII 함수군 전부 requireAdmin 단독.
- **권장 수정**: candidates·회원 내보내기를 super_admin 또는 `canAccess('member_directory_export')` 게이트. 목록/상세는 직무상 유지하되 phone·전체 export 노출을 super_admin 토글로.
- **확신도**: 추정

### [OP-014] 감사 로그 전체 열람·대량 발송·유족 자격 심사를 운영자가 수행 〔결함·P3·boundary〕
- **역할/시나리오**: 운영자가 전체 감사 로그를 열람하고, 회원 대상 대량 메일·SMS 발송 작업을 생성하며, 유족 지원 자격 심사(승인/반려)를 단독 결정한다.
- **위치**: `admin-audit-list.ts:25` · `admin-send-job-create.ts:36` · `admin-eligibility-review.ts:35` (모두 requireAdmin 단독)
- **증상**: 감사 추적 열람·대량 발송(비용·평판)·복지 자격 결정 같은 통제성 작업을 운영자가 상위 승인 없이 수행.
- **근거**: 세 함수 requireAdmin 단독, 이후 role 게이트 없음. (`admin-audit-list`는 super_admin 게이트가 있는 `admin-audit`와 다른 함수.)
- **권장 수정**: `audit_view`·`send_job`·`eligibility_review` featureKey로 운영자 허용 토글. 정책상 admin 한정이어야 하면 그렇게 시드.
- **확신도**: 확실

### [OP-015] AI 비용/사용 로그·기능 관리 화면이 운영자에게 전부 열림 〔결함·P2·boundary〕
- **역할/시나리오**: 운영자가 AI 비용 통계·사용 로그를 열면 협회 전체 AI 월 지출·일별 추이·관리자별 호출 비용까지 본다. 기능 토글·월한도도 변경 가능.
- **위치**: `admin-ai-cost-stats.ts:39` · `admin-ai-usage-logs.ts:32,58-63` · `admin-ai-features.ts:32,70` (requireAdmin 단독)
- **증상**: AI 운영비·관리자별 사용 내역(경영 데이터)을 일반 운영자가 조회·변경.
- **근거**: usage-logs `LEFT JOIN members ... m.name AS admin_name`(58-63)로 누가 얼마 썼는지 노출. `admin-ai-features.ts:70` handlePost(enabled·월한도 변경)도 canAccess 없음.
- **권장 수정**: `canAccess('ai_cost_view'/'ai_config')` 또는 `requireRole(super_admin)`(DB) 게이트. 최소한 features POST(설정 변경)는 super_admin 전용.
- **확신도**: 확실

### [OP-016] AI 도구 활성/비활성 토글이 운영자에게 열림 〔결함·P2·boundary〕
- **역할/시나리오**: 운영자가 `{toolName, enabled:false}`를 보내 AI 비서 도구(재정·발송 포함)를 임의로 끄거나 켤 수 있다. 협회 전체 AI 비서 동작에 영향.
- **위치**: `admin-ai-config.ts:24-25,90,111`
- **증상**: 시스템 프롬프트 변경·권한 변경만 보호되고 도구 enabled 토글은 무방비.
- **근거**: `systemPrompt` 변경엔 `canAccess('ai_config_prompt')`(60), `requiredRole` 변경엔 `requireRole(super_admin)`(106)이 있으나, enabled-only 경로(`if (typeof body.enabled === 'boolean') patch.enabled`(90) → `updateToolPermission`(111))는 역할 게이트 없이 requireAdmin만 거침.
- **권장 수정**: enabled 토글에도 `canAccess(ctx.member.role,'ai_config_prompt')` 또는 super_admin 게이트. AI 설정 전체 super_admin 전용 권장.
- **확신도**: 확실

### [OP-017] AI 비서 채팅에 역할 게이트(canAccess) 없음 〔갭·P1·boundary〕
- **역할/시나리오**: 운영자가 AI 비서에 "회원 N번 상세", "후원 내역", "지출 목록", "순직 사건 N번 상태"를 물으면 AI가 읽기 도구를 실행해 회원 연락처·후원자·재정·순직 데이터를 그대로 보여준다. AI 비서 진입 자체에 운영자/관리자 구분이 없다.
- **위치**: `netlify/functions/admin-ai-agent.ts:483-498` (requireAdmin + checkFeatureBeforeCall만, canAccess 미호출) · `admin-ai-agent-stream.ts` 동일
- **증상**: AI 비서는 기능 토글·비용 한도만 본다. "이 운영자가 AI 비서를 써도 되는가/어떤 도메인 읽기 도구까지 허용인가" 역할 게이트가 진입에 없음.
- **근거**: `checkFeatureBeforeCall(AGENT_FEATURE_KEY)`(488)는 enabled/월한도만 검사. `canAccess('ai_agent_chat')`·requireRole grep 0건. 읽기 도구는 required_role=NULL이라 checkToolAllowed도 통과 → `members_detail`/`donations_recent`/`expenses_list`/`martyrdom_case_status`까지 사용. PII는 주민·카드·계좌만 마스킹, 이름·연락처·후원이력은 노출.
- **권장 수정**: 진입부에 `canAccess(ctx.member.role,'ai_agent_chat')` 게이트(role_permissions 시드). 도메인 민감 읽기 도구는 도구별 required_role/ensureRole로 운영자 차단 여부 정책 확정. stream도 동일.
- **확신도**: 확실

### [OP-018] 수입 승인·반려에 감사 로그 부재 〔결함·P2〕
- **역할/시나리오**: 운영자(또는 누구든)가 수입을 승인/반려해도 감사 로그가 남지 않는다. 누가 언제 어떤 수입을 승인했는지 사후 추적 불가.
- **위치**: `netlify/functions/admin-revenue-approve.ts` (logAudit import·호출 0건)
- **증상**: 재무 결재가 감사 추적에서 누락. approvedBy 컬럼만 갱신.
- **근거**: import(1-4)에 logAudit 없음, update(64-69)는 status/approvedBy/approvedAt/updatedAt만. 대조 `admin-eligibility-review.ts:30`·`admin-billing-keys.ts:14`는 감사 로깅. (OP-004와 같은 함수의 다른 차원 — 중복 아님.)
- **권장 수정**: 승인/반려 후 `logAudit`(action='revenue_approve'/'revenue_reject', userId=ctx.member.id) 추가. 지출 승인 패턴과 정합.
- **확신도**: 확실

---

## D. 근태

### [OP-019] 운영자 근태 관리 전면 차단 — 중간 '근태 관리자' 권한 부재 〔갭·P1·boundary〕
- **역할/시나리오**: 팀을 관리하는 운영자가 직원의 휴가를 승인하거나 출퇴근 정정을 결재하거나 오늘 근태 현황을 보려 하지만, 모든 기능에서 '슈퍼관리자 전용' 403으로 막힌다. 근태를 실무로 관리할 권한이 운영자에게 전혀 없다.
- **위치**: `admin-att-records.ts:24` · `admin-att-leave-review.ts:25` · `admin-att-correction-review.ts:27` · `admin-att-record-edit.ts:63` · `admin-att-workmode-change-review.ts:34` 외 17개 전부 (`ctx.member.role !== "super_admin"`)
- **증상**: 근태 도메인 어드민 17개가 전부 슈퍼관리자에게만 열려 있어, 운영자는 휴가 승인·정정 결재·근무형태 결재·재택보고서 확인·현황 조회·기록 수정 어떤 것도 못 한다. 일상 결재가 super_admin 1인 병목.
- **근거**: 17개 파일 전부 동일 DB role super_admin 게이트(verifier가 1:1 매칭 확인). `role-permission-check`에 att_/attendance featureKey 0건 — 중간 권한 분기 없음.
- **권장 수정**: 중간 권한 계층 도입 — ① 휴가 승인·정정 결재·현황 조회 같은 일상 운영은 `canAccess(role,'att_manage')` 또는 `requireRole(member,'operator')`로 허용, ② 정책·마스터·기록 직접수정 같은 민감 작업만 super_admin 유지. **반드시 DB role/canAccess 기반(JWT role 신뢰 금지 — OP-001 우회 방지).**
- **확신도**: 확실

### [OP-020] 근태/재택 흐름분석(att-ai-insight)이 임의 직원 지정 가능 〔결함·P1·escalation〕
- **역할/시나리오**: 운영자가 본인 직속이 아닌 다른 직원의 회원번호를 넣어 AI 흐름파악을 호출하면, 그 직원의 재택근무 보고서 본문·근태 기록·작업까지 AI 분석 결과로 받아본다.
- **위치**: `netlify/functions/att-ai-insight.ts:23-33,44-57`
- **증상**: 근태 AI 흐름파악이 슈퍼관리자 제한 없이 운영자면 통과하고, 분석 대상 직원을 요청 본문으로 자유 지정 → 타인 근태·보고서 내용 노출.
- **근거**: `requireAdmin(req)`(23) — 다른 admin-att-* 17개와 달리 super_admin 게이트 없음. `const memberUid = body.memberUid ?? auth.ctx.member.id`(33) — 본인 검증 없이 임의 지정 → `attRemoteWorkReports.content`(44-57) 등 조회 후 AI 투입. 대조 `att-ai-draft.ts:32`는 본인 uid 고정(안전).
- **권장 수정**: 다른 admin-att-*와 동일하게 `ctx.member.role==='super_admin'` 게이트 추가하거나, 운영자 허용 시 본인/관할로 memberUid 범위 제한(`canAccess('att_insight_others')`).
- **확신도**: 확실

### [OP-021] 근태 관리 화면 운영자 진입 후 모든 패널 403으로 깨짐 〔결함·P2·boundary〕
- **역할/시나리오**: 운영자가 알림 링크나 메뉴로 근태관리 화면에 진입하면 화면 골격은 그려지는데, 현황·휴가결재·정정결재·재택보고서 등 모든 탭이 데이터를 못 불러와 빈 화면·에러만 보인다.
- **위치**: `public/js/admin-workspace-management.js:119-129` (checkAuth)
- **증상**: 페이지 인증이 어드민 여부(`/api/admin/me`)만 보고 super_admin 여부를 검사하지 않아, 운영자도 입장하지만 내부 API가 전부 403.
- **근거**: checkAuth는 401/403/!ok만 리다이렉트(119-129), admin.role 미검사. 운영자는 `/api/admin/me`(requireAdmin) 통과 → 진입 → `loadRecords()`의 `/api/admin-att-records`(146)가 super_admin 403.
- **권장 수정**: 페이지 가드에서 role 확인 후 super_admin 아니면 진입 차단·안내, 또는 OP-019대로 운영자 권한을 실제로 열어 패널 동작.
- **확신도**: 확실

### [OP-022] 근태 CSV 내보내기가 운영자에게 타인 전체 export 허용 (IDOR) 〔결함·P2·escalation〕
- **역할/시나리오**: 운영자가 다른 직원의 회원번호로 근태 CSV export를 호출하면 그 직원의 한 달치 출퇴근·근무시간·메모 CSV를 그대로 내려받는다 — 정작 현황 목록 화면은 super_admin 전용이라 권한이 어긋난다.
- **위치**: `netlify/functions/att-export.ts:77-87` (가드 `requireOperator` 51)
- **증상**: 타인 데이터는 super_admin·admin만 허용하도록 했는데, 운영자가 DB상 type='admin'이라 통과해 임의 직원 근태 CSV를 받는다.
- **근거**: `if (targetMemberId !== auth.ctx.member.id) { const isSuper=role==='super_admin'; const isAdmin=type==='admin'; if(!isSuper && !isAdmin) 403 }`(77-87) — 운영자는 type='admin'이라 isAdmin=true 통과. 같은 데이터 조회 `admin-att-records.ts:24`는 super_admin 전용(권한 불일치).
- **정정(verifier)**: 가드는 requireAdmin이 아니라 `requireOperator`(51) — 결과는 동일(operator도 type/operatorActive로 통과).
- **권장 수정**: 타인 export 허용 기준을 `type==='admin'`이 아니라 현황 화면과 동일(super_admin 또는 OP-019의 att_manage)로 통일.
- **확신도**: 확실

### [OP-023] 주소 지오코딩 API가 운영자에게 열려 사용처와 권한 불일치 〔결함·P3·boundary〕
- **역할/시나리오**: 근무지 등록 시 주소→좌표 변환을 쓰는데, 정작 근무지 관리 화면은 super_admin 전용이라 운영자는 지오코딩만 호출하고 거점을 저장하지는 못한다.
- **위치**: `netlify/functions/att-geocode.ts:19-24`
- **증상**: 지오코딩은 운영자면 통과하는데 사용처(근무지 관리)는 super_admin 전용 → 경계 어긋남 + 외부 카카오 API 비용을 운영자가 임의 트리거.
- **근거**: `requireAdmin(req)`(19) — super_admin 검사 없음. `KAKAO_REST_API_KEY` 외부 호출(24). 거점 저장 `admin-att-workplaces.ts:25`는 super_admin 전용.
- **권장 수정**: 지오코딩 가드를 사용처 권한(super_admin 또는 att_manage)과 일치. 외부 API 호출 빈도 제한 고려.
- **확신도**: 확실(verifier 상향)

### [OP-024] 정정 요청 결재 알림 수신자가 휴가 알림과 불일치 〔갭·P3〕
- **역할/시나리오**: 직원이 출퇴근 정정 요청을 올리면 super_admin에게만 알림이 가는 반면, 휴가 신청은 운영자 전체에게 간다. 같은 결재 대기인데 수신 범위가 제각각.
- **위치**: `att-correction-request.ts:82-89` (super_admin 한정) vs `att-leave-request.ts:276` (`notifyAllOperators`)
- **증상**: 동일 '결재 대기' 워크플로우인데 알림 수신자 정책 불일치. 게다가 결재 권한은 둘 다 super_admin뿐(OP-019)이라 운영자 알림은 행동으로 이어지지 못함.
- **근거**: 정정은 `.where(and(role='super_admin', operatorActive=true, ...))`(84-89) broadcast, 휴가는 `notifyAllOperators`(276, super_admin+operator 전원).
- **권장 수정**: 정정·휴가·근무형태 결재 알림 수신 대상을 '실제 결재 권한 보유자'로 통일(OP-019 권한 계층과 묶어 정의).
- **확신도**: 확실

> 참고(안심): 근태 어드민 17개가 JWT가 아닌 **DB role**로 super_admin을 판정 → OP-001 elevate 체인에 연결되지 않음(올바른 방어). OP-019 해소 시에도 반드시 DB role/canAccess 기반으로 구현할 것.

---

## E. 성과·급여

### [OP-025] 운영자가 동료의 매출 실적을 검증·반려 가능 〔결함·P1·escalation·boundary〕
- **역할/시나리오**: 마일스톤 역할(예: SM)을 배정받은 운영자가 매출 검증 화면에서 같은 역할의 다른 직원이 입력한 매출을 본인이 검증(VERIFIED)·반려한다 → 그 직원의 분기 변동급(인센티브) 산정에 직접 영향.
- **위치**: `netlify/functions/admin-milestone-revenue.ts:67-72`(verify), `:105`(reject)
- **증상**: 매출은 '담당 어드민(PM)'이 4-eye로 검증해야 하는데, 검증 게이트가 '역할 일치'만 보고 '검증자가 정식 어드민인지'는 보지 않아 운영자도 통과.
- **근거**: verify `if (entry.target_milestone_role !== admin.milestoneRole && admin.role !== "super_admin") return 403`(67) — role 검사 없어 operator 통과. 셀프검증만 `entered_by === admin.id`(71) 차단. 설계상 검증요청 알림은 `WHERE role='admin'`(110)인 어드민을 담당자로 지정하는데 verify는 강제 안 함. `admin-milestone-role-assign.ts:65`가 operatorActive 회원에게 milestoneRole 부여 → 검증권 획득 경로 실재.
- **권장 수정**: verify/reject에 `admin.role === 'super_admin' || admin.role === 'admin'`(또는 responsible_admin_id 일치) 조건 추가. milestone_role만 같은 operator는 검증 불가. (DB role 기반.)
- **확신도**: 확실

### [OP-026] 역할 캡 로드 실패 시 fail-open으로 인센티브 과지급 위험 〔결함·P2〕
- **역할/시나리오**: 운영자가 본인 결산을 계산/제출할 때 역할별 인센티브 상한을 DB에서 읽다 일시 오류가 나면, 상한이 무시(무캡)되고 초과 금액이 그대로 결산에 반영된다.
- **위치**: `netlify/functions/milestone-settlement.ts:251-253` (calcSettlement catch) · 화면 `milestone-dashboard.ts:179` 동일
- **증상**: 캡 조회 실패 시 상한 미적용 → 초과 변동급이 결산 제출액으로 굳어질 수 있음.
- **근거**: `} catch { /* DB 오류 시 무캡으로 계속 (fail-open) */ }`(251-253) — revenueCap/nonRevenueCap이 null 유지 → `if (revenueCap != null)`(258-259) 미적용 = 무캡 → totalBonus 반영(263). 일시 오류와 '캡 미설정(null)'을 구분 안 함.
- **권장 수정**: 결산 제출 시점에는 캡 로드 성공을 필수(fail-closed)로. 일시 조회 실패와 미설정(null)을 구분.
- **확신도**: 확실(verifier가 추정→확인)

### [OP-027] 급여 발송 메일 문구와 첨부 명세서 내용 불일치 〔결함·P2〕
- **역할/시나리오**: 슈퍼관리자가 급여 명세를 일괄 발송하면 본문은 '세전 금액 기준, 공제는 외부 회계 반영'이라 안내하지만, 첨부 PDF·명세서엔 4대보험·소득세·실수령액이 이미 다 계산돼 있어 받는 직원이 혼란.
- **위치**: `admin-payroll-send.ts:60-61`(본문) vs `lib/payroll-calc.ts:218-223`(공제·실수령 계산)
- **증상**: 본문↔첨부 모순(본문은 '세전 only', 명세는 공제·net_pay 포함).
- **근거**: 본문 "※ 본 명세서는 세전 금액 기준이며, 소득세·4대보험 공제는 외부 회계 처리에서 반영됩니다." 그러나 `computeDeductions`가 국민연금·건강·장기요양·고용·소득·지방세 산출 후 netPay 저장(219-223), `payroll-my.ts:63-71`·`admin-payroll-export.ts:91`도 공제·실수령 노출.
- **권장 수정**: 본문을 현재 명세 구성(공제·실수령 포함)에 맞게 수정하거나, 외부 처리 정책이면 명세·PDF·CSV에서 공제·net_pay 제거 — 둘 중 하나로 일원화.
- **확신도**: 확실

### [OP-028] 운영자 급여 명세·결산 이의제기/문의 채널 부재 〔갭·P2〕
- **역할/시나리오**: 운영자가 본인 급여 명세·분기 결산이 이상해(야근수당 누락·공제 과다) 정정을 요청하고 싶지만, 시스템에 이의제기·문의 경로가 없어 외부 채널로 가야 한다.
- **위치**: 해당 화면·API 없음 (`payroll-my.ts`/`payroll-my-pdf.ts`/`milestone-dashboard.ts`에 이의제기 경로 없음)
- **증상**: 본인 명세는 보기·PDF만, 결산은 조회·제출·재제출만. 명세 오류를 시스템 내에서 접수할 방법이 없음.
- **근거**: objection|이의제기|명세.*문의 grep 0건. `payroll-my.ts`는 GET 단독(SENT/PAID만), admin-payroll PATCH는 super_admin 전용. 양방향 채널 부재(결산은 reject/HOLD 알림+재제출은 있으나 급여 명세엔 없음).
- **권장 수정**: 본인 명세 상세에 '문의/이의제기' 액션 + 접수 → super_admin 알림 → admin-payroll reviewNote 회신. 최소한 '명세 문의' 알림 1건 경로.
- **확신도**: 확실

### [OP-029] 비매출 성과 검증에 4-eye 부재 (super_admin 1인 단독) 〔갭·P3·boundary〕
- **역할/시나리오**: 비매출 성과 검증 흐름에서 매출 쪽에 있는 '본인 입력 셀프검증 금지' 같은 견제 없이 슈퍼관리자 1인이 review→verify를 모두 단독 처리한다.
- **위치**: `admin-milestone-nonrevenue.ts:14,60,92`
- **증상**: 비매출은 super_admin만 가능하고 reviewer≠verifier 분리가 없어 동일인이 REVIEWED→VERIFIED 연속 처리 → 2단계 UX가 통제로 기능 못 함.
- **근거**: `if (!isSuperAdmin) return 403`(14) 후 review(60)·verify(92) 모두 동일 super_admin 가능, reviewer≠verifier 검증 없음. 대조: 매출은 `entered_by===admin.id` 셀프검증 차단(revenue:71) 존재.
- **권장 수정**: 비매출도 `reviewed_by != 현재 admin.id` 4-eye 적용하거나, 단일 운영이 정책이면 2단계 UX를 1단계로 단순화.
- **확신도**: 확실(verifier 확인)

### [OP-030] 급여 명세 일람 페이지네이션 부재 〔결함·P3〕
- **역할/시나리오**: 슈퍼관리자가 특정 월 급여 일람을 조회할 때 직원 수가 많아도 전체를 한 번에 반환(limit 없음) → 향후 응답 비대·일부 누락 가능.
- **위치**: `netlify/functions/admin-payroll.ts:115-118`
- **증상**: 월별 명세 일람이 limit 없이 전건 반환. CLAUDE.md §6.3 '페이지네이션 limit 명시' 위반.
- **근거**: `db.select().from(payrollSlips).where(...).orderBy(desc(grossPay))` — LIMIT 없음(대조: 상세 audit는 .limit(100)).
- **권장 수정**: 월별 일람에 안전 상한(LIMIT) + 필요 시 offset 추가.
- **확신도**: 확실

### [OP-031] 급여·결산 관리 알림 진입점(CMS 정본) 불일치 〔갭·P3〕
- **역할/시나리오**: 운영자/슈퍼관리자가 급여·결산 관리 알림을 누르면 한쪽은 `/cms-tbfa.html#payroll`, 다른 쪽은 `/admin#milestone-review`로 엇갈려, 통합 CMS 단일 진입(§6.18)으로 일원화됐는지 불명확.
- **위치**: `cron-payroll-monthly.ts:48`(`/cms-tbfa.html#payroll`) vs 마일스톤/결산 알림 다수(`/admin#milestone-review`·`/admin#settlement-my`)
- **증상**: 진입점 혼재. verifier 확인 결과 `admin.html`에는 `data-tab="milestone-review/settlement-my/payroll"`·`page-milestone-review`가 전무(grep 0건)이고 정본은 `cms-tbfa.html`(558·560) → 다수 `/admin#...` 마일스톤 알림이 탭 없는 페이지로 향함.
- **권장 수정**: 모든 급여·결산 알림 link를 통합 CMS 정본(`/cms-tbfa.html#...`)으로 통일. 해당 탭이 iframe 4곳 등록에 들어가 있는지 release_checklist #9로 확인.
- **확신도**: 확실(verifier가 방향 정정 — payroll 쪽이 정본)

### [OP-032] 분기 성과에 '운영자 PM(분기장) 1차 조정·승인' 중간 단계 부재 〔갭·P3·boundary〕
- **역할/시나리오**: '성과 관리자(분기장/PM)' 역할의 운영자가 팀원 성과를 1차 조정·승인해 상신하는 워크플로우가 없다. 최종 승인이 super_admin에 집중되고, 운영자 측엔 매출 검증(역할 일치 시)만 노출.
- **위치**: 해당 화면·API 없음 (PM 1차 승인 전용 엔드포인트 부재) · `admin-milestone-settlement.ts:77-83`(statusTransitions)
- **증상**: 조직에 PM 직책이 있어도 '1차 승인 후 상신' 단계가 없다. 검증권은 milestoneRole 일치만으로 부여(OP-025 원인).
- **근거**: quarter_leader|분기장|pm_approve grep 0건. statusTransitions는 super_admin이 SUBMITTED→APPROVED 직행, 중간 PM 상태 없음.
- **권장 수정**: PM/분기장 권한이 필요하면 별도 역할(role 또는 milestone_roles 권한 플래그)로 '1차 승인' 상태·전용 게이트 설계. milestoneRole 일치만으로 검증권 주면 OP-025 escalation 유발.
- **확신도**: 추정(설계 결정)

---

## F. 워크스페이스

### [OP-033] 서브태스크 목록 조회에 작업 접근 검증 없음 (IDOR) 〔결함·P1〕
- **역할/시나리오**: 운영자가 임의 parentId로 호출하면 자기와 무관한 다른 운영자 카드의 하위업무(제목·상태·담당자·마감·진행도)를 그대로 받는다.
- **위치**: `netlify/functions/admin-workspace-subtasks.ts:25-45`
- **증상**: 본인 카드 하위업무만 봐야 하는데 parentId만 바꾸면 전사 하위업무 명단 조회.
- **근거**: requireAdmin(25-26)만 통과 후 `where(eq(workspaceTasks.parentTaskId, parentId))`(43)로 전체 반환 — 부모 task를 meId와 대조하는 코드 없음. 대조 쓰기 형제(subtask-create:56-59 등)는 Q3-004 canEdit 검증 보유.
- **권장 수정**: parentId의 부모 task 조회 후 단건 GET과 동일 `canView`(super || memberId/assignedTo/assignedBy/completedBy===meId) 통과 시에만 반환.
- **확신도**: 확실

### [OP-034] 작업 보고서 조회에 접근 검증 없음 (IDOR·PII) 〔결함·P1〕
- **역할/시나리오**: 운영자가 임의 taskId/보고서 id로 호출하면 남의 완료/중간 보고서 전문(content)과 작성자 이름·이메일까지 받는다.
- **위치**: `netlify/functions/admin-workspace-task-reports.ts:54-79,81-108`
- **증상**: 본인 관련 보고서만 봐야 하는데 id만 바꾸면 전사 보고서 본문 + 작성자 PII 노출.
- **근거**: GET ?id·GET ?taskId 어디에도 접근 검증 없음. SELECT가 `authorName: members.name, authorEmail: members.email`(70-71,100-101) 조인. 대조 POST(132-134 canReport)·PATCH review(223-226 canReview)는 검증함.
- **권장 수정**: GET 진입부에서 보고서의 task 조회 후 canView 적용, 미통과 403.
- **확신도**: 확실

### [OP-035] 카드 첨부파일 목록 조회에 접근 검증 없음 (IDOR) 〔결함·P2〕
- **역할/시나리오**: 운영자가 임의 taskId로 호출하면 무관한 작업의 첨부 파일명·크기·확장자·소유자ID·첨부자 이름을 열람한다(다운로드는 별도 차단되나 메타는 노출).
- **위치**: `netlify/functions/admin-workspace-task-attachments.ts:40-68`
- **근거**: GET(40-68)은 taskId 유효성만 보고 attachments+files+members 조인 반환(`fileName·fileSize·fileOwnerId·attachedByName` 53-59). POST(83-85)·DELETE(149-153)는 canEdit/canRemove 검증.
- **권장 수정**: GET에서 task 접근 검증 후 목록 반환(POST/DELETE canEdit 재사용).
- **확신도**: 확실

### [OP-036] 파일 목록 가시성에 공유 만료 필터 누락 〔결함·P2〕
- **역할/시나리오**: 운영자가 파일함 목록을 볼 때, 과거 공유됐다가 만료된 파일이 목록에서 사라지지 않고 계속 노출된다(단건·다운로드는 만료 차단).
- **위치**: `netlify/functions/admin-workspace-files.ts:132-149` · `admin-workspace-folders.ts:151-162`(동일)
- **근거**: 목록 가시성 쿼리(134-142)는 `targetType='file' AND (sharedWith=meId OR sharedWith IS NULL)`만, expiresAt 조건 없음. 단건 GET(88-89)·`file-download.ts:49-50`엔 Q3-007 만료 가드 존재 — 목록 경로만 누락.
- **권장 수정**: 서브쿼리에 `(expiresAt IS NULL OR expiresAt > NOW())` 추가. folders 트리도 함께 보완.
- **확신도**: 확실

### [OP-037] 초대받지 않은 운영자도 임의 일정에 RSVP → 주최자 알림 스팸 〔갭·P2·boundary〕
- **역할/시나리오**: 운영자가 자신이 초대되지 않은 임의 eventId에도 RSVP를 보낼 수 있고, 그때마다 주최자에게 응답 알림이 발송된다.
- **위치**: `workspace-event-rsvp.ts:33-95` · `admin-workspace-events.ts:376-420`(action=rsvp)
- **근거**: eventId·status 유효성만 보고(33-36) upsert 후 주최자 알림(80-92) — attendees에 meId 포함 검증 없음. admin 경로(376-420)도 동일.
- **권장 수정**: RSVP 전 attendees(또는 super_admin) 포함 검증, 미초대 시 400/403, 최소한 주최자 알림 억제.
- **확신도**: 확실

### [OP-038] 카드/이벤트/파일 목록에 offset 페이지네이션 부재 〔갭·P2〕
- **역할/시나리오**: 카드·일정·파일이 상한(각 500)을 넘으면 '더 보기'가 없어 운영자가 오래된/하위 항목에 도달할 수 없다.
- **위치**: `admin-workspace-tasks.ts:373,453` · `admin-workspace-events.ts:190` · `admin-workspace-files.ts:73,159`
- **근거**: tasks는 `limit=min(limit||100,500)` 후 `total: enriched.length`(현재 페이지 수)만, offset 없음. events·files 동일. 대조 `notifications.ts`(Q3-019)는 offset+실제 total 보유.
- **권장 수정**: tasks/events/files에도 offset 파라미터 + 별도 COUNT total 추가.
- **확신도**: 확실 (verifier가 P3→P2 상향: 상한 초과 항목 영구 미도달은 핵심 목록 기능 단절)

### [OP-039] 카드 토스(인계) 시 워처에게 변경 알림 미발송 〔갭·P3〕
- **역할/시나리오**: 운영자가 자기 카드를 다른 운영자에게 인계하면, 그 카드를 관찰(워처) 등록한 사람은 담당자 변경을 통지받지 못한다.
- **위치**: `lib/workspace-sync.ts:380-406` (transferWorkspaceTask)
- **근거**: 받는 사람(381-391)·원담당자(394-406)에게만 알림. workspace_task_watchers 조회 없음. 대조 `cron-workspace-due-reminder.ts:51-57`은 워처 포함(일관성 부재).
- **권장 수정**: transfer 시 watchers 조회해 받는사람·원담당자·본인 제외 워처에게 인계 알림 추가.
- **확신도**: 추정

### [OP-040] 전체공개(sharedWith=NULL)+편집 공유 폴더에 모든 운영자 쓰기 가능 〔갭·P3·boundary〕
- **역할/시나리오**: 운영자가 폴더를 'sharedWith 미지정(전체)·permission=edit'으로 공유하면 의도와 무관하게 전사 모든 운영자가 그 폴더에 업로드·이동할 수 있다.
- **위치**: `admin-workspace-file-presign.ts:29-43` · `admin-workspace-files.ts:34-51`(checkFolderWriteAccess)
- **근거**: `(sharedWith=meId OR sharedWith IS NULL) AND permission='edit'`을 쓰기 허용 조건으로 사용 — IS NULL=전체공유라 edit 전체공유 1건이면 모두 쓰기. UI에서 '전체'와 '특정인' 권한 차이 고지 불명.
- **권장 수정**: 공유 생성 UI에서 '전체+편집'의 의미를 경고로 노출하거나, 쓰기 공유는 sharedWith 지정 강제.
- **확신도**: 추정

### [OP-041] 워크스페이스 cron 3종 외부 호출 게이트 부재 (현 안전·방어 권장) 〔갭·P3·boundary〕
- **역할/시나리오**: 운영자/외부가 휴지통 정리·마감 알림·리마인더 cron을 임의 강제 호출해 알림 폭주·조기 영구삭제를 유발할 수 있는지 점검 → 현재는 path 미설정이라 직접 호출 불가(실위험 낮음).
- **위치**: `cron-workspace-trash-cleanup.ts:164-166` · `cron-workspace-due-reminder.ts:163-166` · `cron-workspace-task-reminder.ts:96-98`
- **근거**: 세 cron 모두 `config = { schedule }`만, path 없음 → /api 라우팅 안 됨. INTERNAL_TRIGGER_SECRET/requireAdmin 인증도 없음. 멱등성은 양호(trash 30일 cutoff·due 24h 윈도·reminder firedAt 마킹). 향후 path 추가 시 무인증 노출 위험.
- **권장 수정**: 방어적으로 cron 진입부에 'path 호출 거부' 또는 INTERNAL_TRIGGER_SECRET 확인 추가.
- **확신도**: 확실

---

## G. Task·승인

### [OP-042] AI 재생성 API에 작업 소유권 검사 없음 (IDOR·비용·덮어쓰기) 〔결함·P1〕
- **역할/시나리오**: 운영자가 task id만 바꿔 호출하면 자기와 무관한 타인의 작업에도 AI 요약/리스크/완료보고서를 강제로 다시 만든다(외부 AI 비용 + 데이터 덮어쓰기).
- **위치**: `netlify/functions/admin-task-ai-regenerate.ts:14-43`
- **증상**: 서버가 소유자/담당자/지시자 여부를 확인하지 않고 실행. 단건 조회조차 막는 `admin-workspace-tasks`(canView 297-303)와 대조.
- **근거**: requireAdmin(17-18) 후 `id`만 받아 `generateTaskSummary(id)`/`calculateTaskRisk(id)`/`generateCompletionReport(id, meId)` 호출 — 소유권 비교 코드 없음. summary/risk는 task 컬럼 in-place UPDATE, completion은 보고서 INSERT.
- **권장 수정**: id로 task SELECT 후 `isSuperAdmin || task.memberId/assignedTo/assignedBy/completedBy === meId` 아니면 403.
- **확신도**: 확실

### [OP-043] 마감일 변경 승인 큐(운영자 승인/반려 화면)가 프런트에 없음 〔갭·P1〕
- **역할/시나리오**: 운영자(지시자)가 부하가 올린 마감일 변경 요청을 검토·승인/반려하려 하지만, 그 목록을 띄우고 승인할 화면이 프런트에 없다(백엔드는 완비).
- **위치**: 해당 화면 없음 (백엔드 `admin-task-due-changes.ts:100-143` list / `241-341` PATCH approve|reject 완비)
- **증상**: 백엔드는 list·승인/반려·지시자 알림(`/admin#due-change-{id}`)까지 갖췄으나 public 전체에 이 목록을 부르거나 승인 PATCH를 호출하는 JS가 없다(죽은 백엔드). 알림 링크 앵커 처리 코드도 없음.
- **근거**: `due-change|action=approve` grep → public *.js에서 호출 0건. `workspace-kanban.html:236`은 안내문구 한 줄뿐.
- **권장 수정**: 워크스페이스/싸이렌 어드민에 '마감일 변경 승인 대기' 목록 + 승인/반려 UI 추가, 종 알림 링크 라우팅. CLAUDE §6.18 위반 상태.
- **확신도**: 확실

### [OP-044] 마감일 변경 '요청 생성' 진입점이 프런트에 없음 〔갭·P1〕
- **역할/시나리오**: 지시받은 작업의 수행자(운영자)가 마감일을 못 맞춰 변경을 요청하려 하지만, 칸반에 '마감일 변경 요청' 버튼/폼이 없어 합법 경로가 없다.
- **위치**: 해당 화면 없음 (백엔드 `admin-task-due-changes.ts:151-236` POST 완비) · `admin-workspace-tasks.ts:355,940-941`
- **증상**: 지시받은 작업은 dueDate 직접 변경 차단(940-941), `canEditDueDate=memberId===meId && !assignedBy`(355)라 false → 반드시 요청 흐름을 타야 하는데 요청 폼이 없어 마감일 변경 워크플로우 전체가 작동 불능.
- **근거**: POST `/api/admin-task-due-changes` 호출 코드 public grep 0건.
- **권장 수정**: 칸반 상세에 지시받은 작업일 때 '마감일 변경 요청' 버튼+사유 폼 추가, POST 연결. OP-043과 한 세트.
- **확신도**: 확실

### [OP-045] 가입 승인 반려가 status='suspended'(=정지/블랙과 동일) 〔결함·P2〕
- **역할/시나리오**: 증빙 미비로 가입을 '반려'하면 회원 상태가 정지(suspended)가 되는데, 이는 악성 회원 제재(blacklist)와 같은 값이라 단순 미승인자가 제재받은 사람처럼 취급된다.
- **위치**: `netlify/functions/admin-pending-approvals.ts:307-319,361-375`
- **증상**: 미승인과 제재가 데이터상 구분 안 됨. 향후 '정지 회원' 집계·필터 오염. reset(361)이 진짜 제재 suspended까지 pending으로 되돌릴 여지(제재 무력화).
- **근거**: reject가 `status: "suspended"`(308). schema enum에 'rejected' 없음(pending|active|suspended|withdrawn), blacklist도 suspended 공유. reset(361-375)은 status==='suspended'만 보고 certificateRejectedReason/blacklistedAt 구분 없이 pending 복귀.
- **권장 수정**: 가입 반려 전용 상태('rejected') 추가 또는 certificateRejectedReason 유무로 구분. reset이 진짜 블랙 suspended를 되돌리지 않게 가드.
- **확신도**: 확실

### [OP-046] AI 완료보고서 초안 재생성이 중복 누적 〔갭·P2〕
- **역할/시나리오**: 운영자가 완료보고서 AI 초안 '재생성'을 여러 번 누르면 누를 때마다 새 pending 보고서가 쌓이고 이전 초안은 정리되지 않아, 검토자는 어느 게 최신인지 모른다.
- **위치**: `lib/ai-task.ts:258-269` · `admin-task-ai-regenerate.ts:37`
- **근거**: completion은 `workspaceTaskReports`에 type='completion', reviewStatus='pending' INSERT만 — 기존 pending 초안 대체/삭제 없음. 대조 summary는 task 컬럼 in-place UPDATE(73-76).
- **권장 수정**: 재생성 시 기존 pending AI completion 초안 대체(UPDATE) 또는 직전 초안 정리. 최소한 '이미 검토 대기 초안 있음' 안내.
- **확신도**: 확실

### [OP-047] AI 재생성 호출에 사용자/작업별 빈도 제한 없음 〔갭·P2〕
- **역할/시나리오**: 운영자가 재생성을 빠르게 반복 클릭하거나 스크립트로 호출하면 매번 외부 Gemini가 실행돼 월 AI 예산을 빠르게 소진시킬 수 있다.
- **위치**: `netlify/functions/admin-task-ai-regenerate.ts:30-43`
- **근거**: 호출부에 throttle/lastCalledAt 검사 없음. 비용 게이트는 `ai-feature.ts`의 기능별 월예산(208-217)·surge(비용 급증 기준, 142-180)뿐 — 성공 연타를 막지 못함.
- **권장 수정**: task별 짧은 쿨다운(동일 task+type 30~60초) 또는 운영자별 분당 상한(서버측).
- **확신도**: 추정

### [OP-048] AI 재생성 실패를 HTTP 200 + ok 래퍼로 반환 〔결함·P2〕
- **역할/시나리오**: 운영자가 재생성했는데 AI가 실패해도 서버가 200으로 내려, 화면 토스트가 성공/실패를 잘못 표시할 여지.
- **위치**: `netlify/functions/admin-task-ai-regenerate.ts:40-43`
- **근거**: `if (!result.ok) return ok({ok:false, error}, "AI 처리 실패")`(40-42) — 실패도 200. 프런트 `workspace-kanban.js:1952-1962`는 `res.data.data.X` 다중 fallback 없이 `inner.summary`만 봄 → 언랩 어긋나면 갱신 누락.
- **권장 수정**: 실패 시 502/500 + step/detail로 반환하거나, 프런트가 `res.data.data.summary || res.data.summary` 다중 fallback.
- **확신도**: 추정

### [OP-049] 마감일 변경 '취소·재요청' 경로 없음 〔갭·P2〕
- **역할/시나리오**: 수행자가 마감일 변경을 잘못 요청했을 때 스스로 취소하거나 다른 날짜로 다시 올릴 수 없어, 승인자가 처리할 때까지 갇힌다.
- **위치**: `netlify/functions/admin-task-due-changes.ts:174-185` (중복 차단), PATCH는 approve/reject만(248)
- **근거**: pending 존재 시 신규 거부(183-185), 요청자 본인 취소(cancel/withdraw) 분기 없음. schema status에 cancelled 없음(1727).
- **권장 수정**: 요청자 본인 pending 취소 액션 또는 재요청 시 기존 pending 대체. (OP-043·044 UI와 묶어 구현.)
- **확신도**: 확실

### [OP-050] AI 재생성에 finer 게이트(canAccess) 부재 〔갭·P3·boundary〕
- **역할/시나리오**: 비용 드는 AI 재생성을 운영자가 무조건 호출하는데, '운영자에게 허용할지'를 어드민이 토글할 수단이 없다.
- **위치**: `netlify/functions/admin-task-ai-regenerate.ts:17-28`
- **근거**: requireAdmin 단독, canAccess/requireRole 없음. type 화이트리스트(26-28)는 정상.
- **권장 수정**: `canAccess(role, 'task_ai_regenerate')` 게이트(OP-042 소유권 검사와 함께).
- **확신도**: 추정

### [OP-051] completion 보고서 작성자가 재생성 누른 운영자로 기록 〔결함·P3〕
- **역할/시나리오**: 운영자 A가 운영자 B의 작업에 완료보고서 재생성을 누르면 보고서 작성자가 B가 아니라 A로 기록돼 책임 주체가 뒤바뀐다.
- **위치**: `admin-task-ai-regenerate.ts:37` · `lib/ai-task.ts:258-262`
- **근거**: `generateCompletionReport(id, meId)` → `.values({ memberId: authorMemberId })` — 작성자=호출자. OP-042(소유권 검사 부재)와 결합 시 무관 운영자 명의 보고서 → 감사 추적 왜곡.
- **권장 수정**: 작성자는 task.memberId/assignedTo 기준 기록, 재생성 운영자는 별도 감사 로그. (OP-042 적용 시 자연 완화.)
- **확신도**: 확실

---

## H. AI 비서 (권한 외 결함·갭)

### [OP-052] 근태/성과 AI featureKey가 FEATURE_REGISTRY 미등록 (토글·예산 불가) 〔결함·P2〕
- **역할/시나리오**: 운영자/관리자가 비용 걱정으로 근태 AI(흐름파악·재택 초안)·성과 인사이트를 끄거나 월 예산을 걸려 하지만, 두/세 기능이 AI 기능 목록에 없어 제어할 수 없다.
- **위치**: `lib/ai-feature.ts:30-76`(FEATURE_REGISTRY) · 사용처 `att-ai-draft.ts:109`('att_remote_draft') · `att-ai-insight.ts:143`('att_ai_insight') · `ai-milestone-insight.ts:78`('milestone_insight')
- **증상**: 세 AI 호출이 카탈로그에 없어 기능별 토글·월 예산 화면에 안 보이고 끌 수 없다. 전역 월예산만 적용.
- **근거**: REGISTRY(30-76)에 세 키 부재. `ai-gemini.ts:252` 미등록 키는 경고만 하고 진행. `loadFeatureState`는 행 없으면 `enabled:true` 기본 → 토글 무력. `admin-ai-features.ts:82` handlePost는 `isKnownFeature` false면 거부 → 어드민이 켤 수도 없음.
- **권장 수정**: 세 키를 REGISTRY에 등록(시드 마이그 동반). 미등록 featureKey는 callGemini에서 fail-closed 차단 검토. §6.18 자립성.
- **확신도**: 확실

### [OP-053] AI 대화 삭제·정리 기능 부재 (PII 누적) 〔갭·P2〕
- **역할/시나리오**: AI 비서 대화에 회원 PII·후원·순직 민감정보가 누적되는데, CMS에서 삭제하거나 보존기간 정리할 화면·API가 없어 잘못 노출된 대화를 지우려면 개발자(DB 직접)가 필요하다.
- **위치**: 해당 화면·API 없음 (`admin-ai-conversation-*`는 list·detail 2개뿐, delete/cleanup 부재)
- **근거**: `DELETE FROM ai_agent_conversations` grep 0건, 보존정리 cron 없음. `admin-ai-agent.ts:910-916`이 messages에 도구 결과 PII jsonb 누적 저장.
- **권장 수정**: super_admin 전용 대화 삭제 API + CMS 화면, 또는 N일 경과 정리 cron(INTERNAL_TRIGGER_SECRET fail-closed). 저장 시 추가 마스킹 검토.
- **확신도**: 추정

### [OP-054] RAG 코퍼스 격리가 호출부 인자에 의존 (fail-open 구조) 〔결함·P3·boundary〕
- **역할/시나리오**: AI 비서 RAG 검색이 'qna','manual'만 보도록 호출부에서 필터를 넘기는데, 향후 다른 진입점·리팩터에서 이 인자를 빠뜨리면 순직(martyr_*) 민감 자료가 AI 비서 답변에 섞인다.
- **위치**: `admin-ai-agent.ts:687-689` · `admin-ai-agent-stream.ts:111` (`searchRag(userMessage, 5, ['qna','manual'])`)
- **근거**: 두 진입점이 화이트리스트 인자를 각자 반복(단일 출처 아님). 격리가 searchRag 내부 기본 차단이 아니라 호출자 책임 → 인자 누락 한 번으로 노출. (현재는 두 곳 모두 인자 있어 실노출 없음·잠재 회귀.)
- **권장 수정**: 'AI 비서 일반 컨텍스트' 전용 안전 래퍼(허용 코퍼스 고정) 도입 후 두 진입점이 그 래퍼만 호출, 또는 searchRag 기본값을 민감 제외로 두고 민감 검색은 명시 opt-in(fail-closed).
- **확신도**: 추정

---

## I. 채팅(상담)

### [OP-055] 1:1 상담 관리 화면이 통합 어드민(cms-tbfa)에 없음 〔갭·P1〕
- **역할/시나리오**: 운영자가 싸이렌 통합 어드민에서 '1:1 상담 관리'를 찾으려 하지만 사이드바·탭에는 AI 비서(ai-chat)만 있고, 상담 채팅 관리는 구버전 `admin.html`에서만 열린다.
- **위치**: `public/js/cms-tbfa.js:290,386,3937`(chat은 ai-chat만) · 실제 채팅 UI `public/admin.html:3489~3548` + `public/js/admin-chat.js`
- **증상**: 상담 목록·대화·종료·블랙 처리가 통합 CMS 밖에 분리 → §6.18(iframe 4곳 등록) 위반.
- **근거**: cms-tbfa.js chat 매칭은 'ai-chat'뿐. admin-chat-rooms/messages 소비처는 admin.js·admin-chat.js만(cms-tbfa.html 없음).
- **권장 수정**: admin-chat 관리 화면을 cms-tbfa iframe 4곳에 등록.
- **확신도**: 추정

### [OP-056] 민감 1:1 전문가 상담(법률·심리)을 모든 운영자가 무제한 열람 〔갭·P1·boundary〕
- **역할/시나리오**: 일반 운영자가 채팅 관리에서 변호사/심리상담사 1:1 상담방(법률·트라우마 등 극도로 민감) 전체 대화를 그대로 읽는다. 막는 게이트가 없다.
- **위치**: `admin-chat-rooms.ts:26-28,152-174`(목록) · `admin-chat-messages.ts:65-91`(대화 GET)
- **증상**: expert_1on1 상담 원문을 일반 운영자가 자유 열람. 목록은 status/category만 필터(roomType 제한 없음), 메시지 GET도 roomType 무관 전체 반환.
- **근거**: requireAdmin 단독, canAccess/requireRole grep 0건. 목록 쿼리(152-174) roomType 필터 없음. messages GET(65-91) roomType 제한 없이 전체 반환.
- **권장 수정**: expert_1on1 목록·열람을 `canAccess('chat_expert_view')` 또는 `requireRole(admin)`로 제한, 일반 운영자엔 general만. 민감 상담 열람 감사로그.
- **확신도**: 확실

### [OP-057] 새 상담/신규 메시지 도착 시 운영자 알림 없음 〔갭·P1〕
- **역할/시나리오**: 회원이 1:1 문의 채팅을 열고 메시지를 보내도 운영자는 알림(이메일/카톡/푸시)을 못 받고, 채팅 관리 화면을 띄워 5초 폴링 배지를 직접 봐야만 안다. 화면을 안 보면 상담 방치.
- **위치**: `chat-mine.ts:82-138`(방 생성) · `chat-messages.ts:122-209`(전송, notify 0건) · `admin-chat.js:20`(POLL_INTERVAL=5000)
- **근거**: chat-mine/chat-messages POST에 notify/solapi/sendEmail 0건. `notify-events.ts`에 chat/상담/expert 이벤트 정의 0건. 인지 경로는 폴링 배지뿐.
- **권장 수정**: 신규 상담방·미응대 N분 경과·신규 메시지 시 담당 운영자에게 알림톡/이메일/대시보드 알림. 미응대 SLA 큐 제공.
- **확신도**: 확실

### [OP-058] 운영자가 임의 회원을 채팅 블랙리스트 등록/해제 가능 〔결함·P2·boundary〕
- **역할/시나리오**: 운영자가 특정 회원의 채팅 이용을 차단/해제한다. 차단 시 그 회원 active 상담방을 즉시 강제 종료하는 파급이 있는데 일반 운영자도 그대로 수행.
- **위치**: `admin-chat-rooms.ts:198-244`(POST blacklist), `246-273`(DELETE)
- **근거**: `blockedBy: admin.uid` INSERT 후 `update(chatRooms).set({status:'closed'}).where(memberId, status='active')`(231-236) 강제 종료. requireAdmin 단독, canAccess/requireRole 0건. 대조 `admin-members-blacklist`는 finer 게이트 보유.
- **권장 수정**: `canAccess('chat_blacklist')` 또는 `requireRole(admin)` 게이트. 운영자는 '차단 요청'만, 승인은 상위 권한 분리 검토.
- **확신도**: 확실

### [OP-059] 메시지 전송 시 attachmentId의 방 소속 미검증 (메타 누출) 〔결함·P2〕
- **역할/시나리오**: 사용자/전문가가 본인 방 A에 메시지를 보내며 남의 방 B 첨부 id를 넣으면, 서버가 방 소속을 검증하지 않고 메시지에 연결한다.
- **위치**: `chat-messages.ts:129,173-185` · `admin-chat-messages.ts:101,115-128`
- **근거**: `attachmentId`를 그대로 INSERT(173-180) — `chatAttachments.roomId===roomId` 검증 없음.
- **정정(verifier)**: 이미지 바이트 조회(`chat-image.ts:44-56`)는 att.roomId 기준 권한을 재검증하므로 **원본 이미지 노출은 막힘**. 실제 영향은 메시지-첨부 무결성 훼손 + `enrichWithAttachments`(28-46)가 roomId 무검증으로 originalName/mimeType/fileSize **메타데이터 노출** 수준 → P1에서 P2로 조정.
- **권장 수정**: POST에서 attachmentId 지정 시 chatAttachments 조회해 roomId 일치 + 업로더/참여자 검증, 불일치 400.
- **확신도**: 확실

### [OP-060] 전문가 배정 완료 시 사용자·전문가 알림 없음 〔갭·P2〕
- **역할/시나리오**: 운영자가 전문가를 배정해 1:1 상담방을 만들지만 사용자도 전문가도 '매칭되었습니다' 알림을 못 받아, 양측이 직접 목록에 들어와 새 방을 발견해야 상담이 시작된다.
- **위치**: `netlify/functions/admin-expert-assign.ts:149-205`
- **근거**: 트랜잭션(152-184)에서 chatRooms INSERT + expertMatches UPDATE 후 곧바로 ok 반환(191), notify/dispatch grep 0건.
- **권장 수정**: 배정 성공 후 사용자·전문가에게 매칭 알림 + 마이페이지 알림(fire-and-forget).
- **확신도**: 확실

### [OP-061] 장기 미응대·방치 상담 자동 종료/아카이빙 없음 〔갭·P2〕
- **역할/시나리오**: 운영자가 끝난(또는 회원이 떠난) 상담을 일일이 수동 종료해야 한다. 며칠째 응답 없는 방을 자동 종료/보관하는 기능이 없어 active 목록이 쌓인다.
- **위치**: `admin-chat-rooms.ts:275-319`(수동 PATCH) — 자동 종료 크론 부재
- **근거**: 채팅 cron은 `cleanup-chat-images`(이미지 만료)뿐(netlify.toml:285). 상담방 자동 종료 크론 없음. `cleanup-chat-images.ts:90-95`는 active 방 첨부를 보존 → 종료 누락이 저장소 누수.
- **권장 수정**: N일 무메시지 active 방 자동 closed→archived cron(KST·멱등). 종료 전 안내 옵션.
- **확신도**: 추정

### [OP-062] 종료 방 재오픈(active 전환) 우회 + 종료 후 워크플로우 부재 〔결함·P2〕
- **역할/시나리오**: 운영자가 종료한 상담을 PATCH로 active로 되돌려 메시지를 이어갈 수 있다. 종료 사유·요약·만족도 같은 마감 절차가 없어 상담 이력 품질이 낮다.
- **위치**: `admin-chat-rooms.ts:296-305`(status 자유 전환) · `admin-chat-messages.ts:113`(active만 전송)
- **근거**: PATCH가 `['active','closed','archived']` 자유 전환(296-297) — archived→active 역전환 허용. 사용자측 수정/삭제는 종료 방 차단(`chat-message-update.ts:70-72`)이나 운영자 재오픈하면 열림. PATCH에 closedReason·요약 필드 없음.
- **권장 수정**: archived→active 역전환 금지(또는 상위 권한), 종료 시 사유·요약 필수, 종료 보고서/분류 저장.
- **확신도**: 추정

### [OP-063] image 타입 메시지가 첨부 없이 통과 + 첨부 MIME만 신뢰(매직바이트 미검증) 〔결함·P2〕
- **역할/시나리오**: image 타입 메시지를 attachmentId 없이 보내(빈 이미지 말풍선) 거나, 확장자/Content-Type만 image로 위조한 비이미지 파일을 업로드해 상담방에 첨부한다.
- **위치**: `chat-messages.ts:131-133,178-180` · `chat-upload.ts:36-41`
- **근거**: 검증은 `if (!content && !attachmentId)`(132)·타입 enum(133)뿐 — image일 때 attachmentId 필수 아님. upload는 `file.type`(Content-Type)만 신뢰(36), 매직바이트 미검증(크기 10MB 상한은 있음).
- **권장 수정**: image면 attachmentId 필수, 업로드 시 매직바이트로 실제 이미지 확인, 다운로드 응답에 nosniff.
- **확신도**: 확실

### [OP-064] 운영자 채팅 목록 검색 2글자 미만 시 무음 무시 〔결함·P3〕
- **위치**: `admin-chat-rooms.ts:144-150` · `admin-chat.js:204`
- **근거**: `if (q && q.length >= 2)`(144) — 1글자는 조건 미추가, 클라이언트도 1글자 미전송(204), '2글자 이상' 안내 없음 → 검색이 묵살된 줄 모름.
- **권장 수정**: 최소 글자수 미만이면 meta 안내(searchIgnored) 또는 prefix 검색 + 프론트 안내.
- **확신도**: 확실

### [OP-065] 방 단위 unread 카운터만 존재 (isRead/readAt 미사용) 〔결함·P3〕
- **위치**: `chat-messages.ts:189-205,240-249` · `db/schema.ts:554-555`(isRead/readAt 정의되나 미사용)
- **근거**: 읽음 처리는 방 카운터 리셋뿐(242-244), 발신은 `(room.unreadForAdmin||0)+1`(194) read-modify-write라 동시성 경합 취약. 메시지별 읽음표시 불가.
- **권장 수정**: PATCH 읽음 시 상대 메시지 isRead/readAt 갱신 또는 lastReadMessageId 도입. 카운터를 SQL 원자 증감(`unread = unread + 1`)으로.
- **확신도**: 확실

### [OP-066] 전문가 메시지 발신 시 발신자 자격(status) 미재검증 〔결함·P3〕
- **역할/시나리오**: 배정됐던 전문가가 이후 블랙/탈퇴/정지가 돼도 expert_1on1 방의 expertId가 그대로면 계속 메시지를 보낼 수 있다.
- **위치**: `chat-messages.ts:135-146,157-171` · `lib/expert-match.ts:136-146`(canEnterExpertRoom)
- **근거**: 블랙체크는 `if (!isAdmin)`(회원 채팅 블랙만, 136-146). 전문가 발신은 `canEnterExpertRoom`(158)이 expertId 일치만 보고 members.status·자격 재검증 없음. `authenticateUser`는 토큰만 보고 status 차단은 requireActiveUser에서만.
- **권장 수정**: expert_1on1 발신 시 expertId의 status=active·자격 유효 재확인, 상실 시 차단 + 운영자에 재배정 알림.
- **확신도**: 추정

### [OP-067] 상담 상세에서 회원 실명·전화·후원총액·지원건수 일괄 노출 〔결함·P3·boundary〕
- **역할/시나리오**: 운영자가 상담방 상세를 열면 회원 실명·이메일·전화·후원총액·지원신청 건수까지 한 화면에 표시 → 익명 기대 문의와 결합 시 과도한 PII.
- **위치**: `admin-chat-rooms.ts:76-124`
- **근거**: 상세 응답에 `member:{name,email,phone}`(77-89) + `summary:{donationTotal,donationCount,supportCount}`(115-122). requireAdmin 단독. 후원총액은 finer 게이트(admin-donations) 도메인인데 여기선 무게이트.
- **권장 수정**: 전화·후원총액 등 민감 필드는 상위 권한에만 노출/마스킹, 운영자엔 최소 정보 + 열람 감사로그.
- **확신도**: 추정

---

## J. 캠페인·게시판·공지·자료실

### [OP-068] 자유게시판 게시글 영구 삭제 기능 없음 (운영자는 숨김만) 〔갭·P1〕
- **역할/시나리오**: 운영자가 불법·스팸·명예훼손 게시글을 게시판에서 완전히 제거하려 하지만 글 삭제 동작이 없어 '숨김'만 가능, 본문은 DB에 남는다.
- **위치**: `netlify/functions/admin-board-posts.ts:269-298`(DELETE)
- **증상**: 게시글 단위 삭제 경로 부재. DELETE는 action=comment(댓글)만 처리.
- **근거**: DELETE 분기가 댓글만 다룸, `db.delete(boardPosts)` 호출 없음(유일한 호출은 `board-delete.ts:41`이며 본인 글만). 글 제거는 PATCH `isHidden=true`(소프트 숨김)뿐.
- **권장 수정**: DELETE ?id(또는 action=post)로 영구삭제(연결 댓글·첨부 정리) 또는 soft-delete(deletedAt) + cms-tbfa 삭제 버튼. 불법물 대응상 필수.
- **확신도**: 확실

### [OP-069] 캠페인·콘텐츠 예약 발행(시작/종료 시점 자동 노출) 없음 〔갭·P1〕
- **역할/시나리오**: 운영자가 캠페인을 미리 작성하고 시작일을 미래로 잡아도 그날 자동 공개되지 않고, isPublished면 즉시 노출되거나 종료일이 지나도 계속 노출된다.
- **위치**: `netlify/functions/campaigns.ts:128-144,12` · 공개 `resources.ts:306-309`
- **증상**: 공개 목록이 isPublished+status만 보고 startDate/endDate를 필터하지 않음. 미래 시작 캠페인 즉시 노출, 마감 캠페인 수동 변경 전까지 노출.
- **근거**: `conds = [eq(isPublished, true)]` + status만, 날짜 조건 없음. 12행에서 lte/gte/isNull import하나 미사용(의도됐으나 미구현). 예약발행 cron도 없음.
- **권장 수정**: 공개 목록에 `(startDate IS NULL OR startDate<=now) AND (endDate IS NULL OR endDate>=now)` 추가, 또는 cron으로 시점 전이. 자립성.
- **확신도**: 확실

### [OP-070] 댓글 신고 검토·삭제(SIREN 사건 댓글 중재)를 운영자가 수행 + 감사 없음 〔결함·P1·boundary〕
- **역할/시나리오**: 운영자(role=operator)가 SIREN 사건 게시판의 신고 댓글을 임의 숨김·영구 삭제할 수 있고, 그 행위가 감사 로그에 남지 않는다.
- **위치**: `netlify/functions/admin-comment-report-review.ts:19-20,53-74`
- **증상**: 신고 검토·hide/delete를 requireAdmin 단독 허용(canAccess/requireRole 없음). delete는 incidentComments 하드 삭제(복구 불가), logAdminAction 호출 없음.
- **근거**: requireAdmin(19) 후 `db.delete(incidentComments)`(72), audit import/호출 0건.
- **권장 수정**: `canAccess('comment_moderation')` 또는 `requireRole(member,'admin')`(DB role) 게이트. 삭제는 soft-delete로, 모든 검토·숨김·삭제에 logAdminAction 기록.
- **확신도**: 확실

### [OP-071] 사이트 팝업·큐레이션(홈 노출) CRUD를 운영자 무제한 + 감사·URL 검증 없음 〔결함·P2·boundary〕
- **역할/시나리오**: 운영자가 홈 팝업·큐레이션 배너(외부 linkUrl 포함)를 자유 생성·수정·삭제하는데, 누가 무엇을 바꿨는지 기록이 없고 URL은 검증 없이 저장된다.
- **위치**: `admin-popups.ts:12-13,24-87` · `admin-curations.ts:28-29,44-108`
- **근거**: 둘 다 requireAdmin 단독(role 분기 없음) + logAdminAction 없음. linkUrl/imageUrl을 정규화·검증 없이 저장(저장형 XSS·오픈리다이렉트 위험).
- **권장 수정**: 변경에 logAdminAction 추가. 메인노출 콘텐츠가 admin급 결정이면 canEdit/requireRole 게이트. linkUrl은 http(s) 스킴 화이트리스트 검증.
- **확신도**: 확실

### [OP-072] 신고 검토 화면에 신고 대상 본문이 없어 맥락 없이 판단 〔갭·P2〕
- **역할/시나리오**: 운영자가 신고 목록을 열어도 사유·신고자 이름만 보이고 실제 어떤 댓글·사건이 신고됐는지 내용이 없어 숨김/삭제 근거가 부족하다.
- **위치**: `netlify/functions/admin-comment-reports.ts:34-61`
- **근거**: 목록이 commentId/incidentId(번호)·reason만 반환, 대상 댓글 content·작성자·작성일 조인 없음. 단건 상세 엔드포인트도 없음.
- **권장 수정**: 신고 목록/상세에 대상 댓글 본문·작성자·사건 제목 조인 반환.
- **확신도**: 확실

### [OP-073] 캠페인 후원자 수 집계가 캐시와 실시간 통계에서 비회원 카운트 불일치 〔결함·P2〕
- **역할/시나리오**: 운영자가 캠페인 상세 통계에서 후원자 수를 보는데, 목록/캐시 수와 상세 실시간 수가 비회원 후원이 있을 때 다르게 나온다.
- **위치**: `admin-campaign-stats.ts:38-47`(recalcOne) vs `84-99`(GET 실시간)
- **근거**: recalcOne은 비회원을 건당 1명으로(`DISTINCT member_id FILTER NOT NULL + COUNT(*) FILTER NULL`), GET은 `COUNT(DISTINCT COALESCE(member_id,0))`로 비회원 전체를 1명으로 합산. 주석(Q4-012)은 전자가 올바른 수정 — GET이 옛 버그 로직 잔존. cacheStale 비교(188)도 항상 stale 오판.
- **권장 수정**: GET uniqueDonors도 recalcOne 수식으로 통일, cacheStale 비교 기준 일치.
- **확신도**: 확실

### [OP-074] AI 캠페인 카피 생성 비용 통제 약함 (canAccess 미적용·빈도 제한 없음) 〔결함·P3〕
- **역할/시나리오**: donation 담당 운영자가 AI 카피 생성을 횟수 제한 없이 반복 호출해 Gemini 비용을 누적시킬 수 있다.
- **위치**: `netlify/functions/admin-campaign-ai-copy.ts:29-46,107-111`
- **근거**: `canUseAI`는 DB role/카테고리 기반(elevate 안전)이나 `canAccess('campaign_ai_copy')` 미호출·rate-limit 없음.
- **정정(verifier)**: '감사로그 부재' 주장은 오류 — 138-144행에 `logAdminAction('campaign_ai_copy')` 존재. 권한은 견고하므로 P2→P3.
- **권장 수정**: `canAccess` 또는 멤버별 일일 호출 상한·디바운스 추가.
- **확신도**: 추정

### [OP-075] 공지·FAQ·미디어·활동·콘텐츠페이지 삭제가 하드 삭제 (복구 불가) 〔결함·P3〕
- **위치**: `admin-notices.ts:252` · `admin-faqs.ts:254` · `admin-media-posts.ts:152` · `admin-activity-posts.ts:203` · `admin-content-pages.ts:116`
- **근거**: 모두 `db.delete(...)` 물리 삭제, deletedAt/휴지통 없음(schema에 해당 테이블 deletedAt 부재). 게시판 휴지통(cron-workspace-trash-cleanup)과 달리 콘텐츠 영역 미적용.
- **권장 수정**: soft-delete(deletedAt) + 휴지통/복구 UI(워크스페이스 패턴 재사용) 또는 삭제 전 확인·undo.
- **확신도**: 추정

### [OP-076] incident 신고에 대한 후속 조치 동작 부재 〔갭·P3〕
- **역할/시나리오**: 사용자가 사건 전체를 신고하면 운영자는 approve/dismiss만 할 수 있고 hide/delete는 댓글에만 적용돼 신고된 사건 본문을 처리할 방법이 없다.
- **위치**: `admin-comment-report-review.ts:53-74` · `comment-report.ts:35`(incident 허용)
- **근거**: comment-report가 reportType='incident' 허용(incidentId만 채움)인데, 검토 함수는 commentId만 처리(`if(cid)`), incidentId 분기 없음 → incident 신고는 기록만.
- **권장 수정**: incident 신고에 사건 본문 숨김/검토 표시 분기 추가하거나 사건관리 워크플로우로 라우팅. 미지원이면 comment-report에서 incident 타입 차단.
- **확신도**: 확실

### [OP-077] 캠페인/자료 카테고리 배정 요청 워크플로우 부재 (forbidden만) 〔결함·P3·boundary〕
- **역할/시나리오**: 운영자가 캠페인을 발행하려다 'donation/all 미배정'으로 막히는데, 왜 막히는지·누가 배정해 주는지 화면 안내·연결이 없어 운영 자립 흐름이 끊긴다.
- **위치**: `admin-campaigns.ts:28-33,248`(canEdit/forbidden) · `admin-resources.ts:27-34` · `admin-resource-categories.ts:23-30`
- **근거**: 편집 권한이 super_admin 또는 assignedCategories(donation/all/content)로 갈림(DB role 기반·보안 견고). forbidden 메시지는 막힌 이유만, 배정 요청 경로 없음.
- **권장 수정**: forbidden 시 카테고리 배정 요청 경로 안내, 또는 super_admin이 cms-tbfa 내에서 운영자 담당 카테고리를 배정·확인하는 화면 명시.
- **확신도**: 추정

### [OP-078] 공지/FAQ/자료/미디어 검색이 대소문자 구분 LIKE 사용 〔결함·P3〕
- **위치**: `admin-notices.ts:64` · `admin-faqs.ts:64` · `admin-resources.ts:289-292` · `admin-media-posts.ts:50`
- **근거**: 모두 `like`(대소문자 구분) 사용. 게시판(`admin-board-posts.ts:95` ilike)과 달라 영문 대소문자 다르면 누락(한글 무영향).
- **권장 수정**: 콘텐츠 관리 검색을 `ilike`로 통일.
- **확신도**: 확실

---

## 부록 1 — 권한 상승(escalation) 한눈에

| 게이트가 보는 것 | 함수 | 운영자 영향 |
|---|---|---|
| **JWT role**(`ctx.admin.role`) — elevate로 super_admin 위조됨 | `admin-role-permissions:28`(OP-002), `admin-ai-agent:659`/`stream:70`(OP-003), `admin-revenue-approve:17`(OP-004), `admin-revenue-update:56`·`admin-expense-update:55`·`admin-expense-category-update:17`(OP-005), `admin-donation-confirm:310`(OP-006) | **우회 가능** — DB role로 교체 필요 |
| **DB role**(`ctx.member.role`) — 안전 | `admin-operators`·`admin-service-rnr`·`admin-att-*`(17)·`admin-expense-approve`·`admin-expense-refund`·`admin-revenue-refund`·`admin-voucher-approve`·`admin-campaigns`·`admin-resources`·`admin-milestone-nonrevenue` | 방어됨(안심) |
| **게이트 없음**(requireAdmin 단독) — 운영자 정당 통과면 노출 | OP-011~018, OP-056·058, OP-070·071 등 | 직무 경계 설계 결정 + 민감면 finer 게이트 |

> **단일 수정 포인트**: `auth-admin-elevate.ts:51`을 DB role 발급으로 고치면(OP-001) JWT-role 신뢰 6건(OP-002~006)이 한 번에 차단된다. 그 후에도 `admin-role-permissions` 등은 방어적으로 DB role 직접 참조로 바꿔두는 것이 안전(이중 방어).

## 부록 2 — 갭(없는 기능) 인벤토리 (1순위)

- 근태 중간 관리자 권한(OP-019) · 급여 이의제기(OP-028) · 분기 PM 1차승인(OP-032)
- 마감일 변경 요청/승인 UI 전체(OP-043·044·049) — 백엔드만 살아있는 죽은 기능
- 1:1 상담 CMS 통합(OP-055) · 상담/메시지 알림(OP-057) · 전문가 배정 알림(OP-060) · 상담 자동 종료(OP-061)
- 게시글 영구삭제(OP-068) · 예약 발행(OP-069) · 신고 대상 본문 표시(OP-072) · incident 신고 후속(OP-076) · 콘텐츠 soft-delete(OP-075)
- AI 대화 삭제·정리(OP-053) · 근태/성과 AI 기능 토글 등록(OP-052)

---

**작성 완료**: 2026-05-29 / 브랜치 `audit/r45-b` / 베이스 `9040dfb` / push 안 함 — 메인 수합 대기.
