# Phase 1 설계 — 마일스톤 #16 단계 B (본격)

> **작성**: 2026-05-10 / 메인 채팅
> **전제**: [PHASE_PROPOSAL.md](PHASE_PROPOSAL.md) 시나리오 B 채택
> **Phase 1 정의**: 마일스톤 #16 단계 B (통합 일반 회원 실제 API + 회원 상세 모달) + 6순위 #6/#15 사용자 검증
> **목표**: #BUG-2(cms-tbfa 더미) 해소 + 진짜 회원 명단·상세·후원 이력 가시화
> **본 문서는 설계 합의용**. 채택 후 본 문서를 참조해 코드 작업 시작.

---

## 1. 작업 목록 (PHASE_PROPOSAL §3 시나리오 B / 마일스톤 §2.2)

| ID | 항목 | 영역 | 비고 |
|---|---|---|---|
| **B1** | `cms-tbfa.js` DEMO_MEMBERS·DEMO_WEB_DONORS·DEMO_TAGS 제거 | 프론트 | #BUG-2 직접 해결 지점 |
| **B2** | `admin-members.ts` `?source=siren\|hyosung\|manual\|all` 필터 추가 | 백엔드 | 가입경로 분류 |
| **B3** | `admin-members.ts` `?donorType=regular\|prospect\|none\|all` 필터 추가 | 백엔드 | Phase 1에서는 'none' 디폴트 (단계 C에서 컬럼 본격 활용) |
| **B4** | 가입경로 뱃지 UI (🌐싸이렌 / 🏦효성 / ✍️수기 / 🎪이벤트 / 📦기타 / null은 '─' 회색) | 프론트 | `members.signup_source_id` 기반, 5종 enum + null |
| **B5** | 후원 상태 뱃지 UI (🔁정기 / 💡잠재 / —비후원) | 프론트 | Phase 1은 placeholder, C 컬럼 적용 후 본격 |
| **B6** | 검색·필터 드롭다운·페이지네이션 (50/페이지) | 프론트 | |
| **B7** | 회원 상세 모달 — 기본 정보 + 후원 내역 탭 | 프론트 | 핵심 |
| **B8** | `admin-member-donations.ts` 신규 API (회원별 후원 이력) | 백엔드 | B7 모달 후원 내역 탭에서 호출 |
| **B9** | 캐시버스터 일괄 갱신 `?v=2026-05-10-c4` | 통합 | Main이 머지 직전 일괄 |
| **V1** | Swain — 마이페이지 자격 변경 검증 (#6) | 검증 | 한 사이클 |
| **V2** | Swain — CSV 자동 매핑 검증 (#15) | 검증 | 효성/IBK CSV 업로드 → 매칭 → 확정 |

---

## 2. 영역 분류 (A / B / Main)

### A 채팅 — 프론트엔드 (`feature/donor-step-b-fe`)
**책임**: cms-tbfa 화면의 모든 UI 변경
**작업**: B1, B4, B5, B6, B7 (UI 부분), B9 (본인 파일 캐시버스터)
**의존**: §6 API 계약을 보고 mock 사용해 즉시 시작 가능. 백엔드 머지 전 통합 검증은 §7 mock 전략

### B 채팅 — 백엔드 (`feature/donor-step-b-be`)
**책임**: API 확장·신설·계약 준수
**작업**: B2, B3, B8
**의존**: 없음. §6 API 계약 그대로 구현. DB schema 변경 없음

### Main 채팅 — 통합·조율 (`tbfa-mis`, `main`)
**책임**:
- §6 API 계약 정의·합의 (이 문서)
- 머지 조율 (B → A 순서, §11 의존성 그래프)
- 캐시버스터 일괄 검증
- Swain 검증 시나리오 안내
- PROJECT_STATE.md / HANDOFF.md 갱신

**작업**: B9 일괄 검증, 통합 검수
**의존**: A·B 모두 푸시 후

---

## 3. 작업 의존성 그래프

```
[Main: §6 API 계약 합의 → 본 문서 채택]
              │
   ┌──────────┴──────────┐
   ▼                     ▼
[B 채팅]               [A 채팅]
 B2: admin-members      B1: DEMO_* 제거
     ?source 필터          (mock 응답 사용)
 B3: admin-members      B4: 가입경로 뱃지
     ?donorType 필터    B5: 후원 상태 뱃지
 B8: admin-member-      B6: 검색·필터·페이지네이션
     donations 신규     B7: 회원 상세 모달
                            (백엔드 mock 응답 사용)
   │                     │
   ▼                     ▼
[B 머지 → main]       (A는 B 머지 대기)
   │                     │
   └──────────┬──────────┘
              ▼
   [A: mock 제거 + 실제 API 연동 검증 → 머지]
              │
              ▼
   [Main: B9 캐시버스터 일괄 검증 + push]
              │
              ▼
   [Swain 검증: V1·V2 + 단계 B 사용자 시나리오]
```

**핵심**: A는 mock으로 백엔드 머지 전 90% 완성 → B 머지 후 실제 API 교체 + 검증. 직렬 대기 시간 최소화.

---

## 4. 파일·폴더 소유권 매트릭스

| 경로 | 소유 | Phase 1 변경 유형 |
|---|---|---|
| `netlify/functions/admin-members.ts` | **B** | 확장 — `?source` `?donorType` 쿼리 파라미터, 응답 타입에 `signupSourceLabel`, `donorType` 추가 |
| `netlify/functions/admin-member-donations.ts` | **B** | 신규 생성 |
| `public/js/cms-tbfa.js` | **A** | DEMO_* 제거 + fetch 전환 + 모달 호출 + 뱃지 렌더 + 페이지네이션 |
| `public/cms-tbfa.html` | **A** | 회원 상세 모달 마크업 추가 + cms-tbfa.js·css 캐시버스터 |
| `public/css/cms-tbfa.css` | **A** | 모달 스타일 + 뱃지 스타일 (append-only) |
| `db/schema.ts` | (변경 없음) | Phase 1 schema 무변경. 단계 C에서 처리 |
| `lib/auth.ts` / `lib/admin-guard.ts` | ⛔ | settings.json deny — 변경 금지 |
| `lib/contracts/cms-tbfa-members.ts` | (선택) | §6 결정 — 단일 타입 파일 도입 여부 |
| `PROJECT_STATE.md` | **Main** | §2 / §4.6 진행률 / §6.6 #BUG-2 |
| `docs/HANDOFF.md` | **Main** | §3·§4 갱신 (단계 B ✅ 표시) |

**충돌 위험**: 없음. A·B는 완전 독립 파일군 작업. 같은 파일 동시 편집 0.

---

## 5. DB 변경사항

**Phase 1: schema.ts 변경 0 / 마이그레이션 0**

이유:
- `members.signupSourceId` (라인 206) 이미 존재 → `?source` 분류는 기존 컬럼 활용
- `?donorType`은 단계 C에서 추가될 `members.donor_type` 컬럼을 사용 예정. Phase 1에서는 모든 회원에 `donor_type='none'` 디폴트 가정 (실제 컬럼 없으니 응답 시 'none'으로 채움)

→ **단계 C에서 schema 변경**. Phase 1은 무변경 보장 (회귀 위험 0).

---

## 6. API 계약 (TypeScript 인터페이스)

### 6.1 위치 결정 — 결정 필요 (§6.10 모듈 구조)

| 옵션 | 위치 | 장점 | 단점 |
|---|---|---|---|
| **(a)** 각 함수 파일 안 `export interface` | `admin-members.ts` 본문 | 기존 SIREN 패턴, 추가 폴더 X | A 채팅(JS)이 직접 import 못함 — 본 문서가 SOT |
| (b) 신규 폴더 `lib/contracts/` | `lib/contracts/cms-tbfa-members.ts` | 공유 타입 명확, 추후 도메인 확장 시 재사용 | 새 폴더 도입 = §6.10 모듈 구조 변경(확인 필요) |
| (c) 본 문서에만 인라인 | `docs/DESIGN_PHASE1.md` §6.2 | 추가 파일 0, 짧은 사이클에 충분 | 문서·코드 동기화 책임이 사람 |

**추천: (a) — 각 API 파일 export interface + 본 문서에 사본**. 이유: 기존 패턴 유지, A는 JS라서 어차피 본 문서가 SOT. 본 사이클 안에서 부담 최소.

**🟢 결정 (Swain 합의 2026-05-10): (a) 채택**. B 채팅이 `admin-members.ts` / `admin-member-donations.ts` 안에 `export interface`로 정의하고, 본 문서 §6.2가 합의의 single source of truth.

### 6.2 인터페이스 정의 (모든 옵션 공통 — 본 문서가 합의의 SOT)

> 🟢 **2026-05-10 보강 (B 채팅 발견 + Swain 합의)**:
> - **API path 슬래시 유지** — 기존 `admin.html` 호환을 위해 `/api/admin/members` (하이픈 X)
> - **응답 schema 병행** — 기존 `{list, pagination, categoryCounts}` + §6.2 `{data, page, pageSize, total}` 동시 응답 (회귀 0)
> - **SignupSource enum 5종 확장** — DB의 5개 코드 모두 노출 + 라벨 매핑 명시

```typescript
/* ─── B2·B3: GET /api/admin/members (확장, 슬래시 path 유지) ─── */

// SignupSource: DB의 signup_sources.code → API enum 매핑
export type SignupSource = 'siren' | 'hyosung' | 'manual' | 'event' | 'etc';
export type DonorType    = 'regular' | 'prospect' | 'none';

// DB code → API enum 매핑 표 (B 채팅이 변환 책임)
//   'website'      → 'siren'      라벨 '싸이렌' 이모지 🌐
//   'hyosung_csv'  → 'hyosung'    라벨 '효성'   이모지 🏦
//   'admin'        → 'manual'     라벨 '수기'   이모지 ✍️
//   'event'        → 'event'      라벨 '이벤트' 이모지 🎪
//   'etc'          → 'etc'        라벨 '기타'   이모지 📦
//   (코드 없음·null) → null        라벨 null    이모지 (UI에서 '─' 처리)

export interface AdminMembersQuery {
  source?:    SignupSource | 'all';   // default 'all'. 5종 + 'all'
  donorType?: DonorType    | 'all';   // default 'all' (Phase 1: 'none' 위주)
  q?:         string;                  // 검색(이름·이메일·연락처 like)
  page?:      number;                  // 1-base
  pageSize?:  number;                  // default 50, max 200
}

export interface AdminMember {
  id:                 number;
  name:               string;
  email:              string | null;
  phone:              string | null;
  signupSourceId:     number | null;
  signupSource:       SignupSource | null;   // 5종 enum 또는 null(코드 자체 없는 경우)
  signupSourceLabel:  string | null;          // 한글: '싸이렌' | '효성' | '수기' | '이벤트' | '기타' | null
  donorType:          DonorType;              // Phase 1은 'none' 디폴트
  status:             string;                 // 'active' | 'blacklist' | 'withdrawn' 등
  createdAt:          string;                 // ISO8601
}

// 응답 — 기존 키 + §6.2 키 병행 (admin.html과 cms-tbfa.js 모두 호환)
export interface AdminMembersResponse {
  ok:    true;
  // [§6.2 키 — cms-tbfa.js(A 채팅) 사용]
  data:  AdminMember[];
  page:  number;
  pageSize: number;
  total: number;
  // [기존 키 — admin.html 호환 유지, 동일 데이터 별칭]
  list:  AdminMember[];                  // = data
  pagination: { page: number; pageSize: number; total: number };  // = { page, pageSize, total }
  categoryCounts?: Record<string, number>;  // 기존 그대로 (있으면)
}

export interface AdminMembersErrorResponse {
  ok:    false;
  error: string;
  step?: string;
  detail?: string;
}

/* ─── B8: GET /api/admin/member-donations?memberId=N ─── */

export type DonationKind    = 'regular' | 'onetime';
export type DonationChannel = 'toss' | 'hyosung' | 'ibk' | 'manual';

export interface AdminMemberDonationsQuery {
  memberId: number;            // required
  page?:    number;
  pageSize?: number;           // default 30
}

export interface AdminMemberDonation {
  id:        number;
  kind:      DonationKind;     // 'regular' | 'onetime'
  channel:   DonationChannel;  // 'toss' | 'hyosung' | 'ibk' | 'manual'
  amount:    number;           // 원 단위
  paidAt:    string;           // ISO8601
  status:    string;           // 'paid' | 'failed' | 'cancelled' 등
  memo:      string | null;
}

export interface AdminMemberDonationsResponse {
  ok:    true;
  member: { id: number; name: string };   // 모달 헤더 검증용
  data:  AdminMemberDonation[];
  totalCount:  number;          // 모든 후원 건수 누적
  totalAmount: number;          // 모든 후원 금액 누적 (원)
  page:  number;
  pageSize: number;
}
```

### 6.3 응답 키 정책 (CLAUDE.md §6.1·§6.2 준수)

- 클라이언트는 다중 fallback 처리: `res.data.data.X || res.data.X`
- 서버는 단계별 try/catch + step 라벨 + detail + stack
- 보조 SELECT(예: `signupSourceLabel`)는 실패해도 빈 문자열·null로 폴백

---

## 7. Mock 전략 (B 늦을 때 A가 쓸 응답)

### 7.1 위치
A 채팅이 본인 worktree의 `public/js/cms-tbfa.js` 안에 **임시 상수**로 mock 응답을 박는다. B 머지 후 A가 이 상수를 제거하면서 실제 fetch로 교체.

### 7.2 mock 응답 샘플 (그대로 사용 가능, 5종 enum + 병행 키 반영)

```javascript
// public/js/cms-tbfa.js — A 채팅 임시 mock (B 머지 후 제거)
const __MOCK_ADMIN_MEMBERS__ = {
  ok: true,
  // §6.2 키
  data: [
    { id: 101, name: '지주은', email: 'jiju@example.com', phone: '010-1111-2222',
      signupSourceId: 2, signupSource: 'hyosung', signupSourceLabel: '효성',
      donorType: 'none', status: 'active', createdAt: '2026-04-15T09:30:00.000Z' },
    { id: 102, name: '박두용', email: null, phone: '010-3333-4444',
      signupSourceId: 2, signupSource: 'hyosung', signupSourceLabel: '효성',
      donorType: 'none', status: 'active', createdAt: '2026-04-22T14:10:00.000Z' },
    { id: 103, name: '김유족', email: 'kim@example.com', phone: '010-5555-6666',
      signupSourceId: 1, signupSource: 'siren', signupSourceLabel: '싸이렌',
      donorType: 'none', status: 'active', createdAt: '2026-03-08T18:45:00.000Z' },
    { id: 104, name: '강자원', email: null, phone: '010-7777-8888',
      signupSourceId: 3, signupSource: 'manual', signupSourceLabel: '수기',
      donorType: 'none', status: 'active', createdAt: '2026-04-30T10:00:00.000Z' },
    { id: 105, name: '정행사', email: 'event@example.com', phone: null,
      signupSourceId: 4, signupSource: 'event', signupSourceLabel: '이벤트',
      donorType: 'none', status: 'active', createdAt: '2026-05-05T16:20:00.000Z' },
    { id: 106, name: '박기타', email: null, phone: '010-9999-0000',
      signupSourceId: 5, signupSource: 'etc', signupSourceLabel: '기타',
      donorType: 'none', status: 'active', createdAt: '2026-05-08T11:15:00.000Z' }
  ],
  page: 1, pageSize: 50, total: 6,
  // 기존 키 (admin.html 호환, 동일 데이터 별칭)
  list: null,  // 실제 응답은 data와 동일 — A 채팅은 data만 사용
  pagination: { page: 1, pageSize: 50, total: 6 }
};
// 주: list 필드는 실제 B 응답에선 data와 동일 객체. mock에서는 A가 안 쓰니 null로 둬도 무방.

const __MOCK_ADMIN_MEMBER_DONATIONS__ = {
  ok: true,
  member: { id: 101, name: '지주은' },
  data: [
    { id: 5001, kind: 'regular', channel: 'hyosung', amount: 30000,
      paidAt: '2026-05-01T00:00:00.000Z', status: 'paid', memo: '효성 5월분' },
    { id: 4982, kind: 'regular', channel: 'hyosung', amount: 30000,
      paidAt: '2026-04-01T00:00:00.000Z', status: 'paid', memo: '효성 4월분' },
    { id: 4801, kind: 'onetime', channel: 'toss', amount: 100000,
      paidAt: '2026-02-14T11:20:00.000Z', status: 'paid', memo: '명절 일시' }
  ],
  totalCount: 3, totalAmount: 160000, page: 1, pageSize: 30
};
```

### 7.3 mock 사용 패턴 (cms-tbfa.js)

```javascript
// 임시 mock — B 머지 전 사용. B 머지 후 if (USE_MOCK) 블록 통째로 삭제.
const USE_MOCK = true;  // ★ B 머지 후 false 또는 블록 삭제

async function fetchMembers(query) {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 200)); // 네트워크 시뮬
    return __MOCK_ADMIN_MEMBERS__;
  }
  const res = await api('/api/admin-members?' + new URLSearchParams(query));
  if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
  return res.data;
}
```

### 7.4 mock 제거 시점

A는 B 머지 알림 받으면:
1. `git fetch origin && git rebase origin/main`
2. `USE_MOCK = false` (또는 mock 블록 통째 삭제)
3. 실제 API로 동작 확인 → 캐시버스터 갱신 → 머지 요청

---

## 8. 검증 전략 (각자 책임)

### A 책임 (프론트)
- 본인 worktree에서 mock 사용 시각 검증
- 통합 회원 명단 50건 페이지네이션, 검색·필터 동작
- 회원 상세 모달 열기·닫기, 탭 전환 (기본 정보·후원 내역)
- 뱃지 색상·이모지 표시 (가입경로 3종, 후원 상태 3종)
- B 머지 후 mock → 실제 API 교체 + edge 케이스 (empty 회원, 0건 후원)

### B 책임 (백엔드)
- §6 인터페이스 100% 준수 (필드명·타입·optional)
- `admin-members.ts` 응답 페이로드 schema 일치 (예: `signupSource`, `signupSourceLabel`, `donorType`)
- `admin-member-donations.ts`:
  - `members.id` 존재 확인 → 없으면 404
  - `requireAdmin` 가드 (`auth.res` 패턴)
  - `export const config = { path: "/api/admin/member-donations" }` 누락 금지
- 단계별 try/catch + step·detail·stack
- 빈 결과 (회원은 있지만 후원 0건) 정상 응답 (`data: []`, `totalCount: 0`)
- 페이지네이션 limit 안전 상한 (max 200)

### Main 책임 (통합)
- B 머지 후 A가 mock 제거 → 실제 API 호출 시 응답 구조 일치 확인
- 캐시버스터 한 번 더 증가 (`?v=2026-05-10-c4` → 필요 시 `c5`)
- Swain 검증 시나리오 안내(§9·§10 지시문에 포함)
- PROJECT_STATE §4.6·§6.6, HANDOFF §3·§4 갱신

### Swain 검증 (V1·V2 + 단계 B)
체크리스트 (DESIGN_PHASE1.md 가벼운 버전 §6 그대로 유지):
- [ ] cms-tbfa 통합 회원 탭에 진짜 회원 명단 (DEMO 0)
- [ ] 회원 클릭 → 상세 모달 + 후원 내역 탭
- [ ] 가입경로/후원 상태 뱃지 표시
- [ ] #6 마이페이지 → 자격 변경 한 사이클
- [ ] #15 어드민 → CSV 자동 매핑 한 사이클

---

## 9. A 작업 지시문 초안 (복붙 가능)

> Swain이 새 채팅(또는 기존 A 채팅)에서 첫 메시지로 그대로 붙여넣기.
> **사전 액션 (Swain)**: `git worktree add ../tbfa-mis-A feature/donor-step-b-fe origin/main` 실행 후 그 폴더에서 새 VS Code + Claude Code 시작.

```
[A 채팅 — 마일스톤 #16 단계 B 프론트엔드]

CLAUDE.md 자동 로드 + 다음 문서 우선 읽고 작업 시작:
- docs/DESIGN_PHASE1.md 전체 (단, §6 API 계약과 §7 mock 전략 + §9 본 지시문 정독)
- docs/milestones/2026-05-10-donor-system.md §2 (참고)
- public/js/cms-tbfa.js:60-90 (제거 대상 DEMO_*)
- public/cms-tbfa.html (모달 위치 결정)

## 환경 검증 먼저 (보고)
pwd → 끝이 tbfa-mis-A
git branch --show-current → feature/donor-step-b-fe
git status → 깨끗
git fetch origin && git rebase origin/main → 충돌 없음

## 작업 범위 (이 채팅에서만)
DESIGN_PHASE1.md §1 의 B1·B4·B5·B6·B7 + 본인 파일 캐시버스터.
파일 소유: §4 매트릭스 — 본인 영역 = public/js/cms-tbfa.js, public/cms-tbfa.html, public/css/cms-tbfa.css

## 금지 영역
- netlify/functions/admin-members.ts (B 채팅 영역)
- netlify/functions/admin-member-donations.ts (B 채팅 신규)
- db/schema.ts (Phase 1 schema 무변경)
- lib/auth.ts, lib/admin-guard.ts (settings.json deny)

## Mock 사용 (백엔드 머지 전)
DESIGN_PHASE1.md §7 mock 응답 그대로 cms-tbfa.js 안에 임시 상수로 박고 진행.
USE_MOCK = true 플래그로 mock/실제 API 분기. B 머지 알림 받으면 USE_MOCK = false + mock 블록 제거.

## API 계약 (반드시 준수)
DESIGN_PHASE1.md §6.2 의 AdminMember·AdminMemberDonation 인터페이스 그대로 가정해서 UI 코드 작성.
키 변경하지 말 것 — 변경 필요하면 메인 채팅에 보고 후 §6 합의 갱신.

## 완료 조건
1. DEMO_MEMBERS·DEMO_WEB_DONORS·DEMO_TAGS 모두 제거
2. mock 또는 실제 API로 진짜 회원 명단 표시
3. 회원 상세 모달 (기본 정보 + 후원 내역 탭)
4. 가입경로 뱃지 (싸이렌·효성·수기) + 후원 상태 뱃지 (정기·잠재·비후원) 표시
5. 검색·페이지네이션 동작
6. cms-tbfa.html / cms-tbfa.js / cms-tbfa.css 캐시버스터 ?v=2026-05-10-c4
7. B 머지 후 mock 제거 + 실제 API로 동작 확인
8. 메인 채팅에 "A 단계 B 프론트 완료, 머지 부탁" 보고

## 갱신 의무
- 작업 시작 시 메인 채팅에 한 줄 보고
- 작업 종료 시 변경 파일 목록 + 핵심 변경점 + 머지 요청

## 브랜치
feature/donor-step-b-fe (베이스: origin/main)

자, 환경 검증 결과부터 보고해줘.
```

---

## 10. B 작업 지시문 초안 (복붙 가능)

> **사전 액션 (Swain)**: `git worktree add ../tbfa-mis-B feature/donor-step-b-be origin/main` 실행 후 그 폴더에서 새 채팅 시작.

```
[B 채팅 — 마일스톤 #16 단계 B 백엔드]

CLAUDE.md 자동 로드 + 다음 문서 우선 읽고 작업 시작:
- docs/DESIGN_PHASE1.md 전체 (특히 §6 API 계약, §8 검증 전략, §10 본 지시문)
- netlify/functions/admin-members.ts 전체 (확장 대상)
- netlify/functions/admin-member-detail.ts (참고: 권한·응답 패턴)
- db/schema.ts members 정의 (라인 200~270 부근, signupSourceId 라인 206)

## 환경 검증 먼저 (보고)
pwd → 끝이 tbfa-mis-B
git branch --show-current → feature/donor-step-b-be
git status → 깨끗
git fetch origin && git rebase origin/main → 충돌 없음

## 작업 범위 (이 채팅에서만)
DESIGN_PHASE1.md §1 의 B2·B3·B8.
파일 소유: §4 매트릭스 — 본인 영역 = netlify/functions/admin-members.ts (확장),
                          netlify/functions/admin-member-donations.ts (신규)

## 금지 영역
- public/* 전체 (A 채팅 영역)
- db/schema.ts (Phase 1 schema 무변경)
- lib/auth.ts, lib/admin-guard.ts, lib/hyosung-parser.ts (settings.json deny)

## API 계약 (반드시 준수)
DESIGN_PHASE1.md §6.2 의 AdminMembersResponse·AdminMemberDonationsResponse 인터페이스 100% 준수.
- 필드명·타입 정확히
- ok / data / page / pageSize / total 키 일관
- 단계별 try/catch + step·detail·stack
- 보조 SELECT 실패 시 빈 배열·null 폴백
- max pageSize 200 안전 상한
- export const config = { path } 누락 금지
- requireAdmin 결과는 auth.res 패턴

## donorType 처리 (Phase 1)
schema에 donor_type 컬럼이 아직 없음 → 응답 시 모든 회원 donorType='none' 디폴트.
?donorType 쿼리 필터:
- 'all' 또는 미지정 → 모든 회원
- 'none' → 모든 회원 (현재 모두 'none')
- 'regular'·'prospect' → 빈 결과 ([], total: 0) — Phase C에서 컬럼 추가 후 본격

## signupSourceLabel
members.signup_source_id로 signup_sources 테이블 조인하여 한글 라벨 반환.
실패 시 ''(빈 문자열) 폴백 — 메인 SELECT는 보존.

## 완료 조건
1. admin-members.ts ?source ?donorType ?q ?page ?pageSize 모두 동작
2. admin-member-donations.ts 신규 — 회원별 후원 이력 + totalCount + totalAmount
3. 빈 결과 케이스 (data: [], total: 0) 정상 응답
4. requireAdmin 가드 통과·실패 모두 동작
5. 메인 채팅에 "B 단계 B 백엔드 완료, 머지 부탁" 보고

## 갱신 의무
- 작업 시작 시 한 줄 보고
- 작업 종료 시 변경/신규 파일 목록 + curl/postman 샘플 응답 1개씩 첨부

## 브랜치
feature/donor-step-b-be (베이스: origin/main)

자, 환경 검증 결과부터 보고해줘.
```

---

## 11. 예상 작업 시간

### 직렬 시 (A·B 동시 안 돌리고 한 채팅 단독)
| 단계 | 시간 |
|---|---:|
| API 계약 합의 (이 문서) | 0.2h |
| B 백엔드 (확장 + 신규) | 1.0~1.5h |
| A 프론트 (DEMO 제거 + 모달 + 뱃지) | 1.0~1.5h |
| 통합·캐시버스터·머지 | 0.3h |
| Swain 검증 (V1·V2 + 단계 B) | 0.5~1.0h |
| **합계** | **3.0~4.5h** |

### 병렬 시 (시나리오 B 채택, A·B 동시)
| 단계 | 시간 (벽시계) |
|---|---:|
| API 계약 합의 (Main) | 0.2h |
| A·B 동시 작업 (mock 활용) | 1.0~1.5h |
| B 머지 → A 실제 API 교체 검증 | 0.3~0.5h |
| 통합·캐시버스터·푸시 | 0.2h |
| Swain 검증 | 0.5~1.0h |
| **합계** | **2.2~3.4h** |

→ 병렬화로 약 30~40% 단축. 사이클 가용 30h 대비 매우 여유로움 → Phase 2 진입 안전.

---

## 12. 리스크 — 사고 사례 §6.5·§9.1.6 적용

| 리스크 | 회피 |
|---|---|
| schema.ts 동시 수정 회귀 (2026-05-09 사고) | Phase 1은 schema 변경 0 — 위험 없음 |
| A·B worktree 같은 폴더 공유 | 별도 폴더 강제: `../tbfa-mis-A` (FE) / `../tbfa-mis-B` (BE) |
| API 계약 변경 무통보 | 본 문서 §6.2가 SOT — 변경 시 메인 채팅 합의 + §6 갱신 의무 |
| Mock과 실제 응답 불일치 | §6 인터페이스 100% 준수 + §8 B 책임 schema 검증 |
| `requireAdmin` narrowing 누락 | 본 지시문 §10 명시 — `auth.res` 패턴 강제 |

---

## 13. Phase 2 진입 조건

Phase 1 완료 ✓ + Swain 검증 ✓ + PROJECT_STATE/HANDOFF 갱신 ✓
→ Phase 2 (#16 단계 C) 분담 설계 별도 작성 (DESIGN_PHASE2.md)
