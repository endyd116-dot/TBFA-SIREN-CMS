# Phase 21 R4 — 캘린더·메모·피드·템플릿·검색 마무리

> **작성**: 2026-05-12 / 메인 채팅
> **상위 Phase**: Phase 21 워크스페이스 v3 + 서비스 연동 ([카탈로그](2026-05-12-phase21-workspace-v3-catalog.md))
> **추정**: 메인 설계 1.5h / B 백 3h / A 프론트 4h / C 검증 2h / 합계 10.5h
> **모드**: **평행** (B 작업이 작아 A는 mock 없이 빈 배열 fallback로 시작 가능)
> **베이스**: R2+R3 마감 후 main HEAD (시작 시점에 메인이 안내)
> **선행 의존**: R2+R3 통합 라운드 마감 (특히 `admin-user-preferences.ts`·`workspaceMemos` 기존 컬럼·통합 작업 모달이 R4 작업의 기반)

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블

**없음**.

### 1.2 기존 테이블 컬럼 추가

> ⚠️ **R2+R3 마이그 적용 후 확인된 실제 schema 명명**: 별도 `admin_users` 테이블이 없고 `members` 테이블이 운영자 역할 겸함 (`members.role` + `members.operatorActive`). 모든 운영자 컬럼은 `members`에 추가.

| 테이블 | 컬럼 | 타입 | 제약 | 용도 |
|---|---|---|---|---|
| `workspaceMemos` | `eventDate` | date | NULL | 캘린더 미러링용 날짜 (`showInCalendar=true`일 때만 의미) |
| `workspaceMemos` | `eventTime` | time | NULL | 캘린더 미러링용 시각 (NULL이면 "종일" 표시) |
| `workspaceMemos` | `showInCalendar` | boolean | default false NOT NULL | 캘린더에 표시 여부 |
| `members` | `defaultWbsView` | varchar(20) | NULL · default `'board'` | WBS 진입 시 기본 보기 모드: `'board'` / `'list'` / `'calendar'` |

### 1.3 마이그레이션 SQL

```sql
-- IF NOT EXISTS · 멱등 보장

-- 1) workspace_memos 캘린더 미러링 컬럼
ALTER TABLE workspace_memos ADD COLUMN IF NOT EXISTS event_date DATE;
ALTER TABLE workspace_memos ADD COLUMN IF NOT EXISTS event_time TIME;
ALTER TABLE workspace_memos ADD COLUMN IF NOT EXISTS show_in_calendar BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS ws_memos_calendar_idx ON workspace_memos(show_in_calendar, event_date);

-- 2) members.default_wbs_view (admin_users 없음 — members가 운영자 역할 겸함)
ALTER TABLE members ADD COLUMN IF NOT EXISTS default_wbs_view VARCHAR(20) DEFAULT 'board';

-- 3) 업무 템플릿 10종 시드 — name에 UNIQUE 제약 없으므로 ON CONFLICT 사용 불가
--    멱등 보장 패턴: 같은 이름의 row가 없을 때만 INSERT
--    defaultSubtasks/defaultTags는 NOT NULL이나 default '[]'이라 명시 시드 그대로 OK
--    priority는 NOT NULL이지만 default 'normal' 적용
INSERT INTO workspace_task_templates (name, default_subtasks, default_tags, estimated_hours)
SELECT v.name, v.subtasks::jsonb, v.tags::jsonb, v.hours
FROM (VALUES
  ('회원 가입 검증',         '["증빙 자료 확인", "신원 대조", "승인 또는 반려 사유 기록"]', '["회원","검증"]',     2),
  ('후원자 감사 응대',       '["수납 확인", "감사 메일 작성", "발송"]',                       '["후원자","응대"]',   1),
  ('SIREN 신고 1차 검토',   '["신고 내용 정독", "심각도 분류", "담당 배정"]',                 '["신고","검토"]',     3),
  ('법률 상담 매칭',         '["사건 유형 파악", "전문 변호사 추천", "연결 확정"]',           '["법률","매칭"]',     2),
  ('심리상담 매칭',         '["내담자 상태 파악", "상담사 추천", "예약 확정"]',              '["심리","매칭"]',     2),
  ('행사 기획',             '["일정 확정", "장소 섭외", "예산 작성", "참가자 안내"]',         '["행사","기획"]',     8),
  ('자료집 제작',           '["원고 정리", "디자인 의뢰", "교정", "인쇄"]',                   '["자료집","제작"]',  16),
  ('정기 후원자 카드 만료', '["만료 카드 대상자 목록", "안내 발송", "재등록 확인"]',         '["후원자","카드"]',   2),
  ('CMS+ 이체 결과 확인',  '["실패 목록 추출", "원인 분류", "재청구 또는 응대"]',           '["CMS+","후원"]',     3),
  ('월간 보고서 작성',       '["KPI 집계", "이슈 정리", "다음 달 계획", "검토"]',             '["보고서"]',          4)
) AS v(name, subtasks, tags, hours)
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_task_templates t WHERE t.name = v.name
);
```

### 1.4 schema.ts import 점검

- [ ] `time` 타입 import 누락 점검 (`date`는 R2+R3에서 이미 import 추가됨)
- [ ] DB 적용 전 schema 정의는 **주석 처리** (마이그 후 활성화)
- [ ] append-only — 파일 끝에 `/* === Phase 21 R4 === */` 헤더 후 추가 (R2+R3 섹션 아래)
- [ ] 신규 컬럼은 기존 `members` / `workspaceMemos` 정의 안에 직접 추가
- [ ] 템플릿 시드 후 `workspace_task_templates` count 확인 (R2+R3 시점에 1건이었음 → +10건 = 11건 기대. 기존 1건과 이름 겹치지 않게 주의)

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `netlify/functions/migrate-phase21-r4.ts` | `/api/migrate-phase21-r4` | GET ?run=1 | super_admin | 1회용 마이그 (호출 후 삭제) |
| `netlify/functions/admin-workspace-memos.ts` (수정) | `/api/admin-workspace-memos` | POST · PATCH · GET | requireAdmin | `eventDate`/`eventTime`/`showInCalendar` 필드 처리 |
| `netlify/functions/admin-workspace-events.ts` (수정) | `/api/admin-workspace-events` | GET ?list=1 | requireAdmin | `includeMemos=1` 파라미터 — 메모 미러링 통합 조회 |
| `netlify/functions/admin-workspace-task-search.ts` (신규) | `/api/admin-workspace-task-search` | POST | requireAdmin | 자연어 검색 (Gemini JSON 필터 변환 후 SQL 쿼리) |
| `netlify/functions/admin-user-preferences.ts` (수정) | `/api/admin-user-preferences` | GET · POST | requireAdmin | `defaultWbsView` 읽기/쓰기 추가 (R2+R3에서 신설된 함수에 필드 추가) |
| `netlify/functions/admin-workspace-tasks.ts` (수정) | `/api/admin-workspace-tasks` | GET ?list=1 | requireAdmin | 활동 피드 자연어 강화 — `feed=1` 응답에 `actorName`·`naturalText` 보강 |

### 2.2 함수별 상세

#### `admin-workspace-memos.ts` 확장

**POST 신규/수정** — 요청 body에 새 필드 추가:
```json
{
  "title": "...",
  "contentHtml": "...",
  "showInCalendar": true,
  "eventDate": "2026-05-15",
  "eventTime": "14:00"
}
```

- `showInCalendar`가 false면 `eventDate`·`eventTime`은 무시되고 NULL 저장
- `showInCalendar=true`이고 `eventDate=NULL`이면 400 에러 ("캘린더에 표시하려면 날짜가 필요해요")
- `eventTime`은 NULL 허용 (종일 메모)

**GET** — 응답에 새 필드 포함:
```json
{ "ok": true, "data": { "items": [{"id":1, ..., "showInCalendar":true, "eventDate":"2026-05-15", "eventTime":"14:00:00"}] } }
```

#### `admin-workspace-events.ts` 확장

기존 GET `?list=1&from=...&to=...`에 `includeMemos=1` 파라미터 추가:
- `includeMemos=1`이면 응답에 메모(`showInCalendar=true AND eventDate BETWEEN from AND to`)도 포함
- 메모 row는 다음 형식으로 변환:
  ```json
  {
    "type": "memo",
    "id": 42,
    "title": "메모 제목",
    "startAt": "2026-05-15T14:00:00",
    "endAt": null,
    "allDay": false,    // eventTime이 NULL이면 true
    "color": "#xxx",    // 메모 color 그대로
    "isPinned": false
  }
  ```
- 응답: `{ items: [...events, ...memos] }` 합쳐서 반환

#### `admin-workspace-task-search.ts` (신규)

**요청** (POST):
```json
{ "query": "이번 주 마감 + 박OO 담당" }
```

**처리 단계**:
1. `auth` — `requireAdmin`
2. `validate` — `query` 문자열, 길이 1~200
3. `call_ai` — Gemini에 다음 프롬프트 전송:
   ```
   사용자 검색어를 SQL 필터 JSON으로 변환하세요.
   필드: assigneeUid|assigneeName / status[] / priority[] / dueWithin (today|thisweek|thismonth|overdue) / textQuery
   예시 사용자 입력: "이번 주 마감 + 박OO 담당"
   예시 출력: { "assigneeName": "박OO", "dueWithin": "thisweek" }
   ```
   - 응답에서 JSON만 파싱 (markdown fence 제거)
4. `query_db` — JSON 필터를 SQL WHERE로 변환 후 `workspaceTasks` 쿼리
5. `map` — 응답 매핑

**응답 (성공)**:
```json
{
  "ok": true,
  "data": {
    "items": [...workspaceTasks 결과...],
    "interpretedFilter": { "assigneeName": "박OO", "dueWithin": "thisweek" },
    "aiCallDurationMs": 1234
  }
}
```

**응답 (실패)**:
```json
{ "ok": false, "error": "...", "step": "auth | validate | call_ai | parse_json | query_db | map", "detail": "...", "stack": "..." }
```

**필수 체크**:
- [ ] AI 호출 실패 시 빈 결과(`items:[]`) + `error: "AI 검색에 실패했어요. 키워드 검색을 사용해주세요."` 반환 (서비스 다운 X)
- [ ] AI 응답이 JSON 아니면 try/catch + 빈 결과 fallback
- [ ] AI 호출 timeout 10초 (긴 응답 방어)
- [ ] `ai-gemini.ts` 또는 `ai-task.ts` 기존 헬퍼 재사용

#### `admin-user-preferences.ts` 확장 (R2+R3에서 만든 함수에 필드만 추가)

GET 응답에 `defaultWbsView` 포함:
```json
{ "ok": true, "data": { ..., "defaultWbsView": "board" } }
```

POST 요청 body에 `defaultWbsView` 허용:
```json
{ "defaultWbsView": "list" }
```
- 값 검증: `'board'` / `'list'` / `'calendar'` 셋 중 하나만

#### `admin-workspace-tasks.ts` 활동 피드 자연어 보강

기존 `?feed=1` 응답에 다음 필드 추가:
- `actorName`: `admin_users.name` 조인 (이미 일부 있음 — 누락 행 보강)
- `naturalText`: 자연어 변환 (서버 측 또는 클라이언트 측에서 변환 — A가 처리하므로 B는 raw 데이터만 보강)
- `groupKey`: `"today"` / `"yesterday"` / `"thisweek"` / `"older"` — 시간 그룹핑용 키

### 2.3 `lib/` 헬퍼

#### `lib/natural-search.ts` (신규) — Gemini 호출 래퍼

```ts
// 시그니처
export async function parseNaturalSearchQuery(query: string): Promise<{
  assigneeName?: string;
  assigneeUid?: number;
  status?: string[];
  priority?: string[];
  dueWithin?: "today" | "thisweek" | "thismonth" | "overdue";
  textQuery?: string;
}>;
```

내부적으로 `lib/ai-gemini.ts`의 호출 헬퍼 재사용.

**필수 체크**:
- [ ] timeout 10s
- [ ] JSON 파싱 try/catch + 빈 객체 fallback
- [ ] markdown code fence(```json ... ```) 제거

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 페이지 | 경로 | 변경 |
|---|---|---|
| `public/workspace-calendar.html` | (기존) | 캘린더 YIQ 명도 + 빈 셀 3옵션 + 메모 미러링 |
| `public/workspace.html` | (기존) | 활동 피드 자연어 강화 + 시간 그룹핑 / 메모 작성 모달 — 캘린더 표시 옵션 |
| `public/workspace-kanban.html` | (기존) | 보기 모드 토글 (보드/리스트/캘린더) + 자연어 검색 버튼 |
| `public/mypage.html` | (R2+R3에서 신설된 부재 카드 옆) | 기본 보기 모드 선택 카드 신설 |

### 3.2 페이지별 변경

#### `workspace-calendar.html` / `workspace-calendar.js`

**YIQ 명도 대비**:
```js
// FullCalendar eventDidMount 콜백에서
function adjustTextColor(eventEl, bgColor) {
  // bgColor: "#3788d8" 형식
  const r = parseInt(bgColor.slice(1,3), 16);
  const g = parseInt(bgColor.slice(3,5), 16);
  const b = parseInt(bgColor.slice(5,7), 16);
  const yiq = (r*299 + g*587 + b*114) / 1000;
  eventEl.style.color = yiq >= 128 ? '#000' : '#fff';
}
```

**빈 셀 클릭 3옵션 팝업**:
```
FullCalendar dateClick → 작은 팝업 메뉴 띄움
┌──────────────────┐
│ 이 날짜에 추가:    │
│  ➕ 업무          │
│  📅 일정          │
│  📝 메모          │
└──────────────────┘
```

각 옵션 클릭:
- 업무 → `WorkspaceTaskModal.openCreate({ dueDate: 클릭한 날짜 })`
- 일정 → 일정 모달 (R2+R3에서 만든 모달 또는 신규) `openEventModal({ startDate: 클릭한 날짜 })`
- 메모 → `WorkspaceMemoModal.openCreate({ showInCalendar: true, eventDate: 클릭한 날짜 })`

**메모 미러링**:
- `loadEvents(start, end)` 함수에 `includeMemos=1` 파라미터 추가
- 응답에서 `type === 'memo'`인 row를 캘린더에 표시 (아이콘으로 메모 구분)

#### `workspace.html` / `workspace.js` — 메모 작성 모달 + 활동 피드

**메모 모달 신규**: `public/js/workspace-memo-modal.js`
```
window.WorkspaceMemoModal = {
  openCreate(opts) {   // opts: { showInCalendar?, eventDate?, eventTime? }
    // 모달 마크업 inject
    // ┌─ 메모 작성 ──────────────┐
    // │ 제목: [_____________]      │
    // │ 내용: [에디터]              │
    // │ ☑️ 캘린더에 표시            │   <-- 체크 시 아래 칸 열림
    // │   날짜: [date input]        │
    // │   시간: [time input] (선택) │
    // │ 색상: [● ● ●]              │
    // │ ☐ 고정 (상단)              │
    // │ [취소] [저장]              │
    // └────────────────────────────┘
  },
  openEdit(memoId, opts) { ... },
  close() { ... }
};
```

opts.showInCalendar/eventDate가 미리 들어있으면 체크박스 ON + 칸 펼쳐진 상태로 시작 (캘린더 빈 셀 클릭 진입).

**활동 피드 자연어 + 시간 그룹핑**:
```
┌─ 팀 활동 피드 ─────────────────────┐
│                                    │
│ ▶ 오늘 (3건)                       │
│   • 김OO이 작업 "X" 만들었어요 · 5분│
│   • 박OO이 작업 "Y"을 이OO에게 토스│
│     · 10분 전                      │
│   • ...                            │
│                                    │
│ ▶ 어제 (5건)                       │
│   • ...                            │
│                                    │
│ ▶ 이번 주 (12건)                   │
│   • ...                            │
│                                    │
│ ▶ 이전                             │
│   • ...                            │
└────────────────────────────────────┘
```

- 각 항목 클릭 → `linkUrl`이 있으면 이동, 권한 없으면 disabled (회색 텍스트)
- `naturalText` 매핑은 R1에서 도입한 매핑(`workspace-activity-render.js` 또는 inline)을 재사용·확장:
  - 신규 actionType: `task.transfer`, `task.assign`, `service.assignee_change`, `service.closed`
  - `task.transfer` → "{actor}이 작업 \"{title}\"을 {toName}에게 토스했어요"
  - `service.assignee_change` → "{actor}이 {serviceKind} 신고 #{id} 담당을 {newName}에게 인계했어요"
  - `service.closed` → "{actor}이 {serviceKind} 신고 #{id}를 종결 처리했어요"

#### `workspace-kanban.html` / `workspace-kanban.js`

**보기 모드 토글 (헤더)**:
```
┌─ WBS ─────────────────────────────────────┐
│ [📋 보드] [📃 리스트] [📅 캘린더]   [🔍 검색]│
│                                            │
│ (선택한 모드에 따라 화면 렌더)               │
└────────────────────────────────────────────┘
```

- 페이지 로드 시 `admin-user-preferences.ts` GET → `defaultWbsView` 받아 자동 선택
- 토글 클릭 시 localStorage 즉시 반영 + 서버에도 PATCH (debounce 1초)
- **보드 모드** — 기존 5컬럼 그대로 (변경 없음)
- **리스트 모드** — 카드를 table로 (status별 그룹·정렬·필터)
  ```
  ┌──────┬──────────────┬──────┬────────┬──────────┐
  │ 상태 │ 제목         │ 담당  │ 마감일 │ 우선순위 │
  ├──────┼──────────────┼──────┼────────┼──────────┤
  │ 할일 │ 회의 준비     │ 김OO │ 5/15   │ 보통     │
  │ 진행 │ 자료집 제작   │ 박OO │ 5/20   │ 높음     │
  │ ...                                            │
  └──────┴──────────────┴──────┴────────┴──────────┘
  행 클릭 → 카드 상세 모달
  ```
- **캘린더 모드** — workspace-calendar.html과 같은 FullCalendar 임베드 (작업·일정·메모)

**자연어 검색 버튼 (헤더 우측)**:
```
┌─ 검색 ────────────────────────────────────┐
│ [______________________] [🔍] [🤖 AI 검색]│
│                                            │
│ (입력 후 일반 검색: 키워드 LIKE %x%)        │
│ (AI 검색 버튼: POST /api/admin-workspace-  │
│  task-search → Gemini 필터 변환 → 결과)    │
│                                            │
│ ※ AI 해석 결과 표시:                       │
│   "박OO 담당 + 이번 주 마감으로 해석"       │
└────────────────────────────────────────────┘
```

#### `mypage.html` 기본 보기 모드 카드 신설

R2+R3 부재 토글 카드 옆에 추가:
```
┌─ WBS 기본 보기 모드 ───────────────┐
│ WBS 페이지를 처음 열 때 보일 모드: │
│ ⦿ 보드 (기본)                      │
│ ○ 리스트                           │
│ ○ 캘린더                           │
│             [저장]                 │
└────────────────────────────────────┘
```

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | API | 요청 | 응답 처리 | 토스트 |
|---|---|---|---|---|
| 캘린더 빈 셀 클릭 → "메모" 선택 | (모달 오픈만) | — | `WorkspaceMemoModal.openCreate({showInCalendar:true, eventDate:날짜})` | — |
| 메모 모달 [캘린더 표시 체크 + 저장] | POST `/api/admin-workspace-memos` | `{title, content, showInCalendar, eventDate, eventTime}` | 모달 닫기 + 캘린더·메모 패널 갱신 | "메모 저장됨" / 서버 detail |
| 캘린더 페이지 진입 | GET `/api/admin-workspace-events?list=1&from=...&to=...&includeMemos=1` | — | 작업·일정·메모 3종 한 화면 렌더 | — |
| WBS 검색바 입력 + 엔터 | GET `/api/admin-workspace-tasks?list=1&q=키워드` | — | 카드 리스트 필터 | — |
| WBS "🤖 AI 검색" 버튼 | POST `/api/admin-workspace-task-search` | `{query: 입력값}` | 카드 리스트 + 상단에 "해석 결과: ..." 표시 | "AI 검색 실패" 시 키워드 검색으로 fallback |
| WBS 보기 모드 토글 | POST `/api/admin-user-preferences` | `{defaultWbsView: "list"}` | localStorage 즉시 반영 + 화면 전환 | "기본 보기 저장됨" (조용히) |
| 마이페이지 보기 모드 저장 | POST `/api/admin-user-preferences` | `{defaultWbsView: "calendar"}` | 카드 갱신 | "기본 보기 모드 저장" |
| 활동 피드 항목 클릭 | (네비게이션) | — | `linkUrl`로 이동 (권한 없으면 disabled) | — |
| 새 작업 생성 시 템플릿 선택 | (이미 R1에서 구현) | — | 템플릿 10종 시드 활용 | — |

### 3.4 토스트·문구

| 상황 | 문구 |
|---|---|
| 캘린더 메모 저장 | "메모가 저장됐어요" |
| 캘린더 표시 켰는데 날짜 없음 | "캘린더에 표시하려면 날짜를 입력해주세요" |
| AI 검색 호출 | "AI가 검색어를 해석 중이에요..." (로딩) |
| AI 검색 성공 | "{필터} 기준으로 N건 찾았어요" |
| AI 검색 실패 | "AI 검색 실패 — 키워드 검색으로 시도해주세요" |
| 기본 보기 저장 | "기본 보기 모드 저장됐어요" |
| 활동 피드 권한 없음 | (클릭 disabled, 토스트 X) |
| 빈 활동 피드 그룹 | (해당 그룹 자체 미표시) |

### 3.5 캐시버스터

신규·변경:
- `public/js/workspace-calendar.js?v=3` (YIQ + 빈 셀 3옵션 + 메모 미러)
- `public/js/workspace-memo-modal.js?v=1` (신규)
- `public/js/workspace.js?v=6` (활동 피드 자연어·그룹핑 + 메모 모달 진입)
- `public/js/workspace-kanban.js?v=6` (보기 모드 + 자연어 검색)
- `public/js/workspace-activity-render.js?v=2` (자연어 매핑 확장 — R1 도입분 보강)
- `public/js/mypage-out-of-office.js?v=2` (보기 모드 카드 추가 — 파일명은 유지하되 내용 확장)
- `public/css/workspace-kanban-views.css?v=1` (신규 — 리스트·캘린더 뷰 스타일)

HTML 변경:
- `workspace.html`·`workspace-kanban.html`·`workspace-calendar.html`·`mypage.html`

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오

| # | 시나리오 | 기대 동작 |
|---|---|---|
| Q1 | 캘린더 페이지 진입 — 흰색 배경에 작업 카드들 표시 | 텍스트 색상이 배경 명도에 따라 자동 검정/흰색 (YIQ) — 모두 가독성 확보 |
| Q2 | 캘린더 빈 셀 클릭 | "이 날짜에 추가: 업무 / 일정 / 메모" 3옵션 팝업 |
| Q3 | 빈 셀에서 "메모" 선택 → 모달 열림 | "캘린더에 표시" 체크박스 ON + 날짜 자동 채워짐 + 시간 선택 가능 |
| Q4 | 메모 시간 14:00 입력하고 저장 | 캘린더에 메모가 14:00으로 표시됨 (메모 아이콘으로 일정과 구분) |
| Q5 | 메모 모달에서 "캘린더 표시" 해제 후 저장 | 메모는 메모 탭에만 보이고 캘린더에서는 안 보임 |
| Q6 | "캘린더 표시" 체크했는데 날짜 비우고 저장 시도 | "캘린더에 표시하려면 날짜를 입력해주세요" 에러 (저장 안 됨) |
| Q7 | WBS 진입 — 기본 보기 모드(보드) 자동 선택 | 5컬럼 칸반 보드로 시작 |
| Q8 | WBS 헤더 "리스트" 토글 클릭 | 테이블 형식으로 카드 렌더 (상태/제목/담당/마감/우선순위 컬럼) |
| Q9 | 리스트 행 클릭 | 카드 상세 모달 자동 오픈 (R1의 통합 모달) |
| Q10 | WBS "캘린더" 토글 클릭 | FullCalendar로 마감일 기준 카드 표시 |
| Q11 | 마이페이지에서 "리스트"로 기본 보기 변경 후 저장 → WBS 재진입 | 리스트 모드로 시작 |
| Q12 | WBS 검색바에 "회의" 입력 + 엔터 | 제목에 "회의" 포함된 카드만 표시 (LIKE 검색) |
| Q13 | "🤖 AI 검색" 버튼 → "이번주 마감 + 박OO 담당" 입력 | 해석 결과 "박OO 담당 + 이번 주 마감" 표시 + 해당 카드 리스트 |
| Q14 | AI 검색 실패 시뮬레이션 (Gemini 키 누락 등) | "AI 검색 실패 — 키워드 검색으로 시도해주세요" 토스트 + 빈 결과 |
| Q15 | 워크툴 활동 피드 — 시간 그룹핑 확인 | "오늘 (N건)" / "어제 (N건)" / "이번 주" / "이전" 4개 섹션 |
| Q16 | 활동 피드 항목 클릭 (권한 있음) | 해당 작업/서비스로 이동 |
| Q17 | 활동 피드 항목 클릭 (권한 없음 — 다른 사람의 비공개 카드) | 클릭 disabled 또는 "권한이 없어요" 안내 |
| Q18 | 새 작업 생성 모달에서 템플릿 드롭다운 | 시드된 10종 노출 (회원 가입 검증·후원자 감사 응대 등) |

### 4.2 회귀 점검

- R1 통합 작업 모달·BroadcastChannel·#task hash·타임라인
- R2+R3 토스·워처·할당한 작업 패널·알림 드롭다운·R&R·부재 토글·서비스↔카드 동기화·미할당 풀
- 기존 메모 작성 (캘린더 미연동 메모) — `showInCalendar=false` 기본값 → 영향 없음
- 기존 일정 작성 — workspaceEvents 변경 없음
- 어드민 로그인 (광범위)
- 캘린더 페이지 기존 작업·일정 표시 (메모 추가 후에도 정상)

### 4.3 백필 필요 여부

- [x] 백필 필요 — 업무 템플릿 10종 시드 (1.3 SQL에 포함)
- [ ] workspaceMemos 기존 row는 그대로 (`showInCalendar=false` 기본값으로 자동 처리)
- [ ] admin_users 기존 row는 그대로 (`defaultWbsView='board'` 기본값)

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [x] **평행** — B 작업이 작고(3h) schema 변경이 컬럼 추가뿐이라 단계머지 불필요
- [ ] 직렬
- [ ] 평행 + 단계 머지

### 5.2 머지 순서

```
1. B push (schema.ts + 마이그 + 모든 API + lib/natural-search.ts 통합 1회)
2. 메인 머지 → push
3. Netlify 배포 1~3분 대기
4. 메인이 Swain께 마이그 URL 안내: /api/migrate-phase21-r4?run=1
5. Swain 응답 success 보고 → 메인이 schema 활성화·마이그 파일 삭제 → push
6. A push (캘린더 강화·메모 모달·활동 피드·보기 모드·자연어 검색 UI)
7. 메인 머지 → push
8. C 검증 트리거 → C push → 메인 머지 → 라운드 마감 → Phase 21 ✅ 100%
```

### 5.3 신규 환경변수

**없음** (자연어 검색은 기존 `GEMINI_API_KEY` 재사용).

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용 — R2+R3 마감 후 발송)

### 6.1 메인 — 본 설계서가 산출물 (이미 작성 완료)

### 6.2 B 채팅 — 백 구현

```
[B — Phase 21 R4 백 구현 (캘린더·메모·검색·템플릿)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase21-r4-back (신규 — 시작 시 git fetch origin && git switch -c feature/phase21-r4-back origin/main)
베이스: main @ (R2+R3 마감 후 — 메인 안내)
정독 (필수): docs/milestones/2026-05-12-phase21-r4-calendar-search.md §1·§2
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담), §7 (자체 검증)

영역: netlify/functions/, lib/, db/schema.ts, drizzle/
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§1 DB 체크리스트 (설계서 §1.2·§1.3·§1.4)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- [ ] §1.2 workspace_memos에 컬럼 3개 추가 — eventDate(date) / eventTime(time) / showInCalendar(boolean NOT NULL default false)
- [ ] §1.2 members에 컬럼 1개 추가 — defaultWbsView(varchar(20) default 'board')
       ※ 실제 schema는 admin_users 없음, members가 운영자 역할 겸함 — 반드시 members에 추가
- [ ] §1.3 SQL 멱등 — ALTER TABLE ... ADD COLUMN IF NOT EXISTS (4개)
- [ ] §1.3 시드 — workspace_task_templates.name에 UNIQUE 없음 → ON CONFLICT 사용 금지 → WHERE NOT EXISTS 패턴 (설계서 §1.3 SQL 그대로)
- [ ] §1.3 INDEX — ws_memos_calendar_idx(show_in_calendar, event_date)
- [ ] §1.4 import 점검 — time 신규 추가 (date는 R2+R3에서 이미 import됨)
- [ ] schema.ts append-only — 파일 끝에 /* === Phase 21 R4 === */ 헤더 후 추가 (R2+R3 섹션 아래)
- [ ] 신규 컬럼은 기존 members·workspaceMemos 정의 안에 직접 추가 (마이그 후 활성화)
- [ ] 템플릿 시드 후 count 기대 — 기존 1건 + 신규 10건 = 11건

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§2 API 체크리스트 (설계서 §2.1·§2.2·§2.3)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- [ ] §2.1 마이그 함수 — netlify/functions/migrate-phase21-r4.ts (GET ?run=1 + super_admin + 진단/적용 모드)
- [ ] §2.1 신규 함수 1개 — admin-workspace-task-search.ts (POST 자연어 검색)
- [ ] §2.1 수정 함수 4개 — admin-workspace-memos / admin-workspace-events (includeMemos=1) / admin-user-preferences (defaultWbsView 추가) / admin-workspace-tasks (feed actorName·groupKey 보강)
- [ ] §2.2 admin-workspace-memos 응답 키 — showInCalendar / eventDate / eventTime (camelCase 그대로)
- [ ] §2.2 admin-workspace-events 응답 — memo row type='memo' / startAt / endAt / allDay 형식 §2.2 그대로
- [ ] §2.2 admin-workspace-task-search 응답 — items / interpretedFilter / aiCallDurationMs
- [ ] §2.2 step 라벨 — auth/validate/call_ai/parse_json/query_db/map (자연어 검색)
- [ ] §2.3 lib/natural-search.ts — parseNaturalSearchQuery 시그니처 §2.3 그대로 + timeout 10s + markdown fence 제거 + JSON 파싱 try/catch fallback
- [ ] AI 호출 실패 시 — 빈 결과(items:[]) + friendly 메시지 (서비스 다운 X)
- [ ] 표준 패턴 — export const config = { path } / requireAdmin auth.res / try/catch step·detail·stack / 응답 키 다중 fallback
- [ ] 검증 — npx tsc --noEmit 통과 + curl 단위 동작 확인

⚠️ schema 격차 발견 시: 추측해서 코드 작성 금지. 실제 schema 정독·grep 후 적응안 적용 + 메인에 사후 보고.

push 후 메인에 보고:
  - 브랜치명·커밋 해시·변경 파일 요약
  - 위 체크박스 모두 체크된 상태인지 한 줄 명시 (예: "§1 9/9 / §2 12/12 통과")
  - 마이그 호출 URL: /api/migrate-phase21-r4?run=1
  - schema 격차·적응안 적용한 경우 별도 표
```

### 6.3 A 채팅 — 프론트 구현

```
[A — Phase 21 R4 프론트 구현 (캘린더·메모 모달·활동 피드·WBS 보기 모드·자연어 검색)]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase21-r4-front (신규 — git fetch origin && git switch -c feature/phase21-r4-front origin/main)
베이스: main @ (R2+R3 마감 후)
정독 (필수): docs/milestones/2026-05-12-phase21-r4-calendar-search.md §3·§4
참고: docs/PARALLEL_GUIDE.md §3

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

모드: 평행 (B 머지 전이라도 mock 없이 빈 응답·기본값 fallback로 작업)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§3 화면 체크리스트 (설계서 §3.1·§3.2·§3.3·§3.4·§3.5)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▼ 신규 JS 모듈 ▼
- [ ] public/js/workspace-memo-modal.js — 메모 작성·수정 모달 (window.WorkspaceMemoModal — openCreate / openEdit / close, opts.showInCalendar/eventDate/eventTime 지원)
- [ ] public/css/workspace-kanban-views.css — 리스트·캘린더 뷰 스타일

▼ 캘린더 강화 (workspace-calendar.js) ▼
- [ ] YIQ 명도 계산 — eventDidMount에서 bgColor → yiq → 텍스트 색 검정/흰색 자동
- [ ] dateClick 핸들러 — 빈 셀 클릭 시 "이 날짜에 추가: 업무 / 일정 / 메모" 3옵션 팝업
- [ ] 옵션별 동작 — 업무: WorkspaceTaskModal.openCreate({dueDate}) / 일정: openEventModal({startDate}) / 메모: WorkspaceMemoModal.openCreate({showInCalendar:true, eventDate})
- [ ] loadEvents에 includeMemos=1 — 응답 중 type='memo'인 row 캘린더에 표시 (메모 아이콘으로 일정과 구분)

▼ 워크툴 강화 (workspace.js) ▼
- [ ] 활동 피드 자연어 — §3.2 와이어프레임 그대로 (오늘/어제/이번주/이전 4섹션)
- [ ] 시간 그룹핑 — groupKey('today'/'yesterday'/'thisweek'/'older') 응답 키 사용
- [ ] 활동 피드 클릭 이동 — linkUrl(=actionUrl) 있으면 이동, 권한 없으면 disabled (회색)
- [ ] 메모 패널 "새 메모" 버튼 → WorkspaceMemoModal.openCreate()

▼ WBS 강화 (workspace-kanban.js) ▼
- [ ] 헤더 보기 모드 토글 — [📋 보드] [📃 리스트] [📅 캘린더] (3종)
- [ ] defaultWbsView 자동 로드 — GET /api/admin-user-preferences로 받아 자동 선택
- [ ] 토글 클릭 시 — localStorage 즉시 반영 + 서버 PATCH (debounce 1초)
- [ ] 보드 모드 — 기존 5컬럼 칸반 그대로 (변경 0)
- [ ] 리스트 모드 — table 렌더 (상태/제목/담당/마감/우선순위) + 행 클릭 → 카드 모달
- [ ] 캘린더 모드 — FullCalendar 임베드 (마감일 기준)
- [ ] 검색바 + "🔍" 일반 검색 (LIKE %키워드%)
- [ ] "🤖 AI 검색" 별도 버튼 — POST /api/admin-workspace-task-search → interpretedFilter 표시 + items 렌더
- [ ] AI 검색 실패 시 — "AI 검색 실패 — 키워드 검색으로 시도해주세요" 토스트 + 자동 fallback

▼ 활동 피드 자연어 매핑 (workspace-activity-render.js) ▼
- [ ] 신규 actionType 매핑 추가 — task.transfer / task.assign / service.assignee_change / service.closed (§3.5 자연어 매핑 표 그대로)

▼ 마이페이지 (mypage.html + mypage-out-of-office.js 또는 별도 모듈) ▼
- [ ] WBS 기본 보기 모드 카드 신설 — 보드/리스트/캘린더 라디오 + 저장 버튼
- [ ] R2+R3 부재 카드 옆에 배치 (영역 충돌 0)

▼ HTML / 캐시버스터 ▼
- [ ] workspace.html / workspace-kanban.html / workspace-calendar.html / mypage.html — 신규 <script>/<link> 추가
- [ ] §3.5 캐시버스터 일괄 갱신 (워크스페이스 공용 JS는 v 한 칸씩)
- [ ] public/ 외 파일 변경 0

▼ 응답 키 정확 ▼
- [ ] showInCalendar / eventDate / eventTime — camelCase 그대로
- [ ] actionUrl (linkUrl X) / assignedTo (assigneeUid X) — R2+R3에서 확정된 명명 유지
- [ ] type / startAt / endAt / allDay — 캘린더 일정·메모 통합 응답 키 그대로
- [ ] interpretedFilter — 자연어 검색 응답 그대로 표시

▼ 토스트 문구 ▼
- [ ] 메모 저장 / 날짜 누락 에러 / AI 검색 성공·실패 / 기본 보기 저장 — §3.4 한국어 한 글자도 안 바꿈

push 후 메인에 보고:
  - 브랜치명·커밋 해시·변경 파일 요약
  - 위 체크박스 모두 체크된 상태인지 한 줄 명시 (예: "§3 신규 2 / 캘린더 4 / 워크툴 4 / WBS 9 / 매핑 1 / 마이페이지 2 / HTML 3 / 응답키 4 / 토스트 4 = 33/33 통과")
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase 21 R4 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase21-r4 (신규 — git fetch origin && git switch -c verify/phase21-r4 origin/main)
정독: docs/milestones/2026-05-12-phase21-r4-calendar-search.md §4
참고: docs/PARALLEL_GUIDE.md §7

작업 순서:
  1) §4.1 Q1~Q18 라이브 시나리오 (라이브 URL — admin/admin12345)
     - 캘린더 명도·빈 셀·메모 미러링 (Q1~Q6)
     - WBS 보기 모드(보드/리스트/캘린더) (Q7~Q11)
     - 검색바·AI 검색 (Q12~Q14)
     - 활동 피드 시간 그룹핑·권한 (Q15~Q17)
     - 템플릿 10종 시드 확인 (Q18)
  2) §4.2 회귀 점검 (특히 R1·R2+R3 도입 기능 영향 0)
  3) bug 발견 시 fix 커밋 → 메인 보고
  4) 보고서 docs/verify/2026-05-12-phase21-r4.md
  5) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B push → 메인 머지 → Swain 마이그 호출 → schema 활성화·마이그 파일 삭제
- [ ] A push → 메인 머지 (영역 충돌 0 확인)
- [ ] C 검증 PASS or fix 머지 완료
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 — Phase 21 R4 ✅ 100% + **Phase 21 전체 ✅ 100%** 갱신
- [ ] 카탈로그 (`2026-05-12-phase21-workspace-v3-catalog.md`) 마감 상태 갱신

---

## 8. 사용자 결정 사항 (확정)

R4 (4건):
- 캘린더 빈 셀 → 메모 추가 시 "캘린더 표시" **자동 ON + 날짜 자동 설정**
- WBS 자연어 검색 **하이브리드** (키워드 기본 + "🤖 AI 검색" 별도 버튼)
- 기본 보기 모드 적용 범위 **WBS 한 곳만** (보드/리스트/캘린더)
- 업무 템플릿 10종 **AI 제안 그대로 시드** (어드민이 마감 후 자유 수정 가능)

추천 자동 채택:
- 메모 모달 신규(`workspace-memo-modal.js`) — 통합 작업 모달 패턴 따라 신규 모듈
- WBS 보기 모드 — 보드(기본)·리스트(table)·캘린더(FullCalendar 임베드) 3종
- 자연어 검색 응답 형식 — Gemini가 JSON 필터 반환 → 백엔드가 SQL 변환 (Gemini가 직접 결과 X)

---

**설계서 마지막 갱신**: 2026-05-12 (초안 + §1/§2/§3 schema 격차 정정 + §6 시작 프롬프트 체크박스 패턴 강화)
