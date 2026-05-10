# PROJECT_STATE.md — SIREN 작업 상태 (휘발성)

> **목적**: "지금 누가 뭘 하고 있나" 한 곳에 모음.
> **자동 로드 X** — 메인 채팅 시작 시 명시적으로 정독.
> **갱신 의무**: 진행률·다음 할 일이 바뀌면 본인 채팅이 직접 갱신 후 push.
> **정적 가이드**(분담·충돌·시작 프롬프트·머지 체크리스트)는 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md).

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 이름 | **SIREN (싸이렌)** — 교사유가족협의회 통합 NPO 플랫폼 |
| 라이브 URL | https://tbfa-siren-cms.netlify.app |
| 베이스 브랜치 | `main` |
| 단일 최신 인수인계 | [`docs/HANDOFF.md`](docs/HANDOFF.md) |

상세 스택·환경변수·폴더 구조는 [`CLAUDE.md`](CLAUDE.md) §2~5 참조.

---

## 2. 마지막 업데이트

| 시각 | 갱신자 | 내용 |
|---|---|---|
| 2026-05-10 | 메인 | **A·B 단계 D 보강 머지 완료** — A: D4 매월 수납 현황 6개월 점등 / B: D7 자동 매칭 미리보기(3-버킷 + 상태 전이) |
| 2026-05-10 | 메인 | **Phase 8·9 설계 합의 완료** — 알림 채널 통합 인프라(8) + 외부 API 실연동·수신 설정(9) 묶음 / [설계서](docs/milestones/2026-05-10-notifications.md) |
| 2026-05-10 | 메인 | **A·B 단계 D 머지 완료 (3a932c3)** — A: 효성 import Gap 보강 / B: D3·D4·D7 화면 폴리시 |
| 2026-05-10 | 메인 | **사용자 검증 대행 정책 도입 (549f0b8)** — C 역할 재정의 (다음 병렬 라운드부터 적용) |
| 2026-05-10 | **C 채팅** | **Phase 5~7 정적 검증 통과 + BUG-5 fix (a3f58ef)** — 감사 추적 컬럼 영구 NULL 3곳 수정 |
| 2026-05-10 | 메인 | **Phase 5~7 마이그 + schema 활성화 (8023057)** — 3개 테이블 + 초기 카테고리 5개 |
| 2026-05-10 | 메인 | **Phase 5~7 D 브랜치 main 머지 (b0a6279)** — API 7개 + 프론트 3개 |

> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
🟢 모든 병렬 작업 main 머지 완료 (3a932c3)
   ├─ A: ✅ 단계 D 파서 머지 (D1 lib/hyosung-members-parser + D2 safeReevaluate)
   ├─ B: ✅ 단계 D 화면 머지 (D3·D4·D7 폴리시 보강)
   ├─ C: ✅ Phase 5~7 정적 검증 + BUG-5 fix (a3f58ef) / 다음: stale·TS·라이브 검증
   └─ D: ✅ Phase 5~7 main 머지 + schema 활성화
   메인: 라이브 검증 대기 + Phase 8~22 설계 가능
```

---

## 4. 진행 중 작업

> 완료된 병렬 작업 분담 정의는 git history + `docs/handover/v20.md` 참고.
> 새 병렬 작업 시작 시 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §4 템플릿 사용.

### 4.1 Phase 4 — 대표 보고 시스템 + Agent-9

| 항목 | 값 |
|---|---|
| 진행률 | ✅ 코드+버그수정 100% main 안착 — Swain V1·V2·V3 검증 대기 |
| 담당 | 메인(백엔드) / A(프론트엔드) / B(이메일+인쇄) / **C(BUG-3 수정 ✅)** |
| 다음 할 일 | Swain V1(보고서 생성+조회) → V2(이메일 재발송, BUG-3 수정됨) → V3(인쇄) 검증 → ✅ 100% |
| 설계서 | [docs/DESIGN_PHASE4_REPORT.md](docs/DESIGN_PHASE4_REPORT.md) |

---

## 5. 마일스톤 진행률 (CLAUDE.md §10 기준)

| 묶음 | 상태 |
|---|---|
| Phase 1 효성 CMS+ | ✅ 100% |
| Phase 2 토스 빌링 자동청구 | ✅ 100% |
| Phase 3 워크스페이스 본체 | ✅ 100% |
| Phase 3-extra 파일함 | ✅ 100% |
| 4순위 자잘한 버그 3건 | ✅ 100% |
| 5순위 #1 / #9 / #10 | ✅ 100% |
| 6순위 #6 자격 변경 | ✅ 코드+검증 100% (C 정적 분석 통과) |
| 6순위 #15 CSV + 엑셀 | ✅ 코드+검증 100% (C 정적 분석 통과) |
| 6순위 #16 단계 A·B·C | ✅ 100% (V1·V2·V3 통과, 이전 세션 완료) |
| 6순위 #16 단계 D | ✅ 코드 100% (1차: A 파서·B 화면 3a932c3 / 2차: A 매월 수납·B CSV 미리보기 머지 완료) / 🟡 라이브 검증 대기 |
| 6순위 #8 1:1 매칭 채팅 | ✅ 코드 100% + BUG-4 fix (C 검증 완료) / 🟡 Swain 라이브 검증 대기 |
| **Phase 4 대표 보고 시스템** | ✅ 코드 100% + C 검증 완료 (BUG-3·4 fix) |
| **Phase 5~7 재정 관리** | ✅ 100% 코드+마이그+schema 활성화 (8023057) + C 정적 검증 통과 (BUG-5 fix) / 🟡 Swain 라이브 검증 대기 |
| TypeScript 타입 에러 149건 | ⏸ C 채팅 진행 예정 |
| **Phase 8 알림 채널 통합 인프라** | ✅ 설계 합의 (2026-05-10) / ⏸ 코드 미착수 — A·B·C 분배안 준비 완료 |
| **Phase 9 외부 API 실연동 + 수신 설정 UI** | ✅ 설계 합의 (9-A + 9-B 묶음) / ⏸ Phase 8 머지 후 시작 |
| Phase 10~22 (13개) | ⏸ 스펙 미정 — Phase 8·9 진행 중 별도 설계 세션 |

**누적**: 약 45% / 약 440h+

---

## 6. 미해결 이슈 (Open Issues)

현재 미해결 0건.

| ID | 발견 | 위치 | 심각도 | 상태 | 리포트 |
|---|---|---|---|---|---|
| ~~#BUG-5~~ | 2026-05-10 | `admin-finance-{budget-upsert,expenditure-create,expenditure-approve}.ts` | 🔴 High | ✅ 해결 (이번 세션) | [docs/issues/2026-05-10-finance-audit-columns-null.md](docs/issues/2026-05-10-finance-audit-columns-null.md) |
| ~~#BUG-2~~ | 2026-05-10 | `cms-tbfa.js:60-90` | 🟠 High | ✅ 해결 (마일스톤 #16 단계 B 545b523/f026c6b) | [docs/issues/2026-05-10-cms-tbfa-demo-data.md](docs/issues/2026-05-10-cms-tbfa-demo-data.md) |
| ~~#BUG-1~~ | 2026-05-09 | `lib/auth.ts:128` | 🔴 Critical | ✅ 해결 (bb529f9) | [docs/issues/2026-05-09-requireActiveUser-uid-bug.md](docs/issues/2026-05-09-requireActiveUser-uid-bug.md) |

**처리 원칙**: 새 이슈 발견 시 `docs/issues/{날짜}-{키워드}.md` 별도 파일 + 본 표에 한 줄 인덱스. 해결 후 상태 갱신.

---

## 7. worktree 현황 (3-way 병렬)

| 폴더 | 브랜치 | 역할 | 상태 |
|---|---|---|---|
| `tbfa-mis` (메인) | `main` | 머지·조율·설계 | 활성 |
| `../tbfa-mis-A` | `feature/m16-step-d-monthly-billing` | ✅ D4 매월 수납 현황 머지 완료 — Phase 8 라운드 대기 |
| `../tbfa-mis-B` | `feature/m16-step-d-csv-preview` | ✅ D7 자동 매칭 미리보기 머지 완료 — Phase 8 라운드 대기 |
| **`../tbfa-mis-C`** | **`verify/phase4-and-pending`** | **검증·수정 전담** | Q1~Q4·Q7~Q10 완료·BUG-3·4·5 fix / 다음: stale·TS·Q11~ 라이브 |
| **`../tbfa-mis-D`** | **`feature/finance-phase5-7`** | **Phase 5~7** | ✅ 머지 완료 — 다음 라운드 대기 |

**3-way 정책 핵심**:
- A·B: 신규 기능 개발 (새 파일 위주)
- C: 기존 코드 검증·fix·문서 패치 (신규 기능 추가 X)
- 머지 순서: A·B 신규 → C fix (역순 시 fix 묻힘)
- 충돌 회피: A·B 작업 영역 = §7 표 확인 후 C가 회피

C 시작 가이드: [`docs/HANDOFF_C.md`](docs/HANDOFF_C.md)
새 병렬 작업 시작 절차: [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §2

---

## 8. 참고 문서

- [`CLAUDE.md`](CLAUDE.md) — 자동 로드, 코딩 컨벤션·자율성 원칙
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — 단일 최신 인수인계 (한 화면)
- [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) — 병렬 작업·머지·충돌 회피 가이드
- [`docs/PAGES.md`](docs/PAGES.md) — 페이지 진입점 카탈로그
- [`docs/REMAINING_WORK.md`](docs/REMAINING_WORK.md) — 잔여 작업 인벤토리
- [`docs/CONTEXT_OPTIMIZATION.md`](docs/CONTEXT_OPTIMIZATION.md) — 컨텍스트 다이어트 진단·결정 기록
- [`docs/issues/`](docs/issues/) — 오류 리포트
- 영구 스냅샷: [`docs/handover/v20.md`](docs/handover/v20.md), [`docs/handover/v17-expanded.md`](docs/handover/v17-expanded.md)
