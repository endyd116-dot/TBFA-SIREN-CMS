# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v20.md`](handover/v20.md) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-16 / **🔧 버그 픽스 3차 진행 중 (메인 단독)** / 로컬 @ `6dc57a3` (origin/main @ `a94d5a3` — **2커밋 미푸시**)

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

### 3.1 🔧 버그 픽스 3차 진행 중 — 메인 단독 작업 (2026-05-16 시작)

**Phase 22 전체 완결 + 버그 픽스 1·2차 마감 후, Swain 라이브 점검에서 나온 3차 수정사항.**
**병렬 없이 메인 단독 진단·수정.** Swain 실시간 검증, AI 라이브 검증 안 함.

⚠️ **이 세션 인수인계 사유**: 메인 채팅에서 Edit/Bash 도구 호출이 응답 길이 한계로
반복적으로 중간 잘림(특히 긴 코드 블록·한글 경로). 작업은 정상 진행됐으나 비효율 →
새 메인 채팅으로 이어받음. **새 메인은 Edit를 작은 단위로 쪼개고, Bash는 `cd` 없이
(작업 폴더에 이미 위치) 실행할 것 — `cd "한글경로"`가 깨짐.**

**3차에서 푸시 완료 (검증 대기)** — main: `2e82989` → `b68f9d0`:
| 커밋 | 내용 |
|---|---|
| `a376350` | #3 검증대시보드 무한로딩(renderDonationDashboard 미노출) · #5 수납매핑 탭 메인튕김(CMS_CSV_IMPORT→CsvImport 모듈명 오타) · #9 후원외매출 화면깨짐(없는 orYearSelect 요소) · #10/#13 통장 업로드 ANY 캐스팅(1차) |
| `22b92fb` | #13 통장 업로드 재수정(`${jsArray}::text[]`는 record로 바인딩 → `sql.raw`로 ARRAY 리터럴) · #3 효성 채널 카운트 0 (대시보드 쿼리 `hyosung_cms`만 비교 → `ILIKE 'hyosung%'`로 정정) |
| `b8b0e8b` | #13 통장 거래 무시 해제(`action='unignore'`) + 일괄 전표 확정(신규 `admin-bank-batch-voucher.ts`) + 화면 체크박스·버튼 |
| `c8f807a` | #14 발송 작업 상태 오표시 — 디스패처 race condition(1단계 처리 job을 2단계가 재픽업 → pending 0건 보고 조기 completed). handledJobIds 제외 + sending 잔여 체크 |
| `7574de1` | #6-1 사이드바 2뎁스 항상 표시 + 1뎁스 좌측 이동(cms-common.css 추가 규칙) |
| `b68f9d0` | admin-recipient-groups.js가 cms-tbfa.html에서 null 에러 → 전용 페이지 요소 부재 시 가드 |
| `93f89ca` | **(미푸시)** #13 계정과목 503 몰림 — 통장 출금 키워드 룰을 구체 계정과목 코드로 직접 매핑(통신비 5032·공과금 5034·임차료 5031 등). 기존엔 분류 대표 1개(503)만 집어옴 |
| `6dc57a3` | **(미푸시)** #14-B 발송 작업 '발송 중' 영구 멈춤 — 디스패처 0단계 고아 수신자 복구(5분 이상 sending → pending 재시도, 3회 후 failed) + 건별 발송 15초 타임아웃 |

**★ Swain 검증 결과 (2026-05-16 시점)**:
- #13 통장 업로드 ✅ / 무시 해제·일괄 전표 확정 버튼 표시 ✅ / **#13 전표 확정 모달 정상 ✅ (항목 종료)**
- #3 검증 대시보드 **여전히 0명** — 메인 진단: 코드(렌더링·unwrap·KPI 쿼리) 정상. **효성 후원이 `donations` 행으로 안 만들어진 데이터 문제.** Swain에게 Neon 진단 쿼리 4개 안내함(전체회원수 / 효성계약·연결 / 효성수납·완납 / 효성→donations 생성). Swain이 ④(`donations` 효성 정기후원 수)를 돌려보고 0이면 재import 필요, 숫자가 있는데 0이면 코드 버그.
- #14 발송 멈춤 — 메인 진단: Resend 무응답으로 함수 타임아웃 → 수신자가 'sending'에 갇힘. `6dc57a3`으로 수정(배포 시 멈춘 작업도 자동 복구). 실제 Resend 무응답 원인은 배포 후 'last_error'에 찍히는 메시지로 재확인 필요.
- #5 IBK 출금 통장은 '통장 거래내역 메뉴'가 올바른 경로(수납 매핑 탭은 입금 전용 — `ibk-parser.ts`).

### 3.2 버그 픽스 3차 — 남은 작업 (새 메인이 이어받을 것)

**★ 0순위: 미푸시 2커밋 처리** — `93f89ca`·`6dc57a3`이 로컬에만 있음.
Swain이 "여기까지 하고 인수인계" 지시 → **푸시 여부는 Swain 확인 후**.
계정과목 작업과 묶어서 푸시할지, 2커밋 먼저 푸시할지 새 메인이 Swain에게 물을 것.

**A. 계정과목 전면 작업 (Swain 결정 완료 — 새 메인이 바로 착수)**

Swain이 4개 결정을 내림 (2026-05-16). 설계 질문 불필요, 바로 구현:
1. **계정과목 시드 — 전체 (비용 27 + 수익 7)**. `account_codes` 테이블은 이미 존재
   → **스키마 변경 없음**. 1회용 시드 마이그레이션 함수로 신규 19행 INSERT
   (`ON CONFLICT (code) DO NOTHING` 멱등). Swain이 `?run=1` 호출.
   - 기존 18행(501·5011~5013 / 502·5021~5023 / 503·5031~5036 / 504·5041·5042) 유지
   - 신규: 인건비 5014(일용·외주인건비) / 사업비 5024(지원금)·5025(사업도서인쇄비) /
     관리운영비 5037(여비교통비)·5038(회의비)·5039(지급수수료)·5040(세금과공과)·
     5043(보험료)·5044(감가상각비)·5045(잡비) /
     수익: 부모 401(사업수익)·402(사업외수익) + 4011(후원금·기부금수익)·4012(보조금수익)·
     4013(회비수익)·4014(사업수익) + 4021(이자수익)·4022(잡수익)·4023(자산처분이익)
   - category 값: 수익은 `income`, 나머지 기존대로 personnel/program/admin_ops/fundraising
   - 5041·5042는 모금비(504) 자녀라 관리운영비 신규는 5043~5045로 건너뜀 — parentCode 컬럼으로 계층 명시
2. **AI 자동 계정과목 분류 디벨롭** — `lib/bank-reconcile.ts` `classifyExpenseByAI`
   프롬프트를 대분류>소분류 계층으로 제시하도록 개선 + 확장된 코드셋 반영.
   (키워드 룰은 `93f89ca`에서 이미 구체 코드 매핑 완료 — AI 폴백 경로만 디벨롭)
3. **CRUD UI 위치 — 통장 거래내역 화면 안 서브탭** "계정과목 관리"
   (`cms-tbfa.html` #bank-transactions 섹션 + `admin-bank-transactions.js`)
4. **CRUD 범위 — 추가·수정·비활성·순서이동 전체**. 삭제는 비활성(`is_active=false`)으로
   대체(전표에 쓰인 코드 보호). API 신설: `admin-account-code-create`·`-update`·`-reorder`
   (list는 `admin-account-codes-list.ts` 기존). `export const config = { path }` 필수.

**B. 그 외 스키마 변경 작업 (별도 — Swain 마이그레이션 호출 필요)**
- **#9/#11 후원 외 매출 카테고리 2단계 계층 관리**: `revenue_categories`에 `parent_id`
  컬럼 추가 마이그 → 카테고리 관리 화면 + CRUD → 매출 기록 시 소분류 연동.
  (계정과목 작업과 같은 "통장 거래내역 서브탭" 자리에 합칠 수 있음 — Swain 언급)
- **#7/#8 정기후원 중복 방지**: 효성·토스 독립 경로, 중복 제약 전무.
  `donations` 정기후원 중복 방지 제약 + `pg_provider` 값 정합. 비즈니스 로직 Swain 결정 필요.

**C. Swain 운영 작업 (코드 아님)**
- **#16 tbfa.co.kr HTTPS 미적용**: Netlify Domain management → HTTPS 인증서 발급.
- **#14 발송 환경변수 재확인**: `6dc57a3` 배포 후 발송 작업 `last_error`에 찍히는
  메시지 확인 — "RESEND_API_KEY not configured" 류면 Netlify 환경변수 미등록.
- **#3 효성 데이터**: §3.1 Neon 진단 쿼리 4개 실행 → ④가 0이면 효성 재import(계약→수납 순서).

**Swain 검증 완료 항목**: #1 #2 #4 #15 #16-1 / #13 전표 확정 모달.

**정책 (2026-05-15 발효, 유지)**:
- push 자동화 — `feature/`·`fix/` 브랜치 push 자율. `main` 직접·force는 ask/deny
- UI 검증 — Swain 라이브 직접 (AI 채팅은 브라우저 자동화·어드민 계정 없음)

### 3.3 Phase 22 재정 시리즈 — 마감 상세 (참조용)

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

**현재 상태**: 버그 픽스 3차 진행 중. 메인 단독 작업.
로컬 @ `6dc57a3` / origin/main @ `a94d5a3` — **2커밋 미푸시** (`93f89ca`·`6dc57a3`).

```
▶ 0순위: 도구 사용 주의
   - Edit 도구: old_string/new_string을 작게 — 긴 코드 블록은 전송 중 잘림
   - Bash 도구: `cd` 쓰지 말 것 — 작업 폴더에 이미 위치 (`cd "한글경로"` 깨짐)
   - 검증·설명은 CLAUDE.md §6.14 — 함수명 말고 기능·시나리오 위주

▶ 1순위: 미푸시 2커밋 푸시 여부 Swain 확인
   - 93f89ca(#13 계정과목 503)·6dc57a3(#14-B 발송 멈춤) 둘 다 tsc 통과·검증 대기
   - Swain이 원래 "계정과목 작업까지 하고 푸시" 했으나 "여기까지 하고 인수인계"로 중단
   - 새 메인: 2커밋 먼저 푸시할지 / 계정과목 작업과 묶을지 Swain에게 한 줄 확인

▶ 2순위: 계정과목 전면 작업 — §3.2-A (Swain 결정 4개 완료, 바로 구현)
   ① 시드 마이그레이션 (비용27+수익7, 신규 19행, 스키마 변경 X) → Swain ?run=1 호출
   ② AI 자동 분류 디벨롭 (bank-reconcile.ts classifyExpenseByAI 계층 프롬프트)
   ③ CRUD UI — 통장 거래내역 서브탭 "계정과목 관리"
   ④ CRUD API 신설 (create/update/reorder) — 비활성으로 삭제 대체

▶ 3순위: §3.2-B 스키마 변경 작업 (#9/#11 매출 카테고리, #7/#8 정기후원 중복)
▶ Swain 운영: §3.2-C (#16 HTTPS, #14 환경변수, #3 효성 데이터 진단)

▶ 3차 마감 후: 다음 트랙 — ① 함께워크 ON ② SIREN 안정화 ③ Phase 17 후속
```

**새 메인 첫 메시지 권장**: "버그 픽스 3차 인수인계 받았습니다. 미푸시 2커밋
(#13 계정과목 503·#14-B 발송 멈춤)이 있는데 — 먼저 푸시할까요, 아니면 계정과목
전면 작업까지 묶어서 푸시할까요? 계정과목 작업은 결정 4개가 다 끝나 있어 바로
착수 가능합니다(시드 → AI 분류 디벨롭 → 통장 거래내역 서브탭 CRUD)."

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
