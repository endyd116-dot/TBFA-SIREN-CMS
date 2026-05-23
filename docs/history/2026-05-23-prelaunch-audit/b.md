# 🟨 B 영역 전수 검수 리포트 — 워크스페이스 + 근태 + 성과/급여 + AI

> 2026-05-23 / 검수자: B 채팅(Sonnet, 읽기전용) / 워크트리 `tbfa-mis-B`
> 방식: 4개 하위영역(워크스페이스·근태·성과급여·AI)을 각 심층 검수 + 인프라(크론 등록) 교차검증. 핵심 P1은 메인 직접 재확인.
> **검수만·코드 수정 0건.** 모든 발견은 `파일:줄` + 증상 + 기대 + 근거 기반.
> 검수 베이스: 브랜치 `fix/r40-kicc-spec`(B 도메인 코드는 `origin/main`과 diff 0 — 검수 결과 main에 그대로 유효).

---

## 요약: **P0 0건 / P1 12건 / P2 23건**

| 하위영역 | P0 | P1 | P2 |
|---|---|---|---|
| 워크스페이스 | 0 | 4 | 7 |
| 근태 | 0 | 2 | 6 |
| 성과/급여 | 0 | 4 | 5 |
| AI | 0 | 1 | 5 |
| 인프라(크론 등록·교차) | 0 | 1 | 0 |
| **합계** | **0** | **12** | **23** |

**한 줄 총평**: 운영 즉시 다운·데이터 유실·보안급(P0)은 없음. 다만 **사용자 화면에서 기능이 조용히 안 도는 워크플로우 단절(P1)** 이 분산돼 있고, 특히 ① 운영자 목록 응답 이중 래핑(토스·멘션 드롭다운 빈 채), ② 급여/AI/근태 크론 7종 netlify.toml 미등록(자체 config만 의존), ③ 분기 경계 누락으로 성과 보너스 오생성 가능, ④ 급여 설정 seed 행 미확인이 **오픈 전 점검 필수**.

---

## 검수한 워크플로우 (시나리오 + 결과)

### 워크스페이스
- 칸반 카드 생성→지시→알림→활동로그: **PASS**
- 카드 done 이동→AI 완료보고서/마일스톤 매칭→원본 서비스 closed 동기화: **PASS**(재매칭 가드는 P2)
- 보관 카드 모달 "복원" 버튼: **이슈 P1**(없는 컬럼 갱신)
- 캘린더 이벤트→RSVP: **PASS**(2개 시스템 분리는 P2)
- 파일 presign→confirm→download→공유→soft delete→복원→purge→30일 cron: **PASS**
- 폴더 trash/restore/재귀 soft delete: **PASS**
- 템플릿→카드 생성(빈 값만 채움+usageCount): **PASS**
- 카드 토스(인계)→이력+담당자+알림: 서버 **PASS** / 운영자 셀렉트 비어 실사용 불가 **P1**
- @멘션→멘션 드롭다운: **이슈 P1**(카드 본문 멘션 미표시)
- 댓글 작성→멘션/알림: **PASS**
- 워처 등록/해제→마감 리마인더 cron: **PASS**
- 알림 목록/읽음: **PASS**

### 근태
- 출근 체크인→위치검증(OFFICE/FIELD)→근무형태(override>schedule>default)→지각판정→기록→알림→REMOTE 자동카드: **PASS**(FIELD 거점 미선택 422 흐름까지)
- 상태조회 4종 병렬→렌더: **PASS**
- 퇴근 체크아웃→근무시간/초과/조퇴 계산→REMOTE 보고서 안내: **이슈**(비-REMOTE도 안내 노출 P2)
- 휴가 신청→잔여검증→충돌검증→PENDING→승인 시 used_days+att_records LEAVE: **이슈**(다건 PENDING 합산 미검증 P1)
- 휴가 잔여/이력/종류 조회: **PASS**
- 근무형태 변경신청→슈퍼어드민 알림: **PASS**
- 외근/재택 보고서(DRAFT/SUBMITTED/AI초안): **PASS**
- 정정요청→슈퍼어드민 알림→이력: **PASS**
- 지각/연속재택/만근 cron: 로직 **PASS**(raw SQL 컬럼 스키마 일치) / 일부 cron 미등록은 인프라 항목

### 성과/급여
- 급여 월간 cron 집계→명세서 DRAFT→공제→검토/승인→SENT→PAID→직원 PDF: **PASS**(상태전이 정상)
- 직원 본인 급여만 조회(타인 차단): **PASS**(payroll-my `memberUid=me.id` 강제, PDF 소유권+SENT/PAID 이중검증)
- 급여 산식 일관성(집계 vs 편집 vs PDF vs CSV): **이슈**(force 재집계 시 조정라인/기타공제 정합 깨짐 P1)
- 마일스톤 정의→분기→역할→매출입력→4-eye 검증→결산→승인→PAID→다음분기 자동: **PASS**(셀프검증 방지·결산 후 입력차단 견고)
- 매출 인센티브 계산(dashboard 추정 vs settlement 확정): **PASS**(FLAT/PERCENT/BRACKET/EVENT_RANGE·SI 공유임계 동일 공식)
- WBS 카드↔마일스톤 매칭→비매출 성과 자동제출→진척률: **이슈**(목표달성 카운트 분기 필터 누락 P1×2)
- 결산 분기보너스→급여 성과보너스(/3 안분): **PASS**(PAID 결산만, snapshot 보존)

### AI
- 카드 생성→AI 작업요약(background, 30자 미만 스킵): **PASS**
- done 이동→완료보고서 초안(fire-and-forget): **PASS**
- 비매출 마일스톤 AI 자동매칭(신뢰도 90%+): 로직 **PASS**(featureKey 미등록은 P2)
- 매일 작업 리스크 점수 cron: 로직 **PASS** / **cron 미등록(인프라 P1)**
- Agent-8 일일 브리핑: 로직 **PASS** / **cron 미등록(인프라 P1)**
- Agent-9 주간 보고서: **이슈 P1**(super_admin 수신자 식별 컬럼 오류)
- AI 비용 로그→임계 알림 cron→차단: **PASS**(5층 방어)
- 수동 재생성(`/api/admin-task-ai-regenerate`): **PASS**
- AI 비서 채팅(tool calling 최대 4스텝): **PASS**(무한루프·비용폭주 방지·dry-run·PII 마스킹 완비)

---

## 발견사항

### 🔴 P1 (기능 오작동·워크플로우 단절 — 사용자 영향)

- **[P1][공통-인프라] 운영자 목록 API 응답 이중 래핑 → 카드 토스 셀렉트가 빈 채로 토스 불가** | 위치 `netlify/functions/admin-workspace-member-list.ts:45` + 소비처 `public/js/workspace-task-modal.js:246-260` | 기대: 토스 모달에 다른 운영자 목록이 채워짐 | 근거: 서버가 `ok({ data: rows })` 반환 → `ok()` 헬퍼(`lib/response.ts:21-26`)가 `{ok,message,data}`로 한 겹 더 감싸 실제 응답은 `data.data`에 배열 위치. 그런데 **이 함수 자신의 JSDoc(9줄)은 `응답: { ok, data: [...] }`(배열 직접)을 명시** → 의도와 구현 불일치. task-modal은 `res.data.items || res.items || res.data || []`로 읽어 `res.data`(={data:rows} 객체) → Array 아님 → 셀렉트 비어 토스 불가.

- **[P1][워크스페이스] 칸반 @멘션 자동완성 운영자 목록이 비어 동작 안 함** | 위치 위 member-list 응답 + 소비처 `public/js/workspace-kanban.js:1561` | 기대: `@` 입력 시 운영자 자동완성 | 근거: `res.data?.items || res.data || res.items || []` → `res.data`(={data:rows}) 객체라 빈 배열. **대조: `public/js/workspace-files.js:616`은 `res.data?.data`를 첫 fallback으로 써서 정상** → 동일 API를 클라마다 다르게 파싱(files.js가 정답). 위 토스 P1과 **동일 근본원인(이중 래핑)** — 수정 1곳으로 둘 다 해소 가능.

- **[P1][워크스페이스] 카드 본문(제목/설명) @멘션이 멘션 드롭다운에 영원히 미표시** | 위치 저장 `netlify/functions/admin-workspace-tasks.ts:115-123`(`workspace_id`에 `0` INSERT) vs 조회 `public/js/workspace.js:1483`(`workspaceId = currentWorkspaceId || 1`) + `netlify/functions/workspace-task-mentions.ts:27`(`if(workspaceId) WHERE workspace_id=N`) | 기대: 카드 제목/설명 `@이름` 시 대상자 드롭다운 표시 | 근거: 카드 본문 멘션은 `workspace_id=0` 저장인데 프론트는 `workspaceId=1` 조회 → 안 잡힘. 댓글 멘션은 `workspaceId:1` 저장(`admin-workspace-task-comments.ts:214`)이라 정상 → **동일 멘션 테이블에 두 경로의 workspace_id(0 vs 1) 불일치**가 근본 원인.

- **[P1][워크스페이스] 보관 카드 모달 "복원" 버튼이 동작하지 않음** | 위치 `netlify/functions/admin-workspace-tasks.ts:903-924`(action=restore) + `public/js/workspace-kanban.js:752` | 기대: 보관 카드를 복원하면 활성 상태로 돌아옴 | 근거: action=restore가 `db.update(workspaceTasks).set({ deletedAt: null })`(906-913) 실행하는데 **`workspace_tasks` 테이블에 `deletedAt`/`deleted_at` 컬럼이 없음**(정의 `db/schema.ts:1590-1649`, deleted_at은 folders 1845·files 1872·comments 1911 등 다른 테이블에만 존재). 보관은 `status='archived'` 기반이라 restore가 갱신해야 할 컬럼 자체가 틀림 → SQL 에러 또는 무동작(둘 다 복원 안 됨). 정상 경로는 `action=unarchive`(드래그 보관해제 `workspace-kanban.js:552`가 실제로 사용). 모달 복원 버튼만 잘못된 액션 호출.

- **[P1][근태] 휴가 다건 동시 신청 시 잔여 초과 가능(잔여 음수)** | 위치 `netlify/functions/att-leave-request.ts:101-125` | 기대: 신청 일수가 (총휴가−used_days−**승인대기 PENDING 합**)을 넘으면 차단 | 근거: 잔여 검증이 `att_leave_balances`의 `totalDays-usedDays`만 봄. `used_days`는 승인 시점에만 증가(`admin-att-leave-review.ts:145-146`) → 겹치지 않는 PENDING 여러 건이 각각 통과 → 전부 승인 시 `used_days > total_days`. 날짜겹침 검사(128-149)는 동일 기간 중복만 막고 누적 합은 못 막음.

- **[P1][근태] 입사 1주년 연차 부여가 만근 보너스를 덮어쓸 수 있음** | 위치 `netlify/functions/cron-att-leave-auto.ts:107,144-150` | 기대: 1주년 부여와 만근 누적이 상호 보존 | 근거: 같은 cron 실행에서 만근 직원은 `total_days+1`(107) 후, 1주년이면 `GREATEST(total_days,15)`(149)로 재설정 → 가입 후 1년+만근 동시 직원은 만근 +1이 무시되고 15로 고정 가능(동월 발생 시 잔여일 손실).

- **[P1][성과] 비매출 성과 자동제출 분기 경계 누락(수동 매칭)** | 위치 `netlify/functions/workspace-milestone-task-match.ts:93-99` | 기대: 목표 달성 카운트는 현재 분기(`completed_at` BETWEEN start~end) 완료 카드만 | 근거: SQL이 `status='done'`+매칭상태만 보고 분기 기간 필터 없음 → 이전 분기 완료 카드까지 누적 합산 → 목표 도달 오판 → 엉뚱한 분기 비매출 성과(보너스) 자동 생성. 같은 함수 progress 조회는 분기 필터 적용하는데 이 카운트만 누락.

- **[P1][성과] 비매출 성과 자동제출 분기 경계 누락(AI 자동 매칭)** | 위치 `netlify/functions/ai-task-milestone-match-background.ts:172-178`(`checkAndAutoSubmitAchievement`) | 기대: 주석대로 "이 분기 내 완료 카드 수"만 카운트 | 근거: 주석은 분기 한정이나 실제 SQL에 `completed_at` 분기 범위 조건 없음 → 위와 동일 버그가 AI 경로에도. 신뢰도 90%↑ 자동매칭 후 누적 done 전체로 목표 판정 → 성과 보너스 오생성.

- **[P1][급여] force 재집계 시 조정라인·기타공제 정합 깨짐** | 위치 `lib/payroll-calc.ts:190,194-196` vs `netlify/functions/admin-payroll.ts:201-204` | 기대: 재집계 grossPay/netPay가 명세서의 조정라인(adjustments)·기타공제(otherDeduction)와 일치 | 근거: 어드민 편집 공식은 `gross=...+adjAdd−adjDeduct`, `totalDeduction=...+otherDeduction` 포함하나 집계(calc) 공식은 둘 다 미반영. force 재집계는 grossPay/totalDeduction/netPay만 calc로 덮어쓰고 `adjustments`/`other_deduction` 컬럼은 유지 → 조정라인은 남아있는데 세전/실수령엔 빠진 모순(PDF·CSV도 라인 표시되나 합계 미반영). 첫 집계 땐 0이라 무해, 수동 조정 후 force 재집계 시 금액 불일치.

- **[P1][급여] 급여 계산기준 설정 저장이 seed 행 없으면 무동작** | 위치 `netlify/functions/admin-payroll-settings.ts:51-68`(UPDATE WHERE id=1, INSERT 없음) | 기대: 설정 PUT이 항상 저장(행 없으면 UPSERT) | 근거: PUT이 `UPDATE payroll_settings ... WHERE id=1 RETURNING *`만 수행. `drizzle/`에 payroll_settings seed 없고(초기 SQL 3개뿐, payroll 마이그레이션은 1회용 함수로 추정·삭제) 코드 INSERT seed도 없음. id=1 행 미존재 시 0행 갱신·빈 RETURNING → "저장 완료" 표시 후에도 미저장. 집계는 `loadPayrollSettings` 기본값 fallback이라 동작하나 **요율 변경이 영구 반영 안 됨**. → **오픈 전 `SELECT * FROM payroll_settings WHERE id=1` 확인 필수.**

- **[P1][AI] Agent-9 주간 보고서 super_admin 수신자 식별 컬럼 오류** | 위치 `netlify/functions/cron-agent-9.ts:134-137`(`.where(eq(members.memberSubtype,"super_admin"))`) | 기대: super_admin 운영자들에게 주간 보고서 메일 발송 | 근거: 이 프로젝트에서 super_admin은 `members.role` 값(`db/schema.ts:178`, `cron-agent-8.ts:285` `inArray(members.role,["admin","super_admin"])`, `cron-att-ai-daily.ts:108` `eq(members.role,"super_admin")` 모두 role 사용). `member_subtype`(schema.ts:209)은 회원 4분류(lawyer/counselor 등)용이라 super_admin 값 거의 없음 → 주간 보고서가 `ADMIN_NOTIFY_EMAIL` 한 곳만 가고 실제 super_admin들에겐 누락(메일 자체는 발송되므로 완전 단절은 아님 — 수신자 누락).

- **[P1][인프라-크론] AI·급여·근태·워크스페이스 cron 7종이 netlify.toml 미등록(자체 `export const config` 만 의존)** | 위치 `netlify.toml`(전체 231줄 확인) vs 각 함수 자체 config | 기대: netlify.toml line 173-174 팀 정책 "자체 config가 **일부 환경에서 인식 안 됨** → toml에도 명시해 이중 등록"에 따라 중요 cron은 이중 등록 | 근거: **미등록 7종** = `cron-agent-8`(일일브리핑, 자체 333줄)·`cron-task-risk`(리스크점수, 144줄)·`cron-payroll-monthly`(급여 월집계, 20줄)·`cron-milestone-quarter`(분기 자동생성, 7줄)·`cron-att-late-streak`(17줄)·`cron-att-remote-streak`(18줄)·`cron-workspace-trash-cleanup`(165줄). cron-agent-9·cron-att-morning/evening/ai-daily/leave-auto·cron-workspace-task-reminder/due-reminder 등 동급 cron은 모두 toml 이중 등록됨. 자체 config가 운영 환경에서 안 먹으면 **급여 월집계·일일 브리핑·분기 자동생성·휴지통 정리가 영구 무동작**(CLAUDE.md §8은 trash-cleanup·agent-8·task-risk를 "운영중"으로 기재 → 실제 발화 여부 운영 환경 직접 확인 필요). **오픈 전 Netlify 대시보드 Scheduled Functions 목록에 7종 등재 여부 확인 권장.**

### 🟡 P2 (개선·정합·UX·dead code)

#### 워크스페이스
- **[P2] 캘린더 프론트 mock 데이터 fallback 잔존** | `public/js/workspace-calendar.js:16-28`(MOCK_EVENTS/RSVPS/GCAL), `:254`/`:415` catch→mock. API 일시 500/네트워크 오류 시 운영 화면에 "운영회의/예시 메모" 가짜 이벤트 노출. 동일 패턴 `workspace-kanban.js:26,35`(MOCK_AI_RESULT/MOCK_PREFS, 322·1180 fallback).
- **[P2] RSVP 2개 독립 시스템 분리** | `admin-workspace-events.ts:361-413`(events.attendees JSONB, accepted/declined/invited) vs `workspace-event-rsvp.ts`(workspace_event_rsvps 테이블, yes/no/maybe). 캘린더 프론트는 테이블 시스템만 사용 → attendees 기반 충돌검증/통계와 데이터 분산, status enum도 상이.
- **[P2] 카드 done 시 마일스톤 재매칭 가드가 항상 통과(스네이크케이스 오타)** | `admin-workspace-tasks.ts:657` `!task.milestone_def_id` — drizzle `.select()`는 camelCase(`milestoneDefId`) 반환이라 항상 undefined → `!undefined`=true → 이미 매칭된 카드도 done마다 AI 매칭 트리거(불필요 비용, fire-and-forget이라 장애 아님).
- **[P2] trash-cleanup cron blob orphan 정리가 워크스페이스 파일과 미연결 가능성** | `cron-workspace-trash-cleanup.ts:85-109`(blobUploads.context="workspace") vs `admin-workspace-file-presign.ts:83-99`(blob_uploads INSERT 안 하고 workspace_files만 기록) → orphan 정리 대상이 실제 업로드와 미매칭(데이터 유실은 없으나 죽은 로직 가능).
- **[P2] workspace-file-share.ts POST에 대상 소유권/존재 검증 없음** | `netlify/functions/workspace-file-share.ts:21-57` — targetType/targetId/sharedWith만 받아 바로 INSERT, 본인 소유 아닌 파일/없는 targetId도 허용(운영자 전용 API라 위험 낮음, 다운로드 측 재검증 존재).
- **[P2] 다중 leftJoin 체인(CLAUDE.md §6.3 권고 위반, 경미)** | `admin-workspace-task-attachments.ts:61-64`(workspaceFiles+members 2단 leftJoin). 단순 1:1 2개라 실위험 낮음.
- **[P2] 네이밍 혼동: `admin-workspace-management.{html,js}`는 워크스페이스가 아니라 근태 관리 화면** | `public/js/admin-workspace-management.js` 전체가 `/api/admin-att-*` 호출. 도메인 오해 유발(근태 어드민 UI). → 아래 "검수 못한 영역" 참고.

#### 근태
- **[P2] 비-REMOTE 직원 퇴근 시에도 "재택보고서 작성" 안내 노출** | `att-checkout.ts:103` + `public/js/workspace-attendance.js:372-377` — 서버는 REMOTE일 때만 reportSubmitted 갱신, 그 외 기본 false 반환. 프론트는 `reportSubmitted===false`면 무조건 토스트 → OFFICE/FIELD/출장 직원도 매 퇴근마다 잘못된 안내.
- **[P2] att-my-leaves.ts 는 프론트 미사용 dead endpoint** | `netlify/functions/att-my-leaves.ts` 전체 — 프론트 휴가 잔여는 `att-leave-balance`(workspace-attendance.js:544) 사용. grep 호출 0건, 응답 구조도 다름.
- **[P2] REMOTE 출근 자동생성 WBS 카드가 AI 초안 수집에서 누락** | `att-checkin.ts:222-231`(member_id만, assigned_to null) vs `att-ai-draft.ts:49`(`eq(assignedTo, memberId)`만 수집) → 자기 자동카드를 AI가 인식 못 함(초안 품질 저하).
- **[P2] config path 명명 불일치(`/api/att-X` vs `/api/att/X` 혼용)** | `att-remote-report.ts:7`(`/api/att/remote-report`)·`att-ai-draft.ts:7`·`att-ai-insight.ts:7`·`att-export.ts:6` vs 나머지 16개 `/api/att-X`. 프론트 호출과는 정확 일치(동작 문제 없음), 신규 추가 시 혼동 위험.
- **[P2] cron-att-leave-auto 입사일 대용 createdAt(가입일) 사용** | `cron-att-leave-auto.ts:129-135` — members에 hire_date 없어 가입일로 1주년 판정. NPO 현 규모는 가입=채용이라 동등하나 외부채용/계정 후부여 시 부정확(주석에 한계 명시·알려진 제약).
- **[P2] operator-guard 권한 경계 광범위(보안 문제 아님, 참고)** | `lib/operator-guard.ts:80-90` `type==="admin" || operatorActive===true`면 통과. 본인 데이터만 다루는 API라 안전, att-export는 타인 export를 super_admin/admin에만 허용(정합).

#### 성과/급여
- **[P2] 결산 제출 자격자와 cron 알림 대상 불일치** | `cron-milestone-quarter.ts:62,86-87`(`type='admin' AND milestone_role IS NOT NULL`) vs `milestone-revenue.ts:13`/`milestone-settlement.ts`(`requireOperator` — operatorActive 일반회원도 결산 가능) → operatorActive 운영자가 D-7·미제출 에스컬레이션에서 누락.
- **[P2] dashboard 비매출 추정치 개수 상한 미적용** | `milestone-dashboard.ts:161-163`(isSelectedForQuarter 전부 합산) vs `milestone-settlement.ts:219`(2개 초과 에러). select API가 2개 제한이라 정상흐름은 일치, 데이터 이상 시 추정치≠결산.
- **[P2] workspace 진척률 pending 카운트 분기 상한 누락** | `workspace-milestone-progress.ts:101` `completed_at >= start_date`만(end_date 상한 없음) → 분기 종료 후 완료 미분류 카드도 현재 분기 대기로 집계.
- **[P2] payroll-my 응답에 지각/결근 미포함** | `payroll-my.ts:45-78` SELECT에 lateCount/absentCount 없음(PDF는 전체 select라 표시). 현 화면 미사용이라 영향 없음 — 정합 차원.
- **[P2] 급여 명세서 status 컬럼 주석에 PAID 누락** | `db/schema.ts:3833` 주석은 `DRAFT|REVIEWED|APPROVED|SENT|HOLD`인데 코드는 PAID 상태 set/조회(admin-payroll.ts paid 액션). 동작 영향 없는 문서-코드 불일치.

#### AI
- **[P2] 비용 통제(어드민 토글·기능별 월한도)에서 빠지는 미등록 featureKey 8종** | `ai-task-milestone-match-background.ts:111`(milestone_match)·`ai-milestone-insight.ts:70,112,148,191`(milestone_insight)·`att-ai-draft.ts:109`(att_remote_draft)·`att-ai-insight.ts:143`(att_ai_insight)·`cron-att-ai-daily.ts:90`(att_ai_daily_summary)·`cron-ai-schedule-runner.ts:59`(schedule_runner)·ms-ai-classify/coaching. `lib/ai-feature.ts:30-58` FEATURE_REGISTRY 15개에 미포함 → `isKnownFeature` false → `ai-gemini.ts:229-230` 경고만 찍고 호출. 전체 월한도·rate limit·surge는 적용되나 **개별 토글·기능별 한도 불가**, 비용 화면 카탈로그 누락.
- **[P2] cron-ai-schedule-runner가 사용자 자유입력 명령을 10분마다 무제한 AI 실행** | `cron-ai-schedule-runner.ts:58-62,79-85`(ai_scheduled_commands.command를 callGemini에 그대로, LIMIT 50). featureKey 미등록이라 기능별 차단 불가. 텍스트 생성만(도구 미실행)이고 전체 한도로 막혀 P2이나, 활성 스케줄 많으면 10분마다 최대 50건 누적.
- **[P2] recordFeatureUsage가 usage 메타데이터 없으면 비용 집계 자체 스킵** | `lib/ai-gemini.ts:262-275`(`if(result.usage){...}`) — Gemini가 usageMetadata 안 주면 성공해도 ai_usage_logs/ai_cost_summary INSERT 안 됨 → call_count 과소 집계(비용은 0).
- **[P2] 전체 월한도 차단 시 cron이 AI를 데이터 폴백으로 조용히 강등** | `lib/ai-cost-monitor.ts:175-181` + 각 cron fallback. 한도 초과 시 호출은 막히나 cron-agent-8/9·att-ai는 폴백(fallbackBriefing 등)으로 계속 → "AI 분석"이 "수치 요약"으로 강등됨을 운영자가 인지 못할 수 있음(cron-ai-cost-alert 메일이 보완).
- **[P2] 모델 가격표 추정치·폴백 chain 모델명 일부 불일치 + 코드 주석 구 정책 잔존** | `lib/ai-cost-monitor.ts:33-43`(PRICING, 주석에 "공식 가격표 재확인 필요") vs `lib/ai-gemini.ts:41-55`(buildFallbackChain은 gemini-2.5-flash/3.1-flash-lite 경유). 미등록 모델은 `__default`(flash 가격, 보수적)로 계산돼 과소청구 위험 없으나 비용 표시 부정확. ai-gemini.ts:6-8 주석(1차 3-flash→2차 3.0→3차 3.1-lite)이 실제 구현과 불일치(문서 차원).

---

## 검수 못한/불확실 영역 (시간·정보·범위 부족)

1. **운영 DB 시드 데이터 미확인(★오픈 전 점검 필수)**:
   - 급여 `payroll_settings(id=1)` 행 존재 여부 — 위 급여 P1 직결. `SELECT * FROM payroll_settings WHERE id=1` 1회 확인.
   - 근태 `att_policies(isDefault=true)` 행·`att_leave_types` 활성 행·`att_workplaces` 좌표 — 코드는 정책 없으면 500(att-checkin.ts:60), 거점 없으면 위치검증 스킵으로 안전 분기하나 실제 시드 여부 미확인.
2. **크론 7종 실제 발화 여부(★)**: 위 인프라 P1. Netlify 대시보드 Scheduled Functions 목록 직접 확인 필요(정적 검수로는 등재 여부 불가).
3. **어드민 측 화면 미정독**: `admin-att-*`(leave-review/balances/types), `admin-workspace-management.{html,js}`(실제 근태 어드민 UI), `admin-milestones.js`·`admin-payroll.js`·`admin-ai-cost.html`·`admin-ai-config.html` 의 응답키 unwrap·렌더링 정합은 config path·가드 존재(전수 grep 0 누락)만 확인하고 라인별 대조 미수행.
4. **JWT payload role 포함 여부**: `admin-ai-agent.ts:649`가 super_admin 전용 도구 권한을 `ctx.admin.role`(JWT)에 의존하나 requireAdmin은 `type==="admin"`만 검증(`admin-guard.ts:25`)·role 미검증. JWT에 role 미탑재 시 super_admin 전용 도구(환불/승인 등)가 거부 또는 통과될 수 있음 — `lib/auth.ts`의 AdminPayload 미정독.
5. **CHURN_AI_DISABLED kill-switch 실구현**: netlify.toml:134 주석은 명시하나 churn-predictor 코드에 해당 env 참조가 grep 미검출 — `ai_feature_settings` 토글로 대체됐을 가능성(cron-churn-predictor.ts 본문 미정독).
6. **Kakao 지오코딩 실호출**: att-geocode/geocode-search 로직은 키 미설정 503 분기까지 정합하나 KAKAO_REST_API_KEY/JS_APP_KEY 실제 등록·라이브 호출 결과는 정적 범위 밖.
7. **금액 반올림 누적오차**: payroll calc·PATCH 모두 소수 2자리 반올림, PDF·화면은 원 단위 추가 절사 → 구성요소 합 표시와 합계 표시가 1원 단위 어긋날 수 있으나 DB 저장값은 정합(미세 표시오차·실측 미수행).
8. **iframe 4곳 라우팅 등록**: B 도메인 페이지(workspace 계열)의 iframe 임베드 여부는 인프라(C 영역) 교차 필요 — 본 검수 미포함.
9. **실거래/런타임 재현**: 읽기전용 범위라 위 P1들은 라이브 재현 미수행 — 메인 수정 라운드 착수 전 재현 확인 권장.

---

## 메인 취합용 우선 메모

- **즉시 fix 권장 P1**: ① 운영자 목록 이중 래핑(member-list.ts:45 — 토스+멘션 2개 동시 해소) ② 카드 본문 멘션 workspace_id 0/1 통일 ③ 보관 복원 버튼(restore→unarchive) ④ 비매출 분기 경계 누락 2건(보너스 오생성) ⑤ 크론 7종 toml 등록.
- **오픈 전 DB 확인**: payroll_settings(id=1) seed, 근태 기본 정책/거점/휴가종류 시드.
- **근본원인 중복**: 워크스페이스 P1 중 토스·멘션 2건은 `ok({data})` 이중 래핑 한 곳이 원인 — 수정 1회로 둘 다 해소.
- **B 도메인 코드는 origin/main과 diff 0** → 본 리포트 그대로 main에 유효.
