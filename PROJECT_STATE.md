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
| 2026-05-10 | **C 채팅** | **Q1~Q4 검증 완료 + 버그 2건 수정·main 머지 (d0b72f7)** — BUG-3: Phase4 이메일 재발송 필드명 불일치 수정. BUG-4: #8 매칭관리 탭버튼 div ID 불일치 수정. Q3(#6)·Q4(#15) 정상 확인. Netlify 자동배포 중. |
| 2026-05-10 | 메인 채팅 | **3-way 병렬 정책 도입 + C 워크트리 신설** — A·B(신규 개발) + **C(검증·수정 전담)** 분리. C 워크트리 `../tbfa-mis-C` @ `verify/phase4-and-pending` 생성. 첫 작업 큐: Phase 4·6순위 #8/#6/#15 검증 + stale 문서 패치 + TypeScript 정리. C 시작 가이드 [docs/HANDOFF_C.md](docs/HANDOFF_C.md). A·B는 6순위 #16 단계 B·C 분배 예정 |
| 2026-05-10 | 새 메인 채팅 | **컨텍스트 다이어트 시나리오 B 적용** — PROJECT_STATE 정적 부분 → docs/PARALLEL_GUIDE.md 이전. 자동 로드 ~28% 절감. [docs/CONTEXT_OPTIMIZATION.md](docs/CONTEXT_OPTIMIZATION.md) |
| 2026-05-10 | 새 메인 채팅 | **Phase 4 A·B 머지 완료** — A(0d8a206): admin-report.js+admin.html 탭+admin.js 라우터. B(5f70b7a): 이메일재발송 API+인쇄 CSS. main 푸시 → C 검증 대기 |
| 2026-05-10 | 새 메인 채팅 | **6순위 #8 재설계 + 버그 수정 (89555cb)** — 화면 안 보이는 버그(div ID 불일치) 수정. 하이브리드 배치 + 마이페이지 채팅 버튼. C 검증 대기 |
| 2026-05-10 | 메인 채팅 | **6순위 #8 A·B 머지 완료 (fe84ed9)** — 백엔드 4개 API + chat 가드 + 프론트엔드 전체 main 안착 |

> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
🟢 C 채팅 검증 완료 — main 머지 완료 (d0b72f7), Netlify 자동배포 중
   Swain: Phase 4 V1·V2·V3 검증 + #6·#8·#15 검증 후 다음 작업 방향 합의 필요
   다음 작업: Phase 5 설계 세션 또는 자투리(TS 에러 149건)
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
| 6순위 #6 자격 변경 | ✅ 코드 100% / 🟡 Swain 검증 대기 |
| 6순위 #15 CSV + 엑셀 | ✅ 코드 100% / 🟡 Swain 검증 대기 |
| 6순위 #16 통합 회원·후원 시스템 | ✅ 100% (V1·V2·V3 통과) |
| 6순위 #8 1:1 매칭 채팅 | ✅ 코드 100% / 🟡 Swain 검증 대기 |
| **Phase 4 대표 보고 시스템** | ✅ 코드 100% / 🟡 Swain V1·V2·V3 검증 대기 |
| TypeScript 타입 에러 149건 | ⏸ 자투리 (운영 영향 0) |
| Phase 5~22 (18개) | ⏸ 스펙 미정 — 설계 세션 필요 |

**누적**: 약 45% / 약 440h+

---

## 6. 미해결 이슈 (Open Issues)

현재 미해결 0건.

| ID | 발견 | 위치 | 심각도 | 상태 | 리포트 |
|---|---|---|---|---|---|
| ~~#BUG-2~~ | 2026-05-10 | `cms-tbfa.js:60-90` | 🟠 High | ✅ 해결 (마일스톤 #16 단계 B 545b523/f026c6b) | [docs/issues/2026-05-10-cms-tbfa-demo-data.md](docs/issues/2026-05-10-cms-tbfa-demo-data.md) |
| ~~#BUG-1~~ | 2026-05-09 | `lib/auth.ts:128` | 🔴 Critical | ✅ 해결 (bb529f9) | [docs/issues/2026-05-09-requireActiveUser-uid-bug.md](docs/issues/2026-05-09-requireActiveUser-uid-bug.md) |

**처리 원칙**: 새 이슈 발견 시 `docs/issues/{날짜}-{키워드}.md` 별도 파일 + 본 표에 한 줄 인덱스. 해결 후 상태 갱신.

---

## 7. worktree 현황 (3-way 병렬)

| 폴더 | 브랜치 | 역할 | 상태 |
|---|---|---|---|
| `tbfa-mis` (메인) | `main` | 머지·조율·설계 | 활성 |
| `../tbfa-mis-A` | `feature/m16-step-b` @ `aa7305d` | 신규 개발 — 통합회원 실제 API + 상세 모달 ([HANDOFF_A](docs/HANDOFF_A.md)) | 활성 — 시작 대기 |
| `../tbfa-mis-B` | `feature/m16-step-c` @ `aa7305d` | 신규 개발 — donor_type 컬럼 + 정기/잠재 화면 ([HANDOFF_B](docs/HANDOFF_B.md)) | 활성 — 시작 대기 |
| **`../tbfa-mis-C`** | **`verify/phase4-and-pending`** @ `81a124b` | **검증·수정 전담** | **활성 — 시작 대기** |

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
