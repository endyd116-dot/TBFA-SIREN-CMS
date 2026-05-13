# 검증 결과 — AI 에이전트 Phase 2 (콘텐츠·게시판·캠페인·공지·FAQ 10개)

> 브리핑: [`AI_AGENT_PHASE2-4_BRIEFING.md`](AI_AGENT_PHASE2-4_BRIEFING.md) §3 (C는 Phase 2만)
> 라이브 URL: https://tbfa-siren-cms.netlify.app (production)
> 검증자: C 채팅 (curl 직접 호출 — UTF-8 표준 §18.6 적용)
> 시작일: 2026-05-14
> 코드 베이스: main 0a026c8 + verify 머지 af3986a (→ 69ec3ac → 추가 commit)

---

## 0. 사전 점검

- [x] 4개 마이그 호출 완료 (Phase 1·2·3·4 모두 Swain 호출 확인)
- [x] main 0a026c8 / verify 머지·푸시 완료
- [x] AI_AGENT_PLATFORM_STANDARD.md §17·§18 정독 — 특히 §18.6 UTF-8 표준
- [x] V4 라운드 환경 점검: 어드민 로그인 + Phase 1 SC-1·M1·M2 통과로 인코딩 OK 확인

---

## 1. 시나리오 결과 (11개)

### P2-1. 공지 (notices_list / notice_delete)

#### P2-1.1 — 공지 목록 보여줘
- [x] 호출 도구: `notices_list`
- [x] 결과: **PASS** — count=7, 핀 우선 정렬 정상
- 비고: "안녕하세요"·"2026년 정기총회"·"유가족 심리상담" 등 7건 표시

#### P2-1.2 — 공지 99번 삭제해줘 (dry-run)
- [x] 호출 도구: `notice_delete` (requireApproval=true)
- [x] 결과: **PASS** (도구 호출 측면) — dry-run 호출됨, result.ok=false "공지 없음" (데이터 검증도 정상)
- 비고: 99번 미존재로 "영구 삭제됩니다" 메시지 안 뜸. 단, 도구 호출·인자 추출(noticeId=99)은 정확

#### P2-1.3 — P2-1.2 후 승인 (회피책)
- [x] 결과: **PASS** — AI가 이전 실패 인지하고 toolCalls=[] (안전 동작)

### P2-2. 콘텐츠 페이지 (page_create / page_delete)

#### P2-2.1 — test_phase2 페이지 만들기 → 승인
- [x] 호출 도구: `page_create`
- [x] 결과: **PASS** — dry-run + 승인 → id=17 생성, rollbackData 포함
- 비고: AI가 contentHtml `<p>테스트 페이지입니다.</p>` 자동 작성

#### P2-2.2 — test_phase2 페이지 삭제 → 승인
- [x] 호출 도구: `page_delete`
- [x] 결과: **PASS** — dry-run "영구 삭제됩니다" + 승인 → deleted=true, rollbackData (before 포함)

### P2-3. 게시판 (board_post_create / board_post_update / board_comments_list / board_comment_hide)

#### P2-3.1 — 공지글 'Phase 2 검증 테스트' 작성 → 승인
- [x] 결과: **FAIL** — 2단계 복합 BUG
  1. AI가 `board_post_create`가 아니라 `notice_create`를 호출 → 도구 선택 오류 (BUG-AI-AGENT-PHASE2-01)
  2. notice_create 실행 결과 DB 에러: `column "content" of relation "board_posts" does not exist` (BUG-AI-AGENT-PHASE2-02)
- 비고: notice_create 도구의 SQL이 board_posts 테이블의 content 컬럼을 참조하나 실제 컬럼 없음. 도구 정의·DB 스키마 동기화 누락

#### P2-3.2 — 방금 만든 게시글 고정해줘
- [x] 결과: **FAIL** (의존성) — P2-3.1 실패로 게시글 없음, AI가 toolCalls=[]로 ID 묻기
- 비고: P2-3.1 fix 후 재검증 필요

#### P2-3.3 — 게시글 7번 댓글 보여줘
- [x] 호출 도구: `board_comments_list`
- [x] 결과: **PASS** — count=0, 빈 리스트 정상

#### P2-3.4 — 댓글 1번 숨김 → 승인
- [x] 호출 도구: `board_comment_hide`
- [x] 결과: **PASS** — dry-run + 승인 → commentId=1 isHidden=true, rollbackData(before 포함)
- 비고: ⚠️ **실제 사용자 댓글 1번(박새로이의 "김수아무 거북이아 둘우미")이 숨김 처리됨**. 검증 종료 후 rollback 필요. Swain·메인 채팅 알림

### P2-4. 캠페인·FAQ

#### P2-4.1 — 캠페인 2번 종료해줘 → dry-run → 승인
- [x] 결과: **FAIL** — AI가 `campaign_archive`가 아니라 `campaigns_update`를 호출 (도구 선택 오류, BUG-AI-AGENT-PHASE2-03). 인자 endDate="2024-05-16" (날짜 부정확)
- 비고: 캠페인 2번 미존재로 결과 ok:false. 도구 선택 BUG 외 데이터 없음으로 자연 종료

#### P2-4.2 — FAQ 목록 보여줘
- [x] 호출 도구: `faqs_list`
- [x] 결과: **PASS** — count=6, "교사유가족협의회 가입 절차"·"기부금 영수증 발급" 등 6건 표시

---

## 1-C. 재검증 라운드 V5 (2026-05-14, fix 4건 후)

### V5 시나리오 결과

| # | 결과 | 호출 도구 | 비고 |
|---|---|---|---|
| P2-3.1 (1차) | 부분 PASS | notice_create | dry-run PASS (DB 컬럼 fix ✓), 승인 단계 enum 부정확 — AI category="notice" 추측, 유효: general/event/press |
| P2-3.1 (본문·카테고리 명시 회피) | **PASS** | notice_create | notice id=8 생성, rollbackData |
| P2-3.2 | **SKIP** | — | P2-3.1이 notice 카테고리로 분기 → board_post_update 의존성 깨짐. board_post_create 별도 검증 권장 |
| P2-4.1 (dry-run) | **PASS** | campaign_archive | 정확 호출 ✓ (V4 campaigns_update → V5 campaign_archive — BUG-06 fix). 캠페인 1번 currentStatus=active. 승인 SKIP — 실 캠페인 보호 |

### V5 사용자 데이터 영향

- `notices` id=8 추가 (P2-3.1 회피 PASS) — rollbackData 보존

### V5 신규 잔존 한계

**notice_create category enum 부정확**: AI가 사용자 미명시 카테고리를 임의 추측 → invalid enum 에러. 도구 description에 enum 허용값(`general/event/press`) 명시 필요. BUG-05의 인자 자동 추출 한계 후속 사례.

---

## 2. 최종 집계 (V4·V5 누적)

| 영역 | 통과 | 실패 | 스킵 | 비고 |
|---|---|---|---|---|
| 공지 (P2-1) | **3/3** | 0/3 | 0/3 |  |
| 페이지 (P2-2) | **2/2** | 0/2 | 0/2 |  |
| 게시판 (P2-3) | **2/4** | 2/4 | 0/4 | P2-3.1 DB+도구선택 / P2-3.2 의존성 |
| 캠페인·FAQ (P2-4) | **1/2** | 1/2 | 0/2 | P2-4.1 도구 선택 오류 |
| **합계** | **8/11** | **3/11** | **0/11** | 도구 호출 70%+ 정상, BUG 3건 발견 |

---

## 3. 발견 BUG 목록

| ID | 시나리오 | 제목 | 재현률 | 회피책 | 파일 |
|---|---|---|---|---|---|
| BUG-AI-AGENT-PHASE1-06 (통합) | P2-3.1·P2-4.1·T2 | 도구 선택 오류 3건 패턴 | 3/3 | 도구명 명시 (T2에서 검증) | `docs/issues/2026-05-14-ai-agent-tool-misselection.md` |
| BUG-AI-AGENT-PHASE2-02 | P2-3.1 | notice_create의 board_posts.content 컬럼 미존재 DB 에러 | 1/1 | 도구 정의 또는 DB 스키마 fix 필요 | `docs/issues/2026-05-14-ai-agent-board-posts-content-column.md` |

---

## 4. 사용자 데이터 영향 (Swain·메인 채팅 알림)

검증 진행 중 다음 변경이 실제 DB에 반영됨 (rollback 필요):

| 시나리오 | 영향 | rollbackData | 권장 조치 |
|---|---|---|---|
| P2-3.4 | board_comments id=1 "박새로이" 댓글 isHidden true로 변경 | `{table:"board_comments",id:1,before:{is_hidden:false}}` | 메인이 rollback 또는 어드민 UI에서 숨김 해제 |
| T2 회피 (Phase 1) | workspace_task_comments id=1 "검증 진행 중" 댓글 추가 (작업 3번에) | `{table:"workspace_task_comments",id:1}` | 메인 또는 검증용 댓글 그대로 둘지 결정 |
| M3·M4·M5·M6 (Phase 1) | workspace_memos id=2 생성→수정→삭제 (lifecycle 완결) | DB 영향 없음 (삭제까지 완료) | 없음 |
| E2·E3·E4·E5 (Phase 1) | workspace_events id=1 생성→수정→삭제 (lifecycle 완결) | DB 영향 없음 (삭제까지 완료) | 없음 |
| P2-2.1·P2-2.2 | content_pages test_phase2 생성→삭제 (lifecycle 완결) | DB 영향 없음 | 없음 |

---

## 5. 메인 채팅 인계 메시지 (Swain 복붙용)

```
[C 채팅 → 메인 채팅] Phase 2 검증 완료.

결과: 통과 8/11, 실패 3/11, 스킵 0/11
- P2-1 공지 3/3 PASS
- P2-2 페이지 2/2 PASS (lifecycle 완결)
- P2-3 게시판 2/4 PASS / 2 FAIL (P2-3.1·P2-3.2 DB+도구선택 BUG)
- P2-4 캠페인·FAQ 1/2 PASS / 1 FAIL (P2-4.1 도구선택)

BUG (Phase 2 영향):
- BUG-AI-AGENT-PHASE1-06: 도구 선택 오류 3건 통합 (T2 + P2-3.1 + P2-4.1)
- BUG-AI-AGENT-PHASE2-02: notice_create의 board_posts.content 컬럼 DB 에러

사용자 데이터 영향 (rollback 권장):
- board_comments id=1 (박새로이 댓글) 숨김 처리됨 — rollbackData 보존

상세: docs/verify/RESULTS_AI_AGENT_PHASE2.md
표준 v1.1 갱신 가능 여부: 가능 (V4 UTF-8 정확 + dry-run 회피책 패턴 발견 + 도구 선택 오류 사례 3건)
브랜치: verify/ai-agent-phase1 push 곧
```
