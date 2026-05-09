# Phase 2 설계 — 마일스톤 #16 단계 C (본격)

> **작성**: 2026-05-10 / 메인 채팅
> **전제**: [PHASE_PROPOSAL.md](PHASE_PROPOSAL.md) 시나리오 B 채택, [Phase 1 ✅ 완료](DESIGN_PHASE1.md) (tag `phase1-complete-20260510`)
> **Phase 2 정의**: 마일스톤 #16 단계 C — **후원 회원 분류(정기/잠재/비후원) 정착**
> **목표**: 회원 정보에 후원 분류 칸 4개 추가 + 토스/효성 자동 갱신 + 정기/잠재 화면 본격 가동
> **본 문서는 설계 합의용**. 채택 후 본 문서를 참조해 코드 작업 시작.

---

## 1. 작업 목록 (마일스톤 §3 단계 C)

| ID | 항목 | 영역 | 비고 |
|---|---|---|---|
| **C1** | 회원 테이블에 분류 칸 4개 추가 (donor_type / donor_channels / prospect_subtype / donor_evaluated_at) | DB | NULL 디폴트, 기존 회귀 0 |
| **C2** | 마이그레이션 함수 1회용 작성 (Swain 직접 호출) | 백엔드 | 호출 후 즉시 삭제 |
| **C3** | 토스 빌링키 등록 시 즉시 반영 — 정기 후원자로 자동 분류 | 백엔드 후크 | `auth-toss-billing-issued.ts` |
| **C4** | 토스 결제 성공 시 재평가 (이미 정기면 유지) | 백엔드 후크 | `cron-toss-billing.ts` |
| **C5** | 토스 해지 시 채널 제거 — 다른 채널 없으면 잠재로 이동 | 백엔드 후크 | 마이페이지 해지 함수 |
| **C6** | 효성 CSV 확정 시 일괄 갱신 | 백엔드 후크 | `admin-donation-confirm.ts` 안 |
| **C7** | 야간 자동 동기화 작업 — 매일 새벽 일괄 재평가 (안전망) | 백엔드 cron | `cron-donor-status-sync.ts` 신규 |
| **C8** | 정기 후원자 조회 API + 채널별 KPI | 백엔드 신규 | `admin-donor-regular-list` |
| **C9** | 잠재 후원자 조회 API + 분류 필터 | 백엔드 신규 | `admin-donor-prospect-list` |
| **C10** | 정기 후원자 화면 placeholder → 실제 명단 | 프론트 | 채널 뱃지·정기금액·다음 결제일·누적 |
| **C11** | 잠재 후원자 화면 placeholder → 실제 명단 | 프론트 | 분류 탭(일시/중단/전체)·마지막 후원일·재유치 액션 |
| **C12** | 캐시버스터 일괄 갱신 | 통합 | `?v=2026-05-10-c5` |
| **V1** | Swain — 마이그레이션 호출 (?run=1) | 검증 | 어드민 로그인 후 1회 |
| **V2** | Swain — 정기/잠재 화면 검증 | 검증 | 실제 회원 분류 확인 |

---

## 2. 영역 분류

### (b') Main 선행 + A·B 후속 — 🟢 채택 (Swain 합의 2026-05-10)

Phase 1 검증된 패턴(API 계약 합의 → 분담 → 통합)에 **schema 게이트만 앞에 추가**한 흐름. Main이 schema·마이그 단독 처리 후 schema 활성화되면 A·B 동시 분담, 완료 시 Main 통합.

| 단계 | 누가 | 작업 |
|---|---|---|
| 1 | **Main** | C1·C2 schema 정의 + 마이그 함수 작성 → push |
| 2 | **Swain** | 어드민 로그인 → `?run=1` 호출 → 성공 → Main에 알림 |
| 3 | **Main** | schema.ts 활성화 + 마이그 함수 삭제 → push → A·B 재활성화 통보 |
| 4a | **B 채팅** | C3~C9 백엔드 후크·cron·조회 API |
| 4b | **A 채팅** | C10·C11 정기/잠재 화면 (B 머지 전 mock 사용 가능) |
| 5 | **Main** | C12 캐시버스터 + B 머지 → A 머지 → 통합·푸시 |
| 6 | **Swain** | V2 화면 검증 |

**장점**:
- schema 충돌 위험 0 (Main 단독으로 schema 처리 후 A·B 분담 — 2026-05-09 사고와 본질적으로 다른 구조)
- Phase 1 검증된 패턴 재사용 (mock·API 합의·동시 작업 → Main 통합)
- 시간 단축 ~2.5h (단독 3.4h 대비 약 1h 절감)

**필수 액션**:
- A·B 재활성화 통보문 작성 (직전 "Phase 2 휴면" 통보 갱신) — 본 문서 §9.4·§9.5 참조

### 2.1 대안 (a) Main 단독 — 보류

모든 코드 Main 단독. 시간 3.4h. (b') 채택으로 보류.

### 2.2 대안 (b) Main + A + B 완전 동시 병렬 — 비추천

Main도 schema·마이그 작업 중에 A·B 동시 시작. schema 충돌 위험 큼 (2026-05-09 사고 재발). 비추천.

---

## 3. 작업 의존성 그래프 (시나리오 b')

```
[1] Main: schema 컬럼 정의 작성(코드만) + C2 마이그 함수 작성 + push
        │
        ▼
[2] Swain: 어드민 로그인 → /api/migrate-add-members-donor-type?run=1 → 성공 → Main에 알림
        │
        ▼
[3] Main: schema.ts 4개 컬럼 정의 활성화 + 마이그 함수 삭제 + push (CLAUDE.md §6.7 절차)
        │
        ▼
[3.5] Main: A·B 재활성화 통보 (Swain이 §9.4·§9.5 통보문 복붙)
        │
   ┌────┴────┐
   ▼         ▼
[4a B 채팅]  [4b A 채팅]
 C3~C5 토스   C10 정기 후원자 화면
 C6 효성      C11 잠재 후원자 화면
 C7 cron      (B 머지 전 mock 사용)
 C8·C9 API
   │         │
   ▼         ▼
[B 머지]    (A는 B 머지 대기)
   │         │
   └────┬────┘
        ▼
[5] A: mock 제거 + 실제 API 교체 → 머지
        │
        ▼
[6] Main: C12 캐시버스터 일괄 + push
        │
        ▼
[7] Swain V2: 정기/잠재 화면 검증
```

핵심 게이트: **2단계 = Swain 마이그 호출 1회**. 그 후 A·B 병렬 가능.

---

## 4. 파일 소유권 매트릭스 (시나리오 b')

| 경로 | 책임 | 변경 유형 |
|---|---|---|
| `db/schema.ts` | **Main** | 컬럼 4개 정의 추가 (마이그 적용 후 활성화 — §6.7) |
| `netlify/functions/migrate-add-members-donor-type.ts` | **Main** | 신규 (호출 후 즉시 삭제) |
| `netlify/functions/auth-toss-billing-issued.ts` | **B** | 후크 추가 (donor_type 갱신) |
| `netlify/functions/cron-toss-billing.ts` | **B** | 후크 추가 (결제 성공 시 재평가) |
| 마이페이지 해지 함수 (위치 확인 — B가 작업 시작 시 식별) | **B** | 후크 추가 (채널 제거) |
| `netlify/functions/admin-donation-confirm.ts` | **B** | 후크 추가 (효성 확정 시 재평가) |
| `netlify/functions/cron-donor-status-sync.ts` | **B** | 신규 cron |
| `netlify/functions/admin-donor-regular-list.ts` | **B** | 신규 API |
| `netlify/functions/admin-donor-prospect-list.ts` | **B** | 신규 API |
| `public/cms-tbfa.html` | **A** | 정기/잠재 화면 마크업 |
| `public/js/cms-tbfa.js` | **A** | 정기/잠재 화면 동작 |
| `public/css/cms-tbfa.css` | **A** | 정기/잠재 스타일 (append-only) |
| `netlify.toml` | **B** | cron 스케줄 추가 (donor-status-sync, KST 03:00) |
| 캐시버스터 일괄 갱신 | **Main** | 통합 단계에서 일괄 |
| `lib/auth.ts` / `admin-guard.ts` / `hyosung-parser.ts` | ⛔ | 변경 금지 |

**충돌 위험**: A·B 동시 작업 시 — A는 `public/cms-tbfa.*`, B는 `netlify/functions/*` + `netlify.toml`. **공유 파일 0**, 충돌 위험 0. schema는 Main이 분담 시작 전 활성화 완료라 이미 안정.

---

## 5. DB 변경사항 (★ Phase 2 핵심)

### 5.1 신규 컬럼 4개 (members 테이블)

| 컬럼 | 타입 | 의미 | 디폴트 |
|---|---|---|---|
| `donor_type` | varchar(20) | `regular` / `prospect` / `none` / NULL(미평가) | NULL |
| `donor_channels` | jsonb | 정기 채널 배열: `["toss"]` / `["hyosung"]` / `["toss","hyosung"]` / NULL | NULL |
| `prospect_subtype` | varchar(20) | `onetime` / `cancelled` / NULL | NULL |
| `donor_evaluated_at` | timestamp | 마지막 평가 시각 | NULL |

### 5.2 식별 기준 (마일스톤 §3.2)

**정기 후원자**: 토스 빌링키 + 다음 결제일 잡힘 → channels에 `toss` / 효성 contracts active → channels에 `hyosung` / 둘 다면 두 채널 모두

**잠재 후원자**:
- 일시 후원 1회+ → `prospect_subtype='onetime'`
- 정기 중단(토스 해지 또는 효성 cancelled) → `prospect_subtype='cancelled'`

**비후원**: 위 어느 케이스도 아님 → `donor_type='none'`

### 5.3 마이그레이션 함수 (1회용)

`netlify/functions/migrate-add-members-donor-type.ts`:
- GET ?run=1 → requireAdmin → ALTER TABLE 4개(IF NOT EXISTS) + 인덱스 + 최초 1회 식별 실행
- GET (기본) → 진단 모드 (인증 불필요)
- 멱등 보장
- **호출 성공 후 즉시 삭제 + 커밋** (§6.8 1회용 보안 원칙)

### 5.4 schema.ts 정의 활성화 절차 (CLAUDE.md §6.7 엄격 준수)

```
1. Main: 마이그 함수 작성 → push
2. Swain: ?run=1 호출 → 성공 응답 캡처 → Main에 알림
3. Main: schema.ts 4개 컬럼 정의 추가 → push
4. Main: 마이그 함수 삭제 → push
```

이 순서를 어기면 즉시 운영 깨짐 (어드민 로그인 SELECT 실패 등). 2026-05-09 사고 사례 §6.5 동일 위험.

---

## 6. API 계약 (TypeScript 인터페이스)

### 6.1 위치
Phase 1 결정과 동일 — 각 API 파일 안 `export interface` (옵션 a). 본 문서가 SOT.

### 6.2 정기 후원자 조회 — `GET /api/admin/donor-regular-list`

```typescript
export type DonorChannel = 'toss' | 'hyosung';

export interface AdminDonorRegularQuery {
  channel?:  DonorChannel | 'all';   // default 'all'
  q?:        string;                 // 검색
  page?:     number;
  pageSize?: number;                 // default 50, max 200
}

export interface AdminDonorRegular {
  id:                 number;
  name:               string;
  email:              string | null;
  phone:              string | null;
  channels:           DonorChannel[];   // ['toss'] | ['hyosung'] | ['toss','hyosung']
  regularAmount:      number | null;    // 정기금액 (원/월)
  nextBillingDate:    string | null;    // ISO8601
  cumulativeMonths:   number;           // 누적 정기 기간 (개월)
  cumulativeAmount:   number;           // 누적 정기 합계 (원)
  donorEvaluatedAt:   string;           // ISO8601
}

export interface AdminDonorRegularResponse {
  ok:    true;
  data:  AdminDonorRegular[];
  page:  number;
  pageSize: number;
  total: number;
  kpi: {
    regularTotal:     number;   // 정기 후원자 총수
    tossCount:        number;
    hyosungCount:     number;
    bothCount:        number;
    monthlyAmountSum: number;   // 정기금액 월 합계
  };
}
```

### 6.3 잠재 후원자 조회 — `GET /api/admin/donor-prospect-list`

```typescript
export type ProspectSubtype = 'onetime' | 'cancelled';

export interface AdminDonorProspectQuery {
  subtype?:  ProspectSubtype | 'all';   // default 'all'
  q?:        string;
  page?:     number;
  pageSize?: number;
}

export interface AdminDonorProspect {
  id:                 number;
  name:               string;
  email:              string | null;
  phone:              string | null;
  subtype:            ProspectSubtype;
  lastDonationDate:   string | null;
  lastDonationAmount: number | null;
  totalDonationCount: number;             // 일시·정기 합산
  totalDonationAmount: number;
  cancelledChannel:   DonorChannel | null;  // subtype='cancelled' 시 어느 채널
  donorEvaluatedAt:   string;
}

export interface AdminDonorProspectResponse {
  ok:    true;
  data:  AdminDonorProspect[];
  page:  number;
  pageSize: number;
  total: number;
  kpi: {
    prospectTotal:  number;
    onetimeCount:   number;
    cancelledCount: number;
  };
}
```

### 6.4 응답 패턴 (CLAUDE.md §6.1·§6.2)
- 단계별 try/catch + step·detail·stack
- 보조 SELECT 실패 시 빈 배열·null 폴백
- ok() 헬퍼로 wrap (Phase 1과 동일) — 클라이언트는 `res.data?.data?.X` fallback

---

## 7. Mock 전략 (시나리오 b')

A 채팅이 B 머지 전 미리 화면 작성하기 위한 mock. Phase 1 §7 패턴 그대로 — `cms-tbfa.js` 안에 임시 상수 + `USE_MOCK` 플래그.

### 7.1 정기 후원자 mock 샘플

```javascript
const __MOCK_DONOR_REGULAR__ = {
  ok: true,
  data: [
    { id: 101, name: '지주은', email: 'jiju@example.com', phone: '010-1111-2222',
      channels: ['hyosung'], regularAmount: 30000,
      nextBillingDate: '2026-06-01T00:00:00.000Z',
      cumulativeMonths: 6, cumulativeAmount: 180000,
      donorEvaluatedAt: '2026-05-10T03:00:00.000Z' },
    { id: 102, name: '박두용', email: null, phone: '010-3333-4444',
      channels: ['toss', 'hyosung'], regularAmount: 50000,
      nextBillingDate: '2026-05-15T00:00:00.000Z',
      cumulativeMonths: 12, cumulativeAmount: 600000,
      donorEvaluatedAt: '2026-05-10T03:00:00.000Z' }
  ],
  page: 1, pageSize: 50, total: 2,
  kpi: { regularTotal: 2, tossCount: 1, hyosungCount: 1, bothCount: 1, monthlyAmountSum: 80000 }
};
```

### 7.2 잠재 후원자 mock 샘플

```javascript
const __MOCK_DONOR_PROSPECT__ = {
  ok: true,
  data: [
    { id: 103, name: '김유족', email: 'kim@example.com', phone: '010-5555-6666',
      subtype: 'onetime', lastDonationDate: '2026-02-14T11:20:00.000Z',
      lastDonationAmount: 100000, totalDonationCount: 1, totalDonationAmount: 100000,
      cancelledChannel: null, donorEvaluatedAt: '2026-05-10T03:00:00.000Z' },
    { id: 104, name: '강자원', email: null, phone: '010-7777-8888',
      subtype: 'cancelled', lastDonationDate: '2025-12-10T00:00:00.000Z',
      lastDonationAmount: 30000, totalDonationCount: 8, totalDonationAmount: 240000,
      cancelledChannel: 'toss', donorEvaluatedAt: '2026-05-10T03:00:00.000Z' }
  ],
  page: 1, pageSize: 50, total: 2,
  kpi: { prospectTotal: 2, onetimeCount: 1, cancelledCount: 1 }
};
```

### 7.3 사용 패턴

```javascript
const USE_MOCK_DONOR = true;  // ★ B 머지 후 false 또는 블록 삭제

async function fetchRegularDonors(query) {
  if (USE_MOCK_DONOR) {
    await new Promise(r => setTimeout(r, 200));
    return __MOCK_DONOR_REGULAR__;
  }
  const res = await api('/api/admin/donor-regular-list?' + new URLSearchParams(query));
  if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
  return res.data;
}
// donor-prospect도 동일 패턴
```

A는 B 머지 알림 받으면: `git fetch origin && git rebase origin/main` → `USE_MOCK_DONOR = false` 또는 블록 통째 삭제 → 실제 API 동작 확인.

---

## 8. 검증 전략

### 8.1 Main 자체 검증 (코드 작성 중)
- schema 컬럼 활성화 후 admin-members API 정상 응답 (Phase 1 회귀 0)
- 토스 후크 — 빌링키 등록 시 donor_type 'regular' 갱신 (테스트 결제 1건)
- 효성 후크 — pending_donations 확정 시 갱신 확인
- cron-donor-status-sync 수동 실행 후 회원 분포 변화 확인
- 정기/잠재 조회 API curl 검증 (빈 결과 / 50+건 / KPI 정확)

### 8.2 Swain 검증 (V2 — 화면)

#### 정기 후원자 화면
- [ ] 진짜 정기 후원자 명단 표시 (placeholder 사라짐)
- [ ] 채널 뱃지 — 토스만 / 효성만 / 둘 다
- [ ] 정기금액 + 다음 결제일 + 누적 기간 표시
- [ ] 채널 필터(토스만/효성만/모두) 동작
- [ ] KPI 패널 — 총수·토스·효성·합계

#### 잠재 후원자 화면
- [ ] 분류 탭(일시 / 중단 / 전체) 전환 동작
- [ ] 마지막 후원일 + 누적 후원 횟수·금액
- [ ] subtype='cancelled'인 경우 어느 채널 해지인지 표시
- [ ] 빈 결과 케이스 안내

#### Phase 1 회귀 점검
- [ ] 통합 일반 회원 화면 (Phase 1 결과) 그대로 동작
- [ ] 회원 상세 모달의 후원 내역 탭 정상

---

## 9. Phase 2 실행 흐름 (시나리오 b')

### 9.1 단계별 책임·시간

| 순서 | 액션 | 누가 | 벽시계 |
|---|---|---|---:|
| 1 | schema 컬럼 정의 + 마이그 함수 작성 + push | **Main** | 0.5h |
| 2 | 어드민 로그인 → 마이그 호출 → 성공 → Main에 알림 | **Swain** | 0.05h |
| 3 | schema.ts 활성화 + 마이그 함수 삭제 + push | **Main** | 0.1h |
| 3.5 | A·B 재활성화 통보 (§9.4·§9.5) | **Swain 복붙** | 0.05h |
| 4 | (병렬) B 후크·cron·API + A 정기/잠재 화면 | **B + A** | 1.5h |
| 5 | B 머지 → A mock 제거 → A 머지 | **Main + A** | 0.3h |
| 6 | 캐시버스터 일괄 + push → Swain V2 검증 | **Main + Swain** | 0.3h |
| **합계** | | | **~2.8h** |

### 9.2 머지 순서 (Phase 1과 동일)

1. Main: schema·마이그 머지 (단계 1·3)
2. B: 백엔드 머지 (단계 4 완료 후)
3. A: 프론트 머지 (B 머지 후 mock 제거 + 실제 API 동작 확인)
4. Main: 캐시버스터 + 통합 push

### 9.3 Main 흐름 (자체 작업)

본 채팅(Main)이 직접 진행:
- C1·C2: schema 컬럼 정의 코드 + 마이그 함수 1회용 작성
- C2 완료 후 Swain에게 마이그 호출 안내
- Swain 호출 성공 알림 받으면 schema.ts 활성화 + 마이그 함수 삭제 + push
- A·B에 §9.4·§9.5 통보문 전달 → A·B 작업 시작
- B 머지 → A 머지 → 캐시버스터 → push
- Swain V2 검증 안내

### 9.4 A 작업 지시문 (Swain이 worktree A에서 새 채팅 시작 후 첫 메시지로 복붙)

```
[A 채팅 — Phase 2 (마일스톤 #16 단계 C) 프론트엔드]

worktree: C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
브랜치: feature/phase2-frontend (신규)
역할: 프론트엔드 전담 — 정기 후원자 화면(C10) + 잠재 후원자 화면(C11)

## 1. 우선 정독
1. CLAUDE.md (자동 로드 — 코딩 컨벤션·자율성 §6.10~6.14)
2. .claude/CLAUDE.local.md (이 worktree 한정 규칙)
3. docs/DESIGN_PHASE2.md 전체 — 특히 §1 작업 목록, §6.2·§6.3 API 계약, §7 Mock, §9.4 본 지시문
4. docs/DESIGN_PHASE1.md §6.2·§7 (Phase 1 패턴 참고)
5. public/cms-tbfa.html / cms-tbfa.js / cms-tbfa.css (Phase 1 결과물 — 스타일·구조 일관성 유지)

## 2. 환경 검증 (실행 + 보고)
- pwd → 끝이 tbfa-mis-A
- git fetch origin
- git checkout -b feature/phase2-frontend origin/main  (Phase 1 브랜치는 이미 머지됨)
- git branch --show-current → feature/phase2-frontend
- git status → clean
- node_modules / .env.local / .claude/* 파일들 그대로 존재

## 3. 작업 범위 (이 채팅에서만)
DESIGN_PHASE2.md §1의 C10·C11.
- 정기 후원자 화면: 채널 뱃지(토스/효성) + 정기금액 + 다음 결제일 + 누적 기간 + 채널 필터 + KPI 패널
- 잠재 후원자 화면: 분류 탭(일시/중단/전체) + 마지막 후원일 + 누적 후원·금액 + 재유치 액션(이메일/메모 — placeholder도 OK)
- 사이드바의 [정기 후원자]·[잠재 후원자] placeholder 메뉴 → 실제 화면 연결

파일 소유: §4 매트릭스 — public/cms-tbfa.html, public/js/cms-tbfa.js, public/css/cms-tbfa.css.

## 4. 금지 영역
.claude/CLAUDE.local.md §3 + DESIGN §4 매트릭스. 특히:
- netlify/functions/* (B 채팅 영역)
- db/schema.ts (Main이 활성화 완료, 손대지 말 것)
- lib/auth.ts·admin-guard.ts·hyosung-parser.ts (deny)

## 5. Mock 전략 (B 머지 전)
DESIGN_PHASE2.md §7.1·§7.2 mock JSON 그대로 cms-tbfa.js에 임시 상수로 박고 USE_MOCK_DONOR = true 분기.
B 머지 알림 받으면 git fetch + rebase → USE_MOCK_DONOR = false → mock 블록 삭제 → 실제 API 동작 확인.

## 6. API 계약
DESIGN_PHASE2.md §6.2 AdminDonorRegularResponse + §6.3 AdminDonorProspectResponse 100% 준수.
응답 접근: ok() 헬퍼 wrap → res.data?.data?.data || [] 패턴 (Phase 1과 동일).

## 7. 완료 조건
1. 정기 후원자 화면 동작 (채널 뱃지·정기금액·다음 결제일·누적·필터·KPI)
2. 잠재 후원자 화면 동작 (탭·마지막 후원일·누적)
3. 사이드바 placeholder → 실제 화면 라우팅
4. B 머지 후 mock 제거 + 실제 API 동작 확인
5. 메인 채팅에 "A Phase 2 프론트 완료, 머지 부탁" 보고

## 8. 첫 답변 형식
1. 환경 검증 결과
2. CLAUDE.local.md 자동 로드 여부
3. 작업 시작 계획 (C10·C11 진행 순서 1~2줄)

자, 환경 검증부터.
```

### 9.5 B 작업 지시문 (Swain이 worktree B에서 새 채팅 시작 후 첫 메시지로 복붙)

```
[B 채팅 — Phase 2 (마일스톤 #16 단계 C) 백엔드]

worktree: C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
브랜치: feature/phase2-backend (신규)
역할: 백엔드 전담 — 토스/효성 후크 + 야간 cron + 정기/잠재 조회 API

## 1. 우선 정독
1. CLAUDE.md (자동 로드)
2. .claude/CLAUDE.local.md
3. docs/DESIGN_PHASE2.md 전체 — 특히 §1, §3, §5, §6, §9.5
4. docs/milestones/2026-05-10-donor-system.md §3 (식별 기준 정독)
5. netlify/functions/auth-toss-billing-issued.ts / cron-toss-billing.ts / admin-donation-confirm.ts (확장 대상)
6. db/schema.ts members 테이블 — donor_type / donor_channels / prospect_subtype / donor_evaluated_at 컬럼이 활성화됐는지 확인

## 2. 환경 검증 (실행 + 보고)
- pwd → 끝이 tbfa-mis-B
- git fetch origin
- git checkout -b feature/phase2-backend origin/main  (Phase 1 브랜치는 이미 머지됨)
- git branch --show-current → feature/phase2-backend
- git status → clean
- members 테이블 새 컬럼 4개가 schema.ts에 정의되어 있는지 grep 확인 (donor_type 등)

## 3. 작업 범위 (이 채팅에서만)
DESIGN_PHASE2.md §1의 C3~C9.
- C3·C4·C5: 토스 빌링키 등록/결제 성공/해지 시 후크
- C6: 효성 contracts/billings CSV 확정 시 후크 (admin-donation-confirm.ts 안)
- C7: cron-donor-status-sync.ts 신규 (KST 03:00 일괄 재평가, netlify.toml에 스케줄 추가)
- C8: admin-donor-regular-list.ts 신규 (정기 후원자 + 채널별 KPI)
- C9: admin-donor-prospect-list.ts 신규 (잠재 후원자, subtype 필터)

파일 소유: §4 매트릭스. 후크 추가는 기존 함수 확장(append-only).

## 4. 금지 영역
- public/* (A 채팅)
- db/schema.ts (Main이 활성화 완료, 손대지 말 것)
- lib/auth.ts·admin-guard.ts·hyosung-parser.ts (deny)
- 기존 함수 시그니처 변경 (호출부 회귀 위험)

## 5. 식별 기준 (마일스톤 §3.2)
정기 후원자: 토스 빌링키 활성 / 효성 contracts active → channels에 해당 채널 추가
잠재 후원자: 일시 후원 1회+ → subtype='onetime' / 정기 중단 → subtype='cancelled'
비후원: 위 둘 다 아님 → donor_type='none'

## 6. 후크 패턴 — fire-and-forget
후크는 메인 트랜잭션 끝난 후 추가 update만. 실패해도 결제 자체에 영향 0:
  try { await reevaluateDonorType(memberId); } catch (e) { console.warn('donor reeval failed', e); }

## 7. API 계약 — 100% 준수
DESIGN_PHASE2.md §6.2·§6.3 인터페이스 그대로 export interface.
- ok / data / page / pageSize / total + kpi
- 단계별 try/catch + step·detail·stack
- max pageSize 200
- export const config = { path: "/api/admin/donor-regular-list" } / "/api/admin/donor-prospect-list"
- requireAdmin → auth.res 패턴

## 8. 완료 조건
1. 토스 후크 3개 + 효성 후크 + cron-donor-status-sync 모두 동작
2. 조회 API 2개 + KPI 정확
3. netlify.toml에 cron 스케줄 추가
4. 메인 채팅에 "B Phase 2 백엔드 완료, 머지 부탁" + curl 샘플 응답 첨부

## 9. 첫 답변 형식
1. 환경 검증 결과 (특히 schema.ts에 donor_type 등 4개 컬럼 활성화 확인)
2. CLAUDE.local.md 자동 로드 여부
3. 작업 시작 계획 (C3~C9 진행 순서)

자, 환경 검증부터.
```

---

## 10. 예상 시간

**~2.8h 벽시계** (시나리오 b' 채택). 단독 시나리오(3.4h) 대비 약 1h 단축.

내역: §9.1 표 합계.

A·B 병렬 효과 + Phase 1 검증된 패턴 재사용으로 동기화 비용 최소화.

---

## 11. 리스크 — 사고 사례 §6.5·§9.1.6 적용

| 리스크 | 회피 |
|---|---|
| schema 변경으로 Phase 1 admin-members API 회귀 | 신규 컬럼은 NULL 디폴트라 기존 SELECT 영향 0. tsc 후 회귀 점검 필수 |
| 토스 후크가 운영 결제 영향 | 후크는 트랜잭션 끝난 후 추가 update만 — 결제 자체 영향 0. 실패해도 fire-and-forget |
| 마이그 1회용 보안 | §6.8 절차 엄수: 호출 성공 후 즉시 삭제 + 커밋·푸시 |
| donor_type 식별 SQL 오판 | 야간 cron으로 매일 보정 (§3.5 안전망) |
| 사용자 마이페이지 해지 후크 누락 | cron 매일 재평가 시 자동 보정 |
| schema 컬럼 활성화 시점 어김 | 마이그 호출 → 활성화 → 마이그 삭제 순서 엄수, 어기면 운영 즉시 깨짐 |

---

## 12. Phase 3 (단계 D) 진입 조건

Phase 2 완료 ✓ + Swain V2 검증 통과 ✓ + tag `phase2-complete-{date}` 부여 ✓
→ Phase 3 (#16 단계 D) 분담 설계 별도 작성 (`DESIGN_PHASE3.md`)

D는 Phase 2의 `donor_type` 컬럼을 활용 + 효성 결제 데이터 파서 추가 + 종합 검증 대시보드. **B 채팅 재활성화** 가능.
