# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v20.md`](handover/v20.md) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-15 / **🎉 Phase 22-B 3부작 완결 (22-A~D 재정 시리즈 전체 마감)** / main @ `c9f035a`

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

### 3.1 🎉 Phase 22-B 3부작 완결 — 진행 중 작업 없음 (2026-05-15)

Phase 22 재정 시리즈(22-A 매출 / 22-C 지출 / 22-B-R1·R2·R3 / 22-D-R1 전표)가 전부 마감·운영 가능.

| 라운드 | 결과 |
|---|---|
| 22-B-R1 재정 화면 이전·기간 필터 | C 검증 18/20 + BUG 3건 fix |
| 22-B-R2 예산 편성·2단계 결재 | C 검증 11/12 + BUG fix (budget_plans·budget_lines) |
| 22-D-R1 전표 시스템 | C 검증 13/16 + BUG fix (vouchers·계정과목 18개), 교차 확인 PASS |
| 22-B-R3 NPO 표준 회계 보고서 | C 검증 12/0 + BUG-021 fix (운영성과표·예산실적표·인쇄/엑셀/PDF) |

**다음 트랙**: SIREN·통합 CMS 고도화·안정화 — §4 후보 목록, Swain과 우선순위 협의 중.
**라이브 확인 권장** (Swain 직접): 22-B-R3 인쇄 CSS 풀폭 출력 / Netlify PDF 폰트 경로.
**보류**: 함께워크 ON(공유오피스) 신규 구축 — SI 패턴(독립 저장소·배포) + SIREN 스택(Neon·Drizzle) + 전자세금계산서 모듈 조합으로 추후 별도 트랙.

### 3.2 Phase 22 재정 시리즈 — 마감 상세 (참조용)

| 라운드 | 핵심 산출물 | 설계서 / 검증 보고서 |
|---|---|---|
| 22-A 매출 / 22-C 지출 | revenue·other_revenues·expenses + AI 도구 12개, BUG 15건 해소 | `milestones-archive.md` |
| 22-B-R1 화면 이전·기간 필터 | 재정 6개 화면 통합 CMS 이전 + `period` 필터 + NPO 4분류 통일 | `phase22b-r1-finance-relocation.md` / `verify/...-phase22b-r1.md` |
| 22-B-R2 예산 편성 | budget_plans·budget_lines + 2단계 결재 + 전년 실적 자동 채움 | `phase22b-r2-budget-planning.md` / `verify/...-phase22-r2d1.md` |
| 22-D-R1 전표 시스템 | vouchers·account_codes(18개)·bank_* + 반복 템플릿 | `phase22d-r1-voucher-bank-import.md` / `verify/...-phase22-r2d1.md` |
| 22-B-R3 회계 보고서 | 운영성과표·예산실적표 + 인쇄/엑셀/PDF + 옛 테이블 코드 제거 | `phase22b-r3-accounting-reports.md` / `verify/...-phase22b-r3.md` |

핵심 커밋 흐름: `76bf068`(22-A·C) → `d28c833`(R1) → `7d080b8`(R2·D1) → `c9f035a`(R3 완결).
**메타 경고**: AI 도구 그룹 갱신 3라운드 연속 누락 → 메모리 `project_ai_cost_safety`에 갱신 의무 5곳 명문화.

---

## 4. 즉시 해야 할 일 (새 메인) — 다음 트랙 우선순위 협의

Phase 22-B 완결. SIREN·통합 CMS **고도화·안정화**로 방향(Swain 결정). 우선순위 협의 후 라운드 설계.

```
안정화 후보:
- tsc 묵은 에러 14건 정리 (소, B 단독 2~3h) — report·mention·post-subscribe 등
- vouchers.budget_line_id FK 제약 추가 마이그 (극소)
- Phase 19 자동 테스트 보강 (중, 설계서 완성) — 회귀 방지 인프라
- Phase 18 성능 최적화 (중, 설계서 완성) — 캐싱·쿼리 튜닝

고도화 후보:
- 22-D-R2 통장거래내역 자동화 (대) — 재정상태표·현금흐름표는 이때
- 22-D-R3 결산 보조·이상 패턴·전표 인쇄 (중)
- Phase 17 BUG-17-04·05 후속 (소~중)

메인 추천: 안정화 묶음 먼저 (Phase 22로 코드 급증 → 바닥 다지기).
보류: 함께워크 ON 공유오피스 신규 구축 (Swain 보류).
```

---

## 5. 채팅 구조 (현재 — A·B·C, 다음 라운드 대기)

| 채팅 | 모델 | 워크트리 | 역할 | 현재 상태 |
|---|---|---|---|---|
| 메인 | Opus 4.7 | tbfa-mis | 설계·머지·조율·문서 | Phase 22-B 완결, 다음 트랙 협의 |
| A | Sonnet 4.6 | tbfa-mis-A | 프론트 | ⏸ 다음 라운드 트리거 대기 |
| B | Opus 4.7 | tbfa-mis-B | 백엔드 + AI 도구 | ⏸ 다음 라운드 트리거 대기 |
| C | Opus 4.7 | tbfa-mis-C | 검증 + fix | ⏸ 다음 라운드 검증 대기 |

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
| **Phase 22-B-R3 NPO 표준 회계 보고서** | ✅ 100% (C 검증 12/0 + BUG-021 fix) — **Phase 22-B 3부작 완결** |
| Phase 22-D-R2/R3 통장 자동화·AI 부가기능 | ⏸ 고도화 후보 |

누적 약 **77%** / 약 725h+

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
- 🎉 Phase 22 재정 시리즈 전체 마감 (22-A·22-C·22-B-R1·R2·R3·22-D-R1, main @ c9f035a)
  · Phase 22-B 3부작(화면이전·예산편성·회계보고서) 완결
- 다음 트랙: SIREN·통합 CMS 고도화·안정화 (§4 후보 — Swain과 우선순위 협의 중)
  · 메인 추천: 안정화 묶음 먼저 (tsc 14건 + FK + 자동 테스트)
- 보류: 함께워크 ON 공유오피스 신규 구축

§4 후보 우선순위를 Swain과 확정하고 라운드를 설계하겠습니다.
```
