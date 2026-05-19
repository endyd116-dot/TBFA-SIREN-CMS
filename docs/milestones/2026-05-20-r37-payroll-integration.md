# R37 — 급여 통합 (Payroll Integration) 설계서

> 작성: 2026-05-20 / 메인 (Opus 4.7)
> Swain 결정: **범위 C·단일 라운드·B 단독·6~7일**
> 기준: main @ 928b4fc (R35 시리즈 종결 + A·B 분석 보고 머지 후)
> 출처 명세: `docs/근태관리시스템_명세서.md §9` + `docs/성과관리시스템_명세서.md §14`
> 영역: 근태(working_mins·overtime_mins) + 성과(quarterly_settlements.totalBonus) + 회원(baseSalary) 통합

---

## §0 목표

매월 말 또는 슈퍼어드민 지정 정산일에 **근태·성과·기본연봉 자동 합산** → **PDF 급여명세서 생성** → **어드민 검토·승인 후 직원 이메일 일괄 발송**.

명세 §9 정책 준수:
- PG 자동 송금 X (외부 회계 시스템 export로 대체)
- 세금 공제·보험료는 외부 회계에서 처리 (gross 기준)
- 슈퍼어드민 검토·승인 후 발송 (감사 추적)

---

## §1 범위 (Swain 결정 — 범위 C)

| 단계 | 내용 | 영역 |
|---|---|---|
| 1 | 근태 working_mins·overtime_mins + 무급휴가·결근 차감 + 만근 보너스 집계 | 자동 합산 |
| 2 | 성과 quarterly_settlements.totalBonus (status='PAID') 월 안분 | 자동 합산 |
| 3 | members.baseSalary 월 환산 (연봉/12) | 자동 합산 |
| 4 | payroll_slips 테이블 INSERT (DRAFT) | 자동 합산 |
| 5 | PDF 급여명세서 생성 (pdf-lib·NotoSansKR) | PDF |
| 6 | 어드민 화면 — 월별 명세서 일람·상세·승인·일괄 발송 | UI |
| 7 | 직원 마이페이지 — 본인 월별 명세서 다운로드 | UI |
| 8 | 이메일 일괄 발송 (Resend·10명 단위 batch·500ms delay) | 이메일 |

---

## §2 DB 마이그레이션

### §2.1 신규 테이블 — `payroll_slips`

```sql
CREATE TABLE payroll_slips (
  id                    SERIAL PRIMARY KEY,
  member_uid            VARCHAR(36) NOT NULL,
  pay_year              INTEGER NOT NULL,
  pay_month             INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),

  -- 근태 집계
  working_days          INTEGER NOT NULL DEFAULT 0,     -- 출근 일수
  working_mins          INTEGER NOT NULL DEFAULT 0,     -- 총 근무 분
  overtime_mins         INTEGER NOT NULL DEFAULT 0,     -- 야근 총 분
  late_count            INTEGER NOT NULL DEFAULT 0,     -- 지각 횟수
  absent_count          INTEGER NOT NULL DEFAULT 0,     -- 결근 횟수
  paid_leave_days       NUMERIC(5,1) NOT NULL DEFAULT 0,   -- 유급 휴가 일수 (반차 0.5)
  unpaid_leave_days     NUMERIC(5,1) NOT NULL DEFAULT 0,   -- 무급 휴가 일수
  perfect_attendance    BOOLEAN NOT NULL DEFAULT FALSE,    -- 만근 여부

  -- 급여 구성
  base_salary_month     NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 월 기본급 (연봉/12)
  overtime_pay          NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 야근 수당 (1.5배)
  deduction_unpaid      NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 무급휴가·결근 차감
  performance_bonus     NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 성과급 (월 안분)
  perfect_bonus         NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 만근 보너스 (정책 정의 시)
  gross_pay             NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 세전 총액

  -- 상태·발송
  status                VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
                        -- DRAFT|REVIEWED|APPROVED|SENT|HOLD
  reviewed_by           VARCHAR(36),
  reviewed_at           TIMESTAMP,
  review_note           TEXT,
  approved_by           VARCHAR(36),
  approved_at           TIMESTAMP,
  sent_at               TIMESTAMP,
  email_sent_to         TEXT,                              -- 발송된 이메일 주소
  pdf_url               TEXT,                              -- R2 업로드된 PDF URL

  -- 메타
  calculation_snapshot  JSONB,                             -- 계산 근거 (감사용)
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (member_uid, pay_year, pay_month)
);

CREATE INDEX idx_payroll_slips_member ON payroll_slips(member_uid);
CREATE INDEX idx_payroll_slips_month ON payroll_slips(pay_year, pay_month);
CREATE INDEX idx_payroll_slips_status ON payroll_slips(status);
```

### §2.2 신규 테이블 — `payroll_send_history` (감사 추적)

```sql
CREATE TABLE payroll_send_history (
  id            SERIAL PRIMARY KEY,
  slip_id       INTEGER NOT NULL REFERENCES payroll_slips(id) ON DELETE CASCADE,
  sent_by       VARCHAR(36) NOT NULL,
  sent_to       TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL,  -- SUCCESS|FAILED
  error_message TEXT,
  resend_id     TEXT,                  -- Resend API 응답 ID
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### §2.3 마이그레이션 함수
- `netlify/functions/migrate-r37-payroll.ts` (어드민 GET ?run=1·1회용)
- schema.ts 정의는 마이그레이션 호출 성공 후 활성화

---

## §3 자동 집계 로직

### §3.1 cron-payroll-monthly (KST 매월 1일 02:00)

매월 1일 직전 달 데이터 집계:
1. `members` SELECT (status='active'·baseSalary>0)
2. 각 회원에 대해:
   - `att_records` 직전 달 SELECT → working_days·working_mins·overtime_mins·late_count·absent_count·paid_leave_days·unpaid_leave_days·perfect_attendance 산출
   - `members.baseSalary / 12` = base_salary_month
   - `overtime_mins / 60 × (base_salary_month × 12 / 2080) × 1.5` = overtime_pay (시급 = 연봉/2080시간)
   - `unpaid_leave_days × (base_salary_month / 22)` = deduction_unpaid (월 22일 기준)
   - `quarterly_settlements` 직전 달이 속한 분기 SELECT (status='PAID') → totalBonus / 3 = performance_bonus (분기 3개월 균등 안분)
   - perfect_attendance=true면 attPolicy.perfectAttendanceBonus = perfect_bonus
   - gross_pay = base_salary_month + overtime_pay - deduction_unpaid + performance_bonus + perfect_bonus
3. `payroll_slips` UPSERT (member_uid·pay_year·pay_month 기준)
4. calculation_snapshot에 모든 입력값 JSON 보존 (감사용)
5. 슈퍼어드민에게 알림 — "{YYYY}년 {MM}월 급여 명세서 N건 자동 생성, 검토 필요"

### §3.2 수동 재계산 API
- `POST /api/admin-payroll/recalculate?year=2026&month=5` — 슈퍼어드민이 수동 재집계 (DRAFT 상태일 때만)

---

## §4 API 카탈로그

| 함수 | 메서드·경로 | 권한 | 기능 |
|---|---|---|---|
| `admin-payroll` | GET `/api/admin-payroll?year=&month=` | super_admin | 월별 명세서 일람 |
| `admin-payroll` | GET `/api/admin-payroll/:id` | super_admin | 명세서 상세 |
| `admin-payroll` | PATCH `/api/admin-payroll/:id` | super_admin | 명세서 수정 (review_note·status 변경) |
| `admin-payroll` | POST `/api/admin-payroll/:id/approve` | super_admin | 승인 (status=APPROVED) |
| `admin-payroll` | POST `/api/admin-payroll/:id/hold` | super_admin | 보류 (status=HOLD) |
| `admin-payroll` | POST `/api/admin-payroll/recalculate` | super_admin | 월별 수동 재집계 |
| `admin-payroll-pdf` | GET `/api/admin-payroll-pdf/:id` | super_admin | PDF 생성·다운로드 |
| `admin-payroll-send` | POST `/api/admin-payroll-send` body `{year, month, slipIds?}` | super_admin | 일괄 이메일 발송 |
| `admin-payroll-export` | GET `/api/admin-payroll-export?year=&month=` | super_admin | CSV export (회계 시스템용) |
| `payroll-my` | GET `/api/payroll-my?year=` | operator+admin | 본인 월별 명세서 일람 |
| `payroll-my-pdf` | GET `/api/payroll-my-pdf/:id` | operator+admin | 본인 PDF 다운로드 (status≥SENT만) |
| `cron-payroll-monthly` | scheduled | system | 매월 1일 02:00 자동 집계 |

---

## §5 PDF 명세서 구조

기존 `admin-finance-report-pdf.ts` 패턴 재사용·NotoSansKR 폰트 임베딩.

A4 1페이지 구성:
```
┌──────────────────────────────────────────┐
│  교사유가족협의회 급여명세서             │
│  {YYYY}년 {MM}월                          │
├──────────────────────────────────────────┤
│  성명: {name}                             │
│  직책: {role/milestoneRole}               │
│  발행일: {YYYY-MM-DD}                     │
├──────────────────────────────────────────┤
│  근태 현황                                │
│  - 출근 일수: {working_days}일            │
│  - 총 근무: {working_mins/60}시간         │
│  - 야근: {overtime_mins/60}시간           │
│  - 지각: {late_count}회                   │
│  - 결근: {absent_count}회                 │
│  - 유급 휴가: {paid_leave_days}일         │
│  - 무급 휴가: {unpaid_leave_days}일       │
│  - 만근: {perfect_attendance ? Y : N}     │
├──────────────────────────────────────────┤
│  급여 구성                                │
│  + 월 기본급:     {base_salary_month} 원  │
│  + 야근 수당:     {overtime_pay} 원       │
│  - 무급 차감:     {deduction_unpaid} 원   │
│  + 성과 보너스:   {performance_bonus} 원  │
│  + 만근 보너스:   {perfect_bonus} 원      │
│  ─────────────────────────────────────    │
│  세전 총액:      {gross_pay} 원           │
├──────────────────────────────────────────┤
│  ※ 본 명세서는 세전 금액 기준입니다.      │
│  ※ 소득세·4대보험 공제는 별도 처리됩니다. │
└──────────────────────────────────────────┘
```

PDF는 R2에 업로드·`pdf_url` 컬럼에 경로 저장 (재생성 비용 절감).

---

## §6 어드민 화면

### §6.1 진입점
- `public/cms-tbfa.html` cms-menu에 `#payroll` 탭 추가 (icon 💰·label "급여관리")
- `public/admin-payroll.html` 신설 (iframe 임베드)
- `public/js/admin-payroll.js` 신설

### §6.2 화면 구성
- 상단: 연·월 선택 + "재집계" 버튼 + "전체 발송" 버튼 + 통계 카드 (DRAFT N건·REVIEWED M건·APPROVED K건·SENT L건)
- 본문: 회원별 명세서 표 (이름·직책·세전 총액·상태·PDF 다운로드·승인·보류 버튼)
- 상세 모달: calculation_snapshot 표시 (계산 근거·수정 가능 필드는 review_note만)

### §6.3 직원 마이페이지
- `workspace-attendance.html` 또는 별도 `workspace-payroll.html`에 본인 월별 명세서 일람 + PDF 다운로드 버튼
- status≥SENT(승인 완료 + 발송됨)만 표시 (검토 중 상태는 비공개)

---

## §7 이메일 발송

### §7.1 발송 정책
- 슈퍼어드민이 어드민 화면에서 "전체 발송" 또는 개별 발송 트리거
- status=APPROVED인 명세서만 발송 가능
- 발송 후 status=SENT·sent_at 갱신
- 일괄 발송: 10명 단위 batch·각 batch 사이 500ms delay (Resend rate limit 100건/분 대응)

### §7.2 이메일 본문
- Subject: `[교사유가족협의회] {YYYY}년 {MM}월 급여명세서`
- 본문: 회원 이름·발급월·세전 총액 요약 + "첨부 PDF로 상세 확인" 안내
- 첨부: PDF (또는 R2 다운로드 링크 — 첨부 용량 제한 시 fallback)

### §7.3 감사 추적
- 발송 성공·실패 모두 `payroll_send_history` INSERT
- Resend API 응답 ID 저장 (반송·재발송 추적용)

---

## §8 권한 매트릭스

| API | super_admin | admin | operator | regular |
|---|---|---|---|---|
| admin-payroll (GET/PATCH/POST) | ✅ | ❌ 403 | ❌ 401 | ❌ 401 |
| admin-payroll-pdf | ✅ | ❌ | ❌ | ❌ |
| admin-payroll-send | ✅ | ❌ | ❌ | ❌ |
| admin-payroll-export (CSV) | ✅ | ❌ | ❌ | ❌ |
| payroll-my (GET) | ✅ | ✅ | ✅ | ❌ 403 |
| payroll-my-pdf | ✅ 본인만 | ✅ 본인만 | ✅ 본인만 | ❌ |

`requireAdmin` (super_admin 강제) + `requireOperator` (본인만) 가드 활용.

---

## §9 알림 정책

- 자동 집계 완료 시: 슈퍼어드민 전체 → "{YYYY}년 {MM}월 급여 명세서 N건 생성, 검토 필요" + 링크
- 명세서 보류 시: 해당 회원 → "{YYYY}년 {MM}월 명세서 검토 중" (선택)
- 명세서 발송 시: 회원 본인 → 인앱 알림 + 이메일

---

## §10 회귀 위험

- 기존 `quarterly_settlements` (성과)와 `payroll_slips` (월별)의 동기화 시점 — 분기 종료 후 익월 1일 발송에 totalBonus PAID 반영 보장
- `att_records.workingMins NULL` 케이스 처리 (적재 실패 시 0 처리)
- 회원 baseSalary=0인 직원은 명세서 생성 스킵 (외부 알바·임시직)
- 만근 보너스 미정의 직원은 perfect_bonus=0 (정책 추가 시 활성화)
- PDF 생성 폰트 로딩 실패 시 fallback 텍스트
- 이메일 발송 실패 시 재시도 큐 (수동 재발송 가능 상태 유지)

---

## §11 검증 시나리오 (C 라이브 검증·R37 종결 후)

- Q1. cron-payroll-monthly 수동 트리거 → 회원 N명 payroll_slips DRAFT 생성·calculation_snapshot 정합
- Q2. 슈퍼어드민이 명세서 검토 → status=REVIEWED → APPROVED
- Q3. PDF 다운로드 → A4 1페이지·한글 정상·금액 정합
- Q4. 일괄 이메일 발송 → 10명씩 batch·500ms delay·Resend 응답 정상
- Q5. payroll_send_history 적재 + status=SENT 갱신
- Q6. 직원 마이페이지에서 본인 명세서 다운로드 (status≥SENT만)
- Q7. CSV export (회계 시스템용) 컬럼 정합
- Q8. 권한 매트릭스 — 일반 회원·미인증 차단·본인 외 다운로드 차단
- Q9. 회귀 — quarterly_settlements PAID·att_records 정상 반영
- Q10. 회원 baseSalary=0 → 명세서 미생성 (스킵)

---

## §12 일정 (B 단독·6~7일)

| 일차 | 작업 |
|---|---|
| 1 | DB 마이그·schema 정의·API 골격 (CRUD 6개 함수) |
| 2 | cron-payroll-monthly + 자동 집계 로직 (근태·성과·base_salary) |
| 3 | PDF 생성 (admin-payroll-pdf·NotoSansKR 임베딩) |
| 4 | 어드민 화면 (admin-payroll.html·js·cms-tbfa 메뉴 추가) |
| 5 | 이메일 발송 (Resend batch·rate limit·payroll_send_history) |
| 6 | 직원 마이페이지 본인 명세서 다운로드 + CSV export |
| 7 | 마이그 호출 + 본인 라이브 검증 + push |

---

## §13 자율주행 (B 단독)

- DB 마이그 호출은 Swain에게 요청 (메인 9.2 흐름)
- 외 모든 작업 자율 (코드 작성·push·임시 브랜치 정리)
- 단계별 진행률 % 보고 (1일차 끝·3일차 끝·5일차 끝·7일차 끝)
- 막히는 부분(정책 결정·외부 인프라 격차) 발생 시 즉시 메인 보고

---

## §14 §6 제외 항목

- 소득세·4대보험 공제 자동 계산 (외부 회계 처리)
- PG 자동 송금 (명세 §9 정책)
- 다국어·다중 통화 (KRW 단일)
- 임시직·알바 다중 직급별 템플릿 (baseSalary=0 스킵)
- 소급 변경 (수동 재계산으로 대체)

---

## §15 갱신 이력

| 시각 | 변경 |
|---|---|
| 2026-05-20 | 최초 작성 — 범위 C·단일 라운드·B 단독·6~7일 |
