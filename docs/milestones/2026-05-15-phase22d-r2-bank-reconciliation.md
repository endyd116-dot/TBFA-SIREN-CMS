# Phase 22-D-R2 — 통장거래내역 자동화 + 입출금 대사

> 작성: 2026-05-15 메인
> 상위: Phase 22-D (전표·통장 자동화 — R1 전표 시스템 ✅ / **R2 통장 자동화** / R3 결산·이상패턴·예산잠금)
> 전제: **22-D-R1 완료** (`bank_imports`·`bank_transactions`·`vouchers`·`account_codes` 테이블 존재) + 22-A `donations`·`other_revenues` + 22-B-R2 `budget_lines`

---

## §-1 채팅 역할 분담 — A·B·C 구조

| 채팅 | 모델 | 워크트리 | 브랜치 | 담당 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | main | 스키마 확정·머지·마이그·문서 |
| A | Sonnet 4.6 (작업량 많으면 Opus) | tbfa-mis-A | feature/phase22d-r2-front | 🎨 통장 업로드·거래 목록·관리자 확인·거래처 마스터 화면 |
| B | Opus 4.7 | tbfa-mis-B | feature/phase22d-r2-back | 🔧 파싱·대사 엔진 + API + counterparties 테이블 + 마이그 |
| C | Opus 4.7 | tbfa-mis-C | (검증→자체fix) | 🔍 검증 Q1~Q15 |

단독 라운드. 규모 큼 — B의 대사 엔진·파싱이 핵심 난이도.

---

## §0 요구사항 (Swain 결정 2026-05-15, 10개)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 지원 은행 | **IBK기업은행만** — 협회 주거래 통장(988-025731-04-018). 파서 1개 |
| 2 | 입금 매핑 | **통장을 대사(reconciliation) 기준으로** — 통장 입금이 진실, `donations` 기록을 통장에 맞춰 검증 |
| 3 | 묶음 정산 | **합계로 대사** — 토스·효성 정산 입금 1건 = 기간 후원 합계와 대조 (개별 분해 X) |
| 4 | 출금 매핑 | **전표 자동 생성 + AI 분류** — 출금 → AI 계정과목 추정 → `vouchers` draft 자동 생성 |
| 5 | 계좌 직접후원 | **관리자 확인 후 `donations` 신규 등록** — 입금자명↔회원 매칭 시도해 후보 제시 |
| 6 | 미매칭 거래 | **성격별 자동 분기** — 입금→`other_revenues` 후보 / 출금→`voucher` draft / 내부이체→무시 |
| 7 | 신뢰도 임계값 | **75% 기본 + 관리자 조정 가능** — 설정 화면에서 조정 |
| 8 | 거래처 마스터 | **`counterparties` 테이블 신규 + 자동 학습** — 한 번 분류하면 다음부터 자동 매핑 |
| 9 | 예산 잠금 | **22-D-R3로 미룸** — R2 범위가 이미 큼 |
| 10 | 스키마 | **기존 `bank_transactions` 확장** — 입금 매핑 컬럼 추가, 입출금 한 테이블 통합 |

---

## §1 통장 엑셀 파싱 (IBK 전용) — 클라이언트 1차 변환 + 서버 정규화

> **2026-05-15 정정**: 당초 "SheetJS 서버 파싱"으로 썼으나, CLAUDE.md §2 표준이
> "SheetJS 클라이언트 변환"이고 서버에 `xlsx` 미설치. **클라이언트 파싱으로 변경.**
>
> - **A (클라이언트)**: SheetJS CDN으로 엑셀 → JSON 1차 변환. 헤더 행 자동 탐지 +
>   §1.1 12컬럼 추출 + 메타데이터 추출 + 합계행 제외 → 정규화된 거래 배열 JSON
> - **B (서버)**: `admin-bank-import`가 **JSON 거래 배열**을 받음(FormData multipart ❌).
>   금액 정규화 검증 + `dedup_hash` 생성 + DB 적재 + 대사 엔진. 신규 패키지 0개.

### 1.1 IBK 입출식 예금 거래내역조회 — 컬럼 구조

| 엑셀 컬럼 | → 매핑 |
|---|---|
| 거래일시 (`2026-05-07 18:44:45`) | `txn_date` (날짜+시각, KST) |
| 출금 (콤마 숫자) | `amount` 음수 (`-137225`) |
| 입금 (콤마 숫자) | `amount` 양수 |
| 거래후 잔액 | `balance_after` |
| 거래내용 (`청소관리비`·`CMS사용료`·`GS25강서화곡점`) | `description` — **분류 핵심 단서** |
| 상대계좌번호 | `counterpart_account` |
| 상대은행 (`카카오뱅크`) | `counterpart_bank` |
| 메모 | `memo` |
| 거래구분 (`기업스마트뱅킹`·`체크`·`펌이체`) | `txn_method` |
| 수표어음금액 | (보통 0 — 저장만) |
| CMS코드 | `cms_code` |
| 상대계좌예금주명 (`효성에프엠에스(주)`·`허민우(비치움 청년)`) | `counterpart_name` — **거래처 매칭 핵심 단서** |

### 1.2 파싱 주의사항

| 항목 | 담당 | 내용 |
|---|---|---|
| 헤더 행 자동 탐지 | A (클라이언트) | 메타데이터가 상단에 흩어져 있고 헤더가 중간 → "거래일시" 헤더 셀 찾아 그 행부터 |
| 메타데이터 추출 | A → B | 계좌번호·예금주명·조회시작/종료일자 → JSON에 담아 전송 → B가 `bank_imports` 저장 |
| 합계 행 제외 | A (클라이언트) | 마지막 "합계" 행 스킵 |
| 금액 정규화 | A 1차 + B 검증 | 콤마 제거, 출금→음수 / 입금→양수로 `amount` 단일 값. B가 재검증 |
| 중복 방지 | **B (서버)** | `거래일시 + amount + balance_after` 조합 `dedup_hash` 서버 생성 (무결성) |
| 포맷 | A (클라이언트) | `.xlsx` 우선 (SheetJS CDN), `.csv`도 허용 |

- A는 SheetJS CDN(이미 프로젝트에서 쓰는 0.18.5)으로 엑셀→JSON 변환만. 정규화 거래 배열을 `admin-bank-import`에 POST(application/json)
- B는 JSON 배열 수신 → `dedup_hash` 생성·중복 차단·금액 검증 → DB 적재

---

## §2 DB 스키마

### 2.1 bank_transactions 확장 (22-D-R1 테이블에 컬럼 추가)

```sql
-- 22-D-R1 기존 컬럼 유지. 아래 추가:
ALTER TABLE bank_transactions ADD COLUMN counterpart_account VARCHAR(50);  -- 상대계좌번호
ALTER TABLE bank_transactions ADD COLUMN counterpart_bank   VARCHAR(50);   -- 상대은행
ALTER TABLE bank_transactions ADD COLUMN counterpart_name   VARCHAR(200);  -- 상대계좌예금주명
ALTER TABLE bank_transactions ADD COLUMN txn_method         VARCHAR(50);   -- 거래구분
ALTER TABLE bank_transactions ADD COLUMN memo               TEXT;
ALTER TABLE bank_transactions ADD COLUMN cms_code           VARCHAR(50);
ALTER TABLE bank_transactions ADD COLUMN counterparty_id    INTEGER;       -- → counterparties.id
ALTER TABLE bank_transactions ADD COLUMN donation_id        INTEGER;       -- 입금 매칭: → donations.id
ALTER TABLE bank_transactions ADD COLUMN other_revenue_id   INTEGER;       -- 입금 매칭: → other_revenues.id
ALTER TABLE bank_transactions ADD COLUMN match_type         VARCHAR(30);
  -- 'donation' | 'donation_batch'(묶음정산) | 'voucher' | 'revenue' | 'ignored' | 'pending'
ALTER TABLE bank_transactions ADD COLUMN dedup_hash         VARCHAR(64);   -- 중복 방지 해시
```

> `voucher_id`·`ai_account_code`·`ai_confidence`·`status` 등은 22-D-R1에 이미 존재 — 재사용.
> B는 schema.ts의 22-D-R1 `bankTransactions` 정의에 위 컬럼 append (마이그 적용 후 활성화).

### 2.2 counterparties 거래처 마스터 (신규)

```sql
CREATE TABLE counterparties (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,        -- 거래처명·예금주명
  account_no          VARCHAR(50),                  -- 상대계좌번호
  bank_name           VARCHAR(50),                  -- 상대은행
  default_match_type  VARCHAR(30),                  -- 'voucher'|'revenue'|'donation'
  default_account_code VARCHAR(20),                 -- 자동 매핑 계정과목 (→ account_codes.code)
  default_budget_line_id INTEGER,                   -- 자동 매핑 예산 항목 (선택)
  txn_count           INTEGER DEFAULT 0,            -- 학습 횟수 (등장 빈도)
  note                TEXT,
  learned_by          INTEGER,                      -- members.id (최초 분류한 관리자)
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_no, name)
);
```

### 2.3 거래처 자동 학습 흐름

```
통장 거래 파싱 → counterpart_account·counterpart_name으로 counterparties 조회
  ├─ 거래처 마스터에 있음 → default_match_type·default_account_code 자동 적용 (학습된 룰)
  └─ 없음 → AI 분류 + 관리자 확인 → 관리자가 확정하면 counterparties에 신규 등록
            (다음부터 같은 거래처는 자동) + txn_count++
```

---

## §3 대사 엔진 (B 핵심 — 설계서 가장 중요한 부분)

### 3.1 입금 대사 (→ donations / other_revenues)

```
입금 거래 1건
  ↓
① 묶음 정산 감지 — counterpart_name·description에 "토스페이먼츠"·"효성"·정산 키워드
  → match_type='donation_batch' / 해당 기간 donations(토스·효성) 합계와 대조
  → 합계 일치 → '정산 확인' / 불일치 → 관리자 알림
  ↓ (묶음 아니면)
② 개별 매칭 — donations에서 [금액 일치 + txn_date ±3일 + 입금자명·적요 유사] 검색
  → 매칭 성공(신뢰도 ≥75%) → match_type='donation', donation_id 연결,
     donations에 '통장 입금 확인' 표시(입금일·bank_transaction 연결)
  → 매칭 실패 → ③
  ↓
③ 미매칭 입금 — counterparties 조회
  → 거래처가 'donation' 타입 → 후원 후보로 (계좌 직접후원 가능성)
     · 입금자명 ↔ members 명단 매칭 시도 → 회원 후보 제시
     · 관리자 확인 → donations 신규 등록 (match_type='donation')
  → 거래처가 'revenue' 타입 or 미등록 → other_revenues 후보 (강연료·기업협찬 등)
     · 관리자 확인 → other_revenues 신규 등록 (match_type='revenue')
  → 관리자가 '무시' 가능 (내부 이체 등, match_type='ignored')
```

### 3.2 출금 대사 (→ vouchers)

```
출금 거래 1건
  ↓
① counterparties 조회 (counterpart_account·counterpart_name)
  → 학습된 거래처 → default_account_code 자동 적용
  ↓ (미등록 거래처면)
② AI 분류 — description·counterpart_name → 계정과목 추정 + 신뢰도
  · 거래내용 키워드 룰 우선: "청소관리비"→admin_ops, "CMS사용료"→수수료, "GS25"→소모품
  · 룰 미적중 → Gemini로 계정과목 추정
  ↓
③ 신뢰도 분기 (임계값 75%, 설정 조정 가능)
  → ≥75% → vouchers draft 자동 생성, match_type='voucher', voucher_id 연결, status='confirmed'
  → <75% → status='pending', 관리자 확인 대기
  ↓
④ 관리자 확인 → 계정과목·예산 확정 → voucher 생성 + counterparties에 거래처 학습 등록
```

### 3.3 신뢰도·설정

- 임계값 기본 75%, `ai_feature_settings` 또는 별도 설정으로 관리자 조정
- 거래처 마스터 매칭은 신뢰도 100% 취급 (이미 사람이 분류한 룰)

---

## §4 REST API

| 엔드포인트 | 메서드 | 기능 | 권한 |
|---|---|---|---|
| `/api/admin-bank-import` | POST | **JSON 거래 배열 수신**(A가 클라이언트 파싱) + dedup_hash·검증 + bank_imports·bank_transactions 적재 | admin |
| `/api/admin-bank-import-list` | GET | 업로드 이력 | admin |
| `/api/admin-bank-reconcile` | POST | 대사 엔진 실행 (입금 대사 + 출금 전표생성) | admin |
| `/api/admin-bank-transactions-list` | GET | 거래 목록 (입금/출금·매칭상태·기간 필터) | admin |
| `/api/admin-bank-transaction-confirm` | POST | 관리자 확인 — 후원/매출/전표/무시 확정 | admin |
| `/api/admin-bank-transaction-match` | POST | 수동 매칭 (특정 donations·voucher에 연결) | admin |
| `/api/admin-bank-reconcile-summary` | GET | 대사 현황 요약 (입금 N매칭/M미확인, 출금 ...) | admin |
| `/api/admin-counterparties-list` | GET | 거래처 마스터 목록 | admin |
| `/api/admin-counterparty-update` | PUT | 거래처 분류 룰 수정 | admin |

- 업로드·대사는 거래 건수 많을 수 있음 → 배치성. 단 IBK 통장 월 수십~수백 건 수준이라 동기 처리로 충분 (백그라운드 함수 불필요할 듯, B 판단)
- §6.2 단계별 try/catch + step·detail·stack 응답 표준 준수

---

## §5 UI (A 담당 — cms-tbfa.html 재정 그룹)

22-B-R1에서 이전된 재정 그룹에 **"통장 거래내역"** 메뉴 신규 추가.

### 5.1 화면 구성

| 영역 | 내용 |
|---|---|
| 업로드 | 엑셀 드래그&드롭 + 업로드 이력 |
| 대사 요약 | 입금 N건(매칭 X / 미확인 Y) / 출금 N건(전표생성 X / 확인대기 Y) / 묶음정산 Z건 |
| 거래 목록 | 거래일시·구분(입/출)·금액·거래내용·거래처·매칭상태 배지·액션 / 기간 선택기(§2-b 재사용) |
| 관리자 확인 | 미매칭 입금 → [후원 등록 / 매출 등록 / 무시] / 미매칭 출금 → [전표 확정 / 무시] |
| 거래처 마스터 | counterparties 목록 + 분류 룰 수정 |

### 5.2 매칭 상태 배지

`정산확인`(donation_batch) / `후원매칭`(donation) / `전표생성`(voucher) / `매출`(revenue) / `확인필요`(pending) / `무시`(ignored)

- 캐시버스터 `?v=20260515p22dr2`
- cms-tbfa.html은 재정 그룹 사이드바 + `page-bank-transactions` 섹션만 추가

---

## §6 AI 도구 (B 담당 — 최소)

통장 자동화는 배치성이라 AI 도구 우선순위 낮음. **신규 1개만**:
- `bank_reconcile_summary` — "이번 달 통장 대사 현황 알려줘" → 대사 요약 조회 (admin)
- §갱신 의무 5곳 준수 (ai-agent-tools·ai-agent-config·ai-cache·admin-ai-agent TOOL_GROUPS·ai_tool_permissions 시드)

---

## §7 검증 Q&A (C 담당, Q1~Q15)

### 파싱·업로드
- Q1: IBK 엑셀 업로드 → 헤더 자동 탐지 + 12컬럼 정상 파싱 + 메타데이터 추출
- Q2: 합계 행 제외 + 출금 음수/입금 양수 정규화
- Q3: 같은 파일 재업로드 → dedup_hash로 중복 차단

### 입금 대사
- Q4: 묶음 정산 입금(토스·효성) → 기간 후원 합계와 대조, 일치 시 '정산확인'
- Q5: 개별 입금 → donations 금액+날짜±3일+입금자명 매칭, 성공 시 donations에 '입금확인' 표시
- Q6: 계좌 직접후원(donations에 없는 입금) → 미매칭으로 뜨고, 입금자명↔회원 후보 제시 → 관리자 확인 시 donations 신규 등록
- Q7: 매칭 안 되는 입금 → other_revenues 후보로 분기

### 출금 대사
- Q8: 출금 → 거래처 마스터 매칭 시 학습 계정과목 자동 적용
- Q9: 미등록 거래처 출금 → AI 계정과목 추정, 신뢰도 ≥75% 시 voucher draft 자동 생성
- Q10: 신뢰도 <75% → 관리자 확인 대기, 확인 시 voucher 생성 + 거래처 학습 등록
- Q11: 거래내용 키워드 룰("청소관리비"→admin_ops 등) 적중 확인

### 거래처·설정·회귀
- Q12: 거래처 마스터 — 한 번 분류 후 같은 상대계좌·예금주명 재등장 시 자동 매핑
- Q13: 신뢰도 임계값 설정 화면에서 조정 가능
- Q14: 대사 요약 정확 (입금 매칭/미확인, 출금 전표생성/대기 카운트)
- Q15: 22-A·22-C·22-B·22-D-R1 회귀 0 (후원·지출·예산·전표·기간 필터)

---

## §8 트리거

### §8.1 B 트리거 (feature/phase22d-r2-back) — 🔧 백엔드

```
[메인 → B 채팅] Phase 22-D-R2 통장거래내역 자동화 — 🔧 백엔드 (프론트 ❌)

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" 류 권한 질문 금지 — 바로 실행.
- 묻는 건 단 2가지: ① git push ② 애매한 설계·로직 결정
- ★ PROJECT_STATE·docs·public 수정 금지 (지난 라운드 위반 있었음 — 엄수)
- ★ 베이스는 반드시 git pull 후 main 최신 (옛 베이스 분기 금지)

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22d-r2-back

설계서: docs/milestones/2026-05-15-phase22d-r2-bank-reconciliation.md

■ 1단계 — 마이그레이션 + schema (설계서 §2)
- [ ] migrate-phase22d-r2-bank-reconcile.ts
  · bank_transactions 컬럼 11개 추가 (§2.1)
  · counterparties 테이블 생성 (§2.2)
  · ai_tool_permissions에 bank_reconcile_summary 시드
  · 멱등성 (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS)
- [ ] db/schema.ts: bankTransactions 정의에 컬럼 append + counterparties 신규
  · /* === Phase 22-D-R2 === */ 헤더, 마이그 적용 후 활성화
- [ ] 메인에 마이그 호출 요청

■ 2단계 — 수신·검증·적재 (설계서 §1 — 클라이언트 파싱으로 변경됨)
- [ ] admin-bank-import: A가 클라이언트 SheetJS로 파싱한 **JSON 거래 배열** 수신
  (FormData multipart 아님 — application/json)
  · dedup_hash 서버 생성(거래일시+amount+balance_after) + 중복 차단
  · 금액 정규화 재검증 + 메타데이터 → bank_imports 저장 + bank_transactions 적재
  · ★ 서버에 xlsx 패키지 설치 금지 — CLAUDE.md §2 표준(SheetJS 클라이언트)

■ 3단계 — 대사 엔진 (설계서 §3 — 핵심)
- [ ] 입금 대사: 묶음정산 감지 → 개별 매칭(donations) → 미매칭 분기(donation/revenue 후보)
- [ ] 출금 대사: 거래처 마스터 → AI 분류 → 신뢰도 75% 분기 → voucher draft 생성
- [ ] 거래처 자동 학습 (counterparties 등록·txn_count)
- [ ] 거래내용 키워드 룰

■ 4단계 — REST API 9개 (설계서 §4)
- [ ] admin-bank-import / -import-list / -reconcile / -transactions-list
- [ ] admin-bank-transaction-confirm / -match / -reconcile-summary
- [ ] admin-counterparties-list / admin-counterparty-update

■ 5단계 — AI 도구 (설계서 §6)
- [ ] bank_reconcile_summary — 갱신 의무 5곳 전부 (ai-agent-tools·config·cache·
      admin-ai-agent TOOL_GROUPS·ai_tool_permissions 시드)

■ 6단계 — 검증
- [ ] npx tsc --noEmit — 신규 에러 0건 (기존 묵은 에러 14건과 구분)

완료 후:
- git add, commit, git push origin feature/phase22d-r2-back
- 완료 메시지: "[B → 메인] feature/phase22d-r2-back push 완료. 머지 + 마이그 호출 요청."
```

### §8.2 A 트리거 (feature/phase22d-r2-front) — 🎨 프론트엔드

```
[메인 → A 채팅] Phase 22-D-R2 통장거래내역 자동화 — 🎨 프론트엔드 (백엔드 ❌)

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git checkout/add/commit/rebase/merge·
  npm install·npm run은 .claude/settings.json에 이미 전부 허용됨.
  "접속해도 되나요" 류 권한 질문 금지 — 바로 실행.
- 묻는 건 단 2가지: ① git push ② 애매한 설계·로직 결정
- ★ 베이스는 반드시 git pull 후 main 최신 (옛 베이스 분기 금지 — 지난 라운드 사고 있었음)

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료) — 다음: ..." 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/phase22d-r2-front

설계서: docs/milestones/2026-05-15-phase22d-r2-bank-reconciliation.md §1·§5

■ 작업 — cms-tbfa.html 재정 그룹에 "통장 거래내역" 화면 신규

[ ] cms-tbfa.html "💰 후원·재정 관리" 그룹에 "통장 거래내역" 메뉴 + page-bank-transactions 섹션
[ ] cms-tbfa.js 탭 라우팅 케이스 추가
[ ] 신규 JS (admin-bank-transactions.js): window.SIREN_* 패턴, page-* ID 폴백
[ ] 업로드 화면 — 엑셀 드래그&드롭 → **SheetJS CDN으로 클라이언트 파싱**
    (헤더 자동 탐지 + §1.1 12컬럼 추출 + 메타데이터 + 합계행 제외 → 정규화 JSON 배열)
    → /api/admin-bank-import에 application/json POST + 업로드 이력
[ ] 대사 요약 — 입금 매칭/미확인, 출금 전표생성/대기, 묶음정산 카운트
[ ] 거래 목록 — 거래일시·입출구분·금액·거래내용·거래처·매칭상태 배지
      · 기간 선택기 (22-B-R1 §2-b 공통 컴포넌트 재사용)
      · 매칭 상태 배지 6종 (정산확인·후원매칭·전표생성·매출·확인필요·무시)
[ ] 관리자 확인 모달
      · 미매칭 입금 → [후원 등록(회원 후보 표시) / 매출 등록 / 무시]
      · 미매칭 출금 → [전표 확정 / 무시]
[ ] 거래처 마스터 관리 — counterparties 목록 + 분류 룰 수정
[ ] 캐시버스터 ?v=20260515p22dr2

■ 주의
- 데이터 API는 B가 작성 — A는 호출·렌더만. 응답 키 다중 fallback
- cms-tbfa.html은 재정 그룹 사이드바 + page-bank-transactions 섹션 내부만
- ★ 엑셀 파싱은 A 클라이언트 담당 (SheetJS CDN 0.18.5, 프로젝트 기존 사용분).
  admin-bank-import는 FormData 아닌 application/json (정규화 거래 배열) 전송
- §1.1 12컬럼 매핑·헤더 탐지·합계행 제외는 A 클라이언트 파서가 구현

완료 후:
- git add, commit, git push origin feature/phase22d-r2-front
- PROJECT_STATE·docs·netlify/functions·lib·db 수정 금지
- 완료 메시지: "[A → 메인] feature/phase22d-r2-front push 완료."
```

### §8.3 C 트리거 — 🔍 검증

```
[메인 → C 채팅] Phase 22-D-R2 통장거래내역 자동화 검증 — 🔍

베이스: main (B·A 머지 + 마이그 호출 완료 후)
설계서 §7 Q1~Q15

[자율주행 정책][진행률 보고] (표준 — 권한 질문 금지, 바로 실행)

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-C
  git fetch origin && git checkout main && git pull origin main

검증 URL: https://tbfa.co.kr/cms-tbfa.html

Q1~Q3 파싱·업로드 / Q4~Q7 입금 대사 / Q8~Q11 출금 대사 /
Q12~Q15 거래처·설정·회귀

BUG 발견 시 fix/phase22d-r2-bugs 브랜치 자체 fix.
완료 메시지: "[C → 메인] 22-D-R2 검증 완료. PASS X / FAIL Y. BUG N건."
```

---

## §9 리스크·주의

- **대사 엔진이 핵심 난이도**: 입금 매칭(묶음/개별/미매칭 3갈래) + 출금 분류(거래처/AI/신뢰도) — B 작업 시간 대부분 여기
- **묶음 정산 감지 정확도**: "토스페이먼츠"·"효성" 키워드 의존 — 실제 통장 적요 표기 확인 필요. 키워드 빗나가면 개별 매칭으로 빠져 오류
- **donations 매칭 오인**: 같은 금액·같은 날 후원이 여럿이면 오매칭 위험 → 신뢰도 낮추고 관리자 확인으로
- **bank_transactions 확장**: 22-D-R1 테이블에 컬럼 추가 — 기존 22-D-R1 전표 연동 코드 회귀 점검
- **counterparties UNIQUE(account_no, name)**: 계좌번호 없는 거래(CMS사용료 등)도 있음 → account_no NULL 허용, name만으로도 매칭
- **AI 도구 갱신 5곳**: bank_reconcile_summary 추가 시 admin-ai-agent.ts TOOL_GROUPS 누락 금지 (3라운드 연속 사고)
- **예산 잠금은 R3**: R2에서 voucher 생성 시 budget_line_id 연결만, 가용액 차감은 안 함

---

## §10 작업 시간 추정

| 채팅 | 작업 | 시간 |
|---|---|---|
| B | 마이그 + 파싱 + 대사 엔진 + API 9개 + AI 도구 | 10~14h |
| A | 업로드·목록·관리자 확인·거래처 마스터 화면 | 7~10h |
| C | 검증 Q1~Q15 | 3~4h |
| **합계 (병렬)** | | **10~14h** |

---

## §11 후속 — 22-D-R3

- **예산 잠금(Encumbrance)**: 전표 제출 시 budget_line 가용액 차감 (R2에서 미룸)
- 월말 결산 보조 / 이상 지출 패턴 감지 / 전표 인쇄 / 반복 전표 cron
- 재정상태표·현금흐름표: 통장 잔액 데이터 확보됐으니 22-B 회계 보고서 확장으로 가능
