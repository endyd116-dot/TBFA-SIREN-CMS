# Phase 22-D — 전표 관리 + 통장거래내역 자동화

> 작성: 2026-05-15 메인
> 상위: Phase 22 재정 시리즈 (22-A 매출 → 22-B 화면 이전/예산 → 22-C 지출 → **22-D 전표·자동화**)
> 전제: **Phase 22-B-R1 완료 후** 착수 (지출 관리 패널이 cms-tbfa.html로 이전 완료된 상태)
> 라운드 구성: R1 전표 기본 / R2 통장 자동 처리 / R3 AI 부가기능

---

## §0 요구사항 (Swain 결정 2026-05-15)

| 항목 | 결정 |
|---|---|
| 전표 위치 | 지출 관리(`expenses`) 패널에 "전표" 탭 추가 |
| 전표 구성 | 항목·세목·증빙(종류+파일)·어느 예산에서 사용했는지(선택) |
| 통장 가져오기 | CSV·XLSX 업로드 → 지출 자동 파악 → 전표 자동 작성 |
| 예산 연결 | 업로드 시 기본 예산 선택 가능; 모호한 항목은 AI가 관리자에게 확인 요청 |
| 부가기능 | AI가 판단해서 관련 기능 포함 (§1 참고) |

---

## §1 AI 제안 부가기능 (자동 포함 범위)

> "이것과 관련된 여러 부가기능도 AI가 판단해서 꾸며줘" — Swain 지시

| 기능 | 라운드 | 근거 |
|---|---|---|
| 계정과목 마스터 (NPO 표준 코드) | R1 | 전표 작성의 기반 — 없으면 전표 의미 없음 |
| 전표 검색·필터 (날짜/금액/거래처/계정/예산) | R1 | 기본 운영에 필수 |
| 전표 승인 이메일 알림 | R1 | 기존 Resend 인프라 활용, 3줄 추가 |
| 반복 전표 템플릿 (임대료·공과금 등 월정기) | R1 | 공수 저렴, 실무 절약 큼 |
| 거래처(공급자) 마스터 | R2 | 통장 자동화와 같이 쓸 때 효과 극대화 |
| 증빙 OCR (영수증 사진 → 금액/날짜 자동 추출) | R2 | Gemini Vision API — 통장 자동화와 묶어서 |
| 예산 잠금(Encumbrance) — 전표 제출 시 가용 예산 예약 | R2 | 예산 초과 방지, R2 예산 편성(22-B-R2)과 연동 |
| 월말 결산 보조 — 미결 전표 자동 감지·마감 | R3 | 회계 마감 워크플로우 |
| 이상 지출 패턴 감지 — 전월 대비 급증 알림 | R3 | AI 분석, Cron 연동 |
| 전표 인쇄 (NPO 표준 양식, A4) | R3 | window.print + print CSS 기존 패턴 |

---

## §2 DB 스키마 (R1)

> 22-B-R1 완료 후 마이그레이션. `expenses`·`budgets` 테이블과 FK 연결.

### 2.1 계정과목 마스터 (NPO 표준 — 초기 seed 포함)

```sql
-- account_codes (계정과목 마스터)
CREATE TABLE account_codes (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,    -- '5031'
  name       TEXT NOT NULL,           -- '임차료'
  parent_code TEXT,                   -- '503' (대분류)
  category   TEXT NOT NULL,           -- 'personnel'|'program'|'admin_ops'|'fundraising'|'income'
  is_active  BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0
);
```

초기 seed (NPO 표준):
| 코드 | 명 | 분류 |
|---|---|---|
| 501 | 인건비 | personnel |
| 5011 | 급여 | personnel |
| 5012 | 퇴직급여 | personnel |
| 5013 | 복리후생비 | personnel |
| 502 | 사업비 | program |
| 5021 | 교육·상담비 | program |
| 5022 | 캠페인·행사비 | program |
| 5023 | 장학금 | program |
| 503 | 관리운영비 | admin_ops |
| 5031 | 임차료 | admin_ops |
| 5032 | 통신비 | admin_ops |
| 5033 | 사무용품비 | admin_ops |
| 5034 | 공과금(광열수도) | admin_ops |
| 5035 | 차량유지비 | admin_ops |
| 5036 | 업무추진비 | admin_ops |
| 504 | 모금비 | fundraising |
| 5041 | 홍보비 | fundraising |
| 5042 | 모금행사비 | fundraising |

### 2.2 전표 (vouchers)

```sql
CREATE TABLE vouchers (
  id               SERIAL PRIMARY KEY,
  voucher_number   TEXT NOT NULL UNIQUE,  -- 자동: 'YYYYMM-NNN'
  voucher_date     DATE NOT NULL,
  fiscal_year      INTEGER NOT NULL,       -- voucher_date 연도 자동
  account_code     TEXT NOT NULL,          -- FK → account_codes.code
  account_name     TEXT NOT NULL,          -- 비정규화 (성능)
  sub_account      TEXT,                   -- 세목 (자유 입력)
  description      TEXT NOT NULL,          -- 적요
  payee_name       TEXT,                   -- 거래처
  amount           BIGINT NOT NULL,
  evidence_type    TEXT NOT NULL DEFAULT 'none',
                   -- 'tax_invoice'|'receipt'|'card_slip'|'transfer_confirm'|'none'
  evidence_number  TEXT,                   -- 세금계산서 번호 등
  evidence_url     TEXT,                   -- R2 파일 URL
  budget_id        INTEGER REFERENCES budgets(id),
  expense_id       INTEGER REFERENCES expenses(id),  -- 지출 연결 (선택)
  bank_txn_id      INTEGER,                -- FK → bank_transactions.id (R2에서 활성화)
  is_template      BOOLEAN DEFAULT FALSE, -- 반복 템플릿 여부
  template_name    TEXT,                   -- 템플릿 이름
  status           TEXT NOT NULL DEFAULT 'draft',
                   -- 'draft'|'submitted'|'approved'|'rejected'
  rejection_reason TEXT,
  created_by       TEXT NOT NULL REFERENCES members(uid),
  submitted_at     TIMESTAMPTZ,
  approved_by      TEXT REFERENCES members(uid),
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.3 통장 업로드 기록 (R2 — R1에서 테이블만 생성, 기능은 R2)

```sql
CREATE TABLE bank_imports (
  id           SERIAL PRIMARY KEY,
  filename     TEXT NOT NULL,
  bank_name    TEXT,          -- '국민은행'|'신한은행'|'하나은행'|'우리은행'|'기타'
  period_from  DATE,
  period_to    DATE,
  total_rows   INTEGER DEFAULT 0,
  auto_matched INTEGER DEFAULT 0,
  pending_review INTEGER DEFAULT 0,
  ignored_rows INTEGER DEFAULT 0,
  imported_by  TEXT NOT NULL REFERENCES members(uid),
  imported_at  TIMESTAMPTZ DEFAULT NOW(),
  status       TEXT DEFAULT 'processing'  -- 'processing'|'review'|'completed'
);

CREATE TABLE bank_transactions (
  id              SERIAL PRIMARY KEY,
  import_id       INTEGER NOT NULL REFERENCES bank_imports(id),
  txn_date        DATE NOT NULL,
  amount          BIGINT NOT NULL,    -- 출금 음수(-), 입금 양수(+)
  description     TEXT NOT NULL,      -- 거래내역 원문
  counterpart     TEXT,               -- 거래처/입금처
  balance_after   BIGINT,
  txn_type        TEXT NOT NULL,      -- 'debit'|'credit'
  ai_account_code TEXT,
  ai_budget_id    INTEGER,
  ai_confidence   REAL,              -- 0.0~1.0
  ai_reasoning    TEXT,
  status          TEXT DEFAULT 'pending',
                  -- 'pending'|'confirmed'|'voucher_created'|'ignored'
  admin_account_code TEXT,
  admin_budget_id INTEGER,
  voucher_id      INTEGER REFERENCES vouchers(id),
  confirmed_by    TEXT REFERENCES members(uid),
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## §3 REST API (R1)

| 엔드포인트 | 메서드 | 기능 | 권한 |
|---|---|---|---|
| `/api/admin-account-codes-list` | GET | 계정과목 목록 | admin |
| `/api/admin-vouchers-list` | GET | 전표 목록 (기간·계정·예산·status 필터) | admin |
| `/api/admin-voucher-detail` | GET | 전표 단건 | admin |
| `/api/admin-voucher-create` | POST | 전표 생성 (또는 템플릿) | admin |
| `/api/admin-voucher-update` | PUT | 전표 수정 (draft만) | admin |
| `/api/admin-voucher-submit` | POST | 제출 (draft→submitted) | admin |
| `/api/admin-voucher-approve` | POST | 승인 (submitted→approved) | super_admin |
| `/api/admin-voucher-reject` | POST | 반려 + 사유 | super_admin |
| `/api/admin-voucher-delete` | DELETE | 삭제 (draft만) | admin |
| `/api/admin-voucher-templates-list` | GET | 반복 템플릿 목록 | admin |

### 전표 번호 자동 생성 규칙

`YYYYMM-NNN` — 예: `202505-001`
- 같은 회계연월 내 순번 증가 (max + 1)
- 서버에서 트랜잭션 내 생성 (중복 방지)

---

## §4 UI (R1 — A 담당)

### 4.1 지출 관리 패널에 탭 추가

```
지출 관리 패널
├─ [지출 목록] 탭   ← 기존 (22-C)
└─ [전표] 탭        ← 신규 22-D
```

### 4.2 전표 탭 구성

| 영역 | 내용 |
|---|---|
| 상단 | 기간 선택기 (§2-b 공통 컴포넌트) + 계정과목 드롭다운 필터 + 상태 필터 |
| 목록 | 전표번호·날짜·적요·거래처·계정·금액·예산·상태·액션 |
| 신규 버튼 | 전표 작성 모달 (또는 슬라이드 패널) |
| 전표 작성 폼 | 날짜·계정과목(검색+선택)·세목·적요·거래처·금액·증빙종류·증빙파일·예산 |
| 반복 템플릿 | "자주 쓰는 전표로 저장" 체크박스 → 다음에 1클릭 재사용 |
| 증빙 업로드 | R2 이미지 업로드 (admin-expense-create 패턴 재사용) |

### 4.3 전표 상태별 액션

| 상태 | 가능 액션 |
|---|---|
| draft | 수정·제출·삭제 |
| submitted | 승인·반려 (super_admin) |
| approved | 조회만 |
| rejected | 수정 후 재제출 |

---

## §5 AI 도구 (R1 — B 담당)

| 도구 | 기능 | 권한 |
|---|---|---|
| `voucher_list` | 기간·계정·예산·상태별 전표 조회 | admin |
| `voucher_create` | 전표 작성 (dry-run 우선) | admin |
| `voucher_approve` | 전표 승인 (dry-run 우선) | super_admin |
| `account_codes_list` | 계정과목 목록 | admin |

---

## §6 R2 — 통장거래내역 자동화

> R1 완료 후 별도 라운드. 여기서는 개요만.

### 6.1 기능 흐름

```
1. 관리자가 CSV/XLSX 업로드 (통장거래내역)
2. 서버 파싱 (SheetJS — 이미 스택에 있음)
   · 지원 은행: 국민·신한·하나·우리·기타 (컬럼명 자동 감지)
   · 컬럼: 날짜 / 거래내역 / 출금액 / 입금액 / 잔액
3. 업로드 시 "기본 예산 선택" 화면 (전체 적용 또는 개별)
4. 각 거래 행을 Gemini에 전송 → 계정과목·예산·신뢰도 반환
5. 신뢰도 ≥ 0.75: 자동 매칭 (관리자 확인 없이 전표 생성 후 통보)
   신뢰도 < 0.75: '검토 필요' 상태 → 관리자 알림 + 확인 UI
6. 관리자 확인 화면: 거래내역 원문 + AI 추천 계정/예산 + 드롭다운 수정 + "전표 생성" 버튼
7. 일괄 확인 완료 → 전표 일괄 생성 (bank_transactions.voucher_id 연결)
```

### 6.2 추가 포함 (R2)

- **거래처 마스터**: 자주 나오는 거래처 등록 → 다음 업로드 시 자동 매칭
- **증빙 OCR**: 영수증 사진 첨부 시 Gemini Vision → 금액/날짜/가맹점 자동 추출
- **예산 잠금(Encumbrance)**: 전표 제출 시 해당 예산 가용액 잠금 (집행 전 과지출 방지)
- **AI 이상 감지**: 같은 거래내역 중복 업로드 감지

---

## §7 R3 — AI 부가기능 고도화

- **월말 결산 보조**: 미결 전표(draft/submitted) 자동 감지 + 마감 가이드 알림
- **월별 지출 이상 패턴**: 전월 대비 계정과목별 급증 감지 → cron 알림
- **전표 인쇄**: window.print + NPO 표준 전표 양식 CSS (기존 보고서 인쇄 패턴)
- **반복 전표 자동 생성**: 템플릿 등록된 항목을 지정 날짜에 cron으로 draft 생성
- **예산 집행률 경고**: 전표 승인 시 예산 80%·100% 도달 이메일 알림

---

## §8 검증 Q&A (C 담당, Q1~Q16)

### R1 전표 기본
- Q1: 전표 탭이 지출 관리 패널 안에 노출
- Q2: 계정과목 드롭다운에 NPO 표준 18개 항목 표시
- Q3: 전표 작성 → 저장 → 목록에 draft 상태로 노출
- Q4: 전표 제출 → submitted 상태 변경 + 승인 담당자에게 이메일 알림
- Q5: super_admin이 승인 → approved 상태 변경
- Q6: 반려 + 사유 입력 → rejected 상태 + 재제출 가능
- Q7: 예산 연결 — budgets 목록에서 선택, 선택된 예산 전표에 표시
- Q8: 증빙 파일 첨부 후 R2 업로드, URL 전표에 저장
- Q9: 반복 템플릿 저장 → 다음 전표 작성 시 1클릭 불러오기
- Q10: 기간 필터 (§2-b) + 계정과목 필터 정상 동작
- Q11: AI 비서 "이번 달 임차료 전표 보여줘" → voucher_list 호출 + 정확 응답
- Q12: AI 비서 "5월 임차료 전표 작성해줘" → voucher_create dry-run + 승인 후 생성

### 회귀
- Q13: 지출 관리 기존 탭(지출 목록) 회귀 0
- Q14: 기간 필터 (§2-b) 22-B-R1 추가분 회귀 0
- Q15: 22-A·22-C 매출·손익계산서 회귀 0
- Q16: 싸이렌 어드민 다른 기능 회귀 0

---

## §9 트리거

### §9.1 B 트리거 (feature/phase22d-r1-back) — 🔧 백엔드 + AI 도구

```
[메인 → B 채팅] Phase 22-D-R1 전표 시스템 — 🔧 백엔드 + AI 도구 (프론트 ❌)

이 작업은 Phase 22-B-R1 완료 후 착수.
베이스: main 최신 (git pull 필수)

[자율주행 정책]
- push와 애매한 로직만 묻고 나머지 자율 진행
- 파일 읽기·수정·git·PowerShell·npm은 묻지 말 것

[진행률 보고 의무]
- 형식: "📊 진행률 X% (N/M 완료) — 다음: ..."

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22d-r1-back
베이스: main 최신 (반드시 git pull 후)

설계서: docs/milestones/2026-05-15-phase22d-r1-voucher-bank-import.md §2~§5

■ 1단계 — 마이그레이션 함수 작성
- [ ] netlify/functions/migrate-phase22d-voucher-schema.ts
  · 진단 모드: account_codes/vouchers/bank_imports/bank_transactions 존재 여부
  · 실행 모드(?run=1): 테이블 생성 + account_codes NPO 표준 18개 seed
  · 멱등성 (IF NOT EXISTS, 중복 INSERT 방지)
  · 완료 후 메인에 마이그 호출 요청

■ 2단계 — REST API 9개 (설계서 §3)
- [ ] admin-account-codes-list.ts
- [ ] admin-vouchers-list.ts (기간·계정·예산·status 필터 + 기간 §2-b 패턴 그대로)
- [ ] admin-voucher-detail.ts
- [ ] admin-voucher-create.ts (voucher_number 자동 생성: YYYYMM-NNN)
- [ ] admin-voucher-update.ts (draft 상태만 수정 가능)
- [ ] admin-voucher-submit.ts (draft→submitted + 이메일 알림)
- [ ] admin-voucher-approve.ts (submitted→approved, super_admin)
- [ ] admin-voucher-reject.ts (반려 사유 필수)
- [ ] admin-voucher-delete.ts (draft 상태만)
- [ ] admin-voucher-templates-list.ts

■ 3단계 — AI 도구 4개 (lib/ai-agent-tools.ts 추가)
- [ ] account_codes_list: 계정과목 목록
- [ ] voucher_list: 전표 목록 (기간·계정·예산·status 파라미터)
- [ ] voucher_create: 전표 생성 (dry-run 우선 — requireApproval=true)
- [ ] voucher_approve: 전표 승인 (dry-run 우선, super_admin)
- [ ] ai_tool_permissions seed: 4개 도구 권한 등록 (마이그 함수에 포함)
- [ ] ai-agent-config.ts 매핑 테이블에 '전표' → voucher_list 추가

■ 4단계 — 검증
- [ ] npx tsc --noEmit 통과

완료 후:
- git add, commit, git push origin feature/phase22d-r1-back
- PROJECT_STATE·docs·public 수정 금지
- 완료 메시지: "[B → 메인] feature/phase22d-r1-back push 완료. 마이그 호출 요청."
```

### §9.2 A 트리거 (feature/phase22d-r1-front) — 🎨 프론트엔드 전용

```
[메인 → A 채팅] Phase 22-D-R1 전표 탭 UI — 🎨 프론트엔드 (백엔드·AI 도구 ❌)

이 작업은 Phase 22-B-R1 완료 후 착수 (지출 관리 패널이 cms-tbfa.html로 이전된 상태).
베이스: main 최신 (22-B-R1 머지 완료 후 git pull)

[자율주행 정책][진행률 보고 의무] (표준대로)

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22d-r1-front

설계서: docs/milestones/2026-05-15-phase22d-r1-voucher-bank-import.md §4

■ 작업 — 지출 관리 패널에 "전표" 탭 추가

[ ] admin-expenses.js (또는 이전된 지출 관리 JS)에 탭 전환 로직 추가
    · "지출 목록" 탭 (기존) + "전표" 탭 (신규) — 탭 버튼 + 컨텐츠 영역 분리
[ ] 전표 목록 렌더링
    · 컬럼: 전표번호·날짜·적요·거래처·계정과목·금액·예산·상태·액션
    · 기간 선택기 (§2-b 공통 컴포넌트 재사용) + 계정과목 필터 드롭다운 + 상태 필터
[ ] 전표 작성 모달 (또는 슬라이드 패널)
    · 날짜 / 계정과목(검색+선택 드롭다운, /api/admin-account-codes-list) /
      세목(자유 입력) / 적요 / 거래처 / 금액 /
      증빙종류(세금계산서·영수증·카드전표·이체확인서·무증빙) /
      증빙파일(R2 업로드, admin-expense-create.js 패턴 재사용) /
      예산(budgets 목록 드롭다운)
    · "자주 쓰는 전표로 저장" 체크박스 → template_name 입력
[ ] 전표 상태별 액션 버튼
    · draft: 수정·제출·삭제
    · submitted: 승인·반려 (super_admin 역할만 노출)
    · rejected: 수정 후 재제출
[ ] 반복 템플릿 불러오기
    · 전표 작성 모달 상단에 "템플릿에서 불러오기" 드롭다운
    · 선택 시 폼 자동 채우기
[ ] 캐시버스터 ?v=20260515p22d

완료 후:
- git add, commit, git push origin feature/phase22d-r1-front
- PROJECT_STATE·docs·netlify/functions·lib·db 수정 금지
- 완료 메시지: "[A → 메인] feature/phase22d-r1-front push 완료."
```

### §9.3 C 트리거 — 🔍 검증 전용

```
[메인 → C 채팅] Phase 22-D-R1 검증 — 🔍 전표 시스템

베이스: main (B·A 머지 완료 후)
설계서 §8 Q1~Q16

검증 URL: https://tbfa.co.kr/cms-tbfa.html (통합 CMS)

Q1~Q12 전표 기능 / Q13~Q16 회귀

BUG 발견 시 fix/phase22d-r1-bugs 브랜치 자체 fix.
완료 메시지: "[C → 메인] 22-D-R1 검증 완료. PASS X / FAIL Y. BUG N건."
```

---

## §10 라운드 마감 체크리스트 (R1)

- [ ] B: 마이그 함수 push → 메인 머지 → Swain 마이그 호출 → 파일 삭제
- [ ] A: 전표 탭 UI push → 메인 머지
- [ ] C: 검증 Q1~Q16
- [ ] PROJECT_STATE §2 + §5 갱신
- [ ] HANDOFF.md 갱신

---

## §11 리스크·주의

- **22-B-R1 완료 전 착수 금지**: 지출 관리 패널 이전이 완료된 후 UI 작업 시작. DB·API는 병렬 가능
- **전표번호 중복**: YYYYMM-NNN 생성 시 트랜잭션 내 MAX+1 패턴 (race condition 방지)
- **예산 FK 일치**: `budgets.id`가 `vouchers.budget_id` 참조 — 마이그 전 budgets 테이블 존재 확인
- **계정과목 seed 멱등성**: 같은 code INSERT 시 SKIP (ON CONFLICT DO NOTHING)
- **이메일 알림**: 승인 요청 이메일 실패해도 전표 제출은 성공 (fire-and-forget 패턴)
- **§18.13 enum 동기화**: status enum (draft|submitted|approved|rejected) 3곳 동기화

---

## §12 작업 시간 추정

| 채팅 | 작업 | 시간 |
|---|---|---|
| B | 마이그 + API 9개 + AI 도구 4개 | 6~8h |
| A | 전표 탭 UI + 작성 폼 + 템플릿 | 6~8h |
| C | 검증 Q1~Q16 + fix | 2~3h |
| **합계 (병렬)** | | **8~11h** |

---

## §13 후속 라운드 예고

- **22-D-R2**: 통장거래내역 CSV/XLSX 업로드 + AI 자동 분류 + 관리자 확인 플로우 + 거래처 마스터 + 증빙 OCR
- **22-D-R3**: 월말 결산 보조 + 이상 패턴 감지 + 전표 인쇄 + 반복 전표 자동 cron
- **22-B-R2**: 차년도 예산 편성 + 2단계 결재 (22-D-R1과 병렬 가능)
