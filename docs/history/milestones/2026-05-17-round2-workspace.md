# 라운드 2 — 워크스페이스 영역 8건 + 구글 캘린더 연동 설계서

> **생성**: 2026-05-17 / 메인 채팅
> **베이스**: main @ `69e791f`
> **분배**: 메인(schema·마이그) + A(프론트) + B(백) + C(검증)
> **추정**: 당일 완료 목표

---

## §0. 요구사항 확정

| # | 우선 | 이슈 | 결정 |
|---|---|---|---|
| 1 | 🔴 | 작업 소유자(memberId) 변경 금지 | assign PATCH 시 assignedTo만 변경, memberId 고정 |
| 2 | 🔴 | 멘션 조회·읽음 추적 | `workspace_task_mentions` 테이블 신설 |
| 3 | 🔴 | 파일 삭제 시 blob_uploads orphan 정리 | 휴지통 cron에 orphan DELETE SQL 추가 |
| 4 | 🔴 | 완료 되돌리기 시 completedAt clear | done→todo 시 completedAt=null·completedBy=null 강제 |
| 5 | 🟡 | 이벤트 RSVP 히스토리 | `workspace_event_rsvps` 테이블 신설 |
| 6 | 🟡 | 마감 알림 타임존·공휴일 | 외부 API(nager.at KR) + reminderConfig.timezone 적용 |
| 7 | 🟡 | 다른 운영자 task 조회 권한 모호 | assignedByMe 기본 ON + 권한 정책 명시 |
| 8 | 🟡 | 휴지통 복원 불가 | 어드민 워크스페이스 UI에 restore 버튼 + API |
| 9 | 🆕 | 구글 캘린더 API 연동 | OAuth2 + 워크스페이스 이벤트 양방향 동기 |

---

## §1. DB 설계

### 1.1 workspace_task_mentions (신규)

```typescript
export const workspaceTaskMentions = pgTable("workspace_task_mentions", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  taskId: integer("task_id").notNull(),
  mentionedMemberId: integer("mentioned_member_id").notNull(),
  mentionerMemberId: integer("mentioner_member_id"),
  context: text("context"),               // 멘션된 댓글/설명 앞뒤 50자
  isRead: boolean("is_read").default(false).notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### 1.2 workspace_event_rsvps (신규)

```typescript
export const workspaceEventRsvps = pgTable("workspace_event_rsvps", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  eventId: integer("event_id").notNull(),
  memberId: integer("member_id").notNull(),
  status: varchar("status", { length: 10 }).notNull(), // 'yes'|'no'|'maybe'
  note: varchar("note", { length: 200 }),
  respondedAt: timestamp("responded_at").defaultNow().notNull(),
}, (t) => ({
  uniq: unique("workspace_event_rsvps_uniq").on(t.eventId, t.memberId),
}));
```

### 1.3 google_calendar_tokens (신규 — 구글 캘린더)

```typescript
export const googleCalendarTokens = pgTable("google_calendar_tokens", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  calendarId: varchar("calendar_id", { length: 200 }).default("primary"),
  syncEnabled: boolean("sync_enabled").default(true).notNull(),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

**마이그레이션 순서**: 3개 테이블 신설 → 마이그 호출 → schema.ts 활성화.

---

## §2. API 명세 (B 작업)

### 2.1 [수정] workspace-tasks.ts assign PATCH

`memberId` 변경 코드 제거. `assignedTo`·`assignedBy`·`assignedAt`만 UPDATE:
```typescript
// AS-IS (memberId도 변경 — 버그)
.set({ memberId: newAssignee, assignedTo: newAssignee, assignedBy: adminId, assignedAt: new Date() })
// TO-BE
.set({ assignedTo: newAssignee, assignedBy: adminId, assignedAt: new Date() })
```

### 2.2 [수정] cron-workspace-trash-cleanup.ts blob orphan 정리

workspaceFiles hard delete 직후 orphan blob_uploads 정리 블록 추가:
```sql
DELETE FROM blob_uploads
 WHERE id NOT IN (
   SELECT unnest(string_to_array(attachment_ids, ','))::int
   FROM workspace_tasks WHERE attachment_ids IS NOT NULL
   UNION
   SELECT unnest(string_to_array(attachment_ids, ','))::int
   FROM workspace_files WHERE deleted_at IS NULL
 )
 AND upload_context = 'workspace'
 AND created_at < now() - interval '1 day'
```

### 2.3 [수정] 완료 되돌리기 completedAt clear

workspace-tasks.ts에서 status가 done→다른 값으로 변경 시:
```typescript
if (prevStatus === 'done' && newStatus !== 'done') {
  updateData.completedAt = null;
  updateData.completedBy = null;
}
```

### 2.4 [신규] workspace-task-mentions.ts

```
GET /api/workspace-task-mentions
  query: workspaceId, unreadOnly?=true
  응답: { ok, data: { mentions: [{ id, taskId, taskTitle, mentionerName, context, isRead, readAt, createdAt }] } }

PATCH /api/workspace-task-mentions (읽음 처리)
  body: { ids: number[] }
  응답: { ok, data: { updated: number } }
```

### 2.5 [신규] workspace-event-rsvp.ts

```
POST /api/workspace-event-rsvp
  body: { workspaceId, eventId, status: 'yes'|'no'|'maybe', note? }
  응답: { ok, data: { id, eventId, memberId, status } }

GET /api/workspace-event-rsvps?eventId=N
  응답: { ok, data: { rsvps: [{ memberId, memberName, status, note, respondedAt }], summary: { yes, no, maybe } } }
```

### 2.6 [신규] workspace-tasks.ts restore action

PATCH body에 `action: 'restore'` 추가:
```typescript
if (body.action === 'restore') {
  await db.update(workspaceTasks)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(workspaceTasks.id, id), isNotNull(workspaceTasks.deletedAt)));
  return ok({ id }, '복원되었습니다');
}
```

### 2.7 [신규] workspace-holiday.ts — 공휴일 조회 프록시

```
GET /api/workspace-holidays?year=2026
  → nager.at API: https://date.nager.at/api/v3/PublicHolidays/{year}/KR
  → 캐시: Netlify Blobs (key: holidays-{year}, TTL 30일)
  응답: { ok, data: { holidays: ['2026-01-01', '2026-03-01', ...] } }
```

### 2.8 [신규] 구글 캘린더 OAuth2 4개 endpoint

```
GET  /api/google-calendar-auth        → OAuth2 동의 URL 반환
GET  /api/google-calendar-callback    → 인증 코드 → 토큰 저장
POST /api/google-calendar-sync        → 워크스페이스 이벤트 → 구글 캘린더 동기
GET  /api/google-calendar-status      → 연동 상태 조회 (연동됨/미연동)
```

**선행 조건 (Swain 직접)**:
1. Google Cloud Console → 새 프로젝트 → OAuth2 클라이언트 ID 발급
2. 승인된 리다이렉트 URI: `https://tbfa.co.kr/api/google-calendar-callback`
3. Netlify 환경변수 등록:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI=https://tbfa.co.kr/api/google-calendar-callback`

**동기 범위**: 워크스페이스 이벤트 → 구글 캘린더 단방향 (구글 → 워크스페이스 역방향은 라운드 2.5-B로 별도)

### 2.9 [수정] workspace-tasks.ts — assignedByMe 기본 ON

```typescript
// 목록 조회 시
const assignedByMe = query.assignedByMe !== 'false'; // 기본 true
if (assignedByMe) {
  where.push(eq(workspaceTasks.memberId, adminId));
}
```

---

## §3. 화면 설계 (A 작업)

### 3.1 워크스페이스 휴지통 복원 버튼
- 위치: `public/js/workspace-kanban.js` 또는 `workspace.js` 휴지통 탭
- 휴지통 카드 우측에 "↺ 복원" 버튼 추가
- PATCH `/api/workspace-tasks` body: `{ id, action: 'restore' }`

### 3.2 이벤트 RSVP UI
- 위치: 워크스페이스 캘린더 이벤트 상세 모달
- 참석 여부 버튼 3개: "참석 예정 ✓" / "불참 ✗" / "미정 ?" 
- POST `/api/workspace-event-rsvp`
- 참석자 요약 표시: "✓ 3명 · ✗ 1명 · ? 2명"

### 3.3 멘션 알림 UI
- 위치: 워크스페이스 상단 알림 벨 또는 별도 멘션 탭
- 읽지 않은 멘션 배지 숫자 표시
- 멘션 목록에서 클릭 시 해당 Task로 이동 + 읽음 처리

### 3.4 구글 캘린더 연동 UI
- 위치: 워크스페이스 설정 페이지 (`workspace-settings.html` 또는 모달)
- "구글 캘린더 연동" 버튼 → OAuth2 팝업
- 연동 완료 후 상태 표시 + "동기화" 버튼
- GET `/api/google-calendar-status`로 연동 여부 확인

---

## §4. 검증 시나리오 (C 작업)

| # | 시나리오 | 확인 |
|---|---|---|
| Q1 | 워크스페이스 Task에서 담당자 변경 → memberId(소유자)는 그대로, assignedTo만 변경 | DB |
| Q2 | Task 완료(done) 처리 후 → done 취소(todo) → completedAt=null·completedBy=null | DB |
| Q3 | 워크스페이스 파일 삭제 → 30일 후 cron 실행 → blob_uploads orphan 삭제됨 | DB |
| Q4 | Task 댓글에 @멘션 → workspace_task_mentions INSERT → 멘션된 운영자 알림 | DB |
| Q5 | 멘션 알림 목록 조회 → 읽음 처리 → isRead=true | API |
| Q6 | 이벤트 상세 모달 RSVP "참석 예정" 클릭 → workspace_event_rsvps INSERT | DB |
| Q7 | 동일 이벤트 RSVP 변경 → UPSERT(unique 제약) | DB |
| Q8 | 공휴일 API 호출 → 마감일이 공휴일이면 알림 스킵 | API |
| Q9 | 휴지통 탭 → "복원" 클릭 → Task.deletedAt=null 복원 | UI + DB |
| Q10 | 구글 캘린더 연동 → OAuth2 흐름 완료 → google_calendar_tokens INSERT | DB |
| Q11 | 워크스페이스 이벤트 생성 → "구글 동기화" → 구글 캘린더에 이벤트 생성 확인 | 라이브 |
| Q12 | 회귀: 기존 Task assign·완료·캘린더 이벤트 생성 정상 작동 | 시나리오 |

---

## §5. mock 데이터 (A가 B 머지 전 사용)

```javascript
// 멘션 목록
const MOCK_MENTIONS = {
  ok: true,
  data: {
    mentions: [
      { id: 1, taskId: 101, taskTitle: "예산 보고서 작성", mentionerName: "김운영",
        context: "...@홍길동 검토 부탁드립니다...", isRead: false, createdAt: "2026-05-17T09:00:00Z" }
    ]
  }
};

// RSVP 목록
const MOCK_RSVPS = {
  ok: true,
  data: {
    rsvps: [
      { memberId: 1, memberName: "김운영", status: "yes", respondedAt: "2026-05-17T08:00:00Z" },
      { memberId: 2, memberName: "이담당", status: "maybe", respondedAt: "2026-05-17T08:30:00Z" }
    ],
    summary: { yes: 1, no: 0, maybe: 1 }
  }
};

// 공휴일
const MOCK_HOLIDAYS = {
  ok: true,
  data: { holidays: ["2026-01-01","2026-03-01","2026-05-05","2026-08-15","2026-10-03","2026-10-09","2026-12-25"] }
};

// 구글 캘린더 상태
const MOCK_GCAL_STATUS = {
  ok: true,
  data: { connected: false, calendarId: null, lastSyncAt: null }
};
```

---

## §6. 4채팅 시작 프롬프트

### §6.1 B 트리거 (백엔드)

```
[영역: 백엔드(netlify/functions, lib, db, drizzle)]
[브랜치: feature/round2-workspace-back — 새로 생성]

라운드 2 워크스페이스 8건 + 구글 캘린더 — 백엔드 작업.
설계서: docs/milestones/2026-05-17-round2-workspace.md §2 정독.
베이스: main @ 69e791f (git fetch + rebase 후 시작)

━━━ 작업 체크박스 ━━━

□ [#1] workspace-tasks.ts assign PATCH — memberId 변경 코드 제거
   assignedTo·assignedBy·assignedAt만 UPDATE (memberId 건드리지 말 것)

□ [#3] cron-workspace-trash-cleanup.ts — blob orphan DELETE 추가
   workspaceFiles hard delete 직후 upload_context='workspace' + 참조 없는 blob_uploads 삭제

□ [#4] workspace-tasks.ts — done→다른 status 시 completedAt=null·completedBy=null

□ [#2] netlify/functions/workspace-task-mentions.ts 신규 생성
   GET /api/workspace-task-mentions?workspaceId=N&unreadOnly=true
   PATCH /api/workspace-task-mentions (읽음 처리, body: { ids: number[] })
   export const config = { path: "/api/workspace-task-mentions" }

□ [#5] netlify/functions/workspace-event-rsvp.ts 신규 생성
   POST /api/workspace-event-rsvp (body: { workspaceId, eventId, status, note? })
   GET /api/workspace-event-rsvps?eventId=N
   export const config = { path: "/api/workspace-event-rsvp" } (GET은 별도 config)

□ [#8] workspace-tasks.ts에 restore action 추가
   PATCH body.action === 'restore' → deletedAt=null

□ [#6] netlify/functions/workspace-holidays.ts 신규 생성
   GET /api/workspace-holidays?year=N
   → https://date.nager.at/api/v3/PublicHolidays/{year}/KR fetch
   → 응답 { ok, data: { holidays: ['YYYY-MM-DD', ...] } }
   export const config = { path: "/api/workspace-holidays" }

□ [#7] workspace-tasks.ts 목록 조회 — assignedByMe 파라미터 기본 true
   query.assignedByMe !== 'false' 조건으로 본인 memberId 필터

□ [#9] 구글 캘린더 4개 endpoint 신규 생성
   - netlify/functions/google-calendar-auth.ts    → GET /api/google-calendar-auth
   - netlify/functions/google-calendar-callback.ts → GET /api/google-calendar-callback
   - netlify/functions/google-calendar-sync.ts    → POST /api/google-calendar-sync
   - netlify/functions/google-calendar-status.ts  → GET /api/google-calendar-status
   환경변수: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI

□ db/schema.ts에 3개 테이블 추가 (설계서 §1 코드 그대로)
   workspace_task_mentions, workspace_event_rsvps, google_calendar_tokens
   ★ append-only: 파일 끝에 헤더 주석 후 추가 (기존 코드 절대 건드리지 말 것)
   ★ 단, schema 활성화는 마이그 호출 후 — 메인이 별도 마이그 작성하므로 schema INSERT는 해도 됨

□ npx tsc --noEmit 통과
□ git push origin feature/round2-workspace-back

━━━ 응답 구조 (키명 임의 변경 금지) ━━━
- /api/workspace-task-mentions GET: { ok, data: { mentions: [{ id, taskId, taskTitle, mentionerName, context, isRead, readAt, createdAt }] } }
- /api/workspace-task-mentions PATCH: { ok, data: { updated: number } }
- /api/workspace-event-rsvp POST: { ok, data: { id, eventId, memberId, status } }
- /api/workspace-event-rsvps GET: { ok, data: { rsvps: [...], summary: { yes, no, maybe } } }
- /api/workspace-holidays: { ok, data: { holidays: ['YYYY-MM-DD', ...] } }
- /api/google-calendar-status: { ok, data: { connected: bool, calendarId, lastSyncAt } }
- /api/google-calendar-auth: { ok, data: { authUrl: string } }

━━━ push 전 체크 ━━━
□ 브랜치명: feature/round2-workspace-back
□ export const config = { path } 신규 7개 이상
□ requireAdmin 반환 auth.res
□ schema append-only 원칙 (기존 코드 삭제·수정 금지)
□ npx tsc --noEmit 통과

━━━ 자율주행 / 진행률 ━━━
push와 로직 결정만 묻기. 큰 체크박스 완료마다 📊 진행률 보고.
```

### §6.2 A 트리거 (프론트)

```
[영역: 프론트엔드(public/)]
[브랜치: feature/round2-workspace-front — 새로 생성]

라운드 2 워크스페이스 8건 + 구글 캘린더 — 프론트 작업.
설계서: docs/milestones/2026-05-17-round2-workspace.md §3 정독.
베이스: main @ 69e791f (git fetch + rebase 후 시작)

━━━ 작업 체크박스 ━━━

□ [#8] 워크스페이스 휴지통 탭 — "↺ 복원" 버튼 추가
   위치: workspace-kanban.js 또는 workspace.js 휴지통 탭
   PATCH /api/workspace-tasks body: { id, action: 'restore' }
   복원 후 목록 새로고침

□ [#5] 워크스페이스 캘린더 이벤트 상세 모달 — RSVP 버튼
   참석 예정 / 불참 / 미정 버튼 3개
   POST /api/workspace-event-rsvp
   GET /api/workspace-event-rsvps?eventId=N 로 요약 표시 "✓ N · ✗ N · ? N"

□ [#2] 워크스페이스 상단 — 멘션 알림 배지 + 목록
   읽지 않은 멘션 숫자 배지
   클릭 시 목록 펼침 → 해당 Task 이동 + PATCH 읽음 처리
   GET /api/workspace-task-mentions?workspaceId=N&unreadOnly=true

□ [#9] 구글 캘린더 연동 UI
   워크스페이스 설정 모달 또는 캘린더 페이지 상단에
   "구글 캘린더 연동" 버튼 → GET /api/google-calendar-auth → authUrl 팝업
   연동 완료 후 "동기화" 버튼 → POST /api/google-calendar-sync
   GET /api/google-calendar-status 로 연동 상태 표시

□ 캐시버스터 ?v=N 갱신 (수정한 모든 JS·HTML)
□ git push origin feature/round2-workspace-front

━━━ mock 데이터 (B 머지 전 사용) ━━━
설계서 §5 그대로:
- MOCK_MENTIONS: { ok, data: { mentions: [{id, taskId, taskTitle, mentionerName, context, isRead, createdAt}] } }
- MOCK_RSVPS: { ok, data: { rsvps: [...], summary: {yes, no, maybe} } }
- MOCK_HOLIDAYS: { ok, data: { holidays: ['2026-01-01', ...] } }
- MOCK_GCAL_STATUS: { ok, data: { connected: false } }

━━━ push 전 체크 ━━━
□ 브랜치명: feature/round2-workspace-front
□ body 키명 B와 일치: workspaceId, eventId, status (yes/no/maybe)
□ 캐시버스터 갱신

━━━ 자율주행 / 진행률 ━━━
push와 로직 결정만 묻기. 큰 체크박스 완료마다 📊 진행률 보고.
```

### §6.3 C 트리거 (검증 — B·A 머지 후)

```
[영역: 라이브 검증]
라운드 2 워크스페이스 — 라이브 검증.
설계서: docs/milestones/2026-05-17-round2-workspace.md §4 정독.
선행 조건: 메인 마이그 호출 확인 + B·A 머지 완료 후 진입.

━━━ 검증 체크박스 (Q1~Q12) ━━━
□ Q1  Task 담당자 변경 → memberId 불변, assignedTo만 변경
□ Q2  Task done→todo → completedAt=null·completedBy=null
□ Q3  blob orphan cron 실행 → orphan blob_uploads 삭제
□ Q4  Task 댓글 @멘션 → workspace_task_mentions INSERT + 알림
□ Q5  멘션 읽음 처리 → isRead=true
□ Q6  이벤트 RSVP → workspace_event_rsvps INSERT
□ Q7  동일 이벤트 RSVP 변경 → UPSERT unique 제약
□ Q8  공휴일 API → 마감 공휴일 시 알림 스킵
□ Q9  휴지통 복원 버튼 → deletedAt=null
□ Q10 구글 캘린더 OAuth2 흐름 완료 → tokens INSERT
□ Q11 워크스페이스 이벤트 → 구글 캘린더 동기
□ Q12 회귀: Task assign·완료·캘린더 이벤트 기존 기능 정상

━━━ 자율주행 / 진행률 ━━━
fix 발견 시 fix/round2-workspace-{키워드} 신규 브랜치.
검증 보고서: docs/verify/2026-05-17-round2-workspace.md
```

---

## §7. 라운드 마감 체크리스트 (메인)

- [ ] 마이그 파일 작성 3개 (task_mentions·event_rsvps·google_tokens) → push
- [ ] Swain 마이그 호출 (`/api/migrate-round2-workspace?run=1`)
- [ ] schema.ts 활성화 확인 후 B 트리거 발사
- [ ] B push → 응답 키 1:1 대조 → 머지
- [ ] A push → 머지
- [ ] C 검증 → Q1~Q12 PASS
- [ ] PROJECT_STATE.md·HANDOFF.md 갱신 push
