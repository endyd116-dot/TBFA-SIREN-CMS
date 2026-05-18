# 라운드 11 — 알림 빈틈 보완 + 신고 관리 UI

> **작성**: 2026-05-18 / 메인 채팅
> **추정**: 메인 설계 0.5h / B 백 2h / A 프론트 2h / C 검증 1h / 합계 5.5h
> **모드**: 평행 (A는 mock으로 시작)
> **배경**: R8~R10 구현 후 검증에서 발견된 4개 기능 빈틈 (G-1~G-4) 일괄 보완

---

## §0 빈틈 확인 결과

| ID | 빈틈 | 심각도 | 미구현 근거 |
|---|---|---|---|
| G-1 | 신고 검토 후 원작자·신고자 알림 없음 | 🔴 | `admin-comment-report-review.ts` 내 dispatch 호출 없음 |
| G-2 | 법률 상담 변호사 배정 후 알림 없음 | 🔴 | `legal-consultation-create.ts` 배정 블록 이후 dispatch 없음 |
| G-3 | 신고 목록·검토 어드민 UI 없음 | 🟠 | `admin-comment-reports.html` 미존재 |
| G-4 | reminderConfig 기반 cron 없음 | 🟠 | `cron-workspace-due-reminder.ts`는 dueDate 전용 — reminderConfig(커스텀 날짜+메시지) 실행 없음 |

---

## §1 DB 설계

### 1.1 변경 없음

모든 테이블·컬럼 이미 존재. 마이그레이션 불필요.

- `notify_dispatcher.ts` NotifyEvent 타입에 `COMMENT_REPORT_RESOLVED`, `LEGAL_ASSIGNED` 추가 (TS enum/union 수정)
- cron 등록: `netlify.toml`에 `cron-workspace-task-reminder` 스케줄 추가

---

## §2 API 명세

### 2.1 함수 목록

| 함수 파일 | 변경 종류 | 내용 |
|---|---|---|
| `admin-comment-report-review.ts` | **수정** | 검토 완료 후 dispatch(COMMENT_REPORT_RESOLVED) 추가 |
| `legal-consultation-create.ts` | **수정** | 변호사 배정 후 dispatch(LEGAL_ASSIGNED) 추가 |
| `cron-workspace-task-reminder.ts` | **신규** | reminderConfig.remindAt 만료 태스크 조회 → 담당자 알림 |
| `lib/notify-dispatcher.ts` | **수정** | COMMENT_REPORT_RESOLVED, LEGAL_ASSIGNED eventType 추가 |

### 2.2 함수별 상세

#### `admin-comment-report-review.ts` 수정 (G-1)

기존 `status` 갱신 완료 직후 fire-and-forget으로 추가:

```typescript
// fire-and-forget (실패해도 throw 없음)
try {
  if (body.action === "hide_comment" || body.action === "delete_comment") {
    // 댓글 원작자에게: 댓글이 신고로 숨겨짐
    if (comment?.memberId) {
      await dispatch({ event: "COMMENT_REPORT_RESOLVED", target: { type: "member", id: comment.memberId },
        params: { action: body.action, reason: report.reason } });
    }
    // 신고자에게: 신고가 처리됨
    await dispatch({ event: "COMMENT_REPORT_RESOLVED", target: { type: "member", id: report.memberId },
      params: { action: "reviewed", reason: report.reason } });
  }
} catch (e) { console.warn("notify COMMENT_REPORT_RESOLVED 실패", e); }
```

- comment.memberId 조회: incidentComments WHERE id=report.commentId (기존 SELECT 확장)
- 실패해도 검토 응답은 정상 반환

---

#### `legal-consultation-create.ts` 수정 (G-2)

기존 AI 배정 블록 (`assignedLawyerId` UPDATE) 직후 추가:

```typescript
// 배정된 변호사 알림 (fire-and-forget)
try {
  if (assignedLawyerId) {
    await dispatch({ event: "LEGAL_ASSIGNED", target: { type: "member", id: assignedLawyerId },
      params: { consultationId: newId, specialty: aiSpecialty } });
  }
} catch (e) { console.warn("notify LEGAL_ASSIGNED 실패", e); }
```

---

#### `cron-workspace-task-reminder.ts` 신규 (G-4)

```
경로: netlify/functions/cron-workspace-task-reminder.ts
스케줄: "*/15 * * * *" (15분마다)
```

**처리 단계**:
1. `select_due` — workspace_tasks WHERE:
   - `reminder_config IS NOT NULL`
   - `reminder_config->>'remindAt' IS NOT NULL`
   - `reminder_config->>'firedAt' IS NULL` (중복 발송 방지)
   - `(reminder_config->>'remindAt')::timestamptz <= NOW() + interval '2 minutes'`
2. `notify` — 각 태스크: `dispatch({ event: "WORKSPACE_ACTIVITY", target: { type: "member", id: task.assignedTo || task.memberId }, params: { taskId, title, message: reminderConfig.message } })`
3. `mark_fired` — `UPDATE workspace_tasks SET reminder_config = reminder_config || '{"firedAt":"<now>"}'::jsonb WHERE id IN (...)`
4. 응답: `{ ok: true, fired: N }`

**netlify.toml 추가**:
```toml
[[plugins]]
  [functions."cron-workspace-task-reminder"]
    schedule = "*/15 * * * *"
```

---

#### `lib/notify-dispatcher.ts` 수정 (G-1·G-2 공통)

NotifyEvent 타입 union에 추가:

```typescript
// 기존 9종에 추가
| "COMMENT_REPORT_RESOLVED"   // 신고 검토 완료
| "LEGAL_ASSIGNED"             // 법률 상담 변호사 배정
```

각 event에 대한 메시지 템플릿 추가 (기존 패턴 참고):
- COMMENT_REPORT_RESOLVED (원작자): "작성하신 댓글이 신고에 의해 처리되었습니다."
- COMMENT_REPORT_RESOLVED (신고자): "신고하신 댓글이 검토 완료되었습니다."
- LEGAL_ASSIGNED: "새 법률 상담이 배정되었습니다. 확인해 주세요."

---

## §3 화면 명세 (G-3)

### 3.1 신규 페이지: `admin-comment-reports.html` + `.js`

```
┌─ 신고 관리 ─────────────────────────────────────────┐
│  [전체] [검토대기] [처리완료] [기각]  (필터 탭)      │
│                                                     │
│  ID  종류    사유          신고자    일시     상태    │
│  77  댓글  욕설/혐오 발언  홍길동  05-18  🟡 대기   [검토]│
│  78  사건  허위사실        김영희  05-18  ✅ 완료   [검토]│
│  ...                                                │
│  [이전] 1 2 3 [다음]                                │
└─────────────────────────────────────────────────────┘
```

**검토 모달**:
```
┌─ 신고 검토 ──────────────────────────────────────┐
│  신고 사유: 욕설/혐오 발언                        │
│  해당 댓글: "[원본 댓글 텍스트]"                  │
│                                                  │
│  처리 방법:                                       │
│  ○ 조치 없음      ○ 댓글 숨기기    ○ 댓글 삭제  │
│                                                  │
│  [취소]  [처리 완료]                              │
└──────────────────────────────────────────────────┘
```

### 3.2 사이드바 등록 (iframe 4곳)

`cms-tbfa.html` 내 어드민 사이드바 메뉴에 "신고 관리" 항목 추가:
- HTML 2곳 (메뉴 li + iframe src)
- JS 2곳 (메뉴 클릭 핸들러 + 라우팅)

### 3.3 사용자 동작 → API 매핑

| 동작 | API | 응답 |
|---|---|---|
| 신고 목록 로드 | GET `/api/admin-comment-reports?status=pending&page=1` | 목록 렌더링 |
| 필터 탭 변경 | GET `/api/admin-comment-reports?status=X` | 목록 갱신 |
| [검토] → 처리 방법 선택 → [처리 완료] | PATCH `/api/admin-comment-report-review` | 행 상태 갱신 + "처리되었습니다." 토스트 |

### 3.4 토스트 문구

| 상황 | 문구 |
|---|---|
| 검토 처리 완료 | "처리되었습니다." |
| 조치 없음 기각 | "신고가 기각되었습니다." |

### 3.5 캐시버스터

- `admin-comment-reports.js?v=1` (신규)

---

## §4 검증 시나리오

| # | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | 어드민 신고 목록 페이지 진입 | 신고 목록 표시, 필터 탭 작동 |
| Q2 | 신고 [검토] → 댓글 숨기기 선택 → 처리 완료 | "처리되었습니다." 토스트 + 상태 "처리완료"로 변경 |
| Q3 | 처리 후 원작자 인앱 알림 수신 여부 | 알림 발생 (inapp) |
| Q4 | 처리 후 신고자 인앱 알림 수신 여부 | 알림 발생 (inapp) |
| Q5 | 법률 상담 신청 → AI 변호사 배정 → 변호사 알림 | 배정된 변호사에게 "새 법률 상담이 배정되었습니다." 알림 |
| Q6 | 워크스페이스 태스크에 reminderConfig 설정 (remindAt=지금+1분) → 15분 이내 알림 수신 | 담당자에게 알림 발송, reminderConfig.firedAt 기록 |
| Q7 | 같은 remindAt 태스크 두 번 cron 실행 | 중복 발송 없음 (firedAt 마킹 확인) |
| Q8 | 기존 신고·투표·채팅 기능 회귀 없음 | 정상 작동 |

---

## §5 mock 데이터 (A용)

```javascript
// MOCK: 신고 목록
const MOCK_COMMENT_REPORTS = {
  ok: true,
  reports: [
    { id: 77, reportType: "comment", commentId: 33, incidentId: null,
      reason: "욕설/혐오 발언", status: "pending", reporterName: "홍길동",
      createdAt: "2026-05-18T10:00:00Z" },
    { id: 78, reportType: "incident", commentId: null, incidentId: 5,
      reason: "허위사실 유포", status: "reviewed", reporterName: "김영희",
      createdAt: "2026-05-18T09:00:00Z" }
  ],
  total: 2
};

// MOCK: 검토 처리
const MOCK_REPORT_REVIEW = { ok: true };
```

---

## §6 트리거

### §6.1 B 트리거

```
[B — 라운드 11 백엔드 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/round11-notify-gaps-back (베이스 main @ 2b6d34b)
정독: docs/milestones/2026-05-18-round11-notify-gaps.md §1·§2

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
  - [ ] lib/notify-dispatcher.ts 수정 — COMMENT_REPORT_RESOLVED, LEGAL_ASSIGNED eventType 추가 + 메시지 템플릿
  - [ ] admin-comment-report-review.ts 수정 — 처리 완료 직후 fire-and-forget dispatch() 추가
      comment.memberId 조회: 기존 SELECT에 incidentComments 포함 확장
      신고자(report.memberId) + 원작자(comment.memberId) 양쪽 알림
  - [ ] legal-consultation-create.ts 수정 — assignedLawyerId 저장 직후 dispatch(LEGAL_ASSIGNED) 추가
  - [ ] cron-workspace-task-reminder.ts 신규
      스케줄: "*/15 * * * *"
      reminder_config->>'firedAt' IS NULL + remindAt <= NOW()+2min 조회
      dispatch(WORKSPACE_ACTIVITY) → reminder_config에 firedAt JSONB merge UPDATE
  - [ ] netlify.toml — cron-workspace-task-reminder 스케줄 추가

━━━ 핵심 주의사항 ━━━
  □ dispatch()는 모두 fire-and-forget — try/catch + console.warn, throw 금지
  □ notify-dispatcher.ts의 기존 eventType·패턴 정독 후 일관성 맞출 것
  □ cron firedAt 마킹: UPDATE SET reminder_config = reminder_config || '{"firedAt":"..."}'::jsonb
  □ npx tsc --noEmit 통과
  □ push 완료 후 Swain에게 보고 (push 자율 진행, 허락 묻지 말 것)
```

### §6.2 A 트리거

```
[A — 라운드 11 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/round11-notify-gaps-front (베이스 main @ 2b6d34b)
정독: docs/milestones/2026-05-18-round11-notify-gaps.md §3·§5

영역: 🎨 프론트 전담 — public/
금지: lib/, netlify/functions/, db/, PROJECT_STATE.md, docs/

━━━ 자율주행 정책 — 권한 확인 절대 묻지 말 것 ━━━
  PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "실행해도 되나요" "접속해도 되나요" 류 권한 질문 금지 — 바로 실행할 것.
  묻는 건 단 2가지뿐: ① 자기 브랜치 push ② 애매한 설계·로직 결정
  그 외 전부 자율 진행. 막히면 즉시 보고 (30분 이상 헤매지 말 것)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ mock 데이터 (B 머지 전까지 사용) ━━━
const MOCK_COMMENT_REPORTS = { ok:true, reports:[{ id:77, reportType:"comment", commentId:33, incidentId:null, reason:"욕설/혐오 발언", status:"pending", reporterName:"홍길동", createdAt:"2026-05-18T10:00:00Z" },{ id:78, reportType:"incident", commentId:null, incidentId:5, reason:"허위사실 유포", status:"reviewed", reporterName:"김영희", createdAt:"2026-05-18T09:00:00Z" }], total:2 };
const MOCK_REPORT_REVIEW = { ok:true };

━━━ §3 화면 체크리스트 ━━━
  - [ ] public/admin-comment-reports.html 신규
      상단 필터 탭: 전체/검토대기/처리완료/기각
      신고 목록 테이블: id, 종류(comment/incident), 사유, 신고자, 일시, 상태, [검토] 버튼
      페이지네이션 (page/limit)
      진입 시 MOCK_COMMENT_REPORTS 사용
  - [ ] public/js/admin-comment-reports.js 신규
      GET /api/admin-comment-reports?status=X&page=1 호출 → 목록 렌더링
      [검토] 버튼 → 처리 방법 선택 모달 (none/hide_comment/delete_comment)
      PATCH /api/admin-comment-report-review → "처리되었습니다." 토스트 + 행 상태 갱신
      API 실패 시 MOCK_COMMENT_REPORTS / MOCK_REPORT_REVIEW 폴백
  - [ ] cms-tbfa.html 사이드바 — "신고 관리" 메뉴 추가 (iframe 4곳 등록 필수)
      HTML 2곳: 사이드바 메뉴 li + iframe src 목록
      JS 2곳: 메뉴 클릭 핸들러 + 라우팅 분기
  - [ ] 캐시버스터: admin-comment-reports.js?v=1 (신규이므로 v=1)

━━━ push 완료 후 ━━━
  push 자율 진행 (허락 묻지 말 것) → Swain에게 완료 보고
```

### §6.3 C 트리거

```
[C — 라운드 11 검증]
워크트리: tbfa-mis-C  브랜치: verify/round11
정독: docs/milestones/2026-05-18-round11-notify-gaps.md §4
Q1~Q8 라이브 시나리오 검증.
보고서: docs/verify/2026-05-18-round11.md
push 자율 진행 후 Swain에게 보고.
```

---

## §7 머지 순서

```
1. B push → 메인 main 머지
2. DB 마이그레이션 없으므로 바로
3. A push → 메인 main 머지
4. C 검증 → 라운드 11 마감
```
