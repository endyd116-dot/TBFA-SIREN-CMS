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
| 2026-05-16 | **메인** | **버그 픽스 3차 코드 완결 + 📐 Phase 23 설계 진입** (main @ `20af8b4`, 전부 푸시) — 계정과목 전면작업·#9/#11 매출 카테고리 2단계 계층·#7/#8 정기후원 효성·토스 중복 경고·출금전표 예산항목 드롭다운 전부 완료. 계정과목·매출카테고리 마이그 호출 확인·파일삭제·schema 활성화 완료. 버그3차 남은 건 Swain 운영 작업뿐(#16 HTTPS·#14 환경변수·#3 효성데이터). v3.0 설계도 정본화(docs 커밋)·Phase 23-0 골격 설계서 작성. ★ **재정 모듈 전체가 더미 → 마이그 불필요·v3.0 백지 재구축**. 미해결: "독립 앱 vs SIREN 내 독립 모듈" 메인 판단 → Swain 확인 대기. 상세 docs/HANDOFF.md §3.2. |
| 2026-05-16 | **메인** | **버그 픽스 3차 진행 중** (이전 세션) — `93f89ca` #13 계정과목 503 + `6dc57a3` #14-B 발송 멈춤. 이후 본 세션에서 계정과목·매출카테고리·#7/#8 마감. |
| 2026-05-15 | **메인** | **버그 픽스 2차 ✅ 마감** (main @ `967b4a5`) — `unwrap()` 함수가 #2·#3·#4 공통 원인 정리. #10·#13·#1·#6·#7 fix. C 검증 PASS 12/0. |
| 2026-05-15 | **메인** | **버그 픽스 1차 ✅ 마감** (main @ `dcfdc0f`) — Phase 22 완결 후 라이브 버그 15건. **push 자동화 발효**, 검증 정책 "C 정적 + Swain 라이브" 정정. |
| 2026-05-15 | **메인** | **🎉🎉🎉 Phase 22 전체 완결** (main @ `9e73e98`) — 22-A 매출 / 22-B 재정 3부작 / 22-C 지출 / 22-D 전표 3부작 완결. |
> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
✅ 버그 픽스 3차 — 코드 작업 전부 완결 (2026-05-16, main @ 20af8b4 전부 푸시)
   - 계정과목 전면작업 / #9·#11 매출 카테고리 2단계 / #7·#8 정기후원 중복 경고 / 출금전표 예산 드롭다운
   - 마이그 호출·파일삭제·schema 활성화 완료
   - 남은 건 Swain 운영 작업뿐: #16 HTTPS · #14 발송 환경변수 · #3 효성 데이터 Neon 진단

📐 Phase 23 설계 라운드 — 진행 중 (★ 새 메인 핵심)
   - 정본: docs/교사유가족협의회_사단법인_예산시스템_기능설계도_v3.md
   - 골격: docs/milestones/2026-05-16-phase23-0-budget-foundation.md
   - 메인 판단: 계층적 하이브리드 (재활용 11 / 진화 7 / 신규 11)
   - Swain 확정: 전환=완성 즉시 / 재정 전체 더미 → 마이그 불필요·백지 재구축 / 과거기록 별도보관

   ★ 미해결 — 새 메인이 Swain에게 확인받을 첫 결정:
   "독립 앱 ❌ / SIREN 내 독립 모듈로 재정 모듈 전체 백지 재구축 ⭕" (메인 판단 제시 → Swain 확인 대기)
   + Q4 (후원·매출·보고서 경계) 추천 동의 여부
   → 확정 시: 23-0 설계서 갱신(마이그 절→백지 재구축) → 구현 트리거 작성 → A·B·C 병렬

🔧 도구 사용 주의
   - Edit: old/new_string 작게 쪼갤 것 (긴 코드 블록 전송 중 잘림)
   - Bash: cd 쓰지 말 것 (작업 폴더에 이미 위치, cd "한글경로" 깨짐)
   - 설명·검증: CLAUDE.md §6.14 — 함수명 말고 기능·시나리오 위주 (Swain 절대명제)

🔧 정책 (2026-05-15 발효, 유지)
   - push 자동화: feature/·fix/ 브랜치 push 자율. main·force는 ask/deny
   - UI 검증: Swain 라이브 직접 (AI 채팅 브라우저 자동화·어드민 계정 없음)
```

**Swain 운영 액션** (작업 흐름 외):
- 카카오 심사 통과 후 환경변수 2개 등록 (ALIGO_TEMPLATE_BILLING_FAILED, ALIGO_TEMPLATE_CARD_EXPIRING) → 자동 발송

---

## 4. 진행 중 작업

> 완료된 병렬 작업 분담 정의는 git history + `docs/milestones-archive.md` 참고.
> 새 병렬 작업 시작 시 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §4 템플릿 사용.

### 4.1 진행 중 작업 없음 — Phase 22 전체 완결

Phase 22 재정 시리즈(22-A·B·C·D) 전체 마감·운영 가능. 다음 트랙은 §3 후보 — Swain 협의 대기.
이전 완료 마일스톤 분담 정의는 `docs/HANDOFF.md` §3 + `docs/milestones-archive.md` 참조.

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
| **Phase 5~7 재정 관리** | ✅ 100% — 코드+BUG-5/6/7 fix+C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-phase5-7-finance.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| TypeScript 타입 에러 149건 | ✅ 100% — C 에러 149→0건 달성 (8e283dd, 로직 변경 없음) |
| **Phase 8 알림 채널 통합 인프라** | ✅ 100% — A 디스패처+마이그+cleanup / B 7자리 통합 / C 어드민 화면+Q24~Q27 라이브 통과 |
| **Phase 9 외부 API 실연동 + 수신 설정 UI** | ✅ 코드 100% — 9-A SMS·9-B 카카오 어댑터·9-B 수신 설정 UI / 9-B 라이브 검증 통과 (Q1) / C Q7-Q8 코드 정합성 PASS / 실발송은 환경변수 등록 후 자동 |
| **Phase 10 R1 템플릿 빌더** | ✅ 100% — 코드 머지 (8db8ffb·cef0f69) + C Q9 라이브 검증 통과 (2026-05-11). 업무 시나리오 클릭 테스트는 Swain 직접 (보고서 §6) |
| **Phase 10 R2 수신자 그룹** | ✅ 100% — 코드 머지 (7f2163b·b969bb2) + C 라이브 검증 통과 (2026-05-11, 보고서 `docs/verify/2026-05-11-phase10-r2.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 10 R3 발송 예약 큐** | ✅ 100% — 코드 머지 (897cad4·857674d) + C 라이브 검증 통과 + BUG-8 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase10-r3.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 10 R4 통합 마무리 (추적·AI·분석·재발송·이력)** | ✅ 100% — 코드 머지 완료 + C 라이브 검증 PASS + BUG-9 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase10-r4.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 11 멘션·구독** | ✅ 100% — 코드 머지 + C 라이브 검증 PASS + BUG 4건 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase11-12.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 12 신고 진행 공개 + 익명 강화** | ✅ 100% — 코드 머지 + C 라이브 검증 PASS + BUG 3건 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase11-12.md`). 업무 시나리오 클릭 테스트는 Swain 직접 |
| **Phase 13 신고 통계 대시보드** | ✅ 100% — 코드 머지 + C 라이브 검증 PASS + BUG 2건 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase13.md`) |
| **Phase 14 외부 기관 인계** | ✅ 100% — C 라이브 검증 PASS + BUG-14-07/08 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase14.md`) |
| **Phase 15 전문가 매칭 고도화** | ✅ 100% — C 라이브 검증 PASS + BUG-15-01~06 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase15.md`) |
| **Phase 16 통합 분석 대시보드** | ✅ 100% — C 라이브 검증 PASS + BUG-16-01/02 fix (2026-05-11, 보고서 `docs/verify/2026-05-11-phase16.md`) |
| **Phase 17 보안·감사 강화** | 🔵 B back + A front + 실API 연결 머지 완료 (마이그+schema 활성화 완료) / ⏸ C 라이브 검증 대기 |
| **Phase 18 성능 최적화** | 🟡 설계서 완성 / B 구현 진행 중 (feature/phase18-performance) |
| **Phase 19 자동 테스트 보강** | ✅ 설계서 완성 ([2026-05-11-phase19-healthcheck.md](docs/milestones/2026-05-11-phase19-healthcheck.md)) / ⏸ Phase 18 완료 후 B 트리거 |
| **Phase 20 어드민 UI/UX 리뉴얼** | Phase 20-A(완전 리뉴얼) ❌ 거부·폐기(2026-05-14 브랜치 3개 삭제) / Phase 20-B·20-C ✅ 점진 적용 완료(Cmd+K 검색·즐겨찾기 위젯·유가족·콘텐츠·시스템 그룹 등 main 머지·운영 중) / Phase 20 운영 안정성(모니터링+백업)은 별도 합의 필요 |
| **Phase 21 워크스페이스 v3 + 서비스 연동** | ✅ **100% 마감** (2026-05-12) — R1 (Q1~Q10 + BUG 2) / R2+R3 (Q1~Q16 + BUG 2) / R4 (Q1~Q18 + BUG 1) / 3개 라운드 모두 회귀 0 / 보고서 3종 docs/verify/2026-05-12-phase21-r1·r2r3·r4.md |
| **Phase 22-A 매출 통합 관리** | ✅ 100% 마감 (2026-05-15) — R1·R2·R3 합산 BUG 15건 해소 / 6 카테고리·승인·환불 누적·손익계산서·AI 도구 7개 / 운영 가능 |
| **Phase 22-C 지출 관리** | ✅ 100% 마감 (2026-05-15) — NPO 4분류 + 자유 추가·R2 영수증·승인·환불 누적·AI 도구 5개 / 운영 가능 |
| **Phase 22-B-R1 재정 화면 이전·기간 필터** | ✅ 100% 마감 (main @ `d28c833`, 2026-05-15) — 재정 6개 화면 통합 CMS 이전·지출 단일화·기간 필터 / C 검증 18/20 + BUG-016/017/018 fix / 옛 지출 데이터 0건 → NPO 4분류 통일 결정 |
| **Phase 22-B-R2 예산 편성·2단계 결재** | ✅ 100% 마감 (2026-05-15) — budget_plans+budget_lines·전년 실적 자동 채움·작성→상신→승인 / C 검증 11/12 + BUG fix |
| **Phase 22-D-R1 전표 시스템** | ✅ 100% 마감 (2026-05-15) — vouchers·계정과목 NPO 18개·증빙·예산 연결·반복 템플릿·AI 도구 4개 / C 검증 13/16 + BUG fix / 교차 확인 PASS |
| **Phase 22-B-R3 NPO 표준 회계 보고서** | ✅ 100% 마감 (main @ `c9f035a`, 2026-05-15) — 운영성과표+예산실적표·인쇄/엑셀/PDF·옛 테이블 코드 정리 / C 검증 12/0 + BUG-021 / **Phase 22-B 3부작 완결** |
| **Phase 22-D-R2 통장거래내역 자동화** | ✅ 100% 마감 (main @ `fc547f1`, 2026-05-15) — IBK 엑셀 클라이언트 파싱·입출금 대사 엔진·출금 전표 자동생성·거래처 마스터 자동학습 / C 검증 15/0 + BUG-1 fix |
| **Phase 22-D-R3 예산잠금·전표운영·재무제표** | ✅ 100% 마감 (main @ `9e73e98`, 2026-05-15) — 예산 잠금·지출결의서 인쇄·결산 보조·이상패턴 배지·반복전표 cron·재정상태표·현금흐름표 / C 검증 PASS 15/FAIL 3 → BUG-1~4 응답 키 fix / **Phase 22-D 완결·Phase 22 전체 마무리** |

**누적**: 약 82% / 약 755h+

---

## 6. 미해결 이슈 (Open Issues)

현재 미해결 0건. 모든 이슈 해결.

| ID | 발견 | 위치 | 심각도 | 상태 | 리포트 |
|---|---|---|---|---|---|
| ~~#BUG-9~~ | 2026-05-11 | `db/schema.ts` — `communicationSendRecipients`·`communicationSendJobs` 컬럼 누락 (R4 마이그 후 schema 미반영) | 🟠 High | ✅ 해결 (C verify R4 세션, tracking_token 등 6개 컬럼+인덱스 추가) | docs/verify/2026-05-11-phase10-r4.md §5 |
| ~~#BUG-8~~ | 2026-05-11 | `admin-send-job-create.ts:38` 어드민 ID NULL 저장 (BUG-5 회귀 클래스) | 🟠 High | ✅ 해결 (C verify R3 세션, 1줄 fix) | docs/verify/2026-05-11-phase10-r3.md §3 |
| ~~#BACKFILL-1~~ | 2026-05-10 | 효성 후원 결제일 NULL (44건) | 🟡 Medium | ✅ 해결 (2026-05-11) — 옛 자료 삭제 후 운영자 재 import 진행 (계약→수납 순서) | [docs/issues/2026-05-10-hyosung-paid-date-backfill.md](docs/issues/2026-05-10-hyosung-paid-date-backfill.md) |
| ~~#BUG-7~~ | 2026-05-10 | `admin-finance-expenditure-approve.ts` | 🟠 High | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-6~~ | 2026-05-10 | `admin-finance-expenditure-list.ts` | 🔴 Critical | ✅ 해결 (라이브 검증 대행 1차) | [docs/issues/2026-05-10-finance-expenditure-bugs.md](docs/issues/2026-05-10-finance-expenditure-bugs.md) |
| ~~#BUG-5~~ | 2026-05-10 | `admin-finance-{budget-upsert,expenditure-create,expenditure-approve}.ts` | 🔴 High | ✅ 해결 | [docs/issues/2026-05-10-finance-audit-columns-null.md](docs/issues/2026-05-10-finance-audit-columns-null.md) |
| ~~#BUG-2~~ | 2026-05-10 | `cms-tbfa.js:60-90` | 🟠 High | ✅ 해결 (마일스톤 #16 단계 B 545b523/f026c6b) | [docs/issues/2026-05-10-cms-tbfa-demo-data.md](docs/issues/2026-05-10-cms-tbfa-demo-data.md) |
| ~~#BUG-1~~ | 2026-05-09 | `lib/auth.ts:128` | 🔴 Critical | ✅ 해결 (bb529f9) | [docs/issues/2026-05-09-requireActiveUser-uid-bug.md](docs/issues/2026-05-09-requireActiveUser-uid-bug.md) |

**처리 원칙**: 새 이슈 발견 시 `docs/issues/{날짜}-{키워드}.md` 별도 파일 + 본 표에 한 줄 인덱스. 해결 후 상태 갱신.

**해결된 이슈 archive**: 2026-05-14 정리로 `docs/issues/` 12건은 [docs/issues-archive.md](docs/issues-archive.md)에 압축 통합 (147줄). 위 표의 옛 `docs/issues/X.md` 링크는 더 이상 존재하지 않음 — 본문은 git history 또는 archive 참조.

---

## 7. worktree 현황 (4채팅 새 구조)

> 2026-05-10 적용. 모델·역할 분배는 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §1.

| 폴더 | 채팅 | 모델 | 역할 | 영역 | 현재 상태 |
|---|---|---|---|---|---|
| `tbfa-mis` | **메인** | Opus 4.7 | 로직·DB 설계 + 머지·조율 | `docs/`, `PROJECT_STATE.md`, 머지 | Phase 22 전체 완결 / 다음 트랙 협의 대기 |
| `../tbfa-mis-A` | **A** | Sonnet 4.6 | 프론트 구현 | `public/`, `assets/` | ⏸ 다음 라운드 대기 |
| `../tbfa-mis-B` | **B** | Opus 4.7 | 백 구현 + AI 도구 | `netlify/functions/`, `lib/`, `db/`, `drizzle/` | ⏸ 다음 라운드 대기 |
| `../tbfa-mis-C` | **C** | Opus 4.7 | 라이브 검증 + fix | 모든 영역 (검증·fix 한정) | ⏸ 다음 라운드 대기 |
| `../tbfa-mis-D` | D | — | 휴면 (큰 단독 라운드 시 가동) | — | 휴면 |

**충돌 회피**: 폴더 단위 분리 → A·B 거의 0. 자세히 [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §3.

**머지 순서 강제**: B → 마이그 → schema 활성화 → A → C. [`docs/PARALLEL_GUIDE.md`](docs/PARALLEL_GUIDE.md) §5.

라운드 설계서 표준 양식: [`docs/PARALLEL_TEMPLATE.md`](docs/PARALLEL_TEMPLATE.md).

---

## 8. C 대기열 (Live-Verify Queue)

C(Opus 4.7)가 라이브 검증·fix·백필 대기 중인 작업. C는 매 세션 시작 시 큐에서 **가장 위 항목 1건**을 처리.

| # | 작업 | 종류 | 선행 조건 | 비고 |
|---|---|---|---|---|
| ~~Q-진단-2~~ | ~~#BACKFILL-1 백필 경로 결정·실행~~ | 마이그 갱신·실행 | — | ✅ 완료 — 자동 백필 불가 판정, Swain 결정으로 옛 효성 자료 삭제(897cad4). 재 import는 Swain 직접 (계약→수납 순서) |
| ~~Q4~~ | ~~6순위 #8 1:1 매칭 채팅 라이브 검증~~ | 라이브 검증 (지연된 검증) | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-rank6-08-matching-chat.md`). 페이지 4종 200·매칭/채팅 13개 함수 401·405 정상·BUG-4 fix 유지·회귀 0 |
| ~~Q5~~ | ~~Phase 4 대표 보고 시스템 V1·V2·V3 라이브 검증~~ | 라이브 검증 (지연된 검증) | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-phase4-report.md`). 페이지 200·API 4개 401·405 정상·BUG-3 fix 유지·AI 폴백 정합·회귀 0 |
| ~~Q6~~ | ~~Phase 5~7 재정 관리 라이브 검증~~ | 라이브 검증 (지연된 검증) | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-phase5-7-finance.md`). API 7개 401·405 정상·BUG-5/6/7 fix 유지·예산/지출/수입/보고서 정합성·회귀 0 |
| ~~Q7~~ | ~~Phase 9-A SMS 실 발송 검증~~ | 코드 정합성 | — | ✅ 2026-05-11 PASS. 실발송은 Aligo 3개 등록 후 자동. |
| ~~Q8~~ | ~~Phase 9-B 카카오 알림톡 실 발송 검증~~ | 코드 정합성 | — | ✅ 2026-05-11 PASS. 실발송은 심사 통과 후 환경변수 2개 등록 시 자동. |
| ~~Q9~~ | ~~Phase 10 R1 템플릿 빌더 검증~~ | 라이브 검증 | — | ✅ 2026-05-11 통과 (보고서 `docs/verify/2026-05-11-phase10-r1.md`). 페이지 4종 200·API 6개 401 정상·Q1~Q8 모두 PASS·회귀 0 |

**완료**: ~~Q1~~ Phase 9-B 라이브 (2026-05-10 통과) / ~~Q2~~ #BACKFILL-1 마이그 작성 (2026-05-10 main 안착) / ~~Q-진단~~ 진단 보강 + import 코드 분석 (2026-05-11) / ~~Q3~~ 6순위 #16 단계 D 라이브 (2026-05-11 통과) / ~~Q9~~ Phase 10 R1 라이브 (2026-05-11 통과) / ~~Q4~~ 6순위 #8 1:1 매칭 채팅 (2026-05-11 통과) / ~~Q5~~ Phase 4 대표 보고 시스템 (2026-05-11 통과) / ~~R2~~ Phase 10 R2 (2026-05-11 통과) / ~~Q6~~ Phase 5~7 재정 관리 (2026-05-11 통과) / ~~Q7~~ SMS 코드 정합성 (2026-05-11) / ~~Q8~~ 카카오 코드 정합성 (2026-05-11) / ~~R4~~ Phase 10 R4 라이브 검증 PASS + BUG-9 fix (2026-05-11)

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
- 영구 스냅샷: [`docs/handover/v20.md`](docs/handover/v20.md)
