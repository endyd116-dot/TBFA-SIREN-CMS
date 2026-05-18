# 라운드 12 — 알림 수신함 + 서브태스크 배지 + @멘션 자동 알림

> **작성**: 2026-05-18 / 메인 채팅
> **추정**: 메인 설계 0.5h / B 백 2h / A 프론트 2.5h / C 검증 1h / 합계 6h
> **모드**: 평행 (A는 mock으로 시작)
> **배경**: R12 사전 조사에서 확인된 3가지 미구현 기능 일괄 구현

---

## §0 구현 항목

| ID | 기능 | 현황 | 작업 |
|---|---|---|---|
| F-1 | 알림 수신함 전체 페이지 | API 존재, UI 없음 | A: mypage.html 탭 + JS 신규 |
| F-2 | 칸반 카드 서브태스크 N/M 배지 | 목록 API에 count 없음 | B: 목록 응답에 필드 추가 / A: 카드 배지 렌더링 |
| F-3 | @멘션 자동 감지 → 알림 발송 | 테이블·API 있음, 파싱 없음 | B: task 저장 시 파싱 + dispatch |

---

## §1 DB 설계

### 1.1 변경 없음

모든 테이블·컬럼 이미 존재. 마이그레이션 불필요.

- `notifications` 테이블: id, recipientId, recipientType, category, severity, title, message, link, isRead, createdAt 등
- `workspaceTaskMentions` 테이블: mentionedMemberId, mentionerMemberId, taskId, context, isRead, createdAt
- `lib/notify-dispatcher.ts` NotifyEvent에 `WORKSPACE_MENTION` 추가만 필요 (TS 수정)

---

## §2 API 명세

### 2.1 함수 목록

| 함수 파일 | 변경 | 내용 |
|---|---|---|
| `notifications-mine.ts` | **없음** | 이미 구현 완료. GET `{ list, unreadCount, criticalCount }` |
| `notifications-read.ts` | **없음** | 이미 구현 완료. PATCH 읽음 처리 |
| `admin-workspace-tasks.ts` | **수정** | GET 목록에 subtaskCount·subtaskDoneCount 추가 + POST/PATCH @멘션 파싱 |
| `lib/notify-dispatcher.ts` | **수정** | WORKSPACE_MENTION eventType + 메시지 템플릿 추가 |

### 2.2 함수별 상세

#### `admin-workspace-tasks.ts` GET 목록 — subtaskCount 추가 (F-2)

기존 items 배열 각 항목에 두 필드 추가:

```typescript
// 기존 SELECT 후 별도 쿼리로 카운트 집계 (drizzle 다중 leftJoin 체인 금지 원칙)
const taskIds = items.map(t => t.id);
let subtaskMap: Record<number, { total: number; done: number }> = {};
if (taskIds.length > 0) {
  try {
    const counts = await db
      .select({
        parentId: workspaceTasks.parentId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where status = 'done')::int`,
      })
      .from(workspaceTasks)
      .where(inArray(workspaceTasks.parentId, taskIds))
      .groupBy(workspaceTasks.parentId);
    counts.forEach(r => { subtaskMap[r.parentId!] = { total: r.total, done: r.done }; });
  } catch (e) { console.warn("subtaskCount 집계 실패", e); }
}

// items 매핑 시 추가
return items.map(t => ({
  ...t,
  subtaskCount: subtaskMap[t.id]?.total ?? 0,
  subtaskDoneCount: subtaskMap[t.id]?.done ?? 0,
}));
```

응답 변화: `{ items: [{ ...기존, subtaskCount: 3, subtaskDoneCount: 1 }, ...], total }`

---

#### `admin-workspace-tasks.ts` POST/PATCH — @멘션 파싱 (F-3)

task 저장 완료 직후 fire-and-forget 블록 추가:

```typescript
// @멘션 파싱 — fire-and-forget
try {
  const mentionPattern = /@([\w가-힣]+)/g;
  const mentions = [...(body.description || "").matchAll(mentionPattern)].map(m => m[1]);
  if (mentions.length > 0) {
    const mentioned = await db.select({ id: members.id, name: members.name })
      .from(members)
      .where(inArray(members.name, mentions));
    
    for (const m of mentioned) {
      // 중복 방지
      const exists = await db.select({ id: workspaceTaskMentions.id })
        .from(workspaceTaskMentions)
        .where(and(eq(workspaceTaskMentions.taskId, taskId), eq(workspaceTaskMentions.mentionedMemberId, m.id)))
        .limit(1);
      if (exists.length > 0) continue;
      
      await db.insert(workspaceTaskMentions).values({
        taskId, mentionedMemberId: m.id, mentionerMemberId: auth.uid,
        context: (body.description || "").slice(0, 200),
      });
      await dispatch({ event: "WORKSPACE_MENTION",
        target: { type: "member", id: m.id },
        params: { taskId, taskTitle: body.title, mentionerName: auth.name } });
    }
  }
} catch (e) { console.warn("@멘션 처리 실패", e); }
```

---

#### `lib/notify-dispatcher.ts` — WORKSPACE_MENTION 추가 (F-3)

```typescript
// NotifyEvent union에 추가
| "WORKSPACE_MENTION"   // 태스크에서 @멘션됨

// 메시지 템플릿
WORKSPACE_MENTION: (p) => `"${p.taskTitle}" 태스크에서 ${p.mentionerName}님이 멘션했습니다.`
```

---

## §3 화면 명세

### 3.1 마이페이지 알림 탭 (F-1)

**수정 파일**: `mypage.html`, 신규 `public/js/mypage-notifications.js`

```
┌─ 마이페이지 ─────────────────────────────────────┐
│  [내 정보] [후원 내역] [신청 내역] [📬 알림]  ← 탭 추가
│                                                 │
│  📬 알림 수신함                  [모두 읽음]    │
│  ─────────────────────────────────────────────  │
│  🔵 태스크 멘션       회의록 태스크에서 ...  5분 전 │
│  ─  법률 상담 배정    새 상담이 배정되었습니다  1시간 전│
│  ─  후원 결제 완료    정기후원이 처리되었습니다  어제  │
│                                                 │
│  [더 보기]                                      │
└─────────────────────────────────────────────────┘
```

**동작:**
- 탭 진입: GET `/api/notifications-mine` → 목록 렌더링
- 알림 클릭: PATCH `/api/notifications-read` `{ id }` → isRead=true + 스타일 갱신 + link 이동
- "모두 읽음": PATCH `/api/notifications-read` `{ all: true }` → 전체 읽음 처리
- 읽지 않은 항목: 좌측 파란 점 + 배경색 강조

### 3.2 칸반 카드 서브태스크 배지 (F-2)

**수정 파일**: `workspace-kanban.js`

```
┌─ 카드 ────────────────────────────────┐
│  회의록 준비                          │
│  홍길동  D-3  🔴 높음                 │
│  📋 1/3  ✅ 2/5                      │  ← 서브태스크 배지 추가
└───────────────────────────────────────┘
```

- `subtaskCount > 0`일 때만 `📋 완료/전체` 배지 표시
- 기존 체크리스트 배지(`✅ N/M`) 옆에 나란히

### 3.3 사용자 동작 → API 매핑

| 동작 | API | 응답 처리 |
|---|---|---|
| 알림 탭 진입 | GET `/api/notifications-mine` | 목록 렌더링, unreadCount 탭 배지 |
| 알림 항목 클릭 | PATCH `/api/notifications-read` `{id}` | 읽음 처리 + link 이동 |
| "모두 읽음" 클릭 | PATCH `/api/notifications-read` `{all:true}` | 전체 읽음 스타일 |
| 칸반 로드 | GET `/api/admin-workspace-tasks` | subtaskCount 포함 → 카드 배지 |
| 태스크 description @이름 저장 | POST/PATCH `/api/admin-workspace-tasks` | 멘션 감지 → 알림 자동 발송 |

### 3.4 캐시버스터

- `mypage.html` — `mypage-notifications.js?v=1` 참조 추가
- `workspace-kanban.js?v=N+1` (기존 버전에서 +1)

---

## §4 검증 시나리오

| # | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | 마이페이지 → 알림 탭 클릭 | 알림 목록 표시, 읽지 않은 항목 파란 점 강조 |
| Q2 | 읽지 않은 알림 클릭 | 파란 점 사라짐 + link 페이지로 이동 |
| Q3 | "모두 읽음" 클릭 | 전체 알림 강조 해제 |
| Q4 | 칸반 로드 → 서브태스크 있는 카드 | "📋 1/3" 배지 표시 |
| Q5 | 서브태스크 없는 카드 | 배지 없음 |
| Q6 | 태스크 description에 "@홍길동" 입력 후 저장 | workspaceTaskMentions 저장 + 홍길동 알림 수신 |
| Q7 | 멘션된 운영자 알림 탭 확인 | "회의록 태스크에서 멘션" 알림 표시 |
| Q8 | 같은 태스크 재저장 (@홍길동 유지) | 중복 멘션 없음 |
| Q9 | 기존 헤더 알림 벨 드롭다운 정상 | 회귀 없음 |
| Q10 | 기존 태스크 저장 (@멘션 없음) | 정상 저장, 알림 없음 |

---

## §5 mock 데이터 (A용)

```javascript
// MOCK: 알림 수신함
const MOCK_NOTIFICATIONS = {
  ok: true,
  list: [
    { id: 1, category: "workspace", severity: "info",
      title: "태스크 멘션", message: "\"회의록 준비\" 태스크에서 홍길동님이 멘션했습니다.",
      link: "/workspace-kanban.html", isRead: false, createdAt: "2026-05-18T10:00:00Z" },
    { id: 2, category: "legal", severity: "info",
      title: "법률 상담 배정", message: "새 법률 상담이 배정되었습니다.",
      link: "/admin-legal.html", isRead: true, createdAt: "2026-05-18T09:00:00Z" }
  ],
  unreadCount: 1,
  criticalCount: 0
};
const MOCK_NOTIFICATIONS_READ = { ok: true };

// MOCK: 서브태스크 배지용 태스크 목록 (subtaskCount/subtaskDoneCount 포함)
const MOCK_TASK_WITH_SUBTASK = { subtaskCount: 3, subtaskDoneCount: 1 };
```

---

## §6 트리거

### §6.1 B 트리거

```
[B — 라운드 12 백엔드 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/round12-inbox-mention-badge-back (베이스 main 최신)
정독: docs/milestones/2026-05-18-round12-notify-inbox-mention-badge.md §1·§2

영역: 🔧 백엔드 전담 — netlify/functions/, lib/
금지: public/, db/schema.ts (변경 없음), PROJECT_STATE.md, docs/

━━━ 자율주행 정책 — 권한 확인 절대 묻지 말 것 ━━━
  PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "실행해도 되나요" "접속해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
  묻는 건 단 2가지뿐: ① 자기 브랜치 push ② 애매한 설계·로직 결정
  그 외 전부 자율 진행. 막히면 즉시 보고 (30분 이상 헤매지 말 것)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ §2 체크리스트 ━━━
  - [ ] lib/notify-dispatcher.ts — WORKSPACE_MENTION eventType 추가 + 메시지 템플릿
  - [ ] admin-workspace-tasks.ts GET 목록 — subtaskCount·subtaskDoneCount 필드 추가
      별도 GROUP BY 쿼리 후 JS Map 매핑 (drizzle 다중 leftJoin 금지 원칙)
      보조 쿼리 실패해도 빈 객체로 계속 (subtaskCount: 0 폴백)
  - [ ] admin-workspace-tasks.ts POST·PATCH — @멘션 파싱 블록 추가 (fire-and-forget)
      /@([\w가-힣]+)/g 패턴 → members.name ILIKE 매칭
      workspaceTaskMentions INSERT (taskId + mentionedMemberId 중복 방지)
      dispatch(WORKSPACE_MENTION) — 실패해도 throw 없음

━━━ 핵심 주의사항 ━━━
  □ @멘션 파싱은 전부 fire-and-forget — 메인 저장 실패 원인이 되면 안 됨
  □ subtaskCount 보조 쿼리: taskIds 배열 비어있으면 쿼리 스킵
  □ notify-dispatcher.ts 기존 9종 eventType 패턴 정독 후 일관성 유지
  □ npx tsc --noEmit 통과
  □ push 자율 진행 → Swain에게 완료 보고
```

### §6.2 A 트리거

```
[A — 라운드 12 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/round12-inbox-mention-badge-front (베이스 main 최신)
정독: docs/milestones/2026-05-18-round12-notify-inbox-mention-badge.md §3·§5

영역: 🎨 프론트 전담 — public/
금지: lib/, netlify/functions/, db/, PROJECT_STATE.md, docs/

━━━ 자율주행 정책 — 권한 확인 절대 묻지 말 것 ━━━
  PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "실행해도 되나요" "접속해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
  묻는 건 단 2가지뿐: ① 자기 브랜치 push ② 애매한 설계·로직 결정
  그 외 전부 자율 진행. 막히면 즉시 보고 (30분 이상 헤매지 말 것)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ mock 데이터 ━━━
const MOCK_NOTIFICATIONS = { ok:true, list:[{ id:1, category:"workspace", severity:"info", title:"태스크 멘션", message:"\"회의록 준비\" 태스크에서 홍길동님이 멘션했습니다.", link:"/workspace-kanban.html", isRead:false, createdAt:"2026-05-18T10:00:00Z" },{ id:2, category:"legal", severity:"info", title:"법률 상담 배정", message:"새 법률 상담이 배정되었습니다.", link:"/admin-legal.html", isRead:true, createdAt:"2026-05-18T09:00:00Z" }], unreadCount:1, criticalCount:0 };
const MOCK_NOTIFICATIONS_READ = { ok:true };

━━━ §3 화면 체크리스트 ━━━
  - [ ] mypage.html — "📬 알림" 탭 추가 (기존 탭 목록 끝에)
  - [ ] public/js/mypage-notifications.js 신규
      탭 진입: GET /api/notifications-mine → 목록 렌더링
        읽지 않은 항목: 좌측 파란 점 + 배경 강조
      알림 항목 클릭: PATCH /api/notifications-read { id } → 읽음 처리 + link 이동
      "모두 읽음" 버튼: PATCH /api/notifications-read { all:true } → 전체 갱신
      API 실패 시 MOCK_NOTIFICATIONS 폴백
  - [ ] workspace-kanban.js 수정 — 카드 렌더링에 서브태스크 배지 추가
      subtaskCount > 0 이면 "📋 {subtaskDoneCount}/{subtaskCount}" 배지
      기존 체크리스트 배지 옆에 나란히 표시
      subtaskCount/subtaskDoneCount 필드 없으면(구버전 응답) 배지 생략
  - [ ] 캐시버스터:
      mypage.html: mypage-notifications.js?v=1 script 태그 추가
      workspace-kanban.js 참조 페이지: ?v=N+1

━━━ MOCK 제거 점검 (C의 메타 권고 반영) ━━━
  작업 완료 후 자기 브랜치에서 아래 grep 실행하여 잔존 MOCK 없는지 확인:
  grep -r "MOCK_" public/js/mypage-notifications.js public/js/workspace-kanban.js
  잔존 MOCK 발견 시 실 API 직결로 교체 후 커밋

━━━ push 완료 후 ━━━
  push 자율 진행 → Swain에게 완료 보고
```

---

## §7 머지 순서

```
1. B push → 메인 main 머지 (마이그 없음)
2. A push → 메인 main 머지
3. C 검증 → 라운드 12 마감
```
