# 검증 결과 — AI 에이전트 Phase 1 (워크스페이스 CRUD 12개)

> 브리핑: [`AI_AGENT_PHASE1_BRIEFING.md`](AI_AGENT_PHASE1_BRIEFING.md)
> 라이브 URL: https://tbfa-siren-cms.netlify.app (production — 2026-05-13 main 머지)
> 검증자: C 채팅
> 시작일: 2026-05-13
> 코드 베이스: main 40ffebf (4f9fabf 리팩터링 → revert, 원래 직접 DB 패턴 복구) + verify 브랜치 머지(43b3a6c)
> 비고: 표준 문서 §3.3은 직접 DB가 정답 패턴이므로 **활동 피드 자동 기록 확인 항목은 제외** (직접 DB라 활동피드 안 잡힘이 정상)

---

## 0. 사전 점검

- [x] 마이그 호출 완료 (`migrate-ai-tools-phase1ws?run=1`) — 1회용 마이그 a917ee2에서 삭제됨 (적용 완료 확인)
- [x] main 최신 = 40ffebf, verify 브랜치에 머지 완료 (43b3a6c)
- [ ] 어드민 로그인 OK (production URL)
- [ ] AI 비서 채팅 진입 OK (`cms-tbfa.html` → AI 비서 메뉴)

---

## 1. 시나리오 결과

### 메모 (M1~M6)

#### M1 — 내 메모 보여줘
- [x] 1차 (사용자 입력): toolCalls=[], reply="어떤 메모를 찾으시나요?", 14초
- [x] **C 직접 호출 재현 (curl)**: toolCalls=[], reply="어떤 메모를 수정하시겠어요? 메모 ID와 함께 수정할 내용을 알려주세요.", 19초, inputTokens=4342
- [x] 결과: **FAIL** — `memos_list` 호출 안 됨. AI가 "보여줘"를 "수정"으로 오해석
- 회피책 시도 ("내 워크스페이스 메모 목록 조회해줘"):
  - 1차: 503 high demand, 20초
  - C 직접 호출: 503 high demand, 2초 (Gemini API 일시 장애)
- BUG: **BUG-AI-AGENT-PHASE1-01** (도구 호출 회귀 전반 — 자세한 분석 §1.5 참조)
- BUG: **BUG-AI-AGENT-PHASE1-02** (Gemini API 일시 503 — 외부 인프라)

#### M2 — 노란 메모 'Phase 1 검증 시작' 만들어줘 (dry-run)
- [x] **C 직접 호출 (curl)**: toolCalls=[], reply="어떤 내용을 수정하시겠어요? 메모의 제목, 내용, 색상, 고정 여부, 캘린더 표시 여부 등을 변경할 수 있습니다.", 10초, inputTokens=5085
- [x] 의도 분류: HIGH 체인 (키워드 "만들" 포함) → `gemini-3-flash-preview` 1순위
- [x] 결과: **FAIL** — `memo_create` 호출 안 됨. HIGH 모델조차 명확한 생성 의도를 도구 호출로 연결 못함. AI가 memo_create 대신 memo_update 인자를 나열하며 되묻기
- BUG: **BUG-AI-AGENT-PHASE1-01** (동일 원인 — 의도 분류 회귀 전반)

#### M3 ~ F2 — 검증 중단
- [x] M3 ~ F2 (남은 15개 시나리오): **SKIP — 시스템 회귀로 진행 불가**
- 사유: BUG-AI-AGENT-PHASE1-01 확정. 자연어 명령에서 모든 도구 호출 회귀(Phase 1 도구뿐 아니라 기존 도구 `members_stats`도 동일 패턴). 메인 채팅 fix 후 재검증 라운드 필요.

### Sanity Check — 기존 도구 (Phase 1 외)

회귀 범위 확정을 위한 기존 도구 검증:

| # | 입력 | 결과 |
|---|---|---|
| SC-1 | `회원 통계 보여줘` | **FAIL** — toolCalls=[], reply="어떤 회원 정보를 조회해 드릴까요?", 5초 |
| SC-2 | `members_stats 도구 호출해서 회원 통계 보여줘` (도구명 직접 지정) | **PASS** — toolCalls=[{name:"members_stats", args:{}, result:{...total:61명}}], reply 정상, 17초 |

**해석**: 도구·인증·인프라·호출 경로는 모두 정상. **자연어 → 도구 호출 의도 분류만 회귀**. 사용자가 도구명을 직접 명시해야만 작동.

---

#### M4 — 분홍색으로 바꿔줘
- [ ] 호출: `memo_update` color=pink
- [ ] UI 새로고침 확인:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### M5 — 고정해줘
- [ ] 호출: `memo_update` isPinned=true
- [ ] UI pinned 최상단:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### M6 — 지워줘
- [ ] dry-run 메시지 "영구 삭제됩니다" 포함:
- [ ] DELETE 실행 후 UI에서 사라짐:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

### 캘린더 일정 (E1~E5)

#### E1 — 이번 주 일정 보여줘
- [ ] 호출: `events_list`
- [ ] 날짜 범위 정확:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### E2 — 내일 오후 3시 박두용 미팅 1시간 (dry-run)
- [ ] 호출: `event_create` startAt=내일 15:00
- [ ] eventType=meeting 자동 감지:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### E3 — E2 후 진행
- [ ] event_id = ?
- [ ] 캘린더 탭에 표시:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### E4 — 위치 '본부 회의실'로 추가
- [ ] 호출: `event_update` location='본부 회의실'
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### E5 — 그 일정 지워줘
- [ ] DELETE 실행:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

### 작업 댓글·삭제 (T1~T4)

#### T1 — 더미 작업 생성
- [ ] task_create로 'Phase 1 검증용 더미' 생성
- [ ] task_id = ?
- 비고:

#### T2 — 댓글 '검증 진행 중' 달아줘
- [ ] 호출: `task_comment_add`
- [ ] comment_id = ?
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### T3 — 댓글 보여줘
- [ ] 호출: `task_comments_list`
- [ ] 1건 표시:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### T4 — 작업 지워줘 (cascade 검증)
- [ ] dry-run "작업 + 댓글 1건" 표시:
- [ ] DELETE 후 작업·댓글 함께 사라짐:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

### 파일함 (F1~F2)

#### F1 — 내 파일함 보여줘
- [ ] 호출: `files_list` folderId=null
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

#### F2 — 더미 폴더 1개 만든 후 다시 조회
- [ ] folderCount=1:
- [x] SKIP (BUG-AI-AGENT-PHASE1-01 — 자연어 의도 분류 회귀)

---

## 1-A. 재검증 라운드 V3 (2026-05-14, fix 3278c44 + 마이그 후)

**전제**: 메인 fix 3278c44 + Phase 4 마이그 + system-prompt-reset 마이그 모두 적용. main 722a747. C verify 머지 21f4da2.

**우선 3개 (메인 지정)**:

| # | 입력 | 결과 | 비고 |
|---|---|---|---|
| SC-1 | "회원 통계 보여줘" | **FAIL — 응답 어긋남** | toolCalls=[], reply="어떤 메모를 수정하시겠어요? 메모의 ID와 수정할 내용을 알려주세요.", 23s, inputTokens=**7411** (이전 V2 5078보다 +46%) |
| M1 | "내 메모 보여줘" | **인프라 장애** | Gemini 503 high demand, 10s |
| M2 | "노란 메모로 'fix 검증' 만들어줘" | **인프라 장애** | Gemini 503 high demand, 11s (HIGH 체인) |

**보조**:

| # | 입력 | 결과 |
|---|---|---|
| SC-2 (대조군) | "members_stats 도구 호출해서 회원 통계 보여줘" | **인프라 장애** — 503 high demand, 16s (V2에서는 PASS) |
| SC-1 재시도 | "회원 통계 보여줘" (1차 시도 직후) | **인프라 장애** — 503 high demand, 10s |

### V3 해석

1. **Gemini API 503 high demand 지속 발생 (5회 호출 중 4회 실패, 1회 응답)** — Google 측 일시 장애가 검증 시점에 활발. V2와 다른 새 변수.
2. **유일한 응답(SC-1 1차)이 응답 어긋남**: "회원 통계 보여줘" 명령에 "메모 수정하시겠어요?" 응답 — fix가 의도와 다르게 메모 쪽으로 편향됐을 가능성. 다만 1회 표본이라 단정 어려움.
3. **입력 토큰 증가**: V2 SC-1 5078 → V3 SC-1 7411 (+46%). 새 FALLBACK_SYSTEM_PROMPT가 도구 매핑 예시 추가로 커진 것으로 추정.
4. **fix 효과 판단 불가**: 인프라 503으로 충분한 표본 확보 못 함. SC-2 대조군조차 503 — 도구 호출 자체 검증 불가.

### V3 결론

- **검증 진행 불가** (외부 인프라 일시 장애)
- **SC-1 응답 어긋남은 별도 우려** — fix 결함 가능성 vs 1회 우연(LOW 체인 약한 모델 + 큰 시스템 프롬프트로 헷갈림)
- Gemini API 안정화 후 재검증 라운드 V4 시작 권장 (Swain이 시점 결정)

---

## 2. 최종 집계

| 영역 | 통과 | 실패 | 스킵 | 비고 |
|---|---|---|---|---|
| 메모 (M) | 0/6 | 2/6 | 4/6 | M1·M2 FAIL, M3~M6 SKIP |
| 캘린더 (E) | 0/5 | 0/5 | 5/5 | 전체 SKIP |
| 댓글·삭제 (T) | 0/4 | 0/4 | 4/4 | 전체 SKIP |
| 파일 (F) | 0/2 | 0/2 | 2/2 | 전체 SKIP |
| Sanity (SC) | 1/2 | 1/2 | 0/2 | SC-1 자연어 FAIL / SC-2 도구명 직접 PASS |
| **합계** | **1/19** | **3/19** | **15/19** | 회귀로 검증 중단 |

---

## 3. 발견 BUG 목록

| ID | 시나리오 | 제목 | 재현률 | 회피책 | 파일 |
|---|---|---|---|---|---|
| BUG-AI-AGENT-PHASE1-01 | M1·M2·SC-1 | AI 비서 자연어 의도 분류 회귀 — 도구 호출 전반 불능 (Phase 1 + 기존 도구 모두) | 4/4 | 도구명 직접 지정만 작동(SC-2) | `docs/issues/2026-05-13-ai-agent-phase1-memos-list-no-call.md` |
| BUG-AI-AGENT-PHASE1-02 | M1 회피책 | Gemini API 503 high demand (Google 측 일시 장애) | 1/2 | 재시도 (일시) | `docs/issues/2026-05-13-ai-agent-phase1-gemini-timeout.md` |

---

## 4. 메인 채팅 인계 메시지 (Swain 복붙용)

### V3 라운드 (2026-05-14)

```
[C 채팅 → 메인 채팅] Phase 1 재검증 V3 — Gemini API 일시 장애로 진행 불가 + SC-1 응답 어긋남 1건 발견.

상황:
- 검증 시점 Gemini API 503 high demand 5회 호출 중 4회 발생 (M1, M2, SC-2 대조군, SC-1 재시도)
- 유일한 응답(SC-1 1차)이 어긋남: "회원 통계 보여줘" → reply "어떤 메모를 수정하시겠어요?" (23s, inputTokens 7411)
- 입력 토큰 V2 5078 → V3 7411 (+46%, 새 FALLBACK 도구 매핑 예시로 추정)

판단:
- fix 효과 검증 불가 (인프라 일시 장애로 표본 부족)
- SC-1 어긋남은 별도 우려 — fix 결함 vs 1회 우연 단정 어려움 (대조군 SC-2도 503)

조치:
- Gemini API 안정화 후 V4 재검증 (Swain이 시점 결정)
- V4에서 SC-1·M1·M2 우선 3개부터 확인 → 정상이면 나머지 14개 진행

상세: docs/verify/RESULTS_AI_AGENT_PHASE1.md §1-A
브랜치: verify/ai-agent-phase1 (commit 곧)
```

### V2 라운드 (회귀 발견 — 2026-05-13)

```
[C 채팅 → 메인 채팅] AI 에이전트 Phase 1 검증 — 시스템 회귀로 중단.

핵심: 자연어 명령에서 AI가 도구 호출 안 함 → 항상 되묻기로 응답.
범위: Phase 1 신규 도구뿐 아니라 기존 도구(members_stats)도 동일 → AI 비서 의도 분류 전반 회귀.
회피: 사용자가 도구명을 직접 지정해야만 작동 (실용 불가).

근거:
- M1 "내 메모 보여줘" → toolCalls=[], "어떤 메모를 수정?" (19s)
- M2 "노란 메모 만들어줘" → toolCalls=[], "어떤 내용 수정?" (10s, HIGH 체인)
- SC-1 "회원 통계 보여줘" → toolCalls=[], "어떤 회원 정보?" (5s)
- SC-2 "members_stats 도구 호출해서 ..." → 정상 작동 ✓

원인 후보 (점검 부탁):
1) admin-ai-agent.ts:116-133 SYSTEM_PROMPT 규칙 #2 "의도 모호하면 되묻기" 과보수 + "도구 22개" 갱신 누락
2) e87fbd1/a5e05d9/e5f8d45 중 회귀 의심
3) lib/ai-agent-tools.ts memo/event/files description 강화

결과:
- 통과 1/19 (SC-2 도구명 직접 지정만)
- 실패 3/19 (M1·M2·SC-1)
- 스킵 15/19 (회귀 확정 후 진행 의미 없음)

상세: docs/verify/RESULTS_AI_AGENT_PHASE1.md
BUG: docs/issues/2026-05-13-ai-agent-phase1-memos-list-no-call.md (BUG-01)
     docs/issues/2026-05-13-ai-agent-phase1-gemini-timeout.md (BUG-02 일시 503)
브랜치: verify/ai-agent-phase1 (commit 곧)

fix 후 동일 시나리오 재검증 라운드 시작 부탁드립니다.
```
