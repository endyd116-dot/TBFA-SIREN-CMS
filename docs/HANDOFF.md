# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v20.md`](handover/v20.md) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-16 / **🔧 버그 픽스 3차 코드 완결 + 📐 Phase 23 설계 라운드 진입** / main @ `20af8b4` (전부 푸시 완료)

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

### 3.1 ✅ 버그 픽스 3차 — 코드 작업 전부 완결 (2026-05-16, 메인 단독)

**이번 세션에서 버그 픽스 3차의 코드 작업을 전부 마감했다.** main @ `20af8b4`, 모두 푸시 완료.

| 커밋 | 내용 |
|---|---|
| `8495b2c` | 계정과목 전면작업 — 시드 마이그(비용27+수익10=37건)·CRUD API 3종·통장거래 서브탭 "계정과목 관리"·AI 분류 대분류>소분류 계층화 |
| `266ece8` | 출금 전표 확정 모달 — 예산 항목 ID 입력 → 항목명 드롭다운 + AI 1차 추천 (신규 API `admin-budget-lines-list`) |
| `05ce334` | 계정과목 시드 마이그 파일 삭제 (호출 완료 — 신규19·갱신18) |
| `4698b7b`·`ae7b3ef` | #9/#11 매출 카테고리 2단계 계층 — 마이그(`parent_id`·`is_system`)·CRUD API 3종·"카테고리 관리" 서브탭·대/소분류 드롭다운 |
| `95af964`·`ecefff3` | 매출 카테고리 마이그 검증·완료 — 호출 확인(systemCount 6/6), 마이그 파일 삭제 + `revenue_categories` schema 정의 활성화 |
| `8d41a9e` | #7/#8 정기후원 효성·토스 중복 경고 — 정기 후원자 명단에 `⚠ 중복` 배지 + "효성+토스 중복" 진단 필터. 차단 X, 경고·진단만 (Swain 정책). `donor_channels` jsonb로 감지 |
| `fedec10` | v3.0 설계도 docs 커밋 |
| `20af8b4` | Phase 23-0 골격 설계서 |

**버그 픽스 3차 — 남은 것 = Swain 운영 작업뿐 (코드 아님)**:
- **#16** tbfa.co.kr HTTPS 인증서 발급 (Netlify Domain management)
- **#14** 발송 환경변수 확인 (`6dc57a3` 배포 후 발송 작업 `last_error` 메시지 확인 — RESEND_API_KEY 류)
- **#3** 효성 데이터 Neon 진단 쿼리 4개 실행 → ④가 0이면 효성 재import

### 3.2 📐 Phase 23 설계 라운드 — 진행 중 (★ 새 메인이 이어받을 핵심)

Swain이 **사단법인 예산 관리 시스템 v3.0 설계도**를 줌. 검토·설계 진행 중.

**정본 문서**: [`docs/교사유가족협의회_사단법인_예산시스템_기능설계도_v3.md`](교사유가족협의회_사단법인_예산시스템_기능설계도_v3.md) (v1·v2 폐기, v3.0이 정본)
**골격 설계서**: [`docs/milestones/2026-05-16-phase23-0-budget-foundation.md`](milestones/2026-05-16-phase23-0-budget-foundation.md)

**v3.0 핵심**: 4축 태깅(계정과목×사업×기능×재원) + 편성→심의→집행→결산 라이프사이클 + 총회·이사회 의결 모델 + 보조금 모듈 + AI 25개 기능.

**메인이 내린 분석 (확정)**:
- "폐기 후 신규" ❌ / "전면 수정" ❌ → **계층적 하이브리드**: 밑바탕 인프라 재활용(통장 대사 엔진·거래처 학습·계정과목·AI 인프라·R2·감사) + 예산 도메인 4축 재설계 + 신규 모듈(의결·보조금·OCR) 추가
- 재활용 11 / 진화 7 / 신규 11 분류표 작성 (대화 기록 — Phase 23-0 설계서 §1에 압축)

**Swain 확정 결정 (이번 세션)**:
- 전환 시점 = **완성되는 대로 즉시**
- **재정 모듈 전체가 더미데이터** (예산뿐 아니라 후원·매출·통장거래·계정과목까지 전부) → **마이그레이션 불필요, 재정 모듈 전체를 v3.0 기준 백지 재구축**. 23-0 설계서 §3 "마이그레이션 전략" 절은 폐기 — "재정 모듈 백지 재구축"으로 대체할 것.
- 과거 기록 = 완전 별도 보관 (사실상 폐기 — 더미라 미련 없음)

**★ 미해결 — 새 메인이 Swain에게 확인받을 첫 결정 (가장 중요)**:
메인이 다음 판단을 제시했고 **Swain 확인 대기 중**:
> **"독립 앱 ❌ / SIREN 안의 독립 모듈 ⭕"** — 재정 모듈을 별도 배포·별도 DB·별도 로그인의 독립 앱으로 만들지 말고, SIREN 안에서 v3.0 기준으로 백지 재구축하되 재정 전용 영역으로 자기 완결적으로 묶을 것.
> 근거: ① v3.0 운영자(이사장·이사·감사·사무국)=SIREN 회원 — 별도면 회원 이중관리 ② v3.0 "재원" 축은 효성·토스 후원 데이터를 먹음 — SIREN에 연동 코드 이미 있음 ③ 통장 대사 엔진·AI 5층 안전장치 재활용 ④ 법인격 분리는 v3.0의 "회계구분(일반/보조금)" 축 + 회계연도 경계로 해결 — 시스템을 쪼갤 문제가 아님.
> **이게 확정돼야 23-0 설계서를 갱신하고 구현 트리거 작성 가능.**

**추천만 하고 미확정 (Q4)**: v3.0이 예산 절차를 가져간 뒤 후원·매출·회계보고서 처리 — 메인 추천 = "후원·매출 관리 화면은 SIREN 유지하되 v3.0의 재원/수입 실적으로 연결, 회계 보고서는 v3.0 결산으로 흡수". Swain "AI가 판단해달라" → 위 독립모듈 판단과 함께 확인받을 것.

**후속 라운드 파라미터 (23-0 착수 막지 않음 — 후속 확정)**: 주무관청(시도교육청) · 정관 의결정족수 · 회계연도 시작 시점 · LLM/OCR/임베딩 벤더.

### 3.3 Phase 22 재정 시리즈 — 마감 상세 (참조용)

⚠️ **단, §3.2 결정대로 Phase 22 재정 산출물(예산·전표·지출·후원·매출 등)은 전부 더미 → v3.0으로 백지 재구축 대상.** 아래는 "어떤 코드 자산이 있는지" 참조용.

| 라운드 | 핵심 산출물 | 설계서 |
|---|---|---|
| 22-A 매출 / 22-C 지출 | revenue·other_revenues·expenses + AI 도구 12개 | `milestones-archive.md` |
| 22-B-R1 화면 이전·기간 필터 | 재정 6개 화면 통합 CMS 이전 + `period` 필터 | `phase22b-r1-finance-relocation.md` |
| 22-B-R2 예산 편성 | budget_plans·budget_lines + 2단계 결재 | `phase22b-r2-budget-planning.md` |
| 22-D-R1 전표 시스템 | vouchers·account_codes·bank_* + 반복 템플릿 | `phase22d-r1-voucher-bank-import.md` |
| 22-B-R3 회계 보고서 | 운영성과표·예산실적표 + 인쇄/엑셀/PDF | `phase22b-r3-accounting-reports.md` |
| 22-D-R2 통장 자동화 | IBK 엑셀 파싱 + 입출금 대사 엔진 + 거래처 마스터 | `phase22d-r2-bank-reconciliation.md` |
| 22-D-R3 예산잠금·재무제표 | 예산 잠금 + 결산 보조 + 반복전표 cron + 재정상태표·현금흐름표 | `phase22d-r3-budget-lock-reports.md` |

**재활용 가치 높은 코드 자산** (v3.0 백지 재구축 시): `lib/bank-reconcile.ts` 통장 대사 엔진(AI-12 80% 구현) · `counterparties` 거래처 학습(=v3.0 payee_mapping) · `account_codes` 계층 · `ai-gemini.ts`+AI 도구 5층 안전장치 · R2 · 전표 PDF · 회계보고서 틀.

---

## 4. 즉시 해야 할 일 (새 메인)

**현재 상태**: 버그 픽스 3차 코드 완결(전부 푸시, main @ `20af8b4`) / Phase 23 설계 라운드 진입.

```
▶ 0순위: 시작 시 정독
   - 본 HANDOFF §3.2 (Phase 23 진행 상황·미해결 결정)
   - docs/교사유가족협의회_사단법인_예산시스템_기능설계도_v3.md (v3.0 정본 — 전체)
   - docs/milestones/2026-05-16-phase23-0-budget-foundation.md (골격 설계서)
   - PROJECT_STATE.md §2·§3 / memory/MEMORY.md + feedback_*
   - 도구 주의: Edit는 작게 쪼갤 것 / Bash는 `cd` 없이 (한글경로 깨짐)
   - 설명·검증은 CLAUDE.md §6.14 — 함수명 말고 기능·시나리오 위주 (Swain 절대명제)

▶ 1순위: §3.2 "★ 미해결" 결정을 Swain에게 확인
   - "독립 앱 ❌ / SIREN 내 독립 모듈로 재정 모듈 전체 백지 재구축" 판단 동의 여부
   - Q4 (후원·매출·보고서 경계) 추천 동의 여부
   - 이 둘이 확정돼야 다음 단계 가능

▶ 2순위: 23-0 골격 설계서 갱신
   - §3 "마이그레이션 전략" → "재정 모듈 백지 재구축" 으로 교체
   - 범위를 "예산"에서 "재정 모듈 전체"로 확장 (재정 전체가 더미이므로)
   - 독립 모듈 구조 반영

▶ 3순위: 23-0 구현 라운드 트리거 작성 → A·B·C 병렬 착수
   - 마스터 테이블(fiscal_years·programs·funding_sources) + account_codes 진화
     + 4축 budget 모델 + 시드 + 마이그 함수
   - PARALLEL_TEMPLATE 양식, 체크박스 패턴

▶ Swain 운영 (병행 — 코드 아님): #16 HTTPS · #14 발송 환경변수 · #3 효성 데이터 진단
```

**새 메인 첫 메시지 권장**: "Phase 23 설계 라운드 인수인계 받았습니다. 버그 픽스 3차는
코드 작업 전부 완결(#16/#14/#3만 Swain 운영 작업으로 남음). Phase 23은 v3.0 정본 +
골격 설계서까지 나와 있고 — **딱 하나, '재정 모듈을 SIREN 안의 독립 모듈로 백지
재구축'(독립 앱 아님) 판단에 동의하시는지** 확인이 필요합니다. 동의하시면 골격
설계서를 그 기준으로 갱신하고 23-0 구현 트리거 작성으로 들어가겠습니다."

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
