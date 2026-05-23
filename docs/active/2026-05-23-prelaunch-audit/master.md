# 운영 전 전수 검수 — 마스터 우선순위표
> 2026-05-23 / 메인(총괄) 취합 — 4영역(메인·A·B·C) 리포트 통합·중복제거·교차검증
> 원본 리포트: [main.md](main.md) · [a.md](a.md) · [b.md](b.md) · [c.md](c.md)
> **이번 라운드는 검수까지. 수정은 본 표로 Swain과 우선순위 합의 후 별도 fix 라운드.**

---

## 0. 종합 집계

| 영역 | 검수자 | P0 | P1 | P2 |
|---|---|---|---|---|
| 메인 (인증·후원·결제·알림) | Opus | 1 | 3 | 5 |
| A (SIREN신고·유족지원·공개사이트) | Sonnet | 1 | 4 | 4 |
| B (워크스페이스·근태·성과·급여·AI) | Sonnet | 1 | 3 | 5 |
| C (어드민CMS·재정·권한·빌더·인프라) | Sonnet | 2 | 8(그룹·cron 12 포함) | 5 |
| **중복 제거 후 마스터** | — | **5** | **9** | **18** |

> 가장 큰 교차 이슈 = **cron netlify.toml 미등록**(메인·B·C 3자 동시 발견 → 1행으로 통합). C의 12개 리스트가 권위 목록.
> **운영 즉시 장애(P0)는 대부분 "운영 전 환경변수·정리 게이트"** — 코드 결함이 아니라 오픈 직전 Swain 핸즈온 확인 항목. §4 별도 정리.

---

## 1. P0 — 운영 즉시 장애 (오픈 전 반드시 해소)

| # | 발견 | 영역 | 위치 | 영향 | 성격 |
|---|---|---|---|---|---|
| **P0-1** | **1회용 migrate-* 9개 파일 라이브 잔존** | C | `migrate-phase22a-c-seed.ts`·`migrate-static-pages.ts` 외 7개 | `?cleanup=1`로 운영 DB 삭제·이용약관/개인정보 본문 덮어쓰기 가능. 보안·데이터 유실 | 파일 삭제 |
| **P0-2** | **KICC 빌링키 관리 화면 전체 404** (`admin-billing-keys`·`admin-billing-logs`에 `export const config={path}` 누락) | C·결제(메인 교차) | `admin-billing-keys.ts`·`admin-billing-logs.ts` / `cms-tbfa.js:2580,2720` | 빌링키 목록·비활성화·재활성화·로그 조회 전부 불동작 → 정기 후원 운영 불가 | 코드(config 추가) |
| **P0-3** | **AI 백그라운드 함수 3개 무인증** (`INTERNAL_TRIGGER_SECRET` 미설정 시 `if(expected && …)` 통과) | B | `ai-task-summary/completion/milestone-match-background.ts` | 외부에서 임의 taskId POST로 무제한 Gemini 호출 → 비용 폭발·안전장치 우회 | env 설정 + 코드 하드닝 |
| **P0-4** | **이메일 전체가 테스트 redirect 모드에 묶임** (`RESEND_TEST_RECIPIENT` 설정 시 모든 메일이 1개 테스트 주소로) + `EMAIL_FROM` 미검증 도메인 | 메인 | `lib/email.ts:6,17,28~45` | 비번재설정·영수증·결제 성공/실패·가입 메일이 사용자에게 안 감. 결제 알림 강제채널이라 백업도 동시 마비 | 운영 env 게이트 |
| **P0-5** | **익명 신고자 신원 노출 (단계적 공개 절차 우회)** | A | `admin-incident/harassment-reports.ts`·`admin-legal-consultations.ts`(목록 JOIN) + `user-my-report-detail.ts`·`legal-consultation-detail.ts`(마스킹 누락) | 어드민 목록 API가 익명 신고의 실제 회원명을 `admin-anonymous-reveal`(감사로그 동반) 거치지 않고 노출. SIREN 핵심 가치(익명성) 훼손 | 코드(마스킹·필터) |

> **P0-5 클러스터**: A의 P0(상세조회 reporterName 마스킹 누락 — 현재 저장값 null이라 실노출은 없으나 정책 미완성) + A의 P1-3(어드민 목록 실명 우회 — **실노출**) + A의 P1-4(법률상담 partyInfo 미마스킹)를 함께 묶음. 어드민 전용(requireAdmin 보호)이라 일반 사용자 노출은 아니나, 신고 플랫폼 특성상 운영 전 정리 최우선.

---

## 2. P1 — 기능 오작동·워크플로우 단절

| # | 발견 | 영역 | 위치 | 영향 |
|---|---|---|---|---|
| **P1-1** | **cron 12개 netlify.toml 미등록** (파일 내 `export const config={schedule}`만 의존·"일부 환경 인식 안 됨" 선례) | C·B·메인 **통합** | `netlify.toml` ↔ 12개 cron | `cron-agent-8`(일일브리핑)·`cron-task-risk`·`cron-billing-card-expiry`·`cron-workspace-trash-cleanup`(이상 §8 운영목록)·`cron-payroll-monthly`(급여집계)·`cron-auto-trigger-evaluator`·`cron-att-late/remote-streak`·`cron-milestone-quarter`·`cron-ms-anomaly`·`cron-ms-deadline-remind`·`cron-tracking-stats-rollup` 미실행 위험 |
| **P1-2** | **카드 만료 사전 안내가 KICC 빌키에서 영구 무작동** (`card_expiry_month` 미저장) | 메인 | `billing-approve.ts:186~202` + `cron-billing-card-expiry.ts:113~206` | 만료 알림 대상 조회 자체가 NULL → 30/14일·만료 알림 0건. 카드만료發 결제실패·이탈 예방 불가 |
| **P1-3** | **신고 수정이 무음으로 실패** (클라 `content` vs 서버 `contentHtml`) | A | `my-reports.js:471` ↔ `incident/harassment/legal-*-update.ts:35` | "저장됨" 토스트는 뜨나 내용은 안 바뀜(제목만 변경) |
| **P1-4** | **법률상담 사용자 삭제 시 상태 검증 없음** | A | `legal-consultation-delete.ts:44` | 어드민 검토 중(reviewing)인 건도 사용자가 삭제 가능(사건·악성민원엔 방어 있음) |
| **P1-5** | **게이미피케이션 `admin-badge-definitions/{code}` 404** (와일드카드 path 미등록) | C | `admin-badge-definitions.ts:7` ↔ `admin-gamification.html:567` | 배지 정의 삭제·수정 불동작 |
| **P1-6** | **게이미피케이션 `admin-rewards/{id}` 404** (와일드카드 path 미등록) | C | `admin-rewards.ts` ↔ `admin-gamification.html:644,660` | 리워드 수정·삭제 불동작 |
| **P1-7** | **KICC 웹훅 서명 검증 없음** (위조 노티로 pending→completed 가능) | 메인 | `kicc-webhook.ts:6,88~108` | 미결제 후원 위조 완료 가능(영수증·포인트 미발급이라 영향 제한·pgOrderNo 추측난해). 재무 무결성 하드닝 |
| **P1-8** | **재정 승인 버튼이 super_admin 외에도 노출** (서버 403이라 권한구멍 X, UX 단절) | C | `admin-expenses.js:790`·`admin-expenses-voucher.js:787` | admin/operator가 승인 클릭 → 403 오류 토스트만 |
| **P1-9** | **급여 분기 성과급 안분 — 분기 경계 어긋날 때 중복/오반영 위험** | B | `lib/payroll-calc.ts:95,170~188` | 정상 케이스는 의도된 균등안분이나, 분기 마감 전 PAID 시 실수령액 오류 가능 → 비즈니스 확인 필요 |

---

## 3. P2 — 개선·정합·UX·잔재 (운영 후 정리 가능)

**메인 (5)**
- `/api/donate`(donate.ts) 죽은 레거시 엔드포인트 + 카드→`pgProvider:"toss"` 라벨·KICC 미연동(호출처 0) → 제거 권장
- 휴대폰 인증 만료 안내 "5분" 오표기(실제 3분) — `auth-phone-verify-check.ts:53`
- 후원 채널 라벨 "toss" 잔재(KICC인데 통계·목록에 토스 표기) — `lib/donor-status.ts` + admin 통계 3종 **(C 교차)**
- 발송 래퍼 파일명·식별자 "aligo" 레거시(내용은 솔라피) — `aligo-client.ts`·`notify-adapters/*aligo.ts`
- 카카오 알림톡 미설정 시 silent `ok:true`(미발송이 "성공"으로 기록) — `kakao-aligo.ts:247~253`

**A (4)**
- 게시판 익명전환 시 `authorName` 미갱신(익명↔실명 불일치) — `board-update.ts:54`
- `legal-consultation-create.ts`·`support-create.ts` `export const config` 위치 비관례
- `my-reports.js` `responding` 상태 라벨 누락(원시값 노출)
- 사건 댓글에 `requireActiveUser` 미적용(블랙 회원 댓글 가능) — `incident-comments.ts:96`

**B (5)**
- `workspace-calendar.js`·`workspace-kanban.js` mock 데이터 "B 머지 전" 잔재(방어 폴백·실회원명 하드코딩)
- `payroll_slips` schema 주석에 PAID 상태 누락 — `schema.ts:3832`
- `admin-ai-agent.ts` adminId 추출 경로 비일관(`ctx.admin.uid` vs `member.id`)
- `att-leave-request.ts` 반차 컬럼을 매 요청마다 `information_schema` 조회(불필요 I/O)

**C (5)**
- CLAUDE.md §5 환경변수에 `KICC_*` 미등재
- `migrate-phase22a-c-seed.ts` 양방향(run/cleanup) 위험(P0-1 중복·특별 강조)
- `cms-tbfa.js` tabLabels에 `forms-builder` 누락(타이틀 기본값 표시)
- `admin-attendance-settings.html` redirect 전용 파일 잔존(noindex 있음)
- `cms-tbfa.html` `comment-reports` 사이드바 메뉴 누락(URL 해시로만 진입)

---

## 4. ⭐ 운영 전 환경변수·정리 게이트 (Swain 핸즈온 — 코드 결함 아님)

P0/P1 중 상당수가 **오픈 직전 1회 확인이면 해소**되는 운영 게이트입니다. 별도 묶음으로 우선 점검 권장:

| 게이트 | 확인 항목 | 미설정 시 |
|---|---|---|
| **이메일** (P0-4) | Resend 도메인 검증 + `RESEND_TEST_RECIPIENT` **제거** + `EMAIL_FROM`=검증도메인 | 모든 사용자 메일 미수신/미발송 |
| **AI 시크릿** (P0-3) | `INTERNAL_TRIGGER_SECRET` 설정 (+ 코드: 빈값일 때도 차단으로 하드닝) | AI 백그라운드 무인증 호출 |
| **솔라피 알림톡** (P2) | 카카오 승인 후 `SOLAPI_KAKAO_PFID` + `SOLAPI_TPL_*` 6개 | 알림톡 미발송(인앱/이메일 백업은 됨) |
| **KICC 결제** | `KICC_MALL_ID`·`KICC_SECRET_KEY`·`KICC_API_DOMAIN`·`KICC_MODE`(+MID 권한 활성화) | 카드 결제·자동청구 불가 |
| **migrate 정리** (P0-1) | 9개 파일 삭제 + 커밋 | 운영 데이터 삭제·약관 덮어쓰기 노출 |

---

## 5. 도메인 경계 교차검증 결과

- **cron netlify.toml 미등록**: 메인(card-expiry)·B(payroll·agent-8·task-risk)·C(12개 전수) **3자 독립 발견 → 동일 근거(netlify.toml:182 주석)**. P1-1 단일 행으로 통합, C가 권위 목록·인프라 담당. ✅ 중복 확인
- **카드 만료 알림**: toml 미등록(P1-1)과 card_expiry_month 미저장(P1-2)은 **별개 원인**. 둘 다 고쳐야 작동(toml 등록해도 데이터 없으면 0건).
- **채널 "toss" 라벨**(P2): donor-status.ts(메인·후크) + admin 통계(C) 양쪽 동기 정정 필요.
- **익명성**(P0-5): A 단독 도메인. 어드민 목록 우회는 A·C 권한 경계지만 신고 데이터라 A 소관.
- **누락 없음 확인**: 결제(메인)·신고(A)·근태급여(B)·재정인프라(C) 4영역이 §2 도메인 경계대로 커버. 발송 엔진=메인/발송 화면=C 경계도 충돌 없음.

---

## 6. 다음 단계 (Swain 결정 요청)

1. **P0 5건은 오픈 전 필수.** 그중 P0-1(migrate 삭제)·P0-2(billing config)·P0-5(익명성)는 **코드 수정**, P0-3·P0-4는 **env 게이트**(+P0-3 코드 하드닝 권장).
2. **수정 라운드 분배 제안**: 도메인별로 ① C = migrate 삭제·billing config·게이미피케이션 라우팅·cron toml 일괄 등록(P0-1,2 / P1-1,5,6,8) ② 메인 = 카드만료 저장·웹훅 하드닝·잔재 정리(P1-2,7 / P2) ③ A = 익명성·신고수정·삭제검증(P0-5 / P1-3,4) ④ B = AI 시크릿 하드닝·급여 안분 확인(P0-3 / P1-9). **단, 검수 라운드와 동일하게 도메인 분리 = 충돌 0** 유지.
3. **env 게이트 4종은 Swain이 Netlify에서 직접 확인**(코드 무관·1회).
4. 합의 후 본 master.md → `docs/history/`로 이동, PROJECT_STATE 갱신.

---

## 7. 검수 못 한/불확실 (공통)
- **실제 Netlify 환경**: Scheduled Functions 인식 여부·env 실값(KICC·SOLAPI·RESEND·INTERNAL_TRIGGER_SECRET)·migrate 호출 완료 여부는 대시보드/DB 직접 확인 필요(코드만으로 불가).
- **DB 스키마 ↔ schema.ts 1:1**: drizzle/ SQL 대조 미완(코드 레벨만).
- **효성 CMS+ CSV 매칭·communication 발송 큐·grade/badge 계산** 깊이 미검수(메인).
- **재정 금액 DB 제약(음수 방지)·ai_tool_permissions 시드·payroll_settings 행 존재** 미확인(B·C).
