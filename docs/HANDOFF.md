# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v20.md`](handover/v20.md) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-15 / **🎉 Phase 22 전체 완결 + 버그 픽스 1·2차 마감** / main @ `967b4a5`

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
6) §4 다음 트랙 후보 — Swain과 우선순위 협의 후 라운드 설계
```

---

## 3. 지금 진행 중인 일

### 3.1 🎉 Phase 22 전체 완결 + 버그 픽스 1·2차 마감 — 진행 중 작업 없음 (2026-05-15)

**Phase 22 재정 시리즈(22-A·B·C·D) 전체 마감 + 버그 픽스 1차(15건)·2차(13건) 마감.**
2차 핵심: `unwrap()` 함수가 #2·#3·#4 공통 원인 → 정리. addEventListener null 가드·SQL ANY 빈배열·대시보드 KPI 집계·사이드바 인라인 펼침 제거·효성 결제일 기준 보정.

**다음 트랙**: 진행 중 작업 없음 — Swain 협의 대기. 후보는 §4.

**★ Swain 직접 라이브 확인 필요** (AI 채팅은 브라우저 자동화·어드민 계정 없어 SPA 렌더링 검증 물리적 불가):
- **버그 픽스 2차 재정 화면 + 대시보드 + 사이드바** — 실제 브라우저로 확인
- **#8 토스 6만원·효성 금액 누락** — Neon DB에서 `donations.pgProvider`·`status` 직접 확인 (B가 자율주행 정책상 라이브 DB 조회 불가)
- 22-B-R3 인쇄 CSS / 22-D-R3 cron-voucher-recurring(KST 04:30) 동작

**정책 (2026-05-15 발효)**:
- push 자동화 — A·B·C `feature/`·`fix/` 브랜치 push는 자율(allow). `main` 직접·force push는 ask/deny
- UI 검증 구조 — C 정적 정독 + Swain 라이브 확인 (메모리 `feedback_verification_rounds` 정정)

### 3.2 Phase 22 재정 시리즈 — 마감 상세 (참조용)

| 라운드 | 핵심 산출물 | 설계서 |
|---|---|---|
| 22-A 매출 / 22-C 지출 | revenue·other_revenues·expenses + AI 도구 12개, BUG 15건 해소 | `milestones-archive.md` |
| 22-B-R1 화면 이전·기간 필터 | 재정 6개 화면 통합 CMS 이전 + `period` 필터 + NPO 4분류 통일 | `phase22b-r1-finance-relocation.md` |
| 22-B-R2 예산 편성 | budget_plans·budget_lines + 2단계 결재 + 전년 실적 자동 채움 | `phase22b-r2-budget-planning.md` |
| 22-D-R1 전표 시스템 | vouchers·account_codes(18개)·bank_* + 반복 템플릿 | `phase22d-r1-voucher-bank-import.md` |
| 22-B-R3 회계 보고서 | 운영성과표·예산실적표 + 인쇄/엑셀/PDF + 옛 테이블 코드 제거 | `phase22b-r3-accounting-reports.md` |
| 22-D-R2 통장 자동화 | IBK 엑셀 파싱 + 입출금 대사 엔진 + 출금 전표 자동생성 + 거래처 마스터 | `phase22d-r2-bank-reconciliation.md` |
| 22-D-R3 예산잠금·전표운영·재무제표 | 예산 잠금 + 지출결의서 인쇄 + 결산 보조 + 이상패턴 배지 + 반복전표 cron + 재정상태표·현금흐름표 | `phase22d-r3-budget-lock-reports.md` |

핵심 커밋: `76bf068`(22-A·C) → `d28c833`(22-B-R1) → `7d080b8`(R2·D1) → `c9f035a`(R3) → `fc547f1`(22-D-R2) → `9e73e98`(22-D-R3 완결).
**메타 경고**: AI 도구 그룹 갱신 누락 반복 / 응답 키 불일치 반복 → 메모리 `project_ai_cost_safety` 갱신 의무 5곳 명문화.

---

## 4. 즉시 해야 할 일 (새 메인)

**현재 상태**: Phase 22 전체 완결 + 버그 픽스 1·2차 마감. **Swain이 라이브 화면을 직접 점검 중.**

```
▶ 우선: Swain이 기능별 수정사항을 줄 예정 — 받는 즉시 대응
   - 버그 픽스 2차 후에도 깨진 화면이 있으면 Swain이 번호·증상으로 알려줌
   - 진단(Explore) → 버그 픽스 라운드 설계 → A·B·C 분배 → 머지 흐름
   - 작은 수정이면 메인 직접 fix 후 push도 가능 (판단)
   - 진행 패턴은 §3.2 + docs/milestones/2026-05-15-bugfix-round2.md 참고

▶ 깨진 게 없으면 다음 트랙 협의:
후보 ① 함께워크 ON(공유오피스) 신규 구축 — Swain이 보류 중, 가장 유력한 다음 트랙
   · SI 패턴(독립 git 저장소·독립 Netlify 배포, 허브 연동 없음)
   · + SIREN 스택(Neon·Drizzle·TypeScript·Netlify Functions) — SI의 localStorage는 부적합
   · + 전자세금계산서 모듈 (docs 폴더에서 제거됨 — ON 저장소 생기면 이관)
   · 신규 저장소 Hamkkework_ON + 로컬 dev/HamkkeWorkOn 폴더

후보 ② SIREN 안정화
   - tsc 묵은 에러 14건 정리 (소, B 단독 — report·mention·post-subscribe 등)
   - vouchers.budget_line_id FK 제약 추가 마이그 (극소)
   - Phase 19 자동 테스트 보강 / Phase 18 성능 최적화 (둘 다 설계서 완성)

후보 ③ Phase 17 BUG-17-04·05 후속 (소~중)
```

---

## 5. 채팅 구조 (현재 — A·B·C, 다음 라운드 대기)

| 채팅 | 모델 | 워크트리 | 역할 | 현재 상태 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | 설계·머지·조율·문서 | Phase 22 전체 완결, 다음 트랙 협의 |
| A | Sonnet 4.6 | tbfa-mis-A | 프론트 | ⏸ 다음 라운드 대기 |
| B | Opus 4.7 | tbfa-mis-B | 백엔드 + AI 도구 | ⏸ 다음 라운드 대기 |
| C | Opus 4.7 | tbfa-mis-C | 검증 + fix | ⏸ 다음 라운드 대기 |

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
| **Phase 22-B 재정 3부작** | ✅ 100% — R1 화면이전·기간필터 / R2 예산편성·결재 / R3 회계보고서 |
| **Phase 22-D 전표 3부작** | ✅ 100% — R1 전표 / R2 통장자동화 / R3 예산잠금·전표운영·재무제표 |
| **🎉 Phase 22 전체** | ✅ 100% 완결 (22-A·B·C·D 재정 시리즈 — main @ `9e73e98`) |

누적 약 **82%** / 약 755h+

---

## 8. AI 에이전트 v3 (참고 — 종료된 시스템)

**상태**: 개발 종료(2026-05-14). 현재 도구 **98개** (22-A 7 + 22-C 5 + 22-B-R2 예산 3 + 22-D-R1 전표 4 + 22-D-R2 bank_reconcile_summary 1 추가).
**표준 문서**: [`docs/standards/AI_AGENT_PLATFORM_STANDARD.md`](standards/AI_AGENT_PLATFORM_STANDARD.md) v1.4
자세한 내용은 메모리 `project_ai_cost_safety.md` 정독.
⚠️ AI 도구 신설 시 갱신 의무 **5곳** — ④ `admin-ai-agent.ts` TOOL_GROUPS 누락 반복(BUG-009→016→019). 메모리 참조.

---

## 9. 새 메인 첫 메시지 권장

```
인수인계 정독 완료.

현재 상태:
- 🎉🎉🎉 Phase 22 전체 완결 (22-A 매출 / 22-B 재정 3부작 / 22-C 지출 / 22-D 전표 3부작,
  main @ 9e73e98) — 재정 시리즈 전체 운영 가능
- 진행 중 작업 없음 — 다음 트랙 Swain 협의 대기
  · 후보 ①: 함께워크 ON(공유오피스) 신규 구축 — 가장 유력
  · 후보 ②: SIREN 안정화 (tsc 14건·자동 테스트·성능)
- 라이브 확인 권장: www.tbfa.co.kr DNS(가비아 www CNAME 추가) / cron-voucher-recurring

§4 후보 우선순위를 Swain과 확정하겠습니다.
```
