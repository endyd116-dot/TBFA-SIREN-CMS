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
| 2026-05-10 | 새 메인 채팅 | **컨텍스트 다이어트 시나리오 B 적용** — PROJECT_STATE 정적 부분(§4.0·§4.5·§6.1~§6.5·§7·§8) → docs/PARALLEL_GUIDE.md 이전. CLAUDE.md §11 → docs/PAGES.md 이전. 메모리 중복 3개 제거. 자동 로드 ~28% 절감. 진단·기록 [docs/CONTEXT_OPTIMIZATION.md](docs/CONTEXT_OPTIMIZATION.md) |
| 2026-05-10 | 새 메인 채팅 | **Phase 4 A·B 머지 완료** — A(0d8a206): admin-report.js+admin.html 탭+admin.js 라우터. B(5f70b7a): 이메일재발송 API+인쇄 CSS. admin-report-print.css admin.html `<head>` 추가(media=print). main 푸시 → Swain V1·V2·V3 검증 대기 |
| 2026-05-10 | 새 메인 채팅 | **6순위 #8 재설계 + 버그 수정 (89555cb)** — 화면 안 보이는 버그(div ID 불일치) 수정. 하이브리드 배치: 어드민 유가족지원·법률지원 목록에 직접 배정 버튼 + 통합 매칭 관리는 모니터링 겸용 유지. 마이페이지 신청 내역(유가족/법률)에 배정 시 채팅 버튼 추가. Swain V1 재검증 필요 |
| 2026-05-10 | 메인 채팅 | **Phase 4 병렬 시작 (94a725c)** — 설계서(DESIGN_PHASE4_REPORT.md) + 마이그 호출 완료 + 백엔드 5개(report-collector/list/detail/generate/cron-agent-9) + A(feature/phase4-frontend) + B(feature/phase4-email-print) 워크트리 준비 완료 |
| 2026-05-10 | 메인 채팅 | **6순위 #8 A·B 머지 완료 (fe84ed9)** — 백엔드 4개 API + chat 가드 + 프론트엔드 전체 main 안착 |

> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
🔵 Phase 4 코드 100% main 안착 — Swain V1·V2·V3 검증 대기
   6순위 #6·#8·#15 검증 병행 가능
   다음 작업: Phase 5~22 설계 세션 (Swain 우선순위 합의 후)
```

---

## 4. 진행 중 작업

> 완료된 병렬 작업 분담 정의는 git history + `docs/handover/v20.md` 참고.
> 새 병렬 작업 시작 시 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §4 템플릿 사용.

### 4.1 Phase 4 — 대표 보고 시스템 + Agent-9

| 항목 | 값 |
|---|---|
| 진행률 | ✅ 코드 100% main 안착 — Swain V1·V2·V3 검증 대기 |
| 담당 | 메인(백엔드 5개 ✅) / A(`0d8a206` 프론트엔드 ✅) / B(`5f70b7a` 이메일+인쇄 ✅) |
| 다음 할 일 | Swain V1(보고서 생성+조회) → V2(이메일 발송) → V3(인쇄) 검증 → ✅ 100% |
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

## 7. worktree 현황

| 폴더 | 브랜치 | 상태 |
|---|---|---|
| `tbfa-mis` (메인) | `main` | 머지·조율 전용 |
| `../tbfa-mis-A` | `feature/phase4-frontend` @ `0d8a206` | ✅ 완료, 머지됨 — 정리 가능 |
| `../tbfa-mis-B` | `feature/phase4-email-print` @ `5f70b7a` | ✅ 완료, 머지됨 — 정리 가능 |

새 병렬 작업 시작 절차는 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §2 참조.

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
