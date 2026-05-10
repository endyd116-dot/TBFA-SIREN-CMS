# BUG-5: 재정 관리 감사 추적 컬럼 영구 NULL 저장

| 항목 | 내용 |
|---|---|
| 발견 | 2026-05-10 (C 채팅 verify/phase5-7-finance) |
| 심각도 | 🔴 High (감사 추적 핵심 기능 무력화) |
| 상태 | ✅ 해결 (이번 세션) |

---

## 1. 현상

Phase 5~7 재정 관리 백엔드 3개 API에서 누가 작업했는지 DB에 기록되지 않음:
- `budgets.created_by` (예산 편성한 어드민) — 항상 NULL
- `expenditures.created_by` (지출 기안한 어드민) — 항상 NULL
- `expenditures.approved_by` (지출 승인/반려한 어드민) — 항상 NULL

런타임 에러는 발생하지 않음 (insert/update 자체는 성공).

---

## 2. 원인

`requireAdmin` 헬퍼는 `{ ok: true, ctx: { admin, member } }` 형태로 반환하고 `admin`은 `AdminPayload` 타입(`uid` 필드 보유, `id` 없음). 그런데 3개 API 코드가 다음과 같이 **이중으로 잘못된 경로**로 접근:

```ts
// 잘못
${auth.admin?.id || null}
// ↑ auth.admin 자체 undefined (실제는 auth.ctx.admin)
// ↑ AdminPayload는 id가 아닌 uid 필드
```

→ optional chaining `?.` + `|| null` fallback 때문에 런타임 에러 없이 조용히 NULL이 들어감 (silent failure).

---

## 3. 영향 파일

- `netlify/functions/admin-finance-budget-upsert.ts:26`
- `netlify/functions/admin-finance-expenditure-create.ts:33`
- `netlify/functions/admin-finance-expenditure-approve.ts:32`

---

## 4. 수정

3곳 동일 패턴으로 수정:

```diff
- ${auth.admin?.id || null}
+ ${auth.ctx.admin.uid}
```

`auth.ok === true` 분기 안에서만 사용하므로 옵셔널 처리 불필요 (ctx 항상 존재).

---

## 5. 재발 방지

CLAUDE.md §9.1.8 "헬퍼 함수 도입 직후 모든 사용처 1회 검증" 강화 필요. 본 사례는 #BUG-1(`requireActiveUser` user.id) 사례와 동일한 구조 — 헬퍼 반환 형식이 코드 작성자 가정과 달라 발생.

장기적으로는 `auth.ctx.admin.uid` 헬퍼 한 줄을 wrapper 함수로 추출하거나 TypeScript strict 분기로 컴파일 타임 잡히게 검토 권장 (이번 fix 범위 외).
