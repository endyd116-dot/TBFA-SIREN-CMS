# Phase 28: 성과관리 완성 — 알림·AI·씨드·EVENT_RANGE·CSV

> 작성: 2026-05-19 | 기존 성과관리 65% 완성본 기반 나머지 35% 전면 완성

---

## 0. 전제 조건

- 기존 테이블: `milestone_definitions`, `revenue_entries`, `non_revenue_achievements`, `quarterly_settlements`, `quarters` 모두 존재
- `revenue_entries.amount` 컬럼을 EVENT_RANGE 결정 금액으로 재활용 (슈퍼어드민 검증 시 amount 업데이트)
- `non_revenue_achievements.event_range_amount` 컬럼 이미 존재
- `lib/notify.ts` NotifyCategory에 `"milestone"` 추가 필요 (TypeScript 타입만, DB 변경 없음)

---

## 1. 마이그레이션 (씨드 데이터)

```
GET /api/migrate-phase28-milestone-seed?run=1
```

### 씨드 INSERT 목록 (47개)

#### 사무국장 (sm) — 매출연동 6개
| code | name | category | threshold | formula |
|---|---|---|---|---|
| sm-001 | 신규 정기후원자 유치 (캠페인 외 직접 모집) | REVENUE_LINKED | 분기 20명 | FLAT 1명당 60,000원 |
| sm-002 | 장기후원 전환 (캠페인 경유+3개월 유지) | REVENUE_LINKED | 분기 5명 | FLAT 1명당 50,000원 |
| sm-003 | 월 평균 정기후원 누적액 | REVENUE_LINKED | 월 3,000,000원 | BRACKET [4M→500k / 6M→1,000k / 8M→2,000k] |
| sm-004 | 분기 일시후원금 총액 | REVENUE_LINKED | 5,000,000원 | BRACKET [10M→1,500k / 20M→4,000k] |
| sm-005 | 캠페인 모금액 | REVENUE_LINKED | 10,000,000원 | BRACKET [30M→1,500k / 50M→3,000k] |
| sm-006 | 기업·기관 후원 협약 체결 | REVENUE_LINKED | 없음 | EVENT_RANGE [500k~1,000k] |

#### 사무국장 (sm) — 비매출 Q1 4개 + Q2 4개
| code | name | category | bonusAmount |
|---|---|---|---|
| sm-q1-01 | 사단법인 인가 완료 | NON_REVENUE | 1,000,000 |
| sm-q1-02 | 신규 유족 회원 30명 등록 | NON_REVENUE | 1,000,000 |
| sm-q1-03 | 신규 유족 회원 50명 등록 | NON_REVENUE | 2,000,000 |
| sm-q1-04 | 기업·기관 후원 첫 협약 체결 | NON_REVENUE | 2,000,000 |
| sm-q2-01 | 지정기부금단체 지정 | NON_REVENUE | 3,000,000 |
| sm-q2-02 | 신규 유족 회원 누적 80명 달성 | NON_REVENUE | 2,000,000 |
| sm-q2-03 | 신규 유족 회원 누적 120명 달성 | NON_REVENUE | 3,000,000 |
| sm-q2-04 | 기업·기관 후원 협약 누적 3건↑ | NON_REVENUE | 3,000,000 |

#### 정책국장 (pm) — 매출연동 10개
| code | name | category | threshold | formula |
|---|---|---|---|---|
| pm-001 | 함께워크 ON 분기 매출 | REVENUE_LINKED | 15,000,000원 | PERCENT 초과분 1.5% |
| pm-002 | 신규 상주 입주사 | REVENUE_LINKED | 분기 7팀 | FLAT 1팀당 40,000원 |
| pm-003 | 신규 비상주 입주사 | REVENUE_LINKED | 분기 15팀 | FLAT 1팀당 20,000원 |
| pm-004 | 유료 세미나·강연 매출 | REVENUE_LINKED | 5,000,000원 | PERCENT 초과분 4% |
| pm-005 | 유족 순직 지원 컨설팅료 | REVENUE_LINKED | 없음 | EVENT_RANGE [200k~1,100k] |
| pm-006 | 교육청·교육부 외주용역 수주 | REVENUE_LINKED | 없음 | PERCENT 계약금액 1.2% |
| pm-007 | 정책연구지 발간 외주용역 | REVENUE_LINKED | 없음 | PERCENT 계약금액 1.5% |
| pm-008 | 순직심의 지원 외주용역 | REVENUE_LINKED | 없음 | PERCENT 계약금액 1.5% |
| pm-009 | 진상조사 외주용역 | REVENUE_LINKED | 없음 | PERCENT 계약금액 1.5% |
| pm-010 | 1,000원의 행복 캠페인 운영비 | REVENUE_LINKED | 없음 | PERCENT 환원 운영비 2.5% |

#### 정책국장 (pm) — 비매출 Q1 7개 + Q2 8개
| code | bonusAmount |
|---|---|
| pm-q1-01 함께워크 ON 입주율 50% 달성 | 800,000 |
| pm-q1-02 함께워크 ON 입주율 70% 달성 | 1,500,000 |
| pm-q1-03 비상주 입주사 누적 10팀 달성 | 800,000 |
| pm-q1-04 교육청·교육부 첫 MOU 체결 | 1,500,000 |
| pm-q1-05 순직 인정 사건 승소 (1건) | 1,100,000 |
| pm-q1-06 1,000원의 행복 협약 체결 | 2,300,000 |
| pm-q1-07 주요 일간지 1면·메인 방송 보도 | 800,000 |
| pm-q2-01 함께워크 ON 입주율 80% 달성 | 1,500,000 |
| pm-q2-02 비상주 입주사 누적 30팀 달성 | 1,100,000 |
| pm-q2-03 교육부 외주용역 첫 수주 | 3,000,000 |
| pm-q2-04 정책연구지 발간 첫 수주 | 2,300,000 |
| pm-q2-05 순직심의 지원 사업 첫 수주 | 2,300,000 |
| pm-q2-06 순직 인정 사건 승소 (1건당) | 1,500,000 |
| pm-q2-07 관련 법안 국회 발의 | 1,500,000 |
| pm-q2-08 사회적협동조합 발기인+정관 채택 | 800,000 |

#### SI 영업·사업관리자 (si) — 매출연동 7개
| code | name | threshold | formula | shared |
|---|---|---|---|---|
| si-001 | SI 수주 — 중개플랫폼 | 합산 30,000,000원 | PERCENT 초과분 4% | O |
| si-002 | SI 수주 — 직접 영업 | 합산 30,000,000원 | PERCENT 초과분 5% | O |
| si-003 | SI 수주 — NPO 협회 영업 | 합산 30,000,000원 | PERCENT 초과분 5% | O |
| si-004 | 자체 AI 솔루션 매출 | 5,000,000원 | PERCENT 초과분 5% | X |
| si-005 | 정부과제 수주 | 없음 | PERCENT 수주금액 1% | X |
| si-006 | 정부용역 수주 | 없음 | PERCENT 수주금액 1% | X |
| si-007 | 공공입찰 낙찰 가산 | 없음 | PERCENT 낙찰금액 1% | X |

#### SI (si) — 비매출 Q1 6개 + Q2 7개
| code | bonusAmount |
|---|---|
| si-q1-01 첫 SI 프로젝트 계약 체결 | 1,000,000 |
| si-q1-02 중개플랫폼 등록+첫 수주 | 1,000,000 |
| si-q1-03 누적 수주 5,000만원 달성 | 2,000,000 |
| si-q1-04 누적 수주 1억원 달성 | 4,000,000 |
| si-q1-05 자체 AI 솔루션 첫 유료 계약 체결 | 2,500,000 |
| si-q1-06 NPO 협회 첫 영업 수주 | 2,000,000 |
| si-q2-01 정부과제 수주 (1건) | 4,000,000 |
| si-q2-02 정부용역 수주 (1건) | 4,000,000 |
| si-q2-03 누적 수주 2억원 달성 | 3,000,000 |
| si-q2-04 누적 수주 3억원 달성 | 5,000,000 |
| si-q2-05 자체 AI 솔루션 누적 유료 고객 5팀 | 3,000,000 |
| si-q2-06 외부 SI 프로젝트 NPS 70+ (서면 추천서) | 1,500,000 |
| si-q2-07 벤처기업 인증 취득 | 1,000,000 |

---

## 2. A (프론트) 작업 분담

### 2-A-1. workspace-milestones.html + workspace-milestones.js (★ R34-P1-B-3 위치 정정)
- [x] 매출 검증 탭에서 EVENT_RANGE 마일스톤 항목 표시 시 **금액 범위 표시 + 결정 금액 입력 필드** (구현 완료)
  - 항목 행에 "범위: {min/10000}~{max/10000}만원 (원 단위 입력)" 표시 — DB는 원 단위 저장, UI 표시만 만원 변환 (R34-P1-B-1)
  - `<input type="number" id="eventRangeAmount_{id}" min={원} max={원}>` (검증 전까지 비활성, 렌더 후 활성)
  - "검증 + 금액 확정" 버튼 → `__msVerifyEventRange(id)` 호출
  - PUT body에 `eventRangeAmount`(원) 포함하여 `/api/admin-milestone-revenue/:id` 전송
  - 실제 위치는 admin-milestone-settings.html이 아닌 workspace-milestones.html이며, 매출 검증 권한이 슈퍼어드민으로 제한됨

### 2-A-2. workspace-milestones.html + workspace-milestones.js
- [ ] 비매출 섹션 헤더에 **"선택됨 N/2개"** 배지 실시간 표시
  - `isSelectedForQuarter=true` 항목 count → `selectedCount/2` 형식으로 표시
  - 2개 이미 선택 시 미선택 항목 체크박스 비활성화 + 툴팁 "최대 2개 선택"
- [ ] 비매출 소계 표시 개선
  - 선택된 2개 항목의 bonusAmount 합산 표시 (미선택 항목은 회색 처리)
  - 명세서 §12.1 와이어프레임 수준으로 [선택됨] 배지 표시

### 2-A-3. admin-milestones.html + admin-milestones.js
- [ ] **AI 인사이트 패널** 추가 (결산 검토 화면 하단)
  - "AI 요약 생성" 버튼 → `POST /api/ai-milestone-insight {type:"summary", quarterId}` 호출
  - 결과 텍스트 패널 표시
  - "이상 탐지" 버튼 → `POST /api/ai-milestone-insight {type:"anomaly", quarterId}` 호출
  - "다음 분기 추천" 버튼 → `POST /api/ai-milestone-insight {type:"recommend"}` 호출
- [ ] **급여시스템 CSV export 버튼** 추가
  - "급여 내보내기" 버튼 → `GET /api/admin/milestone-settlement-export?quarterId=X` → CSV 다운로드
- [ ] 결산 작성 중 **자가평가 코칭** 표시 (workspace-milestones.js)
  - 자가평가 textarea 작성 중 "AI 코칭" 버튼 → `POST /api/ai-milestone-insight {type:"coach", selfEvalText}` → 미입력 항목 안내

---

## 3. B (백엔드) 작업 분담

### 3-B-1. lib/notify.ts 수정
- [ ] `NotifyCategory` 타입에 `"milestone"` 추가

### 3-B-2. migrate-phase28-milestone-seed.ts (신규)
- [ ] path: `/api/migrate-phase28-milestone-seed`
- [ ] §1의 47개 마일스톤 `INSERT INTO milestone_definitions ... ON CONFLICT (code) DO NOTHING`
- [ ] 멱등 보장 (이미 등록된 code 건너뜀)

### 3-B-3. 기존 API 6개 — 알림 연결

| 파일 | 이벤트 | 추가 위치 | 수신자 | 함수 |
|---|---|---|---|---|
| milestone-revenue.ts | 매출 입력 후 | INSERT 직후 | 담당 어드민 | `createNotification` |
| admin-milestone-revenue.ts | 검증 승인 후 | status=VERIFIED 직후 | 입력자 | `createNotification` |
| admin-milestone-revenue.ts | 검증 반려 후 | status=REJECTED 직후 | 입력자 | `createNotification` |
| milestone-nonrevenue.ts | 비매출 제출 후 | INSERT/UPDATE 직후 | 슈퍼어드민 전체 | `notifyAllSuperAdmins` |
| admin-milestone-nonrevenue.ts | 비매출 검증 후 | VERIFIED 직후 | 해당 어드민 | `createNotification` |
| admin-milestone-nonrevenue.ts | 비매출 반려 후 | REJECTED 직후 | 해당 어드민 | `createNotification` |
| milestone-settlement.ts | 결산 제출 후 | SUBMITTED 직후 | 슈퍼어드민 전체 | `notifyAllSuperAdmins` |
| admin-milestone-settlement.ts | 결산 승인 후 | APPROVED 직후 | 해당 어드민 | `createNotification` |
| admin-milestone-settlement.ts | 결산 반려 후 | REJECTED 직후 | 해당 어드민 | `createNotification` |
| admin-milestone-definitions.ts | 정의 변경 후 | PUT 성공 직후 | 모든 어드민 | `notifyMany(어드민ID목록)` |

- [ ] milestone-revenue.ts 알림 연결
- [ ] admin-milestone-revenue.ts 알림 연결 + EVENT_RANGE 금액 저장 처리
  - PUT 요청에 `eventRangeAmount` 파라미터 수신 → `amount` 컬럼 업데이트
- [ ] milestone-nonrevenue.ts 알림 연결
- [ ] admin-milestone-nonrevenue.ts 알림 연결
- [ ] milestone-settlement.ts 알림 연결
- [ ] admin-milestone-settlement.ts 알림 연결
- [ ] admin-milestone-definitions.ts 알림 연결

### 3-B-4. cron-milestone-quarter.ts 완성
- [ ] **D-7 알림**: 분기 종료 7일 전 → 모든 어드민에게 "결산 작성 기한 D-7" 알림 (`notifyMany`)
- [ ] **미제출 에스컬레이션**: 결산일 도래 + DRAFT/미제출 결산 존재 → 슈퍼어드민에게 미제출자 명단 알림 (`notifyAllSuperAdmins`)
- [ ] **임계점 도달 체크**: 매일 실행 시 각 어드민의 REVENUE_LINKED 마일스톤 누적치가 임계점 넘은 경우 → 해당 어드민 알림 (중복 방지: 같은 마일스톤 같은 분기 1회)

### 3-B-5. ai-milestone-classify.ts (신규)
- [ ] path: `/api/ai-milestone-classify`, POST
- [ ] requireActiveUser
- [ ] body: `{ description: string, quarterId: number }`
- [ ] 내부: 현재 활성 마일스톤 정의 목록 조회 → Gemini 호출
  - 시스템: "당신은 NPO 조직의 매출 원천 분류 도우미입니다."
  - 사용자: "다음 매출 설명을 분석하여 가장 적합한 마일스톤 1개를 추천하세요.\n설명: {description}\n마일스톤 목록: {name 목록}\nJSON: {definitionId, name, confidence(0~1), reason}"
- [ ] 응답: `{ ok, suggestion: { definitionId, name, confidence, reason } }`
- [ ] Gemini 실패 시 → `{ ok: false, error: "분류 실패" }` (throw 금지)

### 3-B-6. ai-milestone-insight.ts (신규)
- [ ] path: `/api/ai-milestone-insight`, POST
- [ ] requireAdmin (슈퍼어드민 또는 어드민)
- [ ] body: `{ type: "summary" | "anomaly" | "coach" | "recommend", quarterId?: number, memberId?: number, selfEvalText?: string }`
- [ ] type별 처리:
  - **summary**: 해당 분기 전 직원 결산 데이터 수집 → Gemini → 핵심 성과 요약 문장 (500자)
  - **anomaly**: 최근 3개 분기 매출 트렌드 수집 → Gemini → 급증·급락 항목 + 원인 분석 가설
  - **coach**: selfEvalText 분석 → Gemini → 미입력 항목·놓친 성과 안내 (300자)
  - **recommend**: 현재 분기 데이터 분석 → Gemini → 다음 분기 마일스톤 추가 추천 (3~5개)
- [ ] 응답: `{ ok, data: { text: string, items?: string[] } }`
- [ ] Gemini 실패 시 폴백 텍스트 반환 (throw 금지)

### 3-B-7. admin-milestone-settlement-export.ts (신규)
- [ ] path: `/api/admin/milestone-settlement-export`, GET
- [ ] requireAdmin
- [ ] query: `?quarterId=X`
- [ ] 해당 분기 전 직원 결산 조회 (quarterly_settlements + members JOIN)
- [ ] CSV 생성 (UTF-8 BOM):
  - 컬럼: 직원명, 직책, 매출연동 인센티브, 비매출 보너스, 총 변동급, 기본 연봉, 상태, 지급일
- [ ] `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="settlement-YYYY-QN.csv"`

---

## 4. API 계약

### ai-milestone-classify.ts
```
POST /api/ai-milestone-classify
body: { description: string, quarterId: number }
→ { ok, suggestion: { definitionId, name, confidence, reason } }
```

### ai-milestone-insight.ts
```
POST /api/ai-milestone-insight
body: { type: "summary"|"anomaly"|"coach"|"recommend", quarterId?, memberId?, selfEvalText? }
→ { ok, data: { text: string, items?: string[] } }
```

### admin-milestone-settlement-export.ts
```
GET /api/admin/milestone-settlement-export?quarterId=X
→ CSV 파일 (Content-Disposition: attachment)
컬럼: 직원명, 직책, 매출연동인센티브, 비매출보너스, 총변동급, 기본연봉, 상태, 지급일
```

---

## 5. Gemini 프롬프트 전략

### 매출 자동 분류 (ai-milestone-classify.ts)
```
시스템: "당신은 NPO 조직의 매출 원천 분류 전문가입니다."
사용자: "다음 매출 항목을 분석하여 아래 마일스톤 중 가장 적합한 1개를 JSON으로 추천하세요.
설명: {description}
마일스톤 목록: {id, name 목록}
응답: { definitionId: number, name: string, confidence: 0~1, reason: string }"
```

### 분기 결산 요약 (summary)
```
시스템: "NPO 조직 성과 분석 HR 어시스턴트입니다."
사용자: "{year}년 {quarter}분기 전 직원 성과를 핵심 3줄로 요약하세요.
데이터: {직원별 인센티브 합계·비매출 달성 항목}"
```

### 이상 탐지 (anomaly)
```
사용자: "최근 3개 분기 매출 트렌드를 분석하여 급증·급락 항목과 원인 가설을 3개 이내로 제시하세요.
데이터: {분기별 마일스톤 누적치}"
```

### 자가평가 코칭 (coach)
```
사용자: "다음 자가평가 내용에서 누락되거나 보완이 필요한 성과 항목을 안내하세요. 200자 이내.
자가평가: {selfEvalText}
달성 마일스톤: {verified 목록}"
```

### 마일스톤 추천 (recommend)
```
사용자: "현재 분기 데이터를 바탕으로 다음 분기에 추가하면 좋을 마일스톤 3~5개를 추천하세요.
현재 마일스톤: {name 목록}
이번 분기 달성 패턴: {summary}"
```

---

## 6. 캐시버스터

| 파일 | 현재 | 변경 후 |
|---|---|---|
| admin-milestone-settings.html | `admin-milestone-settings.js?v=1` | `?v=2` |
| admin-milestones.html | `admin-milestones.js?v=1` | `?v=2` |
| workspace-milestones.html | `workspace-milestones.js?v=1` | `?v=2` |

---

## 7. 완료 기준 (100% 체크리스트)

### 알림 (명세서 §8 전체)
- [ ] 매출 입력 → 해당 어드민 인앱 알림
- [ ] 매출 검증/반려 → 입력자 인앱 알림
- [ ] 비매출 제출 → 슈퍼어드민 인앱 알림
- [ ] 비매출 검증/반려 → 해당 어드민 인앱 알림
- [ ] 임계점 도달 → 해당 어드민 인앱 알림
- [ ] 분기 종료 D-7 → 모든 어드민 인앱 알림
- [ ] 결산 제출 → 슈퍼어드민 인앱 알림
- [ ] 결산 승인 → 해당 어드민 인앱 알림
- [ ] 결산 반려 → 해당 어드민 인앱 알림
- [ ] 마일스톤 정의 변경 → 모든 어드민 인앱 알림
- [ ] 미제출 결산 에스컬레이션 → 슈퍼어드민 인앱 알림

### AI (명세서 §10 전체)
- [ ] 매출 입력 시 자동 분류 추천
- [ ] 분기 결산 요약 자동 생성
- [ ] 이상 탐지 (급증·급락 원인 가설)
- [ ] 자가평가 코칭
- [ ] 다음 분기 마일스톤 추천

### 기타
- [ ] 씨드 데이터 47개 마이그레이션 완료
- [ ] EVENT_RANGE 검증 시 금액 결정 UI (admin-milestone-settings.html)
- [ ] 비매출 N/2개 선택 시각화 (workspace-milestones.html)
- [ ] 급여시스템 CSV export (admin-milestones.html)
