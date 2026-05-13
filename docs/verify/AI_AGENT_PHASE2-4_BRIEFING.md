# 검증 브리핑 — AI 에이전트 Phase 2·3·4 (30개 도구 통합)

> **C 채팅용 — Phase 1 검증 완료 후 진행**
> 단일 책무: 라이브 환경에서 Phase 2·3·4로 추가된 30개 도구 검증.
> 코드 수정 금지 (BUG 발견 시 메인 채팅에 보고만).

---

## 1. 작업 정체성

| 항목 | 값 |
|---|---|
| 브랜치 | 동일(`verify/ai-agent-phase1`) — Phase 1 완료 후 이름 변경 권장 또는 새 브랜치 |
| 라이브 URL | `https://tbfa-siren-cms.netlify.app` |
| 검증 대상 커밋 | `0815815` (Phase 4 완료) |
| 누적 도구 | **84개** (Phase 1 12 + Phase 2 10 + Phase 3 10 + Phase 4 10 + 기존 42) |

---

## 2. 사전 점검

- [ ] Phase 1 검증 결과 작성 완료 (`RESULTS_AI_AGENT_PHASE1.md`)
- [ ] Swain이 4개 마이그 모두 호출 완료 확인:
  - `migrate-ai-tools-phase1ws?run=1` (Phase 1)
  - `migrate-ai-tools-phase2?run=1`
  - `migrate-ai-tools-phase3?run=1`
  - `migrate-ai-tools-phase4?run=1`
- [ ] main `0815815` 이상 푸시·배포 완료
- [ ] `git fetch && git merge origin/main` 동기화

---

## 3. Phase 2 시나리오 (콘텐츠·게시판·캠페인·공지·FAQ 10개)

### P2-1. 공지 (notices_list / notice_delete)

| # | 명령 | 기대 도구 | 통과 기준 |
|---|---|---|---|
| P2-1.1 | "공지 목록 보여줘" | `notices_list` | 핀 우선 정렬, 5~10건 표시 |
| P2-1.2 | "공지 99번 삭제해줘" → dry-run | `notice_delete` | "영구 삭제됩니다" 메시지 |
| P2-1.3 | P2-1.2 후 "응" | `notice_delete` 실제 | rollbackData 응답 포함 |

### P2-2. 콘텐츠 페이지 (page_create / page_delete)

| # | 명령 | 기대 도구 |
|---|---|---|
| P2-2.1 | "test_phase2 페이지를 '테스트' 제목으로 만들어줘" → "응" | `page_create` |
| P2-2.2 | "test_phase2 페이지 지워줘" → "확정" | `page_delete` |

### P2-3. 게시판 (board_post_create / board_post_update / board_comments_list / board_comment_hide)

| # | 명령 | 기대 도구 |
|---|---|---|
| P2-3.1 | "공지글 'Phase 2 검증 테스트' 작성해줘" → "응" | `board_post_create` |
| P2-3.2 | "방금 만든 게시글 고정해줘" | `board_post_update` |
| P2-3.3 | "게시글 7번 댓글 보여줘" | `board_comments_list` |
| P2-3.4 | "댓글 N번 숨겨줘" → "응" | `board_comment_hide` |

### P2-4. 캠페인·FAQ

| # | 명령 | 기대 도구 |
|---|---|---|
| P2-4.1 | "캠페인 2번 종료해줘" → dry-run → "응" | `campaign_archive` |
| P2-4.2 | "FAQ 목록 보여줘" | `faqs_list` |

---

## 4. Phase 3 시나리오 (FAQ CUD·자료·템플릿·그룹·사건의견 10개)

| # | 명령 | 기대 도구 |
|---|---|---|
| P3-1 | "FAQ '회원 가입은 어떻게 하나요?' 답변 '홈페이지 우상단 가입 버튼…'으로 추가" → "응" | `faq_create` |
| P3-2 | "방금 만든 FAQ 답변 좀 더 길게 바꿔줘" | `faq_update` |
| P3-3 | "그 FAQ 지워줘" → "응" | `faq_delete` |
| P3-4 | "자료실 자료 보여줘" | `resources_list` |
| P3-5 | "자료 카테고리 목록" | `resource_categories_list` |
| P3-6 | "이메일 템플릿 목록 보여줘" | `templates_list` (channel=email) |
| P3-7 | "환영 메일 템플릿 만들어줘 ('환영합니다' 제목)" → "응" | `template_create` |
| P3-8 | "방금 템플릿 본문 좀 더 친근하게 바꿔줘" | `template_update` |
| P3-9 | "수신자 그룹 목록 보여줘" | `recipient_groups_list` |
| P3-10 | "사건 N번에 내부 메모로 '확인 완료' 남겨줘" → "응" | `incident_comment_add` (isPrivate=true) |

---

## 5. Phase 4 시나리오 (잠재·자료CUD·예산·정책·채팅 10개)

| # | 명령 | 기대 도구 |
|---|---|---|
| P4-1 | "잠재 후원자 목록 보여줘" | `potential_donors_list` |
| P4-2 | "잠재 후원자 5번을 회원 12번에 연결해줘" → "응" | `potential_donor_link` |
| P4-3 | "자료 '2026 정관' 등록해줘 (회원 전용)" → "응" | `resource_create` |
| P4-4 | "방금 등록한 자료 공개로 바꿔줘" | `resource_update` |
| P4-5 | "그 자료 지워줘" → "응" | `resource_delete` |
| P4-6 | "올해 예산 보여줘" | `budgets_list` |
| P4-7 | "이번 달 지출 보여줘" | `expenditures_list` (fromDate=이번달 1일) |
| P4-8 | "올해 예산 vs 지출 요약 보여줘" | `budget_summary` |
| P4-9 | "후원 정책 보여줘" | `donation_policy_get` |
| P4-10 | "미답변 채팅방 보여줘" | `chat_rooms_list` (unreadOnly=true) |

---

## 6. 결과 기록 양식

`docs/verify/RESULTS_AI_AGENT_PHASE2-4.md` 신규 작성 (Phase 1과 동일 형식):

```markdown
## P2-1.1 — 공지 목록 보여줘
- [PASS] 호출: notices_list
- [PASS] 응답 시간: 1.8s
- [PASS] 응답 내용: 핀 2건 + 일반 3건
- 비고:

## P3-7 — 환영 메일 템플릿 만들어줘
- [PASS] dry-run preview 정상
- [PASS] 진행 후 template_id 반환
- [FAIL] subject가 비어있어도 INSERT됨 (검증 누락) → BUG-X
```

---

## 7. BUG 발견 시

`docs/issues/2026-05-14-ai-agent-phase{2|3|4}-{슬러그}.md` 작성:
- 시나리오 번호 + 재현 명령
- 기대 vs 실제
- 재현률 (N/N)
- 회피책

---

## 8. 종료 시 인계 메시지

```
[C 채팅 → 메인 채팅] Phase 2·3·4 검증 완료.
- Phase 2 통과 X/10, 실패 Y/10
- Phase 3 통과 X/10, 실패 Y/10
- Phase 4 통과 X/10, 실패 Y/10
- 총 BUG NN건 (BUG-{Phase}-{NN})
- RESULTS·issues 푸시 완료
- 표준 v1.1 갱신 가능 여부: (가능/요수정)
```
