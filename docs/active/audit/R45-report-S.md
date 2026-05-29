# R45 최종 점검 — 슈퍼어드민(super_admin) 영역 (메인)

> 감사자: Opus(7영역 병렬 + P0/P1 반증 검증 20에이전트) / 2026-05-29 / 베이스 9040dfb
> 점검: 권한 5가드 전수 · featureKey 카탈로그 · super_admin 전용 함수 + 재정승인 + 감사로그/AI비용 + 딥릴리프/RAG + cron 39/background 12 + SSO/환경/세션
> 커버리지: super_admin 게이트 매칭 전수 enumerate 완료 [O]
> ★P0/P1은 독립 에이전트가 코드 재확인으로 반증 검증 → 오탐/과대 제거(elevate P0→P2 강등, kakao cron P1→P2 강등 등)

## 요약 (반증 검증 후 최종 심각도)
- [결함] P0 **1** · P1 **6** · P2 **12** · P3 **9**
- [갭] P1 **2** · P2 **4** · P3 **4**
- 합계 약 38건 (중복 1건 deeprelief↔cron 외부검색 cron = 통합)

### 🔴 최우선 (운영 시작 전 fix 권장)
1. **SU-009 [결함·P0]** 비-슈퍼 어드민이 권한정책 매트릭스(전 어드민 접근의 마스터)를 임의 토글 — 권한 상승
2. **SU-002 [결함·P1]** 슈퍼 전용 재정·권한 게이트 일부가 DB가 아닌 JWT 등급 신뢰 (SU-001 elevate와 결합 시 우회 — 근본 1줄 fix로 다수 동시 해소)
3. **SU-018 [결함·P1]** 감사로그 목록·통계가 슈퍼 전용 아님 → 운영자가 전 관리자 활동·IP·PII 열람 (IDOR)
4. **SU-003 [결함·P1]** AI 비서 진입 등급 게이트 0 + 변경도구 권한표 미시드 fail-open → 하위 등급이 회원차단·발송 실행 가능
5. **SU-024 [결함·P1]** 사건 삭제 시 RAG 색인·R2 원본이 고아로 잔존 — 유족 민감자료 파기 신뢰 위반

### 점검했으나 정상인 핵심 흐름(안심)
- super_admin 전용 핵심(지출/예산 승인·감사 CSV·등급·후원정책·순직 삭제·인정요건)은 `requireRole(ctx.member, …)` = **DB role 기준**이라 토큰 부풀림과 무관하게 안전
- KICC 자동청구 이중청구 방지(멱등 거래키)·발송 디스패처 수신자 단위 선점·급여 월집계 force:false·전표 발번 advisory lock·background 12개 SECRET fail-closed
- 후원정책·등급·메뉴 콘텐츠는 DB CRUD로 운영자 관리(하드코딩 아님)
- 운영자 강등 시 마지막 super_admin 보호·자기강등 차단·세션 타이머·SSO 시크릿 fail-closed

---

## 영역 1 — 권한 인프라 정합

### [SU-001] 통합 로그인 '관리자 모드' 진입 시 type=admin이면 무조건 super_admin 토큰 발급  〔결함·P2〕(원 P0→반증 강등)
- **위치**: `netlify/functions/auth-admin-elevate.ts:42-53`
- **증상**: 승급 운영자·일반 어드민이 통합 로그인→'관리자 모드'로 들어오면 토큰 등급이 super_admin으로 박힘. 단 서버 핵심 인가는 DB role을 다시 읽어 막으므로 실제 권한상승은 SU-002/SU-009 경로에 한정.
- **근거**: `role: isAdmin ? "super_admin" : "operator"` — members.role 무시. 대조 `admin-login.ts:123`은 `user.role ?? "operator"`(DB 반영).
- **fix**: elevate select에 members.role 포함 + 토큰 role을 user.role로 발급(admin-login과 통일). **이 1줄이 SU-002·SU-009·재정 JWT게이트 다수를 동시 차단(근본 수정).**
- 확신도: 확실

### [SU-002] 슈퍼 전용 재정·권한 게이트 일부가 DB가 아닌 JWT 등급 신뢰  〔결함·P1〕
- **위치**: `admin-revenue-approve.ts:17`·`admin-expense-category-update.ts:17`·`admin-revenue-update.ts:54`·`admin-expense-update.ts:55`·`admin-role-permissions.ts:28`·`admin-donation-confirm.ts:310` (+blast: admin-milestone-revenue·admin-org-news-refresh·admin-payroll-settings)
- **증상**: 같은 슈퍼 전용인데 어떤 화면은 DB로, 어떤 화면은 토큰 등급으로 막아 비대칭. SU-001과 결합 시 중간등급 admin이 수입승인·지출분류수정·권한정책변경을 통과(자금 실승인·예산승인은 DB로 막혀 피해 한정).
- **fix**: 민감 등급 판정 전부 `requireRole(ctx.member,…)`(DB)로 통일·`ctx.admin.role` 직접 비교 제거.
- 확신도: 확실

### [SU-003] AI 비서 requireAdmin만 통과면 진입 + 변경도구 권한표 미시드 fail-open  〔결함·P1〕
- **위치**: `admin-ai-agent.ts:483·659·835` + `lib/ai-agent-config.ts:320·297`
- **증상**: operator도 AI 비서 진입, 자연어로 회원차단·발송 도구 호출 가능. `ai_tool_permissions` 행 없으면 무조건 통과(fail-open)이고 시드/INSERT 경로가 repo에 전무. 재정 도구만 `ensureRole` 안전망 있고 회원/발송 도구엔 없음(기본 dry-run이 완충).
- **fix**: ① 진입에 `canAccess(role,'ai_agent_chat')` ② 변경도구는 미시드 시 fail-closed 또는 회원/발송 도구에 ensureRole 확대 ③ adminRole을 DB role로.
- 확신도: 확실

### [SU-004] ai_agent_chat·ai_rag_search 키가 RBAC 게이트로 안 쓰임(비용토글로만)  〔갭·P2〕
- **위치**: `admin-ai-agent.ts:50·488`·`admin-ai-agent-stream.ts:53·73·109`
- **fix**: 등급 통제 필요하면 진입/검색부에 canAccess 추가 + role_permissions 시드. 불필요하면 카탈로그에서 RBAC 오인 정리.

### [SU-005] canAccess RBAC 시드가 코드에 없어(1회용 마이그 삭제) 운영 DB 시드 정합 점검 불가  〔갭·P2·추정〕
- **위치**: `lib/role-permission-check.ts:33` + (INSERT INTO role_permissions 0건)
- **증상**: 의도가 operator 허용인 키(donation_confirm 등)가 미시드면 조용히 operator 차단. SU-001로 평소엔 가려지다 elevate fix 순간 운영자 기능이 막히는 회귀 가능.
- **fix**: 운영 DB role_permissions 현재 행을 `admin-role-permissions` GET으로 확인 → 의도 기본값 시드 검증. **elevate fix 배포 전 선행.**

### [SU-006] settlement_view 게이트가 주간보고 메일 수신자엔 부재  〔갭·P3·추정〕
- **위치**: `ai-milestone-insight.ts:31`(O) vs `cron-agent-9.ts`(게이트 없음·cron이라 정상)
- **fix**: 주간 보고 메일 수신자가 결산 열람자격(super_admin)으로 한정되는지 cron-agent-9 수신자 산출부 확인. ADMIN_NOTIFY_EMAIL이 비권한자면 분리.

### [SU-007] 권한 변경 후 5분 캐시는 처리 인스턴스만 즉시 무효화 — 타 인스턴스 최대 5분 stale  〔결함·P3〕
- **위치**: `lib/role-permission-check.ts:5-22·40`·`admin-role-permissions.ts:48`
- **fix**: 민감 차단 즉시반영 필요시 TTL 30~60초 단축 또는 updated_at 워터마크. 최소 매뉴얼에 '최대 5분 지연' 명시.

---

## 영역 2 — 운영자관리·권한정책·등급·후원정책

### [SU-009] ★비-슈퍼 어드민이 권한정책 매트릭스를 임의 토글 (권한 상승)  〔결함·P0〕
- **위치**: `admin-role-permissions.ts:27-28` (근본 `auth-admin-elevate.ts:51`)
- **증상**: 슈퍼 전용이어야 할 '권한정책관리' 허용/불가 토글(=모든 어드민 접근의 마스터)을, DB역할=admin(비-super)인 회원이 '관리자 모드' 진입 후 변경 가능 → 자기 권한을 스스로 열 수 있음. (순수 operator(type=regular)는 requireAdmin에서 차단되므로 실제 주체는 중간등급 admin → super 상승.)
- **근거**: `:28 if (admin?.role !== "super_admin")` 의 admin=JWT 페이로드. elevate가 type=admin에 super_admin JWT 발급. 형제 `admin-operators.ts:54-57`은 같은 함정을 경고하며 DB role 사용.
- **fix**: `:28`을 `requireRole(auth.ctx.member,'super_admin')`(DB)로. 근본은 SU-001(elevate) 수정.
- 확신도: 확실

### [SU-010] 비활성(일시정지) 처리된 운영자도 '관리자 모드'로 재진입 가능  〔결함·P1〕
- **위치**: `auth-admin-elevate.ts:42-46`·`lib/admin-guard.ts:26-27`
- **증상**: operatorActive=false로 토글해도 type=admin 유지라 회원 로그인 후 '관리자 모드'로 백오피스 재진입. (강등(DELETE)은 type까지 regular라 막힘.)
- **fix**: elevate·requireAdmin이 `operatorActive===false`면 forbidden.
- 확신도: 확실

### [SU-011] 운영자 강등 시 담당 카테고리 등 잔여 운영자 속성 미초기화  〔결함·P2〕
- **위치**: `admin-operators.ts:297-303`
- **fix**: demoteData에 `assignedCategories:[]` 추가(재승급 시 옛 배정 부활 방지).

### [SU-012] 비활성화한 회원 등급도 자동 재계산에서 부여됨  〔결함·P2〕
- **위치**: `lib/grade-calculator.ts:31-54` (admin-grades.ts:138 isActive 토글과 불일치)
- **fix**: getGradeForStats·공개 등급조회에 `where(isActive=true)` 필터 추가.

### [SU-013] 권한정책 화면 milestone:* 토글이 '표시용'이라 변경해도 미적용  〔갭·P3〕
- **위치**: `public/admin-role-policy.html:162-169`
- **fix**: 해당 키 읽기전용 시각 구분 또는 milestone API가 canAccess도 평가하도록 연결.

### [SU-014] 권한정책관리 사이드바 메뉴가 비-슈퍼에게도 노출  〔갭·P3·추정〕
- **위치**: `public/cms-tbfa.html:559`·`public/js/cms-tbfa.js`
- **fix**: role-policy(및 급여관리 등 super 전용) 메뉴를 `currentAdmin.role==='super_admin'`일 때만 렌더.

---

## 영역 3 — 재정 승인(예산·지출·전표·환불)

### [SU-015] 운영자(operator)가 지출·수입·전표·예산안 작성·상신 가능  〔결함·P1〕
- **위치**: `admin-expense-create.ts:13`·`admin-revenue-create.ts:13`·`admin-voucher-create.ts:23`·`admin-voucher-submit.ts:23`·`admin-budget-plan-create.ts:22`·`admin-budget-plan-submit.ts:23`·`admin-budget-plan-update.ts:22`·`admin-finance-budget-upsert.ts:9`
- **증상**: 정책상 operator는 재정 접근 불가인데 requireAdmin만이라 통과 → 승인 큐 오염. (환불은 finance_refund로 막는데 작성·상신만 무방비 비대칭.)
- **fix**: 재정 쓰기에 `requireRole(member,'admin')` 또는 canAccess(finance_write) 게이트.
- 확신도: 확실

### [SU-016] 두 예산 시스템 공존 — AI 비서는 폐기된 budgets 테이블, 실제는 budget_plans  〔갭·P1〕
- **위치**: `admin-finance-budget-upsert.ts:25`(budgets WRITE·미사용)·`lib/ai-agent-tools.ts:3890·3916`(budgets READ) vs `admin-finance-budget-list.ts:29`(budget_plans)
- **증상**: 슈퍼어드민이 AI에 예산/집행률 물으면 빈값·옛 수치 응답(운영자립 신뢰 저하).
- **fix**: AI 예산 도구를 budget_plans/budget_lines+approved expenses로 재작성. budget-upsert 레거시 삭제.
- 확신도: 확실

### [SU-017] 환불 누적 검증 비원자적 — 동시/더블클릭 시 누적 환불 원금 초과 가능  〔결함·P2〕
- **위치**: `admin-expense-refund.ts:59-80`·`admin-revenue-refund.ts:62-83`
- **fix**: `UPDATE ... SET refund_amount=refund_amount+${inc} WHERE id=? AND refund_amount+${inc}<=amount RETURNING` 원자화(영향행 0이면 거부).

### [SU-018] 감사 로그 목록·통계 조회가 슈퍼 전용 아님 — 운영자가 전 관리자 활동·IP·PII 열람  〔결함·P1〕
- **위치**: `admin-audit-list.ts:24-29`·`admin-audit-stats.ts:38-44`
- **증상**: 메뉴는 슈퍼에게만 보이게 숨겼으나 데이터 통로는 requireAdmin만 → 운영자가 URL 직접 호출 시 타 관리자 로그인·환불·회원변경 이력+IP 열람(IDOR). (정식 admin-audit.ts:39는 super 전용으로 강화돼 의도 입증.)
- **fix**: 두 함수에 `requireRole(ctx.member,'super_admin')` 추가(admin-audit.ts:39 패턴).
- 확신도: 확실
- ※ 영역4 감사로그 항목이나 재정 무관해 권한 우선 표기.

### [SU-019] 수입 승인/반려가 JWT 등급으로 판정 — 강등된 슈퍼가 최대 2시간 승인 가능  〔결함·P2〕
- **위치**: `admin-revenue-approve.ts:17`·`admin-expense-category-update.ts:17`·`admin-expense-update.ts:55`
- **fix**: `auth.ctx.member.role`(DB)로 통일. (SU-002와 동일 뿌리.)

### [SU-020] 반려된 지출·수입은 재제출 경로 없음 (전표·예산안은 가능)  〔갭·P2〕
- **위치**: `admin-expense-update.ts:50-52`·`admin-revenue-update.ts:49-51`
- **fix**: rejected 상태도 수정 허용(draft 복귀·rejection_reason=NULL) 또는 재상신 엔드포인트.

### [SU-021] 지출 결재에 '상신' 단계 없음 — 작성 즉시 승인 대상(전표/예산보다 약함)  〔갭·P3·추정〕
- **위치**: `admin-expense-create.ts:60`·`admin-expense-approve.ts:55-57`
- **fix**: submitted 상태 추가 또는 결산 점검(settlement-check)에 draft 지출·수입 미결 포함.

### [SU-022] 전표 승인자는 문자열, 지출·수입·예산은 정수 — 감사 조인 형식 불일치  〔결함·P3〕
- **위치**: `db/schema.ts:3102`(vouchers.approved_by varchar) vs `2941·2988·3017`(integer)
- **fix**: vouchers.approved_by를 integer로 마이그 + voucher-approve/reject에서 String() 제거.

---

## 영역 4 — 감사로그·AI설정·AI비용 안전장치
(SU-018 = 영역4지만 권한 우선이라 위 표기)

### [SU-023] 권한 정책(role_permissions) 변경이 감사 로그에 안 남음  〔갭·P1〕
- **위치**: `admin-role-permissions.ts:26-50`
- **증상**: 최고민감 작업(운영자 권한 부여·박탈)이 사후 추적 0. `lib/audit.ts:17`은 `admin_permission_change:critical`을 정의해뒀으나 emit하는 코드가 전무.
- **fix**: PATCH 성공 후 `logAdminAction(req, admin.uid, admin.name, 'admin_permission_change', {detail:updateData})`.
- 확신도: 확실

### [SU-024] 사건 삭제 시 RAG 색인·R2 원본이 고아로 잔존  〔결함·P1〕 ※딥릴리프(영역5)지만 데이터파기 신뢰라 상단
- **위치**: `admin-martyrdom-cases.ts:273`
- **증상**: 화면은 '모든 자료·AI 분석 삭제' 약속하나 ai_rag_documents(case_id FK 없음)·R2 원본·blob_uploads 미정리. 민감 유족자료 파기 위반 + 잔존 색인이 타 사건 초안에 혼입 가능.
- **근거**: DELETE는 `DELETE FROM martyrdom_cases` 한 줄. doc-delete.ts:25-37 purgeDocResources(R2+RAG+blob 3단)와 대조.
- **fix**: DELETE 전 자료 blob_key→deleteFromR2 + `DELETE FROM ai_rag_documents WHERE case_id=${id} AND source_type IN(...)` + blob_uploads 정리(doc-delete all 모드 재사용).
- 확신도: 확실

### [SU-025] 익명 신고자 신원공개(reveal)가 통합 감사로그 미연동 + 운영자 누구나 실행  〔갭·P2〕(원 P1→강등)
- **위치**: `admin-anonymous-reveal.ts:35-37·108-120`
- **증상**: reveal이 전용 테이블에만 기록(전용 조회 화면 admin-anon-audit.js는 존재) + 통합 audit_logs 미기록 + requireAdmin만이라 operator도 PII 열람.
- **fix**: reveal 성공 후 logAudit 병행 + super_admin/canAccess 게이트 검토.

### [SU-026] 감사로그 위험등급 매핑이 실제 액션명과 불일치 — 민감작업이 'low'로 표시  〔결함·P2〕
- **위치**: `lib/audit.ts:13-25`·`admin-audit-list.ts:85-98`·`admin-audit-stats.ts:18-31`
- **fix**: RISK_LEVEL_MAP 키를 실제 emit 액션명으로 정정(members.blacklist.add/remove·operator_promote/demote·admin_permission_change 등)·1곳 정본화.

### [SU-027] AI 월 한도 조회 실패 시 fail-open — DB 오류면 비용 무제한 통과  〔결함·P2〕
- **위치**: `lib/ai-cost-monitor.ts:163-176`·`lib/ai-feature.ts:219-226`
- **fix**: 조회 실패 시 fail-closed(ok:false) 또는 최소 급증알림 트리거.

### [SU-028] AI 설정·비용·사용량 화면 백엔드가 운영자도 통과  〔결함·P2·추정〕
- **위치**: `admin-ai-config.ts:24-26`·`admin-ai-features.ts:31-33`·`admin-ai-cost-stats.ts:39-40`·`admin-ai-usage-logs.ts:32-33`
- **증상**: 기능 토글·월 한도 변경(admin-ai-features POST)을 운영자가 할 수 있어 비용 통제 무력화 가능.
- **fix**: 네 함수에 super_admin 또는 canAccess(ai_config/ai_cost) 게이트.

### [SU-029] 비용 집계 정본 recordTokenUsage가 데드코드 — 재연결 시 이중기록 위험  〔결함·P3〕
- **위치**: `lib/ai-cost-monitor.ts:85-139`
- **fix**: @deprecated 명시 또는 제거(집계는 ai-feature.ts recordFeatureUsage로 일원화).

### [SU-030] 감사로그 통합검색이 detail(민감 JSON) LIKE 포함 — 검색결과/CSV에 PII 노출  〔결함·P3·추정〕
- **위치**: `admin-audit.ts:69-77·203-213`
- **fix**: SU-018(슈퍼 전용) 선행 + CSV detail 마스킹/길이제한 검토.

---

## 영역 5 — 딥릴리프 슈퍼어드민 + RAG 색인
(SU-024 = 영역5지만 상단 표기)

### [SU-031] martyr_case RAG 검색이 case_id 격리 없어 고아·타 사건 청크 혼입  〔결함·P2·추정〕
- **위치**: `lib/ai-embedding.ts:117-124`
- **증상**: 서면 초안·발간 생성 시 삭제됐어야 할 사건 잔존 색인이나 타 사건 자료가 섞임(SU-024와 결합 시 직접 노출).
- **fix**: SU-024 고아 정리 선행. martyr_case에 `case_id != ${caseId}` 명시 필터로 '다른 사건 참고' 의도 못박기.

### [SU-032] 1회용 마이그 migrate-r44-reindex.ts 미삭제(§6.8 위반)  〔갭·P3〕
- **위치**: `netlify/functions/migrate-r44-reindex.ts:1`
- **fix**: 라이브 색인 복구 확인(admin-rag-status byType.martyr_*) 후 삭제+커밋.

### [SU-033] 자료 일괄 재시도 직후 폴링이 즉시 멈춤(queued 상태 폴링 누락)  〔결함·P3〕
- **위치**: `public/js/admin-martyrdom.js:2640-2643·2467`
- **fix**: 폴링 술어에 'queued' 포함 또는 batchRetryDocs 후 currentDetail refetch.

### [SU-034] RAG 상태·재색인 화면이 주석은 super 전용이나 실제 requireAdmin 통과  〔결함·P3·추정〕
- **위치**: `admin-rag-status.ts:4·30`·`admin-rag-reindex.ts:23`
- **fix**: super 전용 의도면 requireRole 추가, 어드민 허용이면 주석 정정(비용 동반 전량 재색인이라 super 권장).

---

## 영역 6 — cron 39 + background 12

### [SU-035] 카카오 알림톡 검수상태 추적 cron이 netlify.toml 미등록  〔결함·P2〕(원 P1→강등·수동 갱신 우회 존재)
- **위치**: `netlify.toml`(cron-kakao-template-status 블록 없음)·`cron-kakao-template-status.ts:12-14`
- **증상**: 템플릿 검수 결과 자동 반영 안 돼 '검수중'에 갇힘 → 알림톡 자동 사용가능 전환 실패. (화면 내 수동 '상태 즉시 갱신' 우회 존재.)
- **근거**: 39개 cron 중 이 함수만 toml 등록 누락(나머지 38 이중 등록). toml 주석이 인라인 config 미인식 환경 경고.
- **fix**: netlify.toml에 `[functions."cron-kakao-template-status"] schedule="0 * * * *"` 추가.
- 확신도: 확실

### [SU-036] 전월 만근 보너스 연차가 재실행 시 중복 적립(모드A 멱등 결여)  〔결함·P2〕(원 P1→강등·이상 트리거 한정)
- **위치**: `cron-att-leave-auto.ts:131-136`
- **증상**: 매월 1일 작업이 동월 두 번 발화 시 같은 직원에 +1일 누적(모드B는 GREATEST로 멱등). 본 NPO 기본 구성=모드A.
- **fix**: 모드A에 멱등 가드(member+year+month UNIQUE 지급이력) 또는 조건부 +bonus.
- 확신도: 확실

### [SU-037] 알림 발송 실패 재시도 cron(1분)에 행 잠금 없음 — 중첩 시 중복 발송  〔결함·P2·추정〕
- **위치**: `cron-notification-retry.ts:21-34`·`lib/notify-dispatcher.ts:223-258`
- **fix**: SELECT에 FOR UPDATE SKIP LOCKED 또는 retryLog 진입 시 status='retrying' 선점 UPDATE(affectedRows).

### [SU-038] AI 스케줄 명령 cron이 실행 전 다음시각 미선점 — 장시간/타임아웃 시 중복 실행·과금  〔결함·P2·추정〕
- **위치**: `cron-ai-schedule-runner.ts:82-116`
- **fix**: 픽업 직후 next_run_at 선점 UPDATE(affectedRows=0이면 스킵) 후 AI 호출.

### [SU-039] 발송 큐 디스패처 '작업' 픽업에 선점 없음 — 작업 중첩 시 수신자 스냅샷 중복 INSERT  〔결함·P2·추정〕
- **위치**: `cron-communication-send-dispatcher.ts:155-224·320-530`
- **fix**: 1단계 픽업을 원자적 claim(`UPDATE ... SET status='processing' WHERE status='pending' RETURNING`)으로.

### [SU-040] 딥릴리프 외부수집 cron이 background 실패해도 last_cron_at 갱신 — 다음 2주 누락  〔결함·P2〕
- **위치**: `cron-martyrdom-external.ts:83-101`
- **fix**: background 트리거 2xx 성공 시에만 last_cron_at 갱신.
- 확신도: 확실

### [SU-041] 카카오 템플릿 미지/신규 상태가 'registered'로 강등 — 검수중 템플릿 후퇴  〔결함·P3·추정〕
- **위치**: `cron-kakao-template-status.ts:17-24·57-58`
- **fix**: 미지 상태는 현 상태 유지(매핑 실패 시 continue)·알려진 4종만 갱신.

### [SU-042] AI 스케줄러 cron 파서가 요일/일 필드 미지원 — 주간/요일 예약이 매일 실행  〔결함·P3〕
- **위치**: `cron-ai-schedule-runner.ts:21-51`(calcNextRunAt)
- **fix**: day-of-week/month 파싱 또는 미지원 패턴 등록 거부·UI 지원범위 명시.

---

## 영역 7 — SSO·시스템 환경·세션

### [SU-043] AI 월 비용/요청 한도를 슈퍼어드민이 화면에서 못 바꿈(env 의존)  〔갭·P2〕
- **위치**: `lib/ai-cost-monitor.ts:159-182`·`lib/ai-rate-limit.ts:27-29`
- **증상**: 한도 초과로 AI 멈추면 슈퍼가 직접 못 풀고 개발자가 env 수정+재배포해야 복구. 안내문은 '관리자가 한도 조정'이라 하나 화면 없음.
- **fix**: 한도를 site_settings/시스템설정 테이블로 옮겨 AI 비용 화면에서 조정, env는 폴백.

### [SU-044] SSO 시크릿·이메일·JWT 등 시스템 환경설정 관리/진단 화면 부재  〔갭·P2〕
- **위치**: 해당 화면/API 없음(admin-site-settings는 콘텐츠만)
- **증상**: SSO 500 등 운영 장애 시 '시크릿이 비었는지' 슈퍼가 화면에서 확인 불가. §6.18 운영자립 원칙과 어긋남.
- **fix**: 최소 '시스템 환경 상태 점검' 읽기전용 화면(키 설정됨/미설정·SSO URL·발신주소 마스킹) 통합 CMS 추가.

### [SU-045] SSO 토큰에 jti(일회용 식별자) 없음 — 60초 창 내 재사용 차단 불가  〔결함·P2〕
- **위치**: `sso-on.ts:35-46`·`sso-si.ts:32-43`
- **fix**: sign에 jwtid(jti) 추가해 SP가 1회 소비로 재사용 차단.

### [SU-046] 역할 NULL인 type=admin이 허브에서 SUPER ADMIN 표기 + 슈퍼 전용 카드 노출  〔결함·P2·추정〕
- **위치**: `admin-me.ts:79-80`·`public/js/admin-hub.js:56-61`
- **근거**: `role: guard.ctx.member.role || "super_admin"` — NULL이면 super 승격. schema role 기본값 없음.
- **fix**: 폴백을 최소권한(operator)으로 또는 로그인 단계 정규화 + 대상 페이지 서버 재검증.

### [SU-047] 허브 첫 화면이 KPI 집계 1건 실패에도 인증된 슈퍼어드민을 로그인으로 튕김  〔결함·P3〕
- **위치**: `public/js/admin-hub.js:35-43`·`admin-me.ts:32-93`
- **fix**: 허브 인증확인을 `admin-me?light=1`(KPI 생략)로 또는 KPI 실패 시 빈값 강등(§6.2).

### [SU-048] 함께워크 SI(sso-si) env가 .env.example 누락 + ON 기본 URL 문서 불일치  〔갭·P3〕
- **위치**: `.env.example:59-60`(SIAX_SSO_SECRET·HAMKKE_SI_URL 없음)·`sso-on.ts:20`
- **fix**: .env.example에 SI 키 추가·ON URL을 withon.tbfa.co.kr로 정정.

---

## 메인 수합 메모 (R45-MASTER 작성 시)
- **근본 1건이 다수 차단**: SU-001(elevate DB role) fix가 SU-002·SU-009·SU-019 + blast 함수(milestone-revenue·org-news·payroll-settings)를 동시 해소. 단 SU-005(시드 정합)를 **elevate fix 전 선행**해야 운영자 기능 회귀 안 남.
- **권한 게이트 패턴 통일**(가장 반복되는 결함): "민감 판정은 `ctx.member.role`(DB)·`requireRole(ctx.member,…)`로만, `ctx.admin.role`(JWT) 직접비교 금지" — A·B 영역에도 같은 패턴 다수 예상.
- **감사로그 강화 묶음**: SU-018(super 전용)·SU-023(권한변경 기록)·SU-025(reveal 연동)·SU-026(위험등급 매핑) = 한 PR로.
- **cron 멱등 묶음**: SU-035~SU-042 = 발송/스케줄 선점·toml 등록 한 묶음.
- A·B·C 보고 도착 시 경계 항목(권한 게이트·IDOR) 교차 재배정.
