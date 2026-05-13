# BUG-AI-AGENT-PHASE1-02 — Gemini 모델 호출 전체 타임아웃 (인프라/구조 이슈)

**발견일**: 2026-05-13
**시나리오**: M1 회피책 (명시적 표현 재시도)
**검증 코드 베이스**: main 40ffebf (직접 DB 패턴, revert 후) + verify 머지 43b3a6c
**라이브 URL**: https://tbfa-siren-cms.netlify.app (production)

---

## 재현

**입력**: `내 워크스페이스 메모 목록 조회해줘`
**기대 동작**: `memos_list` 호출 → 메모 리스트 반환
**실제 동작**: 모든 Gemini 모델 호출 실패 (timeout)
**응답 전문**:
```
❌ 오류: AI 에이전트 오류 — 모든 Gemini 모델 호출 실패: gemini-2.5-flash-lite → timeout 12s (다음 모델 시도) [step:gemini_call]
```
**응답 시간**: 20초 (사용자 체감)
**재현률**: 1/1 (재시도 필요)

---

## 분석

CLAUDE.md 변경 이력 e1baeb7에서 도입된 자체 12초 timeout이 발동된 흔적("timeout 12s"). 폴백 체인(`gemini-3-flash` → `gemini-3.0-flash` → `gemini-3.1-flash-lite-preview`)이 모두 실패한 것으로 보임. 다만 응답 메시지에는 `gemini-2.5-flash-lite`가 첫 모델로 노출 → CLAUDE.md §7.1 폴백 체인(`gemini-3-flash` 우선)과 불일치 가능성.

**가능 원인** (추정만 — C는 코드 미수정):
1. Gemini API 일시 장애 (외부)
2. 시스템 프롬프트가 너무 커서 12초 안에 응답 못 받음 (토큰 한도 a5e05d9 상향 후에도 첫 응답 느림)
3. 모델 ID 불일치 (`gemini-2.5-flash-lite` vs CLAUDE.md `gemini-3-flash`)
4. Netlify Function 콜드 스타트 + 모델 호출 연쇄로 누적 지연

---

## 회피책 (사용자 입장)

- 현재 시점: 사실상 없음 (인프라 이슈는 사용자 해결 불가)
- 재시도 시 일시 장애였으면 해결될 수도

---

## 영향 범위

이 에러가 지속되면 **AI 에이전트 검증 자체 불가능** → 시나리오 M2~F2 모두 진행 불가.

---

## 메인 채팅 인계 사항

- C는 fix 안 함 (브리핑 §6 코드 수정 금지)
- 인프라 이슈일 가능성 높음 → 메인이 점검 필요:
  1. Gemini API 키 정상?
  2. 시스템 프롬프트 사이즈가 12초 초과할 만큼 큰가?
  3. 모델 ID(`gemini-2.5-flash-lite` vs CLAUDE.md 명시 `gemini-3-flash`) 일치 점검
- 재시도 1~2회 후 동일하면 fix 필요
