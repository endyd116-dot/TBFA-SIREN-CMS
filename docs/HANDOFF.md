# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/)에 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-10 / 새 메인 채팅 인수인계 — 모든 병렬 작업 main 안착 (`64330e0`)

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

## 6. 새 메인이 즉시 할 일

### 6-1. 우선 — Swain 라이브 검증 결과 흡수 (또는 C 대행 위임)

다음 항목들이 라이브 검증 대기 상태:

| 항목 | 검증 포인트 |
|---|---|
| Phase 5~7 수입 현황 | 차트·KPI·연도 변경 정상 |
| Phase 5~7 예산·지출 | 편성 → 재편성(ON CONFLICT UPDATE) → 지출 등록(draft) → 승인(approved + approved_by 본인 ID) → 반려 → 재승인 차단 |
| Phase 5~7 보고서 | 연간/분기/월간 + 엑셀 다운 + 인쇄 |
| 단계 D | 효성 CSV import (회원번호→전화→신규생성 3단), 수납 import 후 잠재→정기 즉시 반영, D7 대시보드 KPI 클릭 이동 |
| Phase 4 V1·V2·V3 | 보고서 생성·이메일 재발송·인쇄 (BUG-3 fix 검증) |
| #8 V1-A·B·C | 매칭 배정 + 마이페이지 채팅 버튼 (BUG-4 fix 검증) |
| #6·#15 | 자격 변경 / CSV 자동 매핑 |

**접근 옵션**:
- A안: Swain이 직접 라이브 검증 (전통 방식)
- B안: C에게 대행 정책 첫 적용 (`docs/HANDOFF_C.md` §1-B — netlify dev + curl + DB 직접) — **추천**

### 6-2. 다음 — 새 병렬 라운드 분배 (라이브 검증 통과 후)

§7 참조 — A·B·C 분배안 준비 완료.

### 6-3. 그 다음 — Phase 8~22 설계

`docs/REMAINING_WORK.md` 정독 → Phase 8 첫 묶음 후보 3~5개 추출 → Swain과 우선순위 합의 → 설계서 1~2개.

---

## 7. 다음 병렬 라운드 분배안 (즉시 시작 가능)

### A 채팅 — 단계 D 보강 (D4 매월 수납 현황)

```
[A 채팅 — 단계 D 보강 — 매월 수납 현황 합산]

워크트리: ../tbfa-mis-A
브랜치: 새로 분기 — feature/m16-step-d-monthly-billing (베이스 main @ 64330e0)
추정: 1.5~2h

배경: B 단계 D 머지 시 D4 "매월 수납 현황" 항목이 의도적으로 제외됨.
이유: hyosung_billings 데이터 적재 후 admin-donor-regular-list.ts에서 fallback 합산이 필요했고
A의 import 작업(cce5e6a)이 머지된 지금 가능해짐.

작업:
  1) admin-donor-regular-list.ts 응답에 매월 수납 현황 필드 추가
     - hyosung_billings 테이블에서 회원별 최근 N개월 수납 합산
     - donations 테이블 토스 채널 합산과 병합
     - 응답 키: monthlyBillings = [{month, amount, channel, status}]
  2) public/js/cms-tbfa.js 정기후원자 화면에서 위 필드 사용
     - "매월 N일" 옆에 최근 3개월 수납 점등 (✓·✗·- 같은 시각화)
     - B의 d9b49b0 패턴 따라 캐시버스터 d4로 갱신

영역 회피:
  - lib/hyosung-*-parser.ts (A의 이전 작업 — 변경 없음)
  - cms-tbfa.html 구조 (B 영역 — 셀 추가만 가능)

머지 전 체크:
  - hyosung_billings 비어있는 케이스(데이터 없음) 빈 배열 처리
  - 응답 키 다중 fallback (CLAUDE.md §6.4)
  - 캐시버스터 갱신
```

### B 채팅 — 단계 D 보강 (D7 자동 매칭 미리보기)

```
[B 채팅 — 단계 D 보강 — 자동 매칭 + 상태 전이 미리보기]

워크트리: ../tbfa-mis-B
브랜치: 새로 분기 — feature/m16-step-d-csv-preview (베이스 main @ 64330e0)
추정: 2~3h

배경: B 단계 D 머지 시 "자동 매칭 + 상태 전이 미리보기" 의도적 제외.
이유: csv-import 탭 영역이라 D7 검증 대시보드 범위 외 — 별도 작업으로 분리.

작업:
  1) cms-tbfa.html csv-import 섹션에 미리보기 패널 추가
     - 업로드 후 매칭 결과 임시 행 표시 (확정 전)
     - 어떤 회원이 어떤 donor_type으로 바뀔지 표시 ("일시 → 정기" 화살표 등)
  2) cms-tbfa.js 매칭 결과 분류 + 미리보기 렌더
     - 자동 매칭 / 수동 매칭 필요 / 신규 생성 후보 3분류
     - 확정 버튼 클릭 시 실제 적용 (기존 admin-donation-confirm.ts 호출)
  3) admin-donation-pending-list.ts 응답에 상태 전이 정보 추가 (필요 시 — 기존 데이터로 충분하면 백엔드 변경 없음)

영역 회피:
  - lib/donation-matcher.ts (검증된 매칭 알고리즘 — 변경 없음)
  - admin-donation-confirm.ts (확정 로직 — 기존 사용)
  - members 테이블 컬럼 추가 없음

머지 전 체크:
  - 빈 CSV 업로드 케이스 가드
  - 매칭 결과 0건 케이스 안내
  - 캐시버스터 갱신 (cms-tbfa.js?v=2026-05-10-d5)
```

### C 채팅 — 사용자 검증 대행 정책 첫 적용 (라이브 검증)

```
[C 채팅 — 사용자 검증 대행 정책 첫 적용 — Phase 5~7·단계 D·지연 검증]

워크트리: ../tbfa-mis-C @ verify/phase4-and-pending (또는 verify/live-comprehensive 신설)
정책: docs/HANDOFF_C.md 정독 (재정의됨 — 549f0b8)
방법: netlify dev + curl로 어드민 토큰 획득 → API 단위 호출 + DB 직접 SELECT
추정: 5~8h (큐 14건)

진행 순서:
  ★ 즉시
    Q11. /admin.html 재정 관리 메뉴 정적 시뮬레이션 (admin.js 라우터)
    Q12. 수입 현황 라이브 (income-summary 응답·계산 정확도)
    Q13. 예산·지출 라이브 (편성→재편성→등록→승인→반려→재승인 차단)
    Q14. 재무 보고서 라이브 (연간/분기/월간 + 엑셀 정적 + 인쇄 정적)

  ★ 단계 D 라이브
    Q15. 효성 회원관리 import (admin-hyosung-import-contracts) 라이브 + DB 사이드이펙트
    Q16. 효성 수납내역 import safeReevaluate 동작 검증
    Q17. B 단계 D D3·D4·D7 화면 정적 시뮬레이션

  ★ 지연 검증 (라이브)
    Q18~Q20: Phase 4 V1·V2·V3 라이브 (이메일 도착은 Swain 시각 위임만)
    Q21: #6 자격 변경 신청·승인 + members.eligibilityType 갱신
    Q22: #8 매칭 V1-A/B/C + chat_sessions INSERT
    Q23: #15 CSV 업로드 → 매칭 → 확정 흐름

발견 이슈:
  - 자체 fix → main 머지 (Swain 컨펌 없이) → PROJECT_STATE 갱신
  - 시각 확인 필수만 docs/verify/visual-N.md (스크린샷 위치·체크 항목·예상 결과)

A·B 영역 회피:
  - A 신규 작업: admin-donor-regular-list.ts (다음 라운드 — Q15~Q17과 충돌 시 메인 보고)
  - B 신규 작업: cms-tbfa.html csv-import 섹션 (다음 라운드)

사전 준비 보고:
  1) npm run dev 동작 가능 여부 (포트 8888)
  2) .env에 어드민 계정 존재 여부 (없으면 메인에 1회 요청)
  3) Q11 시작 시점
```

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
