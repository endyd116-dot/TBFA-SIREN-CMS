# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/)에 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-10 / Phase 8 라운드 시작 + C 라이브 1차(Phase 5~7 통과, BUG-6·7 fix) 흡수 (`0c08f45`)

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼. 후원·회원관리·유족지원·SIREN 신고·게시판·1:1 채팅·워크스페이스·AI 비서를 한 곳에서 운영.

- 라이브: <https://tbfa-siren-cms.netlify.app>
- 베이스 브랜치: `main` @ **`64330e0`**
- 상세 스택·환경·구조는 [`CLAUDE.md`](../CLAUDE.md) §1~5

---

## 2. 지금 막 끝난 일 (이번 세션)

**2026-05-10 메인 채팅 (이전)** 가 다음을 일괄 처리했다:

1. **Phase 4 A·B 머지** (이전 세션 직전부터 이어진 대표 보고 시스템) — 100% 코드 안착
2. **4-way 병렬 라운드 운영** — A·B(단계 D)·C(검증)·D(Phase 5~7)
3. **Phase 5~7 재정 관리 — 100% 코드+마이그+검증** (`b0a6279` → `8023057` → `a3f58ef`)
   - 새 테이블 3종(budget_categories/budgets/expenditures) 마이그 호출 완료
   - schema.ts 정의 활성화 + 마이그 파일 삭제
   - C가 Q7~Q10 정적 검증 + BUG-5 fix(감사 추적 컬럼 영구 NULL — `auth.ctx.admin.uid` 직접 참조로 통일)
4. **A 단계 D 머지** (`cce5e6a`) — 효성 CSV import Gap 보강
   - `lib/hyosung-members-parser.ts` 신규 (`upsertMemberFromContract` — 회원번호→전화→신규생성 3단)
   - `admin-hyosung-import-billings.ts` safeReevaluate 1줄 추가 → 잠재 후원자 즉시 반영
   - donor_type cron 의존 제거
5. **B 단계 D 머지** (`d9b49b0`) — D3·D4·D7 화면 폴리시
   - 통합회원 효성 계약 셀 2줄 + 정기후원자 매월 N일 + 검증 대시보드 alert 뱃지·KPI 클릭 이동
   - 캐시버스터 `cms-tbfa.js?v=2026-05-10-d3`
6. **사용자 검증 대행 정책 도입** (`549f0b8`) — `docs/HANDOFF_C.md` 재정의
   - Swain의 라이브 검증 부담을 C가 흡수 (netlify dev + curl + DB 직접 검증)
   - **다음 병렬 라운드부터 적용** (이번 라운드는 기존 정책으로 종결)

전 머지 결과: `64330e0`에 모든 병렬 작업 main 안착.

---

## 3. 진행 상황 한눈에

| 묶음 | 상태 |
|---|---|
| Phase 1 효성 CMS+ | ✅ 100% |
| Phase 2 토스 빌링 자동청구 | ✅ 100% |
| Phase 3 워크스페이스 본체 + 파일함 | ✅ 100% |
| 4순위 자잘한 버그 3건 | ✅ 100% |
| 5순위 #1 / #9 / #10 | ✅ 100% |
| 6순위 #6 자격 변경 | ✅ 코드+정적 100% / 🟡 라이브 미검증 |
| 6순위 #15 CSV + 엑셀 | ✅ 코드+정적 100% / 🟡 라이브 미검증 |
| 6순위 #16 단계 A·B·C | ✅ 100% (이전 세션) |
| 6순위 #16 단계 D | ✅ 코드 100% (`3a932c3`) / 🟡 라이브 미검증 |
| 6순위 #8 1:1 매칭 채팅 | ✅ 코드 + BUG-4 fix / 🟡 라이브 미검증 |
| Phase 4 대표 보고 시스템 | ✅ 코드 + BUG-3·4 fix / 🟡 라이브 V1·V2·V3 미검증 |
| **Phase 5~7 재정 관리** | ✅ 코드+마이그+schema+정적 (BUG-5 fix) / 🟡 라이브 미검증 |
| TypeScript 타입 에러 149건 | 🔵 C 장기 진행 |
| Phase 8~22 (15개) | ⏸ 스펙 미정 — 설계 세션 필요 |

**누적**: 약 45% / 약 440h+

---

## 4. 미해결 이슈 (Open)

현재 0건. 해결 이력은 `PROJECT_STATE.md` §6 참조.

---

## 5. worktree 현황

| 폴더 | 브랜치 | 상태 |
|---|---|---|
| `tbfa-mis` (메인) | `main` @ `64330e0` | 활성 — 새 메인 인수인계 시점 |
| `../tbfa-mis-A` | `feature/m16-step-d-parser` | ✅ 머지 완료 — 다음 라운드 대기 |
| `../tbfa-mis-B` | `feature/m16-step-d-ui` | ✅ 머지 완료 — 다음 라운드 대기 |
| `../tbfa-mis-C` | `verify/phase4-and-pending` | ✅ Q1~Q4·Q7~Q10 / 🔵 Q5·Q6 진행 중 |
| `../tbfa-mis-D` | `feature/finance-phase5-7` | ✅ 머지 완료 — 다음 라운드 대기 (D는 휴면 가능) |

---

## 6. 현재 진행 상황 (메인 휴면 상태)

### 6-1. Phase 8 라운드 시작 (2026-05-10)

| 채팅 | 상태 | 작업 |
|---|---|---|
| **A** | 🟢 진행 중 (인터페이스 초안 보고 단계) | 알림 디스패처 + DB + 이벤트 카탈로그 + 재시도 cron |
| **B** | ⏸ 대기 (A 머지 후 시작) | 7개 미구현 자리(워크스페이스·토스 빌링·카드 만료·어드민 브리핑) 디스패처 통합 |
| **C** | 🟢 진행 중 (라이브 검증 대행 — Q11~Q14 ✅ / Q15~Q23 진행) | Phase 5~7 통과·BUG-6·7 fix 머지 / 단계 D·Phase 4·#6·#8·#15 라이브 다음 |

### 6-2. 라이브 미검증 카탈로그 (C 대행 진행 중)

| 항목 | 검증 포인트 | 상태 |
|---|---|---|
| Phase 5~7 수입 현황·예산·지출·보고서 | 편성→재편성→승인→반려→재승인 차단 | ✅ 통과 (BUG-6·7 fix `cbf40e6`) |
| 단계 D | 효성 CSV import 3단·수납 import safeReevaluate·D7 대시보드 | ⏸ 다음 |
| 단계 D 보강 | A: 매월 수납 6개월 점등·B: CSV 미리보기 3-버킷 | ⏸ 다음 |
| Phase 4 V1·V2·V3 | 보고서·이메일 재발송·인쇄 | ⏸ 다음 |
| #6·#8·#15 | 자격 변경·1:1 매칭·CSV 자동 매핑 | ⏸ 다음 |

### 6-3. 메인 다음 액션

- A 인터페이스 초안 보고 도착 → 9종 카탈로그·params·target 구조 검토 후 컨펌
- C 라이브 검증 결과 도착 → 회귀 발견 시 즉시 fix 또는 에스컬레이션
- 둘 다 끝나면 Phase 8 B 라운드 트리거 + Phase 9 외부 서비스 비교 세션
- 그 후 Phase 10~22 (13묶음) 설계 합의 세션

---

## 7. Phase 8 라운드 분배안 (현재 라운드)

설계서: [docs/milestones/2026-05-10-notifications.md](milestones/2026-05-10-notifications.md)

머지 순서: **A → B + C 동시** (B·C는 A 인터페이스 사용)

### A 채팅 — Phase 8 디스패처 + DB + 이벤트 카탈로그 (🟢 진행 중)

워크트리: `../tbfa-mis-A` / 브랜치: `feature/phase8-notify-dispatcher` / 베이스: `main @ 428eb6a` / 추정: 4~5h

핵심 산출물:
- `lib/notify-dispatcher.ts` — `dispatch({event, target, params})` 진입점
- `lib/notify-events.ts` — 이벤트 카탈로그 9종 enum + 기본 채널 정책 (설계서 §3.2)
- `lib/notify-adapters/{inapp,email,sms-placeholder,kakao-placeholder}.ts`
- `notification_dispatch_logs` 테이블 마이그 + schema 정의 (설계서 §3.5)
- `cron-notification-retry.ts` — 1분 주기, 지수 백오프 (1s→5s→25s) 후 dead-letter

선결 단계: 코드 시작 전 인터페이스 초안을 메인에 보고 → 메인 컨펌 후 본격 작업.

### B 채팅 — 7개 미구현 자리 통합 (⏸ A 머지 후 시작)

워크트리: `../tbfa-mis-B` / 브랜치: `feature/phase8-notify-integration` / 베이스: A 머지 후 main / 추정: 3~4h

대상 7자리:
- `lib/workspace-logger.ts:131` (워크스페이스 활동)
- `cron-toss-billing.ts:338·394·414` (빌링 성공·해지·실패)
- `cron-billing-card-expiry.ts:233·235` (카드 만료 d-7/d-3/d-1)
- `cron-agent-8.ts` (어드민 일일 브리핑 이메일 자동발송)

회귀 0 보장: 기존 인앱 INSERT 그대로 유지 + 디스패처 호출 추가.

### C 채팅 — Phase 8 발송 로그 어드민 화면 + 라이브 검증

선결: 현재 라이브 검증 대행(Q11~Q23) 진행 중. 그 종료 후 Phase 8 작업 시작.

핵심 산출물:
- `admin-notification-logs.ts` (읽기전용) + `public/admin-notification-logs.html`
- 채널별 성공률·실패 사유 상위 N
- A·B 머지 후 라이브 한 사이클 (Q24~Q28: 카드 만료 d-1·빌링 결과·워크스페이스·일일 브리핑·강제 실패→dead-letter)

---

## 8. 새 메인 시작 메시지 (복붙 그대로)

```
[새 메인 채팅 — 컨텍스트 한계로 인수인계, 라이브 검증 + 다음 병렬 라운드 분배]

main @ 64330e0. 이전 메인이 다음을 끝냈다:
  ✅ Phase 5~7 재정 관리 100% (코드+마이그+schema+정적+BUG-5 fix)
  ✅ A 단계 D 머지 (효성 import Gap 보강 — cce5e6a)
  ✅ B 단계 D 머지 (D3·D4·D7 화면 폴리시 — d9b49b0)
  ✅ C Phase 5~7 정적 검증 (BUG-5 — auth.ctx.admin.uid 통일)
  ✅ 사용자 검증 대행 정책 도입 (549f0b8 — 다음 라운드부터 적용)

지금 상태:
  - 모든 병렬 작업 main 안착, A·B·C·D 모두 머지 후 대기
  - 라이브 미검증 항목 누적 (Phase 4 V1·V2·V3, #6·#8·#15, Phase 5~7, 단계 D)

지금 해야 할 일 (우선순위):

  1) docs/HANDOFF.md §6 정독 (5분)
     - 라이브 검증 대상 카탈로그
     - C 대행 정책 첫 적용 가능 시점

  2) 라이브 검증 트리거 — Swain 의향 확인
     A안) Swain 직접 라이브 검증
     B안) C에게 대행 정책 첫 적용 위임 (docs/HANDOFF.md §7 C 메시지 그대로 발송)
     → B안 추천 (C는 이미 정적 검증 노하우 + 정책 정의 완료)

  3) 다음 병렬 라운드 시작 — 라이브 검증 진행 중에 병렬 가능
     - A: 단계 D 보강 (D4 매월 수납 현황) — docs/HANDOFF.md §7 A 메시지
     - B: 단계 D 보강 (D7 자동 매칭 미리보기) — docs/HANDOFF.md §7 B 메시지
     - C: 라이브 대행 (위 2) 통합)
     - D: 휴면 (Phase 8 설계 합의 후 활용)

  4) Phase 8~22 설계 합의 (라이브 통과 후)
     docs/REMAINING_WORK.md 정독 → Phase 8 첫 묶음 후보 3~5개 → Swain 합의 → 설계서

CLAUDE.md §14 컨텍스트 다이어트 정책 준수:
  - PROJECT_STATE.md 정독, HANDOFF.md §6·§7만 발췌, CLAUDE.md 재정독 X
  - 큰 코드 파일은 Explore subagent 위임
  - Read 시 limit/offset, 같은 파일 재독 금지

준비됨 보고 + Swain에 라이브 검증 트리거 의향 묻기.
```

---

## 9. 참고 문서 (정독 우선순위)

1. [`PROJECT_STATE.md`](../PROJECT_STATE.md) — 휘발성 상태 (정독)
2. **본 문서 §6·§7** (정독)
3. [`docs/HANDOFF_C.md`](HANDOFF_C.md) — C 정책 재정의 (C 위임 시)
4. [`docs/PARALLEL_GUIDE.md`](PARALLEL_GUIDE.md) — 병렬 작업·머지 (새 라운드 분배 시)
5. [`docs/REMAINING_WORK.md`](REMAINING_WORK.md) — Phase 8~22 후보 (설계 합의 시)
6. [`docs/milestones/2026-05-10-finance.md`](milestones/2026-05-10-finance.md) — Phase 5~7 설계서 (라이브 검증 참고)
7. [`docs/milestones/2026-05-10-donor-system.md`](milestones/2026-05-10-donor-system.md) — 단계 D 설계서

CLAUDE.md는 자동 로드. 재독 금지.

---

**마지막 갱신**: 2026-05-10 / 메인 채팅 (인수인계 시점) / 모든 병렬 작업 main 안착 (`64330e0`)
