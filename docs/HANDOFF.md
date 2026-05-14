# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v20.md`](handover/v20.md) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-15 / **Phase 22-B-R2·22-D-R1 마감 + 22-B-R3 착수 대기** / main @ `7d080b8`

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa.co.kr> (공식 메인) / <https://tbfa-siren-cms.netlify.app> (Netlify 기본)
- 베이스 브랜치: `main`
- 상세 스택·환경·구조: [`CLAUDE.md`](../CLAUDE.md) §1~5

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독
2) PROJECT_STATE.md §2·§3·§5·§7 정독
3) docs/PARALLEL_GUIDE.md §1~§19 정독
4) memory/MEMORY.md 인덱스 + feedback_* 메모리 본문 정독
5) 본 §3 (지금 진행 중인 일) 확인
6) 22-B-R3 B·A 완료 보고 받으면 머지 진행
```

---

## 3. 지금 진행 중인 일

### 3.1 Phase 22-B-R3 — NPO 표준 회계 보고서 (착수 대기, 2026-05-15 설계 완성)

| 채팅 | 브랜치 | 담당 | 상태 |
|---|---|---|---|
| A | feature/phase22b-r3-front | 🎨 운영성과표·예산실적표 2탭 정식화 + 인쇄·엑셀·PDF | 트리거 발송 |
| B | feature/phase22b-r3-back | 🔧 PDF 생성 함수 + 옛 테이블 코드 정리 | 트리거 발송 |
| C | tbfa-mis-C | 🔍 검증 Q1~Q12 | B·A 머지 후 |

**설계서**: [`docs/milestones/2026-05-15-phase22b-r3-accounting-reports.md`](milestones/2026-05-15-phase22b-r3-accounting-reports.md)
**핵심**: 운영성과표 + 예산 대비 실적표 / 인쇄·엑셀·PDF / 22-B-R1 기간 필터 재사용 / 옛 테이블(budgets·budget_categories·expenditures) 코드 정의 제거.
**재사용 중심**: 데이터 API는 `pl-summary`·`budget-list` 그대로, 신규는 PDF 생성 함수만.

### 3.2 Phase 22-B-R2 + 22-D-R1 — 마감 (2026-05-15)

| 라운드 | 결과 |
|---|---|
| 22-B-R2 예산 편성 | budget_plans·budget_lines + API 9개 + 전년 실적 자동 채움 + 2단계 결재 / C 검증 11/12 |
| 22-D-R1 전표 시스템 | vouchers·account_codes(18개)·bank_* + API 10개 + 반복 템플릿 / C 검증 13/16, 교차 확인 PASS |
| BUG fix | BUG-019(AI 도구 그룹 누락)·BUG-020(전표 승인 action) 자체 fix 머지 |
| 핵심 커밋 | `a239eb9`(B) `6548f2c`(A) `4251509`(마이그) `7d080b8`(BUG fix) |
| 메타 경고 | AI 도구 그룹 갱신 3라운드 연속 누락 → 메모리에 갱신 의무 5곳 명문화 |

설계서: `phase22b-r2-budget-planning.md` / `phase22d-r1-voucher-bank-import.md`
검증 보고서: `docs/verify/2026-05-15-phase22-r2d1.md`

### 3.3 Phase 22-B-R1 — 마감 (2026-05-15)

재정 화면 6개 통합 CMS 이전 + 지출 시스템 단일화 + 기간 필터.

| 항목 | 결과 |
|---|---|
| A 프론트 | 재정 6개 화면 admin.html→cms-tbfa.html 이전 + 기간 선택기 (donations 포함, A 자율 완료) |
| B 백엔드 | 지출 단일화 코드 전환 + 기간 필터(period) + AI 도구 정리 |
| 마이그레이션 | 옛 지출 데이터 0건 진단 → 함수 삭제 (실행 불필요) |
| 카테고리 | NPO 4분류 통일 결정 — budget_categories 재편은 22-B-R2로 이관 |
| C 검증 | PASS 18/20 → BUG-016/017/018 자체 fix |
| 핵심 커밋 | `cdf8304`(B) `f173389`(A) `182728e`(진단반영) `d28c833`(BUG fix) |

설계서: [`docs/milestones/2026-05-15-phase22b-r1-finance-relocation.md`](milestones/2026-05-15-phase22b-r1-finance-relocation.md)
검증 보고서: `docs/verify/2026-05-15-phase22b-r1.md`

### 3.4 Phase 22-A·22-C — 완전 마감 (2026-05-15 새벽)

매출 통합 관리(22-A) + 지출 관리(22-C). R1·R2·R3 합산 BUG 15건 전부 해소. 운영 가능.
상세는 [`docs/milestones-archive.md`](milestones-archive.md) + 메모리 `project_ai_cost_safety.md`.
22-A-R3 cleanup(`9817e89`)도 22-B-R1과 함께 머지 완료.

---

## 4. 즉시 해야 할 일 (새 메인)

```
1. 22-B-R3 B·A 완료 보고 대기 → 머지 (B 백엔드 먼저 → A 프론트)
2. B의 PDF 함수 + 옛 테이블 정리 머지 → tsc 신규 에러 0건 확인
3. B·A 머지 완료 → C 검증 트리거 발행 (22-B-R3 설계서 §8.3)
4. C 검증 BUG fix 머지 → 22-B-R3 마감 → Phase 22-B 3부작 완결
5. 후속: 22-D-R2 통장 자동화 / tsc 묵은 에러 14건 정리 / vouchers FK 마이그
```

---

## 5. 채팅 구조 (현재 — A·B·C, 22-B-R3 착수 대기)

| 채팅 | 모델 | 워크트리 | 역할 | 현재 상태 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | 설계·머지·조율·문서 | 22-B-R2·22-D-R1 마감, 22-B-R3 트리거 발송 |
| A | Sonnet 4.6 | tbfa-mis-A | 프론트 | ⏸ 22-B-R3 `feature/phase22b-r3-front` 트리거 대기 |
| B | Opus 4.7 | tbfa-mis-B | 백엔드 + AI 도구 | ⏸ 22-B-R3 `feature/phase22b-r3-back` 트리거 대기 |
| C | Opus 4.7 | tbfa-mis-C | 검증 + fix | ⏸ 22-B-R3 B·A 머지 후 검증 |

---

## 6. 핵심 정보

### 6.1 반복 사고 패턴 방지 (PARALLEL_GUIDE §10·§19 통합)

| 날짜 | 사고 | 방지 |
|---|---|---|
| 2026-05-09 | worktree 미분리 충돌 | worktree 강제 |
| 2026-05-09 | schema 영역 덮어쓰기 | schema append-only 섹션 헤더 |
| 2026-05-09 | #BUG-1 `uid` 필드명 오류 | 헬퍼 도입 직후 사용처 1회 검증 |
| 2026-05-10 | bigserial import 누락 502 | push 전 `npx tsc --noEmit` 의무 |
| 2026-05-11 | A가 PROJECT_STATE 자발 수정 → 충돌 | A·B·C는 PROJECT_STATE·docs 수정 금지 |
| 2026-05-14 | 트리거 오발송 (A·B 둘 다 프론트) | 트리거 영역 라벨 🔧🎨🔍 (§13) |
| 2026-05-14 | "응답 키 호환 = 머지 불필요" 오판 | git log origin/main..feature/X 확인 (§15) |
| 2026-05-14 | 옛 main 베이스 브랜치 머지 | 선택적 체크아웃 패턴 (§16) |
| 2026-05-15 | A·B가 PowerShell·git 권한 재질문 | settings.json `Bash(*)`·`PowerShell(*)` allow + 트리거에 권한질문 금지 명시 |
| 2026-05-15 | R3 옛 베이스 머지 → ai-agent-tools 충돌 | 충돌 해소 시 최신(period) 버전 살림 |
| 2026-05-15 | B가 PROJECT_STATE 무단 변경(트리거 위반) | 머지 시 PROJECT_STATE 변경분 차단 (코드 파일만) |
| 2026-05-15 | A가 옛 베이스 분기 → cms-tbfa.html 충돌 | 트리거에 "git pull 후 main 최신 분기" 강조 |
| 2026-05-15 | AI 도구 그룹 갱신 3라운드 연속 누락 | 메모리에 AI 도구 신설 시 갱신 의무 5곳 명문화(④ admin-ai-agent.ts TOOL_GROUPS) |

### 6.2 마이그레이션 호출 표준

```
어드민 로그인 상태에서 주소창:
https://tbfa.co.kr/api/migrate-{이름}?run=1
→ { "ok": true } 확인 후 메인에 알림
→ 메인: schema 활성화 + 마이그 파일 삭제 + push
※ 진단 모드(?run= 없이)는 인증 불필요 — Swain이 브라우저로 먼저 호출
```

### 6.3 requireAdmin 패턴 (반드시 준수)

```typescript
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

const auth = await requireAdmin(req);
if (guardFailed(auth)) return auth.res;  // TS2339 narrowing fix
const adminUid = auth.ctx?.admin?.uid;   // id 아님
```

### 6.4 P&L 응답 키 구조 (22-A·22-C 통합 후 표준)

```json
{
  "revenue": {
    "donations": { "gross": N, "refund": N, "net": N },
    "other": { "gross": N, "refund": N, "net": N, "byCategory": [...] },
    "totalNet": N
  },
  "expenditure": { "total": N, "gross": N, "refund": N, "byCategory": [...] },
  "netIncome": N,
  "monthly": [{ "month": 1, "revenue": N, "expenditure": N, "net": N }]
}
```
> 22-B-R1 기간 필터: `period`(day|week|month|half_year|year|custom) + `startDate`/`endDate`,
> `fiscalYear` 하위호환. `lib/period-filter.ts` 공용 헬퍼.

### 6.5 알려진 기술 부채

- **tsc 묵은 에러 14건**: `admin-report-status-update.ts`·`migrate-phase22a-c-seed.ts`·`user-mention-read.ts`·`user-post-subscribe.ts` 등. 22-B 작업과 무관, Netlify(esbuild)는 배포 영향 없음. 정리 라운드 필요.

---

## 7. Phase 진행률 스냅샷

| 묶음 | 상태 |
|---|---|
| Phase 1~17 | ✅ 100% (Phase 17 BUG-17-04·05 후속 권고) |
| Phase 18 성능 최적화 | 🟡 설계 완료 / 미착수 |
| Phase 19 자동 테스트 | ✅ 설계 / ⏸ 미착수 |
| Phase 20 어드민 UI | 20-A ❌ 거부 / 20-B·20-C ✅ |
| Phase 21 워크스페이스 v3 | ✅ 100% |
| Phase 22-A 매출 통합 관리 | ✅ 100% (BUG 15건 해소) |
| Phase 22-C 지출 관리 | ✅ 100% |
| **Phase 22-B-R1 재정 화면 이전·기간 필터** | ✅ 100% (BUG 3건 해소) |
| **Phase 22-B-R2 예산 편성·2단계 결재** | ✅ 100% (C 검증 11/12 + BUG fix) |
| **Phase 22-D-R1 전표 시스템** | ✅ 100% (C 검증 13/16 + BUG fix, 교차 확인 PASS) |
| **Phase 22-B-R3 NPO 표준 회계 보고서** | 🔵 설계 완성·트리거 발송 (착수 대기) |
| Phase 22-D-R2/R3 통장 자동화·AI 부가기능 | ⏸ 22-B-R3 이후 |

누적 약 **75%** / 약 710h+

---

## 8. AI 에이전트 v3 (참고 — 종료된 시스템)

**상태**: 개발 종료(2026-05-14). 현재 도구 **97개** (22-A 7 + 22-C 5 + 22-B-R2 예산 3 + 22-D-R1 전표 4 추가).
**표준 문서**: [`docs/standards/AI_AGENT_PLATFORM_STANDARD.md`](standards/AI_AGENT_PLATFORM_STANDARD.md) v1.4
자세한 내용은 메모리 `project_ai_cost_safety.md` 정독.
⚠️ AI 도구 신설 시 갱신 의무 **5곳** — ④ `admin-ai-agent.ts` TOOL_GROUPS 3라운드 연속 누락(BUG-009→016→019). 메모리 참조.

---

## 9. 새 메인 첫 메시지 권장

```
인수인계 정독 완료.

현재 상태:
- Phase 22-A·22-C·22-B-R1·22-B-R2·22-D-R1 ✅ 마감 (main @ 7d080b8)
- Phase 22-B-R3(NPO 표준 회계 보고서) 🔵 설계 완성·B·A·C 트리거 발송
  · B: tbfa-mis-B / feature/phase22b-r3-back (PDF 함수 + 옛 테이블 정리)
  · A: tbfa-mis-A / feature/phase22b-r3-front (보고서 2탭 + 인쇄·엑셀·PDF)
- 다음: 22-B-R3 B·A 완료 보고 → 머지 → C 검증 → Phase 22-B 3부작 완결

22-B-R3 진행 상황 확인하고 머지 준비하겠습니다.
```
