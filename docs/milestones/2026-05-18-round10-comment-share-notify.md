# 라운드 10 — 댓글 투표/신고 + 파일 공유 + 알림 구독 + AI 법률 자동 배정

> **작성**: 2026-05-18 / 메인 채팅
> **추정**: 메인 설계 1h / B 백 3h / A 프론트 3h / C 검증 2h / 합계 9h
> **모드**: 평행 (A는 mock으로 시작)

---

## §0 요구사항 확정

| 항목 | 결정 |
|---|---|
| 댓글 투표 대상 | incidentComments (사건 보고 댓글), commentVotes.commentId → incidentComments |
| 댓글 신고 대상 | incidentComments + incidents (테이블 컬럼 그대로) |
| 파일 공유 | 워크스페이스 파일함 내 파일, 어드민간 공유 |
| 알림 구독 | 사용자별 eventType/채널 설정, upsert 방식 |
| AI 법률 배정 | 법률 상담 신청 create 시 aiLawyerSpecialty 분석 → assignedLawyerId 자동 설정 |

---

## §1 DB 설계

### 1.1 신규 테이블
없음 (commentVotes, commentReports, workspaceFileShares, notificationPreferences 모두 존재)

### 1.2 기존 테이블 컬럼 추가
없음

### 1.3 마이그레이션
불필요

---

## §2 API 명세

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `comment-vote.ts` | `/api/comment-vote` | POST | requireActiveUser | 댓글 투표 (토글) |
| `comment-report.ts` | `/api/comment-report` | POST | requireActiveUser | 댓글/사건 신고 |
| `admin-comment-reports.ts` | `/api/admin-comment-reports` | GET | requireAdmin | 신고 목록 조회 |
| `admin-comment-report-review.ts` | `/api/admin-comment-report-review` | PATCH | requireAdmin | 신고 검토 처리 |
| `workspace-file-share.ts` | `/api/workspace-file-share` | POST/GET/DELETE | requireAdmin | 파일 공유 CRUD |
| `notification-preferences.ts` | `/api/notification-preferences` | GET/PUT | requireActiveUser | 알림 구독 설정 |
| `legal-consultation-create.ts` (수정) | `/api/legal-consultation-create` | POST | requireActiveUser | AI 자동 배정 추가 |

### 2.2 함수별 상세

#### `comment-vote` (POST `/api/comment-vote`)

**요청**:
```json
{ "commentId": 33, "voteType": "up" }
```

**응답**:
```json
{ "ok": true, "action": "added", "upCount": 5, "downCount": 1 }
```
action: "added" | "removed" (이미 같은 타입 투표 → 취소)

**처리 단계**:
1. `auth` — requireActiveUser
2. `validate` — commentId, voteType ("up"|"down") 필수
3. `check_existing` — commentVotes WHERE commentId=? AND memberId=auth.uid
4. `toggle` — 같은 voteType 존재 → DELETE (취소). 없으면 INSERT (다른 타입 있으면 UPDATE)
5. `count` — 해당 commentId의 up/down 카운트 집계
6. `map` — { ok, action, upCount, downCount }

---

#### `comment-report` (POST `/api/comment-report`)

**요청**:
```json
{
  "commentId": 33,
  "incidentId": null,
  "reportType": "comment",
  "reason": "욕설/혐오 발언"
}
```

**응답**:
```json
{ "ok": true, "reportId": 77 }
```

**처리 단계**:
1. `auth` — requireActiveUser
2. `validate` — reportType ("comment"|"incident"), reason 필수. commentId 또는 incidentId 중 하나 필수
3. `check_duplicate` — 동일 commentId/memberId 이미 신고한 경우 → 409 "이미 신고한 항목입니다."
4. `insert` — commentReports INSERT
5. `map`

---

#### `admin-comment-reports` (GET `/api/admin-comment-reports`)

**요청**: `?status=pending&page=1&limit=20`

**응답**:
```json
{
  "ok": true,
  "reports": [
    {
      "id": 77, "reportType": "comment", "commentId": 33,
      "reason": "욕설", "status": "pending",
      "reporterName": "홍길동", "createdAt": "2026-05-18T10:00:00Z"
    }
  ],
  "total": 5
}
```

---

#### `admin-comment-report-review` (PATCH)

**요청**:
```json
{ "reportId": 77, "status": "dismissed", "action": "hide_comment" }
```
action: "none" | "hide_comment" | "delete_comment"

**응답**:
```json
{ "ok": true }
```

---

#### `workspace-file-share` (POST/GET/DELETE)

**POST — 공유 생성**:
```json
{ "targetType": "file", "targetId": 10, "sharedWith": 5, "permission": "view", "expiresAt": null }
```
응답: `{ "ok": true, "shareId": 20 }`

**GET — 공유 목록**:
`?targetType=file&targetId=10`
응답: `{ "ok": true, "shares": [{ "id": 20, "sharedWith": 5, "permission": "view", "expiresAt": null }] }`

**DELETE — 공유 취소**:
`{ "shareId": 20 }`
응답: `{ "ok": true }`

**처리 단계 (모든 메서드)**:
1. `auth` — requireAdmin
2. `validate`
3. `insert/select/delete` — workspaceFileShares CRUD
4. `map`

---

#### `notification-preferences` (GET/PUT `/api/notification-preferences`)

**GET 응답**:
```json
{
  "ok": true,
  "preferences": [
    { "eventType": "support_status_change", "channels": ["inapp", "email"] },
    { "eventType": "incident_reply", "channels": ["inapp"] },
    { "eventType": "donation_confirmed", "channels": ["inapp", "email", "sms"] }
  ]
}
```

**PUT 요청**:
```json
{
  "preferences": [
    { "eventType": "support_status_change", "channels": ["inapp"] },
    { "eventType": "donation_confirmed", "channels": ["inapp", "email"] }
  ]
}
```

**응답**: `{ "ok": true }`

**처리 단계 (PUT)**:
1. `auth` — requireActiveUser
2. `validate` — preferences 배열 필수
3. `upsert` — 각 eventType에 대해 INSERT ON CONFLICT (memberId, eventType) DO UPDATE
4. `map`

---

#### `legal-consultation-create.ts` 수정 — AI 자동 배정

기존 법률 상담 신청 생성 완료 후 (fire-and-forget):
```
AI aiLawyerSpecialty 분석 결과(aiLawyerSpecialty 컬럼) 있으면
→ members 테이블에서 role='operator', expertSpecialty LIKE aiLawyerSpecialty 매칭
→ 첫 번째 매칭 운영자 ID를 assignedLawyerId에 업데이트
→ 해당 운영자에게 알림 발송
실패 시 throw 없음 (fire-and-forget)
```

---

## §3 화면 명세

### 3.1 페이지 목록

| 페이지/JS | 수정 내용 |
|---|---|
| `incident.js` / `incident.html` | 사건 댓글에 👍/👎 투표 버튼 + 신고 버튼 |
| `workspace-files.html` / `workspace-files.js` | 파일 행에 "공유" 버튼 + 공유 모달 |
| `settings-notifications.html` / `settings-notifications.js` | 알림 구독 설정 페이지 완성 |

### 3.2 댓글 투표/신고 UI

```
[댓글 내용 텍스트]
👍 5  👎 1  [신고]
```
- 본인 투표: 해당 버튼 강조(파란색)
- 신고 클릭 → 신고 사유 선택 모달

### 3.3 파일 공유 모달

```
┌─ 파일 공유 ──────────────────────┐
│  공유할 운영자: [드롭다운]       │
│  권한: ○ 보기  ○ 수정           │
│  만료일: [날짜 선택] (선택)      │
│  [현재 공유 목록]                │
│  [취소]  [공유]                  │
└──────────────────────────────────┘
```

### 3.4 알림 구독 설정 페이지

```
┌─ 알림 설정 ───────────────────────────────────┐
│  이벤트               인앱  이메일  SMS        │
│  ─────────────────────────────────────────    │
│  유가족 신청 상태 변경  ☑     ☑      ☐         │
│  사건 보고 댓글        ☑     ☐      ☐         │
│  후원 결제 완료        ☑     ☑      ☑         │
│  워크스페이스 멘션     ☑     ☐      ☐         │
│                                              │
│  [저장]                                       │
└──────────────────────────────────────────────┘
```

### 3.5 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 응답 처리 |
|---|---|---|
| 댓글 👍/👎 클릭 | `/api/comment-vote` | 버튼 카운트 즉시 갱신, 본인 투표 강조 |
| 댓글 "신고" 클릭 → 사유 선택 → 제출 | `/api/comment-report` | "신고되었습니다." 토스트 |
| 파일 "공유" 클릭 → 운영자 선택 → 공유 | `/api/workspace-file-share` (POST) | 공유 목록 갱신 |
| 공유 목록에서 "취소" | `/api/workspace-file-share` (DELETE) | 공유 목록에서 제거 |
| 알림 설정 변경 후 "저장" | `/api/notification-preferences` (PUT) | "저장되었습니다." 토스트 |

### 3.6 토스트 문구

| 상황 | 문구 |
|---|---|
| 투표 추가 | "투표했습니다." |
| 투표 취소 | "투표가 취소되었습니다." |
| 신고 완료 | "신고되었습니다. 검토 후 처리됩니다." |
| 중복 신고 | "이미 신고한 항목입니다." |
| 파일 공유 | "공유되었습니다." |
| 공유 취소 | "공유가 취소되었습니다." |
| 알림 설정 저장 | "알림 설정이 저장되었습니다." |

### 3.7 캐시버스터

- `incident.js?v=N+1`
- `workspace-files.js?v=N+1`
- `settings-notifications.js?v=N+1`

---

## §4 검증 시나리오

| # | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | 사건 보고 상세에서 댓글 👍 클릭 | 카운트 +1, 버튼 파란색 강조 |
| Q2 | 같은 댓글 👍 다시 클릭 | 카운트 -1 (토글 취소) |
| Q3 | 댓글 "신고" 클릭 → 욕설 사유 선택 → 제출 | "신고되었습니다." 토스트, DB에 pending 상태로 저장 |
| Q4 | 같은 댓글 다시 신고 시도 | "이미 신고한 항목입니다." |
| Q5 | 어드민이 신고 목록 조회 | 신고 목록 표시, status=pending 필터 작동 |
| Q6 | 어드민이 신고 검토 후 댓글 숨김 처리 | 해당 댓글 isHidden=true, 화면에서 숨겨짐 |
| Q7 | 파일함에서 파일 "공유" → 운영자 선택 → 공유 | 공유 목록에 추가, DB 저장 |
| Q8 | 파일 공유 목록에서 "취소" | 목록에서 제거, DB 삭제 |
| Q9 | 알림 설정에서 "후원 결제 완료 - 인앱만" 으로 변경 후 저장 | DB에 channels=["inapp"] 저장, 새로고침 후 반영 |
| Q10 | 법률 상담 신청 후 AI가 전문가 배정 (fire-and-forget) | assignedLawyerId 자동 설정 (백그라운드, 수초 내) |
| Q11 | 기존 사건 댓글 작성/삭제 회귀 없음 | 정상 작동 |
| Q12 | 기존 알림 수신 회귀 없음 | 기존 inapp 알림 정상 |

---

## §5 mock 데이터 (A용)

```javascript
// MOCK: 댓글 투표
const MOCK_VOTE = { ok: true, action: "added", upCount: 5, downCount: 1 };

// MOCK: 댓글 신고
const MOCK_COMMENT_REPORT = { ok: true, reportId: 77 };

// MOCK: 파일 공유 생성
const MOCK_FILE_SHARE_CREATE = { ok: true, shareId: 20 };

// MOCK: 파일 공유 목록
const MOCK_FILE_SHARES = {
  ok: true,
  shares: [{ id: 20, sharedWith: 5, permission: "view", expiresAt: null }]
};

// MOCK: 알림 구독 설정 조회
const MOCK_NOTIFICATION_PREFS = {
  ok: true,
  preferences: [
    { eventType: "support_status_change", channels: ["inapp", "email"] },
    { eventType: "donation_confirmed", channels: ["inapp", "email", "sms"] },
    { eventType: "workspace_mention", channels: ["inapp"] }
  ]
};

// MOCK: 알림 구독 저장
const MOCK_PREFS_SAVE = { ok: true };
```

---

## §6 트리거

### §6.1 B 트리거

```
[B — 라운드 10 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/round10-comment-share-back (베이스 main @ 라운드9 완료 커밋)
정독: docs/milestones/2026-05-18-round10-comment-share-notify.md §1·§2

영역: netlify/functions/, lib/
금지: public/, db/schema.ts (변경 없음), PROJECT_STATE.md, docs/

━━━ §1 DB 체크리스트 ━━━
  - [ ] DB 마이그레이션 불필요
  - [ ] schema.ts 변경 없음

━━━ §2 API 체크리스트 ━━━
  - [ ] comment-vote.ts — /api/comment-vote POST requireActiveUser, 토글 로직
  - [ ] comment-report.ts — /api/comment-report POST requireActiveUser, 중복 체크
  - [ ] admin-comment-reports.ts — /api/admin-comment-reports GET requireAdmin
  - [ ] admin-comment-report-review.ts — /api/admin-comment-report-review PATCH requireAdmin
      action="hide_comment" → incidentComments SET isHidden=true
  - [ ] workspace-file-share.ts — /api/workspace-file-share POST/GET/DELETE requireAdmin
      메서드별 분기 처리
  - [ ] notification-preferences.ts — /api/notification-preferences GET/PUT requireActiveUser
      PUT: upsert (memberId, eventType) unique index 활용
  - [ ] legal-consultation-create.ts 수정 — 생성 완료 후 fire-and-forget AI 배정 블록 추가
      실패 시 throw 없음, console.warn만

━━━ 응답 구조 (키명 임의 변경 금지) ━━━
  vote:            { ok, action, upCount, downCount }
  comment-report:  { ok, reportId }
  comment-reports GET: { ok, reports:[{id,reportType,commentId,reason,status,reporterName,createdAt}], total }
  report-review:   { ok }
  file-share POST: { ok, shareId }
  file-share GET:  { ok, shares:[{id,sharedWith,permission,expiresAt}] }
  file-share DELETE: { ok }
  notification GET: { ok, preferences:[{eventType,channels}] }
  notification PUT: { ok }

━━━ push 전 체크 ━━━
  □ export const config = { path } 6개 신규 파일 전부 (legal-consultation-create 기존 파일 제외)
  □ npx tsc --noEmit 통과
  □ comment-vote 토글 로직: 같은 voteType → DELETE, 없으면 UPSERT
  □ notification-preferences PUT: INSERT ON CONFLICT (memberId, eventType) DO UPDATE
```

### §6.2 A 트리거

```
[A — 라운드 10 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/round10-comment-share-front (베이스 main @ 라운드9 완료 커밋)
정독: docs/milestones/2026-05-18-round10-comment-share-notify.md §3

영역: public/
금지: lib/, netlify/functions/, db/, PROJECT_STATE.md, docs/

━━━ mock 데이터 ━━━
const MOCK_VOTE = { ok:true, action:"added", upCount:5, downCount:1 };
const MOCK_COMMENT_REPORT = { ok:true, reportId:77 };
const MOCK_FILE_SHARE_CREATE = { ok:true, shareId:20 };
const MOCK_FILE_SHARES = { ok:true, shares:[{id:20,sharedWith:5,permission:"view",expiresAt:null}] };
const MOCK_NOTIFICATION_PREFS = { ok:true, preferences:[{eventType:"support_status_change",channels:["inapp","email"]},{eventType:"donation_confirmed",channels:["inapp","email","sms"]},{eventType:"workspace_mention",channels:["inapp"]}] };
const MOCK_PREFS_SAVE = { ok:true };

━━━ §3 화면 체크리스트 ━━━
  - [ ] incident.js / incident.html: 사건 댓글 아래 👍 N  👎 N  [신고] 버튼 추가
      투표 클릭 → MOCK_VOTE 사용, 버튼 강조 토글
      신고 클릭 → 신고 사유 모달 → MOCK_COMMENT_REPORT
  - [ ] workspace-files.js / workspace-files.html: 파일 행에 "공유" 아이콘 버튼
      클릭 → 공유 모달 (운영자 선택 + 권한) → MOCK_FILE_SHARE_CREATE
      공유 목록 표시 → MOCK_FILE_SHARES
      공유 취소 버튼 → { ok:true }
  - [ ] settings-notifications.html / settings-notifications.js: 이벤트별 채널 체크박스 테이블
      페이지 진입 시 → MOCK_NOTIFICATION_PREFS 로드
      저장 버튼 → MOCK_PREFS_SAVE
  - [ ] 캐시버스터: incident.js?v=N+1, workspace-files.js?v=N+1, settings-notifications.js?v=N+1
```

### §6.3 C 트리거

```
[C — 라운드 10 검증]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/round10 (베이스 main @ B·A 머지 후 커밋)
정독: docs/milestones/2026-05-18-round10-comment-share-notify.md §4

Q1~Q12 라이브 시나리오 순서대로 검증.
보고서: docs/verify/2026-05-18-round10.md
```

---

## §7 머지 순서

```
1. B push → 메인 main 머지
2. DB 마이그레이션 없으므로 바로
3. A push → 메인 main 머지
4. C 검증 → 라운드 10 마감
```
