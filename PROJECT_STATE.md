# PROJECT_STATE.md — SIREN 작업 상태 (휘발성)

> **목적**: "지금 어디까지 왔는지·다음 뭐 할지" 한 화면.
> **자동 로드 X** — 메인 채팅 시작 시 명시적으로 정독.
> **갱신 의무**: 라운드 종결·진행 상태 변경 시 즉시 갱신 후 push.
> **이전 본문(2026-05-19까지 누적 로그)**: [`docs/history/state-2026-05-19-archive.md`](docs/history/state-2026-05-19-archive.md) (385줄·archive 보존)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 이름 | **SIREN (싸이렌)** — 교사유가족협의회 통합 NPO 플랫폼 |
| 라이브 URL | <https://tbfa.co.kr> (공식) / <https://tbfa-siren-cms.netlify.app> (Netlify 기본) |
| 베이스 브랜치 | `main` |
| 단일 최신 인수인계 | [`docs/rules/HANDOFF.md`](docs/rules/HANDOFF.md) |
| 문서 구조 진입점 | [`docs/README.md`](docs/README.md) — 4영역 분리(rules·specs·active·history) |

상세 스택·환경변수·폴더 구조는 [`CLAUDE.md`](CLAUDE.md) §1~5 참조.

---

## 2. 현재 상태 (2026-05-21)

### 🏁 급여 고도화 정식 종결 (2026-05-21)
- 세전까지였던 급여 → **직접편집·조정라인·법정공제·실수령·지급확정(PAID)·계산기준 설정·수정이력**까지 확장.
- Stage1 `00f6140`+`87bb7eb`(스키마) → Stage2 `ff48c18`(백엔드) → Stage3 `a30c23f`(프론트). 3단계 머지 + Swain 라이브 검증 완료.
- 직원 마이페이지·PDF·CSV에 공제·실수령 노출, PAID 후에도 조회 유지.
- 종결 문서 → `docs/history/milestones/2026-05-20-payroll-enhance.md`.

### 🏁 성과관리 화면 통합 정식 종결 (2026-05-21)
- 통합 CMS 운영 관리 **성과관리 설정 + 비매출 검토 2메뉴 → 단일 "성과관리" 6탭** 통합.
- 마일스톤 정의 단일 API(`milestone-definitions`)·소프트삭제로 결산 참조 보존. 중복 API(`admin-milestone-definitions.ts`)·옛 설정 화면(`admin-milestone-settings.html`/`.js`) 완전 제거. DB/마이그 변경 0.
- Stage1 `76aff40` → Stage2 `18df0be`+`2dcbcfb` → Stage3 `4816e03` → 후속 `11105ad`(메뉴명)·`e715fb0`(감사 갭 fix).
- "직원 역할 배정" 무한로딩 버그: 옛 화면 제거로 소멸.
- 종결 문서 → `docs/history/milestones/2026-05-20-milestone-screen-unify.md` (PART 3 종결 요약).

### 🏁 R39 (역할 동적 CRUD + Admin UX 통합) 정식 종결
- **Stage 1~8 전부 머지 + 라이브 검증(메인 직접) 15/15 PASS**
- 라이브 검증 중 BUG 2건 발견·즉시 fix: ① tsc narrowing 사전 5건(런타임 0) ② att deviceType 미저장
- 메뉴얼 2종(manual.html·manual-admin.html) + AI 학습 자료 300문항 통합 완료 (C 작업)
- 설계서 → `docs/history/milestones/2026-05-20-r39-roles-and-ux.md` archive
- 라운드 종결 체크리스트 15가지 메모리 정식 등록 (`release_checklist.md`)

### 🏁 명세 정합 시리즈(R29~R37) 공식 종결
- **7라운드 누적**: 65+건 명세 정합 fix + R36 부가 5건 + R37 급여 통합
- **검증 합산**: E2E 12/12 + R37 Q10/10 + R36 회귀 8/8 + R35 P1·P2 23/23 ALL PASS·BUG 0건
- **정합도 v2**: 근태 **93.4%** / 성과 **96.7%** / 평균 **95.1%**

### 🟢 운영 시작 공식 선언
근태관리 + 성과관리 + 급여 통합 + 역할 동적 CRUD + Admin UX 시스템 — 즉시 운영 시작 가능.

### 📁 문서 4영역 분리 정착
- `docs/rules/` — 운영·작업 규칙
- `docs/specs/` — 명세 마스터 7개
- `docs/active/` — 진행 중 라운드 (현재 비어있음)
- `docs/history/` — 완료 히스토리 (R39 설계서 포함)
- `docs/manual/` — 사용자/AI 학습 자료 (메뉴얼 단편 + 300문항 jsonl·R39 통합)

---

## 3. 진행 중 작업

### 현재 진행 트랙 (2026-05-21)
| 트랙 | 상태 | 다음 |
|---|---|---|
| **급여 고도화** (편집·조정·공제·실수령·PAID·계산기준·이력) | 🟢 **종결** — 3단계 머지 + Swain 라이브 검증 완료 | 종결 문서 `docs/history/milestones/2026-05-20-payroll-enhance.md` |
| **근태 연동 갭 수정** (G1 결재단절·G2 통계·G3 캘린더·G4 라벨) | 🟡 머지 `a189fe9`(c2a4fa2)·메인 코드검증 PASS | Swain 라이브 검증 → 종결. 설계 `docs/active/2026-05-20-att-gap-fix.md` |
| **성과관리 화면 통합** | 🟢 종결(§2) | — |

---

### main HEAD: R39 정식 종결 + 메뉴얼 통합 직후

| 작업 | 채팅 | 상태 |
|---|---|---|
| **R39 통합 라운드 8단계** | B+메인 | 🟢 **정식 종결** — Stage 1~8 머지 + 라이브 검증 15/15 PASS + BUG 2건 fix |
| **사용자 메뉴얼 + AI 학습 자료 300문항** | C+메인 | 🟢 **통합 완료** — manual.html·manual-admin.html + jsonl 300문항 main 안착 |
| **Netlify 사고** | 외부 | 🟢 복구 완료 |

### 🚀 다음 라운드 후보 (Swain 결정 대기)
- **R40 PG 전환 (토스 → KICC)** — `docs/kicc.md` 정독 완료·옵션 A(듀얼 PG 점진 전환) 추천
- 메뉴얼 R39 기능 본문 갱신 (현재 '예정' 표기 → 실제 안내)
- Netlify 배포 시간 단축·RAG 인프라 구축

### R39 진행 상세 (Stage 1~8 모두 main 머지 완료)
- ✅ Stage 1: milestone_roles 테이블·시드 SM/PM/SI
- ✅ Stage 2: 역할 카탈로그 API + 백엔드 검증 동적화
- ✅ Stage 3: 프론트 라벨 동적화 + 역할 관리 UI (5번째 탭)
- ✅ Stage 4: R38 선완료로 스킵 (사람별 마일스톤·안내 박스 — R38 머지로 흡수)
- ✅ Stage 5: 실시간 출퇴근 + 카카오 지도 + PC 위치 + R38 월별 표 회귀 fix
- ✅ Stage 6: 워크툴 상단 출퇴근 버튼 + 상태별 라벨 + visibilitychange 동기화
- ✅ Stage 7: 휴가 수동 CRUD + 어드민 출퇴근 양방향 수정 + 이력 2테이블 + device_type 컬럼 (마이그 호출 + schema 활성화 + 파일 삭제 완료)
- ✅ Stage 8: 비매출 검토 화면(5번째 탭 + 4가지 액션) + 워크스페이스 로딩 fix(병렬화·성과 ~200ms·근태 ~600ms 단축) + B 자체 회귀 8/8 PASS

### Swain 라이브 검증 권장 시나리오
브라우저(어드민 로그인) 라이브 확인 권장:
1. 비매출 검토 — 운영 관리 → 비매출 검토 탭 진입·일람·상세 모달·1차 검토·승인·반려·EVENT_RANGE 금액 결정
2. 워크스페이스 진입 속도 — 성과·근태 메뉴 진입 시 체감 빨라졌는지
3. Stage 5·6·7 회귀 — 실시간 출퇴근·카카오 지도·워크툴 상단 버튼·휴가 수동 조정·어드민 출퇴근 수정·확인 요청 알림
4. R37 급여 자동 집계 회귀
5. SM/PM/SI 매출·비매출·결산·진행률 회귀

### 옛 R38 (Admin UX 3건) — 머지 완료·R39 Stage 4·5 일부로 흡수
사람별 마일스톤·출퇴근 월/리스트·회원 안내 박스 모두 main에 안착. R39 Stage 3 동적화로 라벨 자동 적응.

### C 메뉴얼 진행 상세 (`docs/manual/`)
- ✅ manual.html (회원·신고자·후원자) — 영역 A/B/C 1차 본문 완성·검색·인쇄·모바일 4차 마무리 완성
- ✅ manual-admin.html (운영자·간사·슈퍼어드민) — 권한·신고 운영·영역 D 워크스페이스·영역 E 후원·결제 1차 본문 완성
- ✅ ai-assistant-knowledge.md — 11,447 → 7,888자 압축 완성 (목표 5,000~8,000 정합)
- ✅ ai-training-siren-user.jsonl — 60문항 (후원 20·회원 18·SIREN 16·콘텐츠 6)
- ⏳ ai-training-siren-admin.jsonl — 어드민 60문항 (다음 응답)
- ⏳ ai-training-cms.jsonl — 통합 CMS 150문항 (75+75 분할)
- ⏳ ai-training-ai-assistant.jsonl — AI 비서 30문항
- ⏳ 옛 ai-training.jsonl 100문항 → docs/history/로 archive 이동

### R39 시리즈 완전 종결(C 라이브 검증 PASS) 후 예약
- 설계서 `docs/active/2026-05-20-r39-roles-and-ux.md` → `docs/history/milestones/`로 archive 이동
- 라운드 종결 체크리스트 15가지 메모리 정식 등록 (`docs/active/2026-05-20-r39-roles-and-ux.md §6.5`)
- R40 후속: **PG 전환 (토스 → KICC)** — `docs/kicc.md` 기반 옵션 A(듀얼 PG 점진 전환) 추천·추가 KICC 문서 필요(빌키·자동결제·해지·조회)·기존 토스 회원 처리 정책 결정 필요
- R40 추가: Netlify 배포 시간 단축 (netlify-plugin-cache·dead code 정리)·RAG 인프라 구축 (Q&A 300문항 임베딩)

설계서: `docs/active/2026-05-20-r39-roles-and-ux.md`

---

## 4. 잔여 작업

상세는 [`docs/rules/REMAINING_WORK.md`](docs/rules/REMAINING_WORK.md). 요약:

- **근태 6.6%** §6.2 부가 8건 (외근지 즐겨찾기·재택 사진·셀카·체크리스트·위젯·비교 뷰·다국어·IP 패턴) — 운영 후 1~2분기 관찰 후 선별
- **성과 3.3%** 옵션·후속 3건 (rolePermissions 실 미연결·AI 증빙 검토·팀 보너스)
- **Phase 23 재정 v3.0** — 2026-08-20 이후 별도 합의
- **Swain 운영 시작 액션**: ① 회원 base_salary 입력 ② 분기 결산 PAID 처리 ③ R36/R37 사용 패턴 관찰

---

## 5. Swain 운영 정책 (2026-05-20 시점 유지)

- **자율 권한**: 코드 수정·git push·Netlify 배포·npm 명령·옵션 추천 진행
- **확인 필요**: 설계·로직 결정·마이그레이션 호출·진정 위험·비가역 작업
- **A·B·C 자율주행**: push까지 자율·임시 브랜치 정리 자율·메인에게 묻지 말 것 ([CLAUDE.md §6.17](CLAUDE.md))
- **§6.15 알림**: 회귀 위험 실재 시만 박음 (도메인 분리·충돌 0인 머지는 알림 X) ([`feedback_single_session.md`](C:/Users/Administrator/.claude/projects/c--Users-Administrator-Desktop----dev-tbfa-mis/memory/feedback_single_session.md))

---

## 6. worktree 현황

| 폴더 | 용도 | 브랜치 |
|---|---|---|
| `c:\...\tbfa-mis` | 메인 | main 또는 작업 브랜치 |
| `c:\...\tbfa-mis-A` | A 채팅 | feature/r*-att-* 등 |
| `c:\...\tbfa-mis-B` | B 채팅 | feature/r*-ms-* / r37-* 등 |
| `c:\...\tbfa-mis-C\docs` | C 채팅 | verify/r*-* 등 |
| `c:\...\tbfa-mis-A\public` | A 보조 | — |

---

## 7. 참고 문서

| 문서 | 위치 | 역할 |
|---|---|---|
| CLAUDE.md | 루트 | 자동 로드 — 코딩 컨벤션·권한·자율성 원칙 |
| HANDOFF.md | docs/rules/ | 단일 최신 인수인계 |
| REMAINING_WORK.md | docs/rules/ | 잔여 작업 인벤토리 |
| PARALLEL_GUIDE.md | docs/rules/ | 병렬 작업·머지·충돌 회피 |
| 명세 마스터 7개 | docs/specs/ | 근태·성과·재정 + phase24·26·27·28 |
| 메모리 인덱스 | `~/.claude/projects/c--*/memory/MEMORY.md` | 자동 로드 — 본문은 작업 관련만 정독 |

---

**마지막 갱신**: 2026-05-20 24:00 KST (R39 정식 종결·라이브 검증 15/15 PASS·메뉴얼 300문항 통합·R40 KICC 대기)
