# BUG-AI-AGENT-PHASE1-05b — notice_category enum fix 부분 적용 (V6 신규)

**발견일**: 2026-05-14 (V6 라운드)
**검증자**: C 채팅 (curl)
**심각도**: Medium (member/media 카테고리 사용 불능, 거부 메시지 misleading)

## 컨텍스트

표준 v1.3 §18.12에 명시된 BUG-05a fix: notice_create의 enum 값을 실제 DB enum(general/member/event/media)에 맞게 핸들러·도구 description 모두 정정. V6 검증에서 fix 부분 적용 확인.

## 재현 (curl 직접 호출, dry-run만)

```bash
# 4가지 카테고리 시도
for CAT in general member event media; do
  printf '{"userMessage":"공지 %s 카테고리로 ... 작성해줘","conversationId":null}' "$CAT" > req.json
  curl ... --data-binary @req.json
done
```

## 결과

| 카테고리 | 결과 | reply |
|---|---|---|
| `general` | **PASS** | dry-run preview에 category="general" 정상 |
| `event` | **PASS** | dry-run preview에 category="event" 정상 |
| `member` | **FAIL** | "'member' 카테고리는 유효하지 않습니다. 공지사항 카테고리는 'notice', 'event', 'press' 중 하나" |
| `media` | **FAIL** | "'media' 카테고리는 사용할 수 없습니다. 'notice', 'event', 'press' 중 선택" |

## 분석

- `general`·`event`는 정정됨 (이전 BUG-05a fix 적용)
- `member`·`media`는 여전히 거부 — **핸들러·도구 description 화이트리스트 미정정**
- 거부 메시지에 옛 화이트리스트(`notice/event/press`) 그대로 노출 — 표준 §18.12 명시 enum과 어긋남
- 표준 §18.12 본문: "실제 `notice_category` enum: general / member / event / media (4개)" + "잘못 시드된 값: notice, press (enum에 없음)"

## 추정 (메인 fix 영역)

`lib/ai-agent-tools.ts` notice_create 또는 `netlify/functions/admin-ai-agent.ts`에서:
- notice_create 핸들러의 화이트리스트(`['notice','event','press']`)가 부분만 정정됐고 (general·event 추가) member·media는 누락
- 또는 핸들러는 정정됐는데 거부 메시지 문자열에 옛 값이 박혀있음

## 회피책

- 임시: `general` 또는 `event` 카테고리만 사용
- 일반 회원 대상 공지는 `general`로 우회 가능
- 미디어 콘텐츠 공지는 회피 없음

## 메인 채팅 fix 권장

1. `lib/ai-agent-tools.ts` notice_create 함수 정독 — enum 화이트리스트 4개 모두 추가
2. 거부 메시지 문자열을 enum 4개로 정정 (현재 `notice/event/press` → `general/member/event/media`)
3. fix 후 C 재검증 — member·media 카테고리 PASS 확인

## 관련 표준

- §18.12 BUG-05a 본문 (정확 enum: general/member/event/media)
- §15.5 schema 사전 검증 의무 (DB enum과 도구 description 동기화 절차)
