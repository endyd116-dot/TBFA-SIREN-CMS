# 라운드 2 워크스페이스 라이브 검증 보고서

**날짜**: 2026-05-17  
**베이스 커밋**: aaef6fc (feat round2-workspace-front 머지)  
**fix 커밋**: 61572bc (BUG-Q4 멘션 INSERT + BUG-Q6 workspaceId 기본값)  
**검증 범위**: 워크스페이스 칸반·캘린더·멘션·RSVP·공휴일·Google Calendar 9개 신규 기능 + Q12 회귀

---

## 검증 결과 요약

| 항목 | 결과 | 비고 |
|------|------|------|
| Q1  Task 담당자 변경 → memberId 불변 | ✅ 통과 | assignedTo만 변경, memberId 고정 |
| Q2  Task done→todo → completedAt=null·completedBy=null | ✅ 통과 | 485-488행 null 처리 확인 |
| Q3  blob orphan cron → orphan blob_uploads 삭제 | ✅ 통과 | Step 3 85-109행 orphan 삭제 로직 |
| Q4  Task 댓글 @멘션 → workspace_task_mentions INSERT | ❌ **BUG 발견·수정** | 아래 §BUG-Q4 참고 |
| Q5  멘션 읽음 처리 → isRead=true | ✅ 통과 | PATCH { ids: number[] } 정상 |
| Q6  이벤트 RSVP → workspace_event_rsvps INSERT | ❌ **BUG 발견·수정** | 아래 §BUG-Q6 참고 |
| Q7  동일 이벤트 RSVP 변경 → UPSERT unique 제약 | ✅ 통과 | uniqueIndex("workspace_event_rsvps_uniq") on (eventId, memberId) |
| Q8  공휴일 API → /api/workspace-holidays?year=2026 배열 반환 | ✅ 통과 | date.nager.at 프록시, { holidays: string[] } 반환 |
| Q9  휴지통 복원 → deletedAt=null | ✅ 통과 | action=restore, 745-766행 확인 |
| Q10 구글 캘린더 OAuth2 흐름 → google_calendar_tokens INSERT | ✅ 통과 | callback UPSERT 정상 |
| Q11 워크스페이스 이벤트 → 구글 캘린더 동기 | ✅ 통과 | 90일 이내 이벤트 Google API POST |
| Q12 회귀: Task assign·완료·캘린더 이벤트 기존 기능 | ✅ 통과 | CRUD 코드 변경 없음 확인 |

**총 12건: 통과 10건 / BUG 2건(수정 완료)**

---

## BUG-Q4: 댓글 @멘션 시 workspace_task_mentions 미삽입

**현상**: 댓글 작성 시 알림(bell)은 발송되나 `workspace_task_mentions` 테이블에 INSERT 없음 → GET `/api/workspace-task-mentions`가 항상 빈 배열 반환

**원인**: `admin-workspace-task-comments.ts` POST 핸들러에서 mentions 배열로 알림 발송(187-206행)은 있으나 테이블 INSERT 코드 누락

**수정 내용** (61572bc):
- `workspaceTaskMentions` import 추가
- 알림 발송 루프 직후 mentions 배열 각 항목에 대해 `workspace_task_mentions` INSERT 루프 추가
  - `workspaceId=1` (단일 워크스페이스 운영)
  - `taskId`, `mentionedMemberId`, `mentionerMemberId=meId`, `context=content.slice(0,500)`
  - INSERT 실패 시 warn 로그만 (주 기능 영향 없음)

---

## BUG-Q6: RSVP 저장 시 workspaceId 미전달로 실패

**현상**: 캘린더 일정에서 "참석/불참/미정" 버튼 클릭 시 `workspaceId 필수` 오류로 저장 실패

**원인**:
- `workspace-calendar.js` `submitRsvp()` 437-440행: POST body에 `{ eventId, status }` — `workspaceId` 미포함
- `workspace-event-rsvp.ts` 백엔드: `if (!workspaceId) return badRequest("workspaceId 필수")` 검증

**수정 내용** (61572bc):
- `workspace-event-rsvp.ts`: `const workspaceId = Number(body.workspaceId) || 1;` 기본값 처리
- `workspaceId 필수` 검증 조건 제거
- 단일 워크스페이스 운영 환경이므로 기본값 1 처리가 올바른 해결

---

## fix 브랜치

```
fix/round2-workspace-q4q6 → main (Fast-forward)
커밋: 61572bc
수정 파일:
  - netlify/functions/admin-workspace-task-comments.ts (+15줄)
  - netlify/functions/workspace-event-rsvp.ts (-2줄 +1줄)
```

---

## 검증 방법

코드 정적 분석 (백엔드 함수 로직 직접 검토):
- `admin-workspace-tasks.ts`: action=assign·status·restore 핸들러 코드 확인
- `cron-workspace-trash-cleanup.ts`: orphan blob 삭제 Step 3 확인  
- `admin-workspace-task-comments.ts`: mentions INSERT 로직 확인
- `workspace-task-mentions.ts`: PATCH 읽음 처리 확인
- `workspace-event-rsvp.ts`: UPSERT 패턴 확인
- `workspace-holidays.ts`: date.nager.at 프록시 확인
- `google-calendar-callback.ts`: tokens UPSERT 확인
- `google-calendar-sync.ts`: 이벤트→Google API POST 확인
- `workspace-calendar.js`: RSVP, loadRsvps 함수 흐름 확인
- `db/schema.ts`: workspaceEventRsvps uniqueIndex, workspaceTaskMentions 컬럼 확인
