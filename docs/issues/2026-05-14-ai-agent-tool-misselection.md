# BUG-AI-AGENT-PHASE1-06 — AI 도구 선택 오류 (3건 패턴)

**발견일**: 2026-05-14 (V4 라운드)
**검증자**: C 채팅 (curl)
**심각도**: Medium~High (실사용 영향, 의도와 다른 도구 실행 위험)

## 패턴

사용자 자연어 명령에 AI가 의미적으로 가까운 다른 도구를 호출. 정답 도구를 못 골라 잘못된 도구로 분기.

## 사례 1 — Phase 1 T2 (작업 댓글 추가)

**입력**: `작업 3번에 댓글 검증 진행 중 으로 달아줘`
**기대 도구**: `task_comment_add`
**실제 호출**: `task_update(taskId=3, status="doing", requireApproval=true)` — status 변경으로 잘못 해석
**회피 검증**: `task_comment_add 도구로 작업 3번에 검증 진행 중 댓글 추가해줘` → PASS

## 사례 2 — Phase 2 P2-3.1 (게시글 작성)

**입력**: `공지글 Phase 2 검증 테스트 작성해줘`
**기대 도구**: `board_post_create`
**실제 호출**: `notice_create(title="Phase 2 검증 테스트", body="...")` — "공지"라는 단어 때문에 notice로 분기
**결과**: notice_create 실행 시 board_posts.content 컬럼 미존재 DB 에러 (별도 BUG-AI-AGENT-PHASE2-02)

## 사례 3 — Phase 2 P2-4.1 (캠페인 종료)

**입력**: `캠페인 2번 종료해줘`
**기대 도구**: `campaign_archive`
**실제 호출**: `campaigns_update(campaignId=2, endDate="2024-05-16", requireApproval=true)` — "종료"를 endDate 설정으로 잘못 해석. 날짜도 부정확(BUG-05)

## 원인 추정

- 도구 description이 명시적 트리거 키워드 부족
- 시스템 프롬프트에 "명령→도구" 매핑 테이블이 부족
- LLM이 의미적으로 가까운 도구로 폴백 (보수적 도구 선택)

## 메인 채팅 fix 권장

1. **도구 description에 명시 트리거**: 예 `task_comment_add: "작업 카드에 댓글 추가. '댓글 추가' '댓글 달아줘' 명령에 사용"`
2. **시스템 프롬프트에 명령→도구 매핑 예시 추가** (이미 §18.2 fix와 같은 방식)
3. **board_post_create vs notice_create 명확화**: "공지글"이라는 한국어가 모호 — "공지(notice_*)" vs "공지글(board_post_*)" 트리거 분리 안내
4. **campaign_archive vs campaigns_update 명확화**: 종료(archive)는 archived 상태 변경, update는 부분 필드 수정

## 회피 (사용자)

- 도구명 직접 명시: 정확하나 사용자 부담 큼
- 더 구체적 표현: "댓글로 추가" "게시판에 글 작성" "캠페인 archive로 종료"
