# 라운드 9 — WBS 고급 기능 + 채팅 개선 + 폼 응답 관리

> **작성**: 2026-05-18 / 메인 채팅
> **추정**: 메인 설계 1h / B 백 4h / A 프론트 3h / C 검증 2h / 합계 10h
> **모드**: 평행 (A는 mock으로 시작, DB 마이그 필요 — B 1차 push 후 마이그 → A 시작)

---

## §0 요구사항 확정

| 항목 | 결정 |
|---|---|
| 서브태스크 계층 | 1단계 (부모-자식, 손자 이하 불허) |
| 채팅 수정 제한 | 발송 후 5분 이내만 수정 가능 |
| 채팅 삭제 | Soft delete — isDeleted=true, 화면에 "삭제된 메시지입니다" 표시 |
| 반복 작업 | 원본 작업에서 "반복 생성" → 별도 task, recurringParentId로 연결 |
| 체크리스트 | checklistItems JSONB 배열 직접 교체 방식 |
| 폼 응답 삭제 | 관리자만 (사용자 직접 삭제 불가) |

---

## §1 DB 설계

### 1.1 신규 테이블
없음

### 1.2 기존 테이블 컬럼 추가

| 테이블 | 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|---|
| chatMessages | editedAt | timestamp | NULL | 수정 시각 |
| chatMessages | isDeleted | boolean | NOT NULL DEFAULT false | 소프트 삭제 |
| chatMessages | deletedAt | timestamp | NULL | 삭제 시각 |

### 1.3 마이그레이션 SQL

```sql
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamp;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamp;
```

마이그레이션 함수 파일명: `migrate-chat-edit.ts`

### 1.4 schema.ts 추가 (마이그 후 활성화)

```typescript
// chatMessages 테이블에 추가 (마이그 후 주석 해제)
editedAt:  timestamp("edited_at"),
isDeleted: boolean("is_deleted").notNull().default(false),
deletedAt: timestamp("deleted_at"),
```

---

## §2 API 명세

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `admin-workspace-subtask-create.ts` | `/api/admin-workspace-subtask-create` | POST | requireAdmin | 서브태스크 생성 |
| `admin-workspace-subtasks.ts` | `/api/admin-workspace-subtasks` | GET | requireAdmin | 서브태스크 목록 조회 |
| `admin-workspace-task-checklist.ts` | `/api/admin-workspace-task-checklist` | PATCH | requireAdmin | 체크리스트 업데이트 |
| `admin-workspace-task-recurring.ts` | `/api/admin-workspace-task-recurring` | POST | requireAdmin | 반복 작업 생성 |
| `admin-workspace-task-reminder.ts` | `/api/admin-workspace-task-reminder` | PATCH | requireAdmin | 리마인더 설정 |
| `chat-message-update.ts` | `/api/chat-message-update` | PATCH | requireActiveUser | 채팅 메시지 수정 (5분 제한) |
| `chat-message-delete.ts` | `/api/chat-message-delete` | DELETE | requireActiveUser | 채팅 메시지 삭제 (soft) |
| `chat-search.ts` | `/api/chat-search` | GET | requireActiveUser | 채팅 메시지 검색 |
| `admin-form-submission-delete.ts` | `/api/admin-form-submission-delete` | DELETE | requireAdmin | 폼 응답 삭제 |

### 2.2 함수별 상세

#### `admin-workspace-subtask-create` (POST)

**요청**:
```json
{
  "parentTaskId": 10,
  "title": "서브태스크 제목",
  "description": "설명",
  "assignedTo": 5,
  "dueDate": "2026-06-01T00:00:00Z",
  "priority": "normal"
}
```

**응답 (성공)**:
```json
{ "ok": true, "id": 101, "task": { "id": 101, "parentTaskId": 10, "title": "서브태스크 제목", "status": "todo" } }
```

**처리 단계**:
1. `auth` — requireAdmin
2. `validate` — parentTaskId, title 필수
3. `check_parent` — workspaceTasks WHERE id = parentTaskId 조회. parentTaskId가 이미 자식이면 403 "1단계 서브태스크만 허용됩니다."
4. `insert` — workspaceTasks INSERT (parentTaskId 포함)
5. `map`

---

#### `admin-workspace-subtasks` (GET)

**요청**: `?parentId=10`

**응답**:
```json
{
  "ok": true,
  "subtasks": [
    { "id": 101, "title": "서브태스크1", "status": "todo", "assignedTo": 5, "dueDate": "2026-06-01", "progress": 0 }
  ]
}
```

---

#### `admin-workspace-task-checklist` (PATCH)

**요청**:
```json
{
  "taskId": 10,
  "items": [
    { "id": "ck1", "text": "항목1", "done": true },
    { "id": "ck2", "text": "항목2", "done": false }
  ]
}
```

**응답**:
```json
{ "ok": true, "taskId": 10, "items": [...] }
```

**처리 단계**:
1. `auth` → `validate` (taskId, items 배열)
2. `update` — workspaceTasks SET checklistItems = $items WHERE id = taskId
3. `map`

---

#### `admin-workspace-task-recurring` (POST)

**요청**:
```json
{
  "parentTaskId": 10,
  "title": "반복 작업 제목",
  "dueDate": "2026-07-01T00:00:00Z"
}
```

**응답**:
```json
{ "ok": true, "id": 202, "recurringParentId": 10 }
```

---

#### `admin-workspace-task-reminder` (PATCH)

**요청**:
```json
{
  "taskId": 10,
  "reminderConfig": { "enabled": true, "minutesBefore": 60, "channels": ["inapp", "email"] }
}
```

**응답**:
```json
{ "ok": true, "taskId": 10 }
```

---

#### `chat-message-update` (PATCH)

**권한**: requireActiveUser

**요청**:
```json
{ "messageId": 55, "content": "수정된 메시지" }
```

**응답 (성공)**:
```json
{ "ok": true, "messageId": 55, "editedAt": "2026-05-18T10:05:00Z" }
```

**응답 (5분 초과)**:
```json
{ "ok": false, "error": "5분이 지난 메시지는 수정할 수 없습니다.", "step": "check_time" }
```

**처리 단계**:
1. `auth` — requireActiveUser
2. `validate` — messageId, content 필수
3. `select_message` — chatMessages WHERE id = messageId AND senderId = auth.uid
4. `check_time` — createdAt + 5분 < now() → 403
5. `check_deleted` — isDeleted = true → 403 "삭제된 메시지입니다."
6. `update` — content, editedAt = now()
7. `map`

---

#### `chat-message-delete` (DELETE)

**권한**: requireActiveUser

**요청**:
```json
{ "messageId": 55 }
```

**응답**:
```json
{ "ok": true }
```

**처리 단계**:
1. `auth` → `validate` → `select_message` (senderId = auth.uid 검증)
2. `update` — isDeleted = true, deletedAt = now(), content = null
3. `map`

---

#### `chat-search` (GET)

**요청**: `?roomId=3&q=검색어&limit=20`

**응답**:
```json
{
  "ok": true,
  "messages": [
    { "id": 55, "content": "검색어 포함 메시지", "senderRole": "user", "createdAt": "2026-05-18T10:00:00Z" }
  ]
}
```

---

#### `admin-form-submission-delete` (DELETE)

**요청**:
```json
{ "submissionId": 99 }
```

**응답**:
```json
{ "ok": true }
```

---

## §3 화면 명세

### 3.1 페이지 목록

| 페이지/JS | 수정 내용 |
|---|---|
| `workspace-kanban.html` / `workspace-kanban.js` | 카드 상세 모달에 서브태스크 섹션 추가 |
| `workspace.js` | 작업 상세에 체크리스트 토글·추가·삭제 UI |
| `workspace.js` | 반복 작업 생성 버튼 추가 |
| `workspace.js` | 리마인더 설정 패널 추가 |
| `chat-user.js` | 본인 메시지에 수정/삭제 버튼 (5분 이내 active) |
| `admin-form-submissions.html` | 응답 행에 삭제 버튼 추가 |

### 3.2 서브태스크 UI (카드 상세 모달 내)

```
┌─ 서브태스크 ─────────────────────────────┐
│  ○ 서브태스크1  [완료] [삭제]            │
│  ○ 서브태스크2  [진행중] [삭제]          │
│  [+ 서브태스크 추가]                     │
└──────────────────────────────────────────┘
```

### 3.3 체크리스트 UI (카드 상세 모달 내)

```
┌─ 체크리스트 ─────────────────────────────┐
│  ☑ 항목1                                 │
│  ☐ 항목2                                 │
│  [+ 항목 추가]                           │
└──────────────────────────────────────────┘
```

### 3.4 채팅 메시지 수정/삭제 UI

```
[내 메시지 버블] ··· [수정] [삭제]   (5분 이내만 active)
[삭제된 메시지입니다]                (삭제 후 자리표시자)
[수정됨] 아이콘 표시                 (수정된 메시지)
```

### 3.5 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 응답 처리 |
|---|---|---|
| 카드 상세에서 "서브태스크 추가" 클릭 | `/api/admin-workspace-subtask-create` | 서브태스크 목록 갱신 |
| 체크리스트 항목 체크/추가/삭제 | `/api/admin-workspace-task-checklist` | 체크리스트 UI 즉시 갱신 |
| 작업 카드에서 "반복 생성" 클릭 | `/api/admin-workspace-task-recurring` | 새 작업 목록에 추가 |
| 리마인더 설정 저장 | `/api/admin-workspace-task-reminder` | 저장 완료 토스트 |
| 채팅 "수정" 클릭 → 내용 변경 후 전송 | `/api/chat-message-update` | 메시지 내용 + "수정됨" 표시 |
| 채팅 "삭제" 클릭 | `/api/chat-message-delete` | "삭제된 메시지입니다" 표시 |
| 폼 응답 "삭제" 클릭 | `/api/admin-form-submission-delete` | 행 제거 |

### 3.6 토스트 문구

| 상황 | 문구 |
|---|---|
| 서브태스크 생성 | "서브태스크가 추가되었습니다." |
| 체크리스트 저장 | "체크리스트가 저장되었습니다." |
| 반복 작업 생성 | "반복 작업이 생성되었습니다." |
| 채팅 수정 성공 | "메시지가 수정되었습니다." |
| 채팅 5분 초과 | "5분이 지난 메시지는 수정할 수 없습니다." |
| 채팅 삭제 | "메시지가 삭제되었습니다." |
| 폼 응답 삭제 | "응답이 삭제되었습니다." |

### 3.7 캐시버스터

- `workspace.js?v=N+1`
- `workspace-kanban.js?v=N+1`
- `chat-user.js?v=N+1`

---

## §4 검증 시나리오

| # | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | 워크스페이스 카드 상세에서 "서브태스크 추가" → 제목 입력 → 저장 | 서브태스크 목록에 새 항목 표시 |
| Q2 | 서브태스크 자체에서 "서브태스크 추가" 시도 | "1단계 서브태스크만 허용됩니다." 오류 |
| Q3 | 체크리스트 항목 추가 → 체크 → 저장 | 체크 상태 DB에 저장, 새로고침 후에도 유지 |
| Q4 | 작업 카드에서 "반복 생성" → 새 마감일 입력 | 새 작업이 목록에 추가, recurringParentId 연결됨 |
| Q5 | 리마인더 60분 전 인앱 알림 설정 → 저장 | reminderConfig DB 저장 확인 |
| Q6 | 채팅 메시지 전송 후 3분 내 수정 | 수정 성공, "수정됨" 아이콘 표시 |
| Q7 | 채팅 메시지 전송 후 6분 경과 후 수정 시도 | "5분이 지난 메시지는 수정할 수 없습니다." |
| Q8 | 채팅 메시지 삭제 | "삭제된 메시지입니다" 자리표시자 표시 |
| Q9 | 폼 응답 관리자 화면에서 특정 응답 삭제 | 해당 행 제거 |
| Q10 | 기존 워크스페이스 카드 CRUD 회귀 없음 | 기존 작업 생성/수정/삭제 정상 |

---

## §5 mock 데이터 (A용)

```javascript
// MOCK: 서브태스크 목록
const MOCK_SUBTASKS = {
  ok: true,
  subtasks: [
    { id: 101, title: "서브태스크1", status: "todo", assignedTo: null, dueDate: "2026-06-01", progress: 0 },
    { id: 102, title: "서브태스크2", status: "in_progress", assignedTo: 5, dueDate: "2026-06-15", progress: 50 }
  ]
};

// MOCK: 서브태스크 생성
const MOCK_SUBTASK_CREATE = { ok: true, id: 103, task: { id: 103, parentTaskId: 10, title: "새 서브태스크", status: "todo" } };

// MOCK: 체크리스트 업데이트
const MOCK_CHECKLIST = { ok: true, taskId: 10, items: [{ id: "ck1", text: "항목1", done: true }] };

// MOCK: 반복 작업
const MOCK_RECURRING = { ok: true, id: 202, recurringParentId: 10 };

// MOCK: 리마인더
const MOCK_REMINDER = { ok: true, taskId: 10 };

// MOCK: 채팅 수정
const MOCK_CHAT_UPDATE = { ok: true, messageId: 55, editedAt: "2026-05-18T10:05:00Z" };

// MOCK: 채팅 삭제
const MOCK_CHAT_DELETE = { ok: true };

// MOCK: 폼 응답 삭제
const MOCK_FORM_DELETE = { ok: true };
```

---

## §6 트리거

### §6.1 B 트리거

```
[B — 라운드 9 백엔드 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/round9-wbs-chat-back (베이스 main @ 라운드8 완료 커밋)
정독: docs/milestones/2026-05-18-round9-wbs-chat.md §1·§2

영역: netlify/functions/, lib/, db/schema.ts, drizzle/
금지: public/, PROJECT_STATE.md, docs/

━━━ 자율주행 정책 — 권한 확인 절대 묻지 말 것 ━━━
  PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "실행해도 되나요" "접속해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
  묻는 건 단 2가지뿐: ① 자기 브랜치 push ② 애매한 설계·로직 결정
  그 외 전부 자율 진행. 막히면 즉시 보고 (30분 이상 헤매지 말 것)

━━━ §1 DB 체크리스트 ━━━
  - [ ] migrate-chat-edit.ts 작성 — chat_messages 3개 컬럼 추가 (IF NOT EXISTS 멱등)
  - [ ] schema.ts chatMessages 정의에 editedAt / isDeleted / deletedAt 추가 (주석 상태)

━━━ §2 API 체크리스트 ━━━
  - [ ] admin-workspace-subtask-create.ts — /api/admin-workspace-subtask-create POST requireAdmin
      check_parent: 부모 task의 parentTaskId IS NOT NULL → 403 "1단계만 허용"
  - [ ] admin-workspace-subtasks.ts — /api/admin-workspace-subtasks GET requireAdmin ?parentId=
  - [ ] admin-workspace-task-checklist.ts — /api/admin-workspace-task-checklist PATCH requireAdmin
      checklistItems JSONB 배열 통째 교체
  - [ ] admin-workspace-task-recurring.ts — /api/admin-workspace-task-recurring POST requireAdmin
      INSERT workspaceTasks WITH recurringParentId = parentTaskId
  - [ ] admin-workspace-task-reminder.ts — /api/admin-workspace-task-reminder PATCH requireAdmin
      reminderConfig JSONB 통째 교체
  - [ ] chat-message-update.ts — /api/chat-message-update PATCH requireActiveUser
      5분 체크: now() - createdAt > 5분 → 403
  - [ ] chat-message-delete.ts — /api/chat-message-delete DELETE requireActiveUser
      soft delete: isDeleted=true, deletedAt=now(), content=null
  - [ ] chat-search.ts — /api/chat-search GET requireActiveUser ?roomId=&q=&limit=
  - [ ] admin-form-submission-delete.ts — /api/admin-form-submission-delete DELETE requireAdmin

━━━ 응답 구조 (키명 임의 변경 금지) ━━━
  subtask-create:  { ok, id, task: { id, parentTaskId, title, status } }
  subtasks GET:    { ok, subtasks: [{ id, title, status, assignedTo, dueDate, progress }] }
  checklist PATCH: { ok, taskId, items: [...] }
  recurring POST:  { ok, id, recurringParentId }
  reminder PATCH:  { ok, taskId }
  chat-update:     { ok, messageId, editedAt }
  chat-delete:     { ok }
  chat-search:     { ok, messages: [{ id, content, senderRole, createdAt }] }
  form-delete:     { ok }

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/round9-wbs-chat-back
  □ export const config = { path } 9개 신규 파일 전부
  □ npx tsc --noEmit 통과
  □ schema.ts chatMessages 수정 컬럼 → 주석 상태 (마이그 전 활성화 금지)
```

### §6.2 A 트리거

```
[A — 라운드 9 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/round9-wbs-chat-front (베이스 main @ 라운드8 완료 커밋)
정독: docs/milestones/2026-05-18-round9-wbs-chat.md §3

━━━ 자율주행 정책 — 권한 확인 절대 묻지 말 것 ━━━
  PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "실행해도 되나요" "접속해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
  묻는 건 단 2가지뿐: ① 자기 브랜치 push ② 애매한 설계·로직 결정
  그 외 전부 자율 진행. 막히면 즉시 보고 (30분 이상 헤매지 말 것)

영역: public/
금지: lib/, netlify/functions/, db/, PROJECT_STATE.md, docs/

━━━ mock 데이터 ━━━
const MOCK_SUBTASKS = { ok:true, subtasks:[{id:101,title:"서브태스크1",status:"todo",assignedTo:null,dueDate:"2026-06-01",progress:0}] };
const MOCK_SUBTASK_CREATE = { ok:true, id:103, task:{id:103,parentTaskId:10,title:"새 서브태스크",status:"todo"} };
const MOCK_CHECKLIST = { ok:true, taskId:10, items:[{id:"ck1",text:"항목1",done:true}] };
const MOCK_RECURRING = { ok:true, id:202, recurringParentId:10 };
const MOCK_REMINDER = { ok:true, taskId:10 };
const MOCK_CHAT_UPDATE = { ok:true, messageId:55, editedAt:"2026-05-18T10:05:00Z" };
const MOCK_CHAT_DELETE = { ok:true };
const MOCK_FORM_DELETE = { ok:true };

━━━ §3 화면 체크리스트 ━━━
  - [ ] workspace-kanban.js: 카드 상세 모달에 "서브태스크" 섹션 추가
      → GET /api/admin-workspace-subtasks?parentId= 로 목록 로드
      → "서브태스크 추가" 버튼 → 제목 입력 → POST create
  - [ ] workspace.js: 작업 상세에 체크리스트 섹션 추가
      → 체크 토글/항목 추가/삭제 → PATCH /api/admin-workspace-task-checklist
  - [ ] workspace.js: 리마인더 설정 UI (enabled 토글 + minutesBefore 입력 + channels 체크박스)
  - [ ] workspace.js: "반복 생성" 버튼 → 마감일 선택 → POST /api/admin-workspace-task-recurring
  - [ ] chat-user.js: 본인 메시지 hover 시 ··· 메뉴 표시 → 수정/삭제 옵션
      수정: 인라인 편집 UI, 5분 이내 active (createdAt 기준 클라이언트 체크)
      삭제: 확인 후 soft delete → "삭제된 메시지입니다" 표시
      isDeleted=true 메시지는 회색 이탤릭체 "삭제된 메시지입니다" 표시
      editedAt 있으면 시각 옆에 "(수정됨)" 표시
  - [ ] admin-form-submissions.html: 응답 행마다 "삭제" 버튼 + 확인 대화상자
  - [ ] 캐시버스터: workspace.js?v=N+1, workspace-kanban.js?v=N+1, chat-user.js?v=N+1
```

### §6.3 C 트리거

```
[C — 라운드 9 검증]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/round9 (베이스 main @ B·A 머지 + 마이그 완료 커밋)
정독: docs/milestones/2026-05-18-round9-wbs-chat.md §4

Q1~Q10 라이브 시나리오 순서대로 검증.
보고서: docs/verify/2026-05-18-round9.md
```

---

## §7 머지 순서

```
1. B push → 메인 main 머지
2. Swain: https://tbfa.co.kr/api/migrate-chat-edit?run=1 호출
3. 메인: schema.ts chatMessages 3컬럼 활성화 + migrate-chat-edit.ts 삭제 → push
4. A push → 메인 main 머지
5. C 검증 → 라운드 9 마감
```
