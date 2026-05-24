# 성과 v4 폴리시 — 카테고리 묶음 + 캡 편집 + 매트릭스 경고 (설계서·단일 출처)

> 2026-05-24 / v4 1·2단계 완료 후 폴리시. A(프론트)·B(백) 병렬 → 메인 머지 → C 검증 → 메인 기록정리.
> 베이스 = origin/main(폴리시 베이스 push 해시는 트리거에 명시). 베이스 정합: PARALLEL_GUIDE §4.1.

3가지 + 기록정리(메인):
- **P1 비매출 5 카테고리 묶음 보기** (정의 탭·직원 선택 화면)
- **P2 역할별 캡 화면 편집** (상한을 상수→DB로 이전·역할 카탈로그에서 수정)
- **P3 매트릭스 분석 누락 경고 화면 표시** (③ summary.warning)

---

## P1 — 비매출 5 카테고리 묶음

`milestone_definitions.non_revenue_category`(1~5)는 v4 1단계에서 이미 저장됨. 응답·화면에 노출만.

### B (백)
- `milestone-definitions.ts` `formatDef`에 `nonRevenueCategory: r.non_revenue_category` 추가.
- `milestone-nonrevenue.ts` 목록 `formatAch`(또는 SELECT 매핑)에 정의 JOIN으로 `nonRevenueCategory` 포함(직원 선택 화면 grouping용).

### A (프론트)
- `admin-milestones.js` `renderDefs`: 비매출(NON_REVENUE) 정의를 **카테고리 1~5로 묶어** 소제목과 함께 표시. 카테고리 라벨: `1 미션·정책 영향력 / 2 유족·회원 직접 지원 / 3 사회적 가치·인식 변화 / 4 조직 역량 강화 / 5 운영 효율·시스템`. 매출연동은 기존대로.
- `workspace-milestones.js` `renderNrCards`: 비매출 항목을 카테고리 소제목으로 묶어 표시(선택 7개·카테고리당2는 기존 로직 유지).

## P2 — 역할별 캡 화면 편집 (상수→DB)

### B (백)
- 1회용 마이그 `migrate-milestone-role-caps`: `milestone_roles` ADD COLUMN `revenue_cap NUMERIC`, `non_revenue_cap NUMERIC` + 시드(PM 8500000/8500000·SM 8000000/8000000·SI 11100000/7400000·원). 멱등·requireAdmin·진단.
- `milestone-settlement.ts`: 하드코딩 `ROLE_CAPS` 제거 → `calc` 진입 시 `SELECT revenue_cap, non_revenue_cap FROM milestone_roles WHERE code = ${milestoneRole}` 로 읽어 적용(null이면 무캡). 나머지 캡 로직 동일.
- `milestone-roles.ts`: GET 응답에 `revenueCap`·`nonRevenueCap` 포함 / PATCH(super_admin) 에 두 값 수용(숫자·null 허용).

### A (프론트)
- `admin-milestones.js` 역할 카탈로그 모달(`roleModal`): **매출 캡(만원)·비매출 캡(만원)** 입력칸 추가(원↔만원 환산 표시·저장 시 원). 목록에도 캡 표시. super_admin만.

## P3 — 매트릭스 분석 누락 경고

### A (프론트)
- `admin-milestones.js` `renderMatrixReview`: `data.summary.warning`가 있으면 검토 영역 상단에 ⚠️ 경고 박스(노랑) 표시("일부 항목 누락 가능 — 텍스트 나눠 재시도 권장").

---

## API 계약 (A·B 합의)
- `milestone-definitions` GET → 각 정의에 `nonRevenueCategory`(int|null).
- `milestone-nonrevenue` 목록 → 각 항목에 `nonRevenueCategory`.
- `milestone-roles` GET → 각 역할에 `revenueCap`·`nonRevenueCap`(원|null) / PATCH 수용.

## 역할 분담·충돌
- **B**: `netlify/functions/milestone-definitions·milestone-nonrevenue·milestone-settlement·milestone-roles` + 신규 `migrate-milestone-role-caps`. (functions만)
- **A**: `public/js/admin-milestones.js`·`public/js/workspace-milestones.js`(+ html 캐시버스터). (public만)
- 충돌 0. schema.ts는 raw SQL이라 무수정(캡은 milestone_roles raw).

## 진행
1. 메인: 설계 push(베이스) → A·B 트리거.
2. A·B commit·보고 → 메인 머지·1회 push → Swain `migrate-milestone-role-caps?run=1`.
3. C 검증 → fix → 메인 **기록 정리**(매뉴얼·명세·설계서 history 이동)로 전체 종결.

## 기록 정리 (메인·마지막)
- 매뉴얼(`manual-admin.html`)·성과 명세에 v4·뉴스분석·사건사고 반영.
- active 설계서 4종(milestone-matrix-mapping·org-news-analysis·news-incidents-and-matrix-ai·perf-polish·org-news 등)·milestone-and-news → `docs/history/`로 이동.
