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
| 2026-05-10 | **C 채팅** | **Q12 fix 머지 — 수입 집계·표시 기준일을 실제 결제일로** — 9개 함수 통합(어드민 6 + 효성 import 1 + 마이페이지·영수증 2). DB 마이그 0. 옛 효성 데이터 백필은 별도 라운드 |
| 2026-05-10 | 메인 | **Phase 8 B 7자리 통합 머지 완료** (1b23ed5) — 4개 파일·158줄 / 워크스페이스·토스 빌링 3·카드 만료·일일 브리핑 모두 디스패처 호출 / C 어드민 화면+라이브 검증 트리거 |
| 2026-05-10 | 메인 | **Phase 8 A 디스패처 머지 + 마이그 완료** (5fd603a) — 11개 신규 파일·769줄 / 디스패처·9종 이벤트·4채널 어댑터·재시도 cron / 운영 DB에 발송 로그 테이블 생성 / B 즉시 착수 트리거 |
| 2026-05-10 | 메인 | **C 라이브 검증 큐 보관 + Phase 8 역할 전환** — A 인터페이스 OK 컨펌 / C는 Q12 fix(수입 집계 기준일 실제 결제일로) 즉시 + Phase 8 어드민 화면 대기 / Q15~Q23 큐 보관 |
| 2026-05-10 | 메인 | **A·B 단계 D 보강 머지 완료** — A: D4 매월 수납 현황 6개월 점등 / B: D7 자동 매칭 미리보기(3-버킷 + 상태 전이) |

> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
🟢 Phase 8 라운드 마무리 단계 (2026-05-10)
   ├─ A: ✅ 디스패처 머지 + 마이그 + cleanup 완료
   ├─ B: ✅ 7자리 통합 머지 완료 (1b23ed5)
   ├─ C: 🟢 Q12 fix 진행 + Phase 8 어드민 화면·라이브 검증 트리거됨
   └─ D: 휴면
   메인: C 어드민 화면 + Q24~Q28 라이브 보고 대기 → Phase 8 100% / Phase 9 외부 서비스 세션
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
| **Phase 8 알림 채널 통합 인프라** | 🟢 진행 중 — A 디스패처 머지·마이그 ✅ / B 7자리 통합 착수 / C 어드민 화면 대기 |
| **Phase 9 외부 API 실연동 + 수신 설정 UI** | ✅ 설계 합의 (9-A + 9-B 묶음) / ⏸ Phase 8 머지 후 시작 |
| **Phase 10 통합 발송 시스템** | ✅ 카탈로그 (CMM-A+B+D 흡수) / ⏸ Phase 8·9 후 |
| **Phase 11 멘션·구독** | ✅ 카탈로그 / ⏸ Phase 8 후 |
| **Phase 12 신고 진행 공개 + 익명 강화** | ✅ 카탈로그 (SRN-A+B 통합) / ⏸ |
| **Phase 13 신고 통계 대시보드** | ✅ 카탈로그 / ⏸ |
| **Phase 14 외부 기관 인계** | ✅ 카탈로그 (신규) / ⏸ |
| **Phase 15 전문가 매칭 고도화** | ✅ 카탈로그 / ⏸ |
| **Phase 16 통합 분석 대시보드** | ✅ 카탈로그 (ANL-A+B+C+D 통합 + Phase 4 인계 보강) / ⏸ |
| **Phase 17 보안·감사 강화** | ✅ 카탈로그 / ⏸ |
| **Phase 18 성능 최적화** | ✅ 카탈로그 / ⏸ |
| **Phase 19 자동 테스트 보강** | ✅ 카탈로그 (큰 묶음, 단독) / ⏸ |
| **Phase 20 운영 안정성 (모니터링+백업)** | ✅ 카탈로그 / ⏸ |
| Phase 21~22 | ⏸ 여유 슬롯 — 미래 기능 합의 시 채움 |

**누적**: 약 45% / 약 440h+

---

## 6. 미해결 이슈 (Open Issues)

현재 미해결 1건 (#BACKFILL-1 별도 라운드 대기).

| ID | 발견 | 위치 | 심각도 | 상태 | 리포트 |
|---|---|---|---|---|---|
| #BACKFILL-1 | 2026-05-10 | 효성 후원 7건 결제일 NULL | 🟡 Medium | ⏸ 별도 라운드 대기 | [docs/issues/2026-05-10-hyosung-paid-date-backfill.md](docs/issues/2026-05-10-hyosung-paid-date-backfill.md) |
| ~~#BUG-7~~ | 2026-05-10 | `admin-finance-expenditure-approve.ts` | 🟠 High | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-6~~ | 2026-05-10 | `admin-finance-expenditure-list.ts` | 🔴 Critical | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-5~~ | 2026-05-10 | `admin-finance-{budget-upsert,expenditure-create,expenditure-approve}.ts` | 🔴 High | ✅ 해결 (이번 세션) | [docs/issues/2026-05-10-finance-audit-columns-null.md](docs/issues/2026-05-10-finance-audit-columns-null.md) |
| ~~#BUG-2~~ | 2026-05-10 | `cms-tbfa.js:60-90` | 🟠 High | ✅ 해결 (마일스톤 #16 단계 B 545b523/f026c6b) | [docs/issues/2026-05-10-cms-tbfa-demo-data.md](docs/issues/2026-05-10-cms-tbfa-demo-data.md) |
| ~~#BUG-1~~ | 2026-05-09 | `lib/auth.ts:128` | 🔴 Critical | ✅ 해결 (bb529f9) | [docs/issues/2026-05-09-requireActiveUser-uid-bug.md](docs/issues/2026-05-09-requireActiveUser-uid-bug.md) |

**처리 원칙**: 새 이슈 발견 시 `docs/issues/{날짜}-{키워드}.md` 별도 파일 + 본 표에 한 줄 인덱스. 해결 후 상태 갱신.

---

## 7. worktree 현황 (3-way 병렬)

| 폴더 | 브랜치 | 역할 | 상태 |
|---|---|---|---|
| `tbfa-mis` (메인) | `main` | 머지·조율·설계 | 활성 |
| `../tbfa-mis-A` | `feature/phase8-notify-dispatcher` | ✅ 디스패처 머지 완료 (5fd603a) + 마이그 OK / 마이그 파일 cleanup push 대기 |
| `../tbfa-mis-B` | `feature/phase8-notify-integration` | ✅ 7자리 통합 머지 완료 (1b23ed5) — Phase 9 9-A·B 라운드 대기 |
| **`../tbfa-mis-C`** | **`verify/live-comprehensive`** | **🟢 Q12 fix(수입 집계 기준일) 즉시 + Phase 8 어드민 화면 대기 / Q15~Q23 큐 보관** |
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
