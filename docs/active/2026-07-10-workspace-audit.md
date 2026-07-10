# 워크스페이스·근태 전수감사 보고서

> 2026-07-10 · 읽기전용 코드 감사(칸반·캘린더·파일함·홈/알림·마일스톤·근태·급여·AI 비서 8개 영역)
> 인터랙티브 보고서(필터·검색): 아티팩트 참조

## 통계

- 총 **172건** — P1 치명·긴급 **37** / P2 중요 **70** / P3 경미 **65**
- 영향 큰 P1 **10건**은 실제 코드 직접 재확인(검증됨)


---

# P1 (37건)

## P1 · AI 비서 (8)

### #1 [누락기능] AI 비서로 작업을 '완료' 처리하면 완료 후속처리 5종이 통째로 건너뛰어짐 — 특히 신고 연계 작업이면 원본 사건이 계속 '진행중'으로 남음
- **위치**: `lib/ai-agent-tools.ts:1996`
- **설명**: 운영자가 AI 비서에게 "작업 12번 완료 처리해줘"라고 하면 칸반 카드 상태는 done으로 바뀌지만, 본 화면에서 완료할 때 자동으로 일어나는 일들이 전부 생략된다: ① 지시자·소유자에게 가는 '작업 완료' 알림 ② 완료 보고서 AI 초안 자동 생성 ③ 비매출 마일스톤 자동 매칭(성과 집계) ④ 사건·괴롭힘·법률 신고에서 파생된 작업이면 원본 신고 자동 종결 동기화 ⑤ 팀 활동 피드 기록. 신고자 입장에서는 담당 작업이 끝났는데 자기 신고는 영원히 '처리중'으로 보이는 결과가 된다.
- **근거**: tool_taskUpdate(lib/ai-agent-tools.ts:1953-2001)는 UPDATE workspace_tasks 후 바로 return — 파일 전체에 workspace-logger·logTaskChange·triggerAiCompletion·triggerMilestoneMatch·closeServiceFromTask 참조 grep 0회. 본 API admin-workspace-tasks.ts action=status는 logTaskChange(660-673)+triggerAiCompletion(683)+triggerMilestoneMatch(688)+closeServiceFromTask(697-708)를 모두 수행.
- **권장조치**: tool_taskUpdate의 done 전환 분기에서 본 API와 동일하게 logTaskChange(알림 포함)·triggerAiCompletion·triggerMilestoneMatch·closeServiceFromTask를 호출하거나, AI 도구가 직접 DB UPDATE 대신 본 API의 상태변경 로직을 공용 lib로 추출해 양쪽이 같은 경로를 타게 통합.

### #2 [누락기능] AI 비서로 다른 운영자에게 작업을 지시(task_create + assignedTo)해도 담당자에게 알림이 전혀 가지 않음
- **위치**: `lib/ai-agent-tools.ts:1584`
- **설명**: 운영자가 AI 비서에게 "이 작업을 김OO에게 배정해서 만들어줘"라고 하면 카드가 생성되긴 하지만, 본 화면 생성 시 자동 발송되는 '📋 새 작업이 지시되었습니다' 인앱 알림, 팀 활동 피드 기록, 감사 로그, 설명 100자 이상 시 AI 요약 자동 생성, 본문 @멘션 알림이 전부 생략된다. 지시받은 사람은 우연히 칸반을 열어보기 전까지 지시 사실 자체를 모른다.
- **근거**: tool_taskCreate(1565-1597)는 INSERT INTO workspace_tasks 후 즉시 return. 본 API POST(admin-workspace-tasks.ts:566-604)는 logAudit(566)+logTaskChange 알림(577-589)+triggerAiSummary(592)+parseMentionsAndNotify(597) 수행. ai-agent-tools.ts 전체에서 workspace-logger·workspaceNotifications·logActivity grep 0건 확인.
- **권장조치**: tool_taskCreate 실제 실행 분기에 lib/workspace-logger.ts의 logTaskChange 호출 추가(assignedTo 있으면 notifyMemberIds 지정). 최소한 알림 1종은 필수.

### #3 [누락기능] AI 비서로 작업 댓글을 달면 @멘션 알림·멘션함·소유자 알림이 전부 무시됨 — 멘션 인자를 받고도 저장만 하고 안 보냄
- **위치**: `lib/ai-agent-tools.ts:2674`
- **설명**: AI 비서에게 "작업 9번에 '김OO님 검토 부탁해요' 댓글 달고 김OO 멘션해줘"라고 하면 댓글은 저장되지만, 본 화면 댓글과 달리 ① 멘션된 사람에게 인앱 알림 없음 ② 멘션함(멘션 수신 목록) 기록 없음 ③ 작업 소유자·지시자에게 댓글 알림 없음 ④ 팀 활동 피드·감사 로그 없음. 멘션 대상 ID를 인자로 받아 DB에 저장까지 하면서 알림만 빠져 있어, 댓글로 업무를 요청해도 상대는 영영 모른다. 또 본 API에 있는 작업 접근권 검증(소유자·담당자·지시자만 댓글 가능)도 없다.
- **근거**: tool_taskCommentAdd(2652-2686): mentions 배열을 jsonb로 INSERT만(2674-2680). 본 API admin-workspace-task-comments.ts POST는 logWorkspaceActivity(156-170)+멘션·소유자·지시자 sendWorkspaceNotification(173-207)+workspace_task_mentions INSERT(209-223)+logAudit(225-231)+접근권 검증(128-130) 수행.
- **권장조치**: 본 댓글 API의 알림·멘션함 처리 블록을 공용 함수로 추출해 AI 도구에서도 호출.

### #4 [데이터정합] AI 비서로 작업 삭제 시 서브태스크가 고아로 남음 — 본 화면 삭제에 있는 하위 작업 정리(Q3-018 fix)가 AI 경로에는 없음
- **위치**: `lib/ai-agent-tools.ts:2724`
- **설명**: 하위 작업(서브태스크)이 달린 부모 카드를 AI 비서로 삭제하면 부모만 사라지고 하위 카드들은 존재하지 않는 부모를 가리키는 채 영구히 남는다. 본 화면 삭제는 과거 같은 문제를 고치면서(Q3-018) 서브태스크를 먼저 지우도록 되어 있는데 AI 경로는 그 수정을 반영받지 못했다. 삭제 전 미리보기 안내(댓글 N건·보고서 N건·첨부 N건 삭제 예정)에도 서브태스크 수는 빠져 있어 운영자가 삭제 범위를 잘못 안내받는다. 멘션 기록(workspace_task_mentions)도 FK가 없어 양쪽 경로 모두 고아로 남는다(칸반 감사 기발견과 동일).
- **근거**: tool_taskDelete:2724 `DELETE FROM workspace_tasks WHERE id=${id}` 단건만. 본 API(admin-workspace-tasks.ts:1053-1056)는 'parentTaskId는 FK가 아니라 부모 삭제 시 서브태스크가 고아로 남는다' 주석과 함께 서브태스크 선삭제. schema.ts:1604 parentTaskId FK 없음, 3314-3317 workspace_task_mentions.taskId FK 없음. 댓글·보고서·첨부는 FK cascade(schema.ts:1907·1924·1945)로 양쪽 모두 자동 정리됨.
- **권장조치**: AI 삭제에도 `DELETE ... WHERE parent_task_id=${id}` 선행 + preview에 서브태스크 카운트 포함.

### #5 [버그] AI 비서로 작업 담당자를 변경(재지시)하면 '지시' 메타데이터가 안 남아 담당자의 지시함·배지·알림에서 증발
- **위치**: `lib/ai-agent-tools.ts:1972`
- **설명**: 운영자가 AI에게 "작업 15번 담당을 박OO으로 바꿔줘"라고 하면 assigned_to만 바뀌고 지시자(assigned_by)·지시시각(assigned_at)이 기록되지 않는다. 담당자의 칸반 보드에 카드가 조용히 나타나긴 하지만 ① 알림 0건 ② 대시보드 '지시받은 작업' 인박스 카운트에 미집계(assigned_by IS NOT NULL 조건) ③ '나에게 지시된 작업' 패널에 미표시 ④ 누가 지시했는지 표시 불가. 사실상 지시가 전달되지 않은 것과 같다. 또 담당자 해제 요청 시(assignedTo=null) 내부적으로 0으로 변환돼 FK 오류로 실패한다.
- **근거**: tool_taskUpdate:1972 `if (Number.isFinite(Number(args?.assignedTo))) patch.assigned_to = Number(args.assignedTo)` — assigned_by/assigned_at 미설정, 알림 없음. Number(null)===0이라 null 전달 시 assigned_to=0 → members FK 위반. 본 API action=assign(774-798)은 assignedBy=meId·assignedAt=now 설정 + logTaskChange 알림. 인박스 집계 조건은 admin-workspace-tasks.ts:264 `assigned_to=meId AND assigned_by IS NOT NULL`, 패널 조건 394.
- **권장조치**: assignedTo 변경 시 assigned_by=호출자·assigned_at=NOW() 동시 설정 + logTaskChange 알림. null은 명시적 담당 해제로 처리.

### #6 [버그] AI로 만든 '내 작업'에 지시자 정보가 무조건 박혀서, 정작 만든 본인이 칸반 화면에서 삭제할 수 없게 됨
- **위치**: `lib/ai-agent-tools.ts:1588`
- **설명**: 운영자가 AI 비서에게 "내일까지 보고서 작성 작업 만들어줘"라고 개인 카드를 만들면, AI가 담당자 지정 여부와 무관하게 '지시자' 칸에 본인을 항상 기록한다. 본 화면 삭제 규칙은 '지시자 기록이 없는 본인 카드만 삭제 가능'이므로, 이 카드를 칸반에서 지우려 하면 super_admin이 아닌 한 '지시받은 작업은 삭제할 수 없습니다'라는 엉뚱한 거절을 받는다(본인이 만든 개인 카드인데도). 마감일 직접 편집 권한 판정(canEditDueDate)도 같은 이유로 false가 된다. 또 타인 지시 시 소유자 처리도 본 API(소유자=담당자)와 달리 소유자=생성자로 저장돼 두 경로의 데이터 의미가 갈린다.
- **근거**: tool_taskCreate INSERT(1584-1590): `(member_id, ..., assigned_by, assigned_to, ...) VALUES (${adminId}, ..., ${adminId}, ${assignedTo}, ...)` — assigned_by가 무조건 adminId. 본 API(admin-workspace-tasks.ts:524·547-549)는 `ownerMemberId = assignedTo ?? meId`, `assignedBy: isAssignment ? meId : null`. 본 API DELETE 권한(1048) `memberId===meId && !task.assignedBy`, 단건 canEditDueDate(355) 동일 조건.
- **권장조치**: assignedTo가 없으면 assigned_by를 NULL로, 있으면 본 API처럼 member_id=담당자·assigned_by=생성자·assigned_at=NOW()로 저장.

### #7 [보안] AI 비서 경로에서는 지시받은 담당자가 지시자 몰래 작업을 영구 삭제할 수 있음 — 본 화면에서는 금지된 행위
- **위치**: `lib/ai-agent-tools.ts:2704`
- **설명**: 칸반 화면에서는 지시받은 작업을 삭제하려 하면 '지시받은 작업은 삭제할 수 없습니다. 지시자에게 요청하세요'라고 거부된다. 그런데 같은 사람이 AI 비서에게 "작업 20번 삭제해줘"라고 하면 담당자(assigned_to)라는 이유로 삭제가 허용된다. 게다가 삭제 사실이 팀 활동 피드·감사 로그·지시자 알림 어디에도 남지 않아, 지시자는 자기가 시킨 작업이 사라진 것을 알 방법이 없다.
- **근거**: tool_taskDelete:2703-2706 `if (member_id !== adminId && assigned_to !== adminId) 거부` — 담당자 삭제 허용. 본 API DELETE(admin-workspace-tasks.ts:1048-1051)는 `isOwnPersonalTask = task.memberId === meId && !task.assignedBy`로 지시받은 작업 삭제를 금지(super_admin 예외). 본 API는 삭제 후 logWorkspaceActivity(1058)+logAudit(1069) 기록, AI 도구는 둘 다 없음.
- **권장조치**: 본 API와 동일한 삭제 권한 규칙(본인 개인 작업 + super_admin) 적용 + 삭제 활동로그·감사로그·지시자 알림 추가.

### #8 [보안] AI task_update에 소유권 검증이 전혀 없음 — 어느 운영자든 작업 번호만 대면 타인(super_admin 포함)의 작업을 몰래 수정 가능
- **위치**: `lib/ai-agent-tools.ts:1953`
- **설명**: 본 화면에서는 소유자·담당자·지시자·super_admin만 작업을 수정할 수 있는데, AI 비서에게 "작업 7번 상태 done으로 바꿔줘"라고 하면 그 작업이 누구 것이든 검증 없이 수정된다. 활동로그·감사로그도 안 남으므로(위 발견 참조) 다른 운영자의 작업 상태·우선순위·마감일·담당자를 흔적 없이 바꿀 수 있다. 도구 자체는 관리자 role 게이트를 통과한 내부자만 쓸 수 있지만, 운영자 간 경계가 사라진다.
- **근거**: tool_taskUpdate(1953-2001)의 before 조회(1982)는 존재 확인용일 뿐 member_id/assigned_to/assigned_by 비교 없음. 본 API PATCH(admin-workspace-tasks.ts:624-628)는 `canEdit = isSuperAdmin || isOwner || isAssignee || isAssigner` 검증 후 403. 도구 권한은 lib/ai-agent-config.ts checkToolAllowed가 role 단위만 체크(소유권은 핸들러 책임).
- **권장조치**: tool_taskUpdate 앞부분에 본 API와 동일한 canEdit 검증(소유자·담당자·지시자·super_admin) 추가.


## P1 · 칸반·작업카드 (4)

### #31 [버그] ✓검증 마감일 없는 카드에 서브태스크 추가 시 마감일이 1970년 1월 1일로 저장됨
- **위치**: `netlify/functions/admin-workspace-subtask-create.ts:68`
- **설명**: 2026-07-09에 '마감일 없이 카드 생성' 기능이 열렸는데, 그런 카드에서 서브태스크 탭으로 하위 작업을 추가하면(마감일 입력란 자체가 없음) 서버가 부모의 비어있는 마감일을 날짜로 강제 변환해 1970-01-01이 저장됩니다. 보드에는 '지연 20,000일+' 카드로 표시되고, 일일 리스크 크론의 마감 임박 후보에도 항상 걸립니다. 서브태스크 마감일은 UI 어디에서도 수정할 수 없어(발견 '마감일 변경 경로 부재' 참조) 잘못된 날짜가 영구히 남습니다.
- **근거**: admin-workspace-subtask-create.ts:61-69 — dueDate 미지정 시 `dueDate = new Date(parent.dueDate)` 실행. 커밋 077df183이 db/schema.ts:1600 due_date를 nullable로 변경했으나 이 파일은 미수정(주석은 여전히 'NOT NULL 제약' 언급). parent.dueDate가 null이면 new Date(null)=1970-01-01T00:00:00Z. 프론트 서브태스크 추가 폼(workspace-kanban.js:2315-2343)은 dueDate를 보내지 않음.
- **권장조치**: parent.dueDate가 null이면 서브태스크 dueDate도 null로 저장하도록 분기 추가 (`dueDate = parent.dueDate ? new Date(parent.dueDate) : null`).

### #32 [버그] AI 자연어 검색 결과에서 카드를 열어 저장하면 설명·체크리스트가 통째로 삭제됨
- **위치**: `public/js/workspace-kanban.js:333`
- **설명**: 운영자가 AI 검색으로 카드를 찾은 뒤 그 카드를 클릭해 상세를 열고 '저장'을 누르면, 카드의 설명과 체크리스트가 빈 값으로 덮어써져 사라집니다. AI 검색 응답이 제목·상태 등 일부 필드만 내려주는데, 화면은 그 축소본으로 모달을 채우고 저장 시 빈 설명('')과 빈 체크리스트([])를 그대로 서버에 보내기 때문입니다. 사용자는 아무것도 지운 적이 없는데 데이터가 소실됩니다.
- **근거**: admin-workspace-task-search.ts:165-183 — select에 description·checklistItems·estimatedHours 등 미포함. workspace-kanban.js:333 `STATE.tasks = items`로 보드 상태를 축소본으로 교체 → openCardModal(729-743)이 t.description||'' , checklistItems undefined→[]로 폼 채움 → saveCardModal(795-812)이 description:''와 checklistItems:[]를 PATCH → 서버(admin-workspace-tasks.ts:959,967)는 undefined가 아니면 무조건 덮어씀.
- **권장조치**: openCardModal에서 단건 GET(/api/admin-workspace-tasks?id=N)으로 전체 필드를 다시 받아 채우거나, AI 검색 select에 전체 필드를 포함.

### #33 [버그] 지시 없이 만든 개인 카드를 '토스'받은 운영자는 카드를 수정·이동할 수 없음
- **위치**: `netlify/functions/admin-workspace-tasks.ts:625`
- **설명**: 운영자 A가 스스로 만든 카드(지시 관계 없음)를 토스 기능으로 B에게 넘기면, B의 보드에는 카드가 나타나지만 B가 상태를 옮기거나(드래그) 내용을 저장하거나 체크리스트를 바꾸려 하면 전부 '수정 권한이 없습니다' 오류가 납니다. 토스는 담당자만 바꾸고 '지시자' 기록은 비워둔 채 유지하는데, 수정 권한 검사가 '지시자가 있는 담당자'만 인정하기 때문입니다. 결국 인계받은 사람이 일을 진행할 수 없는 워크플로우 단절입니다.
- **근거**: lib/workspace-sync.ts:353-361 — transferWorkspaceTask는 assignedTo·assignedAt만 갱신(assignedBy는 원값 보존 → 개인 카드는 null 유지). admin-workspace-tasks.ts:624-628 — `isAssignee = task.assignedTo === meId && task.assignedBy`이므로 assignedBy=null이면 false → canEdit false → 403. 체크리스트(admin-workspace-task-checklist.ts:66)·리마인더(:63)·서브태스크 생성(:58)도 동일 조건. 토스 자체는 memberId===me면 허용(admin-workspace-task-transfer.ts:67)이라 개인 카드도 토스 가능.
- **권장조치**: 권한 검사를 `task.assignedTo === meId`(assignedBy 유무 무관)로 완화하거나, 토스 시 assignedBy를 transferredBy로 채우는 정책 결정.

### #34 [버그] 마감 D-1/D-3 알림 크론이 하루 1회 실행인데 2시간 창만 검사해 대부분의 카드가 알림을 못 받음
- **위치**: `netlify/functions/cron-workspace-due-reminder.ts:32`
- **설명**: 마감 24시간 전·72시간 전 알림 크론이 매일 오전 9시(KST)에 한 번 돌면서 '지금부터 23~25시간 뒤 마감'인 카드만 찾습니다. 즉 다음날 오전 8~10시에 마감되는 카드만 D-1 알림을 받고, 오후 6시 마감·자정 마감 등 그 외 시각의 카드는 마감 임박 알림이 아예 발송되지 않습니다. 운영자가 '마감 전 알림이 온다'고 믿고 있으면 대부분의 경우 조용히 누락됩니다.
- **근거**: cron-workspace-due-reminder.ts:31-34 — STAGES가 hoursLow 23~hoursHigh 25(D-1), 71~73(D-3)로 2시간 폭. :44-45 — due_date BETWEEN NOW()+23h AND NOW()+25h. :164-166 — schedule '0 0 * * *'(하루 1회, KST 09:00). 하루 1회 실행 × 2시간 창 = 마감시각이 다음날 08:00~10:00(KST)인 카드만 포착.
- **권장조치**: 일 1회 실행이면 창을 24시간 폭(D-1: 0~24h, D-3: 48~72h)으로 넓히고 중복 방지(이미 있는 24h 재발송 가드)로 이중 발송을 막는 방식 권장.


## P1 · 홈·메모·알림 (6)

### #25 [데이터정합] ✓검증 캘린더에서 메모를 열어 저장하면 메모 본문이 통째로 사라지고 고정도 풀림
- **위치**: `public/js/workspace-memo-modal.js:92`
- **설명**: 캘린더에 표시해 둔 메모를 캘린더에서 클릭해 수정 모달을 열면 '내용' 칸이 비어 보인다(실제로는 내용이 있는데). 이 상태에서 제목이나 날짜만 고치고 저장하면 서버에 빈 내용이 저장되어 원래 적어둔 본문이 영구 삭제되고, 상단 고정도 해제된다. 단건 조회 응답이 다른 표기법(스네이크케이스)의 필드명으로 내려오는데 모달은 카멜케이스 필드만 읽기 때문.
- **근거**: openEdit(memoId)는 GET ?id=N 호출(252행) → 서버 admin-workspace-memos.ts:50-58이 raw SQL `SELECT *`로 응답 → postgres-js 원시 행이라 키가 content_html·is_pinned(스네이크). 모달 92행은 `existingMemo.contentHtml`, 75행은 `existingMemo.isPinned`만 읽음 → 빈 textarea·해제된 체크박스. 저장 시 body.contentHtml=''가 전송되고 서버 242행 `if (body.contentHtml !== undefined) updateData.contentHtml = body.contentHtml`이 빈 값을 그대로 저장. 캘린더 진입점: workspace-calendar.js:494 `WorkspaceMemoModal.openEdit(ext.memoId)`(숫자 id).
- **권장조치**: 단건 GET을 목록과 동일하게 drizzle select(카멜케이스)로 바꾸거나, 모달에서 content_html/is_pinned 폴백 키를 함께 읽기.

### #26 [데이터정합] 벨 드롭다운에서 통합 알림 읽음 처리 시 엉뚱한 알림이 읽음되고 원래 알림은 계속 안읽음
- **위치**: `public/js/workspace.js:1447`
- **설명**: 2026-06-03 알림 통합으로 벨 목록에는 두 종류(워크스페이스 알림 + 전사 알림)가 섞여 나오는데, 워크툴 홈 드롭다운에서 전사 알림을 클릭하면 읽음 처리가 잘못된 쪽 테이블로 간다. 결과: ① 클릭한 알림은 영원히 안읽음으로 남아 배지 숫자가 줄지 않고 ② 우연히 같은 번호를 가진 내 다른 워크스페이스 알림이 소리 없이 읽음 처리되어 놓친다. 알림 전체보기 페이지는 고쳐졌는데 홈 드롭다운만 통합 작업에서 누락됐다.
- **근거**: 서버(admin-workspace-notifications.ts:122) `const source = String(body?.source || "ws")` — source 미전달 시 workspace_notifications를 UPDATE(138행). 드롭다운 클릭 핸들러 1447행은 `body: { id }`만 전송하고 항목 렌더(1391행)에 data-source 자체가 없음. 대조: 전체보기 workspace-notifications.js:127 `data-source="${n.source||'ws'}"` + 195행 `body: { id, source }`. 통합 커밋 e3be6141 diff에 workspace.js 변경 없음(누락 확인).
- **권장조치**: 드롭다운 항목에 data-source를 넣고 읽음 POST에 {id, source} 전송.

### #27 [버그] ✓검증 '미할당 서비스' 감시 패널이 누구에게도 표시되지 않음 (권한 확인 API 경로 오타)
- **위치**: `public/js/workspace.js:1580`
- **설명**: 신고·상담이 접수됐는데 담당자가 정해지지 않은 카드를 모아 보여주는 '🚨 미할당 서비스' 패널이 슈퍼관리자에게도 절대 나타나지 않는다. 관리자 여부를 확인하는 호출이 존재하지 않는 주소로 나가 항상 실패 → '관리자 아님'으로 판정 → 패널을 숨긴다. 미할당 신고가 방치되어도 워크툴 홈에서 아무도 알아챌 수 없다.
- **근거**: workspace.js:1580 `await api('/api/admin-me')` — 실제 함수 등록 경로는 admin-me.ts:96 `"/api/admin/me"`. 404 → api()가 throw → detectAdmin catch에서 false 반환 → loadUnassigned(false)가 1313행에서 `panel.style.display='none'`. 전 코드베이스에서 '/api/admin-me'(하이픈) 호출은 이 한 곳뿐(나머지는 전부 /api/admin/me).
- **권장조치**: detectAdmin의 호출 경로를 '/api/admin/me'로 수정. 서버(unassigned=1)는 super_admin만 데이터를 주므로 프론트 노출 조건도 super_admin으로 맞추면 일관적.

### #28 [버그] ✓검증 워크툴 홈 멘션(@) 벨이 항상 '멘션 없음' — 정의되지 않은 변수 참조로 매번 예외
- **위치**: `public/js/workspace.js:1490`
- **설명**: 동료가 작업 댓글에서 나를 @멘션해도 워크스페이스 홈 상단의 @ 벨 배지는 절대 켜지지 않고 드롭다운은 항상 '읽지 않은 멘션이 없습니다'만 보여준다. 멘션 목록을 불러오는 코드가 그 코드 블록에 존재하지 않는 변수를 읽다가 매번 예외를 내고, 예외가 조용히 삼켜져 빈 목록으로 처리되기 때문. 멘션 알림 기능 전체가 이 페이지에서 무력화 상태다.
- **근거**: 1490행 `const ws = STATE.currentWorkspaceId || 1;` — STATE는 첫 번째 IIFE(36행)의 지역 상수이고 이 코드는 별도 IIFE(1218행~) 내부. 전역 STATE를 정의하는 스크립트는 워크스페이스 페이지에 하나도 없음(로드되는 12개 js 전수 grep 0건). 'use strict'에서 ReferenceError → 1492-1494 catch가 items=[] 처리. 멘션 데이터 자체는 존재 가능(admin-workspace-task-comments.ts:210 workspaceId:1로 INSERT).
- **권장조치**: `const ws = (window.STATE && STATE.currentWorkspaceId) || 1` 또는 상수 1로 교체.

### #29 [버그] 작업 지시·완료·보류·마감요청·일정초대 알림을 클릭하면 엉뚱한 관리자 대시보드로 이동 (죽은 링크)
- **위치**: `lib/workspace-logger.ts:240`
- **설명**: '새 작업이 지시되었습니다', '작업 완료', '마감일 변경 요청' 같은 핵심 알림을 벨에서 클릭하면 해당 작업 화면이 아니라 옛 관리자 대시보드(admin.html)로 떨어지고 아무것도 열리지 않는다. 알림에 심긴 이동 주소가 '/admin#task-N' 형식인데 그 해시를 처리하는 코드가 admin 페이지에 전혀 없기 때문. 알림을 받아도 한 번의 클릭으로 작업에 도달할 수 없어 알림→처리 흐름이 끊긴다.
- **근거**: workspace-logger.ts:240 기본값 `actionUrl: params.actionUrl ?? \`/admin#task-${params.taskId}\``. 사용처: admin-workspace-tasks.ts 588(생성·지시)·672(상태변경/완료)·795(지시)·902(보류), admin-task-due-changes.ts 231(`/admin#due-change-N`)·360(승인/반려), admin-workspace-events.ts 348(`/admin#event-N` 일정초대). admin.js에서 '#task'·'task-' 해시 처리 grep 0건. 반면 신규 경로(토스·워처·댓글·cron 리마인더)는 전부 `/workspace-kanban.html#task=N` 사용 — 표준이 이미 존재.
- **권장조치**: 위 7곳의 actionUrl과 logger 기본값을 `/workspace-kanban.html#task=${id}`로 교체(마감요청은 해당 요청 검토 화면으로).

### #30 [보안] ✓검증 워크툴 홈 로그아웃 버튼이 실제로 로그아웃하지 않음 (API 경로 오타)
- **위치**: `public/js/workspace.js:31`
- **설명**: 워크스페이스 홈 사이드바에서 '로그아웃'을 누르면 로그인 화면으로 이동하지만 관리자 세션 쿠키는 그대로 남는다. 로그아웃 요청이 존재하지 않는 주소로 나가 404가 되는데 오류를 무시하고 화면만 이동하기 때문. 공용 PC에서 로그아웃했다고 믿어도 다른 사람이 뒤로가기·주소 입력만으로 관리자 세션을 계속 쓸 수 있다.
- **근거**: workspace.js:31 `logout: '/api/admin-logout'`(하이픈) vs admin-logout.ts:26 `config = { path: "/api/admin/logout" }`(슬래시). netlify.toml에 /api/* 이름 매핑 리다이렉트 없음 → 404. 핸들러(596-605행)는 `try{await fetch(...)}catch{}` 후 무조건 이동이라 실패가 드러나지 않음. 다른 모든 페이지(admin-hub.js:116, workspace-kanban.js:1200 등)는 '/api/admin/logout' 사용 — workspace.js만 오타.
- **권장조치**: workspace.js의 로그아웃 주소를 '/api/admin/logout'으로 통일.


## P1 · 캘린더·일정 (4)

### #17 [버그] 관리자 로그인만 한 운영자는 캘린더 진입 시 로그인 페이지로 튕겨나갈 수 있음
- **위치**: `public/js/workspace-calendar.js:70`
- **설명**: 캘린더 페이지가 열리면서 '일반 사용자 로그인 여부'를 먼저 물어보는데, 관리자 화면으로만 로그인한 운영자(또는 일반 로그인 7일 유효기간이 먼저 끝난 운영자)는 이 확인이 실패(401)하는 순간 페이지 공통 규칙에 따라 즉시 관리자 로그인 페이지로 이동이 시작됩니다. 코드에는 '일반 확인 실패 시 관리자 정보로 대신 확인'하는 예비 절차가 있지만, 이동이 먼저 걸려버려 예비 절차가 무의미해집니다. 결과: 관리자 세션이 멀쩡히 살아있는데도 캘린더(및 같은 패턴을 쓰는 WBS·근태·파일함·템플릿·로드맵 페이지)에 들어갈 수 없는 상태가 발생할 수 있습니다. 일반 사이트 헤더(auth.js)는 같은 상황에서 튕기지 않도록 만들어져 있어(주석에 '어드민으로만 로그인한 경우' 명시) 이 시나리오는 실제 지원 대상입니다.
- **근거**: workspace-calendar.js:70 api()가 res.status===401이면 무조건 location.href='/admin.html' 후 throw. loadMe()(604행)가 첫 호출로 api('/api/auth/me')를 부르는데 auth-me.ts:27은 사용자 토큰 없으면 unauthorized()=401 반환. admin-login.ts:126은 siren_admin_token만 심음(사용자 토큰 미발급). catch(_)로 예외는 삼켜도 location.href 대입으로 내비게이션은 이미 시작됨 → 608행의 /api/admin/me?light=1 폴백이 화면을 지키지 못함. 동일 패턴: workspace-kanban.js:80·1006, workspace-attendance.js:1169, workspace-files.js:1396, workspace-templates.js:225, workspace-roadmap.js:76, workspace-milestones.js:79. 반면 auth.js:11-27 api()는 401에서 리다이렉트 없이 status만 반환하고 42-46행 주석이 '어드민으로만 로그인한 경우' 폴백을 명시.
- **권장조치**: 워크스페이스 페이지 api() 헬퍼에서 /api/auth/me 등 '탐침 호출'은 401 리다이렉트 예외로 두거나(옵션 플래그), loadMe에서 api() 대신 리다이렉트 없는 fetch로 auth/me를 조회하고 admin/me 폴백까지 모두 실패했을 때만 로그인 페이지로 이동.

### #18 [버그] '전체(공유)' 캘린더인데 다른 운영자 일정이 전혀 보이지 않음 — 공유 캘린더 기능이 서버에 미구현
- **위치**: `netlify/functions/admin-workspace-events.ts:200`
- **설명**: 2026-07-02 개선(커밋 a8c2712a)의 의도는 '캘린더 진입 즉시 모든 운영자 일정 표시(공유 캘린더)'였고 화면 필터에도 '전체(공유)'가 기본값으로 붙어 있습니다. 그러나 서버는 어떤 경우에도 '내가 만든 일정 + 내가 참석자로 초대된 일정'만 돌려주므로 동료 운영자의 일정은 절대 나타나지 않습니다. 게다가 참석자를 초대하는 화면 자체가 없어(별도 발견) 초대된 일정도 사실상 0건 → '전체(공유)'와 '내 항목만'이 완전히 같은 결과를 보여줍니다. 팀이 서로의 회의·외근 일정을 보고 조율한다는 공유 캘린더의 목적이 통째로 동작하지 않습니다.
- **근거**: admin-workspace-events.ts:195-204 목록 스코프 분기 — mine이면 eq(memberId,meId), attending이면 attendees@>me, 그 외(기본=전체)도 or(memberId=meId, attendees@>me)로 제한. '모든 운영자' 분기 자체가 없음. 프론트 workspace-calendar.js:37 주석 "기본 '전체'(공유 캘린더: 모든 운영자 일정 표시)" 및 커밋 a8c2712a 메시지 "진입 즉시 모든 운영자 일정 표시(공유 캘린더)"와 정면 배치. scope=all일 때 프론트는 mine 파라미터를 안 보낼 뿐(232행) 서버 기본 분기로 떨어짐.
- **권장조치**: 서버 목록 분기에 '전체' 스코프 추가(운영자 전원 일정 반환, 필요 시 소유자 이름 병기). 개인 메모 미러링(member_id=meId 고정)은 현행 유지.

### #19 [버그] 구글 캘린더 '동기화'를 누를 때마다 같은 일정이 구글에 계속 복제됨
- **위치**: `netlify/functions/google-calendar-sync.ts:96`
- **설명**: 동기화 버튼은 앞으로 90일치 내 일정을 구글 캘린더에 '새로 생성'만 합니다. 이미 보냈던 일정인지 기억하는 장치가 전혀 없어(연결 ID 저장 안 함) 버튼을 누를 때마다 같은 일정이 한 벌씩 더 생깁니다. 세 번 누르면 구글 캘린더에 모든 일정이 3중으로 쌓입니다. 또 우리 쪽에서 일정을 수정·삭제해도 구글에는 반영되지 않고(생성 전용 단방향), 구글 쪽 일정을 가져오는 방향도 없습니다. DB에는 외부 연결용 externalRef 칸까지 준비돼 있지만 동기화가 이를 전혀 쓰지 않습니다.
- **근거**: google-calendar-sync.ts:82-112 — events 루프에서 매번 POST .../calendars/{id}/events로 신규 생성만 수행. 생성된 구글 event id를 저장하지 않고, 기존 동기화 여부 필터(externalRef 등) 없음. 조회 조건(68-77)은 memberId+startAt>=now뿐. schema.ts:1694 externalRef varchar(200) 존재하나 sync에서 미사용. 수정/삭제 전파·역방향(가져오기) 코드 없음.
- **권장조치**: 생성 성공 시 구글 event id를 workspace_events.externalRef에 저장하고, 다음 동기화에서 externalRef 있는 일정은 PATCH(수정)로, 없는 것만 POST로 처리. 삭제는 externalRef 기반 DELETE 전파.

### #20 [버그] 캘린더 '일 보기'에서 오전 9시 이후 일정이 통째로 안 보임 (주 보기는 토요일, 월 보기는 마지막 칸) — KST/UTC 날짜 경계 오류
- **위치**: `netlify/functions/admin-workspace-events.ts:206`
- **설명**: 화면이 서버에 조회 기간을 날짜 문자열(YYYY-MM-DD)로 보내는데, 이 문자열을 만들 때 한국시간 자정을 세계표준시로 바꿔 9시간이 밀리고, 서버는 다시 그 날짜를 '세계표준시 자정 = 한국시간 오전 9시'로 해석합니다. 결과적으로 조회 구간의 끝이 '마지막 날 오전 9시'에서 잘립니다. 하루 보기에서는 그날 오전 9시 이후에 시작하는 모든 일정(업무 일정 대부분)이 사라져 사실상 빈 화면이 되고, 주 보기에서는 토요일 오전 9시 이후 일정이 누락됩니다. 같은 원인으로 워크툴 대시보드의 '이번 주 일정' 위젯도 월요일 자정~오전 9시 시작 일정과 일요일 오전 9시 이후 일정을 빠뜨립니다.
- **근거**: 클라이언트 workspace-calendar.js:226-227 — FullCalendar의 로컬(KST) 범위 Date를 toISOString().slice(0,10)으로 변환(KST 자정→전일 15:00Z→전일 날짜). 서버 admin-workspace-events.ts:206-207 — gte(startAt,new Date(from))·lte(startAt,new Date(to)); new Date('YYYY-MM-DD')=UTC 자정=KST 09:00. 예: 7/15 일 보기 → to='2026-07-15' → startAt<=7/15T00:00Z(=KST 09:00) → 7/15 10:00 KST(01:00Z) 일정 제외. 워크툴 workspace.js:133-145 getWeekRange는 KST 월~일 날짜 문자열 생성 → from=월요일 UTC 자정=월요일 09:00 KST → 월요일 오전 일정 gte 탈락, to=일요일 09:00 KST 컷. 메모는 event_date(date형) BETWEEN이라 무관(230-235행).
- **권장조치**: 서버에서 from/to를 KST 하루 경계로 해석: fromTs=new Date(from+'T00:00:00+09:00'), toTs=new Date(to+'T23:59:59.999+09:00') (또는 프론트가 info.startStr/endStr의 오프셋 포함 값을 그대로 전달).


## P1 · 파일함·휴지통 (4)

### #21 [누락기능] 휴지통에 폴더가 아예 안 보여서 삭제한 폴더를 복원할 방법이 없음 (복원·영구삭제 API는 있으나 화면 미연결)
- **위치**: `public/js/workspace-files.js:291`
- **설명**: 폴더를 휴지통으로 보내면(내부 파일 포함 일괄 소프트삭제) 휴지통 탭에는 파일들만 나열되고 폴더 자체는 어디에도 표시되지 않는다. 서버에는 폴더 휴지통 조회·복원·영구삭제 API가 모두 있지만 프론트가 한 번도 호출하지 않아 운영자는 실수로 지운 폴더 구조를 복원할 수 없고, 30일 뒤 크론이 조용히 영구삭제한다. 폴더 영구삭제 확인창 코드(purgeFolder)도 파일 경로로만 호출돼 도달 불가한 죽은 코드다. 또한 API로 직접 복원해도 단건 복원이라 하위 폴더·내부 파일은 휴지통에 남는다.
- **근거**: loadFiles는 admin-workspace-files?trash=1만 호출(291행) — admin-workspace-folders?trash=1(서버 114-125행)·action=restore(269-282행) 호출부가 JS 전체에 없음(grep 확인). openPurgeConfirm은 428행에서 'file'로만 호출 → 800행 purgeFolder 분기 도달 불가. 폴더 restore는 단건만 deletedAt 해제(272-274행) — 자손·파일 미복원.
- **권장조치**: 휴지통 탭에 폴더 섹션 추가(조회+복원+영구삭제 버튼 연결). 폴더 복원 시 같은 deletedAt 타임스탬프의 자손 폴더·파일 일괄 복원 권장.

### #22 [버그] ✓검증 파일함 검색창이 완전히 무동작 — 검색어를 입력해도 서버가 받지 못함
- **위치**: `public/js/workspace-files.js:297`
- **설명**: 운영자가 파일함 상단 검색창에 파일명을 입력하면 목록이 갱신되는 것처럼 보이지만 실제로는 검색이 전혀 수행되지 않고 현재 폴더 목록이 그대로 다시 뜬다. 프론트는 검색어를 'q'라는 이름으로 보내는데 서버는 'search'라는 이름만 읽기 때문. 같은 API를 쓰는 WBS 카드 파일피커(workspace-kanban.js:1918)와 워크스페이스 대시보드(workspace.js:1070)는 'search='로 정상 호출하고 있어 파일함 페이지만 죽어 있다. 휴지통 화면 검색은 서버 자체가 미지원이라 파라미터를 고쳐도 안 된다.
- **근거**: workspace-files.js:297 `params.set('q', state.searchKeyword)` vs netlify/functions/admin-workspace-files.ts:71 `url.searchParams.get("search")`. 서버 GET은 id/folderId/search/trash/limit/offset만 파싱. git blame 결과 q는 최초 구현(cba739f3)부터 존재, '파라미터 통일' 커밋(41297613)에서도 미수정.
- **권장조치**: workspace-files.js loadFiles에서 params.set('search', ...)로 교체(또는 서버가 q도 수용). 휴지통 검색은 서버 trash 분기에 search 조건 추가.

### #23 [버그] 공유 모달 '전체 공개' 스위치가 항상 꺼짐으로 표시되고, 이미 공개된 파일에 켜면 실제로는 비공개로 뒤집히며 성공 토스트가 뜸
- **위치**: `public/js/workspace-files.js:653`
- **설명**: 파일이 이미 전체 공개 상태여도 공유 모달을 열면 스위치가 항상 OFF로 보인다(공유목록 API 응답에 공개 여부 필드가 없는데 프론트가 그걸 읽으려 함). 이 상태에서 운영자가 '공개하려고' 스위치를 켜면 서버는 현재값을 단순 반전시키므로 실제로는 비공개로 바뀌는데, 화면에는 '전체 공개됨' 토스트가 떠서 운영자는 공개됐다고 믿게 된다. 내부 자료 공개/비공개 관리가 신뢰 불가.
- **근거**: workspace-files.js:653 `res.isShared || res.data?.isShared || false` — admin-workspace-file-share.ts GET은 ok({items,total})만 반환(56-78행), isShared 없음 → 항상 false. 토글은 admin-workspace-files.ts:204-216 `!file.isShared` 단순 반전. 토스트 문구는 프론트 체크박스 상태 기준(workspace-files.js:744).
- **권장조치**: loadShareList에서 state.files의 해당 파일 isShared를 읽거나 파일 단건 GET으로 현재값 표시. 토글 API에 목표값(body.isShared)을 받도록 하면 반전 사고 원천 차단.

### #24 [버그] 폴더를 공유받아도 폴더 안 파일이 하나도 안 보임 — 폴더 소유자조차 남이 올린 파일을 못 봄
- **위치**: `netlify/functions/admin-workspace-files.ts:146`
- **설명**: 파일 목록 조회의 가시성 규칙이 '내가 올린 파일, 전체공개 파일, 파일 단위로 직접 공유받은 파일'만 허용하고 폴더 공유·폴더 소유를 전혀 반영하지 않는다. 시나리오: 국장이 자기 폴더를 직원에게 편집 권한으로 공유 → 직원이 그 폴더에 파일 업로드(업로드는 허용됨) → 국장이 폴더를 열면 직원이 올린 파일이 안 보인다(super_admin만 보임). 반대로 폴더를 조회 공유받은 사람이 폴더를 열어도 빈 폴더로 보인다. 공유 폴더 협업이라는 기능 취지가 성립하지 않음.
- **근거**: admin-workspace-files.ts:132-152 visibilityCond = or(ownerId=me, isShared=true, id IN 파일단위공유) — workspaceFileShares targetType='folder' 매칭·폴더 ownerId 매칭 없음. 반면 presign의 checkFolderWriteAccess(22-44행)는 폴더 편집공유로 업로드 허용 → 올린 사람 외 아무도 못 보는 파일 생성.
- **권장조치**: 가시성 조건에 ①현재 폴더의 ownerId=me ②폴더 단위 공유(targetType='folder', 만료 미경과) 매칭 파일 포함.


## P1 · 마일스톤·성과 (3)

### #35 [버그] 직원(운영자)이 완료 카드의 성과 분류를 확정하려는 순간 로그인 오류로 막힘 — 형제 API와 인증 가드 불일치
- **위치**: `netlify/functions/workspace-milestone-task-match.ts:16`
- **설명**: 성과관리 화면에서 완료된 작업 카드를 마일스톤에 분류하는 흐름이 중간에 끊긴다. 분류 대기 목록·진행률·완료카드 목록·카드 일괄생성 4개 API는 모두 '직원 운영자(operatorActive)'도 쓸 수 있게 열려 있는데, 정작 마지막 단계인 '분류 확정/제외' API만 관리자 계정 전용 가드를 쓴다. 직원 운영자는 대기 목록까지 잘 보다가 확정 버튼을 누르면 '관리자 로그인이 필요합니다'(401)로 실패한다. 과거 수정(Q3-010) 주석에는 이 API도 이미 운영자 가드로 바뀐 것처럼 잘못 기재돼 있어 재발을 놓친 상태.
- **근거**: workspace-milestone-task-match.ts:7,16 `requireAdmin` 사용. 반면 형제 함수 workspace-milestone-pending.ts:9,16 / workspace-milestone-progress.ts:7,14 / workspace-milestone-done-tasks.ts:7,14 / workspace-milestone-create-tasks.ts:8,17 은 모두 `requireOperator`(R35-GAP-P1-B-H1). pending.ts:6-8 주석은 "형제 함수(progress·done-tasks·create-tasks·task-match)는 모두 requireOperator"라고 기술하나 task-match는 아님. 같은 프론트 파일 public/js/workspace-milestones.js:964(pending 호출)와 :994,:1005(task-match 호출)가 동일 사용자 흐름이며, workspace.html:643이 이 스크립트를 로드(운영자 워크스페이스).
- **권장조치**: workspace-milestone-task-match.ts의 requireAdmin을 형제 함수와 동일하게 requireOperator로 교체(내부에 이미 task.member_id === member.id 소유자 검증이 있어 IDOR 위험 없음).

### #36 [버그] 운영자(일반회원+운영자 토글) 직원은 성과관리 화면이 열리자마자 '활성 분기가 없습니다'로 전면 차단됨
- **위치**: `netlify/functions/milestone-quarters.ts:9`
- **설명**: 이 시스템은 일반회원에게 운영자 토글을 켜서 직원으로 쓰는 구조를 공식 지원하고(성과 역할 배정 화면도 이런 직원에게 역할을 줄 수 있게 일부러 고쳤음), 성과 대시보드·매출입력 저장·진행률·보류목록·완료목록·카드생성 6개 API는 운영자용으로 개방해 두었다. 그런데 성과관리 화면이 켜질 때 가장 먼저 부르는 '분기 목록' API만 관리자 전용으로 남아 있다. 관리자 로그인 토큰은 관리자 계정(type=admin)에게만 발급되므로, 운영자 직원이 성과관리 화면(워크스페이스 메인의 성과 패널 포함)에 들어가면 첫 호출부터 거부되고 화면에는 '활성 분기가 없습니다. 슈퍼어드민에서 분기를 추가해 주세요'라는 엉뚱한 안내만 뜬 채 종료된다. 분기가 실제로 있어도 그렇다. 결과적으로 운영자 개방 작업(R35) 전체가 이 한 API 때문에 무력화되어, 운영자 직원은 자기 성과 진행률·매출 입력·분류 큐를 하나도 쓸 수 없다.
- **근거**: milestone-quarters.ts:2,9 requireAdmin(admin-guard) — 주석(line 23)은 '그 외(운영자/일반어드민)는 ACTIVE+UPCOMING만'이라며 운영자 사용을 전제하지만 가드가 선차단. admin-login.ts:54 user.type!=='admin'이면 관리자 토큰 미발급, admin-guard.ts:88 member.type!=='admin' 403. 운영자는 user JWT뿐이라 requireAdmin 통과 불가(operator-guard.ts:20-92와 대조). 프론트 workspace-milestones.js:130-142 — loadQuarters 실패 시 quarters=[] → currentQuarterId null → '활성 분기가 없습니다' 렌더 후 return(이후 모든 로드 중단). 운영자 지원 근거: admin-milestone-role-assign.ts:57-66(operator_active=TRUE 일반회원 역할 배정 허용 — '이전 type=admin 한정은 잠재버그' 주석), milestone-members.ts:28, milestone-revenue.ts:2('operatorActive=true 일반 회원도 매출 입력' 주석), workspace-milestones.js:98-102(운영자 페이지 입장 허용)
- **권장조치**: milestone-quarters GET을 형제 API들과 동일하게 requireOperator로 전환(쓰기 POST/PATCH는 현재도 내부에서 isSuperAdmin 재검사하므로 GET만 완화해도 안전)

### #37 [버그] 마일스톤 정의 목록 API가 관리자 전용이라 운영자 직원은 매출 입력 드롭다운이 비고 WBS 카드 생성 섹션이 '로드 실패'로 뜸
- **위치**: `netlify/functions/milestone-definitions.ts:11`
- **설명**: 매출 실적 저장 API는 운영자에게 개방했으면서, 그 입력 폼의 '어느 마일스톤 실적인지' 선택지를 채우는 정의 목록 API는 관리자 전용으로 남아 있다. 운영자 직원은 (분기 문제를 고쳐도) 매출 입력 탭에서 마일스톤 선택 칸이 빈 채로 '마일스톤을 선택하세요'에 막혀 실적을 아예 입력할 수 없고, 내 현황의 'WBS 카드 생성' 섹션도 '로드 실패: 관리자 로그인이 필요합니다'로 뜬다. 특히 이 API 내부에는 '운영자는 본인 역할 것만 강제 필터'하는 운영자 전용 로직까지 이미 만들어져 있는데, 문 앞의 가드가 운영자를 들여보내지 않아 그 로직에 도달할 수 없다.
- **근거**: milestone-definitions.ts:11 requireAdmin — 그러나 :32-41에 'R29-MS-GAP1-A: 운영자(super_admin 외)는 본인 milestoneRole 기준으로 강제 필터' 운영자 분기 로직 존재(도달 불능). 호출부: workspace-milestones.js:241(매출 마일스톤 로드 — 실패 시 조용히 빈 배열 → saveRevenueEntry:639 '마일스톤을 선택하세요'로 저장 불가), :1054(카드 생성 섹션 — catch에서 '로드 실패' 표시), :930(비매출 제출 모달). 매출 저장 API는 운영자 개방: milestone-revenue.ts:2-3,13 requireOperator
- **권장조치**: GET만 requireOperator로 전환(POST/PATCH/DELETE는 기존 isSuperAdmin 검사 유지). 내부 운영자 필터 로직(:34-41)이 이미 있으므로 가드만 바꾸면 동작


## P1 · 근태(직원) (4)

### #13 [버그] ✓검증 자정 cron이 '새 날짜'를 조회해 미퇴근 통보·재택보고서 미제출 리마인더가 항상 0건 무발송
- **위치**: `netlify/functions/cron-att-evening.ts:58`
- **설명**: 매일 자정(KST 00:00)에 도는 야간 정리 작업이 '방금 끝난 날'이 아니라 '방금 시작된 새 날'의 기록을 조회한다. 자정에는 새 날짜의 출퇴근 기록이 아직 하나도 없으므로 ① 퇴근을 안 찍은 직원 명단이 관리자에게 통보되지 않고 ② 재택근무자가 보고서를 안 냈어도 본인 리마인더가 발송되지 않는다. ③ 주 52시간 점검도 월요일 자정에는 방금 완결된 지난주를 전혀 평가하지 못한다. 알림 제목은 '전일 미퇴근자'인데 조회는 새 날짜라 설계 의도와 코드가 어긋난 상태. 수동 dryRun 검증은 낮에 호출하면 정상처럼 보여 그동안 발견되지 않았을 가능성이 높다.
- **근거**: schedule "0 15 * * *"(UTC 15:00 = KST 00:00, 23행·netlify.toml 446행)에서 kstToday()(25-28행)가 새 날짜를 반환 → 미퇴근 조회 `WHERE r.date = ${today}::date`(58-65행)·재택보고서 조회(71-81행)가 항상 빈 결과. 알림 제목 '전일 미퇴근자'(143행)와 모순. kstWeekStart(30-37행)도 새 날짜 기준이라 월요일 자정엔 빈 주간 범위. 파일 생성 커밋(48e3627c)부터 동일 스케줄 확인(git log).
- **권장조치**: 조회 기준일을 실행 시점의 전일(today-1)로 바꾸거나, 스케줄을 KST 23:50(UTC "50 14 * * *")으로 옮기고 당일 조회 유지. 주간 집계 기준일도 함께 정렬.

### #14 [버그] 반차·공휴일 출근 직원이 퇴근하는 순간 상태가 '지각/조퇴'로 덮어써짐 → 만근 박탈·지각누적 경고 오발송
- **위치**: `netlify/functions/att-checkout.ts:139`
- **설명**: 오전 반차를 승인받고 오후 2시에 출근한 직원은 출근 시점엔 '반차(PARTIAL_LEAVE)'로 정상 기록되지만, 퇴근 버튼을 누르는 순간 시스템이 휴가 여부를 다시 확인하지 않고 출근 시각만 보고 '지각'으로 바꿔버린다. 오후 반차 직원이 오후에 퇴근하면 '조퇴'가 된다. 이 잘못된 지각/조퇴 기록은 ① 월 만근 보너스 연차 자동 박탈(만근 cron이 무단지각으로 집계) ② 30일 지각 3회 누적 시 본인+관리자 경고 알림 오발송 ③ 관리자 통계 왜곡으로 직결된다. 공휴일에 자원 근무한 직원도 퇴근하면 '공휴일' 표시가 '지각/정상'으로 사라진다. 본인 시각 셀프수정 시에도 동일하게 덮어써진다.
- **근거**: 출근(att-checkin.ts 220-274행)은 승인 휴가·공휴일 조회 후 status를 PARTIAL_LEAVE/HOLIDAY로 저장하지만, 퇴근(att-checkout.ts 139-145행)은 determineStatus(..., isLeave=false, isHoliday=false, workMode)로 재산정해 163행에서 무조건 교체. att-session-edit.ts 95-100행도 동일 패턴. 반차 14시 출근 → lateThreshold 초과 → 'LATE' 확정(lib/att-utils.ts determineStatus 235행). cron-att-leave-auto.ts 117행이 LATE(is_manually_adjusted=false)를 만근 위반으로 집계, cron-att-late-streak.ts 40행이 LATE 누적 집계.
- **권장조치**: 퇴근·셀프수정 시 기존 status가 PARTIAL_LEAVE/HOLIDAY/LEAVE면 보존하거나, 출근과 동일하게 휴가·공휴일을 재조회해 determineStatus에 전달.

### #15 [버그] 내 캘린더 월 계산 오류 — 1월은 항상 빈 캘린더(월=13 요청), 1일이 일요일인 달은 다음 달 기록 표시
- **위치**: `public/js/workspace-attendance.js:558`
- **설명**: 직원이 근태 캘린더에서 1월을 열면 서버에 '13월'을 요청해 서버 오류가 나고 화면엔 아무 기록도 표시되지 않는다(매년 1월 재현). 또 2026년 2월·3월·11월처럼 1일이 일요일인 달은 그 다음 달 기록을 대신 불러와 출퇴근 기록이 엉뚱한 달 것으로 표시되고, 하단 '월 총 근무시간' 요약도 '2025년 13월' 같은 표기나 다음 달 값으로 잘못 나온다. 보이는 첫 날짜에 +2개월 하는 하드코딩 방식이라 평범한 달(1일이 월~토)에만 우연히 맞는다.
- **근거**: datesSet에서 `const mo = info.start.getMonth() + 2`(558행) — 1월 뷰의 첫 표시일은 전년 12월 → getMonth()=11 → mo=13(래핑 없음), yr도 전년. att-my-calendar.ts 34-37행이 "YYYY-13-01" 문자열로 date 컬럼 비교 → Postgres date 범위 오류 → 500 → 프론트 rows=[] (574-575행). 1일이 일요일이면(ko 로케일 주 시작=일) info.start가 당월 1일 → mo=당월+1. 610행 요약 호출도 같은 yr/mo 사용.
- **권장조치**: FullCalendar가 제공하는 view.currentStart(월 뷰의 실제 당월 1일)로 연·월 산출: `info.view.currentStart.getFullYear()/getMonth()+1`.

### #16 [보안] ✓검증 근태 페이지 로그아웃이 존재하지 않는 API(/api/logout)를 호출 — 세션이 실제로는 살아있음
- **위치**: `public/js/workspace-attendance.js:1211`
- **설명**: 근태관리 화면에서 '로그아웃'을 누르면 홈으로 이동해 로그아웃된 것처럼 보이지만, 호출하는 주소가 서버에 존재하지 않아(404) 로그인 세션 쿠키가 그대로 남는다. 공용 PC나 사무실 공유 기기에서 다음 사용자가 근태 페이지 주소로 다시 들어가면 이전 직원 계정으로 그대로 접속돼 출퇴근 기록·휴가·급여명세서(PDF)까지 열람할 수 있다. 사용자 토큰은 기본 7일간 유효해 노출 창이 길다.
- **근거**: setupLogout이 `api('/api/logout', {method:'POST'})` 호출(1211행) 후 결과 확인 없이 이동(1212행). 저장소 전체에 config.path '/api/logout' 함수 부재 — '/api/auth/logout'(auth-logout.ts:32)과 '/api/admin/logout'(admin-logout.ts:25)만 존재. netlify.toml에 logout 리다이렉트 없음(grep 0건). api() 헬퍼는 404여도 throw하지 않음(8-21행).
- **권장조치**: '/api/auth/logout'과 '/api/admin/logout'을 순차 호출(어드민 fallback 세션 대응)한 뒤 이동하도록 교체.


## P1 · 근태(관리자)·급여 (4)

### #9 [버그] ✓검증 운영자에게 열어준 근태 화면이 슈퍼어드민 전용 API에 막혀 반쪽만 동작
- **위치**: `netlify/functions/admin-att-members.ts:31`
- **설명**: 권한정책에서 근태 현황(att_manage)·근태 설정(att_config) 메뉴를 운영자/일반 관리자에게 열 수 있게 해놨고 실제로 휴가·정정·근무형태 결재 5종은 운영자 허용으로 배선했지만, 같은 화면이 함께 부르는 직원 목록 API가 슈퍼어드민 하드코딩이라 이사장이 아닌 계정으로 열면: ① 실시간 현황에 직원 이름 대신 '직원 #12'로 표시되고 미출근 인원이 항상 0명, ② '출퇴근 기록(월)' 탭과 '재택보고서' 탭의 직원 선택 드롭다운이 비어 조회 자체가 불가능, ③ 같은 조회(ops) 그룹에 있는 '잔여 휴가'·'근무 스케줄' 탭도 전용 API가 슈퍼어드민 전용이라 목록이 아예 안 뜸. 근태 설정 메뉴도 '저장만 이사장 전용'이라는 라벨과 달리 조회(GET)까지 슈퍼어드민 전용이라 열면 전부 로드 실패.
- **근거**: admin-att-members.ts:31 role!=='super_admin'→403 (admin-att-leave-balances.ts:24, admin-att-schedules.ts:24, admin-att-policy.ts:25, admin-att-holidays.ts:24, admin-att-leave-types.ts:42, admin-att-workplaces.ts:25 동일) vs admin-att-records.ts:26·admin-att-correction-review.ts:29·admin-att-leave-review.ts:27·admin-att-workmode-change-review.ts:36·admin-att-remote-reports.ts:49는 canAccess(role,'att_manage') 허용. lib/permission-catalog.ts:81-82 att_manage/att_config adminDefault:true, public/js/cms-tbfa.js:2536 'att-ops':'att_manage'. 화면 사용처: admin-workspace-management.js:360·1121·1295·1954(직원 드롭다운/이름 매핑), admin-workspace-management.html:73-79(balances·schedule 탭이 ops 그룹).
- **권장조치**: admin-att-members(직원 목록 조회)는 att_manage canAccess로 완화하고, 잔여휴가·스케줄 조회 GET도 결재 5종과 같은 게이트로 정렬. 쓰기(조정·수정·정책 저장)만 super_admin 유지. 근태 설정 4종은 GET만 att_config 허용.

### #10 [버그] 급여: 반차 쓴 날이 '출근 1일 + 유급휴가 0.5일'로 이중 집계되어 0.5일치 과지급
- **위치**: `lib/payroll-calc.ts:216`
- **설명**: 직원이 반차(유급)를 승인받고 나머지 반나절 출근하면 그 날 출퇴근 기록 상태가 PARTIAL_LEAVE로 남는데, 급여 자동집계가 이 상태를 온전한 출근 1일로 세고 별도로 승인 휴가 0.5일도 유급휴가일에 더한다. 일급제 공식(기본급=(출근일+유급휴가일)×일급)에 따라 하루가 1.5일로 지급 — 반차를 쓸 때마다 반나절치 급여가 초과 지급된다.
- **근거**: payroll-calc.ts:149 working_days FILTER에 'PARTIAL_LEAVE' 포함 + :167-180 승인 휴가 days(반차 0.5) 합산 + :215-216 paidDays=workingDays+paidLeaveDays. att-checkin.ts:274 반차일 출근 status='PARTIAL_LEAVE', att-leave-request.ts:86-94 반차 days=0.5.
- **권장조치**: PARTIAL_LEAVE 일수는 0.5일로 세거나(SUM CASE), 반차 휴가일을 출근일에서 상쇄해 하루 상한 1일을 보장.

### #11 [버그] ✓검증 관리자 근태 화면의 '오늘'이 UTC 날짜 — 매일 아침 9시 전까지 어제 데이터·전원 미출근 표시
- **위치**: `public/js/admin-workspace-management.js:53`
- **설명**: 출퇴근 기록은 서버에서 한국시간 날짜로 저장되는데, 관리자 화면이 '오늘'을 UTC 기준으로 계산한다. 한국시간 자정~오전 9시 사이(=UTC 전날)에 근태 현황을 열면 날짜 기본값이 어제로 잡혀 어제 기록이 오늘처럼 보이고, 30초마다 자동 갱신되는 '실시간 출퇴근 현황'은 그 시간대에 이미 출근 도장을 찍은 직원(유연근무로 7~9시 출근 가능)까지 전부 '미출근'으로 표시한다. 오전 9시가 넘어야 저절로 정상화되는, 매일 아침 재현되는 오표시.
- **근거**: admin-workspace-management.js:51-54 toDateStr()=new Date().toISOString().slice(0,10) (UTC) → :135-137 근태현황 기본 날짜, :1784 loadLiveStatus 조회일. 서버 기록 날짜는 KST: lib/att-utils.ts:23 todayKST(+9h), att-checkin.ts:129. 같은 파일의 급여 탭(workspace-payroll.js:36-37)은 +9h 보정을 이미 쓰고 있어 비일관.
- **권장조치**: toDateStr()를 KST 보정(new Date(Date.now()+9*3600*1000).toISOString().slice(0,10))으로 교체. 서버 admin-att-records.ts:115 기본값도 todayKST()로 통일.

### #12 [버그] 보류(HOLD) 처리한 급여 명세서를 정상 흐름으로 되돌릴 방법이 없음 — 재집계는 보류를 무시하고 몰래 덮어씀
- **위치**: `public/js/admin-payroll.js:483`
- **설명**: 관리자가 문제 있는 명세서를 '보류'하면 그 뒤가 막다른 길이다. 목록·상세 모달 어디에도 보류 해제 버튼이 없고, 승인 버튼은 초안/검토 상태에만, 검토완료 버튼은 초안에만 나타난다. 유일한 우회로는 재집계인데, 일반 재집계는 확인창에서 '초안(DRAFT)만 갱신하고 검토 이상은 보존한다'고 안내하면서 실제로는 보류 명세서도 보호 대상에서 빠져 있어 보류 사실을 무시하고 초안으로 되돌리며 금액을 자동 계산값으로 덮어쓴다. 반대로 보류 전에 금액을 수동 수정해 둔 명세서(분쟁 검토의 전형적 상황)는 일반 재집계도 건너뛰므로 영원히 보류에 갇혀 그 직원의 해당 월 급여는 승인·발송·지급이 불가능하다. 이때 남은 수단은 '강제 재집계'뿐인데 이것은 그 달 전체 명세서(승인·발송·지급완료 포함)를 몽땅 덮어써서 피해가 더 크다.
- **근거**: admin-payroll.js:480-491(모달)·149-157(목록) — approve는 DRAFT/REVIEWED, markReviewed는 DRAFT, paid는 APPROVED/SENT 조건뿐이라 HOLD에는 상세·PDF 외 동작 없음. 서버 PATCH는 status 변경을 받지만(netlify/functions/admin-payroll.ts:246-249) 프론트는 markReviewed(DRAFT 전용) 외에 status를 보내는 코드가 없음. lib/payroll-calc.ts:283-284 lockable=["REVIEWED","APPROVED","SENT","PAID"]||manually_edited — HOLD 미포함이라 비강제 재집계가 HOLD를 갱신하고 :335에서 status='DRAFT'로 되돌림(확인창 문구 admin-payroll.js:176과 불일치). grep으로 payroll-calc.ts에 HOLD 문자열 0건 확인.
- **권장조치**: ① HOLD 상태 명세서에 '보류 해제(→DRAFT 또는 REVIEWED)' 버튼 추가(서버 PATCH status는 이미 지원). ② payroll-calc.ts lockable 목록에 HOLD 추가해 재집계가 보류를 덮지 않게 하거나, 최소한 확인창 문구를 실제 동작과 일치시킬 것.


---

# P2 (70건)

## P2 · AI 비서 (8)

### #38 [데이터정합] AI 작업 지시 대상 검증 없음 — 워크스페이스에 못 들어오는 일반 회원에게도 작업 배정 가능
- **위치**: `lib/ai-agent-tools.ts:1572`
- **설명**: 본 화면은 작업을 지시할 때 대상이 실제 운영자(admin 타입)인지 확인하고 아니면 '관리자에게만 지시할 수 있습니다'라고 거부하는데, AI 비서는 숫자면 그대로 배정한다. 일반 후원 회원 ID를 대면 그 회원에게 작업이 걸리는데, 일반 회원은 워크스페이스 화면에 접근할 수 없으므로 그 작업은 아무도 볼 수 없는 유령 카드가 된다(알림도 없음 — 상기 발견과 결합).
- **근거**: tool_taskCreate:1572 `const assignedTo = args?.assignedTo ? Number(args.assignedTo) : null` — 타입 검증 없음(존재하지 않는 ID는 schema.ts:1602 FK로만 실패). tool_taskUpdate:1972도 동일. 본 API(admin-workspace-tasks.ts:528-536·765-772)는 members.type !== 'admin'이면 400.
- **권장조치**: 배정 전 members 조회로 type='admin' 검증(본 API와 동일 문구로 거부).

### #39 [데이터정합] AI 완료 처리 시 완료자·진행률 미기록, 완료 해제 시 완료시각 잔존, 보관 시 보관시각 미기록 — 성과 표기·보관해제 복원이 어긋남
- **위치**: `lib/ai-agent-tools.ts:1962`
- **설명**: AI로 작업을 done 처리하면 완료시각만 기록되고 '누가 완료했는지(completed_by)'와 진행률 100% 반영이 빠져, 카드 상세에 완료자가 공란으로 남고 진행률 막대가 완료 전 값에 머문다. done을 다시 todo로 되돌려도 완료시각·완료자가 지워지지 않아 '완료한 적 있는 미완료 카드'가 된다. archived 전환도 보관시각(archived_at) 없이 상태만 바뀌고 보관 활동로그가 없어서, 본 화면의 '보관 해제'가 직전 상태를 활동로그에서 찾지 못해 항상 todo로 복원돼 원래 상태(doing/done)를 잃는다.
- **근거**: tool_taskUpdate:1962 done 시 `patch.completed_at = new Date()`만(completed_by·progress=100 없음, done 해제 시 초기화 없음, 1960 ALLOWED_TASK_STATUSES에 archived 포함이나 archived_at 미설정). 본 API: 640-647(completedBy·progress·해제 시 null), 806-830(archive: archivedAt+활동로그), 836-851(unarchive가 task.archive 활동로그 metadata.prevStatus로 복원 — AI 경로 보관은 로그가 없어 todo 폴백).
- **권장조치**: done 전환 시 completed_by=호출자·progress=100, done 이탈 시 두 필드 초기화, archived 전환 시 archived_at+활동로그 기록.

### #40 [버그] 위젯·전체화면의 '승인하고 실행' 버튼이 확정 실행이 아니라 AI에게 자연어로 부탁하는 방식 — 실행이 안 되거나 인자가 바뀔 수 있음
- **위치**: `public/js/ai-agent-widget.js:767`
- **설명**: 미리보기 아래 '✅ 승인하고 실행' 버튼을 누르면 서버에 구조화된 승인 신호가 아니라 "(시스템) 사용자가 승인. XX을 다음 인자로 실제 적용해주세요: {...}"라는 자연어 메시지가 전송되고, AI 모델이 스스로 도구를 다시 호출해야 실행된다. 모델이 재호출을 안 하거나 인자를 바꿔 부를 수 있고, 특히 인자 속 한국어(예: 제목에 '회원 감사 메일')가 다른 도메인 키워드에 걸리면 동적 도구 선택이 승인 대상 도구를 아예 로드하지 않아 실행 불가가 된다. API 문서에 있는 구조화 승인 파라미터(toolApproval)는 요청 검증만 통과시키고 처리 코드가 없는 죽은 계약이다. 승인 1건마다 LLM 호출 비용도 추가로 든다.
- **근거**: 위젯 sendApprovedTool(757-768)·전체화면 admin-ai-assistant.html:310-315 모두 자연어 릴레이. admin-ai-agent.ts에서 toolApproval은 주석(10)·검증(571)뿐 실행 분기 없음(grep 3곳). selectRelevantTools(385-408)는 키워드 매칭 그룹 도구만 로드 — 승인 메시지가 다른 그룹에만 매칭되면 대상 도구 미로드. 단답 short-circuit(607)은 '응/네' 등 정확 일치만 잡아 버튼 메시지는 미해당.
- **권장조치**: 버튼 승인을 body.toolApproval 구조화 경로로 구현(직전 dry-run과 도구명·인자 대조 후 executeTool 직접 실행 + 로그) — LLM 왕복 제거로 비용·신뢰성 동시 개선.

### #41 [보안] '응·네·진행' 단답으로 승인된 AI 도구 실행은 AI 도구 이력에 안 남고, 도구 차단 토글 검사도 건너뜀
- **위치**: `netlify/functions/admin-ai-agent.ts:638`
- **설명**: AI가 변경 작업 미리보기를 보여준 뒤 운영자가 채팅에 "응" 또는 "진행"이라고 짧게 답하면 서버가 지름길로 즉시 실행하는데, 이 경로만 ① AI 도구 호출 이력 테이블(ai_agent_logs) 기록이 빠져 통합 CMS의 AI 실행 이력 화면에서 실제 실행이 조회되지 않고(미리보기 dry-run 행만 남음) 복구용 rollback_data도 유실되며 ② 어드민이 도구를 비활성화하거나 role을 올려도 그 토글 검사(checkToolAllowed)를 거치지 않는다. 승인 직전 어드민이 도구를 껐어도 실행된다.
- **근거**: short-circuit 분기(admin-ai-agent.ts:607-658): executeTool 직접 호출(638) 후 대화 저장만 — ai_agent_logs INSERT 없음·checkToolAllowed 미호출. 일반 루프는 checkToolAllowed(870)+ai_agent_logs INSERT(897-908) 수행. 이력 화면 API admin-ai-logs-list.ts가 ai_agent_logs를 조회.
- **권장조치**: short-circuit 분기에도 checkToolAllowed + ai_agent_logs INSERT(rollback_data 포함)를 일반 루프와 동일하게 적용.

### #42 [보안] SSE 스트림 API는 도구를 실행해도 AI 도구 이력을 한 건도 안 남김
- **위치**: `netlify/functions/admin-ai-agent-stream.ts:340`
- **설명**: AI 비서의 스트리밍 응답 API(admin-ai-agent-stream)는 도구 권한 체크는 하지만 실행 결과를 AI 도구 이력 테이블에 전혀 기록하지 않는다. 현재 위젯은 스트림 모드를 꺼둔 상태(ENABLE_STREAM=false)라 실사용은 없지만 API 자체는 라이브로 열려 있어, 이 경로로 실행된 변경 작업은 이력 화면·롤백 데이터·도구별 통계에서 완전히 누락된다.
- **근거**: 스트림 도구 루프(316-363)에 executeTool(340) 후 ai_agent_logs INSERT 없음 — 파일 전체 grep ai_agent_logs·logAudit 0건. 비스트림 admin-ai-agent.ts:897-908은 매 호출 INSERT. 위젯 호출부는 ai-agent-widget.js:548(696행 ENABLE_STREAM=false로 미사용).
- **권장조치**: 스트림 루프에도 동일한 ai_agent_logs INSERT 추가. 당분간 미사용이면 엔드포인트 임시 비활성도 대안.

### #43 [보안] AI 경로의 마감일 변경이 '마감일 정정요청 승인' 워크플로우를 통째로 우회함
- **위치**: `lib/ai-agent-tools.ts:1973`
- **설명**: 본 화면에서는 작업 마감일을 바로 못 바꾸고 전용 정정요청 API로 보내 승인 절차(최근 근태 연동 개편 8e66924a·077df183의 핵심 통제)를 거치게 막아놨는데, AI 비서에게 "작업 5번 마감일 다음주로 미뤄줘"라고 하면 승인 없이 즉시 DB에 반영된다. 지시받은 담당자가 지시자 승인 없이 자기 마감일을 늘릴 수 있고, 마감 변경 이력도 남지 않아 근태·성과 계산의 전제(승인된 마감일)가 흔들린다.
- **근거**: tool_taskUpdate:1973-1977 dueDate 인자를 due_date로 직접 UPDATE. 본 API 일반 PATCH(admin-workspace-tasks.ts:953-955)는 `if (body.dueDate !== undefined) return badRequest("마감일 변경은 /admin/task-due-changes API를 사용하세요")`로 차단.
- **권장조치**: AI 도구에서 dueDate 변경 인자를 거부하고 정정요청 생성으로 안내하거나, 소유자 본인·미지시 카드에 한해서만 허용.

### #44 [보안] AI tasks_list가 전 운영자의 작업을 무제한 노출 — 본 화면은 본인 관련 작업만
- **위치**: `lib/ai-agent-tools.ts:1508`
- **설명**: 본 화면 작업 목록은 super_admin이 아니면 본인이 소유하거나 담당한 작업만 보여주는데, AI 비서에게 "작업 목록 보여줘"라고 하면 소속 무관 전체 운영자의 작업 제목·상태·마감일이 조회된다. memberId 필터는 선택 인자일 뿐 기본이 전체다. 조회 결과는 읽기 도구 캐시에도 저장돼 재노출될 수 있다.
- **근거**: tool_tasksList(1499-1515): WHERE절에 호출자 스코프 없음(status·memberId 선택 필터만). 본 API 목록(admin-workspace-tasks.ts:395-397)은 non-super에 `memberId=meId OR assignedTo=meId` 강제. 캐시 저장은 admin-ai-agent.ts:884-886.
- **권장조치**: super_admin이 아니면 `(member_id=${adminId} OR assigned_to=${adminId})` 조건을 기본 적용.

### #45 [보안] 일괄 처리 도구(bulk_pipeline)가 내부에서 다른 변경 도구를 위임 실행할 때 도구별 비활성 토글·역할 제한을 우회함
- **위치**: `lib/ai-agent-tools.ts:5595`
- **설명**: 어드민이 통합 CMS에서 특정 AI 도구(예: 회원 차단 members_block)를 비활성화하거나 super_admin 전용으로 올려도, 일괄 처리 도구가 켜져 있으면 그 경유로 차단된 도구가 실행된다. 도구 차단 검사는 AI가 직접 부른 최상위 도구 이름에만 적용되고, 일괄 도구가 내부에서 레코드별로 위임 호출할 때는 검사 없이 바로 실행되기 때문이다. 내부 위임 실행 건들은 도구 이력에도 개별 기록되지 않는다.
- **근거**: tool_bulkPipeline:5594-5595 `executeTool(action, toolArgs, adminId)` 직접 위임 — checkToolAllowed는 admin-ai-agent.ts:870에서 최상위 toolName에만 적용되고 executeTool 내부엔 없음. 위임 가능 action: members_block·email_send·legal_status_update 등(5513-5518). ensureRole(5502)은 operator 이상만 확인.
- **권장조치**: bulkPipeline 위임 직전에 각 action에 대해 checkToolAllowed(action, 호출자 role) 재검사 + 위임 실행도 ai_agent_logs 기록.


## P2 · 칸반·작업카드 (11)

### #92 [누락기능] 개인 카드·서브태스크의 마감일을 바꿀 방법이 어디에도 없음
- **위치**: `netlify/functions/admin-workspace-tasks.ts:953`
- **설명**: 카드 상세의 마감일 입력란은 비활성화돼 있고 '변경은 마감일 변경 요청으로'라고 안내하지만, 변경 요청은 '지시받은 수행자'만 만들 수 있습니다. 즉 본인이 직접 만든 개인 카드, 담당자를 지정하지 않은 서브태스크, 지시자 본인은 마감일을 한 번 정하면(또는 잘못 넣으면) 영원히 수정할 수 없습니다. 일반 수정 API도 마감일 변경을 명시적으로 거부합니다. 코드 주석에도 '본인 task 직접 변경(미래 확장)'으로 미완 상태임이 적혀 있습니다.
- **근거**: admin-workspace-tasks.ts:953-955 — 일반 PATCH에서 dueDate 포함 시 400 반환. workspace-kanban.html:244 — `<input id="wkCardDueDate" disabled>`. admin-task-due-changes.ts:169-172 — POST는 `task.assignedTo !== meId || !task.assignedBy`면 403(개인 카드·미할당 서브태스크는 요청 불가). admin-task-due-changes.ts:5 주석 '본인 task: 직접 dueDate 변경 (미래 확장)'.
- **권장조치**: 소유자이면서 지시받지 않은 카드(_computed.canEditDueDate가 이미 이 조건을 계산함)는 일반 PATCH에서 dueDate 직접 수정을 허용하고 모달 입력란을 활성화.

### #93 [누락기능] WBS 카드에 연결한 파일을 카드에서 열람·다운로드할 수 없음 — 이름만 보이는 첨부
- **위치**: `public/js/workspace-kanban.js:1807`
- **설명**: 카드 파일 탭(54c26c9f 신규)은 첨부 파일의 이름·크기·연결해제 버튼만 그리고 다운로드/열기 동작이 아예 없다. 팀원이 카드에서 첨부를 확인하려면 파일함으로 가서 직접 찾아야 하는데, 파일 가시성 규칙상 남의 비공개 파일은 파일함에서도 안 보이므로(별도 발견) 첨부 공유라는 목적이 달성되지 않는다. 카드 접근 권한자는 첨부 목록 API로 파일 존재는 볼 수 있으나 내용에는 접근할 수 없는 반쪽 기능.
- **근거**: workspace-kanban.js:1807-1816 첨부 li 렌더 — 클릭/다운로드 핸들러는 [data-file-remove](1817행)뿐. admin-workspace-file-download.ts:39-56은 파일 소유·전체공개·파일단위 공유만 허용(카드 접근권 무관).
- **권장조치**: 첨부 항목에 다운로드 버튼 추가 + 다운로드 API에 '해당 파일이 첨부된 카드의 접근권자' 허용 조건 추가(workspaceTaskAttachments 조인).

### #94 [데이터정합] 마감일 변경이 승인돼도 리마인더 발송 시각이 옛 마감 기준으로 남음
- **위치**: `netlify/functions/admin-task-due-changes.ts:314`
- **설명**: 수행자가 리마인더(예: 마감 60분 전)를 켜둔 카드의 마감일 변경이 승인되면 카드의 마감일은 바뀌지만 리마인더 발송 예정 시각은 저장 당시(옛 마감 기준) 그대로입니다. 마감을 3일 미루면 알림이 3일이나 일찍 오고, 마감을 앞당기면 이미 지난 뒤에 옵니다. 또한 카드 생성 시점에 리마인더 설정을 함께 넣는 경로(API 직접 호출·AI 도구)는 발송 시각 계산 자체가 없어서 리마인더가 영영 발송되지 않습니다.
- **근거**: admin-task-due-changes.ts:314-322 — 승인 시 workspaceTasks.dueDate만 갱신, reminderConfig 미조정. remindAt은 admin-workspace-task-reminder.ts:66-73에서 저장 시점에만 계산·고정되고, cron-workspace-task-reminder.ts:29-37은 저장된 reminder_config->>'remindAt'만 조회. 생성 POST(admin-workspace-tasks.ts:559)는 body.reminderConfig를 remindAt 계산 없이 그대로 저장.
- **권장조치**: 마감일 변경 승인 시 reminderConfig.enabled면 remindAt을 새 마감 기준으로 재계산하고 firedAt을 초기화. 근본적으로는 크론이 remindAt 저장값 대신 dueDate-minutesBefore를 실시간 계산하는 방식이 안전.

### #95 [버그] 작업 지시·완료·보류·마감변경 결과 알림을 클릭하면 카드가 아닌 어드민 홈으로 감 (죽은 링크 /admin#task-N)
- **위치**: `netlify/functions/admin-workspace-tasks.ts:588`
- **설명**: 새 작업이 지시됐거나, 지시한 작업이 완료·보류됐다는 알림, 마감일 변경 승인/반려 결과 알림을 알림함에서 클릭하면 해당 카드가 열리지 않고 어드민 대시보드 첫 화면만 뜹니다. 링크가 '/admin#task-번호' 형식인데 이 해시를 해석하는 코드가 어느 페이지에도 없기 때문입니다. 댓글·보고서·마감 크론 알림은 올바르게 '/workspace-kanban.html#task=번호'로 연결되는 것과 대조적입니다.
- **근거**: admin-workspace-tasks.ts:588(생성·지시), 672(상태변경·완료), 795(재지시), 902(보류)와 admin-task-due-changes.ts:231·360, workspace-logger.ts:240(기본값)이 actionUrl '/admin#task-N' 사용. grep 결과 public/js 전체에서 '#task-' 해시 처리 코드 없음('#task=' 처리만 workspace-kanban.js:1302에 존재). 알림 클릭 시 workspace-notifications.js:197이 data-url로 그대로 이동.
- **권장조치**: actionUrl을 전부 '/workspace-kanban.html#task=N'으로 통일 (댓글·크론 알림과 동일 패턴).

### #96 [버그] 알림·딥링크로 카드를 열 때 내 보드 목록에 없는 카드면 '삭제됐을 수 있습니다' 오탐 — 지시자는 자기가 시킨 카드를 못 엶
- **위치**: `public/js/workspace-kanban.js:730`
- **설명**: 다른 사람에게 지시한 카드는 소유자가 수행자로 기록되기 때문에 지시자의 칸반 보드 목록에는 포함되지 않습니다. 그래서 지시자가 그 카드의 댓글·보고서 알림(링크는 정상)을 클릭해 들어와도 화면은 '작업을 찾을 수 없어요. 삭제됐을 수 있습니다'라는 잘못된 안내만 띄웁니다. 카드 열기 함수가 현재 화면에 로드된 목록에서만 찾고, 단건 조회 API(지시자도 열람 권한 있음)로 폴백하지 않기 때문입니다. 칸반 화면에는 '내가 지시한 작업' 범위 옵션도 없어 지시자는 이 카드를 볼 방법이 없습니다.
- **근거**: admin-workspace-tasks.ts:523-524 — 지시 생성 시 memberId=assignedTo(수행자)로 저장. 목록 스코프(:393-397) mine은 memberId=me OR assignedTo=me라 지시자 미포함. workspace-kanban.js:729-731 openCardModal은 `STATE.tasks.find` 실패 시 그냥 return, 해시 진입(:1301-1314)은 못 찾으면 오탐 토스트. 단건 GET(:297-303)은 assignedBy=me에게 열람 허용하므로 폴백만 있으면 열림. 칸반 스코프 select(workspace-kanban.html:88-92)는 mine/inbox/all뿐.
- **권장조치**: openCardModal에서 목록에 없으면 단건 GET으로 조회해 여는 폴백 추가 + 스코프에 '내가 지시한 작업'(assignedByMe=1, 서버 이미 지원) 옵션 노출.

### #97 [버그] 마감일 없는 지시 카드에서 마감일 변경을 요청하면 서버 오류(500) 발생
- **위치**: `netlify/functions/admin-task-due-changes.ts:192`
- **설명**: 마감일 없이 생성된 카드를 지시받은 수행자가 카드 모달의 '마감일 변경 요청' 패널에서 새 마감일과 사유를 입력해 요청하면, 친절한 안내 대신 '마감일 변경 처리 중 오류'라는 서버 오류가 납니다. 요청 레코드가 '현재 마감일'을 필수값으로 저장하는데 카드에 마감일이 없어 DB가 거부하기 때문입니다. 마감일 선택화(2026-07-09) 이후 새로 생긴 회귀입니다.
- **근거**: admin-task-due-changes.ts:187-196 — `currentDue: task.dueDate`로 INSERT. db/schema.ts:1724 — current_due는 `.notNull()`. 카드 생성(admin-workspace-tasks.ts:517-521, 546-549)은 assignedTo가 있어도 dueDate null 허용. 요청 패널(workspace-kanban.js:686-695)은 카드 마감일 유무와 무관하게 수행자에게 노출.
- **권장조치**: currentDue 컬럼을 nullable로 마이그레이션하거나, dueDate가 null인 경우 요청 생성 대신 마감일 직접 설정 경로 제공.

### #98 [버그] 카드 모달·리스트뷰·크론 알림의 마감 시각이 KST가 아닌 UTC로 표시돼 9시간(경계일엔 하루) 어긋남
- **위치**: `public/js/workspace-kanban.js:736`
- **설명**: 카드를 '7월 10일 오전 9시' 마감으로 만들면 보드 카드에는 7/10로 맞게 보이지만, 카드 상세 모달의 마감일 칸에는 '7월 10일 00:00', 리스트뷰·서브태스크 목록에는 자정 이전 마감 건이 전날 날짜로 표시됩니다. 서버가 준 UTC 문자열을 시간대 변환 없이 잘라 쓰기 때문입니다. 마감 크론 알림 본문의 '마감: …' 시각도 UTC라 실제보다 9시간 이르게 안내되고, 팀 피드의 오늘/어제 그룹핑도 UTC 자정 기준이라 KST 새벽 활동이 '어제'로 묶입니다.
- **근거**: workspace-kanban.js:736 및 workspace-task-modal.js:138 — `t.dueDate.slice(0, 16)`을 datetime-local에 주입(UTC 그대로). 리스트뷰 :188 `t.dueDate.slice(0,10)`, 서브태스크 :2291 `String(it.dueDate).slice(0,10)`. cron-workspace-due-reminder.ts:85 — `toISOString().slice(0,16)`을 알림 본문에 사용. admin-workspace-tasks.ts:224-235 — feed groupKey가 서버(UTC) 자정 기준. 반면 보드 카드 formatDue(:447-460)는 브라우저 로컬(KST) 기준이라 화면 간 불일치.
- **권장조치**: 표시 경로 전부 lib-kst 헬퍼(fmtKSTDate 등)나 toLocaleString(timeZone:'Asia/Seoul')로 통일하고 datetime-local 주입 시 KST 변환 후 슬라이스.

### #99 [버그] 다른 사람이 카드를 완료 처리하면 AI 성과 매칭이 카드 주인이 아닌 '완료 처리한 사람' 기준으로 실행됨
- **위치**: `netlify/functions/admin-workspace-tasks.ts:688`
- **설명**: 지시자(작업을 시킨 사람)나 슈퍼어드민도 직원 카드를 완료 상태로 옮길 수 있는데, 이때 백그라운드 AI 성과 매칭에 카드 소유자가 아니라 '완료 버튼을 누른 사람'의 번호가 전달된다. 그 결과 (1) 누른 사람에게 성과 역할이 없으면(슈퍼어드민 등) 매칭이 통째로 건너뛰어져 카드가 소유자의 분류 대기 큐에 쌓이고, (2) 누른 사람에게 다른 성과 역할이 있으면 카드가 엉뚱한 사람 역할의 마일스톤에 자동 연결되며 목표 달성 판정·비매출 성과 자동 제출도 누른 사람 명의로 계산된다. 직원 본인이 자기 카드를 완료할 때(소유자=처리자)만 정상이다.
- **근거**: admin-workspace-tasks.ts:688 triggerMilestoneMatch(id, meId) — meId는 인증 사용자(:151), 카드 소유자는 task.memberId. 완료 권한은 소유자 외 지시자·수신자·슈퍼어드민에게도 있음(:624-628 canEdit). 백그라운드는 이 memberId로 milestone_role 조회(ai-task-milestone-match-background.ts:53-58)·달성 카운트/성과 INSERT(:175-208, member_id=memberId). 집계·큐는 모두 카드 소유자 기준(workspace-milestone-progress.ts:72, pending.ts:43)이라 불일치
- **권장조치**: triggerMilestoneMatch(id, task.memberId)로 카드 소유자를 전달

### #100 [보안] 작업 댓글 조회에 접근 권한 검증이 없어 모든 운영자가 남의 작업 댓글을 열람 가능 (IDOR)
- **위치**: `netlify/functions/admin-workspace-task-comments.ts:79`
- **설명**: 댓글 목록·단건 조회 API가 작업 번호만 바꿔 호출하면 소유자·담당자·지시자가 아닌 운영자에게도 해당 작업의 모든 댓글 내용을 그대로 반환합니다. 같은 라운드에서 첨부(OP-035)·보고서(OP-034)·하위작업(OP-033)·활동로그(Q3-016)에는 접근 검증이 추가됐지만 댓글만 누락됐습니다. 인사·민감 사안 카드의 댓글이 권한 없는 운영자에게 노출될 수 있습니다.
- **근거**: admin-workspace-task-comments.ts:47-103 — GET(?taskId=N 목록, ?id=N 단건) 모두 requireAdmin 통과 후 곧바로 select, workspaceTasks 소유/담당/지시 검증 없음. POST(:125-130)에는 canAccess 검증이 있어 비대칭. 대조: admin-workspace-task-attachments.ts:47-50, admin-workspace-task-reports.ts:90-94에는 IDOR 차단 코드 존재.
- **권장조치**: GET 진입 시 보고서 API와 동일한 작업 접근 검증(소유/담당/지시/완료자/super_admin) 블록 추가.

### #101 [보안] 작업 댓글 조회에 접근 검증이 없어 아무 직원 계정이나 남의 작업 댓글 전체 열람 가능
- **위치**: `netlify/functions/admin-workspace-task-comments.ts:46`
- **설명**: 작업 카드 자체(단건 조회·활동로그·서브태스크·첨부·보고서)는 전부 '소유자/담당자/지시자/super_admin만 열람' 검증이 있는데, 댓글 조회만 이 검증이 빠져 있다. 로그인된 어떤 관리자형 계정이든(직원 역할 포함) 작업 번호(taskId)를 1부터 바꿔가며 호출하면 자기와 무관한 비공개 작업의 댓글 대화 내용 전체(작성자 이름·이메일 포함)를 읽을 수 있다. 댓글 작성(POST)에는 검증이 있어서 조회 누락이 명백한 구멍이다.
- **근거**: admin-workspace-task-comments.ts:46-102 GET(단건 ?id=·목록 ?taskId=) 경로에 task 접근 검증 없음 — where 조건이 comment.id/taskId뿐. 반면 같은 파일 POST는 125-130행에서 `isSuperAdmin || task.memberId === meId || task.assignedTo === meId || task.assignedBy === meId` 검증. 비교: admin-workspace-tasks.ts:296-303(단건 canView), admin-workspace-subtasks.ts:40, admin-workspace-task-attachments.ts:47-49, admin-workspace-task-reports.ts:79-81 모두 조회 검증 있음.
- **권장조치**: GET 두 경로 모두에서 taskId의 작업을 조회해 POST와 동일한 canAccess(소유/담당/지시/완료자/super_admin) 검증 후 응답.

### #102 [에러처리] AI 검색이 실패하면 오류 안내 대신 가짜 카드('월간 보고서 작성')가 화면에 표시됨
- **위치**: `public/js/workspace-kanban.js:321`
- **설명**: AI 자연어 검색 API가 오류(AI 시간초과 등 500)를 반환하면 화면이 개발용 목업 데이터로 폴백해, 실제로 존재하지 않는 '월간 보고서 작성 / 박OO / 5월 16일 마감' 카드 1건이 검색 결과처럼 보드에 표시됩니다. 운영자는 검색이 성공한 것으로 오인하고, 우연히 42번 카드가 실존하면 남의 카드를 여는 시도로 이어질 수 있습니다. 'B 머지 전' 임시 목업이 운영 코드에 남은 잔재입니다.
- **근거**: workspace-kanban.js:26-33 — MOCK_AI_RESULT 상수(주석 'mock 데이터 (B 머지 전)'). :315-322 — `catch (_) { res = MOCK_AI_RESULT; }`로 API 예외 시 목업 사용, 이후 :333에서 STATE.tasks를 목업으로 교체·렌더. 실제 API(admin-workspace-task-search.ts:74-76)는 AI 실패 시 500을 반환하므로 api()가 throw → 목업 경로 진입.
- **권장조치**: catch에서 목업 대신 오류 토스트 + 키워드 검색 폴백(이미 아래쪽 catch에 있는 처리)로 통일하고 MOCK_AI_RESULT·MOCK_PREFS 상수 제거.


## P2 · 홈·메모·알림 (9)

### #83 [누락기능] 메모 수정·삭제 진입점이 사실상 없음 — 캘린더 미표시 메모는 한 번 만들면 지울 방법이 없음
- **위치**: `public/js/workspace.js:417`
- **설명**: 메모 삭제 기능은 서버에 구현돼 있지만 이를 호출하는 화면이 코드 전체에 하나도 없다. 수정 모달 진입도 캘린더에 표시(showInCalendar)한 메모를 캘린더에서 클릭할 때뿐이라, 일반 메모(캘린더 미표시)는 생성 후 수정도 삭제도 고정 해제도 불가능하다. 홈 메모 카드는 클릭해도 무반응, '전체 보기 →'도 동작하지 않는다.
- **근거**: DELETE 호출처 grep 0건(admin-workspace-memos 호출은 modal POST/PATCH/GET(id)·workspace.js 목록/검색뿐). .ws-memo-card 클릭 핸들러 grep 0건(렌더만 417-424행). openEdit 사용처는 workspace-calendar.js:494 한 곳(캘린더 이벤트로 노출된 메모 한정). 서버 DELETE는 admin-workspace-memos.ts:312-343에 정상 존재.
- **권장조치**: 홈 메모 카드 클릭 → 수정 모달(openEdit) 연결 + 모달에 삭제 버튼 추가.

### #84 [데이터정합] 워크스페이스 알림이 벨 목록에 두 줄씩 표시되고 안읽음 수가 2배로 집계
- **위치**: `lib/workspace-logger.ts:144`
- **설명**: 작업 지시·토스·마감 알림이 발생하면 같은 내용이 두 저장소(워크스페이스 알림 + 통합 알림)에 각각 기록되는데, 벨과 알림 전체보기는 두 저장소를 합쳐 보여주므로 동일 알림이 두 줄로 뜨고 안읽음 카운트도 두 배가 된다. 한 줄을 읽어도 나머지 한 줄은 안읽음으로 남는다. (운영자가 알림 설정에서 workspace.activity 인앱 채널을 꺼뒀다면 중복이 안 생길 수 있으나, 코드 기본값 기준으로는 중복 발생.)
- **근거**: sendWorkspaceNotification이 ① workspace_notifications INSERT(125-139행) 후 ② dispatch(WORKSPACE_ACTIVITY)(144-159행) → EVENT_CHANNEL_POLICY inapp(notify-events.ts:58) → inapp 어댑터가 createNotification으로 notifications 테이블에 recipient_id=동일 회원 INSERT. 조회(admin-workspace-notifications.ts:64-79)는 두 테이블 UNION ALL·ref_table 제외 조건 없음, unreadCount(85-90행)도 양쪽 합산.
- **권장조치**: UNION의 notifications 쪽에 `AND (ref_table IS DISTINCT FROM 'workspace_notifications')` 제외 조건 추가(가장 안전) 또는 workspace-logger의 dispatch 제거.

### #85 [버그] 알림 벨 배지가 1분마다 꺼짐 — 브리핑 응답 키 이름 불일치
- **위치**: `public/js/workspace.js:294`
- **설명**: 워크툴 홈의 알림 벨 숫자 배지가 뜨더라도 60초 브리핑 갱신이 돌 때마다 0으로 간주되어 숨겨지고, 다른 60초 알림 갱신이 다시 그리는 식으로 깜빡이거나 대부분의 시간 동안 안 보인다. 브리핑 API는 'unreadNotifCount'라는 이름으로 값을 주는데 화면은 'unreadNotificationsCount'라는 다른 이름을 읽어 항상 undefined→0이 되기 때문. 두 폴링이 세는 범위도 달라(브리핑=워크스페이스 알림만, 드롭다운=통합 합산) 숫자 자체도 서로 다르다.
- **근거**: workspace.js:294 `Number(d.unreadNotificationsCount || 0)` → 0이면 299행 `notifCount.style.display='none'`. 서버 admin-daily-briefing.ts:100은 `unreadNotifCount` 키로 반환(workspace_notifications만 집계, 84-88행). 반면 드롭다운 loadNotifications(1367행)는 통합 API의 unreadCount(두 테이블 합산) 사용. 브리핑 폴링 708-710행, 알림 폴링 1612-1615행 — 각각 60초.
- **권장조치**: renderBriefing에서 `d.unreadNotifCount ?? d.unreadNotificationsCount`로 읽거나 브리핑의 배지 갱신 로직을 제거하고 알림 API 단일 출처로 통일.

### #86 [버그] '지연'과 '오늘 마감' 카드가 같은 작업을 이중 집계 — 브리핑 숫자 부풀림
- **위치**: `netlify/functions/admin-daily-briefing.ts:64`
- **설명**: 오늘이 마감인 작업은 마감 시각이 지나는 순간부터 '지연' 카드와 '오늘 마감' 카드 양쪽에 동시에 계산된다. 예: 오늘 오전 10시 마감 작업 1건만 있어도 오후에는 지연 1 + 오늘 마감 1로 표시되고, 사이드바 배지(지연+오늘마감 합산)도 2로 부풀려진다. 운영자가 보는 핵심 현황 숫자가 실제 작업 수와 어긋난다.
- **근거**: 64행 overdue 조건 `due_date < now()`와 65행 today_due 조건 `due_date >= kstToday AND < kstTomorrow`가 상호 배타적이지 않음 — 오늘 범위 안이면서 이미 지난 작업은 둘 다 충족. 프론트 workspace.js:287-289는 setBadge에 (overdueCount+todayDueCount) 합산. 또한 kstToday는 'KST날짜의 UTC자정'(=KST 09:00)이라 자정~09시 마감분은 '오늘'에서 빠지는 9시간 어긋남도 동반(51-56행).
- **권장조치**: overdue에 `AND due_date < kstToday`(오늘 이전 마감만)를 추가해 상호 배타화하고, KST 자정 경계는 UTC-9h 보정으로 계산.

### #87 [버그] 팀 활동 피드가 자연어 대신 원문 코드('task.create')를 노출 + '마감일 변경' 필터는 항상 빈 결과
- **위치**: `public/js/workspace.js:439`
- **설명**: 홈의 팀 활동 피드 대부분 항목이 '홍길동이 작업 X를 만들었어요'가 아니라 '홍길동 — task.create'처럼 개발용 코드 그대로 표시된다. 화면의 문구 변환표가 실제 기록되는 코드명과 철자가 달라('task.create' vs 'task.created') 거의 전부 변환에 실패하기 때문. 또 피드 필터에서 '마감일 변경'을 고르면 실제 기록('due.request' 등)과 필터값('due_request')이 달라 항상 '활동이 없습니다'로 나온다.
- **근거**: 활동 기록 실제 값: admin-workspace-tasks.ts 582·665·1003 등 'task.create/complete/status/update/delete', events 'event.create/update/delete' (workspace-logger.ts ActivityActionType). 프론트 스위치(439-470행)와 ACTION_LABEL(61-74행)은 'task.created/updated/…' 키 → task.assign·task.checklist.toggle 두 개만 일치, 나머지는 default로 raw 코드 출력(470행). 필터: 523행 `startsWith(STATE.filterFeedType)`에 option 값 'due_request'(workspace.html:379) vs 실제 'due.request'. 동일 오매핑이 공용 모듈 workspace-activity-render.js:30-72에도 중복 존재(게다가 workspace.js는 이 모듈을 쓰지도 않음).
- **권장조치**: 매핑 키를 실제 actionType('task.create'…)으로 정정하고 workspace.js가 WorkspaceActivityRender 모듈을 사용하도록 단일화. 필터 값은 'due.'로.

### #88 [버그] 통합 검색(Ctrl+K)에서 메모가 절대 검색되지 않음 — 필수 파라미터 누락으로 항상 400
- **위치**: `public/js/workspace.js:1060`
- **설명**: 상단 통합 검색창에 키워드를 넣으면 작업·파일은 나오지만 메모는 아무리 정확한 제목을 쳐도 결과가 없다. 메모 검색 요청에 서버가 요구하는 목록 표시(list=1) 파라미터가 빠져 있어 서버가 매번 '요청 형식 오류(400)'로 거절하고, 화면은 오류를 빈 결과로 처리하기 때문.
- **근거**: 1060행 `/api/admin-workspace-memos?q=...&limit=10` — list=1 없음. 서버 admin-workspace-memos.ts GET은 id(46행) 또는 list==="1"(65행)만 처리, 그 외 125행 `badRequest("list=1 또는 id=N 필수")`. fetchMemos 1063행 `if (!res.ok) return []` → 조용히 빈 배열.
- **권장조치**: 검색 URL에 `list=1&` 추가.

### #89 [버그] 홈 메모 위젯에 메모 내용이 안 보임 (필드명 불일치로 항상 빈 본문)
- **위치**: `public/js/workspace.js:421`
- **설명**: 워크툴 홈 메모 패널의 메모 카드에 제목과 날짜만 보이고 적어둔 내용은 전혀 표시되지 않는다. 서버는 내용을 'contentHtml' 이름으로 주는데 화면은 존재하지 않는 'content' 필드를 읽어 항상 빈 문자열이 되기 때문. 메모를 열어볼 다른 수단도 홈에는 없어서 내용 확인이 불가능하다.
- **근거**: 421행 `escapeHtml((m.content || '').slice(0, 150))` — 목록 API(admin-workspace-memos.ts:84-93 drizzle select)는 schema(db/schema.ts:1657) 기준 contentHtml 키만 반환. 'content' 컬럼 없음.
- **권장조치**: m.contentHtml로 정정(HTML이면 텍스트 변환 후 표시).

### #90 [버그] 홈 화면 클릭 요소 12곳이 무반응(죽은 버튼) — 새로고침·브리핑 카드 6개·'전체 보기' 링크들
- **위치**: `public/workspace.html:136`
- **설명**: 상단 '🔄 새로고침' 버튼, 브리핑의 지연/오늘마감/내일마감/지시받은작업/긴급/오늘일정 카드 6개, 각 패널의 '전체 보기 →'(내 작업·할당받은 작업·메모), '달력 보기 →', 피드 '더 보기 →'가 전부 눌러도 아무 일도 일어나지 않는다(주소창 해시만 바뀜). 운영자가 숫자 카드를 눌러 해당 작업 목록으로 들어가려는 자연스러운 흐름이 전부 끊겨 있다.
- **근거**: workspace.html 136(refresh)·187-228(data-ws-filter 6개)·278·296·314·332·381행에 data-ws-action/data-ws-filter 부여. public/js 전체에서 'data-ws-filter'·'view-all-tasks'·'view-all-inbox'·'view-all-memos'·'view-all-feed'·'open-calendar'·refresh 액션 핸들러 grep 0건(workspace.js bindEvents는 new-task/new-memo/new-event/toggle-files/재시도만 처리).
- **권장조치**: 최소한 새로고침=전 패널 reload, 브리핑 카드=칸반 필터 링크, 달력 보기=/workspace-calendar.html 연결. 당장 못 하면 클릭 불가 스타일로 오해 제거.

### #91 [성능비용] 백그라운드 탭에서도 60초 폴링 2종이 계속 돌아 DB(Neon) 절전을 방해
- **위치**: `public/js/workspace.js:1612`
- **설명**: 워크툴 홈을 탭으로 열어두기만 하면 브리핑 통계(60초)와 알림+멘션(60초) 폴링이 탭이 안 보여도 영원히 돌아간다. 한 번의 브리핑 폴링은 DB 쿼리 3개를 유발하므로 방치된 탭 하나가 분당 4~5개 쿼리로 DB를 계속 깨워 자동 절전(autosuspend)이 못 걸린다. 최근 채팅 폴링에 적용한 '백그라운드 탭이면 건너뛰기' 비용 절감 수정(a09eac89)이 이 페이지에는 빠져 있다.
- **근거**: 708-710행 `setInterval(() => loadBriefing()...)`, 1612-1615행 `setInterval(() => { loadNotifications(); loadMentions(); }, 60000)` — 둘 다 document.hidden 가드 없음. 대조: notification-bell.js는 visibilitychange로 폴링 중지(가드 보유), 커밋 a09eac89는 채팅 30초 폴링에 같은 가드 적용.
- **권장조치**: 두 setInterval 콜백 첫 줄에 `if (document.hidden) return;` 추가(복귀 시 page:visible 이벤트가 이미 재조회함).


## P2 · 캘린더·일정 (7)

### #67 [누락기능] 구글 연동을 해제하거나 다시 연결할 방법이 없음 — 토큰이 죽으면 동기화가 영구 실패 상태에 갇힘
- **위치**: `netlify/functions/google-calendar-status.ts:30`
- **설명**: 구글 연동을 끊는 기능(버튼·API)이 어디에도 없습니다. 화면은 '연동됨' 상태면 연동 버튼을 숨기고 동기화 버튼만 보여주는데, 사용자가 구글 계정 설정에서 앱 권한을 회수하거나 리프레시 토큰이 무효화되면 동기화는 매번 '토큰 갱신 실패' 오류만 반복합니다. 이때 상태 확인은 여전히 '연동됨'이라고 답해 재연동 버튼이 영영 나타나지 않으므로, 운영자가 이 상태에서 빠져나올 방법이 없습니다(개발자가 DB를 직접 지워야 함).
- **근거**: googleCalendarTokens 테이블을 만지는 함수는 callback(insert/update)·status(select)·sync(update)뿐(grep 확인) — delete 또는 syncEnabled=false로 바꾸는 엔드포인트 없음. status.ts:30 connected=!!token.syncEnabled — 토큰 유효성 무관하게 true 유지. sync.ts:12-37 refreshAccessToken 실패 시 throw→500 반환만 하고 상태 전환 없음. 프론트 workspace-calendar.js:594-597 — connected면 연동 버튼 display:none.
- **권장조치**: '연동 해제' 버튼 + DELETE 엔드포인트(토큰 행 삭제) 추가, refresh 401/invalid_grant 시 syncEnabled=false로 내려 재연동 버튼이 다시 뜨게 처리.

### #68 [누락기능] 반복 일정이 '지원'이라고 적혀 있지만 실제로는 첫 회차만 저장되고 반복 표시가 전혀 안 됨
- **위치**: `netlify/functions/admin-workspace-events.ts:304`
- **설명**: 일정 생성 API 머리말에 '반복 규칙 지원'이라고 적혀 있고 DB에도 반복 규칙 칸(예: 매월 15일)이 준비돼 있지만, 규칙을 저장만 할 뿐 반복 회차를 만들어내거나 캘린더에 펼쳐 보여주는 코드가 프로젝트 어디에도 없습니다. 화면에도 반복을 설정하는 입력란이 없습니다. 결국 '매주 월요일 주간회의' 같은 반복 일정을 등록할 방법이 없고, API로 규칙을 넣어도 캘린더에는 첫 날짜 하나만 나타납니다.
- **근거**: admin-workspace-events.ts:11 주석 'POST: 생성 (반복 규칙 지원)'·304-305행 recurringRule/recurringParentId 저장. schema.ts:1702 recurring_rule varchar('FREQ=MONTHLY;BYMONTHDAY=15' 예시). 전체 grep 결과 workspace_events용 RRULE 전개·조회 로직 없음(att-* 의 recurringRule은 근태 요일규칙으로 별개). 목록 GET(183-257)은 저장된 단일 행만 반환. 생성/수정 모달(workspace-calendar.html:155-190)에 반복 입력란 없음. AI 도구 event_create(ai-agent-tools.ts:2508-2550)도 반복 미지원.
- **권장조치**: 1안: 목록 조회 시 recurringRule을 기간 내 가상 회차로 전개해 반환. 2안(단순): 생성 시 N회차를 실제 행으로 복제(recurringParentId 연결). 화면에 반복 선택 UI 추가.

### #69 [누락기능] 공휴일 API는 만들어졌지만 캘린더 어디에도 연결되지 않아 공휴일이 표시되지 않음
- **위치**: `netlify/functions/workspace-holidays.ts:39`
- **설명**: 한국 공휴일 목록을 돌려주는 서버 기능(workspace-holidays)이 2026-05-17 라운드에서 만들어져 검증 문서에 '통과'로 기록까지 됐지만, 캘린더 화면(또는 다른 어떤 화면)도 이를 호출하지 않습니다. 결과적으로 워크스페이스 캘린더에는 삼일절·추석 같은 공휴일이 전혀 표시되지 않아, 운영자가 공휴일에 회의를 잡는 실수를 막아주지 못합니다. 서버 기능만 있고 화면 연결이 빠진 '만들다 만 흐름'입니다.
- **근거**: 전체 저장소 grep 'workspace-holidays' — 호출처는 0건(문서 docs/history/verify·milestones와 함수 자신뿐). workspace-calendar.js에 holiday 관련 코드 없음, workspace-calendar.css에도 holiday 클래스 없음(grep 0건). FullCalendar 옵션(initCalendar 628-691행)에 공휴일 소스 미등록.
- **권장조치**: initCalendar에서 연도별로 /api/workspace-holidays 호출 → FullCalendar background event(display:'background', 빨간 표시)로 주입. 연도 이동 시 재조회.

### #70 [누락기능] 일정에 참석자를 초대하는 화면이 없어 참석(RSVP)·초대 알림·공유 흐름 전체가 사실상 작동 불가
- **위치**: `public/js/workspace-calendar.js:435`
- **설명**: 서버에는 참석자 초대(초대 알림 발송), 참석/불참/미정 응답, 응답 현황 집계, 초대자만 응답 가능하게 막는 검증까지 다 만들어져 있습니다. 그런데 참석자를 지정하는 입력란이 캘린더의 일정 생성/수정 모달에도, 다른 어떤 화면에도, AI 비서 도구에도 없습니다. 즉 모든 일정의 참석자 명단은 항상 비어 있고, 일정 상세의 '참석 예정/불참/미정' 버튼은 주최자가 자기 일정에 스스로 응답하는 용도로만 동작합니다(다른 사람 일정은 목록에 뜨지도 않음). 초대 알림·취소 알림·응답 알림이 실제로 발송될 경로가 없으며, 초대 알림의 이동 링크(/admin#event-N)도 받아주는 화면이 없는 죽은 링크입니다.
- **근거**: 생성/수정 payload(workspace-calendar.js:435-442)에 attendees 없음. 모달(workspace-calendar.html:155-190)에 참석자 입력란 없음. admin-workspace-events 호출처는 workspace-calendar.js·workspace.js뿐(grep), 어느 쪽도 attendees 미전송. AI 도구 event_create INSERT(ai-agent-tools.ts:2538-2542)도 attendees 컬럼 미포함. 서버측 완비: 초대 알림(admin-workspace-events.ts:340-351), RSVP 초대자 검증(workspace-event-rsvp.ts:50-57), 집계(workspace-event-rsvps.ts:51-55). actionUrl '/admin#event-N'(events.ts:349·425) — '#event-' 해시 처리 JS 전무(grep). 단일 상세 GET ?id=(attendeesWithNames 포함, 121-180행)·attending=1 필터도 호출처 0건.
- **권장조치**: 일정 생성/수정 모달에 운영자 멀티선택(참석자) 추가 → POST/PATCH body.attendees 연결. 알림 actionUrl을 /workspace-calendar.html 기준으로 통일(rsvp 함수는 이미 적용됨).

### #71 [버그] 구글 연동을 완료해도 화면이 '연동 전' 상태로 남음 — 연동 성공 신호를 받는 코드가 없음
- **위치**: `public/js/workspace-calendar.js:779`
- **설명**: '구글 연동' 버튼을 누르면 팝업에서 구글 로그인·동의를 진행하고, 완료되면 팝업이 부모 창에 '연동 완료' 신호를 보낸 뒤 닫힙니다. 그런데 캘린더 화면에는 이 신호를 듣는 코드가 없고, 팝업을 연 지 5초 뒤 딱 한 번 상태를 다시 확인할 뿐입니다. 구글 계정 선택과 동의에는 보통 5초 넘게 걸리므로 재확인이 연동 완료 전에 실행되어, 연동에 성공했는데도 버튼이 '🔗 구글 연동' 그대로 남습니다. 운영자는 실패한 줄 알고 다시 누르거나, 새로고침해야 '동기화' 버튼이 나타납니다.
- **근거**: google-calendar-callback.ts:22 — window.opener.postMessage({type:'gcal-connected'})와 ?gcal=connected 리다이렉트 제공. 그러나 public/js 전체 grep 결과 'message' 이벤트 리스너는 admin-site-builder.js뿐, workspace-calendar.js에는 없음. 'gcal=' 쿼리 파라미터를 읽는 코드도 없음. workspace-calendar.js:777-779 — window.open 직후 setTimeout(()=>loadGcalStatus(),5000) 1회뿐.
- **권장조치**: workspace-calendar.js에 window 'message' 리스너 추가(type==='gcal-connected'→loadGcalStatus()), 보조로 폴링 수 회 또는 popup.closed 감시.

### #72 [보안] 일정 참석응답(RSVP) 목록 조회에 일정 접근 검증이 없어 초대받지 않은 사람도 응답 현황·메모 열람 가능
- **위치**: `netlify/functions/workspace-event-rsvps.ts:19`
- **설명**: 일정 단건 조회는 '주최자/참석자/super_admin만' 볼 수 있고, 참석 응답 등록도 참석자 검증이 있는데, 응답 목록 조회 API만 검증이 없다. 어떤 관리자형 계정이든 일정 번호(eventId)를 바꿔가며 호출하면 자기가 초대받지 않은 비공개 일정의 참석자 명단·수락/거절 상태·거절 사유 메모까지 볼 수 있다.
- **근거**: workspace-event-rsvps.ts:11-25 requireAdmin 통과 후 eventId만 받아 workspaceEventRsvps 전체 select — 일정 소유/참석자 검증 없음. note(응답 메모)·memberName까지 응답(40-49행). 비교: admin-workspace-events.ts:132-136 단건 조회는 `canView = isSuperAdmin || ev.memberId === meId || isAttendee` 검증, workspace-event-rsvp.ts:55 응답 등록도 `ev.memberId !== meId && !attendeeIds.includes(meId)`면 403.
- **권장조치**: workspaceEvents에서 eventId 일정을 먼저 조회해 주최자/참석자/super_admin 검증 후 목록 반환.

### #73 [에러처리] 일정 조회가 실패하면 오류 안내 없이 가짜(mock) 일정을 그리거나 조용히 빈 화면이 됨
- **위치**: `public/js/workspace-calendar.js:292`
- **설명**: 서버 오류나 네트워크 문제로 일정 목록을 못 받아오면, 화면은 오류를 알리는 대신 개발 중에 쓰던 가짜 데이터('운영회의' 2026-05-13, '예시 메모' 2026-05-15)를 캘린더에 그대로 그립니다. 2026년 5월을 보고 있던 운영자는 실제로 존재하지 않는 회의를 진짜로 믿을 수 있습니다. 다른 달에서는 일정이 몽땅 사라진 빈 캘린더가 되는데 이때도 아무 안내가 없어, 운영자가 '일정이 없구나'라고 오인하게 됩니다. 작업·로드맵 로드 실패도 동일하게 무음 처리됩니다.
- **근거**: workspace-calendar.js:16-19 MOCK_EVENTS 상수('B 머지 전 사용' 주석 — 머지 후에도 잔존). 289-322행 loadEventsAndMemos catch에서 console.warn 후 MOCK_EVENTS를 실제 이벤트 배열로 변환·반환, 토스트 없음. loadTasks(183-186)·loadRoadmapPhases(219-222)도 catch에서 빈 배열 반환+console.warn만. fetchEvents(133-139)는 rejected 결과를 warn만 하고 무시.
- **권장조치**: MOCK_EVENTS/MOCK_RSVPS/MOCK_GCAL_STATUS 폴백 제거(스캐폴딩 청산), 로드 실패 시 '일정을 불러오지 못했습니다' 토스트+재시도 버튼 표시.


## P2 · 파일함·휴지통 (9)

### #74 [누락기능] 폴더에 파일이 100개를 넘으면 초과분에 접근할 방법이 없음 (서버는 페이지네이션 지원하나 화면 미구현)
- **위치**: `public/js/workspace-files.js:289`
- **설명**: 서버는 '더 보기'용 offset/total을 이미 반환하지만(OP-038) 화면이 이를 전혀 사용하지 않고 기본 100건만 받아 그린다. 파일 개수 표기도 로드된 개수 기준이라 운영자는 잘린 사실 자체를 모른다. 검색까지 죽어 있어(별도 발견) 101번째 이후 파일은 이 화면에서 사실상 도달 불가.
- **근거**: loadFiles(289-299행)가 limit/offset 미전달·res.data.total 미사용, 더보기 UI 없음(offset grep 0건). 서버 기본 limit 100(admin-workspace-files.ts:73), OP-038 주석·total 반환(155-169행).
- **권장조치**: total>items.length일 때 '더 보기' 버튼으로 offset 증가 로드, 카운트를 total 기준으로 표기.

### #75 [누락기능] '내 파일'·'공유받음' 탭이 '전체' 탭과 완전히 같은 목록을 보여줌 — 필터 파라미터를 서버가 무시
- **위치**: `public/js/workspace-files.js:294`
- **설명**: 상단 4개 탭 중 '내 파일'과 '공유받음'을 눌러도 전체 탭과 동일한 목록이 나온다. 프론트는 mine=1/shared=1을 보내지만 서버에 해당 필터가 구현돼 있지 않아 조용히 무시된다. 운영자가 '내 파일' 탭에서 남의 공개 파일을 보고 자기 것으로 오인하는 등 분류 신뢰가 깨진다.
- **근거**: workspace-files.js:294-295 params.set('mine'/'shared') — admin-workspace-files.ts GET(68-169행)에 mine/shared 파싱 없음(무시). 세 탭 모두 동일 visibilityCond 결과. HTML 탭 정의는 workspace-files.html:76-81.
- **권장조치**: 서버 GET에 mine=1(ownerId=me), shared=1(파일·폴더 공유 매칭) 분기 추가.

### #76 [누락기능] 파일·폴더를 다른 운영자에게 공유해도 당사자에게 알림이 전혀 없음
- **위치**: `netlify/functions/admin-workspace-file-share.ts:1`
- **설명**: 파일함에서 특정 운영자에게 파일이나 폴더를 공유해도 공유받은 사람은 벨 알림도, 활동 피드 기록도 받지 못한다. 상대가 우연히 파일함에 들어가 보기 전까지 공유 사실 자체를 알 수 없어 '공유 → 확인' 협업 흐름이 끊긴다. 작업 지시·토스·일정 초대는 모두 알림을 보내는 것과 대비되는 공백.
- **근거**: admin-workspace-file-share.ts(+ admin-workspace-files.ts·folders.ts·file-confirm.ts)에 logWorkspaceActivity/sendWorkspaceNotification/createNotification/dispatch 호출 grep 0건 — logAudit(감사로그)만 기록. 공유 POST는 sharedWith 대상 지정 구조(파일 헤더 5행).
- **권장조치**: 공유 생성 시 sharedWith 대상에게 sendWorkspaceNotification(category 'system', actionUrl '/workspace-files.html?folder=…') 발송.

### #77 [데이터정합] 영구삭제 시 R2 실파일 삭제가 실패해도 DB 기록을 먼저 지워버려 저장소에 유령 파일이 영구 잔존
- **위치**: `netlify/functions/cron-workspace-trash-cleanup.ts:50`
- **설명**: 휴지통 30일 크론·수동 영구삭제 모두 R2 저장소 삭제가 실패해도(네트워크 오류 등) DB 행을 지워버린다. DB 행에만 있던 파일 키가 사라지므로 그 R2 파일은 다시는 찾을 수 없는 고아가 되어 저장소 비용이 계속 나가고, 내부 문서·개인정보 파일이 삭제됐다고 믿는 상태로 저장소에 남는다. 코드 주석은 '고아 파일은 cron이 정리'라고 하지만 R2 고아를 정리하는 크론은 존재하지 않는다(크론의 orphan 정리는 blob_uploads의 context='workspace' 행 대상인데, 그 컨텍스트로 기록하는 코드가 없어 항상 0건 no-op).
- **근거**: cron 48-58행: deleteFromR2 실패(r.success=false) 시 errors만 쌓고 무조건 db.delete 진행. admin-workspace-files.ts:284-301 hard 삭제도 catch 후 계속. admin-workspace-file-purge.ts:45-50 동일 + 6행 주석 '고아 파일은 cron이 정리'. cron 85-109행 blob orphan은 blobUploads.context='workspace' 조건 — 해당 context로 insert하는 코드 없음(grep: cron 읽기만 존재).
- **권장조치**: R2 삭제 실패 시 DB 행을 남기고(purge_failed 마킹) 다음 크론에서 재시도. 성공 후에만 DB delete.

### #78 [데이터정합] 폴더 영구삭제 구(舊) 경로(?hard=1)는 내부 파일의 R2 원본을 전혀 안 지우고 DB만 삭제 — 추적 불가 고아 파일 양산
- **위치**: `netlify/functions/admin-workspace-folders.ts:417`
- **설명**: 폴더 API의 hard 삭제 분기는 하위 폴더 전체의 파일 DB 행을 통째로 지우면서 R2 실파일 삭제를 '향후 크론'에 미룬다고 주석에 적어놨지만 그런 크론은 없다. DB 행이 사라지면 파일 키를 아는 곳이 없어 R2 객체가 영구 잔존한다. 파일 단위 공유 레코드도 함께 정리하지 않는다. 현재 화면은 R2까지 지우는 별도 purge API를 쓰지만 이 위험한 구 경로가 API로 여전히 열려 있다.
- **근거**: admin-workspace-folders.ts:417-427 hard 분기 — db.delete(workspaceFiles) 직행, deleteFromR2 미호출, 주석 'R2 정리는 향후 cron, 일단 DB에서만'(419행 위 주석). 공유 정리는 targetType='folder'만(421-426행), 파일 공유(targetType='file') 잔존. 프론트는 admin-workspace-folder-purge 사용(workspace-files.js:808) — 그쪽은 R2 삭제 수행(folder-purge 64-73행).
- **권장조치**: ?hard=1 분기를 folder-purge와 동일 로직으로 교체하거나 410 폐기 처리.

### #79 [데이터정합] 업로드 3단계(presign→PUT→confirm) 중 중단되면 pending 행과 R2 조각이 영원히 쌓임 — 어떤 정리 장치도 없음
- **위치**: `netlify/functions/admin-workspace-file-presign.ts:83`
- **설명**: 업로드 URL 발급 시점에 DB에 '대기' 상태 행이 먼저 생기는데, 사용자가 업로드 도중 창을 닫거나 네트워크가 끊기거나 완료 확인 호출이 실패하면 이 행이 영구히 남는다. 목록은 완료된 파일만 보여주므로 운영자 눈에는 전혀 안 보이고, 휴지통에도 안 나온다. R2에 실제 올라갔지만 확인이 누락된 경우 실파일도 함께 잔존한다. 프론트 실패 처리도 '실패' 문구만 띄우고 정리 요청을 하지 않으며, 오래된 pending/failed 행을 청소하는 크론이 없다.
- **근거**: presign 83-99행 uploadStatus:'pending' insert. confirm은 R2 404일 때만 'failed' 마킹(51-59행), 삭제 아님. workspace-files.js:552-555 catch는 표시만. cron-workspace-trash-cleanup은 deletedAt 기준만 처리(36-44행) — uploadStatus 미참조. 목록 GET은 completed 필터(admin-workspace-files.ts:113)라 pending은 UI에서 삭제 불가.
- **권장조치**: 크론에 '생성 후 24h 경과한 pending/failed 행 + 대응 R2 객체 삭제' 단계 추가.

### #80 [버그] 관리자 로그인만 한 세션(사용자 로그인 없음)은 파일함 진입 즉시 '관리자 로그인이 필요합니다' 알림과 함께 admin.html로 튕김
- **위치**: `public/js/workspace-files.js:37`
- **설명**: 파일함 초기화가 사용자 세션 확인(/api/auth/me)을 먼저 호출하는데, 관리자 로그인은 관리자 쿠키만 발급하므로 사용자 토큰이 없는 브라우저에서는 이 호출이 401을 반환한다. 그런데 이 페이지의 공통 API 헬퍼는 401을 받으면 무조건 알림창을 띄우고 admin.html로 강제 이동시키기 때문에, 정작 준비해 둔 '관리자 세션으로 재시도(fallback)' 로직이 실행되기 전에 페이지에서 쫓겨난다. 사용자 사이트에 별도로 로그인해 둔 사람만 정상 진입되는 구조.
- **근거**: workspace-files.js:37-41 api()가 status 401이면 alert+location.href='/admin.html'+throw — initSidebar(1396행)의 try/catch보다 먼저 발동. auth-me.ts:27 토큰 없으면 401. admin-login.ts:126-145는 siren_admin_token 쿠키만 설정. H-G1 커밋(49a31e1c)의 admin/me fallback은 이 경로에선 도달 불가. workspace-kanban.js:80-83도 동일 패턴(alert만 없음).
- **권장조치**: api()에 '리다이렉트 없이 401을 돌려받는 모드' 옵션을 두고 initSidebar의 auth/me·admin/me 호출은 그 모드로 호출. 데이터 API 401일 때만 리다이렉트.

### #81 [버그] 삭제된 폴더 안에 있던 파일을 휴지통에서 복원하면 어디서도 보이지 않는 유령 파일이 됨
- **위치**: `netlify/functions/admin-workspace-files.ts:188`
- **설명**: 폴더째 휴지통에 간 뒤 파일만 복원하면 파일은 살아나지만 소속 폴더가 여전히 삭제 상태라 폴더 트리에 안 나타나고, 검색도 고장이라(별도 발견) 화면 어디서도 찾을 수 없다. '복원됨' 토스트가 뜨지만 운영자 눈에는 파일이 사라진 것. 이후 30일 크론이 폴더만 영구삭제하면 파일은 존재하지 않는 폴더 번호를 가리킨 채(FK 없음) 영구히 미아로 남는다.
- **근거**: restore 분기(188-201행)는 deletedAt만 해제, folderId 유지·소속 폴더 삭제 여부 미검사. 트리는 deletedAt IS NULL만 표시(admin-workspace-folders.ts:145·176). schema.ts:1860 folderId integer — FK 없음. cron 76-83행은 폴더 행만 개별 삭제.
- **권장조치**: 복원 시 소속 폴더가 삭제 상태면 folderId를 null(홈)로 옮기거나 폴더 동시 복원 안내.

### #82 [보안] 폴더 공유의 만료일이 전혀 강제되지 않음 — 만료된 공유로 계속 열람·업로드 가능
- **위치**: `netlify/functions/admin-workspace-folders.ts:151`
- **설명**: 파일 단위 공유는 만료일이 지나면 목록·단건조회·다운로드 모두 차단하도록 고쳐졌는데(Q3-007·OP-036), 폴더 공유는 만료일 검사가 어느 경로에도 없다. 만료된 폴더 공유를 가진 직원이 폴더 트리에서 폴더를 계속 보고, 편집 공유였다면 만료 후에도 그 폴더에 파일을 계속 업로드하거나 파일을 이동시킬 수 있다. 파일과 폴더의 보안 정책이 어긋나는 상태.
- **근거**: 폴더 tree 공유 매칭(admin-workspace-folders.ts:151-162)·checkFolderAccess(45-55행)·presign checkFolderWriteAccess(admin-workspace-file-presign.ts:29-40)·파일이동 checkFolderWriteAccess(admin-workspace-files.ts:39-51) 4곳 모두 expiresAt 조건 없음. 파일 쪽은 admin-workspace-files.ts:89·142, file-download.ts:50에서 강제.
- **권장조치**: 4곳 공유 쿼리에 or(isNull(expiresAt), expiresAt > NOW()) 조건 추가(파일 쪽과 동일 패턴).


## P2 · 마일스톤·성과 (5)

### #103 [누락기능] 직원이 수동 분류로 목표를 채워 성과가 자동 제출돼도 슈퍼어드민에게 검증 요청 알림이 가지 않음
- **위치**: `netlify/functions/workspace-milestone-task-match.ts:116`
- **설명**: 비매출 성과가 만들어지는 세 경로 중 두 경로(직원이 직접 제출, AI 자동 매칭으로 목표 달성)는 슈퍼어드민에게 '검증해 달라'는 알림을 보내는데, 세 번째 경로인 '직원이 보류 큐에서 수동으로 카드를 마일스톤에 연결해 목표 건수를 채운 경우'만 알림 없이 조용히 검증 대기(PENDING) 상태로 쌓인다. 슈퍼어드민이 성과관리 화면을 스스로 열어보기 전까지는 이 성과가 제출된 사실을 모르고, 검증이 늦어지면 분기 결산에서 해당 보너스가 빠질 수 있다. AI 경로에 알림을 붙일 때(R35-GAP-P1-B-H3) 같은 계열인 수동 확정 경로가 누락된 형태.
- **근거**: workspace-milestone-task-match.ts:105-125 — 목표 달성 시 non_revenue_achievements INSERT만 하고 알림 없음(파일에 notify import 자체가 없음). 대조: 직접 제출 milestone-nonrevenue.ts:104-109 notifyAllSuperAdmins, AI 자동 ai-task-milestone-match-background.ts:212-224 notifyAllSuperAdmins('검증 필요')
- **권장조치**: task-match의 자동 제출 성공 직후 ai-task-milestone-match-background.ts:219-224와 동일한 notifyAllSuperAdmins 호출 추가(fire-and-forget)

### #104 [데이터정합] 분기 마지막 날 완료한 카드가 성과 집계에서 빠짐 — 완료시각(UTC)과 분기 종료일(날짜)의 경계 비교 오류
- **위치**: `netlify/functions/workspace-milestone-progress.ts:77`
- **설명**: 카드 완료 시각은 UTC 타임스탬프로 저장되는데 분기 시작/종료는 날짜(예: 6월 30일)로 저장되어, '완료시각 <= 종료일' 비교가 사실상 '종료일 자정(UTC 00:00) 이전'으로 계산된다. 그 결과 분기 마지막 날에 완료한 카드는 거의 전부(그날 오전 9시 KST 이후 완료분 전부) 그 분기 실적에서 빠진다. 직원이 마감일에 맞춰 카드를 끝냈는데 진행률 게이지에 안 올라가고, 목표 건수를 채웠는데도 비매출 성과 자동 제출이 일어나지 않으며, 보관함(성과별 완료 카드)에서도 마지막 날 완료 카드가 보이지 않는다. 시작 경계도 9시간 밀려 분기 첫날 새벽(0~9시 KST) 완료분이 빠진다. 인센티브 금액 산정의 기초 카운트라 직원 보수에 직접 영향.
- **근거**: workspace_tasks.completedAt은 timestamp(UTC, schema.ts:1608, admin-workspace-tasks.ts:641 new Date()), quarters.start_date/end_date는 date(schema.ts:3470-3471). 'completed_at <= ${quarter.end_date}'는 end_date 00:00:00으로 캐스팅되어 종료일 당일 00:00 UTC(=KST 09:00) 이후 완료분 제외. 동일 패턴 4곳: workspace-milestone-progress.ts:76-77(진행률), workspace-milestone-task-match.ts:99-100(수동 확정 시 달성 판정), ai-task-milestone-match-background.ts:181-182(AI 자동 달성 판정 — P1-15 fix가 '이 분기 내' 필터를 넣으며 경계 처리 누락), workspace-milestone-done-tasks.ts:55-56(보관함)
- **권장조치**: 종료 경계를 'completed_at < (end_date + 1일)' 또는 KST 기준 보정으로, 시작 경계도 KST 보정하여 4곳 일괄 수정

### #105 [데이터정합] 비매출 성과 선택 화면에 카테고리 정보가 안 내려와 '카테고리당 2개' 규칙이 화면에서 작동하지 않고 저장 시에만 거절됨
- **위치**: `netlify/functions/milestone-dashboard.ts:150`
- **설명**: 비매출 보너스는 '분기 7개, 카테고리당 2개'까지 선택하는 규칙이고 화면에는 카테고리별 그룹핑·2개 초과 차단 UI까지 구현되어 있다. 그런데 이 탭이 데이터를 받아오는 대시보드 API 응답에 각 성과의 카테고리 값이 빠져 있어, 모든 성과가 '미분류' 하나로 묶이면서 카테고리 UI 전체가 무력화된다(그룹 1개면 그룹핑 자체를 끔). 결과: 사용자는 같은 카테고리 성과 3개를 자유롭게 골라 저장을 누르고, 서버가 그때서야 실제 카테고리로 검사해 '한 카테고리에서 최대 2개까지만…'이라며 거절한다. 화면에는 카테고리가 안 보이므로 사용자는 어떤 조합이 문제인지 알 수 없다.
- **근거**: milestone-dashboard.ts:143-160 — 쿼리가 md.non_revenue_category를 SELECT하지 않고 매핑에도 nonRevenueCategory 없음. 프론트 workspace-milestones.js:853 `a.nonRevenueCategory ?? a.non_revenue_category ?? a.nrCategory ?? null` 전부 undefined → key 0(미분류) → :860 useGroups=false. 서버측 최종 검증은 실제 카테고리 사용: milestone-nonrevenue.ts:141-151. 참고로 비사용 API인 milestone-nonrevenue GET(formatAch:208)에는 카테고리가 있음 — 대시보드만 누락
- **권장조치**: 대시보드 쿼리에 md.non_revenue_category 추가 + 매핑에 nonRevenueCategory 포함(formatAch와 동일 키)

### #106 [버그] 로드맵·템플릿 페이지: 운영자 직원이 열면 로그인 만료 취급되어 관리자 로그인 화면으로 강제 이동
- **위치**: `netlify/functions/admin-roadmap.ts:36`
- **설명**: 워크스페이스 사이드바의 '로드맵'과 '템플릿' 메뉴는 모든 직원에게 보이고, 두 페이지 모두 초기에 '운영자(직원)만 사용 가능' 검사를 통과시켜 운영자 직원을 들여보낸다(로드맵 코드 머리말에도 '오퍼레이터 열람'이라고 명시). 그런데 두 페이지의 데이터 API가 모두 관리자 전용이어서, 운영자 직원이 메뉴를 누르는 순간 401을 받고 프론트가 이를 '인증 만료'로 해석해 관리자 로그인 페이지(admin.html)로 강제 이동시킨다. 운영자 직원은 관리자 로그인이 불가능하므로 워크스페이스에서 사실상 쫓겨나는 경험을 하게 된다.
- **근거**: admin-roadmap.ts:12 '열람은 관리자 전원(오퍼레이터 포함)' 주석 + :36 requireAdmin. workspace-roadmap.js:54 'if (res.status === 401) { location.href = /admin.html }' + :87-91 운영자 입장 허용. 템플릿 동일: admin-workspace-task-templates.ts:60 requireAdmin, workspace-templates.js:51(401 리다이렉트)·:237-241(운영자 입장 허용, 'R35-GAP-P1 H-G1: user JWT 우선' 주석), 모달 문구 '다른 운영자도 사용 가능'(workspace-templates.html:137). 사이드바 노출: workspace-templates.html:56-57
- **권장조치**: 두 API의 GET(읽기)을 requireOperator로 완화하고 편집은 기존 canEdit(role 검사) 유지, 또는 최소한 프론트 401 처리를 리다이렉트 대신 '권한 없음' 안내로 변경

### #107 [버그] WBS 카드 생성 섹션이 항상 '목표: 1건'으로 표시 — 응답 키 불일치로 실제 목표치가 화면에 안 나오는데 버튼을 누르면 목표치만큼 대량 생성됨
- **위치**: `public/js/workspace-milestones.js:1066`
- **설명**: 내 현황의 '마일스톤 → WBS 카드 생성' 목록은 각 마일스톤의 목표(예: 5건)를 보여줘야 하는데, 화면 코드가 서버에 없는 키(targetValue/targetUnit)를 읽어서 목표치와 무관하게 항상 '목표: 1건'으로 표시된다. 서버는 thresholdValue/thresholdUnit이라는 키로 보낸다. 문제는 '+ WBS 카드 생성' 버튼을 누르면 실제로는 목표치(threshold_value, 최대 10)만큼 카드가 한꺼번에 만들어진다는 것 — 화면은 1건이라고 안내했는데 카드가 5개 생겨 직원이 당황하게 된다.
- **근거**: workspace-milestones.js:1066 `목표: ${d.targetValue || 1}${d.targetUnit || '건'}` — 데이터 소스 /api/milestone-definitions의 formatDef(milestone-definitions.ts:233-246)는 thresholdValue/thresholdUnit만 반환(targetValue/targetUnit 없음). 생성 API는 count 미지정 시 threshold_value개 생성(workspace-milestone-create-tasks.ts:70 `Math.min(Number(body?.count || def.threshold_value || 1), 10)`)
- **권장조치**: 프론트를 d.thresholdValue/d.thresholdUnit로 수정하고, 생성 확인창에 '카드 N개가 생성됩니다' 문구 추가


## P2 · 근태(직원) (6)

### #61 [누락기능] 자정을 넘겨 일하면 퇴근 처리 자체가 불가능 — 전날 세션이 영구 미퇴근으로 남고 그날 근무시간이 통계에서 소실
- **위치**: `netlify/functions/att-checkout.ts:44`
- **설명**: 밤 11시에 출근했거나 퇴근을 안 찍고 야근한 직원이 자정을 넘겨 새벽에 퇴근 버튼을 누르면 '출근 기록 없음 — 출근 먼저 처리해 주세요'라며 거부된다(퇴근 처리가 '오늘' 날짜의 기록만 찾음). 전날 세션은 미퇴근 상태로 영구히 남아 근무시간이 계산되지 않고(월 근무시간 합계에서 그날 통째로 누락), 본인 셀프수정도 당일만 가능해 결국 정정요청 결재를 거쳐야만 복구된다. 미퇴근을 관리자에게 통보해야 할 자정 cron마저 무동작(별도 발견)이라 아무도 인지하지 못한다.
- **근거**: 퇴근 조회가 `and(eq(attRecords.memberUid,...), eq(attRecords.date, today))`(45-46행)로 당일 행만 대상 → 50-52행에서 400 반환. 전일 미종료 세션을 닫는 경로 없음 — att-session-edit.ts도 today 한정(57-61행), 다중 세션 헬퍼(lib/att-session.ts)에 날짜 이월 처리 없음.
- **권장조치**: 당일 기록이 없으면 전일 기록의 미종료 세션을 조회해 그 세션의 퇴근으로 마감(자정 경계 안내 포함)하거나, 최소한 '전날 미퇴근 기록이 있습니다 — 정정요청 안내' 메시지로 분기.

### #62 [데이터정합] 한 달 내내 출근 기록이 없어도 '만근'으로 판정돼 보너스 연차 자동 지급 — 결근이 자동 기록되지 않는 구조
- **위치**: `netlify/functions/cron-att-leave-auto.ts:129`
- **설명**: 만근 판정 기준이 '결근·무단지각·무단조퇴 기록 0건'인데, 미출근한 날은 시스템 어디서도 '결근' 기록을 만들지 않는다(그날은 행 자체가 없음 — 미퇴근/미출근 자동처리는 정책상 폐지됨). 그래서 지난달 하루도 출근하지 않은 직원도 위반 0건 → 만근으로 집계돼 매월 1일 보너스 연차 +1일과 축하 알림을 받는다. 관리자가 결근일마다 수동으로 '결근' 상태를 입력해야만 막을 수 있어 사실상 만근 보너스가 전원 지급으로 동작할 위험.
- **근거**: 위반 집계는 att_records 존재 행 기준 FILTER(114-123행)이고 최소 출근일수 조건 없음(129행 absent=0&&late=0&&early=0이면 지급). 'ABSENT' 상태를 기록하는 코드는 netlify/functions 전체 grep 결과 없음 — admin-att-records(집계)·att-leave-request(필터)·cron-att-leave-auto(집계) 등 읽기만 존재, admin-att-record-edit의 수동 입력만 가능(243행 기본값 NORMAL).
- **권장조치**: 만근 조건에 '해당 월 실제 출근일수 ≥ 해당 월 영업일수(주말·공휴일 제외)' 조건을 추가하거나, 스케줄 대비 출근율 기준으로 판정.

### #63 [버그] 주말 아침마다 전 직원에게 '출근 체크 미완료' 알림 오발송 (공휴일만 스킵, 토·일 미스킵)
- **위치**: `netlify/functions/cron-att-morning.ts:43`
- **설명**: 아침 9시 30분 미출근 알림 cron이 토·일요일에도 그대로 돌아, 근무 스케줄(기간형)이 걸려 있는 모든 직원에게 주말 아침마다 '출근 체크가 완료되지 않았습니다' 알림이 가고, 관리자에게도 '미출근 N명' 요약 알림이 온다. 반복 오발송은 알림 피로를 만들어 정작 평일의 진짜 미출근 알림을 무시하게 만든다.
- **근거**: schedule "30 0 * * *"(17행) = 매일 실행. 스킵 조건은 att_holidays 조회(31-39행)뿐 — 공휴일 테이블에 주말은 없음(att-leave-request.ts 110-115행이 주말을 별도 dow 체크하는 것으로 방증). 대상 추출 SQL(43-55행)은 att_schedules 기간 매칭이라 주말 포함, HYBRID 요일규칙의 주말→HOLIDAY 처리(lib/att-utils.ts 121-129행)는 이 raw SQL에 반영 안 됨.
- **권장조치**: KST 요일이 토/일이면 조기 종료 추가(+ HYBRID 스케줄 직원은 당일 요일 규칙이 HOLIDAY면 제외).

### #64 [버그] 유연근무제 상태에서 본인 시각 셀프수정만 하면 유연 허용범위가 무시돼 '정상'이 '지각'으로 뒤바뀜
- **위치**: `netlify/functions/att-session-edit.ts:95`
- **설명**: 유연출퇴근제(예: 출근 ±2시간 자율)가 켜진 상태에서 허용범위 안(예: 10시)에 정상 출근한 직원이, 당일 화면에서 출퇴근 시각을 직접 수정(예: 퇴근 시각만 1분 고침)하면 시스템이 유연근무 설정을 빼고 고정 지각 기준(예: 09:10)으로 다시 판정해 '정상'이 '지각'으로 바뀐다. 출근·퇴근·정정 승인 API는 모두 유연 설정을 전달하는데 셀프 수정 한 곳만 빠져 있다. 잘못 찍힌 지각은 만근 보너스 박탈·지각 누적 경고로 이어진다. (2026-07-09~10 유연 하한 회귀 fix 시 근무분 계산에는 하한을 반영했지만 상태 판정 파라미터는 누락된 잔재)
- **근거**: att-session-edit.ts determineStatus 호출(95-100행)에 flexEnabled·flexRangeMins 없음 → lib/att-utils.ts 226행 flexOn=false → 228행 lateThreshold=고정 lateGraceMins. 비교: att-checkin.ts 265-272행·att-checkout.ts 137-145행·admin-att-correction-review.ts 149-150행은 모두 전달.
- **권장조치**: 셀프 수정 determineStatus에도 flexEnabled와 getFlexRangeMins() 결과를 전달(퇴근 API와 동일 패턴).

### #65 [보안] AI 근무 흐름분석이 아무 관리자형 계정이나 임의 직원을 지정해 동료의 재택보고서 내용을 분석·열람 가능 (명세는 이사장 전용)
- **위치**: `netlify/functions/att-ai-insight.ts:33`
- **설명**: AI 흐름파악 API는 요청 본문에 직원 번호(memberUid)를 넣으면 그 직원의 재택근무 보고서 원문(최대 30건)·근태 기록·작업 현황을 수집해 AI 분석 결과를 돌려준다. 명세(phase27)는 이 기능을 이사장(super_admin) 전용으로 정의했지만 코드에는 역할 확인이 전혀 없어, 직원 역할(role=operator)의 관리자형 계정도 동료의 보고서 기반 분석을 볼 수 있다. 재택보고서 열람 API(admin-att-remote-reports)는 att_manage 권한을 검사하는데 이 API는 그 게이트를 우회한다. ※ PROJECT_STATE에 OP-020으로 이미 추적 중(R45 follow-up·운영 안정화 후 예정)이나 미수정 상태로 재확인됨.
- **근거**: att-ai-insight.ts:23-24 requireAdmin만 통과(role/canAccess 검사 없음), :33 `const memberUid = body.memberUid ?? auth.ctx.member.id`로 임의 직원 지정, :44-57 해당 직원 attRemoteWorkReports content 수집. 명세: docs/specs/2026-05-19-phase27-att-step9-17.md:59 "super_admin (R35-GAP-P2 P-G1)". 대조: admin-att-remote-reports.ts:49 canAccess(role,'att_manage') 게이트 존재. PROJECT_STATE.md:38에 OP-020으로 기지 추적.
- **권장조치**: 명세대로 `role !== 'super_admin' → 403` 추가, 또는 최소 att_manage canAccess 게이트로 정렬. 프론트 호출처가 없어 당장 화면 회귀 위험 없음.

### #66 [에러처리] 휴가 신청 '철회' 실패해도 무조건 '철회되었습니다' 거짓 성공 안내
- **위치**: `public/js/workspace-attendance.js:767`
- **설명**: 직원이 휴가 신청 내역에서 '철회' 버튼을 누르면 서버가 거부해도(이미 승인/반려된 건, 네트워크 오류 등) 항상 '신청이 철회되었습니다' 토스트가 뜬다. 목록을 새로고침해도 그대로 남아 있어 직원은 시스템 오류로 오인하거나, 철회된 줄 알고 휴가 당일 출근하지 않는 실무 사고로 이어질 수 있다.
- **근거**: api() 헬퍼는 실패 시 throw하지 않고 {ok:false}를 반환(8-21행)하는데, 철회 핸들러는 `await api('/api/att-leave-request?id='+id,{method:'DELETE'}); toast('신청이 철회되었습니다')`로 결과 미확인(766-768행) — catch는 네트워크 예외조차 잡을 일 없음. 서버는 PENDING 아닌 건에 409를 반환(att-leave-request.ts 305행).
- **권장조치**: `const res = await api(...); if (!res.ok) { toast('철회 실패: '+(res.data?.error||'')); return; }` 패턴으로 교체(같은 파일 다른 호출들과 동일).


## P2 · 근태(관리자)·급여 (15)

### #46 [누락기능] 급여 문의/이의제기 API(OP-028)가 죽은 엔드포인트 — 화면 어디에도 문의 버튼·폼이 없음
- **위치**: `netlify/functions/payroll-my-inquiry.ts:18`
- **설명**: 직원이 자기 급여 명세의 오류를 발견했을 때 시스템 안에서 이의제기할 수 있도록 만든 문의 접수 API가 백엔드만 존재하고, 이를 호출하는 화면(버튼·폼)이 프론트 전체에 하나도 없다. 직원측 급여 화면(workspace-payroll.js)에도 문의·이의 관련 UI가 전혀 없어, 이 API가 해결하려던 문제('명세 오류를 발견해도 시스템 밖 외부 연락으로 가야 한다')가 그대로 남아 있다. API 자체는 호출만 되면 슈퍼어드민 전원에게 알림이 가도록 정상 구현돼 있어, 화면 진입점만 만들다 만 상태다.
- **근거**: 저장소 전체 grep 'payroll-my-inquiry' → netlify/functions/payroll-my-inquiry.ts 자신(2·18행)만 매치, public/·lib/ AI 도구 호출처 0건. public/js/workspace-payroll.js에서 '문의|이의|inquiry' grep 0건. API 본문(payroll-my-inquiry.ts:24-47)은 requireOperator + notifyAllSuperAdmins로 정상 동작 가능한 완성 코드.
- **권장조치**: 워크스페이스 급여(내 명세서) 화면에 명세서별 '문의/이의제기' 버튼 + 텍스트 입력 모달을 추가해 POST /api/payroll-my-inquiry를 호출하게 연결. 접수 후 처리 결과 회신 경로(검토메모 노출 등)도 함께 설계 권장.

### #47 [누락기능] 발송(SENT)된 명세서를 수정해도 정정본을 다시 보낼 방법이 없음 — 직원이 받은 PDF와 시스템 금액 불일치 방치
- **위치**: `netlify/functions/admin-payroll-send.ts:103`
- **설명**: 명세서를 직원에게 이메일 발송한 뒤 오류를 발견해 금액을 고치는 시나리오: 발송 상태 명세서는 상세 모달에서 자유롭게 편집·저장이 되지만, 일괄 발송은 '승인(APPROVED)' 상태만 대상으로 하고 발송 상태를 승인으로 되돌리는 버튼도 없어서 정정된 명세서를 시스템으로 재발송할 수 없다. 결과적으로 직원이 이메일로 받은 PDF 금액과 시스템에 기록된 최종 금액이 다른 채로 지급 확정까지 진행될 수 있고, 관리자는 PDF를 수동 다운로드해서 개인적으로 보내는 수밖에 없다. 발송 API는 특정 명세서만 골라 보내는 매개변수(slipIds)를 이미 지원하는데 화면에서는 쓰이지 않는다.
- **근거**: 발송 후보 조건 eq(payrollSlips.status, "APPROVED")(admin-payroll-send.ts:100-107) — SENT 재발송 불가. 편집 가능 조건은 status !== 'PAID'(admin-payroll.js:357)라 SENT 편집 허용. 모달·목록 버튼(admin-payroll.js:480-491·149-157)에 SENT→APPROVED 복귀 액션 없음. body.slipIds 개별 발송 지원(admin-payroll-send.ts:105-106)은 프론트 미사용.
- **권장조치**: 상세 모달에 '이 명세서 재발송' 버튼 추가(slipIds 단건 호출 + SENT도 재발송 허용 또는 수정 시 자동으로 APPROVED 복귀). 최소한 SENT 상태 편집 저장 시 '재발송 필요' 경고 표시.

### #48 [데이터정합] 휴가 '승인 취소' 후 이미 출근 도장이 있던 날은 계속 '휴가' 상태로 남음
- **위치**: `netlify/functions/admin-att-leave-review.ts:243`
- **설명**: 직원이 출근 찍은 뒤 그 날짜 휴가가 승인되면 시각은 보존하고 상태만 '휴가'로 바꾸는데, 관리자가 그 승인을 취소하면 빈(출근 없는) 휴가 행만 삭제하고 출근 기록이 있는 행은 상태를 원복하지 않는다. 실제로 근무한 날이 계속 휴가로 집계돼 급여 출근일수에서 빠지고(과소 지급) 통계도 틀어진다. 관리자가 기록 직접수정으로 일일이 되돌려야 한다.
- **근거**: 승인: admin-att-leave-review.ts:187-204 ON CONFLICT DO UPDATE SET status='LEAVE'(시각 보존·H-G2). 취소: :241-254 DELETE는 check_in_time IS NULL 행만 — 출근 있던 행의 status='LEAVE' 원복 없음. 급여: payroll-calc.ts:149 LEAVE는 출근일 제외.
- **권장조치**: 취소 시 check_in_time 있는 LEAVE 행은 determineStatus로 상태 재산정(NORMAL/LATE)해 원복.

### #49 [데이터정합] 근무 스케줄 저장에 기간 겹침 검사 없음 — 겹침 감지 로직은 화면이 안 쓰는 죽은 API에만 존재
- **위치**: `netlify/functions/admin-att-schedules.ts:47`
- **설명**: 화면의 '스케줄 저장'이 쓰는 API는 같은 직원의 기간이 겹치는 스케줄을 검사 없이 그대로 쌓는다. 겹치면 시작일이 늦은 줄이 조용히 우선 적용되는데 목록에는 두 줄이 모순되게 공존해 관리자가 어떤 게 유효한지 알 수 없다. 정작 '겹치면 기존을 종료하고 대체할까요?' 확인 흐름은 프론트 어디서도 호출하지 않는 별도 API에 완성돼 방치 중이고, 단발성 근무형태 재정의(승인으로 자동 생성)도 조회·취소할 관리자 화면이 없다(관련 API 2개가 프론트 미연결 고아).
- **근거**: 실사용 저장: admin-workspace-management.js:408-410 → admin-att-schedules.ts:47-71(POST 겹침 검사 없음)·74-107(PUT 동일). 겹침 확인 로직: admin-att-work-mode.ts:96-130(needsReplaceConfirm) — public/ 전체 grep에서 '/api/admin/att/work-mode'·'admin-att-schedule-override' 호출 0건. 겹침 시 우선순위: lib/att-utils.ts:96-107 desc(startDate) limit 1.
- **권장조치**: 겹침 검사·대체 확인 로직을 admin-att-schedules POST/PUT로 이식하고 죽은 API 2개는 삭제 또는 프론트 연결(재정의 목록·삭제 UI 포함).

### #50 [데이터정합] 지급완료(PAID) 명세서의 편집 잠금이 화면에만 있음 — 서버는 금액 수정·상태 회귀를 막지 않음
- **위치**: `netlify/functions/admin-payroll.ts:173`
- **설명**: 지급을 확정하면 화면에는 '지급 완료 — 편집 잠금'이 표시되고 입력칸이 비활성화되지만, 이것은 순전히 화면 처리일 뿐이다. 서버의 수정 API는 명세서의 현재 상태를 전혀 검사하지 않아, 브라우저 개발자도구나 직접 호출로 이미 지급이 끝난 급여의 금액을 바꾸거나(수정 이력에는 남음), 승인 API를 호출해 지급완료 상태를 승인 상태로 되돌릴 수 있다. 접근 주체가 슈퍼어드민뿐이라 악용 위험은 제한적이지만, 돈이 나간 뒤의 급여 기록 무결성이 서버 차원에서 보증되지 않는 구조다. 보류 API도 같은 문제(지급완료 건을 보류로 전환 가능)가 있다.
- **근거**: PATCH 핸들러(admin-payroll.ts:173-272)에 cur.status 검사 없음 — PAID 명세서도 MONEY_FIELDS·adjustments 수정 후 gross/net 재계산 저장. approve 액션(:279-292)·hold 액션(:296-308)도 현재 상태 무검증. 반면 paid 액션만 APPROVED/SENT 검사(:317-319). 프론트 잠금은 admin-payroll.js:357 editable = slip.status !== 'PAID' 뿐.
- **권장조치**: PATCH·approve·hold에 서버측 상태 가드 추가: PAID면 금액 편집 400 거절(정정은 별도 '지급 취소' 절차로), approve는 DRAFT/REVIEWED/HOLD에서만 허용.

### #51 [버그] 근태 현황 '휴가' 카드가 실제 휴가 인원의 2배로 표시
- **위치**: `netlify/functions/admin-att-records.ts:209`
- **설명**: 휴가 승인 시 해당 영업일에 상태 '휴가'인 출퇴근 기록이 도장으로 찍히는데, 일일 요약 집계가 이 도장(기록 상태 LEAVE 건수)과 그 날짜에 걸친 승인 휴가 신청 건수를 '둘 다' 더한다. 같은 사람의 같은 휴가가 두 번 세어져 1명 휴가 시 카드에 2로 표시된다(반차·주말만 1).
- **근거**: admin-att-records.ts:180-193 승인 휴가신청 겹침 건수(leaveCount) + :209 leaveCount: (statusCnt['LEAVE'] ?? 0) + leaveCount. 승인 시 LEAVE 행 스탬프: admin-att-leave-review.ts:189-204. 프론트 표시: admin-workspace-management.js:155.
- **권장조치**: 요약은 둘 중 하나만 사용(스탬프 행 기준 권장 — 반차는 별도), 또는 신청 건수에서 스탬프 있는 날을 제외.

### #52 [버그] 급여: 월 경계에 걸친 휴가가 시작 달에 전액 귀속 — 시작 달 과지급·다음 달 과소지급
- **위치**: `lib/payroll-calc.ts:175`
- **설명**: 급여 자동집계가 승인 휴가를 '시작일이 그 달인 것'만 집계하고 신청의 전체 일수를 통째로 더한다. 예로 6/29~7/3(영업일 5일) 유급휴가는 6월 급여에 5일 전부 붙고 7월 급여에는 0일 — 7월의 3일은 출근일도(LEAVE 도장이라 제외) 휴가일도 아니어서 일급제 기본급에서 누락된다. 월 단위 명세 금액이 양쪽 달 모두 부정확.
- **근거**: payroll-calc.ts:167-177 WHERE lr.start_date >= first AND lr.start_date <= last + SUM(lr.days) 전액. LEAVE 도장 일은 :149 working_days에서 제외. 승인 스탬프는 일자별(admin-att-leave-review.ts:189-204)이라 att_records 기준 집계로 대체 가능.
- **권장조치**: 휴가일 집계를 신청 단위가 아닌 일자 단위로: 해당 월 내 LEAVE 도장 행(유급 여부는 신청 조인) 또는 신청 기간과 월 범위의 교집합 영업일수로 계산.

### #53 [버그] 출퇴근 위치 지도에서 거점(사무실) 핀·반경이 절대 표시되지 않음 — 응답 키 불일치
- **위치**: `public/js/admin-workspace-management.js:1773`
- **설명**: 실시간 현황·월별 기록의 '📍 위치 보기'는 직원 좌표와 함께 거점(사무실/외근지) 위치를 지도에 같이 띄우도록 만들어졌지만, 거점 목록 응답을 잘못된 키로 읽어(캐시가 항상 빈 채) 거점 핀·거점명이 한 번도 표시되지 않는다. 관리자는 직원이 거점 반경 안에서 찍었는지 지도로 대조할 수 없다.
- **근거**: admin-workspace-management.js:1772-1774 resW.data?.data?.workplaces || resW.data?.workplaces — 실제 응답은 배열 그대로(admin-att-workplaces.ts:34-45 jsonOk(rows) → data:[...]). 같은 파일 :346-347 loadWorkplaceDropdown은 res.data?.data로 올바르게 읽음. 사용처 :1875-1881 place 항상 null → placeLat/placeName null로 지도 호출.
- **권장조치**: resW.data?.data || resW.data || [] 로 통일(드롭다운 로더와 동일 패턴).

### #54 [버그] 휴가 종류 '삭제'가 성공 토스트를 띄우지만 관리자 목록에 그대로 남아 있음
- **위치**: `netlify/functions/admin-att-leave-types.ts:230`
- **설명**: 사용 이력이 있는 휴가 종류는 삭제 시 비활성화(soft delete)로 처리되는데, 관리자 목록 조회가 비활성 항목을 걸러내지도 표시하지도 않는다. 관리자가 삭제 → '삭제되었습니다' 토스트 → 새로고침된 목록에 똑같이 보임 → 삭제가 안 된 것으로 오인하고 반복 시도하게 된다(직원 신청 화면에서만 사라짐). 비활성 상태를 되살릴 방법도 화면에 없다.
- **근거**: DELETE: admin-att-leave-types.ts:230-235 soft delete(is_active=false). GET: :55-70 is_active 필터 없이 전체 반환·isActive 필드 포함. 프론트: admin-workspace-management.js:792-813 렌더에 isActive 미사용·구분 배지 없음, :843 '삭제되었습니다' 토스트. 사용자측 att-leave-types.ts:35는 isActive=true 필터.
- **권장조치**: 관리자 목록에 비활성 배지 + '비활성 숨기기' 토글 표시, 삭제 응답의 softDeleted 여부에 따라 토스트 문구 분기('사용 이력이 있어 비활성화됨'), 재활성화 버튼 제공.

### #55 [버그] 국장(admin)에게 열어준 근태 메뉴가 서버에서는 이사장 전용이라 '잔여 휴가'·'근무 스케줄' 탭과 근태 설정 메뉴 전체가 403 빈 화면
- **위치**: `netlify/functions/admin-att-leave-balances.ts:24`
- **설명**: 권한 카탈로그는 '근태 현황(att_manage)'과 '근태 설정 메뉴(att_config, 저장은 이사장 전용)'를 국장에게 기본 허용으로 정의했고 사이드바 메뉴도 그 기준으로 노출된다. 그런데 서버는 잔여휴가·직원목록·근무스케줄·근무정책·공휴일·휴가종류·거점·연차정책·근무형태 API를 조회(GET)까지 전부 '슈퍼어드민 전용'으로 막는다. 결과: 국장이 근태 현황을 열면 '잔여 휴가' 탭과 '근무 스케줄' 탭이 전부 실패하고, 근태 설정 메뉴는 모든 탭이 403이다. 권한정책 화면의 att_config 토글을 켜도 실제로는 아무것도 열리지 않는 죽은 토글.
- **근거**: 서버: admin-att-leave-balances.ts:24, admin-att-members.ts:31, admin-att-schedules.ts:24, admin-att-work-mode.ts:24, admin-att-policy.ts:25, admin-att-holidays.ts:24, admin-att-leave-types.ts:42, admin-att-workplaces.ts:25, admin-att-leave-policy.ts:71, admin-att-schedule-override.ts:23 — 메서드 분기 이전에 `role !== "super_admin" → 403` (GET 포함). 화면: admin-workspace-management.html:73-86에서 balances·schedule 탭이 data-group="ops"(근태 현황) 소속이고 public/js/admin-workspace-management.js:1174(admin-att-leave-balances GET)·:432(admin-att-schedules GET) 호출. 메뉴 게이트: cms-tbfa.js:2536 'att-ops':'att_manage','att-config':'att_config' + permission-catalog.ts:81-82 adminDefault:true(카탈로그 라벨 "근태 설정 메뉴(저장은 이사장 전용)").
- **권장조치**: 설계 확정 필요: (A안) 조회(GET)는 att_manage/att_config 게이트로 열고 쓰기(POST/PUT/DELETE)만 super_admin 유지 — 카탈로그 라벨과 일치, (B안) 카탈로그 att_config·해당 탭들을 이사장 전용으로 내리고 메뉴·탭도 숨김. A안 추천(운영 위임 취지).

### #56 [버그] 강제 재집계가 '수동수정' 잠금 표식을 지우지 않음 — 이후 일반 재집계에서 해당 직원만 영구 제외되는 침묵 누락
- **위치**: `lib/payroll-calc.ts:335`
- **설명**: 관리자가 금액을 한 번이라도 수동 수정한 명세서에는 '수정' 표식이 붙어 자동 재집계가 덮어쓰지 않게 보호된다. 문제는 '강제 재집계'로 모든 값을 자동 계산으로 초기화해도 이 표식이 그대로 남는다는 것. 이후 근태 정정 등으로 일반 재집계를 돌리면 그 직원 명세서만 '보존됨'으로 건너뛰어 최신 근태가 반영되지 않는데, 화면에는 초안(DRAFT) 상태라 관리자는 당연히 갱신됐다고 믿게 된다. 또한 강제 재집계는 승인일·발송일·지급확정일 기록도 지우지 않아, 초안 상태인데 상세 화면에 '지급 확정일'이 표시되는 앞뒤가 안 맞는 기록이 남는다.
- **근거**: UPDATE payroll_slips(payroll-calc.ts:310-339)는 status='DRAFT'로 되돌리지만 manually_edited 리셋 없음, approved_at/approved_by/sent_at/paid_at/paid_by도 미정리. 잠금 판정 lockable = [...].includes(status) || existingRow.manually_edited === true(:283-284) — 표식이 남는 한 비강제 재집계 영구 skip. 상세 모달은 paidAt 있으면 '지급 확정일' 무조건 표시(admin-payroll.js:467), 목록 '수정' 배지도 계속(admin-payroll.js:145).
- **권장조치**: 강제 재집계 UPDATE에 manually_edited=false, approved_at/by·sent_at·paid_at/by=NULL 초기화를 포함해 '자동 계산 초안'으로 완전히 되돌릴 것.

### #57 [보안] 휴가·근태정정·근무형태 결재에서 신청자가 자기 신청을 스스로 승인 가능 (셀프 결재 차단 없음)
- **위치**: `netlify/functions/admin-att-leave-review.ts:136`
- **설명**: 근태 결재 권한(att_manage)을 가진 직원이나 국장이 자기 휴가 신청·출퇴근 정정 요청·근무형태 변경 요청을 직접 승인할 수 있다. 결재 API 3종 모두 '결재자 = 신청자' 차단이 없어, 예를 들어 결재 권한을 부여받은 직원이 연차를 신청하고 곧바로 자기가 승인하면 잔여 연차 차감·근태 기록 반영까지 전부 혼자 처리된다. 같은 코드베이스의 매출 성과 검증에는 '본인이 입력한 건은 본인이 검증 불가'라는 4-eye 원칙이 이미 구현돼 있어 근태 결재만 빠진 상태.
- **근거**: admin-att-leave-review.ts:104-145 POST 승인 처리에 request.memberUid와 auth.ctx.member.id 비교 없음(reviewedBy만 기록). admin-att-correction-review.ts:218·admin-att-workmode-change-review.ts:120도 동일하게 자기신청 차단 부재. 대조: admin-milestone-revenue.ts:70-71 "4-eye 원칙 — 본인이 입력한 매출은 본인 검증 불가 (super_admin 예외)" 구현 존재. att_manage는 권한정책 화면에서 operator에게도 토글 가능(lib/permission-catalog.ts:81).
- **권장조치**: 결재 3종 POST에서 `String(request.memberUid) === String(auth.ctx.member.id)`이면 403 반환(super_admin 예외 여부는 이사장 결정). 매출 검증과 동일한 4-eye 원칙 적용.

### #58 [에러처리] 근무형태 변경 '승인'이 실제 반영 실패해도 승인 완료·승인 알림 발송 (조용한 실패)
- **위치**: `netlify/functions/admin-att-workmode-change-review.ts:142`
- **설명**: 관리자가 재택/외근 변경 신청을 승인하면 신청 상태를 먼저 APPROVED로 바꾼 뒤 해당 날짜 근무형태 재정의를 저장하는데, 이 저장이 실패해도 경고 로그만 남기고 성공 응답과 '승인되었습니다' 알림이 직원에게 나간다. 직원은 승인된 줄 알고 재택 근무했는데 그 날 근무형태는 바뀌지 않은 상태가 될 수 있다. 같은 유형의 문제를 정정요청 승인에서는 '반영 실패 시 결재 중단'으로 이미 고쳐놓고(cc1a2f8b) 이 API에는 미적용.
- **근거**: admin-att-workmode-change-review.ts:116-125 상태 먼저 APPROVED → :128-145 override UPSERT를 try/catch(console.warn)로 삼킴 → :147-165 알림 발송. 대조: admin-att-correction-review.ts:112-211은 반영 성공 후에만 결재 상태 변경(:207-210 실패 시 결재 중단).
- **권장조치**: 정정승인과 동일 순서로: override UPSERT 성공 후에 신청 상태 변경·알림. 실패 시 5xx로 중단해 관리자에게 노출.

### #59 [에러처리] 휴가 승인 시 잔여 연차 차감 실패가 무시됨 — 승인·알림은 진행되고 잔여만 안 깎임
- **위치**: `netlify/functions/admin-att-leave-review.ts:158`
- **설명**: 휴가 승인 시 잔여 휴가에서 사용일수를 더하는 UPDATE가 실패하거나 해당 연도·종류의 잔여 행이 없으면(0행 UPDATE) 경고 로그만 남기고 승인·휴가 도장·승인 알림이 전부 정상 진행된다. 이후 직원 잔여일수가 실제보다 많게 남아 다음 신청 검증까지 왜곡된다(신청 시 잔여 검증은 있으나 연도 경계·행 삭제 등에서 어긋날 수 있음).
- **근거**: admin-att-leave-review.ts:148-160 UPDATE att_leave_balances ... catch{console.warn} — UPSERT 아님·영향행 0건 검사 없음. 신청측 잔여 검증은 att-leave-request.ts:124-166.
- **권장조치**: 차감을 UPSERT(ON CONFLICT)로 바꾸고 영향 행 수 확인, 실패 시 승인 중단 또는 관리자 응답에 경고 필드 포함.

### #60 [운영자립] 계산기준의 '월 소정 근무일' 설정이 실제 급여 계산에 사실상 쓰이지 않는데, 설정 화면은 '일급 산정 분모'라고 안내
- **위치**: `lib/payroll-calc.ts:214`
- **설명**: 급여 계산기준 설정 화면의 '월 소정 근무일' 항목은 도움말에 '일급 = 연봉÷12÷이 값 (예: 22)'이라고 적혀 있어, 운영자는 이 값을 바꾸면 일급이 바뀐다고 믿게 된다. 그러나 실제 계산은 그 달의 주중 일수(월~금 자동 계산, 21~23일)를 분모로 쓰고, 설정값은 주중 일수가 0인 비정상 상황(현실에 없음)의 예비값으로만 존재한다. 운영자가 22를 20으로 바꿔 저장하고 '저장 완료 — 다음 재집계부터 적용됩니다' 토스트까지 봐도 급여는 1원도 달라지지 않는다. 돈 계산 기준을 다루는 설정이 무의미하게 노출돼 정책 결정을 오도한다.
- **근거**: dailyWage = (baseSalary / 12) / (monthBusinessDays || settings.monthlyWorkDays)(payroll-calc.ts:214) — monthBusinessDays는 businessDaysInMonth()(:92-100)로 항상 20 이상이라 설정값 도달 불가. 설정 UI 힌트 '일급 산정 분모 — 일급 = 연봉÷12÷이 값 (예: 22)'(admin-payroll.html:222), 저장 성공 토스트(admin-payroll.js:605).
- **권장조치**: 정책 확정 필요: (A) 설정값을 실제 분모로 쓰도록 계산 변경, 또는 (B) 설정 항목을 숨기고 힌트를 '그달 주중 일수 자동 산정(예비값)'으로 정정. 현행 유지라면 최소 도움말 문구만이라도 사실과 일치시킬 것.


---

# P3 (65건)

## P3 · AI 비서 (4)

### #108 [개선] 칸반 화면 위에서 AI로 작업을 만들어도 보드에 실시간 반영되지 않음 — 수동 새로고침 필요
- **위치**: `public/js/ai-agent-widget.js:787`
- **설명**: 운영자가 칸반 페이지를 열어둔 채 우하단 AI 위젯으로 작업을 생성·완료·삭제하면 채팅에는 '완료'라고 뜨지만 바로 옆 보드에는 아무 변화가 없다. 칸반 화면에 폴링·탭 복귀 갱신·브라우저 이벤트 수신이 전혀 없고, 위젯도 도구 성공 후 화면 갱신 신호를 쏘지 않아서다. 운영자가 '실행이 안 됐나?' 오해하고 같은 명령을 반복해 중복 카드를 만들 수 있다.
- **근거**: workspace-kanban.js에 setInterval·visibilitychange·focus·BroadcastChannel·storage 이벤트 grep 0건. 위젯 sendApprovedTool(757-787)·sendMsg(668-754)는 도구 성공 후 이벤트 발행/reload 없음.
- **권장조치**: 위젯이 변경 도구 성공 시 `window.dispatchEvent(new CustomEvent('siren:workspace-changed'))` 류 신호를 쏘고 칸반이 수신해 해당 목록만 재조회.

### #109 [개선] AI 작업 생성은 마감일 없는 카드를 못 만들고(무조건 +7일), AI 생성 표식·제목 길이 절단도 빠짐
- **위치**: `lib/ai-agent-tools.ts:1574`
- **설명**: 본 화면은 최근 개편(2026-07-09)으로 마감일 없이 개인 기록용 카드를 만들 수 있는데, AI 비서로 만들면 마감일을 말하지 않아도 자동으로 7일 뒤가 박힌다 — '마감 없는 메모성 카드 만들어줘'가 불가능하고 마감 임박 알림 대상에도 잡히게 된다. 또 'AI가 만든 카드' 식별 컬럼(created_by_agent)을 채우지 않아 통계에서 AI 생성분 구분이 어렵고, 제목을 300자로 자르지 않아 AI가 긴 제목을 만들면 DB 오류로 실패한다.
- **근거**: tool_taskCreate:1574 `dueDate = dueDateStr ? new Date(dueDateStr) : new Date(Date.now()+7*86400000)`. 본 API(admin-workspace-tasks.ts:516-521)는 dueDate null 허용(커밋 077df183). INSERT(1584-1590)에 created_by_agent 없음(본 API 561은 명시, schema.ts:1633 존재). title(1566) slice 없음 — schema.ts:1596 varchar(300).
- **권장조치**: dueDate 미지정 시 null 저장(모델 지시는 시스템 프롬프트로), created_by_agent='ai_agent' 기록, title 300자 절단.

### #110 [개선] AI 메모 생성·수정·삭제가 개인 활동 히스토리와 감사 로그에 안 남음 (본 화면은 기록)
- **위치**: `lib/ai-agent-tools.ts:2399`
- **설명**: 본 화면에서 메모를 만들거나 지우면 개인 활동 기록(memo.create/update/delete)과 감사 로그가 남는데, AI 비서로 같은 일을 하면 어느 쪽에도 안 남는다. 메모는 비공개 영역이라 팀 영향은 없지만, '내 활동' 타임라인에 구멍이 생기고 감사 추적 관점에서 AI 경유 변경만 이력이 비게 된다(AI 도구 자체 이력에는 남음 — 단 단답 승인 경로는 그마저 누락, 별도 발견 참조).
- **근거**: tool_memoCreate(2382-2412)·memoUpdate(2414-2450)·memoDelete(2452-2478) 모두 DB 쿼리만. 본 API admin-workspace-memos.ts는 logWorkspaceActivity 4곳(185·224·290·331 — memo.create/pin/update/delete, visibility private)+logAudit 수행. 소유권 검증(2435·2466 본인 메모만)은 AI 쪽도 정상.
- **권장조치**: 메모 3종 도구에 logWorkspaceActivity(visibility private) 추가 — 이벤트·작업 도구와 함께 일괄 적용 권장.

### #111 [개선] AI 도구가 저장하는 복구 데이터(rollbackData)는 쓰기만 하고 되돌리기 기능이 없는 죽은 약속
- **위치**: `netlify/functions/admin-ai-agent.ts:905`
- **설명**: 변경 도구마다 실행 전 상태를 rollbackData로 만들어 이력에 저장하지만, 이를 읽어 실제로 되돌리는 API·버튼이 어디에도 없다. 삭제 미리보기가 '영구 삭제됩니다'라고 경고하면서 내부적으로 복구 데이터를 남기는 구조라, 운영자가 '롤백해줘'라고 하면(HIGH 의도 키워드에 '롤백' 존재) AI가 수행할 수단이 없어 혼선이 생긴다. 저장 비용만 들고 기능은 없는 상태다.
- **근거**: ai_agent_logs.rollback_data INSERT(admin-ai-agent.ts:905)뿐 — netlify/functions 전체에서 rollback 참조는 이 파일+migrate-r44-reindex.ts뿐(실행 API 부재), public/js grep도 칸반 hold 롤백 함수만. HIGH_INTENT_KEYWORDS(101)에 '롤백' 포함되어 사용자 기대 유발.
- **권장조치**: rollbackData 기반 복원 도구(또는 이력 화면 되돌리기 버튼) 구현, 단기적으로는 dry-run 문구에서 복구 가능 암시 제거.


## P3 · 칸반·작업카드 (10)

### #159 [개선] 보드 목록 응답에 담당자 이름이 없어 리스트뷰 담당 열은 항상 '—', 카드 담당자는 '#숫자'로 표시
- **위치**: `netlify/functions/admin-workspace-tasks.ts:457`
- **설명**: 목록 API가 담당자 회원번호만 내려주고 이름을 붙여주지 않아, 리스트뷰의 '담당' 열은 언제나 '—'로 비고, 카드 모달 상단 담당자도 이름 대신 '#7' 같은 번호로 표시됩니다. 서브태스크 목록의 담당자도 마찬가지로 표시되지 않습니다. 비개발자 운영자는 번호만 보고 누구인지 알 수 없습니다.
- **근거**: admin-workspace-tasks.ts:457-461 — enriched는 서브태스크 카운트만 추가(이름 맵 없음). 리스트뷰(workspace-kanban.js:195)는 t.assignedToName 참조, 담당자 바(workspace-task-modal.js:171-176)는 이름 없으면 '#'+uid 표시. 서브태스크 API(admin-workspace-subtasks.ts:43-55)도 assignedToName 미제공인데 프론트(:2292)는 참조. AI 검색 API(:186-201)는 이름 보강을 이미 구현한 선례 있음.
- **권장조치**: 목록·서브태스크 응답에 AI 검색과 동일한 별도 members 조회 + Map 매칭으로 assignedToName 보강.

### #160 [개선] 드래그로 같은 컬럼 안 순서를 바꿔도 저장되지 않아 새로고침하면 원래대로 돌아감
- **위치**: `public/js/workspace-kanban.js:505`
- **설명**: 칸반에서 카드를 같은 컬럼 내에서 위아래로 정렬해도 서버에 순서(sortOrder)가 저장되지 않아, 새로고침하거나 다른 필터를 거치면 정렬이 초기화됩니다. 컬럼 간 이동만 저장되고 컬럼 내 이동은 조용히 무시됩니다.
- **근거**: workspace-kanban.js:499-505 — handleSortEnd에서 `if (!taskId || newCol === oldStatus) return;`로 같은 컬럼 이동은 즉시 종료(어떤 API도 호출 안 함). 서버는 sortOrder PATCH 지원(admin-workspace-tasks.ts:974) 및 렌더 정렬 1순위가 sortOrder(workspace-kanban.js:380-388).
- **권장조치**: onEnd에서 newIndex 기준으로 해당 컬럼 카드들의 sortOrder를 일괄 PATCH(또는 이동 카드만 중간값 부여).

### #161 [개선] 보관 해제 안내와 실제 복원 위치가 서로 다름 — '완료 컬럼으로 이동' 토스트가 부정확하고 드롭 위치도 무시됨
- **위치**: `public/js/workspace-kanban.js:846`
- **설명**: 보관된 카드를 모달에서 복원하면 '완료(done) 컬럼으로 이동'이라고 안내하지만, 서버는 보관 직전 상태(예: 준비중)로 복원하도록 개선(Q3-017)돼 문구가 틀립니다. 또 보관 컬럼에서 완료 컬럼으로 드래그하면 프론트가 '완료로 복원됐다'고 가정하고 재상태 변경을 생략해, 카드가 사용자가 놓은 곳이 아닌 이전 상태 컬럼으로 가버립니다.
- **근거**: 서버 unarchive(admin-workspace-tasks.ts:836-851)는 보관 직전 상태 복원. 프론트 restoreFromModal(workspace-kanban.js:846) 토스트는 '완료(done) 컬럼으로 이동'. 드래그 경로(:550-556)는 `if (newCol !== 'done')`일 때만 재상태 변경 — done에 놓으면 prevStatus(todo 등)로 감.
- **권장조치**: 토스트 문구를 '보관 직전 상태로 복원'으로 고치고, 드래그 복원은 unarchive 후 항상 newCol로 status PATCH.

### #162 [누락기능] 카드 모달의 '거쳐온 담당자' 체인이 항상 비어 있음 — 토스 이력을 내려주는 API가 없음
- **위치**: `public/js/workspace-task-modal.js:181`
- **설명**: 카드 모달 담당자 영역에는 토스를 거쳐온 담당자들을 화살표로 보여주는 UI가 있지만, 어떤 API도 토스 이력(transferChain)을 카드 응답에 실어주지 않아 이 영역은 영구히 빈 상태입니다. 토스 이력 자체는 DB에 잘 쌓이고 있는데 화면으로 이어지지 않는 만들다 만 기능입니다.
- **근거**: workspace-task-modal.js:179-190 — task.transferChain 배열을 렌더. grep 결과 'transferChain'은 이 파일 한 곳뿐(서버 생산자 없음). 이력 테이블은 db/schema.ts:2702 workspace_task_transfers에 존재하고 lib/workspace-sync.ts:341-351이 INSERT하지만 조회 API 없음.
- **권장조치**: 단건 GET(admin-workspace-tasks?id=N)에서 workspace_task_transfers를 조회해 이름 배열로 _computed.transferChain을 내려주기.

### #163 [누락기능] 보류 해제와 작업 삭제는 관련자에게 알림이 안 감
- **위치**: `netlify/functions/admin-workspace-tasks.ts:907`
- **설명**: 작업을 보류하면 지시자·소유자에게 알림이 가지만, 보류를 해제해 다시 진행 상태로 돌릴 때는 활동 기록만 남고 알림이 없다. 또 슈퍼관리자가 지시된 작업을 삭제하면 그 작업을 하던 담당자에게 아무 통보가 없어 담당자는 카드가 왜 사라졌는지 알 수 없다.
- **근거**: 보류(action=hold, 892-904행)는 logTaskChange+notifyMemberIds로 알림 발송. 해제(action=unhold, 908-931행)는 logWorkspaceActivity만. DELETE(1036-1067행)도 logWorkspaceActivity+logAudit만 — 담당자·워처 알림 없음.
- **권장조치**: unhold·DELETE에도 관련자(지시자/소유자/담당자) 알림 추가.

### #164 [데이터정합] 체크리스트를 체크해도 카드 진행률(%)이 자동 반영되지 않음 — 진행률 재계산 경로가 실제 UI에서 미사용
- **위치**: `netlify/functions/admin-workspace-task-checklist.ts:71`
- **설명**: 체크리스트 항목을 체크/해제하면 즉시 저장은 되지만 카드의 진행률 막대와 % 값은 그대로입니다. 진행률을 자동 재계산하는 서버 분기(action=checklist)가 있으나 화면 어디서도 호출하지 않고, 실제 사용되는 즉시저장 API는 항목만 갈아끼우고 진행률은 건드리지 않기 때문입니다. 진행률은 슬라이더로 따로 수동 조절해야 해 체크리스트 완료율과 어긋난 카드가 쌓입니다.
- **근거**: admin-workspace-task-checklist.ts:69-72 — checklistItems·updatedAt만 update(진행률 미계산). 진행률 자동 계산은 admin-workspace-tasks.ts:731-741(action=checklist)에 있으나 grep 결과 public/에서 'action=checklist' 호출 0건. 프론트 즉시저장은 workspace-kanban.js:2355-2372.
- **권장조치**: 체크리스트 전용 API에서도 done 비율로 progress를 재계산해 함께 저장 (메인 API 분기와 동일 로직).

### #165 [버그] 'AI 검색' 버튼이 AI 검색창이 아닌 일반 검색창의 텍스트를 우선 사용
- **위치**: `public/js/workspace-kanban.js:1061`
- **설명**: 화면에는 일반 키워드 검색창과 AI 자연어 검색창이 따로 있는데, AI 검색 버튼을 누르면 일반 검색창에 글자가 남아 있을 경우 그 텍스트로 AI 검색을 실행합니다. 사용자가 AI 검색창에 새로 입력한 질문이 무시되는 상황이 생깁니다.
- **근거**: workspace-kanban.js:1060-1063 — `const q = $('#wkSearch')?.value.trim() || $('#wkAiSearchInput')?.value.trim();` — 일반 검색창(#wkSearch)이 앞순위.
- **권장조치**: 우선순위를 뒤집어 #wkAiSearchInput 값을 먼저 사용.

### #166 [버그] 설명에 @멘션이 있는 카드는 저장할 때마다 멘션 대상에게 알림이 반복 발송됨
- **위치**: `netlify/functions/admin-workspace-tasks.ts:130`
- **설명**: 카드 설명에 '@홍길동'이 들어 있으면, 이후 그 카드에서 오타 수정 등 어떤 저장을 해도 매번 홍길동에게 '회원님을 멘션했습니다' 알림이 다시 갑니다. 멘션 기록 저장은 중복을 걸러내지만 알림 발송은 조건 없이 매번 실행되기 때문입니다.
- **근거**: admin-workspace-tasks.ts:112-144 — INSERT는 WHERE NOT EXISTS로 중복 방지(:115-123)하지만 dispatch(:129-143)는 매칭된 모든 멤버에게 무조건 실행. 일반 PATCH(:1017-1028)는 saveCardModal이 항상 title·description을 보내므로(workspace-kanban.js:798-805) 저장마다 재파싱.
- **권장조치**: INSERT 성공(신규 멘션)일 때만 dispatch하도록 INSERT 결과 rowCount를 확인.

### #167 [버그] 활동 피드의 '오늘/어제' 그룹이 KST가 아닌 UTC 기준 — 자정~오전 9시 활동이 '어제'로 분류
- **위치**: `netlify/functions/admin-workspace-tasks.ts:225`
- **설명**: 밤 12시부터 오전 9시(한국시간) 사이에 한 활동이 피드에서 '오늘'이 아니라 '어제' 그룹에 묶인다. 서버와 화면 폴백 모두 그룹 경계를 UTC 자정으로 계산하기 때문. 아침에 출근해 방금 전 새벽 작업을 찾을 때 혼란을 준다.
- **근거**: 225행 `new Date(now.getFullYear(), now.getMonth(), now.getDate())` — Netlify 서버 로컬=UTC 자정(=KST 09:00). 클라 폴백 workspace.js:494-496도 `toISOString().slice(0,10)`(UTC 날짜) 비교.
- **권장조치**: KST(+9h) 보정 후 날짜 경계 계산으로 통일.

### #168 [보안] 워처 등록·목록 조회에 작업 접근 검증이 없어 아무 카드나 관찰 등록해 제목·마감 알림을 받을 수 있음
- **위치**: `netlify/functions/admin-workspace-task-watchers.ts:74`
- **설명**: 권한 없는 운영자도 작업 번호만 알면 그 카드의 관찰자 목록을 조회하거나 자신을 관찰자로 등록할 수 있습니다. 관찰자로 등록되면 마감 임박 크론·토스 알림이 카드 제목과 함께 발송되므로, 열람 권한이 없는 민감 카드의 제목·진행 정보가 간접 노출됩니다.
- **근거**: admin-workspace-task-watchers.ts:44-85 — GET은 존재 검증조차 없이 목록 반환, POST는 작업 존재만 확인(:74-76)하고 소유/담당/지시 검증 없음. cron-workspace-due-reminder.ts:123-143과 lib/workspace-sync.ts:411-434가 워처에게 카드 제목 포함 알림 발송.
- **권장조치**: GET/POST에 하위작업 API(OP-033)와 동일한 작업 접근 검증 추가.


## P3 · 홈·메모·알림 (12)

### #147 [개선] 다른 탭에서 만든 메모가 홈 메모 위젯에 실시간 반영 안 됨 (동기화 이벤트 미구독)
- **위치**: `public/js/workspace.js:649`
- **설명**: 칸반이나 캘린더 탭에서 메모를 저장하면 캘린더는 다른 탭까지 즉시 갱신되지만, 워크툴 홈의 메모 위젯은 같은 탭에서 저장했을 때만 갱신된다. 홈이 탭 간 방송(memo:created)을 구독하지 않아서다. 작업 패널들은 task:* 이벤트를 구독하는 것과 대비.
- **근거**: 649행은 같은 탭 window 이벤트 'wmm:saved'만 구독. WorkspaceSync 구독(668-674행)은 task:*·page:visible뿐. 방송 발신은 workspace-memo-modal.js:229 notify('memo:created'), 수신자는 workspace-calendar.js:835-836뿐.
- **권장조치**: WorkspaceSync.on('memo:created', loadMemos) 한 줄 추가.

### #148 [개선] 활동 피드 자연어 변환 모듈이 로드만 되고 미사용 — 같은 로직이 두 벌 존재
- **위치**: `public/js/workspace-activity-render.js:24`
- **설명**: 피드 문구 변환을 위해 만든 공용 모듈(workspace-activity-render.js)을 홈 페이지가 script로 로드해 놓고 실제로는 쓰지 않고, workspace.js 안에 같은 변환 코드를 복붙으로 갖고 있다. 문구를 고치려면 두 곳(칸반 포함 시 세 곳)을 같이 고쳐야 하고, 이번에 발견된 철자 불일치(task.create vs task.created)도 두 벌 모두에 존재한다.
- **근거**: workspace.html:636에서 로드하지만 workspace.js에 WorkspaceActivityRender 참조 0건 — 433-515행에 toNaturalText/relativeTime/calcGroupKey 사본 존재. 모듈 주석(5행)은 'workspace.js…공용 사용' 명시.
- **권장조치**: workspace.js 사본 제거 후 모듈 호출로 교체(철자 정정과 함께).

### #149 [누락기능] 토스 모달의 '부재 중 ⚠️' 경고가 절대 표시되지 않음 — 운영자 목록 API가 부재 정보를 안 내려줌
- **위치**: `netlify/functions/admin-workspace-member-list.ts:29`
- **설명**: 카드를 다른 운영자에게 토스할 때 받는 사람이 휴가(부재) 중이면 경고를 띄우도록 UI가 만들어져 있지만, 운영자 목록 API 응답에 부재 여부 필드가 없어 경고가 한 번도 뜨지 않습니다. 부재 중인 사람에게 아무 경고 없이 카드가 넘어가 응대가 지연될 수 있습니다. R&R 자동배정은 부재를 확인하는 것과 대조적입니다.
- **근거**: admin-workspace-member-list.ts:28-34 — select가 id·name·email·role만 반환. workspace-task-modal.js:254-258 — `m.outOfOffice`로 '(부재 중 ⚠️)' 라벨·경고 힌트 제어(항상 undefined). 부재 판정 로직은 lib/workspace-sync.ts:146-178에 이미 존재.
- **권장조치**: member-list select에 out_of_office·기간 컬럼을 추가하고 isMemberOutOfOffice와 같은 기간 계산으로 outOfOffice boolean을 내려주기.

### #150 [누락기능] 공유 대상 멤버 선택 목록에 직원(operator)이 안 나와 직원에게 파일 공유 불가
- **위치**: `netlify/functions/admin-workspace-member-list.ts:38`
- **설명**: 워크스페이스는 운영자(직원)도 사용하는 도구인데, 공유 모달의 멤버 드롭다운을 채우는 API가 국장(admin)·최고관리자만 조회해 직원 계정은 선택지에 아예 나타나지 않는다. 직원과 자료를 나누려면 전체 공개로 열 수밖에 없다.
- **근거**: 38행 inArray(members.role, ["admin", "super_admin"]) — 'operator' 역할 제외. 권한 체계에 operator 역할 실존(lib/role-permission-check.ts:35, permission-catalog operatorDefault). 공유 POST 자체는 임의 회원 id 허용(admin-workspace-file-share.ts:102-105)이라 서버 정책도 아님.
- **권장조치**: 조회 조건에 operator(또는 operatorActive=true) 포함.

### #151 [데이터정합] 카드 삭제 시 멘션 기록이 고아로 남음 (멘션 테이블만 FK 미설정)
- **위치**: `db/schema.ts:3317`
- **설명**: 카드를 삭제하면 댓글·첨부·워처·보고서·토스 이력은 연쇄 삭제되지만 멘션 기록은 남습니다. 멘션함에는 제목 없는(null) 유령 항목이 계속 표시될 수 있습니다.
- **근거**: db/schema.ts:3314-3324 — workspace_task_mentions.taskId가 `integer("task_id").notNull()`로 FK 없음(다른 하위 테이블은 :1907, :1945, :2704, :2721 모두 onDelete cascade). admin-workspace-tasks.ts DELETE(:1053-1056)도 멘션 정리 없음. workspace-task-mentions.ts:63-67은 taskTitle을 null로 내려 화면에 제목 없는 항목 발생.
- **권장조치**: task_id에 FK(onDelete cascade) 마이그레이션 또는 DELETE 핸들러에서 멘션 함께 삭제.

### #152 [버그] 같은 성과관리 스크립트를 두 페이지가 서로 다른 캐시버스터 버전으로 참조 — 메인 워크스페이스에서 구버전 스크립트가 서빙될 수 있음
- **위치**: `public/workspace.html:643`
- **설명**: 성과관리 화면 스크립트(workspace-milestones.js)는 전용 페이지와 워크스페이스 메인 페이지(성과 패널 내장) 두 곳에서 로드되는데, 전용 페이지는 v=17, 메인 페이지는 v=16으로 버전 표기가 어긋나 있다. 스크립트를 고칠 때 한쪽 페이지만 버전을 올린 것으로, 브라우저·CDN에 v=16이 캐시된 사용자는 워크스페이스 메인의 성과 패널에서 수정 전 구버전 동작(이 경우 로그아웃 버튼 처리 누락분)을 계속 보게 된다. 프로젝트 규칙(캐시버스터는 모든 참조 페이지 일괄 갱신) 위반 사례.
- **근거**: public/workspace.html:643 `/js/workspace-milestones.js?v=16-polish` vs public/workspace-milestones.html:269 `/js/workspace-milestones.js?v=17-logout` — 동일 파일 상이 버전. v17 변경분은 wsBtnLogout 핸들러(workspace-milestones.js:57-64, 2026-06-03 추가)
- **권장조치**: workspace.html의 참조도 v=17-logout(또는 공통 새 버전)으로 통일

### #153 [버그] '내 작업' 패널 첫 화면: 필터는 '할 일' 선택 표시인데 목록은 전체 상태를 보여줌
- **위치**: `public/workspace.html:264`
- **설명**: 홈에 들어가면 내 작업 패널의 상태 필터가 '할 일'로 선택돼 보이지만 실제 목록에는 진행중·완료 작업까지 다 나온다. HTML은 '할 일'을 기본 선택으로 지정했는데 스크립트 초기값은 '전체'라서 첫 렌더에서 서로 어긋난다. 필터를 한 번 만지면 그때부터 일치.
- **근거**: workspace.html:264 `<option value="todo" selected>할 일</option>` vs workspace.js:37 `filterTaskStatus: 'all'` — change 이벤트 전까지 STATE가 all이므로 renderMyTasks(318행)가 무필터 렌더.
- **권장조치**: 초기 STATE를 'todo'로 맞추거나 selected 제거.

### #154 [버그] 알림 필터의 '관찰' 탭은 어떤 코드도 그 분류로 기록하지 않아 항상 빈 결과
- **위치**: `public/workspace-notifications.html:85`
- **설명**: 알림 전체보기 페이지의 '관찰' 필터 탭을 누르면 항상 '표시할 알림이 없습니다'가 나온다. 카드를 관찰(워처) 등록한 사람에게 가는 알림이 실제로는 '마감'(due)이나 '토스'(transfer) 분류로 저장되고, 'watcher' 분류로 저장하는 코드가 전무하기 때문. 탭이 있으니 기능이 있는 줄 알지만 실제로는 죽은 필터다.
- **근거**: category "watcher" 기록처 grep 0건(타입 정의 lib/workspace-logger.ts:72에만 존재). 워처 수신 경로: cron-workspace-due-reminder.ts 'due'(100행), transferWorkspaceTask 'transfer'(lib/workspace-sync.ts:432).
- **권장조치**: 워처 수신 알림은 category='watcher'로 기록하거나 탭 제거.

### #155 [버그] 오전 9시(KST) 이전에는 AI 브리핑 위젯이 어제 브리핑을 보여줌
- **위치**: `netlify/functions/admin-daily-briefing.ts:127`
- **설명**: 브리핑은 매일 오전 6시(KST)에 새로 생성되는데, 오전 6~9시에 접속하면 '오늘 브리핑' 조회가 서버(UTC) 날짜 기준이라 전날 것을 찾아 보여준다. 아침 일찍 출근하는 운영자가 이미 갱신된 오늘 제안 대신 어제 제안을 본다.
- **근거**: 127행 today=1 처리 `targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())` — UTC 날짜(KST-9h). cron-agent-8은 briefingDate=KST 날짜(kstToday, 299행)로 저장 → KST 00~09시엔 targetDate가 전날이라 전날 행 매칭.
- **권장조치**: today=1도 KST(+9h) 보정 날짜로 조회.

### #156 [버그] 작업 카드의 '오늘 마감/내일 마감' 라벨이 달력 날짜가 아닌 '지금부터 24시간' 기준
- **위치**: `public/js/workspace.js:123`
- **설명**: 내일 오전 10시 마감 작업이 오늘 오후에 '오늘 마감'으로 표시되는 등, 마감 라벨이 달력상 날짜가 아니라 현재 시각부터 24시간 단위로 계산된다. 반대로 마감 시각이 몇 시간 지난 오늘 마감 작업은 '1일 지남'으로 표시된다. 브리핑 카드 숫자(달력일+KST 어긋남 포함)와도 기준이 달라 위젯끼리 서로 다른 얘기를 한다.
- **근거**: 123행 `diffDays = Math.floor((d - now) / 86400000)` — 시각 차이 기반. 125행 diffDays<0 → '지남', 126행 ===0 → '오늘 마감'. 달력일 비교 아님. 동일 패턴이 우선작업 위젯 formatDue(1107행, Math.ceil)에도 있으나 서로 올림/내림까지 달라 두 위젯 라벨도 불일치.
- **권장조치**: KST 달력일 차이(자정 경계)로 D-day 계산하는 공용 헬퍼(lib-kst.js)로 통일.

### #157 [보안] JWT 서명키 환경변수가 빠지면 공개된 기본값으로 동작해 토큰 위조가 가능해지는 구조 (fail-open)
- **위치**: `lib/auth.ts:9`
- **설명**: 로그인 토큰 서명키(JWT_SECRET·ADMIN_JWT_SECRET)가 환경변수에 없으면 코드에 하드코딩된 기본 문자열('dev-secret-please-change' 등)로 서명·검증한다. 현재 운영 환경에는 키가 설정돼 있지만, 환경변수 정리·프로젝트 이전·재배포 실수로 키가 빠지는 순간 에러 없이 조용히 공개 키로 전환되어 누구나 관리자 토큰을 위조할 수 있게 된다. 실수를 즉시 드러내는 fail-closed(기동 시 에러)가 안전하다.
- **근거**: lib/auth.ts:9-12 `const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-please-change"; const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "dev-admin-secret-please-change"` — 저장소에 커밋된 공개 문자열이 폴백. 대조: INTERNAL_TRIGGER_SECRET은 fail-closed로 이미 교정됨(ai-task-summary-background.ts:30-35 P1-5 fix).
- **권장조치**: 운영 환경(NETLIFY=true 등)에서 시크릿 미설정 시 throw 하거나, 최소한 기동 로그에 치명 경고. 개발 편의는 NETLIFY_DEV 감지 시에만 폴백 허용.

### #158 [성능비용] 근태 점검 cron 2개가 5분 간격(23:00·23:05 UTC)으로 분산 — DB wake 시간 연장(분 정렬 정책 위반)
- **위치**: `netlify.toml:472`
- **설명**: 아침 8시(KST)에 도는 연속재택 점검과 8시 5분의 지각누적 점검이 5분 간격으로 나뉘어 있어 DB 활성 시간이 그만큼 늘어난다. 프로젝트 비용 규칙(신규 cron은 기존 cron과 같은 분으로 정렬해 wake 횟수 최소화)에 맞춰 같은 분으로 정렬하면 wake 창을 줄일 수 있다.
- **근거**: cron-att-late-streak "5 23 * * *"(netlify.toml 473행·함수 17행), cron-att-remote-streak "0 23 * * *"(475행·함수 18행). CLAUDE.md §9.3.8 '기존 빈발 크론과 같은 분(minute)에 정렬(:00/:10/...)' 정책.
- **권장조치**: late-streak를 "0 23 * * *"로 정렬(두 cron은 서로 독립·동시 실행 무해).


## P3 · 캘린더·일정 (6)

### #134 [개선] 겹치는 일정 사전 경고·월별 통계 API가 만들어졌지만 어떤 화면도 사용하지 않음 (이중 예약 무방비)
- **위치**: `netlify/functions/admin-workspace-events.ts:52`
- **설명**: 서버에는 '이 시간대에 이미 겹치는 일정이 있는지' 미리 검사하는 기능과 월별 일정 통계 기능이 구현돼 있지만, 캘린더를 포함한 어떤 화면도 호출하지 않습니다. 그래서 운영자가 같은 시간에 두 회의를 잡아도 아무 경고가 없습니다. 일정 저장 직전에 이 검사를 한 번 불러 '같은 시간에 ○○ 일정이 있습니다. 계속할까요?'만 물어봐도 이중 예약 실수를 막을 수 있습니다.
- **근거**: conflicts=1(52-93행)·stats=1(96-117행) 구현 존재. public/ 전체 grep 'conflicts=1'·'stats=1&year' 호출처 0건. saveEvent(workspace-calendar.js:424-463)는 검증 없이 바로 POST/PATCH. (부수: stats의 EXTRACT(MONTH FROM start_at)는 UTC 기준이라 KST 월초 자정~09시 일정이 전월로 집계되는 잠재 오차도 있음 — 사용 시점에 함께 수정 필요.)
- **권장조치**: saveEvent에서 저장 전 GET ?conflicts=1&startAt=..&endAt=..(수정 시 excludeId) 호출 → hasConflict면 확인 다이얼로그.

### #135 [개선] 일정 유형(회의·이사회·마감·상담)별 색상이 준비돼 있지만 화면에서 유형을 지정할 방법이 없어 모두 같은 색
- **위치**: `public/workspace-calendar.html:164`
- **설명**: CSS에는 회의(보라)·이사회(노랑)·마감(빨강)·상담(분홍) 색상 구분이, DB에는 유형·색상 칸이 준비돼 있고 유형별 필터 API까지 있습니다. 그러나 일정 생성/수정 모달에는 유형·색상 선택란이 없어 사람이 만드는 모든 일정이 기본(general) 파란색으로만 표시됩니다. 유형 구분은 현재 AI 비서가 만든 일정에서만 우연히 나타날 수 있습니다. 한눈에 회의와 마감을 구분하는 캘린더의 기본 편의가 죽어 있는 상태입니다.
- **근거**: workspace-calendar.css:144-147 wc-ev-event-meeting/board_meeting/deadline/counseling 스타일 존재. 렌더는 row.eventType 기반 클래스 적용(workspace-calendar.js:268-270). 그러나 편집 모달(workspace-calendar.html:162-183)에 eventType/color 입력 없음, saveEvent payload(435-442)에도 없음 → POST 기본값 'general'(admin-workspace-events.ts:301). 서버 type 필터(208행)·AI 도구 eventType(ai-agent-tools.ts:2525)은 지원.
- **권장조치**: 편집 모달에 유형 셀렉트(일반/회의/이사회/마감/상담) 추가하고 payload에 eventType 포함.

### #136 [누락기능] 일정 시간·장소를 바꿔도 참석자에게 변경 알림이 가지 않음
- **위치**: `netlify/functions/admin-workspace-events.ts:477`
- **설명**: 일정 '생성' 시에는 초대 알림, '삭제' 시에는 취소 알림을 보내지만, 정작 가장 흔한 '시간·장소 변경'은 활동 로그만 남기고 참석자에게 아무 알림도 보내지 않습니다. 참석자는 옛 시간만 알고 있다가 회의에 늦을 수 있습니다. (현재는 초대 기능 자체가 화면에 없어 실피해는 없지만, 초대 기능이 연결되는 즉시 드러날 공백입니다.)
- **근거**: 일반 PATCH(432-488행): updateData 적용 → logAudit(471) → logWorkspaceActivity(477) 후 종료. broadcastNotification 호출 없음. 대조: POST 340-351(초대 알림)·DELETE 516-525(취소 알림)는 존재.
- **권장조치**: PATCH에서 startAt/endAt/location 변경 시 attendees에게 broadcastNotification('일정이 변경되었습니다: 제목·새 시간') 발송.

### #137 [데이터정합] 일정을 삭제해도 참석 응답 기록이 지워지지 않고 고아 데이터로 남음
- **위치**: `netlify/functions/admin-workspace-events.ts:509`
- **설명**: 일정을 삭제하면 일정 자체는 지워지지만, 그 일정에 달린 참석/불참/미정 응답 기록은 응답 테이블에 그대로 남습니다. 데이터베이스 차원의 자동 연쇄 삭제 연결도 없습니다. 지금은 초대 기능이 막혀 있어 실제 응답 데이터가 적겠지만, 초대 기능이 열리는 순간부터 삭제된 일정의 응답이 계속 쌓이고, 나중에 같은 번호로 다른 일정이 생기면 엉뚱한 응답 수가 표시될 위험이 있습니다.
- **근거**: DELETE 처리(admin-workspace-events.ts:494-545)는 db.delete(workspaceEvents)만 수행, workspaceEventRsvps 정리 없음. schema.ts:3329 workspace_event_rsvps.event_id는 integer로만 정의 — references()/onDelete cascade 없음(workspace_events.member_id는 3186... 1685행처럼 cascade 패턴이 표준인데 미적용).
- **권장조치**: DELETE 핸들러에서 eq(workspaceEventRsvps.eventId,id) 삭제 1줄 추가(스키마 변경 불필요·즉시 적용 가능).

### #138 [데이터정합] 참석 응답을 바꿔도 응답 시각이 처음 응답 시각으로 남고, '미정' 응답이 알림 분류상 '거절'로 기록됨
- **위치**: `netlify/functions/workspace-event-rsvp.ts:103`
- **설명**: 참석 여부를 '참석'에서 '불참'으로 바꿔도 기록상 응답 시각은 맨 처음 응답했던 시각 그대로 남아, 나중에 '언제 바뀐 응답인지' 추적이 어렵습니다. 또 '미정' 응답이 주최자 알림에서 내부 분류상 '거절(rejected)' 유형으로 저장돼, 알림함에서 유형별 아이콘·필터가 생기면 미정 응답이 거절로 보이게 됩니다(알림 문구 자체는 '미정'으로 올바름).
- **근거**: workspace-event-rsvp.ts:73-77 update는 {status,note}만 set — respondedAt(defaultNow, insert 시만) 미갱신. admin-workspace-events.ts:396 rsvp update도 {status}만. notifType 삼항: workspace-event-rsvp.ts:103 및 admin-workspace-events.ts:422 — status==='yes'?'approved':'rejected' (maybe→rejected).
- **권장조치**: update set에 respondedAt: new Date() 추가, maybe는 별도 notifType(예: 'info')으로 분리.

### #139 [운영자립] 구글 연동에 필요한 환경변수 3종이 표준 환경변수 목록에 없어 미설정 시 연동 버튼이 항상 서버 오류
- **위치**: `netlify/functions/google-calendar-auth.ts:17`
- **설명**: 구글 캘린더 연동은 GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET·GOOGLE_REDIRECT_URI 세 가지 설정값이 있어야 동작하는데, 프로젝트 표준 환경변수 목록(CLAUDE.md §5)에 이 세 개가 빠져 있습니다. 새 환경 구축이나 설정 점검 때 누락되기 쉽고, 누락 상태에서는 '연동' 버튼이 화면에 멀쩡히 보이지만 누르면 매번 서버 오류 토스트만 뜹니다. 설정이 없으면 버튼 자체를 숨기거나 안내 문구를 주는 편이 운영자에게 친절합니다.
- **근거**: google-calendar-auth.ts:15-19 — clientId/redirectUri 없으면 serverError 500. GOOGLE_CLIENT_ID grep: 함수 3개+2026-05-17 마일스톤 문서뿐, CLAUDE.md §5 환경변수 목록에 부재. 프론트(workspace-calendar.js:586-598)는 status의 connected=false면 연동 버튼 무조건 노출 — env 미설정 여부 구분 없음.
- **권장조치**: CLAUDE.md §5에 GOOGLE_* 3종 추가. status 응답에 configured 필드를 더해 미설정이면 연동 버튼 숨김+안내.


## P3 · 파일함·휴지통 (7)

### #140 [개선] 공유 만료일을 설정할 수 있는 입력이 화면에 없음 — 서버 기능이 사장됨
- **위치**: `public/js/workspace-files.js:701`
- **설명**: 서버는 공유별 만료일을 저장·수정·강제(파일 한정)할 수 있지만, 공유 모달에는 멤버·권한 선택만 있고 만료일 입력이 없어 모든 공유가 무기한으로 생성된다. 기간 한정 자료 공유라는 운영 요구를 코드 수정 없이는 충족 못 함.
- **근거**: addShare(694-709행) expiresAt: null 고정. workspace-files.html 공유 모달(283-299행) 만료 입력 없음. 서버는 POST/PATCH 모두 expiresAt 수용(admin-workspace-file-share.ts:99·174-176).
- **권장조치**: 공유 추가 행에 날짜 입력(선택) 추가 + 목록에 만료일 표시.

### #141 [개선] ZIP 일괄 다운로드에서 같은 이름의 파일이 여러 개면 하나만 담기고 나머지는 소리 없이 유실
- **위치**: `public/js/workspace-files.js:1066`
- **설명**: 파일함은 같은 폴더에 동일 이름 파일 업로드를 막지 않는데, 여러 파일을 선택해 ZIP으로 받으면 파일명이 키가 되어 같은 이름끼리 덮어써진다. 5개를 선택했는데 압축엔 4개만 들어 있어도 '완료 (5/5)'로 표시된다. 또 전 파일을 브라우저 메모리에 순차 적재해 대용량 다수 선택 시 실패 위험.
- **근거**: 1066행 zip.file(file.name, blob) — 중복명 미처리. 서버 presign은 이름 중복 허용(파일명 유니크 제약 없음, schema.ts:1858-1882). 완료 카운트 done은 다운로드 성공 기준(1067행)이라 덮어쓰기 미반영.
- **권장조치**: 중복명에 (1), (2) 접미사 부여 후 zip.file 호출.

### #142 [개선] 헤더 전체선택 체크박스가 탭 전환·개별 해제와 동기화되지 않음
- **위치**: `public/js/workspace-files.js:1240`
- **설명**: 전체선택을 켠 뒤 탭을 바꾸면 선택은 초기화되는데 헤더 체크박스는 켜진 채 남아 화면 상태가 어긋난다. 개별 행 체크를 하나 풀어도 헤더는 켜진 채다. 이 상태에서 Delete 키 일괄 삭제 같은 동작과 결합하면 운영자가 선택 범위를 오인할 수 있다.
- **근거**: switchView(1150-1159행)는 selectedFileIds.clear()만 하고 #wfSelectAll.checked 미해제. 개별 체크 change(359-368행)도 헤더 미갱신. 헤더 갱신 코드는 Ctrl+A 경로(1369-1370행)에만 존재.
- **권장조치**: renderFileList/updateBulkButtons에서 헤더 체크박스 상태를 선택 수와 동기화.

### #143 [데이터정합] 영구삭제 경로 3곳이 공유 레코드를 정리하지 않아 고아 공유 행이 계속 쌓임
- **위치**: `netlify/functions/cron-workspace-trash-cleanup.ts:58`
- **설명**: 휴지통 30일 크론, 파일 영구삭제(purge), 폴더 영구삭제(folder-purge) 모두 파일·폴더 본체는 지우면서 공유 테이블의 해당 레코드는 남긴다(구식 hard=1 파일 삭제 경로만 정리함). 기능 오동작으로 즉시 이어지진 않지만 대상 없는 공유 행이 무한 누적된다.
- **근거**: cron 58행 db.delete(workspaceFiles)만. admin-workspace-file-purge.ts:50, admin-workspace-folder-purge.ts:76-79 — workspaceFileShares 삭제 없음. 대조: admin-workspace-files.ts:294-299(hard=1)는 공유 정리 수행.
- **권장조치**: 세 경로에 targetType/targetId 매칭 공유 행 delete 추가.

### #144 [데이터정합] 휴지통에 있는 하위 폴더는 상위 폴더 이름변경·이동 시 경로 갱신에서 제외돼 복원 후 경로가 어긋남
- **위치**: `netlify/functions/admin-workspace-folders.ts:378`
- **설명**: 폴더 이름을 바꾸면 하위 폴더들의 내부 경로 문자열을 일괄 갱신하는데, 휴지통에 있는 하위 폴더는 갱신 대상에서 빠진다. 나중에 그 폴더를 복원하면 옛 경로를 갖게 되어, 경로 문자열 기반으로 자손을 찾는 삭제·이동 검사가 잘못된 범위를 잡을 수 있다.
- **근거**: 373-380행 UPDATE workspace_folders ... WHERE path LIKE ... AND deleted_at IS NULL — 소프트삭제 자손 제외. 복원(269-282행)은 path 재계산 없음. getDescendantFolderIds(77-91행)는 path LIKE 의존.
- **권장조치**: 경로 일괄 갱신에서 deleted_at 조건 제거(휴지통 포함 갱신)하거나 복원 시 path 재계산.

### #145 [버그] 파일 목록 '소유자' 열이 항상 '—'로 표시됨
- **위치**: `public/js/workspace-files.js:326`
- **설명**: 화면은 파일마다 소유자 이름을 보여주도록 만들어져 있지만 서버가 파일 행만 반환하고 소유자 이름·이메일을 붙여주지 않아 모든 행이 '—'로 나온다. 공유 파일함에서 누가 올린 파일인지 구분할 수 없다.
- **근거**: workspace-files.js:326 `f.ownerName || f.ownerEmail || '—'` — admin-workspace-files.ts GET(162-168행)은 db.select().from(workspaceFiles) 원본 컬럼만, members 매칭 없음.
- **권장조치**: 서버에서 ownerId 수집 후 members 별도 조회 + Map 매칭으로 ownerName 부여(leftJoin 체인 금지 관습 준수).

### #146 [버그] '모든 운영자에게 공유'(대상 미지정) 생성 시 기존 개인 공유 하나를 덮어써 의도와 다른 결과
- **위치**: `netlify/functions/admin-workspace-file-share.ts:108`
- **설명**: 특정인 없이 전체 대상으로 공유를 만들려고 하면(API 호출 시 sharedWith 생략) 중복 검사가 대상 조건 없이 아무 공유나 한 건 잡아 그것을 수정해버린다. 예: 김직원 개인 공유가 있는 파일에 전체 공유를 추가하면 전체 공유는 생성되지 않고 김직원 공유의 권한·만료만 바뀐다. 현재 화면은 멤버 선택을 강제해 노출 안 되지만 API 계약 결함.
- **근거**: 108-125행: dupConds가 sharedWith null이면 targetType+targetId만으로 limit 1 매칭 후 UPDATE. isNull(sharedWith) 조건 부재. 유니크 인덱스(schema.ts:1896-1897)는 NULL 중복을 막지 못함.
- **권장조치**: sharedWith null일 때 dup 조건에 isNull(workspaceFileShares.sharedWith) 추가.


## P3 · 마일스톤·성과 (4)

### #169 [개선] 분류 '제외' 버튼이 확인창 없이 즉시 실행되고, 제외한 카드를 다시 보거나 되돌릴 화면이 어디에도 없음
- **위치**: `public/js/workspace-milestones.js:1001`
- **설명**: 보류 큐에서 '제외'를 누르면 확인 없이 그 카드가 성과 분류 대상에서 영구 제거된다. 서버는 보관함 API에서 제외 목록(skipped)을 함께 내려주지만 화면 코드는 이를 아예 그리지 않아서, 실수로 제외를 눌러도 그 카드가 어디 갔는지 볼 수 없고 재분류할 방법도 없다(관리자 CMS에도 해당 UI 없음). 성과 건수가 곧 보너스로 이어지는 구조라 실수 클릭 한 번이 조용한 실적 누락이 된다.
- **근거**: workspace-milestones.js:1001-1009 skip 핸들러 — confirm 없음. 보관함 렌더 :1022-1023은 res.data.grouped/unmatched만 사용, 서버가 반환하는 skipped(workspace-milestone-done-tasks.ts:66-70,93-94)는 미표시. public/js 전체 grep에서 milestone skipped 렌더·복구 UI 부재 확인. 서버는 skipped 카드도 confirm 재호출로 복구 가능(task-match는 상태 제한 없음)이나 진입 UI가 없음
- **권장조치**: 제외 클릭 시 confirm 추가 + 보관함에 '제외됨' 접이식 섹션과 '다시 분류' 버튼(기존 confirm API 재사용) 노출

### #170 [데이터정합] 수동 분류 확정 API가 마일스톤의 소유 역할·카테고리를 검증하지 않아 매출연동 마일스톤에도 카드를 붙이고 비매출 성과를 오생성할 수 있음
- **위치**: `netlify/functions/workspace-milestone-task-match.ts:66`
- **설명**: 보류 큐 화면은 본인 역할의 비매출 마일스톤만 선택지로 주지만, 확정 API 자체는 '활성 마일스톤인지'만 확인한다. API를 직접 호출하면 남의 역할 마일스톤이나 매출연동(REVENUE_LINKED) 마일스톤에도 자기 카드를 연결할 수 있고, 그 상태로 목표 건수가 차면 매출연동 정의에 대한 '비매출 성과' 레코드가 자동 생성되어 검증 큐에 올라간다. 현재는 관리자 토큰이 필요해 위험도가 낮지만, 위 P2 권장대로 운영자에게 개방하면 검증 없이 열리게 되므로 개방 시 반드시 함께 보강해야 한다.
- **근거**: workspace-milestone-task-match.ts:63-72 — SELECT 조건이 id+is_active뿐(target_milestone_role·category 미검증). 비교: 카드 생성 API는 둘 다 검증(workspace-milestone-create-tasks.ts:48-56), 비매출 직접 제출도 검증(milestone-nonrevenue.ts:68-74). 목표 달성 시 :105-125에서 category 무관하게 non_revenue_achievements INSERT
- **권장조치**: confirm 분기에서 def.category != 'REVENUE_LINKED' AND (def.target_milestone_role = 본인 milestoneRole OR super_admin) 검증 추가

### #171 [버그] 성과 역할이 없는 슈퍼어드민이 '비매출 성과 제출' 모달을 열면 마일스톤 목록이 빈 채 제출 불가 (role=null 문자열 전달)
- **위치**: `public/js/workspace-milestones.js:930`
- **설명**: 슈퍼어드민은 성과 담당 역할이 없어도 성과관리 화면에 들어올 수 있고 비매출 성과 탭도 보인다. 그런데 '성과 제출' 모달이 마일스톤 목록을 부를 때 본인 역할값을 그대로 주소에 붙여서, 역할이 없으면 문자 그대로 'role=null'이라는 값이 서버로 가고 서버는 역할코드가 'null'인 마일스톤(존재하지 않음)을 찾아 빈 목록을 돌려준다. 결과적으로 모달의 마일스톤 선택칸이 비어 제출이 불가능한데 아무 안내도 없다. 서버 제출 API 자체는 슈퍼어드민에게 어떤 마일스톤이든 허용하므로 목록만 문제.
- **근거**: workspace-milestones.js:930 `role=${state.member.milestoneRole}` — null이면 문자열 'null'로 직렬화. milestone-definitions.ts:39-40 슈퍼어드민+role 파라미터 존재 시 `target_milestone_role = 'null'` 필터 → 0건. 카드 생성 섹션(:360)과 매출 로드(:239)는 milestoneRole 유무 가드가 있으나 이 모달만 없음. 슈퍼어드민 통과 경로: :116 `!milestoneRole && !isSuperAdmin`
- **권장조치**: milestoneRole 없으면 role 파라미터 생략(슈퍼어드민은 전체 목록 수신) 또는 모달에 '역할 미배정' 안내

### #172 [운영자립] 결산 미제출 독촉 알림이 매일 같은 내용으로 반복 발송되고, 운영자 토글 직원의 미제출은 아예 감지 대상에서 빠짐
- **위치**: `netlify/functions/cron-milestone-quarter.ts:56`
- **설명**: 분기가 종료되면 매일 아침 9시(KST) 크론이 미제출자 명단을 슈퍼어드민에게 알림으로 보내는데, 중복 방지 장치가 없어 분기가 정산 완료될 때까지 매일 똑같은 알림이 쌓인다(임계점 알림에는 중복 방지가 있는 것과 대조). 또 미제출 검사 대상을 관리자 계정(type=admin)으로만 한정해서, 운영자 토글로 성과 역할을 받은 일반회원 직원이 결산을 안 내도 에스컬레이션에 영영 잡히지 않는다(성과 구성원 목록·역할 배정은 이런 직원을 포함하는 것과 불일치).
- **근거**: cron-milestone-quarter.ts:53-86 — ENDED 분기마다 매일 notifyAllSuperAdmins, dedup 조회 없음(임계점 알림 :145-153은 notifications ref_table 중복 체크 있음). 대상 조회 :56-58 `WHERE type='admin' AND milestone_role IS NOT NULL` — milestone-members.ts:28·admin-milestone-role-assign.ts:65는 operator_active=TRUE 일반회원 포함. 임계점 담당 그룹 알림 대상(:126-129)도 type='admin' 한정
- **권장조치**: 에스컬레이션에 임계점 알림과 동일한 ref 기반 중복 방지(예: 분기당 1회 또는 주 1회) 추가 + 대상 조회를 (type='admin' OR operator_active=TRUE)로 확장


## P3 · 근태(직원) (8)

### #126 [개선] 워크툴 상단바 퇴근 버튼엔 '근무시간 미달' 확인창이 없고, '재출근하려면 새로고침' 안내는 실제로는 동작하지 않음
- **위치**: `public/js/workspace-topbar-attendance.js:209`
- **설명**: 근태관리 페이지의 퇴근은 8시간 미달 시 '아직 근무시간이 N분 부족합니다' 확인창을 먼저 띄우는데, 워크툴 상단바의 퇴근 버튼은 같은 확인 없이 즉시 퇴근 확정된다(실수 퇴근 방지 장치가 경로에 따라 다름). 또 퇴근 완료 후 버튼 툴팁이 '재출근하려면 새로고침'이지만 새로고침해도 버튼은 계속 비활성이라 재출근은 근태관리 페이지에서만 가능해 안내가 사용자를 헛돌게 한다.
- **근거**: doCheckout(202-237행)에 preview:true 사전 호출 없음 — 비교: workspace-attendance.js 481-494행은 preview 후 confirm. applyTodayState(120-127행)는 checkoutAt 존재 시 disabled:true 고정 + title '재출근하려면 새로고침'(124행) — 새로고침해도 동일 상태.
- **권장조치**: 상단바 퇴근에도 preview 확인 적용, 완료 상태 안내를 '재출근은 근태관리 페이지에서'로 수정.

### #127 [개선] 근무형태 변경 신청: 같은 날짜 중복 PENDING 무제한 접수 + 날짜 형식 미검증(500 노출)
- **위치**: `netlify/functions/att-workmode-change-request.ts:56`
- **설명**: 직원이 같은 날짜로 근무형태 변경 신청을 여러 번 제출해도 전부 접수돼 결재함에 중복 건이 쌓이고 슈퍼어드민에게 중복 알림이 간다. 날짜 형식이 잘못되면 검증 단계가 아니라 DB 저장 단계에서 500 오류로 떨어진다. 같은 결재형인 휴가 신청(기간 겹침 409 차단·형식 검증)과 검증 수준이 다르다.
- **근거**: POST 검증은 존재 여부·모드 화이트리스트·사유만(56-65행) — 날짜 형식(YYYY-MM-DD) 검사·동일 날짜 PENDING 중복 검사 없이 insert(69-75행). 비교: att-leave-request.ts 170-192행은 겹침 409, 80-84행은 날짜 형식 검증.
- **권장조치**: YYYY-MM-DD 정규식 검증 + 같은 memberUid·targetDate·PENDING 존재 시 409 반환.

### #128 [개선] AI 일일 근태 요약이 주말·공휴일에도 '전원 결근'으로 발송되는 알림 노이즈
- **위치**: `netlify/functions/cron-att-ai-daily.ts:18`
- **설명**: 매일 18시 슈퍼어드민에게 가는 AI 근태 요약이 토·일·공휴일에도 발송돼 '결근/미체크 = 전 직원 수'로 계산된 경고성 요약(결근 20%+ 이상 신호 강조 규칙 충족)이 온다. 반복되는 오경보는 관리자가 이 알림 자체를 무시하게 만들어 정작 평일의 진짜 이상 신호를 놓치게 한다. Gemini 호출 비용도 매 주말 낭비된다.
- **근거**: schedule "0 9 * * *"(18행) 매일 실행, 주말·공휴일 스킵 없음(cron-att-morning은 31-39행에서 공휴일 스킵 보유). absent = 전체 운영자 − 출근자(65행)라 주말엔 전원 결근 집계. 프롬프트가 '결근 20%+' 이상신호 강조 지시(83행).
- **권장조치**: 주말(KST 요일)·att_holidays 스킵을 cron-att-morning과 동일하게 추가.

### #129 [데이터정합] 연차 자동부여 대상(operatorActive만)이 급여·잔여휴가 화면의 직원 모집단과 불일치
- **위치**: `netlify/functions/cron-att-leave-auto.ts:104`
- **설명**: 매월 연차 자동부여 크론은 operatorActive=true인 직원만 대상으로 하는데, 급여 집계와 잔여휴가·직원목록 화면은 'operatorActive 또는 role이 운영진(super_admin/admin/operator)'을 대상으로 한다. role만 운영진이고 operatorActive가 꺼진 직원은 급여는 받지만 연차 자동부여·소진 알림에서 조용히 빠진다.
- **근거**: cron-att-leave-auto.ts:95-107 operatorActive=true만. 대조: admin-att-leave-balances.ts:45-48·admin-att-members.ts:55-58(operatorActive OR role IN 운영진), payroll-calc.ts:124-131(type='admin' OR operator_active).
- **권장조치**: 크론의 대상 필터를 잔여휴가 화면과 동일 기준으로 통일.

### #130 [버그] KST 새벽 0~9시에 본인 상태 API의 '이번달 요약'·'잔여 연차'가 전월/전년 기준으로 조회됨
- **위치**: `netlify/functions/att-my-status.ts:31`
- **설명**: 서버가 UTC로 돌아 매월 1일 0시~9시(KST) 사이에는 '이번달'이 전월로 계산된다. 이 시간대에 본인 상태 API를 쓰는 화면·연동(월 요약, 잔여 연차 — 1월 1일 새벽엔 작년 연차)이 어긋난 값을 보여준다. 근태 메인 화면 요약은 브라우저가 연·월을 직접 넘겨 대체로 정상이지만, 서버 기본값을 쓰는 경로(내 상태·내 휴가 잔여·통계 기본값·CSV 내보내기 기본값)가 어긋난다.
- **근거**: `const now = new Date(); const year = now.getFullYear(); const month = now.getMonth()+1`(31-33행) — 같은 파일의 today는 todayKST()(+9h 보정)인데 연·월은 미보정. 동일 패턴: att-my-leaves.ts 28행, att-my-stats.ts 27-29행 기본값, att-export.ts 58-59행 기본값.
- **권장조치**: lib/att-utils.ts의 nowKST()를 사용해 연·월 산출로 통일.

### #131 [버그] 근태 페이지가 git 이력상 존재한 적 없는 공통 스크립트(workspace-common.js)를 로드 — 매 접속 404
- **위치**: `public/workspace-attendance.html:507`
- **설명**: 근태관리 페이지가 '/js/workspace-common.js'를 불러오지만 이 파일은 저장소 생성 이래 존재한 적이 없다(다른 워크스페이스 페이지들은 '/js/common.js'를 사용). 매 접속마다 404 요청이 나가고, 캐시버스터(?v=20260707-footer)만 실제 common.js와 나란히 갱신돼 '공통 스크립트가 로드되는 중'이라는 관리 착시를 일으킨다. 다른 워크스페이스 페이지가 공통으로 갖는 기능(알림 벨 등)도 이 페이지엔 없다.
- **근거**: `<script src="/js/workspace-common.js?v=20260707-footer">`(507행). Glob·find로 파일 부재, `git log --all -- public/js/workspace-common.js` 0건(생성 이력 없음), 참조는 이 페이지 1곳뿐. 페이지 생성 커밋(8b7d462a)부터 존재. 비교: workspace.html 631행은 /js/common.js?v=20260707-footer.
- **권장조치**: 공통 기능이 불필요하면 태그 삭제, 필요하면 /js/common.js로 교체 후 충돌(중복 헬퍼) 확인.

### #132 [보안] 근태 CSV 내보내기가 근태현황 권한(att_manage)과 무관하게 관리자형 계정이면 타 직원 것도 허용
- **위치**: `netlify/functions/att-export.ts:77`
- **설명**: 근태 월별 CSV 내보내기는 '본인이 아니면 슈퍼어드민 또는 관리자형 계정(type=admin)'이라는 느슨한 검사만 한다. 근태 현황 화면·조회 API는 att_manage 권한 토글로 통제되는데, 이 내보내기는 그 토글을 안 보므로 근태현황 권한이 꺼진 직원 역할(role=operator) 관리자형 계정도 동료의 한 달 출퇴근 시각·상태·메모를 CSV로 통째로 받을 수 있다. 서버 권한 게이트(권한 카탈로그 3곳 동일 키 원칙)와 어긋나는 우회로.
- **근거**: att-export.ts:74-87 — `if (targetMemberId !== auth.ctx.member.id) { isSuper(role==='super_admin') || isAdmin(type==='admin') 아니면 403 }`. role='operator'인 type='admin' 계정은 통과. 대조: admin-att-records.ts:26 동일 데이터 조회에 canAccess(role,'att_manage') 게이트. 직원 역할 존재 근거: admin-att-members.ts:57 role IN ('super_admin','admin','operator'), role-permission-check.ts:35.
- **권장조치**: 타인 데이터 export 분기에서 isAdmin(type) 검사 대신 canAccess(role,'att_manage')로 교체해 근태현황 조회와 동일 기준 적용.

### #133 [에러처리] 정정 신청이 유형별 필수 시각 없이 접수 가능 — 빈 신청을 승인하면 기존 출근 기록이 지워지고 '결근' 재산정
- **위치**: `netlify/functions/att-correction-request.ts:52`
- **설명**: '출근 시각 정정' 유형인데 정정할 시각 값이 비어 있어도 서버가 신청을 접수한다(화면은 막지만 API 직접 호출이나 클라이언트 오류 시 통과). 관리자가 이런 빈 신청을 결재 화면에서 승인하면, 승인 로직이 '요청값=없음'을 그대로 반영해 그날의 기존 출근 시각·세션이 삭제되고 상태가 '결근'으로 재산정될 수 있다.
- **근거**: POST 검증은 targetDate·correctionType·reason만(52-60행) — 유형별 requestedCheckIn/Out 필수 검증 없음. 승인 측 admin-att-correction-review.ts 128행 `wantCI ? correction.requestedCheckIn : ...`이 null을 그대로 채택 → rebuildSingleSession(null)=[](lib/att-session.ts 116행) → upsert가 check_in_time=null·determineStatus(null,...)='ABSENT'(184-206행·att-utils.ts 214행).
- **권장조치**: 신청 접수 시 CHECK_IN→requestedCheckIn, CHECK_OUT→requestedCheckOut, BOTH→둘 다 필수 검증(400). 승인 측에도 동일 가드.


## P3 · 근태(관리자)·급여 (14)

### #112 [개선] 실시간 현황에서 승인 휴가 중인 직원이 '미출근'으로 표시
- **위치**: `public/js/admin-workspace-management.js:1800`
- **설명**: 실시간 출퇴근 현황은 출근 도장 유무로만 근무 중/퇴근/미출근을 나누므로, 승인 휴가로 정당하게 쉬는 직원이 무단 미출근과 같은 빨간 '미출근' 배지로 표시된다. 관리자가 매일 아침 오해할 수 있는 표시.
- **근거**: admin-workspace-management.js:1789-1806 checkInTime 유무로만 분류 — status==='LEAVE' 행(승인 시 스탬프, 출근시각 없음)은 미출근으로 귀속. 서버는 records에 status 포함해 반환(admin-att-records.ts:145-151).
- **권장조치**: status==='LEAVE'/'HOLIDAY' 행은 '휴가' 배지로 별도 분류.

### #113 [개선] 거점 관리: 비활성 상태가 목록에 안 보이고 토글도 없으며 삭제는 하드 삭제
- **위치**: `netlify/functions/admin-att-workplaces.ts:112`
- **설명**: 거점 목록은 비활성 포함으로 조회하지만 활성/비활성 컬럼이 없어 구분이 안 되고, 수정 폼에도 활성 토글·유형(OFFICE/FIELD) 필드가 없다. 삭제 버튼은 행을 완전히 지우며 과거 출퇴근 기록·스케줄의 거점 연결이 NULL로 풀려(온삭제 set null) 이력에서 어느 거점에서 찍었는지 소실된다. API에는 isActive가 이미 있으므로 화면만 붙이면 되는 상태.
- **근거**: DELETE 하드 삭제: admin-att-workplaces.ts:106-117. FK set null: db/schema.ts:3687·3703·3727. 프론트: admin-workspace-management.js:498-519 목록에 isActive 컬럼 없음, :633-651 저장 body에 isActive/type(수정 시) 없음 — 서버 PUT은 isActive 지원(admin-att-workplaces.ts:93).
- **권장조치**: 목록에 활성 배지 + 토글 버튼 추가, 삭제 버튼은 사용 이력(att_records/att_schedules 참조) 있으면 비활성화 전환으로 대체.

### #114 [개선] 수동 편집으로 지급액을 바꿔도 4대보험·소득세가 자동 재계산되지 않음 — 실수령 왜곡 위험
- **위치**: `netlify/functions/admin-payroll.ts:222`
- **설명**: 자동 집계는 세전총액에 요율을 곱해 4대보험·소득세를 산출하지만, 상세 모달에서 관리자가 명절 상여 등 조정 라인으로 세전을 크게 올려도 공제 항목들은 기존 절대값 그대로 남는다. '공제 재계산' 보조 버튼이 없어 관리자가 요율 계산을 손으로 다시 해서 7개 공제칸에 입력해야 하며, 잊으면 공제 과소·실수령 과대인 채 승인·발송될 수 있다. 편집 화면 자체는 잘 동작하므로 기능 결함이 아닌 편의 공백이다.
- **근거**: PATCH는 입력된 공제 절대값 합산만 수행(admin-payroll.ts:222-224), 자동 산출 함수 computeDeductions(payroll-calc.ts:49-57)는 재집계 경로에서만 호출. 모달 미리보기도 공제는 입력값 합산뿐(admin-payroll.js:342-343).
- **권장조치**: 모달에 '세전 기준 공제 자동계산' 버튼 추가 — 현재 미리보기 세전총액에 payroll_settings 요율을 적용해 공제 7칸을 채워주고 관리자가 확인 후 저장.

### #115 [개선] 급여 요율(4대보험·소득세) 변경 이력이 남지 않음 — 마지막 수정자·시각만 단일행에 덮어써짐
- **위치**: `netlify/functions/admin-payroll-settings.ts:51`
- **설명**: 급여 계산 기준(국민연금·건강보험 요율 등)은 급여 전체 금액에 영향을 주는 설정인데, 변경할 때 '누가 언제 어떤 값에서 어떤 값으로 바꿨는지' 이력이 전혀 남지 않는다. 단일 설정 행에 마지막 수정자와 시각만 덮어써지므로, 나중에 특정 달 급여의 공제가 왜 그 요율로 계산됐는지 소급 확인하려면 명세서별 계산 스냅샷을 일일이 열어봐야 한다. 명세서 금액 수정에는 상세한 수정 이력(payroll_audit)이 있는 것과 대조적이다.
- **근거**: PUT은 UPDATE payroll_settings SET updated_at=NOW(), updated_by=... 단일행 갱신뿐(admin-payroll-settings.ts:51-63) — 변경 전/후 값 기록·lib/audit 로그 호출 없음. 슬립 단위 이력만 존재(admin-payroll.ts:261-269 payrollAudit).
- **권장조치**: PUT 성공 시 변경된 컬럼별 old→new를 payroll_audit(slip_id 없이) 또는 공용 감사로그(lib/audit)에 기록.

### #116 [데이터정합] 정정요청 승인으로 새로 만들어진 출퇴근 기록에 근무형태가 비어 저장됨
- **위치**: `netlify/functions/admin-att-correction-review.ts:184`
- **설명**: 기록이 없던 날짜의 정정요청을 승인하면 새 출퇴근 행이 생성되는데 근무형태(work_mode)를 넣지 않아 현황 표에 '—'로 표시되고 사무실/재택 집계 카드에서도 빠진다.
- **근거**: admin-att-correction-review.ts:184-206 insert values/set에 workMode 없음(신규 행 work_mode NULL). 표시: admin-att-records.ts:167-178 work_mode IS NOT NULL만 집계, 프론트 MODE_LABEL '—'.
- **권장조치**: 신규 생성 시 getScheduledWorkMode(memberUid, targetDate)로 그 날짜의 예정 근무형태를 채움.

### #117 [데이터정합] 야근수당이 남아있는 과거(2026-06-03 이전) 명세서를 편집하면 화면 미리보기와 저장되는 세전총액이 다름
- **위치**: `netlify/functions/admin-payroll.ts:220`
- **설명**: 2026-06-03 야근 미운영 전환 후 편집 화면의 실시간 미리보기는 '기본급+보너스+조정'만 합산하고 야근수당·무급차감 입력칸도 없앴다. 그러나 서버의 저장 공식은 여전히 야근수당을 더하고 무급차감을 빼며, 화면이 보내지 않은 두 값은 DB의 기존 값을 그대로 쓴다. 전환 이후 생성·재집계된 명세서는 두 값이 모두 0이라 문제없지만, 전환 이전(5월분 등)에 야근수당이 계산돼 저장된 명세서를 지금 수정하면 관리자가 미리보기로 확인한 금액과 실제 저장·발송되는 세전총액이 야근수당만큼 어긋난다.
- **근거**: 서버: grossPay = baseSalaryMonth + overtimePay - deductionUnpaid + ...(admin-payroll.ts:220-221), 미전송 필드는 DB 현재값 사용(:203). 프론트: gross = base + perf + perfect + adj '// 야근·무급차감 제외'(admin-payroll.js:340), PAY_FIELDS에 overtimePay·deductionUnpaid 없음(:269-273). 신규 계산은 항상 0 저장(payroll-calc.ts:218-219) — 과거분만 조건부 발현.
- **권장조치**: 서버 편집 공식에서도 야근수당·무급차감을 제외(0 고정)하거나, 두 값이 0이 아닌 슬립 편집 시 잔존 야근수당을 화면에 표시해 미리보기에 포함.

### #118 [버그] 월별 기록 요약의 '휴가 N일'이 주말 포함 달력일로 세어져 실제 차감일과 불일치
- **위치**: `public/js/admin-workspace-management.js:1427`
- **설명**: 출퇴근 기록(월) 탭 상단 요약이 휴가 신청의 시작~종료 사이 모든 날짜(주말·공휴일 포함)를 휴가일로 센다. 금~월 휴가(실제 차감 2일)가 요약에는 '휴가 4일'로 표시돼 잔여 차감·급여 유급일과 숫자가 안 맞는다.
- **근거**: admin-workspace-management.js:1360-1369 start~end 전 일자에 휴가 매핑 + :1423-1428 ln.leaves.length면 leaveDays++. 실제 차감은 영업일만(att-leave-request.ts:96-119, admin-att-leave-review.ts:174-184).
- **권장조치**: 요약 집계 시 주말(dayName 토/일)과 공휴일을 제외하거나 '휴가 표시일'로 라벨 명확화.

### #119 [버그] CSV 회계자료의 승인일·발송일·지급일이 UTC 날짜로 기록 — 한국시간 자정~오전 9시 처리 건은 전날로 밀림
- **위치**: `netlify/functions/admin-payroll-export.ts:93`
- **설명**: 회계 시스템용 CSV 내려받기에서 승인일·발송일·지급일이 세계표준시 기준 날짜로 잘려 나간다. 예컨대 7월 1일 오전 8시(한국시간)에 지급 확정한 건은 CSV에 6월 30일로 찍힌다. 급여 크론이 한국시간 새벽 2시에 돌고 관리자 승인이 오전에 몰리는 운영 패턴상 실제로 발생 가능한 어긋남으로, 회계 장부의 월 귀속이 틀어질 수 있다.
- **근거**: r.approvedAt/sentAt/paidAt을 new Date(...).toISOString().slice(0, 10)으로 출력(admin-payroll-export.ts:93-95) — toISOString은 UTC 기준이라 KST 00:00~08:59 이벤트는 전날 날짜.
- **권장조치**: KST 변환 후 날짜 추출: new Date(ts.getTime() + 9*3600*1000).toISOString().slice(0,10) 또는 toLocaleDateString('sv-KR계열', {timeZone:'Asia/Seoul'}) 패턴 사용.

### #120 [버그] 보류 사유 입력창에서 '취소'를 눌러도 보류가 그대로 실행되고 기존 검토 메모가 빈 값으로 덮어써짐
- **위치**: `public/js/admin-payroll.js:537`
- **설명**: 보류 버튼을 누르면 사유 입력창(prompt)이 뜨는데, 여기서 취소를 눌러 작업을 중단하려 해도 보류가 그대로 진행된다. 게다가 취소·빈 입력 모두 빈 문자열로 서버에 전달돼, 이전에 적어둔 검토 메모(예: 앞선 보류 사유나 검토 코멘트)가 빈 값으로 지워진다. 실수로 보류 버튼을 누른 관리자가 빠져나갈 방법이 없고 기록까지 유실된다.
- **근거**: const note = prompt('보류 사유 (선택):') || '';(admin-payroll.js:537) — 취소 시 null→'' 로 계속 진행. 서버는 typeof body.reviewNote === 'string'이면 무조건 덮어씀(admin-payroll.ts:302).
- **권장조치**: prompt 반환이 null이면 return으로 작업 취소, 빈 문자열이면 reviewNote를 body에서 제외해 기존 메모 보존.

### #121 [버그] 명세서 목록 '직책' 컬럼의 예비 표시값(memberRole)을 서버가 내려주지 않아, 마일스톤 직책이 없는 직원은 항상 '-' 표시
- **위치**: `public/js/admin-payroll.js:144`
- **설명**: 명세서 목록의 직책 칸은 '마일스톤 직책이 있으면 그것, 없으면 계정 역할(관리자/운영자)'을 보여주도록 짜여 있지만, 목록 API가 계정 역할 필드를 응답에 포함하지 않아 두 번째 예비값이 항상 비어 있다. 마일스톤 직책을 설정하지 않은 직원은 역할이 있어도 '-'로 표시된다. 데이터는 이미 서버가 회원 조회에서 갖고 있는데 응답에 싣지 않는 단순 누락이다.
- **근거**: 프론트: r.memberMilestoneRole || r.memberRole || '-'(admin-payroll.js:144). 서버 enriched는 memberName·memberEmail·memberMilestoneRole만 부가(admin-payroll.ts:153-158) — memberMap에는 role이 조회돼 있으나(:143-146) 응답에 미포함.
- **권장조치**: enriched에 memberRole: memberMap.get(...)?.role ?? null 한 줄 추가.

### #122 [보안] 근태 설정 변경(정책·스케줄·근무지·휴가종류·공휴일 등)이 감사 로그에 전혀 남지 않음
- **위치**: `netlify/functions/admin-att-policy.ts:25`
- **설명**: 워크스페이스 쪽(파일·일정·메모·작업)은 생성·수정·삭제마다 감사 로그(logAudit)를 남기는데, 근태 관리 17개 함수 중 감사 기록이 있는 것은 '출퇴근 기록 강제 수정/삭제'(전용 이력 테이블+audit)와 '연차 잔액 조정'(전용 이력 테이블)뿐이다. 출퇴근 표준시각·지각 기준 같은 근무 정책, 연차 자동부여 정책, 근무 스케줄, 거점(GPS 반경), 휴가 종류, 공휴일의 변경은 누가 언제 무엇을 바꿨는지 아무 기록이 없다. 급여·지각 판정에 직결되는 설정이라 분쟁 시 소명 불가.
- **근거**: grep 결과 admin-att-*.ts 17개 중 logAudit/logAdminAction 사용은 admin-att-record-edit.ts 1개뿐(삭제 시 logAdminAction, 수정 시 att_record_admin_edits 이력). admin-att-policy·leave-policy·schedules·schedule-override·workplaces·work-mode·leave-types·holidays 모두 updatedBy 컬럼·이력 기록 없음(grep 'updatedBy|history' 무일치, admin-att-work-mode.ts:98만 도메인 줄 종료 처리). 대조: admin-workspace-memos.ts:179·284·325, admin-workspace-events.ts:312 등 logAudit 일관 사용.
- **권장조치**: 설정 변경 함수 8곳의 쓰기 경로에 logAdminAction(audit_logs) 1줄씩 추가 — 변경 전/후 값 detail 포함. 결재 3종(휴가·정정·근무형태 승인/반려)도 함께 추가 권장.

### #123 [성능비용] 재택보고서 목록이 이름 매핑을 위해 전체 회원 테이블을 통째로 조회
- **위치**: `netlify/functions/admin-att-remote-reports.ts:132`
- **설명**: 재택보고서 목록을 열 때마다 보고서 작성자 이름을 붙이려고 회원 테이블 전체(후원자 포함 수천 명 가능)를 SELECT한다. 근태 대상은 운영진 몇 명뿐이라 불필요한 DB 부하·응답 지연 요인.
- **근거**: admin-att-remote-reports.ts:129-137 db.select({id,name}).from(members) — WHERE 없음. 같은 도메인 다른 API는 inArray로 필요한 id만 조회(admin-att-correction-review.ts:53-59).
- **권장조치**: 보고서 rows의 memberUid를 dedup해 inArray(members.id, ids)로 축소.

### #124 [에러처리] 일괄 발송 실패 시 '누가·왜 실패했는지'를 화면에서 볼 수 없음 — 발송 이력 테이블은 쌓이기만 하고 조회 화면 없음
- **위치**: `public/js/admin-payroll.js:257`
- **설명**: 명세서 일괄 발송 후 화면에는 '성공 N · 실패 M' 건수 토스트만 잠깐 뜨고 사라진다. 서버는 실패한 명세서별 사유(이메일 미등록, 발송 서비스 오류 등)를 응답에 담아 주지만 화면이 이를 버리고, 발송 이력 테이블(payroll_send_history)도 기록만 될 뿐 이를 읽는 API·화면이 하나도 없다. 관리자는 목록에서 여전히 '승인' 상태로 남은 행을 보고 실패자를 추정할 수는 있으나, 이메일이 없어서인지 일시적 오류인지 원인을 알 수 없어 조치가 늦어진다.
- **근거**: sendAll은 d.sent/d.failed만 토스트(admin-payroll.js:256-257), 서버가 반환하는 details[{slipId, status, error}](admin-payroll-send.ts:219-224) 미사용. 저장소 grep 결과 payroll_send_history는 admin-payroll-send.ts의 INSERT 4곳(:148·183·195·206)뿐, SELECT하는 함수·화면 0건.
- **권장조치**: 발송 완료 후 실패 목록(이름·사유)을 모달이나 표로 표시하고, 상세 모달에 해당 명세서의 발송 이력(payroll_send_history) 섹션 추가.

### #125 [운영자립] 어드민 기록수정·잔여조정 이력이 쌓이기만 하고 볼 수 있는 화면이 없음
- **위치**: `netlify/functions/admin-att-record-edit.ts:201`
- **설명**: 출퇴근 기록 직접수정과 잔여 휴가 조정은 '사유 필수 — 감사 추적용'으로 이력 테이블에 적재되고 토스트도 '이력 적재 완료'라고 안내하지만, 그 이력을 조회하는 API·화면이 하나도 없다. 분쟁 시(누가 언제 왜 고쳤나) 운영자가 확인할 방법이 없어 감사 추적 목적이 실현되지 않는다.
- **근거**: INSERT만 존재: admin-att-record-edit.ts:201-215·:299-308, admin-att-leave-balances.ts:193-204. 전체 grep에서 att_record_admin_edits/att_leave_balance_adjustments SELECT 0건(schema 정의 제외). 토스트: admin-workspace-management.js:1652.
- **권장조치**: 출퇴근 기록 수정 모달 하단에 해당 기록의 수정 이력 목록(GET) 추가, 잔여휴가 상세에 조정 이력 표시.

