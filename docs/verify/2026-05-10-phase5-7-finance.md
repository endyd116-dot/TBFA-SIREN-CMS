# Phase 5~7 재정 관리 정적 검증 결과 — 2026-05-10

> 작성: C 채팅 (verify/phase5-7-finance)
> 베이스: main @ b0a6279

---

## 1. 검증 큐

| Q | 항목 | 결과 |
|---|---|---|
| Q7 | 재정 API 7개 정적 점검 | ⚠️ BUG-5 발견 → 수정 |
| Q8 | 프론트 3개 정적 점검 | ✅ 동작 정상 (경미 ⚠️ 2건 보류) |
| Q9 | admin.html 메뉴 4축 일관성 | ✅ 통과 |
| Q10 | 회귀 영역 (cms-tbfa·schema.ts) | ✅ 변경 0건 |

> 주: 설계서·머지 메시지에 "API 8개"로 표기되었으나 실제 7개. 단순 표기 차이 — 기능 누락 아님.

---

## 2. Q7 백엔드 7개 점검 결과

| 파일 | config.path | requireAdmin | try/catch | 응답 형식 | 페이지네이션 | SQL 안전성 |
|---|---|---|---|---|---|---|
| admin-finance-income-summary.ts | ✅ | ⚠️ → ✅ | ✅ | ✅ | N/A (요약) | ✅ |
| admin-finance-budget-list.ts | ✅ | ⚠️ → ✅ | ✅ | ✅ | N/A (전체) | ✅ |
| admin-finance-budget-upsert.ts | ✅ | ❌ → ✅ | ✅ | ✅ | N/A | ✅ |
| admin-finance-expenditure-list.ts | ✅ | ⚠️ → ✅ | ✅ | ✅ | ✅ limit=20 | ✅ |
| admin-finance-expenditure-create.ts | ✅ | ❌ → ✅ | ✅ | ✅ | N/A | ✅ |
| admin-finance-expenditure-approve.ts | ✅ | ❌ → ✅ | ✅ | ✅ | N/A | ✅ |
| admin-finance-report.ts | ✅ | ⚠️ → ✅ | ✅ | ✅ | N/A (요약) | ✅ |

(SQL 안전성: 모두 `sql\`\`` 템플릿 + `${}` 파라미터 바인딩 — drizzle 자동 이스케이프)

---

## 3. 발견된 버그 — BUG-5

### 🔴 BUG-5: 감사 추적 컬럼(created_by/approved_by) 영구 NULL 저장

| 항목 | 내용 |
|---|---|
| 위치 | budget-upsert.ts:26, expenditure-create.ts:33, expenditure-approve.ts:32 |
| 현상 | 예산 편성·지출 기안·지출 승인 시 누가 했는지 DB에 기록되지 않음 (항상 NULL) |
| 원인 | `requireAdmin` 반환은 `{ ok: true, ctx: { admin, member } }`인데 코드가 `auth.admin?.id` 사용. ① `auth.admin` 자체가 undefined (`auth.ctx.admin`이 정답) ② `AdminPayload`는 `id`가 아닌 `uid` 필드. optional chaining + `\|\| null` fallback 때문에 런타임 에러는 안 나지만 항상 NULL로 들어감 |
| 영향 | 운영 시 누가 예산 편성했는지·누가 승인했는지 추적 불가 → 감사·재무 책임 추적 핵심 기능 무력화 |
| 수정 | `auth.admin?.id \|\| null` → `auth.ctx.admin.uid` (3곳) |

---

## 4. Q8 프론트 점검 결과

| 항목 | income | budget | report |
|---|---|---|---|
| api() 헬퍼 (이중 stringify 없음) | ✅ | ✅ | ✅ |
| 응답 키 fallback | ⚠️ | ⚠️ | ✅ |
| 캐시버스터 (?v=20260510f1) | ✅ | ✅ | ✅ |
| Chart/XLSX 로드 가드 | ⚠️ | ✅ | ✅ |
| Chart destroy (메모리 누수 방지) | ✅ | ✅ | N/A |
| XSS 방지 | ✅ | ✅ | ✅ |
| 컨테이너 ID 일관성 | ✅ | ✅ | ✅ |

**경미 ⚠️ 2건 보류**:
- 응답 fallback 단일 경로(`data.data \|\| data`): 실제 백엔드 응답이 `{ ok, data }` 단일 wrap이라 충분 — 동작 정상
- Chart.js 로드 가드(income.js): admin.html에 CDN이 항상 등록 — 누락 시나리오 없음

→ CLAUDE.md "Don't add error handling for scenarios that can't happen" 원칙에 따라 별도 수정 안 함.

---

## 5. Q9 admin.html 메뉴 4축

| 메뉴 | PAGE_TITLES | switchAdminPage | data-page | div id |
|---|---|---|---|---|
| 수입 현황 | ✅ finance-income | ✅ | ✅ | ✅ adm-finance-income |
| 예산·지출 관리 | ✅ finance-budget | ✅ | ✅ | ✅ adm-finance-budget |
| 재무 보고서 | ✅ finance-report | ✅ | ✅ | ✅ adm-finance-report |

기존 메뉴(보고서·회원·후원·1:1매칭 등)와 키/ID 충돌 0건 → 회귀 위험 없음.

---

## 6. Q10 회귀 영역

Phase 5~7 머지 커밋(b0a6279)이 변경한 파일 13개:
- 재정 API 7개 + migrate 1개
- 재정 프론트 3개 + admin.js (14줄, 라우터 등록만)
- admin.html (메뉴 + 페이지 div 추가)

→ A 영역(cms-tbfa·hyosung 파서·토스 후크) **변경 0건**
→ B 영역(schema.ts members·cron-donor-status-sync) **변경 0건**
→ schema.ts **변경 없음** (raw SQL 사용 — 마이그 호출 후 schema 정의 추가 예정. CLAUDE.md §6.7 "DB 적용 전 schema 정의 추가 금지" 준수)

→ 회귀 위험 0건.

---

## 7. Swain 검증 가이드 (마이그 호출 후)

1. 어드민 로그인 후 주소창: `https://tbfa-siren-cms.netlify.app/api/migrate-finance-tables?run=1`
2. 응답 success 확인 → 어드민 → "재정 관리 → 수입 현황" 클릭 → 차트·KPI·채널별 표시 확인
3. "예산·지출 관리" → 연도 선택 → 예산 편성 모달 → 사업·계획 금액 입력 → 저장 확인
4. 지출 기안 모달 → 사업·금액·내용 입력 → 저장 → 목록 표시 확인
5. 지출 승인/반려 → 상태 전환 확인 → DB에서 `expenditures.approved_by` 컬럼이 본인 ID로 채워졌는지 확인 (BUG-5 fix 검증 핵심)
6. "재무 보고서" → 기간 선택 → 수입·지출·예산비교 차트·표 표시 + 엑셀 다운 + 인쇄 확인

---

## 8. 결론

코드 정상 + BUG-5 1건 fix 완료. Swain 마이그 호출 → 라이브 검증 가능.
