# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v20.md`](handover/v20.md) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-16 / **🔧 버그 픽스 3차 진행 중 (메인 단독)** / main @ `b68f9d0`

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

**★ Swain 검증 결과 (2026-05-16 시점)**:
- #13 통장 업로드 ✅ 됨. 무시 해제 버튼·일괄 전표 확정 버튼 표시 확인.
- #3 검증 대시보드 화면은 뜨나 **효성 채널 카운트 여전히 0** (ILIKE 수정 후에도) → DB에 효성 정기후원 데이터 자체가 없거나 다른 형태일 가능성. Neon 직접 확인 필요.
- #5 작동은 되나 IBK 엑셀 "파싱 가능한 행 없음" → **수납 매핑 탭 파서(`ibk-parser.ts`)는 입금만 처리**. Swain 통장은 전부 출금 → **통장 거래내역 메뉴**(`admin-bank-import`+`bank-reconcile`)가 출금 처리하는 올바른 경로.

### 3.2 버그 픽스 3차 — 남은 작업 (새 메인이 이어받을 것)

**A. 메인 코드만으로 가능 (우선)**
- **#13 계정과목 전부 503으로 몰림**: `bank-reconcile.ts`의 `pickAccountByCategory`가
  카테고리별 첫 계정과목 1개만 집어옴 → 청소관리비·CMS사용료가 다 503.
  키워드 룰을 더 세분화하거나 거래내용→계정 매핑을 정교화 필요.
- **#13 전표 확정 버튼**: Swain 스크린샷상 모달은 정상으로 뜸(계정과목 503 자동 입력됨).
  "반응 없음"은 해소됐을 가능성 — Swain 재확인 필요.

**B. DB 스키마 변경 — Swain 마이그레이션 호출 필요**
- **#9/#11 후원 외 매출 카테고리 2단계 계층 관리** (Swain 결정: 2단계 계층 + CRUD + 순서이동):
  `revenue_categories`에 `parent_id` 컬럼 추가 마이그 → 카테고리 관리 화면 + CRUD API →
  매출 기록 시 소분류 선택 연동. **+ 계정과목(`account_codes`) CRUD도 없음** —
  Swain "계정과목 추가·관리 기능 없다" 지적(#13). 같이 설계 권장.
- **#7/#8 정기후원 중복 방지**: 효성·토스가 독립 경로, 중복 막는 제약 전무.
  `donations`에 정기후원 중복 방지 제약 + `pg_provider` 값 이원화(`hyosung`/`hyosung_cms`)
  데이터 정합 마이그 필요. 비즈니스 로직(완전 차단? 경고만?) Swain 결정 필요.

**C. Swain 운영 작업 (코드 아님)**
- **#16 tbfa.co.kr "주의 요함"(HTTPS 미적용)**: Netlify 커스텀 도메인 SSL 인증서
  미발급/미적용. app.netlify.com → tbfa-siren-cms → Domain management → HTTPS 섹션에서
  인증서 상태 확인·발급. DNS 검증 실패 시 가비아 DNS 설정 점검.
- **#14 발송 미발송(버그 B)**: 상태 오표시(버그 A) 수정으로 이제 발송 실패가 정확히
  표시됨. 발송 작업 `last_error`에 "RESEND_API_KEY not configured" 류가 뜨면
  Netlify 환경변수 미등록 — `RESEND_API_KEY`·`ALIGO_API_KEY`·`ALIGO_USER_ID`·`ALIGO_SENDER` 확인.

**Swain 검증 완료 항목**: #1 #2 #4 #15 #16-1.

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

**현재 상태**: 버그 픽스 3차 진행 중. 메인 단독 작업. main @ `b68f9d0`.

```
▶ 0순위: 도구 사용 주의 (이 인수인계의 직접 사유)
   - Edit 도구: old_string/new_string을 작게 — 긴 코드 블록은 전송 중 잘림
     · 한 번에 몇 줄만. 큰 변경은 여러 Edit로 쪼갤 것
   - Bash 도구: `cd` 쓰지 말 것 — 작업 폴더에 이미 위치함.
     · `cd "한글경로"`가 깨져서 명령 실패함 (작업/dev → 作업/dev)
     · 파일 끝 추가는 `cat >> 파일 << 'EOF'` 패턴 OK (이미 검증됨)
   - 검증·설명은 CLAUDE.md §6.14 — 함수명 말고 기능·시나리오 위주

▶ 1순위: 버그 픽스 3차 남은 작업 — §3.2 참고
   A. 메인 코드만으로:
      - #13 계정과목 503 몰림 — bank-reconcile.ts pickAccountByCategory 정교화
      - #13 전표 확정 버튼 — Swain 재확인 후 필요 시 대응
   B. Swain 마이그레이션 필요 (설계 후 §6.8 표준 흐름):
      - #9/#11 매출 카테고리 2단계 계층 + CRUD + 계정과목 CRUD
      - #7/#8 정기후원 중복 방지 + pg_provider 정합
   C. Swain 운영 작업: #16 HTTPS, #14 환경변수

▶ 2순위(3차 마감 후): 다음 트랙 협의
   후보 ① 함께워크 ON(공유오피스) 신규 구축 — 가장 유력
      · SI 패턴(독립 저장소·배포) + SIREN 스택(Neon·Drizzle) + 전자세금계산서 모듈
   후보 ② SIREN 안정화 — tsc 묵은 에러 14건 / Phase 19 자동 테스트 / Phase 18 성능
   후보 ③ Phase 17 BUG-17-04·05 후속
```

**새 메인 첫 메시지 권장**: Swain에게 "버그 픽스 3차 인수인계 받았습니다.
푸시된 6개 커밋(a376350~b68f9d0) 검증 결과를 알려주시면 — 특히 #3 효성 채널,
#13 계정과목 503, #14 발송 — 남은 작업 이어가겠습니다. #9/#11 카테고리 관리는
스키마 변경이라 설계 후 마이그레이션 호출 부탁드리는 흐름입니다."

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
