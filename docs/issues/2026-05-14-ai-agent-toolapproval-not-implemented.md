# BUG-AI-AGENT-PHASE1-03 — 표준 §17.1 toolApproval 양식 미구현

**발견일**: 2026-05-14 (V4 라운드)
**검증자**: C 채팅 (curl)
**심각도**: Medium (회피책으로 운영 가능)

## 재현 (curl 직접 호출)

표준 `AI_AGENT_PLATFORM_STANDARD.md` §17.1에 명시된 dry-run 승인 양식:

```json
POST /api/admin-ai-agent
{
  "conversationId": 629,
  "toolApproval": {
    "toolName": "memo_create",
    "args": {"title":"fix 검증","content":"fix 검증","color":"yellow","requireApproval":false}
  }
}
```

**기대**: 명시적 toolApproval로 LLM 호출 없이 도구 즉시 실행.
**실제**: reply "(응답 없음)" + toolCalls=[] + inputTokens 7708. 메모 실제 INSERT 안 됨 (M1 재조회로 count=1 그대로 확인).

## 원인 (`netlify/functions/admin-ai-agent.ts` 점검 — C 추정)

- 500행: `if (!userMessage && !body?.toolApproval && inlineFiles.length === 0)` — toolApproval 존재만 validation 통과
- 그 이후 `body.toolApproval`을 처리해서 도구 실행하는 코드가 grep 결과 **없음**
- 결국 userMessage 빈 채로 일반 LLM 흐름으로 진입 → LLM이 텅 빈 입력 보고 "(응답 없음)" 반환

## 회피책 (V4에서 확립·검증됨)

같은 conversationId에 **명시적 자연어**로 진행 요청:

```bash
printf '{"userMessage":"%s","conversationId":%s}' "방금 미리보기대로 진행. requireApproval false로." "$CONV"
```

- 단순 "응"·"진행"은 §17.1대로 `text.length <= 4` 또는 GREETING_PATTERNS 매칭으로 도구 0개 → 빈 응답 → FAIL
- 명시적 "requireApproval false로 진행" 표현이 필요. V4 M3~M6, E3·E4·E5, T2 회피, P2-1.3·P2-2.1·P2-2.2·P2-3.4·P2-4.1 모두 이 패턴으로 통과

## 메인 채팅 fix 권장

표준 §17.1 양식을 코드로 구현 — `body.toolApproval` 객체가 있으면 LLM 호출 건너뛰고 `executeTool(toolApproval.toolName, toolApproval.args)` 직접 호출 + DB messages에 functionCall/functionResponse 추가. 또는 표준 §17.1 자체를 "명시적 자연어" 회피책으로 수정.
