# Phase 3 설계 — 마일스톤 #16 단계 D (효성 SOT 정합성 + CSV 종합 검증 강화)

> **작성**: 2026-05-10 / 메인 채팅
> **전제**: [PHASE_PROPOSAL.md](PHASE_PROPOSAL.md) 시나리오 B 채택, [Phase 2 ✅ 완료](DESIGN_PHASE2.md) (tag `phase2-complete-20260510`)
> **Phase 3 정의**: 마일스톤 #16 단계 D — **효성 CMS+ 양식 SOT 정합성 + 토스 자동 매핑 정밀화 + 종합 검증 대시보드 강화**
> **목표**: 효성 PDF 양식 그대로 SIREN 어드민에서 회원·정기 후원자 관리. 효성→SIREN 일방향 흡수 + SIREN 고유 컬럼 보존. 토스는 SIREN 직속 실시간 자동 매핑. 종합 검증 대시보드로 회원 분포·alert 가시화.
> **본 문서는 설계 합의용**. 채택 후 본 문서를 참조해 코드 작업 시작.

---

## 1. 작업 목록 (마일스톤 §4 단계 D)

| ID | 항목 | 영역 | 비고 |
|---|---|---|---|
| **M1** | (Main) 효성 양식 매핑 라이브러리 신규 — 22+28컬럼 → schema 컬럼 변환 | 백엔드 lib | `lib/hyosung-mapper.ts` |
| **M2** | (Main) 효성 흡수 정책 라이브러리 — merge 보존 + 신규 회원 자동 생성 | 백엔드 lib | `lib/hyosung-merge.ts` |
| **D1** | 효성 회원관리 CSV/엑셀 파서 신규 (계약정보 양식) | 백엔드 파서 | `hyosungContracts` 적재 + members 매칭/신규 생성 |
| **D2** | 효성 수납내역 CSV/엑셀 파서 신규 | 백엔드 파서 | `lib/hyosung-billings-parser.ts` 신규 + `hyosungBillings` 적재 + donations 적재 |
| **D3** | 통합 일반 회원 화면(Phase 1) 효성 컬럼 보강 | 프론트 | members JOIN hyosungContracts — 회원상태·계약상태·약정일·결제방식·결제수단·결제등록상태·상품·청구시작일 |
| **D4** | 정기 후원자 화면(Phase 2) 효성 컬럼 보강 | 프론트 | members JOIN hyosungContracts — 매월 약정금액·다음 결제일·결제수단·결제등록상태·청구 라이프사이클 |
| **D5** | `cron-donor-status-sync` 정교화 (효성 컬럼 기반 식별 강화) | 백엔드 cron | hyosungContracts.contractStatus 사용 → donor_type 정밀 평가 |
| **D6** | 토스 빌링 자동 매핑 정밀화 (Phase 2 후크 확장) | 백엔드 후크 | 빌링키 등록 시 SIREN 자체 약정일·약정금액·결제수단 직접 기록 (효성과 동등 SOT) |
| **D7** | 종합 검증 대시보드 강화 | 프론트 + 백엔드 | KPI(정기/잠재/비후원) + alert(미매칭·중복·전이) + 효성 미매칭 회원 처리 안내 |
| **C1** | 캐시버스터 일괄 갱신 | 통합 | `?v=2026-05-10-d1` |
| **V1** | Swain — 효성 CSV/엑셀 업로드 → 매칭·신규 회원 자동 생성·SIREN 고유 컬럼 보존 검증 | 검증 | 어드민 어카운트로 1회 |
| **V2** | Swain — 통합 회원·정기 후원자 화면이 효성 양식과 1:1 표시 검증 | 검증 | 1회 |
| **V3** | Swain — 종합 검증 대시보드 KPI·alert 검증 | 검증 | 1회 |

---

## 2. 영역 분류

### 2.0 모델 분배 (2026-05-10 추가)

| 채팅 | 모델 | 적용 방식 | 역할 |
|---|---|---|---|
| **Main** | Claude Opus 4.7 (1M context) | 메인 폴더 기본값 | M1·M2 라이브러리 작성 + 머지·통합·조율 |
| **A** | Claude Sonnet 4.6 | `../tbfa-mis-A/.claude/settings.local.json` 자동 적용 | D3·D4·D7 프론트 |
| **B** | Claude Sonnet 4.6 | `../tbfa-mis-B/.claude/settings.local.json` 자동 적용 | D1·D2·D5·D6·D7 백엔드 |

A·B는 Sonnet 4.6이라 명세에 충실히 따라가는 워크플로 권장. §5.2 매핑 표·§6 API 계약·§7 mock JSON을 그대로 복사해서 코드화. 모호 시 메인 채팅에 즉시 보고.

### (b') Main 선행 + A·B 후속 — 🟢 채택 추천 (Phase 2 검증된 패턴)

Phase 2와 동일 패턴. **schema 변경 0건이라 schema 게이트 시간 절약** (~0.5h).

| 단계 | 누가 | 작업 |
|---|---|---|
| 1 | **Main** | M1·M2 효성 매핑·merge 라이브러리 골격 → push |
| 2 | (자율) | schema 변경 없음 — 마이그 호출 절차 생략 ✅ |
| 3 | **Main** | A·B 재활성화 통보 (§9.4·§9.5) |
| 4a | **B 채팅** | D1·D2 파서 + D5 cron 정교화 + D6 토스 정밀화 + D7 백엔드 |
| 4b | **A 채팅** | D3·D4 화면 컬럼 보강 + D7 대시보드 프론트 (mock 사용) |
| 5 | **Main** | C1 캐시버스터 + B 머지 → A 머지 → 통합·푸시 |
| 6 | **Swain** | V1·V2·V3 검증 |

**장점**:
- schema 충돌 위험 0 (변경 자체가 0)
- Phase 1·2 검증된 패턴 재사용 (mock·API 합의·동시 작업 → Main 통합)
- 효성 SOT 매핑 정책이 M1·M2에 집중되어 있어 A·B는 라이브러리만 호출하면 됨

### 2.1 대안 (a) Main 단독 — 보류
모든 코드 Main 단독. 시간 ~6h. (b') 채택으로 보류.

### 2.2 대안 (b) B만 활성화 — 보류
효성 파서·매핑 중심이라 B만으로 충분하다는 시각도 있으나, 화면(D3·D4·D7) 비중이 작지 않음. (b') 채택.

---

## 3. 작업 의존성 그래프 (시나리오 b')

```
[1] Main: M1 hyosung-mapper.ts + M2 hyosung-merge.ts 라이브러리 골격 + push
        │
        ▼
[2] schema 변경 없음 → 마이그 호출 단계 생략 ✅
        │
        ▼
[3] Main: A·B 재활성화 통보 (§9.4·§9.5)
        │
   ┌────┴────┐
   ▼         ▼
[4a B 채팅]  [4b A 채팅]
 D1·D2 파서   D3 통합 회원 효성 컬럼 보강
 D5 cron     D4 정기 후원자 효성 컬럼 보강
 D6 토스     D7 검증 대시보드 강화 (mock 사용 가능)
 D7 백엔드
   │         │
   ▼         ▼
[B 머지]    (A는 B 머지 대기)
   │         │
   └────┬────┘
        ▼
[5] A: mock 제거 + 실제 API 교체 → 머지
        │
        ▼
[6] Main: C1 캐시버스터 일괄 + push
        │
        ▼
[7] Swain V1·V2·V3 검증
```

핵심 게이트: **1단계 = Main 라이브러리 골격 합의**. schema 변경 0건이라 호출 게이트 없음.

---

## 4. 파일 소유권 매트릭스

| 경로 | 책임 | 변경 유형 |
|---|---|---|
| `lib/hyosung-mapper.ts` | **Main** | 신규 (효성 양식 컬럼 → schema 컬럼 변환) |
| `lib/hyosung-merge.ts` | **Main** | 신규 (merge 보존 + 신규 회원 자동 생성 정책) |
| `lib/hyosung-parser.ts` | **B** | 기존 — 본 사이클에 맞게 보강 (계약정보 22컬럼 모두 추출). 시그니처 변경 시 호출부 회귀 점검. append-only로 V2 함수 추가 권장 |
| `lib/hyosung-billings-parser.ts` | **B** | 신규 (수납내역 28컬럼 → hyosungBillings + donations) |
| `netlify/functions/admin-donation-import.ts` | **B** | 효성 contracts·billings 분기 + M2 merge·신규 회원 적용 |
| `netlify/functions/cron-donor-status-sync.ts` | **B** | 정교화 (효성 컬럼 기반 식별 강화) |
| `netlify/functions/auth-toss-billing-issued.ts` | **B** | D6 정밀화 — SIREN 자체 약정일·약정금액 직접 기록 |
| `netlify/functions/admin-members.ts` | **B** | hyosungContracts JOIN 추가 |
| `netlify/functions/admin-donor-regular-list.ts` | **B** | hyosungContracts JOIN 추가 |
| `netlify/functions/admin-donation-dashboard.ts` | **B** | 신규 (KPI + alert 종합) |
| `public/cms-tbfa.html` | **A** | 통합 회원·정기 후원자·검증 대시보드 마크업 보강 |
| `public/js/cms-tbfa.js` | **A** | 효성 컬럼 표시 로직 + 검증 대시보드 동작 |
| `public/css/cms-tbfa.css` | **A** | 효성 양식 스타일 추가 (append-only) |
| `db/schema.ts` | ⛔ | **변경 0건** (기존 컬럼만으로 모두 매핑 가능) |
| `lib/auth.ts` / `admin-guard.ts` | ⛔ | 변경 금지 |

**충돌 위험**: A·B 동시 작업 시 — A는 `public/*`, B는 `netlify/functions/*` + `lib/*`. 공유 파일 0, 충돌 위험 0. M1·M2는 Main이 단독으로 미리 완료한 후 B 시작.

---

## 5. DB 변경사항 (★ 효성 SOT 정합성 핵심)

### 5.1 schema 변경 — 🟢 **0건**

효성 PDF 양식 두 종류(계약정보 22컬럼·수납내역 28컬럼)를 schema와 1:1 매핑한 결과:
- 계약정보 → `hyosungContracts` (작업 C #15에서 만든 테이블) — 기존 컬럼만으로 모두 흡수 가능
- 수납내역 → `hyosungBillings` (작업 C #15에서 만든 테이블) — 기존 컬럼만으로 모두 흡수 가능

**모호 컬럼 매핑 처리**:
- 계약정보 "결제방식"(자동결제/미등록) → `paymentTool` 컬럼에 매핑 (registrationStatus와 강하게 연동되므로 raw_data에 보존만 하고 화면 표시는 registrationStatus로 통합)
- 계약정보 "청구자동생성"(자동/수동) → `billingAuto` 컬럼에 매핑
- 수납내역 "결제방식"(자동결제) → `paymentTool` 컬럼에 매핑
- 수납내역 "회원구분"·"담당관리자" → `rawData` JSONB에 보존

→ schema 게이트 없음 → 마이그 호출 절차 생략 → **시간 절약 ~0.5h**

### 5.2 효성 양식 ↔ schema 매핑 표

#### 계약정보 PDF (22컬럼) → hyosungContracts 테이블

| 효성 PDF 컬럼 | schema 컬럼 | 비고 |
|---|---|---|
| 회원번호 | memberNo | unique (정수) |
| 회원명 | memberName | |
| 납부자 휴대전화 | phone | |
| 회원상태 | memberStatus | "사용/중지" |
| 계약상태 | contractStatus | "사용/중지" — donor_type 평가 시 핵심 |
| 약정일 | promiseDay | 1~31 |
| 결제방식 | paymentTool | "자동결제/미등록" |
| 결제수단 | paymentMethod | "CMS/카드" |
| 결제정보 | paymentInfo | 계좌·카드 마스킹 (예: `451*****720(농협은행)`) |
| 예금주/명의자명 | accountHolder | |
| 결제등록상태 | registrationStatus | "신청완료/신청중/기간만료" |
| 동의여부 | agreementStatus | "동의" |
| 전자계약 | electronicContract | (대부분 "-") |
| 상품목록 | productName | "후원회비/일시후원/정기후원" |
| 상품금액합 | productAmount | 원 (정수) |
| 청구시작일 | billingStart | YYYY-MM-DD |
| 청구종료일 | billingEnd | YYYY-MM-DD or 9999-12-31 |
| 담당관리자 | managerName | "교사유가족협의회" |
| 회원구분 | memberType | "미지정" |
| 청구자동생성 | billingAuto | "자동/수동" |
| 발송방식 | sendMethod | "미발송/수동" |

#### 수납내역 PDF (28컬럼) → hyosungBillings 테이블

| 효성 PDF 컬럼 | schema 컬럼 | 비고 |
|---|---|---|
| 회원번호 | memberNo | |
| 계약번호 | contractNo | "001" 등 |
| 회원명 | memberName | |
| 최초청구월 | firstBillingMonth | YYYY/MM |
| 청구월 | billingMonth | YYYY/MM (PK with memberNo) |
| 납부자 휴대전화 | phone | |
| 상품 | productName | |
| 수납상태 | receiptStatus | "수납대기/완납" |
| 결제상태 | paymentStatus | "대기/결제중" |
| 결제방식 | paymentTool | "자동결제" |
| 결제수단 | paymentMethod | |
| 약정일 | promiseDay | |
| 결제일(납부기간) | paymentDate | |
| 청구타입 | billingType | "정기청구" |
| 미수처리상태 | unreceivedHandling | (대부분 "-") |
| 청구금액 | billingAmount | |
| 공급가액 | supplyAmount | |
| 부가세 | vatAmount | 0 (NPO) |
| 수납금액 | receivedAmount | 0 (수납대기 시점) |
| 미납금액 | unpaidAmount | |
| 취소금액 | cancelAmount | 0 |
| 환불금액 | refundAmount | 0 |
| 청구완납일자 | billingCompletionDate | (수납완료 후) |
| 비고 | memo | |
| 결제결과 | paymentResult | |
| 회원구분 | rawData.member_type | JSONB 보존 |
| 담당관리자 | rawData.manager_name | JSONB 보존 |

### 5.3 신규 회원 자동 생성 (효성 매칭 X일 때)

효성 contracts에 있는 회원번호가 SIREN members에 없을 때, M2 hyosung-merge.ts가 자동 처리:
- `members.signupSourceId` = 효성 가입경로 ID (`signup_sources` 코드 'hyosung_csv' — 없으면 자동 등록)
- `members.name`·`phone` = 효성 값
- `members.donorType` = `'regular'` (효성 contracts에 있다 = 정기 후원자)
- `members.donorChannels` = `["hyosung"]`
- `members.hyosungMemberNo`·`hyosungContractStatus`·`hyosungPromiseDay`·`hyosungPaymentMethod`·`hyosungPaymentTool`·`hyosungBankInfo`·`hyosungSyncedAt` = 효성 값
- 기타 SIREN 고유 컬럼은 디폴트 또는 NULL

### 5.4 merge 보존 정책 (효성 ↔ SIREN 기존 회원)

회원번호 매칭된 기존 회원에게 효성 데이터 흡수 시, M2 hyosung-merge.ts가 화이트리스트 정책 적용:

| 컬럼 종류 | 정책 |
|---|---|
| 효성 운영 컬럼 (members.hyosung_*, hyosungContracts.*) | **효성 값으로 갱신** (덮어쓰기) |
| SIREN 고유 컬럼 (signupSourceId·email·메모·태그·등급·블랙리스트·자격유형·자격변경이력) | **보존** (절대 덮어쓰지 않음) |
| 회원 기본 정보 (이름·연락처) | **효성 값이 비어있지 않을 때만 갱신**, 비어있으면 SIREN 값 유지 |
| donor_type/donor_channels/prospect_subtype | **재평가 후크 호출** (Phase 2 lib/donor-status.ts) |

---

## 6. API 계약 (TypeScript 인터페이스)

### 6.1 위치
Phase 1·2 결정과 동일 — 각 API 파일 안 `export interface`. 본 문서가 SOT.

### 6.2 효성 contracts·billings 업로드 — `POST /api/admin/donation-import` (확장)

기존 admin-donation-import.ts에 효성 분기 추가:

```typescript
export interface AdminDonationImportRequest {
  source: 'hyosung_contracts' | 'hyosung_billings' | 'ibk' | 'toss';
  fileName: string;
  fileBase64: string;     // CSV·xlsx·xls (xlsx/xls는 클라이언트가 SheetJS로 CSV 변환 후 전송)
}

export interface HyosungContractsImportResult {
  ok: true;
  source: 'hyosung_contracts';
  totalRows: number;
  matched: number;             // 기존 회원 매칭
  created: number;             // 신규 회원 자동 생성
  updatedContracts: number;    // hyosungContracts 갱신 (upsert)
  preservedColumns: string[];  // SIREN 고유 컬럼 이름 목록 (보존된 항목)
  donorTypeChanged: number;    // donor_type 재평가로 변경된 회원 수
  errors: { rowIndex: number; reason: string }[];
}

export interface HyosungBillingsImportResult {
  ok: true;
  source: 'hyosung_billings';
  totalRows: number;
  matched: number;             // 회원번호 매칭 성공
  unmatched: number;           // 회원번호 매칭 실패
  donationsCreated: number;    // donations 신규 생성
  billingsUpserted: number;    // hyosungBillings upsert
  errors: { rowIndex: number; reason: string }[];
}
```

### 6.3 통합 회원·정기 후원자 조회 — 기존 API 응답 확장

`admin-members` (Phase 1) 응답에 `hyosung` 객체 추가:

```typescript
export interface AdminMember {
  // 기존 필드
  // ...
  hyosung?: {
    memberNo: number;
    memberStatus: string | null;       // 사용·중지
    contractStatus: string | null;     // 사용·중지
    promiseDay: number | null;         // 1~31
    paymentMethod: string | null;      // CMS·카드
    paymentTool: string | null;        // 자동결제·미등록
    registrationStatus: string | null; // 신청완료·신청중·기간만료
    productName: string | null;        // 후원회비·정기후원·일시후원
    productAmount: number | null;      // 월 약정금액
    billingStart: string | null;       // YYYY-MM-DD
    billingEnd: string | null;         // YYYY-MM-DD or 9999-12-31
  } | null;
}
```

`admin-donor-regular-list` (Phase 2) 응답에 `hyosungContract` 추가:
```typescript
export interface AdminDonorRegular {
  // 기존 필드
  // ...
  hyosungContract?: { /* 위 hyosung 객체 동일 */ } | null;
}
```

### 6.4 종합 검증 대시보드 — `GET /api/admin/donation-dashboard`

```typescript
export interface AdminDonationDashboard {
  ok: true;
  generatedAt: string;
  kpi: {
    membersTotal: number;
    regularTotal: number;
    regularByChannel: { toss: number; hyosung: number; both: number };
    prospectTotal: number;
    prospectBySubtype: { onetime: number; cancelled: number };
    nonDonor: number;
  };
  alerts: {
    type: 'unmatchedHyosungContract' | 'unmatchedHyosungBilling' | 'donorTypeConflict' | 'recentCancellation';
    count: number;
    samples: { memberId?: number; memberNo?: number; description: string }[];
  }[];
  recentCsvImports: {
    source: string;
    uploadedAt: string;
    totalRows: number;
    matched: number;
    created: number;
  }[];
}
```

### 6.5 응답 패턴 (CLAUDE.md §6.1·§6.2)
- 단계별 try/catch + step·detail·stack
- 보조 SELECT 실패 시 빈 배열·null 폴백
- ok() 헬퍼로 wrap (Phase 1·2와 동일) — 클라이언트는 `res.data?.data?.X` fallback

---

## 7. Mock 전략

A 채팅이 B 머지 전 화면 작성용. Phase 1·2 패턴 그대로 — `cms-tbfa.js` 임시 상수 + `USE_MOCK_PHASE3` 플래그.

### 7.1 통합 회원 — 효성 보강 mock 샘플

```javascript
const __MOCK_MEMBERS_HYOSUNG__ = {
  ok: true,
  data: [
    { id: 7, name: '유인자', phone: '010-2434-1756', donorType: 'regular',
      hyosung: {
        memberNo: 7, memberStatus: '사용', contractStatus: '사용',
        promiseDay: 20, paymentMethod: 'CMS', paymentTool: '자동결제',
        registrationStatus: '신청완료',
        productName: '후원회비', productAmount: 20000,
        billingStart: '2024-07-18', billingEnd: '9999-12-31'
      }
    },
    { id: 8, name: '황숙현', phone: '010-9074-2613', donorType: 'prospect',
      hyosung: {
        memberNo: 8, memberStatus: '사용', contractStatus: '중지',
        promiseDay: 20, paymentMethod: null, paymentTool: '미등록',
        registrationStatus: null,
        productName: '후원회비', productAmount: 10000,
        billingStart: '2024-07-18', billingEnd: '9999-12-31'
      }
    }
  ],
  page: 1, pageSize: 50, total: 2
};
```

### 7.2 검증 대시보드 mock 샘플

```javascript
const __MOCK_DASHBOARD__ = {
  ok: true,
  generatedAt: '2026-05-10T03:00:00.000Z',
  kpi: {
    membersTotal: 54,
    regularTotal: 41,
    regularByChannel: { toss: 0, hyosung: 41, both: 0 },
    prospectTotal: 13,
    prospectBySubtype: { onetime: 5, cancelled: 8 },
    nonDonor: 0
  },
  alerts: [
    { type: 'recentCancellation', count: 2, samples: [
      { memberId: 38, memberNo: 46, description: '효성 계약 중지로 잠재 후원자 이동' }
    ]},
    { type: 'unmatchedHyosungContract', count: 0, samples: [] }
  ],
  recentCsvImports: [
    { source: 'hyosung_contracts', uploadedAt: '2026-05-08T10:00:00.000Z',
      totalRows: 54, matched: 50, created: 4 }
  ]
};
```

### 7.3 사용 패턴

```javascript
const USE_MOCK_PHASE3 = true;  // ★ B 머지 후 false 또는 블록 삭제
async function fetchMembersWithHyosung(query) {
  if (USE_MOCK_PHASE3) { await new Promise(r => setTimeout(r, 200)); return __MOCK_MEMBERS_HYOSUNG__; }
  const res = await api('/api/admin/members?' + new URLSearchParams(query));
  if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
  return res.data;
}
```

A는 B 머지 알림 받으면 git fetch + rebase → USE_MOCK_PHASE3=false → 실제 API 동작 확인.

---

## 8. 검증 전략

### 8.1 Main 자체 검증 (라이브러리 작성 중)
- M1 hyosung-mapper.ts 단위 검증 — 효성 sample row → schema 컬럼 변환 정확도 (계약정보 22컬럼·수납내역 28컬럼)
- M2 hyosung-merge.ts 단위 검증 — 기존 회원 매칭 시 SIREN 고유 컬럼 보존, 신규 회원 자동 생성, donor_type 재평가
- 실제 효성 sample CSV/엑셀 1행 흐름 검증 (Swain이 던진 PDF 양식 그대로 만든 sample)

### 8.2 Swain 검증

#### V1 — 효성 CSV/엑셀 업로드
- [ ] 어드민 → CSV 자동 매핑 → 효성 contracts 업로드 → 매칭 결과 표시 (matched/created/preservedColumns/donorTypeChanged)
- [ ] 효성 billings 업로드 → donations 신규 생성 + hyosungBillings 적재
- [ ] 신규 회원 자동 생성 후 SIREN 어드민 회원 목록에 즉시 노출 (signupSource='hyosung_csv')
- [ ] 매칭된 기존 회원의 SIREN 고유 컬럼(메모·태그·등급) 보존 확인 (덮어쓰기 0)
- [ ] 엑셀(xlsx/xls) 파일도 클라이언트 SheetJS 변환 후 동일하게 처리

#### V2 — 통합 회원·정기 후원자 화면
- [ ] 통합 일반 회원 명단에 효성 컬럼 추가 (회원상태·계약상태·약정일·결제방식·등록상태·상품·청구시작일)
- [ ] 정기 후원자 명단에 효성 컬럼 추가 (약정금액·다음 결제일·결제수단·등록상태)
- [ ] 효성 PDF 양식과 1:1 대응 — 운영자가 효성 화면에서 보던 정보를 SIREN에서 그대로 봄

#### V3 — 종합 검증 대시보드
- [ ] KPI 정확 (정기/잠재/비후원 합산 = members 총수)
- [ ] alert 패널 동작 — 미매칭 효성·중복·최근 해지 샘플 표시
- [ ] 효성 미매칭 회원 처리 안내 (수동 매칭 또는 신규 회원 자동 생성 옵션)

#### Phase 1·2 회귀 점검
- [ ] 통합 회원 화면 (Phase 1) 그대로 동작
- [ ] 정기/잠재 후원자 화면 (Phase 2) 그대로 동작
- [ ] 회원 상세 모달의 후원 내역 탭 정상

---

## 9. Phase 3 실행 흐름 (시나리오 b')

### 9.1 단계별 책임·시간

| 순서 | 액션 | 누가 | 벽시계 |
|---|---|---|---:|
| 1 | M1 hyosung-mapper + M2 hyosung-merge 라이브러리 골격 + push | **Main** | 1.0h |
| 2 | A·B 재활성화 통보 | **Swain 복붙** | 0.05h |
| 3 | (병렬) B 파서·후크·cron·API + A 화면 보강·대시보드 프론트 | **B + A** | 3.0h |
| 4 | B 머지 → A mock 제거 → A 머지 | **Main + A** | 0.4h |
| 5 | C1 캐시버스터 일괄 + push | **Main** | 0.2h |
| 6 | Swain V1·V2·V3 검증 | **Swain** | 0.5h |
| **합계** | | | **~5.2h** |

schema 게이트 없어 Phase 2(2.8h)보다는 길지만, 단독(6h~)보다 단축. 효성 SOT 정합성 + 검증 대시보드 강화 비중이 큰 게 Phase 3 특성.

### 9.2 머지 순서 (Phase 1·2와 동일)
1. Main: M1·M2 라이브러리 머지 (단계 1)
2. B: 백엔드 머지 (단계 3 완료 후)
3. A: 프론트 머지 (B 머지 후 mock 제거 + 실제 API 동작 확인)
4. Main: 캐시버스터 + 통합 push

### 9.3 Main 흐름 (자체 작업)
- M1·M2 라이브러리 골격 작성 (효성 양식 매핑 + merge·신규 회원 자동 생성)
- 매핑 표 §5.2를 코드로 그대로 옮김
- §5.4 화이트리스트 정책 강제
- A·B에 §9.4·§9.5 통보문 전달 → A·B 작업 시작
- B 머지 → A 머지 → 캐시버스터 → push
- Swain V 검증 안내

### 9.4 A 작업 지시문 (Swain이 worktree A에서 새 채팅 시작 후 첫 메시지로 복붙)

```
[A 채팅 — Phase 3 (마일스톤 #16 단계 D) 프론트엔드 / Sonnet 4.6]

worktree: C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
브랜치: feature/phase3-frontend (신규)
모델: Claude Sonnet 4.6 (settings.local.json 자동 적용 — 메인 채팅 Opus 4.7과 다름)
역할: 프론트엔드 전담 — D3·D4 효성 컬럼 보강 + D7 종합 검증 대시보드 프론트

## 0. Sonnet 4.6 작업 가이드 (메인 Opus 4.7과 모델 다름)
- 명세는 DESIGN_PHASE3.md §1·§5.2·§6.3·§6.4·§7·§9.4에 모두 박혀 있음 — 그대로 따라가기, 추측 X
- mock JSON 샘플(§7.1·§7.2)은 그대로 복사해서 사용
- 모호하면 즉시 메인 채팅에 보고 (혼자 30분 이상 헤매지 말 것 — CLAUDE.md §6.12)
- 머지 권한은 메인 채팅에만

## 1. 우선 정독
1. CLAUDE.md (자동 로드)
2. .claude/CLAUDE.local.md
3. docs/DESIGN_PHASE3.md 전체 — 특히 §1, §5.2 매핑 표, §6.3·§6.4 API, §7 Mock, §9.4
4. docs/milestones/2026-05-10-donor-system.md §10 (효성 SOT 원칙 — §10.5 화면 표시 정책)
5. public/cms-tbfa.html / cms-tbfa.js / cms-tbfa.css (Phase 1·2 결과)

## 2. 환경 검증 (실행 + 보고)
- pwd → 끝이 tbfa-mis-A
- git fetch origin
- git checkout -b feature/phase3-frontend origin/main  (Phase 2 브랜치는 머지됨)
- git status → clean

## 3. 작업 범위
DESIGN_PHASE3.md §1의 D3·D4·D7 프론트.
- D3: 통합 일반 회원 화면 효성 컬럼 보강 (회원상태·계약상태·약정일·결제방식·결제수단·결제등록상태·상품·청구시작일)
- D4: 정기 후원자 화면 효성 컬럼 보강 (매월 약정금액·다음 결제일·결제수단·결제등록상태·청구 라이프사이클)
- D7 프론트: 종합 검증 대시보드 — KPI 패널 + alert 패널 + 효성 미매칭 회원 처리 안내

§10 효성 SOT §10.5 화면 표시 정책 엄수 — 효성 양식과 1:1 대응. 효성 회원/토스 회원/둘 다 회원 분기 표시.

파일 소유: §4 매트릭스 — public/cms-tbfa.html, public/js/cms-tbfa.js, public/css/cms-tbfa.css.

## 4. 금지 영역
- netlify/functions/* (B 채팅 영역)
- db/schema.ts·lib/* (Main·B 영역)
- lib/auth.ts·admin-guard.ts (deny)

## 5. Mock 전략 (B 머지 전)
DESIGN_PHASE3.md §7 mock JSON 그대로 cms-tbfa.js에 임시 상수 + USE_MOCK_PHASE3=true 분기.
B 머지 알림 받으면 git fetch + rebase → USE_MOCK_PHASE3=false → 실제 API 동작 확인.

## 6. API 계약
DESIGN_PHASE3.md §6.3·§6.4 100% 준수.
응답 접근: ok() 헬퍼 wrap → res.data?.data?.X 패턴.

## 7. 완료 조건
1. 통합 일반 회원 화면이 효성 양식 그대로 표시 (D3)
2. 정기 후원자 화면이 효성 양식 그대로 표시 (D4)
3. 종합 검증 대시보드 KPI·alert 동작 (D7 프론트)
4. B 머지 후 mock 제거 + 실제 API 동작 확인
5. 메인 채팅에 "A Phase 3 프론트 완료, 머지 부탁" 보고

## 8. 첫 답변 형식
1. 환경 검증 결과
2. CLAUDE.local.md 자동 로드 여부
3. 작업 시작 계획 (D3·D4·D7 프론트 진행 순서)

자, 환경 검증부터.
```

### 9.5 B 작업 지시문 (Swain이 worktree B에서 새 채팅 시작 후 첫 메시지로 복붙)

```
[B 채팅 — Phase 3 (마일스톤 #16 단계 D) 백엔드 / Sonnet 4.6]

worktree: C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
브랜치: feature/phase3-backend (신규)
모델: Claude Sonnet 4.6 (settings.local.json 자동 적용 — 메인 채팅 Opus 4.7과 다름)
역할: 백엔드 전담 — D1·D2 효성 파서 + D5 cron 정교화 + D6 토스 정밀화 + D7 백엔드

## 0. Sonnet 4.6 작업 가이드 (메인 Opus 4.7과 모델 다름)
- 명세는 DESIGN_PHASE3.md §1·§5.2·§5.3·§5.4·§6.2·§6.4·§9.5에 모두 박혀 있음 — 그대로 따라가기
- §5.2 매핑 표는 SOT — 임의 매핑 변경 금지
- §5.4 merge 정책 화이트리스트는 M2 라이브러리(메인이 미리 머지)에 강제. 의문 시 메인 채팅에 물음
- 모호하면 즉시 메인 채팅에 보고 (혼자 30분 이상 헤매지 말 것 — CLAUDE.md §6.12)
- 머지 권한은 메인 채팅에만

## 1. 우선 정독
1. CLAUDE.md (자동 로드)
2. .claude/CLAUDE.local.md
3. docs/DESIGN_PHASE3.md 전체 — 특히 §1, §5.2 매핑 표, §5.3·§5.4 정책, §6.2·§6.4 API, §9.5
4. docs/milestones/2026-05-10-donor-system.md §10 (효성 SOT 원칙 — §10.2 일방향 흐름·§10.3 매핑 정책 엄수)
5. lib/hyosung-parser.ts (기존 — 본 사이클에 맞게 보강 또는 V2 함수 추가)
6. lib/hyosung-mapper.ts (Main이 작성한 양식 매핑 라이브러리 — 의존)
7. lib/hyosung-merge.ts (Main이 작성한 merge·신규 회원 정책 — 의존)
8. lib/donor-status.ts (Phase 2 후크 — D5에서 정교화)
9. netlify/functions/admin-donation-import.ts (확장 대상)
10. netlify/functions/cron-donor-status-sync.ts (Phase 2 결과 — D5에서 정교화)
11. netlify/functions/auth-toss-billing-issued.ts (D6 정밀화 대상)

## 2. 환경 검증 (실행 + 보고)
- pwd → 끝이 tbfa-mis-B
- git fetch origin
- git checkout -b feature/phase3-backend origin/main
- git status → clean
- lib/hyosung-mapper.ts·hyosung-merge.ts 존재 확인

## 3. 작업 범위
DESIGN_PHASE3.md §1의 D1·D2·D5·D6 + D7 백엔드.
- D1: 효성 contracts CSV/엑셀 파서 — hyosungContracts 적재 + members 매칭/신규 생성 (M2 hyosung-merge.ts 사용)
- D2: 효성 billings CSV/엑셀 파서 신규 (lib/hyosung-billings-parser.ts) — hyosungBillings 적재 + donations 적재
- D5: cron-donor-status-sync.ts 정교화 — hyosungContracts.contractStatus 사용 → donor_type 평가
- D6: 토스 빌링 정밀화 — auth-toss-billing-issued.ts에서 SIREN 자체 약정일·약정금액·결제수단 직접 기록
- D7 백엔드: admin-donation-dashboard.ts 신규 (KPI + alert 종합)

§10 효성 SOT §10.2 일방향 흐름 + §10.3 매핑 정책 100% 준수. SIREN → 효성 푸시 절대 금지.

파일 소유: §4 매트릭스. 기존 hyosung-parser.ts 시그니처 변경 시 회귀 점검 필수 — append-only로 V2 함수 추가 권장.

## 4. 금지 영역
- public/* (A 채팅)
- db/schema.ts (변경 0건)
- lib/hyosung-mapper.ts·hyosung-merge.ts (Main 영역, 호출만)
- lib/auth.ts·admin-guard.ts (deny)
- 효성으로 데이터 푸시하는 코드 일체 (§10 SOT 위반)

## 5. 매핑 표 사용
DESIGN_PHASE3.md §5.2 매핑 표 그대로 lib/hyosung-mapper.ts 함수 호출. 임의로 매핑 변경 X.

## 6. API 계약 — 100% 준수
DESIGN_PHASE3.md §6.2 (admin-donation-import 확장) + §6.4 (donation-dashboard) 인터페이스 그대로.
- ok / source별 결과 객체
- 단계별 try/catch + step·detail·stack
- export const config = { path: "/api/admin/donation-import" } 등
- requireAdmin → auth.res 패턴

## 7. 완료 조건
1. 효성 contracts·billings CSV/엑셀 업로드 → hyosungContracts·hyosungBillings 적재 + members·donations 매칭/생성 + SIREN 고유 컬럼 보존
2. cron-donor-status-sync 정교화 — 효성 contractStatus 기반 평가
3. 토스 D6 정밀화 — 빌링키 등록 시 SIREN 자체 약정일·금액 직접 기록
4. donation-dashboard API 동작 — KPI + alert
5. 메인 채팅에 "B Phase 3 백엔드 완료, 머지 부탁" + curl 샘플 응답 첨부

## 8. 첫 답변 형식
1. 환경 검증 결과 (특히 lib/hyosung-mapper.ts·hyosung-merge.ts 존재 확인)
2. CLAUDE.local.md 자동 로드 여부
3. 작업 시작 계획 (D1·D2·D5·D6·D7 백엔드 진행 순서)

자, 환경 검증부터.
```

---

## 10. 예상 시간

**~5.2h 벽시계** (시나리오 b' 채택). 단독(~6h) 대비 약 0.8h 단축. schema 게이트 없어서 Phase 2(2.8h)보다는 길지만, 효성 SOT 정합성 + 검증 대시보드 비중이 큼.

내역: §9.1 표 합계.

---

## 11. 리스크 — 사고 사례 §6.5·CLAUDE.md §9.1 적용

| 리스크 | 회피 |
|---|---|
| **(★ 최대) 효성 SOT merge 정책 위반** — SIREN 고유 컬럼(메모·태그·등급·블랙리스트) 덮어쓰기 | M2 hyosung-merge.ts 라이브러리에 화이트리스트 강제. 단위 검증 필수. §5.4 정책 표가 SOT |
| **효성 데이터 SIREN으로 푸시 (양방향 동기화 함정)** | §10.2 일방향 흐름 엄수. SIREN → 효성 코드 일체 작성 X |
| 신규 회원 자동 생성 시 중복 등록 | 회원번호 unique 인덱스 (hyosungContracts.memberNo unique) + members 매칭 후 분기 |
| 효성 contracts·billings 매칭 실패 (회원번호 없음·오타) | unmatched 통계 + 어드민 alert 패널 (D7) — 수동 매칭 옵션 |
| 토스 D6 정밀화로 인한 결제 영향 | Phase 2 후크 패턴 그대로 fire-and-forget. 후크 실패해도 결제 자체 영향 0 |
| 기존 hyosung-parser.ts 시그니처 변경 회귀 | append-only로 V2 함수 추가 권장. 기존 호출부 회귀 점검 |
| cron-donor-status-sync 정교화로 donor_type 오판 | Phase 2 안전망 패턴 유지 — 매일 재평가 + 수동 재실행 가능 |
| 검증 대시보드 KPI 합산 오류 | 단위 검증 + Phase 1·2 화면과 비교 |
| 효성 양식 변경 (운영자가 다른 양식 받았을 때) | M1 매핑 함수 분리 + 양식 버전 인식 (옵션, 추후 확장) |
| 동명이인 / 같은 휴대전화 | 회원번호가 unique이므로 매칭 우선순위 = 회원번호 → 보조로 휴대전화 |

---

## 12. Phase 4 진입 조건

Phase 3 완료 ✓ + Swain V1·V2·V3 검증 통과 ✓ + tag `phase3-complete-{date}` 부여 ✓
→ 마일스톤 #16 종료 + 6순위 #8 (1:1 매칭 채팅) 또는 Phase 4~22 신규 마일스톤 진입

---

## 13. 변경 이력

| 일시 | 내용 |
|---|---|
| 2026-05-10 | A·B worktree에 Sonnet 4.6 자동 설정 (`settings.local.json` `"model": "claude-sonnet-4-6"`). §2.0 모델 분배 표 신설. §9.4·§9.5 작업 지시문에 모델 표기·명세 준수 강조 추가 |
| 2026-05-10 | Phase 3 본격 11섹션 설계서 신설. Swain 효성 PDF 양식(계약정보 22컬럼·수납내역 28컬럼) 매핑 결과 schema 변경 0건 확인. b' 패턴 채택 |
