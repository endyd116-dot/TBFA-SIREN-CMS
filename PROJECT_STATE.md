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

## 2. 현재 상태 (2026-05-20)

### 🏁 명세 정합 시리즈(R29~R37) 공식 종결
- **7라운드 누적**: 65+건 명세 정합 fix + R36 부가 5건 + R37 급여 통합
- **검증 합산**: E2E 12/12 + R37 Q10/10 + R36 회귀 8/8 + R35 P1·P2 23/23 ALL PASS·BUG 0건
- **정합도 v2**: 근태 **93.4%** / 성과 **96.7%** / 평균 **95.1%**

### 🟢 운영 시작 공식 선언
근태관리 + 성과관리 + 급여 통합 시스템 — 즉시 운영 시작 가능.

### 📁 문서 4영역 분리 (cleanup/docs-memory-reorg 브랜치 진행 중)
- `docs/rules/` — 운영·작업 규칙
- `docs/specs/` — 명세 마스터 7개
- `docs/active/` — 진행 중 라운드 (현재 비어있음)
- `docs/history/` — 완료 히스토리

---

## 3. 진행 중 작업

| 작업 | 채팅 | 상태 |
|---|---|---|
| 문서·메모리 대정리 (4영역 분리·완료) | 메인 | ✅ 완료 (main da29a51) |
| **R39 통합 라운드 (역할 동적 CRUD + Admin UX 12건·8단계)** | B | 🟢 Stage 1 진행 중 (브랜치 feature/r39-roles-and-ux) |
| **사용자 메뉴얼 + AI 학습용 메뉴얼** (admin-manual.html·ai-assistant-knowledge.md·ai-training.jsonl) | C | 🟢 진행 중·톤 매칭 PASS·영역 B 완료·C/D/E 영역 남음 |
| 운영 fix 누적 (어드민 자가 점검 발견 12건) | 메인 | ✅ 머지 완료 (main b8ad9cc) |

**R38 폐기 사실**: 옛 R38(Admin UX 3건)은 main에 머지됐고·R39 Stage 4·5 일부로 흡수됨. R39 설계서 §0~§7 참조.

**R39 12건**: ①역할 동적 CRUD ②사람별 마일스톤 ③비매출 검토 화면 ④출퇴근 월/리스트 ⑤실시간 출퇴근 ⑥카카오 지도 시각화 ⑦직원 잔여 휴가 수동 CRUD ⑧출퇴근 양방향 수정 ⑨PC 위치정보 강제 ⑩워크툴 상단 출퇴근 버튼 ⑪회원 안내 박스 ⑫로딩 지연 fix.

**R39 종결 후 예약**: 라운드 종결 체크리스트 15가지 메모리 정식 등록 (`docs/active/2026-05-20-r39-roles-and-ux.md §6.5`).

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

**마지막 갱신**: 2026-05-20 (R29~R37 명세 정합 시리즈 종결 + 문서 4영역 분리 + 운영 시작 공식 선언)
