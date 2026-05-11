# Phase 21 R1 — WBS↔워크툴 연동 기반

> **작성**: 2026-05-12 / 메인 채팅
> **상위 Phase**: Phase 21 워크스페이스 v3 + 서비스 연동 ([카탈로그](2026-05-12-phase21-workspace-v3-catalog.md))
> **추정**: 메인 설계 1h / B 백 1.5h / A 프론트 5h / C 검증 1.5h / 합계 9h
> **모드**: **평행** (B 작업이 작아 A·B 동시 시작 가능. A는 단건 조회 응답에 `activityLog` 키가 없어도 빈 배열 fallback으로 작동하도록 작성)

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블

**없음**. R1은 기존 `workspaceActivityLog` 테이블을 조회만 추가.

### 1.2 기존 테이블 컬럼 추가

**없음**.

### 1.3 마이그레이션 SQL

**없음 — R1은 schema 변경 없음**. B는 마이그레이션 함수를 작성하지 않음.

### 1.4 schema.ts import 점검

- [ ] 변경 없음 — 그대로 유지

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `netlify/functions/admin-workspace-tasks.ts` (수정) | `/api/admin-workspace-tasks` | GET | `requireAdmin` | 단건 조회 시 `activityLog` 키 포함 (R1 핵심) |

### 2.2 함수별 상세

#### `admin-workspace-tasks.ts` 단건 조회 확장

기존 GET 단건 조회(`?id=X`)의 응답에 **activityLog 배열** 추가. 다른 동작은 유지.

**요청** (변경 없음):
```
GET /api/admin-workspace-tasks?id=123
```

**응답 (성공) — 확장**:
```json
{
  "ok": true,
  "data": {
    "id": 123,
    "title": "...",
    "status": "doing",
    "priority": "high",
    "...": "기존 필드 모두 유지",
    "activityLog": [
      {
        "id": 4567,
        "actionType": "task.create",
        "actorId": 7,
        "actorName": "김운영",
        "targetType": "task",
        "targetId": 123,
        "metadata": { "title": "..." },
        "createdAt": "2026-05-12T03:21:00Z"
      },
      {
        "id": 4570,
        "actionType": "task.status",
        "actorId": 7,
        "actorName": "김운영",
        "metadata": { "from": "todo", "to": "doing" },
        "createdAt": "2026-05-12T05:10:00Z"
      }
    ]
  }
}
```

**activityLog 필드**:
- `id`: workspaceActivityLog.id
- `actionType`: workspaceActivityLog.actionType (예: `task.create`, `task.update`, `task.status`, `task.assign`, `task.move`, `task.comment`, `task.attachment`)
- `actorId`, `actorName`: 활동한 사용자 (admin_users 조인)
- `metadata`: workspaceActivityLog.metadata (JSONB 그대로)
- `createdAt`: 활동 시각

**필터링 조건**:
- `target_type = 'task' AND target_id = {요청 taskId}` 만
- 최근 **50건** 제한
- 시간순 **DESC** (최신이 위)

**응답 (실패)**:
```json
{
  "ok": false,
  "error": "...실패",
  "step": "auth | select_task | select_activity | map",
  "detail": "...",
  "stack": "..."
}
```

**처리 단계**:
1. `auth` — `requireAdmin` (반환 필드 `auth.res`)
2. `validate` — `id` 정수 검증
3. `select_task` — `workspaceTasks` 단건 조회
4. `select_activity` — `workspaceActivityLog` 50건 + `admin_users` 이름 매핑 (별도 query + JS Map, leftJoin 체인 금지)
5. `map` — 응답 매핑

**보조 SELECT 실패 시**: `activityLog: []` 빈 배열 fallback (메인 task 데이터로만 응답 — A는 빈 배열일 때 "활동 기록 없음" 표시).

**필수 체크**:
- [ ] `export const config = { path: "/api/admin-workspace-tasks" }` 유지
- [ ] `auth.res` 사용
- [ ] `select_activity` try/catch + 빈 배열 fallback

### 2.3 `lib/` 헬퍼

**없음**. R1은 헬퍼 추가 없음.

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 페이지 | 경로 | 진입점 | 권한 |
|---|---|---|---|
| `public/workspace.html` (수정) | `/workspace.html` | 어드민 사이드바 → 워크스페이스 → 워크툴 | 어드민 |
| `public/workspace-kanban.html` (수정 + 리네이밍) | `/workspace-kanban.html` (URL 유지) | 어드민 사이드바 → 워크스페이스 → WBS | 어드민 |
| `public/workspace-calendar.html` (수정) | `/workspace-calendar.html` | 어드민 사이드바 → 워크스페이스 → 캘린더 | 어드민 |
| `public/workspace-templates.html` (수정) | `/workspace-templates.html` | 어드민 사이드바 → 워크스페이스 → 템플릿 | 어드민 |
| `public/workspace-files.html` (수정) | `/workspace-files.html` | 어드민 사이드바 → 워크스페이스 → 파일함 | 어드민 |

> **URL은 유지** (`workspace-kanban.html`). 표시 텍스트만 "칸반" → "WBS"로 변경. URL을 바꾸면 기존 모든 hash 링크(`#task=ID`)·즐겨찾기·문서가 깨짐.

### 3.2 페이지별 변경 사항

#### `workspace-kanban.html` — 페이지 제목·메뉴 텍스트 리네이밍

```
변경 전:                          변경 후:
┌─ 칸반 ─────────────────┐       ┌─ WBS ──────────────────┐
│ <title>칸반 - ...</title>│       │ <title>WBS - ...</title>│
│ <h1>📋 칸반</h1>          │       │ <h1>📋 WBS</h1>         │
│ 사이드바: 칸반            │       │ 사이드바: WBS           │
└─────────────────────────┘       └─────────────────────────┘
```

#### 워크스페이스 5개 페이지 — 사이드바 통일

**변경 전** (예: workspace.html):
```
워크스페이스 (1뎁스, 토글)
  ├─ 워크툴
  ├─ 칸반
  ├─ 캘린더
  ├─ 템플릿
  └─ 파일함
내 작업       ← 제거
지시함        ← 제거
일정          ← 제거 (있다면)
메모          ← 제거 (있다면)
피드          ← 제거 (있다면)
```

**변경 후** (5개 페이지 모두 동일):
```
워크스페이스 (1뎁스, 토글)
  ├─ 워크툴
  ├─ WBS         ← 칸반 리네이밍
  ├─ 캘린더
  ├─ 템플릿
  └─ 파일함
```

내 작업/지시함/일정/메모/피드는 워크툴 메인 화면 안에서 "+" 또는 "전체 보기" 버튼으로 접근. 1뎁스 메뉴에서 제거.

#### `workspace.html` — 상단 액션 버튼

기존 버튼 유지하되 클릭 핸들러를 **통합 작업 모달**에 연결:
- "새 작업" 버튼 → `openTaskCreateModal({ source: 'worktool' })`
- "새 일정" 버튼 → 일정 작성 모달 (R1 범위 외, 이번엔 동작만 alert 또는 페이지 이동 fallback)
- "메모" 버튼 → 메모 작성 모달 (R1 범위 외, 동일)
- "알림 벨" → R1 범위 외 (R2)

**R1 핵심은 "새 작업" 버튼만 통합 모달 연결**. 나머지는 R2·R4에서.

#### 워크툴 메인 — 작업 카드 클릭

워크툴 메인의 "내 작업" 패널·"지시함" 패널의 작업 카드 클릭 시:
```
location.href = '/workspace-kanban.html#task=' + taskId
```
이미 일부 구현(workspace.js:995-998). 모든 패널에 일관 적용 확인.

#### WBS — URL hash 처리

페이지 로드 시 `location.hash` 검사:
- `#task=123` → `openTaskDetailModal(123)` 자동 호출
- 모달 닫을 때 hash 제거 (`history.replaceState(null, '', '/workspace-kanban.html')`)

### 3.3 신규 JS 모듈 (A 작성)

#### `public/js/workspace-task-modal.js` — 통합 작업 모달

```
[전역 노출]
window.WorkspaceTaskModal = {
  openCreate(opts)    // 새 작업 생성 모달
  openDetail(taskId)  // 작업 상세 모달
  close()
};

[동작]
- 현재 페이지가 WBS면 기존 #wkNewModal·#wkCardModal 마크업 그대로 사용
- 워크툴·캘린더면 동적 inject (마크업을 JS에서 createElement) 또는
  사용자가 클릭한 페이지에서 inject

[핵심] WBS의 modal 마크업·핸들러 로직을 모듈로 추출해서
       다른 페이지에서도 동일 호출 가능하도록 단일 진실원
```

#### `public/js/workspace-sync-channel.js` — BroadcastChannel 동기화

```
[전역 노출]
window.WorkspaceSync = {
  notify(eventName, payload)    // 변경 발신
  on(eventName, handler)        // 변경 수신
};

[채널]
- BroadcastChannel('workspace-tasks')
- 이벤트: 'task:created' | 'task:updated' | 'task:deleted' | 'task:status' | 'task:moved'

[페이지 라이프사이클]
- visibilitychange 이벤트 → 'visible' 시 강제 refetch
- BroadcastChannel.onmessage → 같은 type의 callback 호출
- 페이지가 액션 후 broadcast 발신

[fallback]
- BroadcastChannel 미지원 브라우저 (구형 Safari) → localStorage storage 이벤트로 fallback
```

### 3.4 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 요청 | 응답 처리 | 에러 토스트 |
|---|---|---|---|---|
| 워크툴 작업 카드 클릭 | (네비게이션) | — | `/workspace-kanban.html#task=ID` 이동 | — |
| WBS 페이지 로드 시 hash 감지 | `/api/admin-workspace-tasks?id=X` | — | 카드 상세 모달 오픈, activityLog 타임라인 탭에 표시 | "작업을 찾을 수 없어요" |
| 카드 모달 [타임라인] 탭 선택 | (이미 받음) | — | activityLog 자연어 렌더 | — |
| 워크툴 "새 작업" 버튼 | 모달 → `/api/admin-workspace-tasks` POST | `{title, ...}` | 성공 → 모달 닫기 + BroadcastChannel 발신 → 워크툴·WBS 자동 갱신 | 서버 detail |
| WBS 카드 변경 (드래그·수정) | 기존 API | 기존 | 성공 → BroadcastChannel 발신 | 기존 |
| 다른 탭에서 변경 발생 | (BroadcastChannel 수신) | — | 자동 refetch | — |

### 3.5 타임라인 자연어 매핑 (A 작성)

`workspace-kanban.js` (또는 별도 `workspace-activity-render.js`):

| actionType | metadata | 자연어 |
|---|---|---|
| `task.create` | `{title}` | "{이름}이 이 작업을 만들었어요" |
| `task.update` | `{fields:[]}` | "{이름}이 {필드 한글} 수정했어요" |
| `task.status` | `{from, to}` | "{이름}이 상태를 {from 한글}→{to 한글}로 변경했어요" |
| `task.assign` | `{assigneeName}` | "{이름}이 {assigneeName}에게 할당했어요" |
| `task.move` | `{from, to}` | "{이름}이 {from 컬럼}에서 {to 컬럼}으로 이동했어요" |
| `task.comment` | `{commentId}` | "{이름}이 댓글을 달았어요" |
| `task.attachment` | `{fileName}` | "{이름}이 파일을 첨부했어요" |
| 기타 | — | "{이름}이 작업을 갱신했어요" (fallback) |

시간은 상대 표시 ("5분 전", "어제", "2일 전") + 마우스 hover 시 절대 시각.

### 3.6 토스트·문구 모음

| 상황 | 문구 |
|---|---|
| 카드 생성 성공 | "작업이 추가됐어요" |
| 카드 조회 실패 | "작업을 찾을 수 없어요. 삭제됐을 수 있습니다." |
| 타임라인 비어있음 | "활동 기록이 없어요" (빈 상태 안내) |
| BroadcastChannel 수신 시 토스트 X | — (자동 갱신만, 토스트 없음) |
| 서버 에러 | 서버 `detail` 그대로 노출 |

### 3.7 캐시버스터

다음 JS·CSS 파일 버전 갱신:
- `public/js/workspace-task-modal.js?v=1` (신규)
- `public/js/workspace-sync-channel.js?v=1` (신규)
- `public/js/workspace.js?v=4` (기존 v3 → v4)
- `public/js/workspace-kanban.js?v=4` (기존 → 다음 번호)
- `public/js/workspace-calendar.js?v=2` (기존 v1 → v2)
- 사이드바 정리·리네이밍이 들어간 HTML들 → 별도 버전 불필요 (HTML은 직접 로드)

`workspace.html`·`workspace-kanban.html`·`workspace-calendar.html`·`workspace-templates.html`·`workspace-files.html` 5개에 모두 신규 모듈 2개 `<script>` 추가:

```html
<script src="/js/workspace-sync-channel.js?v=1" defer></script>
<script src="/js/workspace-task-modal.js?v=1" defer></script>
```

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오

| # | 시나리오 (사용자 동작) | 기대 동작 |
|---|---|---|
| Q1 | 어드민 로그인 후 워크스페이스 사이드바 펼침 | 5개 메뉴(워크툴/WBS/캘린더/템플릿/파일함)만 보임. "칸반" 텍스트 없음. "내 작업/지시함/일정/메모" 1뎁스 메뉴 없음 |
| Q2 | WBS 페이지 진입 (사이드바 클릭) | 페이지 제목·헤더에 "WBS" 표시. 기존 칸반 5컬럼·카드 동작 그대로 |
| Q3 | 워크툴 메인 "내 작업" 패널에서 작업 카드 클릭 | WBS 페이지로 이동 + 해당 카드 상세 모달이 자동으로 열림 |
| Q4 | 카드 상세 모달의 [타임라인] 탭 클릭 | 활동 기록이 시간순으로 자연어로 표시 ("김OO이 이 작업을 만들었어요 · 2일 전") |
| Q5 | 워크툴에서 "새 작업" 버튼 클릭 | WBS와 동일한 작업 생성 모달이 열림 (필드 동일·디자인 동일) |
| Q6 | 워크툴에서 새 작업 생성 후 다른 탭의 WBS 보기 | WBS 화면이 자동으로 갱신되어 새 카드 보임 (페이지 새로고침 없이) |
| Q7 | WBS에서 카드 드래그 이동 후 다른 탭의 워크툴 보기 | 워크툴 "내 작업"·"지시함" 패널이 자동 갱신 |
| Q8 | URL에 직접 `/workspace-kanban.html#task=999` (없는 ID) 입력 | "작업을 찾을 수 없어요" 토스트 표시 + 빈 WBS 화면 |
| Q9 | 카드 모달 닫기 | URL hash 제거됨 (`/workspace-kanban.html`로 깔끔) |
| Q10 | 활동 기록이 없는 새 카드의 타임라인 탭 | "활동 기록이 없어요" 빈 상태 안내 |

> 시나리오는 함수명·코드 용어 없이 사용자 동작·결과 위주.

### 4.2 회귀 점검 영역

이번 변경이 깨뜨릴 수 있는 기존 기능:
- **WBS(=칸반) 카드 모달 기존 동작** — 체크리스트 체크/해제, 첨부파일 업로드, 댓글 작성, @멘션, 우선순위 변경, 마감일 변경, progress 슬라이더, 북마크, 보류 사유, 아카이브
- **WBS 5컬럼 드래그 이동** — SortableJS 동작 그대로
- **워크툴 메인 4대 패널** — 내 작업/지시함/일정/메모/피드 로드 정상
- **어드민 로그인** — 광범위 회귀 점검 (R1은 schema 변경 없으므로 위험 낮으나 확인)
- **사이드바 토글 / 퀵점프 / 사이드바 그룹 펼침**

### 4.3 백필 필요 여부

- [x] 백필 불필요 — R1은 schema 변경 없음

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] **평행** (A는 mock 없이 시작 가능 — 단건 조회 응답에 activityLog 키 없을 시 빈 배열 fallback)
- [ ] 직렬
- [ ] 평행 + 단계 머지

사유: B 작업이 1.5h로 작고 schema 변경 없음. A는 B의 신규 키(`activityLog`)가 없어도 빈 배열 fallback으로 작동하도록 작성. 머지 후 자동으로 실 데이터 표시.

### 5.2 머지 순서

```
1. B push (admin-workspace-tasks.ts 단건 조회 확장)
2. 메인 머지 → push (Netlify 자동 배포 1~3분)
3. A push (5개 HTML 사이드바·텍스트 + 신규 JS 모듈 2개 + workspace.js·workspace-kanban.js·workspace-calendar.js 갱신)
4. 메인 머지 → push
5. C 검증 트리거 (Q1~Q10 + 회귀)
6. 필요 시 fix → 메인 머지
7. 라운드 마감 → PROJECT_STATE 갱신
```

**마이그레이션 호출 없음** — R1은 DB 변경 없음. B 머지 후 바로 A 머지 가능.

### 5.3 신규 환경변수

**없음**.

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용)

### 6.1 메인 — 본 설계서가 산출물 (이미 작성 완료)

### 6.2 B 채팅 — 백 구현

```
[B — Phase 21 R1 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase21-r1-back (베이스 main @ f5dda87)
정독 (필수): docs/milestones/2026-05-12-phase21-r1-wbs-bridge.md §1·§2
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담), §7 (자체 검증)

영역: netlify/functions/, lib/, db/schema.ts, drizzle/
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/ (상태 기록은 push 후 메인 보고만)

이번 R1 핵심:
  - schema 변경 0건 (마이그 함수 작성 X)
  - admin-workspace-tasks.ts 단건 조회 GET에 activityLog 키 추가 (workspaceActivityLog 50건)

작업 순서:
  1) admin-workspace-tasks.ts 안의 단건 조회(GET ?id=X) 핸들러 찾기
  2) workspaceActivityLog 50건 SELECT (target_type='task' AND target_id=X, ORDER BY created_at DESC LIMIT 50)
     - 별도 query + admin_users 이름 매핑 (leftJoin 체인 금지)
     - try/catch + 실패 시 activityLog: [] 빈 배열 fallback
  3) 응답에 activityLog 키 포함
  4) `npx tsc --noEmit` 통과
  5) curl 또는 Postman으로 응답 확인 (activityLog 키 존재)
  6) push

머지 전 체크:
  - export const config 유지
  - requireAdmin 반환 auth.res
  - try/catch step 라벨(auth/validate/select_task/select_activity/map)·detail·stack
  - schema import 누락 0 (변경 없으므로 그대로)

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약 (1~2파일 예상).
```

### 6.3 A 채팅 — 프론트 구현

```
[A — Phase 21 R1 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase21-r1-front (베이스 main @ f5dda87)
정독 (필수): docs/milestones/2026-05-12-phase21-r1-wbs-bridge.md §3·§4
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담)

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

모드: 평행 (B 머지 전이라도 작업 시작 — activityLog 키 없으면 빈 배열 fallback)

작업 순서:
  1) 신규 모듈 2개 작성
     - public/js/workspace-task-modal.js (window.WorkspaceTaskModal — openCreate/openDetail/close)
     - public/js/workspace-sync-channel.js (window.WorkspaceSync — notify/on, BroadcastChannel 'workspace-tasks')
  2) 5개 페이지(workspace.html/workspace-kanban.html/workspace-calendar.html/workspace-templates.html/workspace-files.html)
     사이드바 통일 — §3.2 변경 후 구조 그대로
     - "내 작업/지시함/일정/메모" 1뎁스 메뉴 제거
     - 워크스페이스 1뎁스 → 5개 2뎁스(워크툴/WBS/캘린더/템플릿/파일함) 유지, "칸반"→"WBS" 텍스트만 변경
  3) workspace-kanban.html 페이지 제목·헤더 "칸반"→"WBS" 리네이밍 (URL은 유지)
  4) workspace-kanban.js — 기존 #wkNewModal·#wkCardModal 마크업·핸들러를
     workspace-task-modal.js에서 재사용 가능하도록 추출·노출
  5) workspace-kanban.js — 페이지 로드 시 location.hash 파싱:
     - #task=ID → WorkspaceTaskModal.openDetail(ID) 호출
     - 모달 닫을 때 history.replaceState로 hash 제거
  6) workspace-kanban.js — 카드 액션 후 WorkspaceSync.notify('task:updated', {id}) 발신
  7) workspace.js — "새 작업" 버튼 클릭 → WorkspaceTaskModal.openCreate({source:'worktool'})
  8) workspace.js — "내 작업"·"지시함" 패널의 카드 클릭 핸들러를 location.href='/workspace-kanban.html#task='+id로 통일
  9) workspace.js, workspace-kanban.js, workspace-calendar.js — WorkspaceSync.on('task:updated', () => refetch) 등록
 10) 카드 모달 타임라인 탭 — §3.5 자연어 매핑 그대로 표시 (activityLog 빈 배열이면 "활동 기록이 없어요")
 11) 5개 HTML에 신규 모듈 2개 <script> 추가
 12) 캐시버스터 갱신 (§3.7)
 13) 화면 진입·각 버튼·hash 이동 동작 확인 후 push

머지 전 체크:
  - §3.1 5개 페이지 모두 사이드바 통일
  - §3.5 자연어 매핑 모든 actionType 처리
  - 콘솔 에러 0
  - public/ 외 파일 변경 0

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase 21 R1 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase21-r1 (베이스 main @ B+A 머지 후 커밋)
정독: docs/milestones/2026-05-12-phase21-r1-wbs-bridge.md §4
참고: docs/PARALLEL_GUIDE.md §7 (검증 책임)

작업 순서:
  1) §4.1 Q1~Q10 라이브 시나리오 (어드민 admin/admin12345 로그인 — 라이브 URL)
  2) §4.2 회귀 점검 영역 1건씩 확인 (특히 칸반 카드 모달 기존 동작·5컬럼 드래그·워크툴 4대 패널)
  3) bug 발견 시 fix 커밋 (브랜치 그대로) → 메인 보고
  4) 보고서 docs/verify/2026-05-12-phase21-r1.md 작성
  5) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B push → 메인 머지 → Netlify 배포 확인
- [ ] A push → 메인 머지 → Netlify 배포 확인
- [ ] C 검증 PASS or fix 머지 완료
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 — Phase 21 R1 ✅ 100% 갱신
- [ ] R2 설계서 작성 시작 (`2026-05-12-phase21-r2-{키워드}.md`)

---

**설계서 마지막 갱신**: 2026-05-12 (초안 작성)
