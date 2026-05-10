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
| 2026-05-10 | **C 채팅** | **Q1 Phase 9-B 라이브 검증 통과 + Q2 #BACKFILL-1 마이그 푸시** — 사용자/어드민 수신 설정 화면 인증 거부 401·페이지 200·코드 정합성 양호, bigserial 회복 확인 (회원/후원/발송로그 401 정상). bug 0건. 보고서 `docs/verify/2026-05-10-phase9-b-live.md`. 효성 결제일 백필 1회용 마이그 작성·verify 브랜치 푸시 (797576c) — 메인 머지 후 Swain 호출 대기 |
| 2026-05-10 | 메인 | **4채팅 새 구조 도입** — 메인(Opus 4.7 설계) / A(Sonnet 4.6 프론트) / B(Sonnet 4.6 백) / C(Opus 4.7 검증·fix·백필) / PARALLEL_GUIDE 갱신 + PARALLEL_TEMPLATE 신규 + §8 C 대기열 큐(8건) / Phase 10 R1 설계 준비 |
| 2026-05-10 | 메인 | **Phase 9-B 100% — C 2차 머지 (56f95a1)** — schema members 컬럼 2개 활성화 / 마이그 파일 삭제 / admin-notification-defaults auth 반환 구조 수정 / 1·2차 통합 검증: bigserial 회귀 0, 타입 에러 0 |
| 2026-05-10 | 메인 | **Phase 9-B C 1차 머지** — notification_preferences + admin_settings 테이블 마이그 / FORCED_CHANNELS / 디스패처 사용자 설정 조회 통합 / 사용자·어드민 화면 |
| 2026-05-10 | 메인 | **Phase 9 A·B 머지 완료 (45c9e20)** — A: Aligo SMS 실연동 / B: 알림톡 실연동 / dispatcher SMS+카카오 통합 / placeholder 2종 삭제. 카카오 심사 통과 후 템플릿 ID 2개 환경변수 등록하면 실발송 활성화 |
> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
🟢 Phase 9 진행 중 — 9-A·9-B 코드 100% / 라이브 검증·#BACKFILL-1·카카오 심사 대기
   ├─ A: ✅ SMS 어댑터 머지 (세션 종료)
   ├─ B: ✅ 카카오 어댑터 머지 (세션 종료) / ⏸ 카카오 심사 통과 후 환경변수 등록 → 실발송
   ├─ C: ✅ 9-B 1·2차 머지 완료 / ⏸ #BACKFILL-1 또는 9-C 라이브 검증 시나리오 대기
   └─ D: 휴면
   메인: Swain 라이브 검증 대기 + 다음 병렬 구조(4채팅 재배분) 설계 진행 중
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
| **Phase 8 알림 채널 통합 인프라** | ✅ 100% — A 디스패처+마이그+cleanup / B 7자리 통합 / C 어드민 화면+Q24~Q27 라이브 통과 |
| **Phase 9 외부 API 실연동 + 수신 설정 UI** | ✅ 코드 100% — 9-A SMS·9-B 카카오 어댑터·9-B 수신 설정 UI 모두 머지 / 🟡 Swain 라이브 검증·카카오 심사 통과·#BACKFILL-1 대기 |
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
| #BACKFILL-1 | 2026-05-10 | 효성 후원 7건 결제일 NULL | 🟡 Medium | 🟡 마이그 작성 푸시 (verify 브랜치 797576c) — 메인 머지 후 Swain 호출 대기 | [docs/issues/2026-05-10-hyosung-paid-date-backfill.md](docs/issues/2026-05-10-hyosung-paid-date-backfill.md) |
| ~~#BUG-7~~ | 2026-05-10 | `admin-finance-expenditure-approve.ts` | 🟠 High | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-6~~ | 2026-05-10 | `admin-finance-expenditure-list.ts` | 🔴 Critical | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-5~~ | 2026-05-10 | `admin-finance-{budget-upsert,expenditure-create,expenditure-approve}.ts` | 🔴 High | ✅ 해결 (이번 세션) | [docs/issues/2026-05-10-finance-audit-columns-null.md](docs/issues/2026-05-10-finance-audit-columns-null.md) |
| ~~#BUG-2~~ | 2026-05-10 | `cms-tbfa.js:60-90` | 🟠 High | ✅ 해결 (마일스톤 #16 단계 B 545b523/f026c6b) | [docs/issues/2026-05-10-cms-tbfa-demo-data.md](docs/issues/2026-05-10-cms-tbfa-demo-data.md) |
| ~~#BUG-1~~ | 2026-05-09 | `lib/auth.ts:128` | 🔴 Critical | ✅ 해결 (bb529f9) | [docs/issues/2026-05-09-requireActiveUser-uid-bug.md](docs/issues/2026-05-09-requireActiveUser-uid-bug.md) |

**처리 원칙**: 새 이슈 발견 시 `docs/issues/{날짜}-{키워드}.md` 별도 파일 + 본 표에 한 줄 인덱스. 해결 후 상태 갱신.

---

## 7. worktree 현황 (4채팅 새 구조)

> 2026-05-10 적용. 모델·역할 분배는 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §1.

| 폴더 | 채팅 | 모델 | 역할 | 영역 | 현재 상태 |
|---|---|---|---|---|---|
| `tbfa-mis` | **메인** | Opus 4.7 | 로직·DB 설계 + 머지·조율 | `docs/`, `PROJECT_STATE.md`, 머지 | 활성 — Phase 9 마무리 + Phase 10 라운드 설계 준비 |
| `../tbfa-mis-A` | **A** | Sonnet 4.6 | 프론트 구현 | `public/`, `assets/` | ⏸ 대기 — Phase 10 R1 트리거 시 시작 |
| `../tbfa-mis-B` | **B** | Sonnet 4.6 | 백 구현 | `netlify/functions/`, `lib/`, `db/`, `drizzle/` | ⏸ 대기 — Phase 10 R1 트리거 시 시작 |
| `../tbfa-mis-C` | **C** | Opus 4.7 | 라이브 검증 + fix + 백필 | 모든 영역 (검증·fix 한정) | 🟢 활성 — §9 대기열 처리 중 |
| `../tbfa-mis-D` | D | — | 휴면 (큰 단독 라운드 시 가동) | — | 휴면 |

**충돌 회피**: 폴더 단위 분리 → A·B 거의 0. 자세히 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §3.

**머지 순서 강제**: B → 마이그 → schema 활성화 → A → C. [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §5.

라운드 설계서 표준 양식: [`docs/PARALLEL_TEMPLATE.md`](docs/PARALLEL_TEMPLATE.md).

---

## 8. C 대기열 (Live-Verify Queue)

C(Opus 4.7)가 라이브 검증·fix·백필 대기 중인 작업. C는 매 세션 시작 시 큐에서 **가장 위 항목 1건**을 처리.

| # | 작업 | 종류 | 선행 조건 | 비고 |
|---|---|---|---|---|
| ~~Q1~~ | ~~Phase 9-B 사용자/어드민 수신 설정 화면 라이브 검증~~ | 라이브 검증 | — | ✅ 2026-05-10 통과 (보고서 `docs/verify/2026-05-10-phase9-b-live.md`) |
| ~~Q2~~ | ~~#BACKFILL-1 옛 효성 결제일 7건 백필~~ | 1회용 마이그 | — | ✅ 2026-05-10 마이그 작성·verify 브랜치 푸시 (797576c). 메인 머지 후 Swain 호출 대기 |
| Q3 | 6순위 #16 단계 D 라이브 검증 | 라이브 검증 (지연된 검증) | (없음) | 효성 CSV import + 매월 수납·미리보기 화면 |
| Q4 | 6순위 #8 1:1 매칭 채팅 라이브 검증 | 라이브 검증 (지연된 검증) | (없음) | 매칭·채팅 흐름 |
| Q5 | Phase 4 대표 보고 시스템 V1·V2·V3 라이브 검증 | 라이브 검증 (지연된 검증) | (없음) | 보고서 생성·이메일 재발송·인쇄 |
| Q6 | Phase 5~7 재정 관리 라이브 검증 | 라이브 검증 (지연된 검증) | (없음) | 예산·지출·승인 흐름 |
| Q7 | Phase 9-A SMS 실 발송 검증 | 외부 발송 검증 | Aligo 발신번호 등록 완료(✅) | 결제 실패 강제 → SMS 수신 확인 |
| Q8 | Phase 9-B 카카오 알림톡 실 발송 검증 | 외부 발송 검증 | 카카오 심사 통과 + 환경변수 2개 등록 | 영업일 3~5일 후 |

처리 정책:
- 큐는 선입선출 + 선행 조건 충족된 것 우선
- 새 라운드의 검증 작업은 큐에 추가, 단 라운드 마감 우선순위는 메인 판단
- 지연된 검증(Q3~Q6)은 새 라운드 검증과 분리 (다른 영역 회귀 발견 시 별도 fix)
- 큐 갱신 의무: C가 작업 완료 시 본 표에서 제거 + §2 마지막 업데이트 행 추가

---

## 9. 참고 문서

- [`CLAUDE.md`](CLAUDE.md) — 자동 로드, 코딩 컨벤션·자율성 원칙
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — 단일 최신 인수인계 (한 화면)
- [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) — 4채팅 병렬 작업 가이드 (2026-05-10 갱신)
- [`docs/PARALLEL_TEMPLATE.md`](docs/PARALLEL_TEMPLATE.md) — 라운드 설계서 표준 양식 (신규)
- [`docs/PAGES.md`](docs/PAGES.md) — 페이지 진입점 카탈로그
- [`docs/REMAINING_WORK.md`](docs/REMAINING_WORK.md) — 잔여 작업 인벤토리
- [`docs/CONTEXT_OPTIMIZATION.md`](docs/CONTEXT_OPTIMIZATION.md) — 컨텍스트 다이어트 진단·결정 기록
- [`docs/issues/`](docs/issues/) — 오류 리포트
- 영구 스냅샷: [`docs/handover/v20.md`](docs/handover/v20.md), [`docs/handover/v17-expanded.md`](docs/handover/v17-expanded.md)

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
