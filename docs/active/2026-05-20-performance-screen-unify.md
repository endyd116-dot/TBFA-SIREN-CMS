# 성과관리 화면 통합 — 진단 + 통합안 (설계 대기)

> 작성: 2026-05-20 / 메인 (진단 단계·설계 전)
> 영역: 통합 CMS 성과관리 (마일스톤·결산·급여 연동)
> 상태: **설계 확정·구현 중** (2026-05-20 Swain 합의 완료). 진단은 PART 1 보존, 확정 설계는 **PART 2**(이 문서 하단).
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
| 2026-05-20 | 사전 정독 + 정의 API 전수 grep 완료·Swain 4결정 합의·**PART 2 설계 확정** |

---

# PART 2 — 설계 확정 (Swain 합의 2026-05-20)

> 전수 grep·사전 정독으로 PART 1 진단을 검증한 결과, **회귀면이 당초 우려보다 작음**을 확인:
> 결산·급여 백엔드는 HTTP API가 아니라 `milestone_definitions` **테이블을 직접** 읽는다 →
> 어느 프론트 API를 쓰는지는 결산·급여 집계에 영향 없음. 바뀌는 실제 동작은 "정의 삭제: 하드→소프트"
> 뿐이고, 이는 결산이 참조하는 정의를 보존하므로 **오히려 안전**.

## §0 요구사항 확정 (Swain 결정 테이블)

| 결정 항목 | 선택 | 구현 영향 |
|---|---|---|
| 역할 배정 대상 | **운영자 + 어드민** (`operator_active=TRUE OR role IN admin/super`) | 검토 화면 기준 유지 + 저장 가드 broaden(잠재버그 fix) |
| 탭 구성 | **6탭 통합** | 역할 배정 + 직원별 마일스톤을 한 탭으로 |
| 단계 분할 | **3단계** — 각 단계 push 후 Swain 라이브 검증 | §5 |
| 설정 화면 | **즉시 완전 제거** | `admin-milestone-settings.html`/`.js` + `admin-milestone-definitions.ts` 삭제 |
| 흡수 대상 | `admin-milestones.html` (검토 화면) | 결산·AI·CSV가 이미 여기 |
| 정의 API | `milestone-definitions`로 통일 | `admin-milestone-definitions` deprecate→삭제 |
| DB/마이그 | **없음** | 순수 화면·라우팅 통합 |

## §1 영향 범위 (전수 grep 확정 — 누락 0)

### 정의 API 2개 차이
| 항목 | `admin-milestone-definitions` (설정 전용·삭제 예정) | `milestone-definitions` (통일 기준) |
|---|---|---|
| 호출처 | `admin-milestone-settings.js` 1곳뿐 | `admin-milestones.js`(검토) + `workspace-milestones.js`(직원 본인) |
| 삭제 | 하드(`DELETE FROM`) ⚠️ | **소프트(`is_active=FALSE`)** ✅ FK 보존 |
| 조회 | 전체(super) | 역할 필터·비-super 본인 강제(직원 경로) |
| 수정 | PUT(body.id) **+ 어드민 알림** | PATCH(/:id) — 알림 ❌ (→ 이식 필요) |
| 이력 조회 | `?history=1` (UI 호출처 없음·미사용) | 없음 (이식 불필요) |
| 라우팅 | 와일드카드 ❌ | 와일드카드 ✅ |

### 역할 배정 대상 범위 (확정)
- 설정 "직원 역할 배정" GET `admin-milestone-role-assign` → `members WHERE type='admin' AND status='active'`
- 검토 "담당 역할 설정" GET `milestone-members` → `members WHERE operator_active=TRUE OR role IN (admin,super_admin)` ← **채택**
- 저장은 둘 다 PUT `admin-milestone-role-assign`. **잠재버그**: PUT의 `WHERE ... AND type='admin'` → operator_active인 일반회원(type≠admin)은 저장 무반응. Stage 1에서 fix.

### iframe 라우팅 4곳 (Stage 3 정리 대상)
1. 사이드바: `cms-tbfa.html:551-552` (성과관리 설정 + 비매출 검토 → 1개로)
2. section/iframe: `cms-tbfa.html:2236-2243` (page-milestone-settings 삭제 / page-milestone-review 유지·iframe 해시 제거)
3. tabLabels: `cms-tbfa.js:296-297`
4. 탭 분기: `cms-tbfa.js:388-389`

## §2 백엔드 변경 명세 (Stage 1)

**B-1. `netlify/functions/milestone-definitions.ts` PATCH — 어드민 알림 이식**
- PATCH 성공 직후, 변경된 정의명으로 모든 활성 어드민에게 알림(`notifyMany`). `admin-milestone-definitions.ts:193-206` 패턴 그대로 이식. fire-and-forget(`.catch(()=>{})`).
- 응답 구조 불변: `{ ok:true, data:{ milestone } }`.

**B-2. `netlify/functions/admin-milestone-role-assign.ts` PUT — 대상 범위 broaden**
- 현재: `UPDATE members SET milestone_role=... WHERE id=${memberId} AND type='admin'`
- 변경: `WHERE id=${memberId} AND (operator_active=TRUE OR role IN ('admin','super_admin'))`
- 효과: 운영자 활성 일반회원도 역할 저장 반영(목록 범위와 일치). 임의 일반회원에는 여전히 미반영(가드 유지).
- GET도 목록 범위를 검토 기준으로 통일할지 검토 → **GET은 그대로 두고**, 통합 화면은 `milestone-members`(이미 운영자+어드민)를 목록 소스로 사용하므로 admin-milestone-role-assign GET은 통합 화면에서 미사용(설정 화면과 함께 자연 정리). PUT만 fix.

**B-3. (Stage 3) `admin-milestone-definitions.ts` 삭제** — 유일 호출처(설정 화면) 제거 후 dead code. 삭제 전 전수 grep 재확인.

## §3 화면 설계 (Stage 2 — 통합 6탭)

대상: `public/admin-milestones.html` + `public/js/admin-milestones.js`

```
[성과관리]  (cms-tbfa 단일 메뉴)
┌─ 1 마일스톤 정의      defs        (milestone-definitions·activeOnly=0로 비활성 포함 표시)
├─ 2 분기 관리          quarters    (변경 없음)
├─ 3 역할 카탈로그 관리  rolecat    ★신규 — 설정 rolemgmt 이식 (milestone-roles CRUD)
├─ 4 직원 역할·마일스톤  staff      ★통합 — 역할배정 + 직원별 정의뷰 (milestone-members + milestone-definitions)
├─ 5 비매출 검토        nonrevenue  (변경 없음)
└─ 6 결산 승인·지급     settlements (변경 없음·맨 뒤로 재배치)
```

### 탭 매핑 (현재 → 통합)
| 통합 탭 | 출처 | 비고 |
|---|---|---|
| 1 마일스톤 정의 | 검토 defs | + 비활성 표시·활성/비활성 토글(소프트삭제 가시화) |
| 2 분기 관리 | 검토 quarters | 그대로 |
| 3 역할 카탈로그 관리 | **설정 rolemgmt 이식** | milestone-roles GET/POST/PATCH/DELETE |
| 4 직원 역할·마일스톤 | 검토 roles + **설정 bymember 이식** | 멤버 표 1개에 [역할 드롭다운+저장] + [정의수·매출수·상세] 통합. 상세 모달 토글은 milestone-definitions PATCH{isActive} |
| 5 비매출 검토 | 검토 nonrevenue | 그대로 |
| 6 결산 승인·지급 | 검토 settlements | AI 인사이트·CSV 포함·맨 뒤 |

### 탭 4 상세 (역할 배정 + 직원별 마일스톤 한 화면)
- 멤버 목록 소스: `milestone-members` GET (운영자+어드민) — 검토 화면이 이미 사용 중.
- 각 행: 이름 / 이메일 / 시스템 역할 / **성과 역할 드롭다운(배정)** + 저장 / **정의수·매출수** / **상세** 버튼.
- 상세 → 모달: 해당 멤버 성과 역할의 정의 일람 + 활성/비활성 토글(milestone-definitions PATCH `{isActive}`) + 편집(정의 모달 위임).
- 정의 소스: `milestone-definitions?activeOnly=0` (비활성 포함, super는 role 무관 전체).

## §4 검증 시나리오 (단계별)

### Stage 1 (백엔드)
| Q | 시나리오 | 기대 |
|---|---|---|
| S1-Q1 | 검토 화면에서 정의 수정·저장 | 저장 성공 + 모든 어드민에게 "마일스톤 정의 변경" 알림 도착 |
| S1-Q2 | 운영자로 활성화된 일반회원에게 성과 역할 저장 | 실제 반영(새로고침 후 유지) |
| S1-Q3 | 임의 일반회원(운영자 아님) id로 역할 저장 시도 | 미반영(가드 유지) |
| S1-Q4 | 기존 어드민 역할 저장 회귀 | 정상 |

### Stage 2 (프론트 6탭)
| Q | 시나리오 | 기대 |
|---|---|---|
| S2-Q1 | 통합 화면 6탭 모두 진입 | 무한로딩 없이 데이터 표시 |
| S2-Q2 | 역할 카탈로그 등록·편집·비활성·재활성 | 정상 + 드롭다운 즉시 반영 |
| S2-Q3 | 탭4 멤버 역할 배정 저장 | 정상 반영 |
| S2-Q4 | 탭4 상세 모달 → 정의 활성/비활성 토글 | 소프트 토글 반영·목록 갱신 |
| S2-Q5 | 마일스톤 정의 탭 비활성 정의 표시·토글 | 비활성 정의 보임·재활성 가능 |
| S2-Q6 | 비매출 검토·결산·AI·CSV 회귀 | 정상 |

### Stage 3 (메뉴·제거)
| Q | 시나리오 | 기대 |
|---|---|---|
| S3-Q1 | cms-tbfa 사이드바 | 성과관리 메뉴 1개(설정 사라짐) |
| S3-Q2 | 성과관리 메뉴 진입 | 통합 화면 6탭 |
| S3-Q3 | `/admin-milestone-settings.html` 직접 접근 | 제거됨(404 또는 안내) |
| S3-Q4 | 정의/분기/역할/비매출/결산/급여 집계 전체 회귀 | 정상 |

## §5 3단계 작업 분할 (각 단계 push 후 Swain 라이브 검증)

- **Stage 1 — 백엔드 안전 (additive + bugfix)**: B-1(알림 이식)·B-2(역할 저장 범위 fix). 설정·검토 화면 둘 다 살아있는 상태. tsc 통과 후 push → S1-Q1~Q4 검증.
- **Stage 2 — 프론트 6탭 통합**: 역할 카탈로그·직원별 마일스톤을 검토 화면으로 이식, 탭4 통합, 정의 탭 비활성 표시. 캐시버스터(`admin-milestones.js?v=`) 갱신. push → S2-Q1~Q6 검증.
- **Stage 3 — 메뉴 2→1 + 완전 제거**: iframe 4곳 정리, `admin-milestone-settings.html`/`.js`·`admin-milestone-definitions.ts` 삭제(삭제 전 grep 재확인), 메뉴얼·명세·문서 갱신. push → S3-Q1~Q4 검증 → 라운드 종결.

각 단계는 **이전 단계 검증 PASS 후** 착수. Stage 2/3은 Stage 1 머지 기준.

## §6 회귀·신중 체크리스트 (착수·종료 시 점검)

- [ ] 정의 API 통일: `admin-milestone-definitions` 호출처가 설정 화면뿐임을 삭제 직전 재grep (AI 도구·cron 포함 0건 확인)
- [ ] 소프트삭제 전환: 정의 "삭제"가 결산 참조를 끊지 않음(is_active=false 보존) 확인
- [ ] 역할 저장 범위 broaden 시 임의 일반회원 차단 가드 유지
- [ ] 캐시버스터: `admin-milestones.js`·`cms-tbfa.js` 변경 시 `?v=` 갱신
- [ ] iframe 4곳 동기(사이드바·section·tabLabels·분기) — 한 곳 누락 시 404
- [ ] `MilestoneRoles` 헬퍼(sessionStorage 캐시) 무효화 호출 유지(역할 카탈로그 변경 시)
- [ ] 무한로딩 근본 원인(상태 변수 공유)은 통합 화면 구조에 없음 + 버그 화면 제거로 소멸

## §7 라운드 마감 체크리스트 (release_checklist 15 중 해당)

- [ ] 메뉴얼: `manual-admin.html:851` `/admin-milestone-settings.html` 참조 → 통합 화면으로 갱신
- [ ] AI 학습 자료: `ai-training-cms*.jsonl`에 "성과관리 설정/비매출 검토 2메뉴" 언급 시 "성과관리 1메뉴"로 갱신
- [ ] 명세 마스터: `docs/specs/phase24·26·28`의 정의 API 2개 단서에 통일 주석
- [ ] PROJECT_STATE.md §2·§3 + HANDOFF §7.6 종결 반영
- [ ] iframe 라우팅 4곳(항목 9) — Stage 3 핵심
- [ ] 권한 매트릭스: 신규 API 없음(기존 super_admin 가드 유지) — 해당 없음
- [ ] schema·마이그: 없음 — 해당 없음
- [ ] cron·환경변수·CSV/PDF·알림 신규: 없음(알림은 기존 카테고리 재사용) — 해당 없음
