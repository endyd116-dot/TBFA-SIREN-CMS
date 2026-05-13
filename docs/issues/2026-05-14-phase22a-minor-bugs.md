# Phase 22-A Medium·Low BUG 모음 (BUG-006~012)

> **발견**: 2026-05-14, C 검증 라운드
> 각 항목은 개별 fix 가능. Critical/High(BUG-001~005)와 별개 라운드로 처리 가능.

---

## BUG-006 (Medium) — 매출 환불 권한이 API/설계서/AI 도구 모두 다름

**현상**:

| 위치 | 권한 |
|---|---|
| 설계서 §10.1 (AI 도구 권한) | `other_revenue_refund` → admin |
| 설계서 §0 (Swain 결정) | 매출 작성·조회 admin, 매출 승인 super_admin (환불 미언급) |
| `admin-revenue-refund.ts:17` | `if (auth.ctx.admin.role !== "super_admin") return 403` |
| `lib/ai-agent-tools.ts:527` (도구 description) | "super_admin 전용" 표기 |
| `ai_tool_permissions` 시드 (`other_revenue_refund`) | `required_role: NULL` (admin OK) |

→ 3곳에서 권한 의도가 모두 다름. 시드는 admin, API는 super_admin, 도구 description은 super_admin, 설계서 §10.1은 admin.

**제안 fix**: Swain께 의도 확정 요청. 결정 후 한 곳에 통일.

**우선안**: 후원 환불(`donations.status='refunded'`)이 어떤 권한으로 처리되는지(현행 코드 정독 필요) 동일 권한으로 후원 외 환불도 통일. 일반적으로 환불은 자금 흐름 영향이 크므로 super_admin이 적절.

---

## BUG-007 (Low) — `admin-revenue-update.ts` HTTP 메서드 PATCH 명세, PUT 구현

**현상**: 설계서 §2.4 "PATCH /api/admin-revenue-update", 구현 `if (req.method !== "PUT") return 405`.

A 프론트가 설계서 따르면 405 Method Not Allowed.

**제안 fix**: 1) PATCH 허용으로 변경 (`if (!["PUT","PATCH"].includes(req.method))`), 또는 2) 설계서를 PUT로 갱신.

---

## BUG-008 (Low) — `admin-revenue-approve.ts` 요청 키명 설계서와 불일치

**현상**:
- 설계서 §2.5: `{ "revenueId": 42, "action": "approve" }` 또는 `{ "revenueId": 42, "action": "reject", "reason": "증빙 부족" }`
- 구현 line 28: `const { id, action, rejectionReason } = body`

AI 도구 declaration도 `id`/`rejectionReason` 사용 → 도구 호환은 OK. A 프론트가 설계서 따른 경우 400 (id 누락).

**제안 fix**: 설계서를 코드에 맞춰 갱신(`id`/`rejectionReason`) — 또는 양쪽 키 받기:
```typescript
const id = body.id ?? body.revenueId;
const rejectionReason = body.rejectionReason ?? body.reason;
```

---

## BUG-009 (Medium) — `selectRelevantTools` finance 그룹에 신규 도구·키워드 미반영

**현상**: `netlify/functions/admin-ai-agent.ts:293-294`:

```typescript
{ name: "finance", tools: ["budgets_list", "expenditures_list", "budget_summary", "donation_policy_get"],
  keywords: ["예산", "지출", "결산", "회계", "정책", "계좌"] },
```

Phase 22-A 도구 7개·키워드 9종(매출·수입·손익·순이익·재정·강연·정부·기업·협찬·함께워크) 누락. 설계서 §10.6 위반.

매칭 0개 시 안전망 `null` 반환 → 전체 도구 로딩되므로 동작 자체는 가능. 단 응답 속도·토큰 비용 최적화 손실.

**제안 fix**:
```typescript
{ name: "finance",
  tools: [
    "budgets_list","expenditures_list","budget_summary","donation_policy_get",
    "revenue_categories_list","revenue_list","revenue_create","revenue_update",
    "revenue_approve","revenue_refund","pl_summary"
  ],
  keywords: [
    "예산","지출","결산","회계","정책","계좌",
    "매출","수입","손익","순이익","재정","강연","정부","기업","협찬","함께워크"
  ]},
```

---

## BUG-010 (Medium) — AI 도구 description에 카테고리 6코드 enum 미명시

**현상**: `revenue_categories_list`·`revenue_list`·`revenue_create` 등 도구 description에 카테고리 enum 미명시.

설계서 §10.2 예시:
> `description: "lecture|govgrant|corp_sponsor|twork_on|twork_si|etc"`

설계서 §10.7 표준 v1.4 §18.13 도메인 동기화 의무:
> 카테고리 코드 6개를 도구 6개 description에 1:1 일관

표준 v1.4 §18.13은 2026-05-13 BUG-05b(notice_category enum 부분 적용) 사건으로 신설된 규칙. Phase 22-A에서도 동일한 enum 부분 명시 사고 패턴.

**제안 fix**: 도구 description에 enum 추가:
```typescript
{ name: "revenue_categories_list",
  description: "후원 외 수입 카테고리 목록 조회 (코드: lecture|govgrant|corp_sponsor|twork_on|twork_si|etc)" }
```

---

## BUG-011 (Low) — `revenue_create` 도구가 categoryCode가 아닌 categoryId 요구

**현상**: AI 도구 declaration line 493:
```typescript
categoryId: { type: "INTEGER", description: "revenue_categories.id" }
```

설계서 §10.2 명시는 `categoryCode: STRING`. AI가 카테고리 ID를 사전에 조회해야 함 → 자연어 흐름 끊김.

**제안 fix**: `categoryCode` STRING으로 변경 + 핸들러에서 화이트리스트 검증 + SELECT id FROM revenue_categories WHERE code = ? 매핑 (설계서 §10.3 예시 패턴):

```typescript
const ALLOWED = new Set(["lecture","govgrant","corp_sponsor","twork_on","twork_si","etc"]);
if (!ALLOWED.has(code)) return { ok: false, error: "categoryCode 6코드 중 하나" };
const catRow: any = await db.execute(sql`SELECT id FROM revenue_categories WHERE code = ${code} LIMIT 1`);
const categoryId = Number((catRow?.rows ?? catRow)[0]?.id);
```

`revenue_update`·`revenue_list` 도구도 동일 적용 검토.

---

## BUG-012 (Low) — `admin-revenue-categories-list.ts` `?all=1` 옵션 미구현

**현상**: 설계서 §2.1 "isActive=true만 기본, ?all=1로 비활성 포함". 구현은 isActive 필터 자체 없음 → 항상 전체 반환.

시드 6개 모두 `is_active=true`이므로 실용 영향 없음. 향후 카테고리 비활성화 운영 시 노출됨.

**제안 fix**:
```typescript
const includeInactive = url.searchParams.get("all") === "1";
let q = db.select().from(revenueCategories);
if (!includeInactive) q = q.where(eq(revenueCategories.isActive, true));
rows = await q.orderBy(asc(revenueCategories.sortOrder), asc(revenueCategories.id));
```

---

**모음 끝**. BUG-001~005 fix 후 본 6건은 라운드 2에서 일괄 처리 권장.
