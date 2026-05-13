# 검증 브리핑 — AI 에이전트 Phase 1 (워크스페이스 CRUD 12개)

> **C 채팅 전용 브리핑**.
> 단일 책무: 라이브 환경에서 새 도구 12개가 의도대로 작동하는지 검증, 결과를 본 브랜치에 기록·푸시.
> **코드 수정 금지** (회귀 fix 등은 메인 채팅에 보고만).

---

## 1. 작업 정체성

| 항목 | 값 |
|---|---|
| 브랜치 | `verify/ai-agent-phase1` (origin/feature/ai-cost-safety 기준) |
| 워크트리 | `c:\Users\Administrator\Desktop\작업\dev\tbfa-mis-C` |
| 라이브 URL | `https://feature-ai-cost-safety--tbfa-siren-cms.netlify.app` (preview) |
| 검증 대상 커밋 | `e87fbd1` (feat(ai-agent): Phase 1 워크스페이스 CRUD 12개 도구 추가) |
| 메인 채팅 | feature/ai-cost-safety 작업 진행 중 — C는 라이브 검증·보고만 |

---

## 2. 검증 전제 조건 (Swain 액션 후 진행)

1. **마이그 호출 완료 확인**
   - Swain이 어드민 로그인 후 호출: `GET /api/migrate-ai-tools-phase1ws?run=1`
   - 응답 `seed_memos_list ... seed_files_list 12개 모두 ok` 확인됨
2. **배포 완료**
   - `git log origin/feature/ai-cost-safety` 최신 커밋이 e87fbd1 이상
   - Netlify 배포 끝 (보통 3~5분)
3. **어드민 로그인 세션 살아있음** (라이브 검증 시 AI 비서 채팅 사용)

---

## 3. 검증 시나리오 (15개, 메모 → 캘린더 → 댓글 → 작업 삭제 → 파일)

### 3-1. 메모 (memos_list / memo_create / memo_update / memo_delete)

| # | 명령 (AI 비서에 입력) | 기대 동작 | 통과 기준 |
|---|---|---|---|
| M1 | "내 메모 보여줘" | `memos_list` 호출 → pinned 우선 정렬 | 조회 즉시(3초↓), 빈 리스트도 정상 |
| M2 | "노란 메모로 'Phase 1 검증 시작' 만들어줘" | `memo_create` dry-run → 미리보기(color=yellow, content=Phase 1 검증 시작) | dry-run 응답 화면에 표시 |
| M3 | M2 dry-run 후 "응" / "진행" | `memo_create` 실제 INSERT | `memo_id` 반환, 워크스페이스 메모 탭에서 실물 확인 |
| M4 | "방금 만든 메모 분홍색으로 바꿔줘" | `memo_update` dry-run → "OK" → color=pink | UPDATE 성공, UI 새로고침 시 색 변경 |
| M5 | "그 메모 고정해줘" | `memo_update` isPinned=true | pinned 최상단 표시 |
| M6 | "그 메모 지워줘" | `memo_delete` dry-run("영구 삭제됩니다") → "확인" → DELETE | 메모 사라짐, rollbackData에 before 포함 |

### 3-2. 캘린더 일정 (events_list / event_create / event_update / event_delete)

| # | 명령 | 기대 동작 | 통과 기준 |
|---|---|---|---|
| E1 | "이번 주 일정 보여줘" | `events_list` fromDate=오늘, toDate=+7d | 빈 리스트도 정상 |
| E2 | "내일 오후 3시에 '박두용 미팅' 1시간 잡아줘" | `event_create` dry-run (startAt=내일 15:00, endAt=16:00, eventType=meeting) | dry-run preview에 정확한 시각 |
| E3 | E2 dry-run 후 "진행" | INSERT 성공 | `event_id` 반환, 캘린더 탭에 표시 |
| E4 | "그 미팅 위치를 '본부 회의실'로 추가해줘" | `event_update` location 패치 | UPDATE 성공 |
| E5 | "그 일정 지워줘" | `event_delete` dry-run → 승인 → DELETE | 일정 사라짐 |

### 3-3. 작업 댓글 + 작업 삭제 (task_comments_list / task_comment_add / task_delete)

| # | 명령 | 기대 동작 | 통과 기준 |
|---|---|---|---|
| T1 | (작업 카드 1개 미리 생성 필요 — `task_create`로 'Phase 1 검증용 더미 작업' 만들기) | dry-run + 승인 → 작업 ID 메모 | task_id 확인 |
| T2 | "방금 만든 작업에 댓글 '검증 진행 중'으로 달아줘" | `task_comment_add` dry-run → 승인 → INSERT | comment_id 반환 |
| T3 | "그 작업 댓글 보여줘" | `task_comments_list` | 시간순 1개 표시 |
| T4 | "그 작업 지워줘" | `task_delete` dry-run("작업 + 댓글 1건 영구 삭제됩니다") → 승인 → DELETE cascade | 작업·댓글 함께 사라짐 |

### 3-4. 파일함 (files_list)

| # | 명령 | 기대 동작 | 통과 기준 |
|---|---|---|---|
| F1 | "내 파일함 폴더·파일 보여줘" | `files_list` folderId=null (루트) | 빈 결과도 정상 |
| F2 | (파일함 UI에서 더미 폴더 1개 생성 후) "내 파일함" | `files_list` 루트 + 폴더 1개 보임 | folderCount=1 |

---

## 4. 검증 기록 양식

각 시나리오 끝나면 [`docs/verify/RESULTS_AI_AGENT_PHASE1.md`](RESULTS_AI_AGENT_PHASE1.md)에 추가:

```markdown
## M1 — 내 메모 보여줘
- [PASS] 호출: memos_list (HIGH/LOW 체인 어디 갔는지 console 로그 확인 → LOW)
- [PASS] 응답 시간: 2.1s
- [PASS] 응답 내용: count 0, memos []
- 비고: 빈 결과 메시지가 한국어로 자연스러움

## M2 — 노란 메모 ...
- [PASS] dry-run preview 정상
- [FAIL] color=yellow가 응답에는 보이지만 ...
- BUG ID: BUG-AI-AGENT-PHASE1-01 → `docs/issues/2026-05-13-...md`
```

**통과 표시**: `[PASS]` / `[FAIL]` / `[SKIP](사유)`.
**증거**: 응답 텍스트 발췌 또는 응답 시간만으로 충분 (스크린샷 옵션).

---

## 5. 버그 발견 시 보고 절차

C는 **fix 안 함**. 다음 절차로 메인 채팅에 인계:

1. `docs/issues/2026-05-13-ai-agent-phase1-{슬러그}.md` 작성:
   ```markdown
   # BUG-AI-AGENT-PHASE1-XX — {제목}

   **시나리오**: M3 (메모 생성 후 dry-run 미진행)
   **명령**: "노란 메모로 ... 만들어줘" → 응답 "응"
   **기대**: requireApproval=false로 재호출되어 실제 생성
   **실제**: AI가 다시 dry-run 반복 (무한 루프)
   **로그**: (어드민 로그 또는 응답 스크린샷)
   **재현률**: 3/3
   **회피책**: 사용자가 "requireApproval false로 실행해줘"로 명시
   ```
2. `RESULTS_*` 표에 BUG ID 기록
3. C 브랜치에 커밋·푸시 (`docs/issues/`, `docs/verify/RESULTS_*`)
4. 메인 채팅에 한 줄 알림: "BUG-AI-AGENT-PHASE1-01 발견, docs/issues/... 참조"

---

## 6. 자율 권한 (C 채팅)

**자율 진행**:
- 라이브 검증 (AI 비서 채팅에 명령 입력, 응답 분석)
- `docs/verify/`, `docs/issues/`에 문서 작성·수정
- C 브랜치에 commit·push (verify/ai-agent-phase1만)
- 메모리 갱신 (검증 패턴 학습)

**금지**:
- `lib/`, `netlify/`, `db/`, `public/js/` 등 **코드 수정 절대 금지**
- main·feature/* 브랜치에 push
- 마이그 함수 호출 (Swain이 직접)
- 토큰 한도·시스템 프롬프트 변경 (메인 채팅 권한)
- 다른 worktree(`tbfa-mis-A`/`B`/`ai-cost`) 진입

**예외 (메인 채팅 확인 후만)**:
- 코드 fix가 필요한 회귀 발견 → 메인 채팅이 fix 후 다시 C가 재검증

---

## 7. 시작 체크리스트

- [ ] Swain에게 `migrate-ai-tools-phase1ws?run=1` 결과 확인 받음
- [ ] `git fetch && git status` — `verify/ai-agent-phase1` 최신 (origin/feature/ai-cost-safety = e87fbd1 이상)
- [ ] 어드민 로그인 (preview URL)
- [ ] `cms-tbfa.html` AI 비서 채팅 진입 확인
- [ ] `docs/verify/RESULTS_AI_AGENT_PHASE1.md` 빈 템플릿 초안 생성

---

## 8. 종료 시

전체 시나리오 (M·E·T·F 합계 15개) 완료 후:

1. `RESULTS_AI_AGENT_PHASE1.md` 결과 요약 (통과 X/15, 실패 Y/15, BUG ID 목록)
2. 메인 채팅에 메시지: "Phase 1 검증 완료 — 통과 X, 실패 Y, BUG-AI-AGENT-PHASE1-01·02 보고. RESULTS·issues 푸시 완료."
3. C 채팅 대기 — Phase 2 검증 라운드 시작 시 메인 채팅이 새 브리핑 전달
