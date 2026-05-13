# BUG-005 (High) — 매출 목록 카테고리·기간·납입자 필터 미구현

> **발견**: 2026-05-14, C 검증 라운드
> **심각도**: High (Q6 검증 자체 불가, A 프론트 화면 카테고리 드롭다운 동작 못 함)

---

## 1. 현상

`GET /api/admin-revenue-list`은 `fiscalYear`(필수)·`status`·`page`·`limit`만 지원. 설계서 §2.3에 명시된 다음 필터 모두 무시:

- `categoryId` (카테고리별 조회)
- `payerName` (LIKE 검색)
- `from` / `to` (인식일 범위)

→ A 프론트의 "후원 외 매출 관리" 화면에서 "카테고리: [강연·교육 ▼]" 드롭다운 적용해도 서버가 무시하고 전체 카테고리 반환.

## 2. 원인 위치

`admin-revenue-list.ts` line 11-21:

```typescript
const url = new URL(req.url);
const fiscalYear = url.searchParams.get("fiscalYear");
const status = url.searchParams.get("status");
const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
const limit = Math.min(100, ...);
const offset = (page - 1) * limit;

if (!fiscalYear) { ... 400 ... }

// 조건 빌드
const conditions = [eq(otherRevenues.fiscalYear, Number(fiscalYear))];
if (status && status !== "all") {
  conditions.push(eq(otherRevenues.status, status));
}
```

`categoryId`·`payerName`·`from`·`to` 파라미터 자체를 읽지 않음.

## 3. 설계서 명세

설계서 §2.3:
> 후원 외 매출 목록. 필터: fiscalYear·categoryId·status·payerName(LIKE)·기간(from·to). 페이지네이션 limit/offset.

응답 예시도 `summary`에 `totalAmount/totalRefund/netAmount`가 필터 적용 후 집계여야 함.

## 4. 제안 fix

```typescript
const categoryId = url.searchParams.get("categoryId");
const payerName = url.searchParams.get("payerName")?.trim();
const from = url.searchParams.get("from");
const to = url.searchParams.get("to");

...

const conditions = [eq(otherRevenues.fiscalYear, Number(fiscalYear))];
if (status && status !== "all") conditions.push(eq(otherRevenues.status, status));
if (categoryId) conditions.push(eq(otherRevenues.categoryId, Number(categoryId)));
if (payerName) conditions.push(like(otherRevenues.payerName, `%${payerName}%`));
if (from) conditions.push(gte(otherRevenues.recognizedAt, from));
if (to) conditions.push(lte(otherRevenues.recognizedAt, to));
```

`like`, `gte`, `lte` import 추가. 합계·건수·목록 3개 쿼리 모두 동일 where 사용 (이미 그렇게 구성됨 — line 41/63/76).

AI 도구 `tool_revenueList`도 동일하게 categoryCode → categoryId 변환 + 필터 추가 권장 (선택).

## 5. 회귀 영향

신규 필터 추가만 — 기존 호출(fiscalYear·status)은 무영향. A 프론트 화면 동작에 직결 (Phase 22-A의 핵심 UX).
