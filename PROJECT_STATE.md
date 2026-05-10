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
| 2026-05-11 | **C 채팅** | **Phase 10 R2 라이브 검증 통과** — 페이지 4종 200, 백엔드 7개 API 모두 401 정상 (500 0건). Q1~Q9 시나리오 모두 PASS — 시드 4건 표시·필터/수동 명단·미리보기·동적 그룹·화이트리스트·페이지네이션·soft delete·필터 0개 거부. baseline 응답 ~0.6s (R1 동등). Phase 4·8·9·10 R1·6순위 #8 회귀 0. bug 0건. 보고서 `docs/verify/2026-05-11-phase10-r2.md` |
| 2026-05-11 | 메인 | **Phase 10 R2 코드 100% 머지 완료** — Swain 마이그 호출 응답 success(시드 4건, grade_code 자동 보정) → schema recipientGroups 활성화 + 마이그 파일 삭제(7f2163b) + A 프론트 5파일 머지(b969bb2) → 라이브 진입 점검 + C R2 검증 트리거 대기 |
| 2026-05-11 | 메인 | **R2 백 + C Q4·Q5 통합 머지 + 설계 모호성 즉시 질문 정책 추가** — R2 백 10파일(B `90b3b26`) main 머지 / Q4·Q5 verify 흡수 / PARALLEL_GUIDE §1.7 신규 |
| 2026-05-11 | **C 채팅** | **Q4 + Q5 통합 라이브 검증 통과** — Q4 6순위 #8 매칭 채팅: 페이지 4종 200·백엔드 13개 401/405 정상·BUG-4 fix 유지·매칭 트랜잭션 정합성. Q5 Phase 4 대표 보고: SPA 200·백엔드 4개 401/405·BUG-3 fix 유지·통계·AI 요약·이메일·인쇄. cron-agent-9 매주 월요일 06:00 정상. 양 세션 회귀 0, bug 0건. 보고서 2종 |
| 2026-05-11 | 메인 | **Phase 10 R3 설계서 작성 완료 (발송 예약 큐 + 즉시 발송)** — DB(send_jobs + send_recipients 2테이블) / API 7개 + cron 1개(1분 단위 dispatcher, chunk 50건/회) / 화면 3개 / 어댑터 직접 호출 / 검증 Q1~Q12 + cron + 성능 / 평행 모드 / R2 머지 후 트리거 |
> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
🟢 Phase 10 R2 100% 마감 — R3 B·A 트리거 대기 + #BACKFILL-1 약정일 마이그 작성
   ├─ A: ⏸ R3 트리거 대기 (설계서 §6.3 복붙)
   ├─ B: ⏸ R3 트리거 대기 (설계서 §6.2 복붙)
   ├─ C: ⏸ 다음 세션 — R3 검증 또는 Q6 / Q-진단-2 (#BACKFILL-1 약정일 마이그 호출 후)
   └─ D: 휴면
   메인: R3 트리거 대기 + #BACKFILL-1 약정일 시퀀스 마이그 작성 진행 중
```

**Swain 합의**: #BACKFILL-1은 **약정일 + 계약 시작일 시퀀스 방식**으로 1회용 마이그 처리 (Swain 의견 반영). 자동 매칭 시스템 별도 라운드 X.

---

## 4. 진행 중 작업

> 완료된 병렬 작업 분담 정의는 git history + `docs/handover/v20.md` 참고.
> 새 병렬 작업 시작 시 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §4 템플릿 사용.

### 4.1 Phase 10 R2 — 통합 발송 시스템: 수신자 그룹 선택

| 항목 | 값 |
|---|---|
| 진행률 | ✅ 100% — 코드 100% 머지 + C 라이브 검증 통과 (2026-05-11) |
| 담당 | 메인(라운드 마감 진행) / B(완료) / A(완료) / C(완료) |
| 다음 할 일 | 메인이 verify 보고 흡수 → 라운드 마감 → Phase 10 R3 B·A 트리거 |
| 설계서 | [docs/milestones/2026-05-11-phase10-r2-recipient-groups.md](docs/milestones/2026-05-11-phase10-r2-recipient-groups.md) |

### 4.2 Phase 10 R1 — 템플릿 빌더 (✅ 100% 마감)

코드 100% 머지 + C Q9 라이브 검증 통과 (2026-05-11). 업무 시나리오 클릭 테스트는 Swain 직접 검증 항목 (보고서 §6).

### 4.3 Phase 4 — 대표 보고 시스템 + Agent-9 (✅ 100% 마감)

코드 + BUG-3 fix + C V1·V2·V3 라이브 검증 통과 (2026-05-11). 업무 시나리오 클릭 테스트는 Swain 직접 검증 항목.

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
| 6순위 #16 단계 D | ✅ 100% — 코드+C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-10-rank6-16-d.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| 6순위 #8 1:1 매칭 채팅 | ✅ 100% — 코드+BUG-4 fix+C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-rank6-08-matching-chat.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 4 대표 보고 시스템** | ✅ 100% — 코드+BUG-3 fix+C V1·V2·V3 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-phase4-report.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 5~7 재정 관리** | ✅ 100% 코드+마이그+schema 활성화 (8023057) + C 정적 검증 통과 (BUG-5 fix) / 🟡 라이브 검증 대기 (Q6) |
| TypeScript 타입 에러 149건 | ⏸ C 채팅 진행 예정 |
| **Phase 8 알림 채널 통합 인프라** | ✅ 100% — A 디스패처+마이그+cleanup / B 7자리 통합 / C 어드민 화면+Q24~Q27 라이브 통과 |
| **Phase 9 외부 API 실연동 + 수신 설정 UI** | ✅ 코드 100% — 9-A SMS·9-B 카카오 어댑터·9-B 수신 설정 UI / 9-B 라이브 검증 통과 (Q1) / 🟡 #BACKFILL-1 호출 대기·카카오 심사 대기 (Q7·Q8) |
| **Phase 10 R1 템플릿 빌더** | ✅ 100% — 코드 머지 (8db8ffb·cef0f69) + C Q9 라이브 검증 통과 (2026-05-11). 업무 시나리오 클릭 테스트는 Swain 직접 (보고서 §6) |
| **Phase 10 R2 수신자 그룹** | ✅ 100% — 코드 머지 (7f2163b·b969bb2) + C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-phase10-r2.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 10 R3 발송 예약 큐** | 🟢 설계서 작성 완료 ([R3 설계서](docs/milestones/2026-05-11-phase10-r3-send-queue.md)) — R2 머지 후 트리거 |
| **Phase 10 R4~R5 통합 발송** | ✅ 카탈로그 / ⏸ R3 후 |
| **Phase 11 멘션·구독** | ✅ 카탈로그 / ⏸ |
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

**누적**: 약 47% / 약 450h+

---

## 6. 미해결 이슈 (Open Issues)

현재 미해결 1건 (#BACKFILL-1 — 마이그 main 안착, Swain 호출 대기).

| ID | 발견 | 위치 | 심각도 | 상태 | 리포트 |
|---|---|---|---|---|---|
| #BACKFILL-1 | 2026-05-10 | 효성 후원 결제일 NULL (44건) | 🟡 Medium | 🟢 약정일 + 계약 시작일 시퀀스 방식 결정 (Swain 합의 2026-05-11) — 메인이 1회용 마이그 작성 중 | [docs/issues/2026-05-10-hyosung-paid-date-backfill.md](docs/issues/2026-05-10-hyosung-paid-date-backfill.md) |
| ~~#BUG-7~~ | 2026-05-10 | `admin-finance-expenditure-approve.ts` | 🟠 High | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-6~~ | 2026-05-10 | `admin-finance-expenditure-list.ts` | 🔴 Critical | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-5~~ | 2026-05-10 | `admin-finance-{budget-upsert,expenditure-create,expenditure-approve}.ts` | 🔴 High | ✅ 해결 | [docs/issues/2026-05-10-finance-audit-columns-null.md](docs/issues/2026-05-10-finance-audit-columns-null.md) |
| ~~#BUG-2~~ | 2026-05-10 | `cms-tbfa.js:60-90` | 🟠 High | ✅ 해결 (마일스톤 #16 단계 B 545b523/f026c6b) | [docs/issues/2026-05-10-cms-tbfa-demo-data.md](docs/issues/2026-05-10-cms-tbfa-demo-data.md) |
| ~~#BUG-1~~ | 2026-05-09 | `lib/auth.ts:128` | 🔴 Critical | ✅ 해결 (bb529f9) | [docs/issues/2026-05-09-requireActiveUser-uid-bug.md](docs/issues/2026-05-09-requireActiveUser-uid-bug.md) |

**처리 원칙**: 새 이슈 발견 시 `docs/issues/{날짜}-{키워드}.md` 별도 파일 + 본 표에 한 줄 인덱스. 해결 후 상태 갱신.

---

## 7. worktree 현황 (4채팅 새 구조)

> 2026-05-10 적용. 모델·역할 분배는 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §1.

| 폴더 | 채팅 | 모델 | 역할 | 영역 | 현재 상태 |
|---|---|---|---|---|---|
| `tbfa-mis` | **메인** | Opus 4.7 | 로직·DB 설계 + 머지·조율 | `docs/`, `PROJECT_STATE.md`, 머지 | 활성 — Phase 10 R1 라운드 마감 (Q9 verify 흡수) → R2 설계 |
| `../tbfa-mis-A` | **A** | Sonnet 4.6 | 프론트 구현 | `public/`, `assets/` | ✅ Phase 10 R1 main 머지 완료 — 세션 종료 |
| `../tbfa-mis-B` | **B** | Sonnet 4.6 | 백 구현 | `netlify/functions/`, `lib/`, `db/`, `drizzle/` | ✅ Phase 10 R1 main 머지 완료 — 세션 종료 |
| `../tbfa-mis-C` | **C** | Opus 4.7 | 라이브 검증 + fix + 백필 | 모든 영역 (검증·fix 한정) | ✅ Q4·Q5·R2 통과 (2026-05-11) — 다음 세션은 Q-진단-2(#BACKFILL-1 D안 결정 후) 또는 Q6 / R3 검증(A·B 머지 후) |
| `../tbfa-mis-D` | D | — | 휴면 (큰 단독 라운드 시 가동) | — | 휴면 |

**충돌 회피**: 폴더 단위 분리 → A·B 거의 0. 자세히 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §3.

**머지 순서 강제**: B → 마이그 → schema 활성화 → A → C. [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §5.

라운드 설계서 표준 양식: [`docs/PARALLEL_TEMPLATE.md`](docs/PARALLEL_TEMPLATE.md).

---

## 8. C 대기열 (Live-Verify Queue)

C(Opus 4.7)가 라이브 검증·fix·백필 대기 중인 작업. C는 매 세션 시작 시 큐에서 **가장 위 항목 1건**을 처리.

| # | 작업 | 종류 | 선행 조건 | 비고 |
|---|---|---|---|---|
| Q-진단-2 | #BACKFILL-1 백필 경로 결정·실행 | 마이그 갱신·실행 | Swain이 보강된 진단 응답 본문 메인 채팅에 전달 | 응답 시나리오별 A/B/C/D안 판단 → 마이그 본문 교체(정규식 또는 효성 청구 raw join) → Swain 재호출 → 결과 확인 → 마이그 파일 삭제 |
| ~~Q4~~ | ~~6순위 #8 1:1 매칭 채팅 라이브 검증~~ | 라이브 검증 (지연된 검증) | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-rank6-08-matching-chat.md`). 페이지 4종 200·매칭/채팅 13개 함수 401·405 정상·BUG-4 fix 유지·회귀 0 |
| ~~Q5~~ | ~~Phase 4 대표 보고 시스템 V1·V2·V3 라이브 검증~~ | 라이브 검증 (지연된 검증) | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-phase4-report.md`). 페이지 200·API 4개 401·405 정상·BUG-3 fix 유지·AI 폴백 정합·회귀 0 |
| Q6 | Phase 5~7 재정 관리 라이브 검증 | 라이브 검증 (지연된 검증) | (없음) | 예산·지출·승인 흐름 |
| Q7 | Phase 9-A SMS 실 발송 검증 | 외부 발송 검증 | Aligo 발신번호 등록 완료(✅) | 결제 실패 강제 → SMS 수신 확인 |
| Q8 | Phase 9-B 카카오 알림톡 실 발송 검증 | 외부 발송 검증 | 카카오 심사 통과 + 환경변수 2개 등록 | 영업일 3~5일 후 |
| ~~Q9~~ | ~~Phase 10 R1 템플릿 빌더 검증~~ | 라이브 검증 | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-phase10-r1.md`). 페이지 4종 200·API 6개 401 정상·Q1~Q8 모두 PASS·회귀 0 |

**완료**: ~~Q1~~ Phase 9-B 라이브 (2026-05-10 통과) / ~~Q2~~ #BACKFILL-1 마이그 작성 (2026-05-10 main 안착) / ~~Q-진단~~ 진단 보강 + import 코드 분석 (2026-05-11) / ~~Q3~~ 6순위 #16 단계 D 라이브 (2026-05-11 통과) / ~~Q9~~ Phase 10 R1 라이브 (2026-05-11 통과) / ~~Q4~~ 6순위 #8 1:1 매칭 채팅 (2026-05-11 통과) / ~~Q5~~ Phase 4 대표 보고 시스템 (2026-05-11 통과)

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
- [`docs/verify/`](docs/verify/) — 라이브 검증 보고서
- 영구 스냅샷: [`docs/handover/v20.md`](docs/handover/v20.md), [`docs/handover/v17-expanded.md`](docs/handover/v17-expanded.md)
