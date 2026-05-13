# 검증 결과 — AI 에이전트 Phase 1 (워크스페이스 CRUD 12개)

> 브리핑: [`AI_AGENT_PHASE1_BRIEFING.md`](AI_AGENT_PHASE1_BRIEFING.md)
> 라이브 URL: https://feature-ai-cost-safety--tbfa-siren-cms.netlify.app
> 검증자: C 채팅
> 시작일: (검증 시작 시 채워넣음)

---

## 0. 사전 점검

- [ ] 마이그 호출 완료 (`migrate-ai-tools-phase1ws?run=1`) — Swain 확인
- [ ] 배포 완료 (`git log origin/feature/ai-cost-safety` 최신 = e87fbd1↑)
- [ ] 어드민 로그인 OK (preview URL)
- [ ] AI 비서 채팅 진입 OK (`cms-tbfa.html` → AI 비서 메뉴)

---

## 1. 시나리오 결과

### 메모 (M1~M6)

#### M1 — 내 메모 보여줘
- [ ] 호출 도구: `memos_list`
- [ ] 모델 체인: (HIGH / LOW)
- [ ] 응답 시간: __s
- [ ] 결과: (PASS/FAIL/SKIP)
- 비고:

#### M2 — 노란 메모 'Phase 1 검증 시작' 만들어줘 (dry-run)
- [ ] 호출 도구: `memo_create`
- [ ] dry-run 미리보기: (preview 응답 발췌)
- [ ] 결과: (PASS/FAIL)
- 비고:

#### M3 — M2 후 "응" / "진행"
- [ ] 실제 INSERT: memo_id = ?
- [ ] 워크스페이스 UI 확인: (메모 보임/안 보임)
- [ ] 결과:
- 비고:

#### M4 — 분홍색으로 바꿔줘
- [ ] 호출: `memo_update` color=pink
- [ ] UI 새로고침 확인:
- [ ] 결과:
- 비고:

#### M5 — 고정해줘
- [ ] 호출: `memo_update` isPinned=true
- [ ] UI pinned 최상단:
- [ ] 결과:
- 비고:

#### M6 — 지워줘
- [ ] dry-run 메시지 "영구 삭제됩니다" 포함:
- [ ] DELETE 실행 후 UI에서 사라짐:
- [ ] 결과:
- 비고:

### 캘린더 일정 (E1~E5)

#### E1 — 이번 주 일정 보여줘
- [ ] 호출: `events_list`
- [ ] 날짜 범위 정확:
- [ ] 결과:
- 비고:

#### E2 — 내일 오후 3시 박두용 미팅 1시간 (dry-run)
- [ ] 호출: `event_create` startAt=내일 15:00
- [ ] eventType=meeting 자동 감지:
- [ ] 결과:
- 비고:

#### E3 — E2 후 진행
- [ ] event_id = ?
- [ ] 캘린더 탭에 표시:
- [ ] 결과:
- 비고:

#### E4 — 위치 '본부 회의실'로 추가
- [ ] 호출: `event_update` location='본부 회의실'
- [ ] 결과:
- 비고:

#### E5 — 그 일정 지워줘
- [ ] DELETE 실행:
- [ ] 결과:
- 비고:

### 작업 댓글·삭제 (T1~T4)

#### T1 — 더미 작업 생성
- [ ] task_create로 'Phase 1 검증용 더미' 생성
- [ ] task_id = ?
- 비고:

#### T2 — 댓글 '검증 진행 중' 달아줘
- [ ] 호출: `task_comment_add`
- [ ] comment_id = ?
- [ ] 결과:
- 비고:

#### T3 — 댓글 보여줘
- [ ] 호출: `task_comments_list`
- [ ] 1건 표시:
- [ ] 결과:
- 비고:

#### T4 — 작업 지워줘 (cascade 검증)
- [ ] dry-run "작업 + 댓글 1건" 표시:
- [ ] DELETE 후 작업·댓글 함께 사라짐:
- [ ] 결과:
- 비고:

### 파일함 (F1~F2)

#### F1 — 내 파일함 보여줘
- [ ] 호출: `files_list` folderId=null
- [ ] 결과:
- 비고:

#### F2 — 더미 폴더 1개 만든 후 다시 조회
- [ ] folderCount=1:
- [ ] 결과:
- 비고:

---

## 2. 최종 집계

| 영역 | 통과 | 실패 | 스킵 | 비고 |
|---|---|---|---|---|
| 메모 (M) | 0/6 | 0/6 | 0/6 |  |
| 캘린더 (E) | 0/5 | 0/5 | 0/5 |  |
| 댓글·삭제 (T) | 0/4 | 0/4 | 0/4 |  |
| 파일 (F) | 0/2 | 0/2 | 0/2 |  |
| **합계** | **0/17** | **0/17** | **0/17** |  |

---

## 3. 발견 BUG 목록

(없으면 "없음" 기재)

| ID | 시나리오 | 제목 | 재현률 | 회피책 | 파일 |
|---|---|---|---|---|---|
| BUG-AI-AGENT-PHASE1-01 | — | — | — | — | `docs/issues/2026-05-13-...md` |

---

## 4. 메인 채팅 인계 메시지 (Swain 복붙용)

```
[C 채팅 → 메인 채팅] AI 에이전트 Phase 1 검증 완료.
- 통과 X/17, 실패 Y/17, 스킵 Z/17
- BUG-AI-AGENT-PHASE1-{NN} 보고 (자세한 내용 docs/issues/)
- RESULTS·issues verify/ai-agent-phase1에 푸시
- Phase 2 진행 가능 여부: (예/아니오 + 사유)
```
