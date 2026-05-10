# Phase 16 — 통합 분석 대시보드 (Unified Analytics Dashboard)

> **작성**: 2026-05-11 / 메인 채팅
> **상위 Phase**: Phase 16 통합 분석 대시보드 ([카탈로그](2026-05-10-phase10-22-catalog.md) §Phase16)
> **추정**: 메인 설계 3h / B 백 5~6h / A 프론트 6~7h / C 검증 2h / 합계 16~18h
> **모드**: 평행 (A·B 동시 시작. A는 mock JSON으로 시작, B 머지 후 실 API 연결)

---

## 0. 요구사항 확정 (Swain 결정 2026-05-11)

| 항목 | 결정 |
|---|---|
| KPI 우선 지표 | **후원 현황** — 월간 수입·신규 후원자·정기 후원 유지율 |
| 이사회 보고서 방식 | **1안** — 기존 Phase 4 대표 보고서 화면에 분기·연간 탭 추가 |
| 대시보드 화면 위치 | admin.html SPA — 기존 "📊 통계" 그룹 아래 신규 메뉴 1개 (통합 분석) |
| 코호트 분석 포함 | 회원 라이프사이클 코호트 (신규→첫후원→정기→이탈 전환율) |
| 이탈 위험 패널 | 기존 churnRiskScore 활용 — 고위험(score≥70) 회원 목록 + 재참여 메시지 발송 버튼 |
| 발송 KPI | Phase 10 communicationSendJobs 테이블 활용 |

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블: 없음

기존 테이블 집계만으로 구현 가능:

| 집계 대상 | 테이블 | 핵심 컬럼 |
|---|---|---|
| 후원 현황 KPI | `donations` | `amount`, `type`, `status='paid'`, `created_at` |
| 신규 회원 추이 | `members` | `status`, `created_at`, `type` |
| 이탈 위험 목록 | `members` | `churnRiskScore`, `churnRiskLevel`, `lastLoginAt` |
| 코호트 전환율 | `members` + `donations` | `created_at`, `type='regular'` |
| 발송 성과 | `communicationSendJobs` + `communicationSendTracking` | `status`, `openedAt` |
| 사이렌 처리율 | `incidentReports` + `harassmentReports` + `legalConsultations` | `status`, `created_at` |

> **B 주의**: schema.ts 변경 없음 — 마이그레이션 불필요.

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `admin-dashboard-kpi.ts` | `/api/admin-dashboard-kpi` | GET | requireAdmin | 경영 KPI 집계 (후원·회원·사이렌·발송) |
| `admin-dashboard-cohort.ts` | `/api/admin-dashboard-cohort` | GET | requireAdmin | 코호트 전환율 분석 |
| `admin-dashboard-churn.ts` | `/api/admin-dashboard-churn` | GET | requireAdmin | 이탈 위험 회원 목록 + 통계 |
| `admin-report-board.ts` | `/api/admin-report-board` | GET | requireAdmin | 이사회용 분기·연간 집계 |

### 2.2 함수 상세

#### `admin-dashboard-kpi` (GET)

**쿼리 파라미터**: `?period=30d|90d|180d|365d` (기본 30d)

**응답 구조**:
```json
{
  "ok": true,
  "period": "30d",
  "donation": {
    "totalAmount": 4500000,
    "totalCount": 38,
    "newDonors": 12,
    "regularRetentionRate": 0.87,
    "monthlyTrend": [
      { "month": "2026-04", "amount": 2100000, "count": 18 }
    ]
  },
  "member": {
    "newCount": 25,
    "activeCount": 312,
    "withdrawnCount": 3,
    "monthlyTrend": [
      { "month": "2026-04", "newCount": 14, "withdrawnCount": 1 }
    ]
  },
  "siren": {
    "totalNew": 17,
    "resolvedRate": 0.71,
    "byType": [
      { "type": "incident", "count": 7 },
      { "type": "harassment", "count": 6 },
      { "type": "legal", "count": 4 }
    ]
  },
  "send": {
    "totalJobs": 8,
    "successRate": 0.94,
    "openRate": 0.42
  }
}
```

#### `admin-dashboard-cohort` (GET)

**쿼리 파라미터**: `?months=6` (분석 기간, 기본 6개월)

**응답 구조**:
```json
{
  "ok": true,
  "cohorts": [
    {
      "month": "2026-01",
      "newMembers": 22,
      "firstDonationRate": 0.45,
      "regularConvertRate": 0.18,
      "churnRate": 0.09,
      "avgDaysToFirstDonation": 12
    }
  ]
}
```

#### `admin-dashboard-churn` (GET)

**쿼리 파라미터**: `?level=high|medium|all` (기본 high), `?limit=50`

**응답 구조**:
```json
{
  "ok": true,
  "summary": {
    "highRisk": 14,
    "mediumRisk": 38,
    "total": 52
  },
  "members": [
    {
      "id": 42,
      "name": "홍길동",
      "churnRiskScore": 85,
      "churnRiskLevel": "high",
      "lastLoginAt": "2026-03-10T08:00:00Z",
      "lastDonationAt": "2026-02-01T00:00:00Z",
      "totalDonationAmount": 360000
    }
  ]
}
```

#### `admin-report-board` (GET)

**쿼리 파라미터**: `?type=quarterly|annual&year=2026&quarter=1`

**응답 구조**:
```json
{
  "ok": true,
  "type": "quarterly",
  "period": "2026 Q1",
  "donation": {
    "totalAmount": 9800000,
    "regularAmount": 7200000,
    "oneTimeAmount": 2600000,
    "newDonors": 31
  },
  "member": {
    "totalActive": 312,
    "newCount": 54,
    "withdrawnCount": 8,
    "expertCount": 17
  },
  "siren": {
    "totalHandled": 43,
    "resolvedCount": 36,
    "pendingCount": 7
  },
  "beneficiary": {
    "counselingCount": 28,
    "scholarshipCount": 5,
    "legalCount": 19
  }
}
```

---

## 3. 화면 설계 (A용)

### 3.1 admin.html 변경

```
사이드바 추가 (📊 통계 그룹 하단):
  📈 통합 분석 대시보드   → id="adm-unified-dashboard"

기존 대표 보고서 섹션 (id="adm-report") 변경:
  탭 추가: [월간] [분기] [연간]
  분기·연간 탭 → GET /api/admin-report-board 호출
```

### 3.2 신규 JS 파일

| 파일 | 역할 |
|---|---|
| `public/js/admin-unified-dashboard.js` | KPI 카드·차트·이탈 목록·코호트 테이블 통합 |

### 3.3 화면 구성 (admin-unified-dashboard.js)

```
┌─────────────────────────────────────────────┐
│  기간 선택: [30일] [90일] [180일] [365일]     │
├──────────┬──────────┬──────────┬────────────┤
│ 월간수입  │ 신규후원자│ 정기유지율│ 신규회원   │ ← KPI 카드 4개
├──────────┴──────────┴──────────┴────────────┤
│ 후원 월별 추이 (Chart.js 막대)               │
├─────────────────────┬───────────────────────┤
│ 사이렌 처리 현황     │ 발송 성과 (성공률/오픈)│
├─────────────────────┴───────────────────────┤
│ 코호트 분석 테이블 (월별 전환율)              │
├─────────────────────────────────────────────┤
│ 이탈 위험 회원 목록 (score 내림차순)          │
│ [재참여 메시지 발송] 버튼 → Phase 10 발송     │
└─────────────────────────────────────────────┘
```

### 3.4 대표 보고서 탭 확장 (기존 파일 수정)

- `public/js/admin-report.js` (기존) — 분기·연간 탭 핸들러 추가
- 탭 클릭 시 `GET /api/admin-report-board?type=quarterly|annual&year=&quarter=` 호출
- 응답 데이터를 기존 보고서 카드 레이아웃과 동일한 방식으로 렌더

---

## 4. 검증 시나리오 (C용)

### 4.1 Q1~Q10 라이브 시나리오

| Q | 시나리오 |
|---|---|
| Q1 | 어드민 로그인 → 통합 분석 메뉴 클릭 → KPI 카드 4개 숫자 정상 표시 |
| Q2 | 기간 선택 [90일] 클릭 → 카드 숫자·차트 갱신 |
| Q3 | 후원 월별 추이 차트 → 막대그래프 정상 렌더 |
| Q4 | 사이렌 처리 현황 → incident·harassment·legal 3종 각각 표시 |
| Q5 | 코호트 분석 테이블 → 6개월치 전환율 행 표시 (빈 DB면 0값) |
| Q6 | 이탈 위험 목록 → score 내림차순 정렬, 회원명·점수 표시 |
| Q7 | 이탈 위험 회원 [재참여 메시지 발송] 버튼 → 클릭 시 발송 페이지 이동 또는 모달 |
| Q8 | 대표 보고서 → [분기] 탭 클릭 → 분기 집계 숫자 표시 |
| Q9 | 대표 보고서 → [연간] 탭 클릭 → 연간 집계 숫자 표시 |
| Q10 | DB 데이터 없는 항목(코호트 등) → 에러 없이 빈 상태 메시지 표시 |

### 4.2 회귀 점검

- 기존 [월간] 탭 보고서 기능 깨짐 없음
- admin.html 기존 메뉴 클릭 정상 작동
- Chart.js 충돌 없음 (기존 차트 페이지와 동시 로드)

---

## 5. mock 데이터 (A용 — B 머지 전 사용)

```javascript
// KPI mock (GET /api/admin-dashboard-kpi)
const MOCK_KPI = {
  ok: true, period: "30d",
  donation: {
    totalAmount: 4500000, totalCount: 38, newDonors: 12,
    regularRetentionRate: 0.87,
    monthlyTrend: [
      { month: "2026-03", amount: 2100000, count: 18 },
      { month: "2026-04", amount: 2400000, count: 20 }
    ]
  },
  member: { newCount: 25, activeCount: 312, withdrawnCount: 3,
    monthlyTrend: [{ month: "2026-03", newCount: 14, withdrawnCount: 1 }] },
  siren: { totalNew: 17, resolvedRate: 0.71,
    byType: [{ type:"incident", count:7 }, { type:"harassment", count:6 }, { type:"legal", count:4 }] },
  send: { totalJobs: 8, successRate: 0.94, openRate: 0.42 }
};

// 코호트 mock (GET /api/admin-dashboard-cohort)
const MOCK_COHORT = {
  ok: true,
  cohorts: [
    { month:"2026-01", newMembers:22, firstDonationRate:0.45, regularConvertRate:0.18, churnRate:0.09, avgDaysToFirstDonation:12 },
    { month:"2026-02", newMembers:18, firstDonationRate:0.39, regularConvertRate:0.22, churnRate:0.06, avgDaysToFirstDonation:9 }
  ]
};

// 이탈 위험 mock (GET /api/admin-dashboard-churn)
const MOCK_CHURN = {
  ok: true,
  summary: { highRisk: 14, mediumRisk: 38, total: 52 },
  members: [
    { id:42, name:"홍길동", churnRiskScore:85, churnRiskLevel:"high",
      lastLoginAt:"2026-03-10T08:00:00Z", lastDonationAt:"2026-02-01T00:00:00Z", totalDonationAmount:360000 }
  ]
};

// 이사회 분기 보고 mock (GET /api/admin-report-board)
const MOCK_BOARD = {
  ok: true, type:"quarterly", period:"2026 Q1",
  donation: { totalAmount:9800000, regularAmount:7200000, oneTimeAmount:2600000, newDonors:31 },
  member: { totalActive:312, newCount:54, withdrawnCount:8, expertCount:17 },
  siren: { totalHandled:43, resolvedCount:36, pendingCount:7 },
  beneficiary: { counselingCount:28, scholarshipCount:5, legalCount:19 }
};
```

---

## 6. 4채팅 시작 프롬프트

### 6.1 B 채팅 — 백 구현

```
[B — Phase 16 통합 분석 대시보드 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase16-back ← 반드시 새로 생성 (git checkout -b feature/phase16-back origin/main)
설계서: docs/milestones/2026-05-11-phase16-unified-dashboard.md

영역: netlify/functions/, lib/
금지: public/, assets/, db/schema.ts, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━ DB 변경 없음 — 마이그레이션 불필요 ━━━
기존 테이블 집계만으로 구현:
  donations (amount·type·status·created_at)
  members (churnRiskScore·churnRiskLevel·lastLoginAt·created_at)
  incidentReports / harassmentReports / legalConsultations (status·created_at)
  communicationSendJobs / communicationSendTracking (status·openedAt)

━━━ 신규 함수 4개 ━━━
admin-dashboard-kpi.ts      → GET /api/admin-dashboard-kpi?period=30d|90d|180d|365d
admin-dashboard-cohort.ts   → GET /api/admin-dashboard-cohort?months=6
admin-dashboard-churn.ts    → GET /api/admin-dashboard-churn?level=high|medium|all&limit=50
admin-report-board.ts       → GET /api/admin-report-board?type=quarterly|annual&year=&quarter=

━━━ 응답 구조 (키명 임의 변경 금지 — A mock이 이 구조로 작성됨) ━━━

GET /api/admin-dashboard-kpi 응답:
{
  "ok": true, "period": "30d",
  "donation": {
    "totalAmount": 4500000, "totalCount": 38, "newDonors": 12,
    "regularRetentionRate": 0.87,
    "monthlyTrend": [{ "month": "2026-04", "amount": 2100000, "count": 18 }]
  },
  "member": {
    "newCount": 25, "activeCount": 312, "withdrawnCount": 3,
    "monthlyTrend": [{ "month": "2026-04", "newCount": 14, "withdrawnCount": 1 }]
  },
  "siren": {
    "totalNew": 17, "resolvedRate": 0.71,
    "byType": [{ "type": "incident", "count": 7 }]
  },
  "send": { "totalJobs": 8, "successRate": 0.94, "openRate": 0.42 }
}

GET /api/admin-dashboard-cohort 응답:
{
  "ok": true,
  "cohorts": [{
    "month": "2026-01", "newMembers": 22,
    "firstDonationRate": 0.45, "regularConvertRate": 0.18,
    "churnRate": 0.09, "avgDaysToFirstDonation": 12
  }]
}

GET /api/admin-dashboard-churn 응답:
{
  "ok": true,
  "summary": { "highRisk": 14, "mediumRisk": 38, "total": 52 },
  "members": [{
    "id": 42, "name": "홍길동", "churnRiskScore": 85, "churnRiskLevel": "high",
    "lastLoginAt": "...", "lastDonationAt": "...", "totalDonationAmount": 360000
  }]
}

GET /api/admin-report-board 응답:
{
  "ok": true, "type": "quarterly", "period": "2026 Q1",
  "donation": { "totalAmount": 9800000, "regularAmount": 7200000, "oneTimeAmount": 2600000, "newDonors": 31 },
  "member": { "totalActive": 312, "newCount": 54, "withdrawnCount": 8, "expertCount": 17 },
  "siren": { "totalHandled": 43, "resolvedCount": 36, "pendingCount": 7 },
  "beneficiary": { "counselingCount": 28, "scholarshipCount": 5, "legalCount": 19 }
}

━━━ 구현 주의사항 ━━━
- 집계 쿼리는 drizzle sql`` 태그 직접 사용 (다중 leftJoin 체인 금지)
- regularRetentionRate: 직전 달 정기후원자 중 이번 달도 납부한 비율
- cohort: 각 가입월 기준 추적 — 첫 후원까지의 전환율, 정기 전환율
- churnRisk: members.churnRiskScore 기준 (high≥70, medium 40~69)
- openRate: communicationSendTracking.openedAt IS NOT NULL 비율

━━━ push 전 체크 (이것만 틀려도 머지 불가) ━━━
  □ 브랜치명: feature/phase16-back (새로 생성했는가?)
  □ KPI 최상위 키: donation·member·siren·send (4개 전부)
  □ donation 하위: totalAmount·totalCount·newDonors·regularRetentionRate·monthlyTrend
  □ cohort 배열 키: cohorts (cohort·items 아님)
  □ churn 요약 키: summary.highRisk·summary.mediumRisk
  □ 이사회 보고 키: donation·member·siren·beneficiary
  □ export const config = { path: "/api/admin-xxx" } 4개 전부
  □ requireAdmin 반환 auth.res (auth.response 아님)
  □ npx tsc --noEmit 통과

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.2 A 채팅 — 프론트 구현

```
[A — Phase 16 통합 분석 대시보드 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase16-front ← 반드시 새로 생성 (git checkout -b feature/phase16-front origin/main)
설계서: docs/milestones/2026-05-11-phase16-unified-dashboard.md §3

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

모드: 평행 mock — 아래 mock 데이터로 먼저 구현. B 머지 후 메인이 "실 API 연결" 신호 주면 교체.

━━━ mock 데이터 (B 머지 전 사용) ━━━
// KPI mock
const MOCK_KPI = { ok:true, period:"30d",
  donation:{ totalAmount:4500000, totalCount:38, newDonors:12, regularRetentionRate:0.87,
    monthlyTrend:[{ month:"2026-03", amount:2100000, count:18 },{ month:"2026-04", amount:2400000, count:20 }] },
  member:{ newCount:25, activeCount:312, withdrawnCount:3,
    monthlyTrend:[{ month:"2026-03", newCount:14, withdrawnCount:1 }] },
  siren:{ totalNew:17, resolvedRate:0.71,
    byType:[{ type:"incident", count:7 },{ type:"harassment", count:6 },{ type:"legal", count:4 }] },
  send:{ totalJobs:8, successRate:0.94, openRate:0.42 }
};
// 코호트 mock
const MOCK_COHORT = { ok:true, cohorts:[
  { month:"2026-01", newMembers:22, firstDonationRate:0.45, regularConvertRate:0.18, churnRate:0.09, avgDaysToFirstDonation:12 },
  { month:"2026-02", newMembers:18, firstDonationRate:0.39, regularConvertRate:0.22, churnRate:0.06, avgDaysToFirstDonation:9 }
]};
// 이탈 위험 mock
const MOCK_CHURN = { ok:true,
  summary:{ highRisk:14, mediumRisk:38, total:52 },
  members:[{ id:42, name:"홍길동", churnRiskScore:85, churnRiskLevel:"high",
    lastLoginAt:"2026-03-10T08:00:00Z", lastDonationAt:"2026-02-01T00:00:00Z", totalDonationAmount:360000 }]
};
// 이사회 분기 mock
const MOCK_BOARD = { ok:true, type:"quarterly", period:"2026 Q1",
  donation:{ totalAmount:9800000, regularAmount:7200000, oneTimeAmount:2600000, newDonors:31 },
  member:{ totalActive:312, newCount:54, withdrawnCount:8, expertCount:17 },
  siren:{ totalHandled:43, resolvedCount:36, pendingCount:7 },
  beneficiary:{ counselingCount:28, scholarshipCount:5, legalCount:19 }
};

━━━ 작업 대상 ━━━
1) public/admin.html
   - 사이드바 "📈 통합 분석 대시보드" 메뉴 추가 (📊 통계 그룹 하단)
   - 섹션 div 추가: id="adm-unified-dashboard"
   - 기존 대표 보고서 섹션에 [분기] [연간] 탭 버튼 추가 (기존 [월간] 유지)
2) public/js/admin-unified-dashboard.js — 신규
   - KPI 카드 4개 (월간수입·신규후원자·정기유지율·신규회원)
   - 후원 월별 추이 Chart.js 막대그래프
   - 사이렌 처리 현황 (byType 도넛 또는 가로 막대)
   - 코호트 분석 테이블
   - 이탈 위험 회원 목록 + [재참여 메시지 발송] 버튼
3) public/js/admin-report.js (기존 파일 수정)
   - [분기] [연간] 탭 핸들러 추가
   - GET /api/admin-report-board 호출 → 집계 카드 렌더
4) admin.html 하단: <script src="/js/admin-unified-dashboard.js?v=1">

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/phase16-front (새로 생성했는가?)
  □ mock 데이터 키: donation·member·siren·send / cohorts[] / summary.highRisk / members[]
  □ 실제 API 호출 시 동일 키명 사용
  □ 기존 [월간] 탭 동작 유지 (회귀 없음)
  □ <script> 캐시버스터 ?v=1 포함

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약.
```

### 6.3 C 채팅 — 검증·fix

```
[C — Phase 16 통합 분석 대시보드 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase16 (베이스 main @ B+A 머지 후 커밋)
정독: docs/milestones/2026-05-11-phase16-unified-dashboard.md §4

작업 순서:
  1) §4.1 Q1~Q10 라이브 시나리오 순서대로 실행·기록
  2) §4.2 회귀 점검
  3) bug 발견 시 fix 커밋 → 메인 보고
  4) 보고서 docs/verify/2026-05-11-phase16.md 작성
  5) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
금지: PROJECT_STATE.md, docs/HANDOFF.md, docs/ 수정.
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] **B push 후 머지 전**: B 응답 키와 A mock 키 1:1 대조 (donation·member·siren·send / cohorts / summary.highRisk·members)
- [ ] B `feature/phase16-back` 머지 완료
- [ ] A `feature/phase16-front` 머지 완료 (실 API 연결 확인)
- [ ] C `verify/phase16` 머지 완료
- [ ] Q1~Q10 모두 PASS
- [ ] 기존 대표 보고서 [월간] 탭 회귀 없음 확인
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 Phase 16 진행률 갱신
- [ ] HANDOFF.md 갱신
