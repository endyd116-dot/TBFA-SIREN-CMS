# BUG-AI-AGENT-PHASE1-01 — AI 비서 자연어 의도 분류 회귀 (전체 도구 호출 불능)

**발견일**: 2026-05-13 (당일 검증)
**검증자**: C 채팅 (curl 직접 호출 — production)
**검증 코드 베이스**: main 40ffebf (revert) + verify 머지 43b3a6c
**라이브 URL**: https://tbfa-siren-cms.netlify.app
**심각도**: **Critical** (AI 비서 자연어 명령 전체 작동 불능)

---

## 핵심 증상

사용자가 자연어로 명령을 보내면 AI가 **도구 호출 없이 되묻기로만 응답**. 결과적으로 어떤 작업도 자동 수행되지 않음. 사용자가 도구명을 직접 지정해야만 작동.

---

## 재현 (curl 직접 호출, conversationId=null 새 대화 매번)

### Case 1 — M1 단순 조회

```
입력: "내 메모 보여줘"
결과:
  toolCalls: []
  reply: "어떤 메모를 수정하시겠어요? 메모 ID와 함께 수정할 내용을 알려주세요."
  inputTokenEstimate: 4342
  elapsed: 19초
체인: LOW (가장 가벼운 모델부터 시도)
```

→ **의도조차 분류 실패** ("보여줘"를 "수정"으로 오해석)

### Case 2 — M2 생성 (HIGH 키워드)

```
입력: "노란 메모로 'Phase 1 검증 시작' 만들어줘"
결과:
  toolCalls: []
  reply: "어떤 내용을 수정하시겠어요? 메모의 제목, 내용, 색상, 고정 여부, 캘린더 표시 여부 등을 변경할 수 있습니다."
  inputTokenEstimate: 5085
  elapsed: 10초
체인: HIGH (키워드 "만들" 포함 → gemini-3-flash-preview 1순위)
```

→ **HIGH 체인의 gemini-3-flash-preview조차 도구 호출 결정 못함**. 명확한 색상·내용·생성 의도가 모두 있는데도.

### Case 3 — 기존 도구 (Phase 1 외) sanity check

```
입력: "회원 통계 보여줘"
결과:
  toolCalls: []
  reply: "어떤 회원 정보를 조회해 드릴까요? 회원의 이름, 전화번호, 이메일 주소 중 하나를 알려주세요."
  inputTokenEstimate: 5078
  elapsed: 5초
```

→ **Phase 1 도구만의 문제가 아님**. 기존 `members_stats`도 동일 패턴.

### Case 4 — 도구명 직접 지정 (회피책 검증)

```
입력: "members_stats 도구 호출해서 회원 통계 보여줘"
결과:
  toolCalls: [{name:"members_stats", args:{}, result:{ok:true, output:{total:61, breakdown:[...]}}}]
  reply: "현재 총 회원 수는 61명입니다. ..." (정상)
  inputTokenEstimate: 5086
  elapsed: 17초
```

→ **도구·인증·인프라는 모두 정상**. 자연어 의도 분류만 깨짐.

---

## 회귀 범위 확정

| 도구 종류 | 자연어 호출 | 도구명 직접 |
|---|---|---|
| Phase 1 신규 (`memos_*`) | FAIL (M1, M2) | 미검증 |
| Phase 1 신규 (`events_*`, `task_comment_*`, `files_list`) | 미검증 (SKIP) | 미검증 |
| 기존 (`members_stats`) | FAIL (SC-1) | **PASS** (SC-2) |

→ Phase 1만의 회귀가 아닌 **AI 비서 자연어 의도 분류 전반 회귀**.

---

## 원인 추정 (메인 채팅 점검 영역)

C는 fix 안 함. 점검 후보:

1. **시스템 프롬프트 결함** ([admin-ai-agent.ts:116-133](netlify/functions/admin-ai-agent.ts#L116-L133)):
   - 핵심 규칙 #2 "의도 모호하면 도구 호출 전 한국어로 다시 묻기"가 너무 강함 → 모델이 안전하게 항상 되묻기 선택
   - "도구 22개" 명시이나 Phase 1 12개 추가로 실제 34개 → 시스템 프롬프트 갱신 누락
   - 카테고리에 memos/calendar/files 누락 (워크스페이스·KPI 카테고리에 tasks_list만 명시)

2. **e87fbd1 / a5e05d9 / e5f8d45 회귀 의심**: 토큰 한도 상향(a5e05d9) 또는 의도별 모델 체인 분리(e5f8d45)에서 도구 호출 디코딩 흐름 깨짐 가능성

3. **도구 description 약함** ([lib/ai-agent-tools.ts:242-258](lib/ai-agent-tools.ts#L242-L258)): "메모 생성 (dry-run 우선). 호출자 본인 소유." 같이 짧음. 모델이 매칭 못 할 정도는 아니지만 시스템 프롬프트 규칙 #2와 결합돼 보수적 응답 유도 가능

4. **gemini-3-flash-preview 모델 자체 도구 호출 약점** (가능성 낮음 — 4번 호출에서 HIGH 모델조차 호출 결정 못 함은 다른 원인 시사)

---

## 회피책 (사용자 입장)

- 도구명 직접 지정: 예 `members_stats 도구 호출해서 ...` (SC-2 검증)
- 비현실적 — 사용자가 도구명을 알아야 함

---

## 영향

- AI 비서 사실상 사용 불능
- 자연어 명령으로 모든 작업이 되묻기로 빠짐 → 의도 분류 부정확
- Phase 1 검증(메모·일정·댓글·파일 12개 도구) 진행 불가

---

## 메인 채팅 인계 사항

1. 위 원인 후보 우선순위 점검 (시스템 프롬프트 규칙 #2 → 카테고리 갱신 → description 강화 순)
2. fix 후 C 재검증 라운드 시작 — 동일 17개 시나리오 + Sanity Check 2개 재실행
3. fix 커밋 alone push 시 verify/ai-agent-phase1에 머지 후 C 채팅에 알림 (CLAUDE.md §6.15)

---

## 관련 BUG

- **BUG-AI-AGENT-PHASE1-02**: M1 회피책 시도 시 Gemini API 503 high demand (외부 인프라 일시 — 본 BUG와 독립)
