# 마일스톤 #16 — 통합 회원·후원 회원 시스템 + CSV 종합 검증

> **상태**: 🔵 설계 합의 완료 / 미착수
> **추정**: 8~12h (단계 B + C + D 합산)
> **마일스톤 식별자**: 6순위 #16
> **우선순위**: 6순위 #8(1:1 매칭 채팅)보다 우선 권장 (운영 핵심)
> **선행**: 단계 A(메뉴 재배치) 완료 — commit `42fd6c6`

---

## 1. 도메인 모델 (사용자 합의)

```
[통합 일반 회원]  ← 마스터 풀
  ├ 싸이렌 웹 가입자 (후원 안 한 사람도 포함)
  ├ 효성 CMS+ 회원
  └ 수기 등록 회원

         │ 후원 발생/이력
         ▼

[후원 회원]  ← 통합 회원의 부분집합
  ├ 정기 후원자
  │   ├ 토스 빌링 진행 중 (즉시 반영)
  │   └ 효성 CMS+ 'active' (CSV 업로드 시 일괄 반영)
  └ 잠재 후원자
      ├ 일시 후원 (토스 일회·계좌이체)
      └ 정기 중단 (토스 해지·효성 cancelled)
```

**핵심 원칙**:
- 모든 회원은 통합 회원에 1번만 등록 (마스터)
- 후원 회원은 별도 테이블 X — 통합 회원의 컬럼(`donor_type`)으로 분류
- admin.html(SIREN 사용자 어드민)과 cms-tbfa.html(NPO 운영 마스터)는 **분리 유지 + 데이터 연동** (같은 DB, 다른 시각)

---

## 2. 단계 B — 통합 일반 회원 실제 API + 회원 상세 (1.5~2.5h)

### 2.1 핵심 변경
- `cms-tbfa.js`의 `DEMO_MEMBERS` (7명 더미) 제거 → 실제 `members` 테이블 연결
- 단일 데이터 소스 = `admin-members` API 재사용 + 필터 확장 (결정 1=C)

### 2.2 작업 항목

| # | 항목 | 비고 |
|---|---|---|
| B1 | `cms-tbfa.js` DEMO_MEMBERS·DEMO_WEB_DONORS·DEMO_TAGS 제거 | 의존하던 화면 모두 실제 fetch로 교체 |
| B2 | `admin-members.ts`에 `?source=siren\|hyosung\|manual\|all` 필터 추가 | 가입경로 분류 |
| B3 | `admin-members.ts`에 `?donorType=regular\|prospect\|none\|all` 필터 추가 | 후원 상태 분류 (단계 C 컬럼 활용 — B 시점엔 'none' 디폴트) |
| B4 | UI 가입경로 뱃지 (🌐싸이렌 / 🏦효성 / ✍️수기) | members.signup_source_id 기반 |
| B5 | UI 후원 상태 뱃지 (🔁정기 / 💡잠재 / —비후원) | members.donor_type 기반 |
| B6 | 검색 / 필터 드롭다운 / 페이지네이션 (50/페이지) | |
| B7 | **회원 상세 모달 (★)** + 후원 내역 탭 | 결정 4 — 회원별 과거 후원 이력 표시 |
| B8 | `admin-member-donations.ts` API 신규 (회원별 후원 이력 조회) | 없으면 신규, 있으면 활용 |
| B9 | 캐시버스터 갱신 | cms-tbfa.js v=2026-05-10-c4 |

### 2.3 회원 상세 모달 구조 (B7)

```
[회원 상세 모달]
┌─ 기본 정보 탭 ─────────────────┐
│ 이름 / 이메일 / 연락처            │
│ 가입경로 / 가입일 / 태그          │
│ 메모                            │
└──────────────────────────────┘
┌─ 후원 내역 탭 (★ 결정 4) ────────┐
│ 정기/일시 / 채널(토스/효성/IBK) │
│ 금액 / 일자 / 상태               │
│ 누적: N회 / 총 X원              │
└──────────────────────────────┘
┌─ (옵션) 메모 탭 ─────────────┐
│ 운영자 내부 메모              │
└──────────────────────────────┘
```

### 2.4 완료 시 효과
- ✅ #BUG-2 해결 (cms-tbfa 더미 데이터)
- ✅ 진짜 회원 명단을 cms-tbfa에서 직접 보고 관리 가능
- ✅ 회원별 후원 이력 즉시 조회 (CSV 매칭 검증도 여기서 가능)

---

## 3. 단계 C — 후원 회원 분리 (정기/잠재) (3~4h)

### 3.1 데이터 모델 — `members` 테이블 컬럼 추가

```sql
ALTER TABLE members ADD COLUMN donor_type varchar(20);
  -- 'regular' | 'prospect' | 'none' | NULL(미평가)
ALTER TABLE members ADD COLUMN donor_channels jsonb;
  -- 정기 채널: ['toss'] | ['hyosung'] | ['toss','hyosung'] | NULL
ALTER TABLE members ADD COLUMN prospect_subtype varchar(20);
  -- 'onetime' | 'cancelled' | NULL
ALTER TABLE members ADD COLUMN donor_evaluated_at timestamp;
```

> **결정 2 반영**: 컬럼 추가 + 정기 채널 구분(토스/효성) + 잠재 분류(일시/중단) + 평가 시각 추적

### 3.2 식별 기준 (결정 3·4)

**정기 후원자** (둘 중 하나):
- 토스 빌링키 등록 + 다음 결제일 잡혀 있음 → `donor_channels = ['toss']`
- 효성 CMS+ 계약 = 'active' → `donor_channels = ['hyosung']`
- 둘 다 → `donor_channels = ['toss', 'hyosung']`

**잠재 후원자** (둘 중 하나, 정기 아닌 경우):
- 일시 후원 1회+ → `prospect_subtype='onetime'`
- 정기 중단 (토스 해지 또는 효성 cancelled) → `prospect_subtype='cancelled'`

**비후원**: 위 어느 케이스도 아님 → `donor_type='none'`

### 3.3 즉시 반영 — 토스 (사용자 결정: 토스는 즉시 반영)

| 트리거 | 갱신 동작 |
|---|---|
| `auth-toss-billing-issued` (빌링키 등록) | donor_type='regular' + channels에 'toss' 추가 |
| `cron-toss-billing` 결제 성공 | donor_type 재평가 (이미 regular면 유지) |
| 토스 해지 (사용자 마이페이지) | channels에서 'toss' 제거 → 다른 채널 있으면 regular 유지, 없으면 prospect/cancelled |

### 3.4 일괄 반영 — 효성 (사용자 결정: 효성은 CSV 업로드 시 통합)

- 효성 contracts CSV 업로드 → 매칭된 회원의 `hyosung_contract_status` 갱신 → **donor_type 재평가 hook**
- 효성 billings CSV 업로드 → donations 추가 → donor_type 재평가
- 효성 cancelled 상태 회원 → 재평가 시 prospect/cancelled 자동 이동

### 3.5 cron 자동 갱신 (안전망)

- `cron-donor-status-sync.ts` (KST 03:00) — 식별 SQL 4종 일괄 실행
- 즉시 반영이 누락된 케이스 (특이 상황·수동 변경) 매일 자동 보정

### 3.6 API

- `GET /api/admin-donor-regular-list` — 정기 후원자 + 채널별 KPI (CMS/토스 분리)
- `GET /api/admin-donor-prospect-list?subtype=onetime|cancelled|all` — 잠재 후원자 분류 조회
- `migrate-add-members-donor-type.ts` — 컬럼 추가 + 최초 1회 식별 실행

### 3.7 UI (placeholder → 본격)

- **정기 후원자 화면**: 회원 + 채널(토스/효성 뱃지) + 정기금액 + 다음 결제일 + 누적기간
- **잠재 후원자 화면**: 분류 탭(일시/중단/전체) + 마지막 후원일 + 재유치 액션(이메일/메모)

---

## 4. 단계 D — CSV 종합 검증 시스템 강화 (3~5h)

### 4.1 기능 확장 (현재 → 확장)

| 항목 | 현재 (작업 C #15) | 확장 |
|---|---|---|
| 효성 contracts | ✅ 적재·매칭 | + `hyosung_contract_status` 자동 동기화 |
| 효성 billings | ❌ 미지원 | + 신규 파서 (lib/hyosung-billings-parser.ts) |
| IBK 거래내역 | ✅ 적재·매칭 | + donor_type='prospect/onetime' 자동 갱신 |
| 토스 빌링 | (Phase 2) | + 즉시 반영(단계 C 적용)으로 흡수 |
| `members.donor_type` | ❌ 미존재 | + cron 자동 갱신 (단계 C 컬럼 활용) |

### 4.2 자동 상태 전이 hook

`pending_donations` 확정 시 자동으로:
- **정기 결제로 확정** → 회원 `hyosung_contract_status='active'` + `donor_type='regular'` + channels에 'hyosung' 추가
- **일시 결제로 확정** → `donations`에 추가 + `donor_type='prospect'` `prospect_subtype='onetime'`

### 4.3 종합 검증 대시보드 (cms-tbfa CSV 자동 매핑 화면 강화)

- **상단 KPI**: 정기 활성(CMS/토스 분리) / 잠재(일시/중단 분리) / 검증 alert 카운트
- **CSV 업로드 영역**: contracts·billings·IBK·토스 통합 (탭 또는 드롭다운)
- **자동 매칭 + 상태 전이 미리보기**: 확정 시 어떤 회원의 donor_type이 어떻게 바뀌는지 표시
- **검증 alert 패널**:
  - 정기→중단 자동 감지 (이번 주 N건)
  - 충돌 케이스 (같은 회원이 토스·효성 양쪽 cancelled인데 donations 있음 등)
  - 미매칭 일시 후원 건수

### 4.4 구현 단위
- D1: 효성 billings 파서 (신규 lib 추가)
- D2: cron-donor-status-sync (식별 SQL 자동화)
- D3: pending_donations 확정 → donor_type 동기화 hook
- D4: 대시보드 강화 (KPI + 검증 alert)

---

## 5. 의존성·머지 순서

```
단계 A (완료) ✅
  ↓
단계 B  통합 일반 회원 API + 후원 내역 탭     ← 단독 진행 가능
  ↓
단계 C  donor_type 컬럼 + 정기/잠재 화면     ← 토스 즉시 반영 hook 포함
  ↓
단계 D  CSV 종합 검증 강화                    ← C 컬럼 활용 + 자동 전이

D는 C 의존 (donor_type 컬럼 사용)
```

---

## 6. 작업 분리 (브랜치 제안)

| 단계 | 브랜치 | worktree |
|---|---|---|
| B | `feature/donor-step-b` | `../tbfa-mis-D` 신규 |
| C | `feature/donor-step-c` | B 머지 후 같은 worktree 또는 별도 |
| D | `feature/donor-step-d` | C 머지 후 |

또는 단일 `feature/donor-system` 브랜치 — 단계별 commit으로 분리.

---

## 7. 결정 사항 (사용자 합의 완료, 2026-05-10)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 통합 회원 API 소스 | **C** — admin-members 재사용 + source/donorType 필터 추가, 같은 DB 자동 동기화 |
| 2 | donor_type 저장 + 갱신 | **A 컬럼** + 토스 **즉시 반영** + 효성 **CSV 업로드 시 통합** + cron **안전망** |
| 3 | 정기 식별 | 토스 진행 중 OR 효성 'active' (둘 중 하나) — 직접 계좌이체 매월 케이스 없음 |
| 4 | 잠재 식별 + 표시 | 일시/중단 두 부류, **회원 상세 모달에 후원 내역 탭 추가** |
| 5 | CSV 종합 검증 위치 | **A** — 후원 관리 그룹 안 (현재 위치 유지) |
| 6 | admin·cms-tbfa 회원 화면 | **분리 유지 + 데이터 연동** (같은 DB, 다른 시각) |

---

## 8. 다음 단계 — 단계 B 시작 절차

1. 새 worktree 생성:
   ```bash
   git worktree add ../tbfa-mis-D feature/donor-step-b origin/main
   ```
2. 새 채팅 시작 (worktree-D 폴더에서)
3. 첫 메시지로 다음 복붙:

```
[마일스톤 #16 단계 B — 통합 일반 회원 실제 API + 회원 상세]

CLAUDE.md 자동 로드 + 다음 문서 읽고 작업 시작:
- PROJECT_STATE.md §4.6 (마일스톤 #16 인덱스)
- docs/milestones/2026-05-10-donor-system.md §2 (단계 B 전체)
- docs/issues/2026-05-10-cms-tbfa-demo-data.md (#BUG-2)
- public/js/cms-tbfa.js:60-90 (제거 대상 DEMO_*)
- netlify/functions/admin-members.ts (필터 확장 대상)

## 환경 검증 먼저
pwd → 끝이 tbfa-mis-D
git branch --show-current → feature/donor-step-b
git status → 깨끗
git fetch origin && git rebase origin/main

## 작업 범위
docs/milestones §2.2 작업 항목 B1~B9만.
다른 단계(C·D)는 별도 채팅.

## 금지
- lib/auth.ts, lib/admin-guard.ts, lib/hyosung-parser.ts: 변경 금지
- main 브랜치 직접 push 금지

## 완료 조건
1. cms-tbfa 통합 회원 탭에 진짜 회원 명단 표시 (DEMO_* 0)
2. 회원 클릭 → 상세 모달 + 후원 내역 탭 표시
3. 가입경로/후원 상태 뱃지 표시
4. PROJECT_STATE §4.6 진행률 갱신 + §6.6 #BUG-2 ✅ 표시 후 push
5. 메인 채팅에 "단계 B 완료, 머지 부탁" 보고

자, 환경 검증 결과부터 보고해줘.
```

---

## 9. 변경 이력

| 일시 | 내용 |
|---|---|
| 2026-05-10 | 설계 합의 완료, 본 문서 신설 |
