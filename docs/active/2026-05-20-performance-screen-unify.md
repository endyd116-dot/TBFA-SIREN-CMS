# 성과관리 화면 통합 — 진단 + 통합안 (설계 대기)

> 작성: 2026-05-20 / 메인 (진단 단계·설계 전)
> 영역: 통합 CMS 성과관리 (마일스톤·결산·급여 연동)
> 상태: **진단 완료·설계 대기**. 새 메인 세션이 본 문서 정독 후 Swain과 범위 합의 → 8섹션 설계서 작성 → 단계 분할 구현.
> ⚠️ **매우 신중 의무**: 마일스톤 정의·결산·급여까지 연동. 회귀 위험 큼. Swain 명시 지시.

---

## §0 배경

통합 CMS → 운영 관리에 성과관리 메뉴가 **2개**다.
- **성과관리 설정** → `admin-milestone-settings.html`
- **비매출 검토** → `admin-milestones.html#nonrevenue`

둘 다 성과관리(마일스톤 기반)인데 **별도 파일·별도 메뉴**라 기능이 겹치고, 일부는 **같은 데이터를 양쪽에서 따로 수정**하는 위험 상태. Swain 통합 요청.

---

## §1 진단 결과 — 겹침 (Explore 전수 조사)

| 기능 | 성과관리 설정 | 비매출 검토 | 상태 |
|---|---|---|---|
| **마일스톤 정의** | ✓ CRUD (`/api/admin-milestone-definitions`) | ✓ CRUD (`/api/milestone-definitions`) | 🔴 완전 중복·**API조차 서로 다름** |
| **분기 관리** | ✓ CRUD (`/api/milestone-quarters`) | ✓ CRUD (`/api/milestone-quarters`) | 🔴 완전 중복 (같은 API 양쪽) |
| **역할 배정** (직원에게 SM/PM/SI) | "직원 역할 배정" 탭 (`/api/admin-milestone-role-assign`) | "담당 역할 설정" 탭 (`/api/admin-milestone-role-assign`) | 🟡 **사실상 동일** (Swain 확인·같은 API·대상만 다름) |
| 역할 카탈로그 관리 (역할 자체 CRUD) | "대상 역할 관리" 탭 (`/api/milestone-roles`) | — | 🟢 설정 고유 |
| 직원별 마일스톤 일람·토글 | "직원별 마일스톤" 탭 | — | 🟢 설정 고유 |
| 비매출 검토 (4단계 승인·금액 결정) | — | "비매출 검토" 탭 (`/api/admin-milestone-nonrevenue`) | 🟢 검토 고유 |
| 결산 승인·지급·AI 인사이트·CSV | — | "결산 승인" 탭 (`/api/admin-milestone-settlement`) | 🟢 검토 고유 |

### 핵심 위험 🔴
1. **마일스톤 정의 2중 관리 + API 2개**: `admin-milestone-definitions`(설정) vs `milestone-definitions`(검토). 같은 테이블(`milestone_definitions`)을 다른 경로로 CRUD → 운영자 혼란·검증 2배·불일치 위험.
2. **분기 관리 2중 관리**: 같은 API를 양쪽에서 CRUD.
3. **역할 배정 사실상 동일**: 같은 API(`admin-milestone-role-assign`)·대상만 다름. Swain "사실상 똑같다" 확인.

### 데이터 테이블 공유
| 테이블 | 설정 | 검토 | 공유 |
|---|---|---|---|
| `milestone_definitions` | ✓ | ✓ | 공유 (다른 API) |
| `milestone_roles` | ✓ CRUD | ✓ 읽기 | 공유 (일방향) |
| `milestone_quarters` | ✓ | ✓ | 공유 |
| 역할 배정 (members + 배정) | ✓ | ✓ | 공유 |
| `non_revenue_achievements` | — | ✓ | 검토 전용 |
| `quarterly_settlements` | — | ✓ | 검토 전용 |

---

## §2 통합안 — "성과관리" 단일 화면 (6탭)

두 메뉴를 하나로 합치되 **고유 기능은 전부 보존**.

```
[성과관리]  (cms-tbfa 메뉴 1개)
├ 1. 마일스톤 정의       ← 중복 제거 (한 곳·API 통일)
├ 2. 분기 관리           ← 중복 제거 (한 곳)
├ 3. 역할 카탈로그 관리   ← 설정에서 이동
├ 4. 직원 역할·마일스톤   ← 설정의 "직원 역할 배정" + "직원별 마일스톤" 합침 (검토의 "담당 역할 설정"과 중복이라 하나로)
├ 5. 비매출 검토         ← 검토 유지
└ 6. 결산 승인·지급      ← 검토 유지 (AI 인사이트·CSV 포함)
```

워크플로우가 좌→우로 자연: **설정(정의·역할·분기) → 검토(비매출) → 결산(승인·지급)**.

---

## §3 통합 방식 (추천)

- 기능이 더 많은 **`admin-milestones.html`(비매출 검토)로 흡수** — 결산·AI·CSV가 이미 여기 있음
- 설정 화면 고유 탭(역할 카탈로그·직원별 마일스톤)을 이쪽으로 이동
- **마일스톤 정의 API 통일** — `admin-milestone-definitions` vs `milestone-definitions` 중 하나로 (사용처 전수 grep 후 신중 정리)
- **역할 배정 탭 단일화** — 두 화면의 동일 기능을 하나로 (대상 범위 차이 검토)
- cms-tbfa 메뉴 2개 → 1개("성과관리"), iframe 라우팅 정리 (사이드바·section·tabLabels·탭 분기 4곳)
- `admin-milestone-settings.html`은 흡수 후 제거 또는 리다이렉트

---

## §4 신중 검토 의무 (Swain 명시 — "아주 신중하게")

통합 전 **반드시** 전수 점검:
1. **마일스톤 정의 API 2개 사용처 전수 grep** — `admin-milestone-definitions`·`milestone-definitions` 양쪽 호출하는 프론트·다른 함수 모두. 통일 시 누락 0.
2. **결산·급여 연동 회귀** — 마일스톤 정의 변경이 `quarterly_settlements`·`payroll`까지 흐름. 정의 API 통일 시 결산 집계·급여 영향 점검.
3. **진행률 대시보드·매출 입력·AI 자동 매칭** — 마일스톤 정의·역할 참조하는 모든 곳.
4. **역할 배정 대상 범위 차이** — 설정(모든 어드민) vs 검토(운영 멤버) 대상이 정말 같은지·합쳐도 되는지 확인.
5. **단계 분할** — 한 번에 다 하지 말 것. 예: ① 마일스톤 정의 API 통일 → 검증 ② 분기 통일 → 검증 ③ 탭 이동·메뉴 통합 → 검증 ④ 설정 화면 제거. 각 단계 회귀 PASS 후 다음.
6. **사전 정독** (CLAUDE.md §9.1.9): `db/schema.ts`(milestone_* 테이블)·`lib`·기존 API 본문 전후 정독.

---

## §5 알려진 버그 (통합 시 함께 fix)

- **"직원 역할 배정" 탭 무한로딩** (성과관리 설정·2026-05-20 Swain 발견): 화면 진입 시 로딩이 끝나지 않음. 통합 시 원인 진단 (API 응답·응답 키·권한 가드 등) 포함.

---

## §6 다음 단계 (새 메인 세션)

1. 본 문서 + HANDOFF §7.6 정독
2. CLAUDE.md §9.1.9 사전 정독 (schema·lib·두 화면 API 본문)
3. 마일스톤 정의 API 2개 사용처 전수 grep → 통일 방향 확정
4. Swain과 통합 범위·단계 합의 (AskUserQuestion)
5. 8섹션 설계서 작성 (`docs/active/`) → 단계 분할 구현 → 각 단계 회귀 검증
6. 무한로딩 버그 원인 진단 포함

---

## §7 갱신 이력
| 시각 | 변경 |
|---|---|
| 2026-05-20 | 진단 완료·통합안·신중 검토 의무·무한로딩 버그 기록 (설계 대기) |
