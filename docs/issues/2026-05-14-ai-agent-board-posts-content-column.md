# BUG-AI-AGENT-PHASE2-02 — notice_create의 board_posts.content 컬럼 미존재 DB 에러

**발견일**: 2026-05-14 (V4 라운드 Phase 2)
**검증자**: C 채팅 (curl)
**심각도**: High (도구 작동 불능)

## 재현

```bash
printf '{"userMessage":"%s","conversationId":null}' "공지글 Phase 2 검증 테스트 작성해줘" > req.json
curl ... --data-binary @req.json
```

(AI가 notice_create를 호출 — 별도 BUG-AI-AGENT-PHASE1-06 도구 선택 오류)

**기대**: notice_create dry-run preview 또는 실행 → notices 테이블 INSERT
**실제 (승인 단계)**:
```json
{
  "name": "notice_create",
  "args": {"title":"Phase 2 검증 테스트","body":"...","requireApproval":false},
  "result": {"ok":false,"error":"공지 등록 실패: column \"content\" of relation \"board_posts\" does not exist"}
}
```

## 분석

- 에러 메시지에 `board_posts` 테이블 + `content` 컬럼 명시
- 두 가지 의문:
  1. notice_create가 왜 board_posts 테이블을 참조? → 도구 정의 오류 (notices 테이블이어야 정상) 또는 두 도구가 같은 internal 함수 공유
  2. content 컬럼이 board_posts에 없는 게 정상이라면 → 잘못된 컬럼 참조
- **lib/ai-agent-tools.ts**의 notice_create 구현부 점검 필요

## 회피 (사용자)

- 도구 선택 오류 회피 + DB 컬럼 fix 두 가지 필요. 현재 회피 없음 → 공지 생성 도구 자체 불능.

## 메인 채팅 fix 권장

1. `lib/ai-agent-tools.ts` notice_create 정의 정독:
   - INSERT 테이블이 `notices`인지 `board_posts`인지 확인
   - 컬럼명 `content` vs `content_html` vs `body` 일치 확인
2. `db/schema.ts` board_posts·notices 테이블 컬럼 확인
3. fix 후 C 재검증 (P2-3.1 + P2-3.2 의존 시나리오)

## 영향 시나리오

- P2-3.1 (게시글 작성) FAIL
- P2-3.2 (게시글 고정) FAIL (의존성)
- 실사용에서 AI 비서로 공지·게시글 작성 도구 호출 시 동일 에러
