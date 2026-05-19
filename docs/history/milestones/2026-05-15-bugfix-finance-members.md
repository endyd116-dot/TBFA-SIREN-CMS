# 버그 픽스 라운드 — 재정 화면·회원·효성·검증·발송·WBS (15건)

> 작성: 2026-05-15 메인
> 계기: Phase 22 완결 후 라이브 점검에서 재정 화면 7개 전부 UI 깨짐 + 회원·효성·검증 버그 다수 발견
> **근본 원인**: C 검증이 매 라운드 "코드 정독·tsc·grep 정적 검증만" — 브라우저 실제 렌더링 검증 누락

---

## §-1 채팅 역할 분담

| 채팅 | 모델 | 워크트리 | 브랜치 | 담당 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | main | 머지·마이그·문서 |
| A | **Opus 4.7** (재정 화면 대량) | tbfa-mis-A | feature/bugfix-front | 🎨 재정 화면 깨짐·사이드바·api 노출·WBS 모달·효성/회원 대시보드 UI |
| B | Opus 4.7 | tbfa-mis-B | feature/bugfix-back | 🔧 효성/회원 집계 API·검증 대시보드·지출 API·발송 진행률·속도 |
| C | Opus 4.7 | tbfa-mis-C | (검증→자체fix) | 🔍 **라이브 검증 필수** — 브라우저 실제 렌더링 확인 |

> ★ C 트리거에 "코드 정독만 ❌ — 실제 브라우저에서 각 화면 열어 렌더링·동작 확인" 명시.

---

## §0 버그 15건 진단 종합 (Explore 2회 조사)

| # | 증상 | 근본 원인 | 담당 |
|---|---|---|---|
| 6 | 사이드바 "재정" CSS 깨짐 + 메뉴 구조 | `cms-menu-group` 구조 아닌 평면 리스트 | A |
| 6-1 | 워크스페이스 사이드바 자동 펼침 | 1뎁스 하나뿐인데 펼침 기본값 미설정 | A |
| 7 | 후원결제내역 UI 깨짐 | `cms-tbfa.js` 라우팅 `init()` 미호출 → 빈 섹션 | A |
| 8 | 수입현황 UI 깨짐 | 동일 (finance-income은 HTML 사전정의됐으나 CSS 점검 필요) | A |
| 9 | 후원 외 매출 클릭 무반응 | 라우팅 `load()`만 호출, `init()` 없음 → renderShell 안 됨 | A |
| 10 | 지출 관리 UI 깨짐 + 무한로딩 | `init()` 미호출 + API 실패 시 로딩 플래그 안 풀림 | A·B |
| 11 | 예산 관리 UI 깨짐 | 라우팅 init 검사 있으나 CSS 클래스 불일치 의심 | A |
| 12 | 재무 보고서 UI 깨짐 | 동일 | A |
| 13 | 통장거래내역 이상 | 동일 | A |
| 13-2 | 재정 메뉴 전반 로딩 느림 | 매 진입 시 풀 재조회 — 캐싱·쿼리 최적화 | B |
| 1 | 효성 대시보드 유족·후원회원 통계 미집계 | 통계 KPI 요소 자체가 없음 | A(UI)·B(집계) |
| 2 | 통합회원 출처 "기타"·효성회원 "비회원" | `admin-members.ts` signupSource enum/label 응답 누락, 후원상태 donations JOIN 필요 | A(표시)·B(API) |
| 3 | 검증 대시보드 무한로딩 | API 응답 키 불일치 (`renderDonationDashboard`) | B |
| 4 | 잠재후원자 "api is not defined" | `cms-tbfa.js` IIFE 스코프 — `api()`가 전역에 없음 | A |
| 14 | 발송작업 진행률 카운트 0 | `admin-send-job-progress` snake_case ↔ JS camelCase 불일치 | B |
| 15 | WBS 작업카드 모달 크기 출렁임 | 탭별 높이 차이로 모달 자동 리사이징, CSS 높이 미고정 | A |

---

## §1 사이드바 메뉴 구조 (#6, #6-1 — A)

### 1.1 1뎁스 메뉴 이름 변경 + 구조 (#6)

- "후원·재정 관리" → **"후원자 관리"**
- "재정" → **"재정 관리"**
- "재정 관리"를 정상 `cms-menu-group` 1뎁스로 만들고, 그 아래 재정 화면들(후원결제내역·수입현황·후원외매출·지출관리·예산관리·재무보고서·통장거래내역)을 **2뎁스 `cms-submenu`로**
- 2뎁스는 **기본 숨김** (접힘) — 클릭 시 펼침/숨김 토글
- "재정" 1뎁스의 깨진 CSS는 `cms-menu-group` 정상 구조로 바꾸면 해소

### 1.2 워크스페이스 사이드바 자동 펼침 (#6-1)

- 워크스페이스 진입 시 1뎁스가 하나뿐 → 그 그룹은 **자동 펼침을 기본값**으로

---

## §2 재정 화면 깨짐 (#7~#13 — A, #10·#13-2 일부 B)

### 2.1 라우팅 init() 호출 (핵심 — #7·#9·#10·#11·#12·#13)

`public/js/cms-tbfa.js` 탭 라우팅에서 재정 화면 7개 전부 **첫 진입 시 `init()` 호출 보장**:
```
// 현재 (donations·other-revenues·expenses): load()만 호출 → renderShell 안 됨
// 수정: finance-budget이 쓰는 패턴으로 통일
const sec = document.getElementById('page-XXX');
if (sec && !sec.firstElementChild) window.SIREN_XXX.init();
else window.SIREN_XXX.load();
```
- 7개 전부 동일 패턴 적용: donations·finance-income·other-revenues·expenses·finance-budget·finance-report·bank-transactions

### 2.2 CSS 클래스 점검 (#8·#11·#12·#13)

- 재정 화면 JS가 쓰는 CSS 클래스(`.panel` 등)가 cms-tbfa.html이 로드하는 CSS에 있는지 확인
- admin.html 전용 CSS를 쓰고 있으면 → cms-tbfa.html에 해당 CSS 추가하거나 클래스 교체
- A가 각 화면 브라우저로 열어 실제 깨진 부분 확인 후 수정

### 2.3 지출 관리 무한로딩 (#10)

- `admin-expenses.js`: API 실패 시에도 `renderShell()` 호출 + 로딩 플래그 해제
- B: `/api/admin-expense-categories-list`·`/api/admin-expense-list`가 404/에러 내는지 확인 (무한로딩의 서버측 원인)

### 2.4 재정 로딩 속도 (#13-2 — B)

- 재정 화면 매 진입 시 풀 재조회 → 응답 캐싱 또는 쿼리 최적화
- B가 재정 API들(pl-summary·budget-list·expense-list·revenue-list·bank-transactions-list) 응답 시간 점검 → 느린 쿼리 인덱스·집계 최적화

---

## §3 회원·효성 대시보드 (#1, #2)

### 3.1 효성 CMS 대시보드 재구성 (#1 — A UI + B 집계)

- 효성 CMS+ 화면에 **유족회원·후원회원 통계 KPI 영역 신규 추가** (현재 계약 매칭 건수만 있음)
- B: 효성 계약 데이터 ↔ members JOIN → `members.type='family'` 집계(유족회원), 후원 여부별(후원회원) 집계 API
- A: 효성 대시보드를 기존 메뉴구조·데이터에 맞게 재구성 (Swain "아예 재구성" 요청)

### 3.2 통합회원 출처·후원상태 (#2 — B API + A 표시)

- B: `admin-members.ts` 응답에 `signupSource` enum + `signupSourceLabel` 추가 (현재 `signupSourceId`만)
  - `SOURCE_CODE_TO_ENUM`·`SOURCE_CODE_TO_LABEL` 매핑 적용
- B: 효성에서 넘어온 회원의 후원 상태 — `donations` 테이블 JOIN으로 실제 후원중 여부 판정
  - donorType 컬럼 신규가 필요하면 마이그 함수 작성 (B 판단 — donations JOIN으로 해결되면 컬럼 추가 불필요)
- A: 통합회원 상단 대시보드에서 SIREN·효성·수기 출처별 카운트 정확히 표시 (현재 전부 "기타")

---

## §4 검증·잠재후원 (#3, #4)

### 4.1 검증 대시보드 무한로딩 (#3 — B)

- `admin-donation-dashboard.ts` 응답 구조 ↔ `cms-tbfa.js renderDonationDashboard()` 키 매칭 점검
- API 404/500 여부 + 응답 키 정합 + 로딩 플래그 해제

### 4.2 잠재후원자 api 미정의 (#4 — A)

- `cms-tbfa.js`가 IIFE라 내부 `api()`가 전역에 없음
- IIFE 안에서 `window._cmsApi = api;` 노출 (또는 잠재후원자 코드가 `window._cmsApi` 정상 참조하도록)
- 잠재후원자 관리 코드의 `(window._cmsApi || api)` 폴백이 작동하도록

---

## §5 발송·WBS (#14, #15)

### 5.1 발송작업 진행률 카운트 (#14 — B)

- `admin-send-job-progress.ts` 응답을 camelCase로 정규화: `{ totalRecipients, successCount, failureCount, pendingCount }`
- 또는 `admin-send-jobs.js`가 snake_case로 읽도록 — B가 응답 정규화 쪽으로 통일 권장

### 5.2 WBS 작업카드 모달 크기 고정 (#15 — A)

- `workspace-kanban.css` `.wk-modal-dialog`·`.wk-modal-body` — 모달 높이 고정
  - `.wk-modal-body { height: calc(90vh − 헤더 − 탭바); overflow-y: auto; }`
- 탭(개요·댓글·파일·AI 등) 전환 시 모달 외곽 크기 변동 없이 본문만 스크롤 — 자연스러운 전환

---

## §6 작업 분배

### A 작업 (feature/bugfix-front)
- §1 사이드바 (#6·#6-1)
- §2.1 라우팅 init() (#7·#9·#11·#12·#13) + §2.2 CSS 점검 (#8·#11·#12·#13)
- §2.3 지출 무한로딩 프론트 (#10)
- §3.1 효성 대시보드 UI 재구성 (#1) + §3.2 통합회원 출처 표시 (#2)
- §4.2 잠재후원자 api 노출 (#4)
- §5.2 WBS 모달 (#15)

### B 작업 (feature/bugfix-back)
- §2.3 지출 API 점검 (#10) + §2.4 재정 로딩 속도 (#13-2)
- §3.1 효성 유족·후원 집계 API (#1)
- §3.2 admin-members signupSource·후원상태 (#2)
- §4.1 검증 대시보드 API (#3)
- §5.1 발송 진행률 정규화 (#14)

### C 작업 (검증 — 라이브 필수)
- 전 15항목 **브라우저에서 실제로 열어** 렌더링·동작·데이터 확인

---

## §7 트리거

### §7.1 A 트리거 (feature/bugfix-front)

```
[메인 → A 채팅] 버그 픽스 — 재정 화면·사이드바·대시보드 UI·WBS 모달 — 🎨 프론트엔드

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일 읽기/수정·git·npm은 settings.json에 전부 허용됨.
  권한 질문 금지 — 바로 실행. 묻는 건 git push와 애매한 로직뿐.
- ★ 베이스는 반드시 git pull 후 main 최신

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료)" 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-A
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/bugfix-front

설계서: docs/milestones/2026-05-15-bugfix-finance-members.md

■ 1단계 — 사이드바 (§1)
- [ ] #6 "후원·재정 관리"→"후원자 관리", "재정"→"재정 관리" 이름 변경
- [ ] #6 "재정 관리"를 cms-menu-group 1뎁스 + 재정 화면 7개를 cms-submenu 2뎁스로,
      기본 숨김, 클릭 시 펼침/숨김 토글 (재정 1뎁스 CSS 깨짐 해소)
- [ ] #6-1 워크스페이스 진입 시 1뎁스 그룹 자동 펼침 기본값

■ 2단계 — 재정 화면 깨짐 (§2.1·§2.2)
- [ ] #7·#9·#11·#12·#13 cms-tbfa.js 라우팅 — 재정 화면 7개 전부 첫 진입 시
      init() 호출 보장 (finance-budget 패턴으로 통일: firstElementChild 검사)
- [ ] #8·#11·#12·#13 각 화면 브라우저로 열어 CSS 깨진 부분 확인·수정
      (admin.html 전용 CSS 쓰면 cms-tbfa.html에 추가하거나 클래스 교체)
- [ ] #10 admin-expenses.js — API 실패 시에도 renderShell 호출 + 로딩 플래그 해제

■ 3단계 — 대시보드 UI (§3)
- [ ] #1 효성 CMS+ 화면에 유족회원·후원회원 통계 KPI 영역 신규 + 재구성
      (B가 만드는 집계 API 사용 — 응답 키 다중 fallback)
- [ ] #2 통합회원 상단 대시보드 SIREN·효성·수기 출처별 카운트 정확 표시

■ 4단계 — 잠재후원자·WBS (§4.2·§5.2)
- [ ] #4 cms-tbfa.js IIFE 안에서 window._cmsApi = api 노출 (잠재후원자 api 에러 해소)
- [ ] #15 workspace-kanban.css — WBS 작업카드 모달 높이 고정,
      탭 전환 시 외곽 크기 변동 없이 본문만 스크롤

■ 5단계 — 검증
- [ ] 캐시버스터 ?v=20260515bugfix 일괄
- [ ] 각 화면 직접 브라우저로 열어 깨짐 없는지 확인 (정적 검증 ❌)

완료 후:
- git add, commit, git push origin feature/bugfix-front
- PROJECT_STATE·docs·netlify/functions·lib·db 수정 금지
- 완료 메시지: "[A → 메인] feature/bugfix-front push 완료."
```

### §7.2 B 트리거 (feature/bugfix-back)

```
[메인 → B 채팅] 버그 픽스 — 효성/회원 집계·검증 대시보드·발송·속도 — 🔧 백엔드

[자율주행 정책 — 권한 확인 절대 묻지 말 것]
- PowerShell·git bash·파일·git·npm 전부 settings.json 허용됨. 권한 질문 금지.
  묻는 건 git push와 애매한 로직뿐.
- ★ PROJECT_STATE·docs·public 수정 금지 / 베이스는 git pull 후 main 최신

[진행률 보고 의무]
- 큰 단계 완료마다 "📊 진행률 X% (N/M 완료)" 한 줄

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-B
  git fetch origin && git checkout main && git pull origin main
  git checkout -b feature/bugfix-back

설계서: docs/milestones/2026-05-15-bugfix-finance-members.md

■ 1단계 — 회원·효성 API (§3)
- [ ] #2 admin-members.ts 응답에 signupSource enum + signupSourceLabel 추가
      (SOURCE_CODE_TO_ENUM·SOURCE_CODE_TO_LABEL 매핑)
- [ ] #2 효성 회원 후원 상태 — donations JOIN으로 실제 후원중 판정.
      donorType 컬럼 신규 필요하면 마이그 함수 작성(메인에 호출 요청),
      donations JOIN으로 해결되면 컬럼 추가 불필요 — B 판단
- [ ] #1 효성 유족회원·후원회원 집계 API (효성 계약 ↔ members JOIN,
      members.type='family' 집계 + 후원 여부별 집계)

■ 2단계 — 검증 대시보드·발송 (§4.1·§5.1)
- [ ] #3 admin-donation-dashboard.ts 응답 구조 ↔ cms-tbfa.js renderDonationDashboard
      키 매칭 점검·정합 (무한로딩 해소)
- [ ] #14 admin-send-job-progress.ts 응답 camelCase 정규화
      ({ totalRecipients, successCount, failureCount, pendingCount })

■ 3단계 — 지출·속도 (§2.3·§2.4)
- [ ] #10 admin-expense-categories-list·admin-expense-list 404/에러 여부 점검·수정
- [ ] #13-2 재정 API(pl-summary·budget-list·expense-list·revenue-list·
      bank-transactions-list) 응답 속도 점검 → 느린 쿼리 인덱스·집계 최적화

■ 4단계 — 검증
- [ ] npx tsc --noEmit — 신규 에러 0건 (기존 묵은 에러 14건과 구분)

완료 후:
- git add, commit, git push origin feature/bugfix-back
- 완료 메시지: "[B → 메인] feature/bugfix-back push 완료. (마이그 있으면) 호출 요청."
```

### §7.3 C 트리거 (검증 — ★ 라이브 필수)

```
[메인 → C 채팅] 버그 픽스 검증 — 🔍 ★ 브라우저 라이브 검증 필수

베이스: main (B·A 머지 + 마이그(있으면) 호출 완료 후)
설계서 §0 버그 15건

[자율주행 정책][진행률 보고] (표준 — 권한 질문 금지)

★★★ 이번 검증은 코드 정독·tsc·grep 정적 검증만으로는 ❌.
    재정 화면 7개가 깨진 채 머지된 게 "코드 정독만 한 검증" 때문이었음.
    반드시 https://tbfa.co.kr/cms-tbfa.html 에 실제 로그인해
    각 화면을 브라우저로 열어 렌더링·클릭·데이터 로딩을 눈으로 확인할 것.

워크트리:
  cd C:\Users\Administrator\Desktop\작업\dev\tbfa-mis-C
  git fetch origin && git checkout main && git pull origin main

검증 항목 (설계서 §0의 15건 전부 — 각각 브라우저에서 실제 확인):
- 사이드바: 재정 관리 1뎁스+2뎁스 펼침/숨김, 워크스페이스 자동 펼침
- 재정 화면 7개: 후원결제내역·수입현황·후원외매출·지출관리·예산관리·
  재무보고서·통장거래내역 — 클릭 시 정상 렌더·데이터 로딩
- 효성 대시보드 유족·후원회원 통계 / 통합회원 출처별 카운트
- 검증 대시보드 로딩 / 잠재후원자 정상 / 발송 진행률 카운트 / WBS 모달 크기 고정

BUG 발견 시 fix/bugfix-round-bugs 브랜치 자체 fix.
완료 메시지: "[C → 메인] 버그 픽스 검증 완료. PASS X / FAIL Y. BUG N건."
```

---

## §8 리스크·주의

- **C 라이브 검증 필수**: 이번 라운드의 존재 이유. 정적 검증만으로 또 통과시키면 같은 사고 반복
- **재정 화면 라우팅**: 7개 전부 동일 패턴 통일 — 하나라도 빠지면 그 화면만 깨짐
- **donorType 컬럼**: B가 donations JOIN으로 해결 가능한지 먼저 판단 — 불필요한 마이그 회피
- **사이드바 구조 변경**: cms-tbfa.html 사이드바 + cms-tbfa.js 토글 로직 동시 수정 — 다른 메뉴 그룹 회귀 점검
- **효성 대시보드 재구성**: Swain "아예 재구성" — A가 효성 데이터·메뉴구조 보고 적정 재구성, 과하면 메인에 확인
- **기존 tsc 묵은 에러 14건**: 이 라운드와 무관, 신규 에러만 카운트

---

## §9 메타 — C 검증 정책 변경

이번 사고(재정 화면 7개 깨진 채 머지)의 근본 원인은 C가 매 라운드 "코드 정독·tsc·grep 정적 검증"만 한 것.
→ **앞으로 UI가 있는 라운드의 C 검증은 브라우저 라이브 렌더링 확인을 필수**로. 메모리 `feedback_verification_rounds`에 반영.
