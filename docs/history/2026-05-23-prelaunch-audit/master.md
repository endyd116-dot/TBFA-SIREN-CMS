# 운영 전 전수 검수 — 마스터 우선순위표 (최종)
> 2026-05-23 / 메인(총괄) 취합 — 4영역 **권위 리포트**(메인·A·B·C 각 채팅 자체 검수) 통합·중복제거·교차검증
> 원본: [main.md](main.md)(메인 Opus) · [a.md](a.md)(4f9f4b6) · [b.md](b.md)(cf0aaba) · [c.md](c.md)(d247d7f)
> **검수까지. 수정은 본 표로 우선순위 합의 후 별도 fix 라운드.**
> ⚠️ a/b/c.md는 각 채팅의 권위 리포트로 교체 회수함(메인 fan-out 초안 폐기). C는 자체 재검증으로 에이전트 1차 오탐(P0 6→1)을 정정 → 본 표는 **확정 건만** 반영.

---

## 0. 종합 집계 (권위 리포트 기준·중복 제거)

| 영역 | 검수자 | P0 | P1 | P2 |
|---|---|---|---|---|
| 메인 (인증·후원·결제·알림) | Opus | 1 | 3(+AI백그라운드 1) | 5 |
| A (SIREN신고·유족지원·공개사이트) | Sonnet | 0 | 4 | 3 (+관찰 4) |
| B (워크스페이스·근태·성과급여·AI) | Sonnet | 0 | 12 | 23 |
| C (어드민CMS·재정·권한·빌더·인프라) | Sonnet(직접 재검증) | 1 | 1 | 7 |
| **마스터 (중복 통합 후)** | — | **2** | **19** (P1-9 정책 해소 → 실수정 **18**) | **~38** |

**핵심 통찰 3가지**
1. **운영 즉시 다운·데이터 유실급 P0는 사실상 없음.** 확정 P0 2건은 ① 이메일 운영 게이트(env) ② operator 권한 상승(operator 등급 발급 시에만 발현). 코드 베이스는 전반적으로 견고.
2. **진짜 위험은 "성공한 듯 보이나 실제로는 안 도는" 조용한 워크플로우 단절(P1)** — A·B에 집중. 사용자 신뢰 직타라 오픈 전 정리 권장.
3. **최대 교차 이슈 = cron netlify.toml 미등록** (메인·B·C 3자 발견). 단 **C는 "Netlify가 인라인 config.schedule 공식 지원 → 무해(P2)"로 판정**, B·메인은 프로젝트 자체 경고주석 근거로 P1. → **대시보드 1회 확인으로 종결**(아래 §4).

---

## 1. P0 — 운영 즉시 장애 (오픈 전 반드시 해소) · 확정 2건

| # | 발견 | 영역 | 위치 | 영향 | 성격 |
|---|---|---|---|---|---|
| **P0-1** | **이메일 전체가 테스트 redirect 모드에 묶임** — `RESEND_TEST_RECIPIENT` 설정 시 모든 메일이 1개 테스트 주소로 / `EMAIL_FROM` 미검증 도메인 시 발송 불가 | 메인 | `lib/email.ts:6,17,28~45` | 비번재설정·후원영수증·결제 성공/실패·가입메일이 사용자에게 안 감. 결제 알림 강제채널이라 백업도 동시 마비 | **운영 env 게이트** |
| **P0-2** | **운영자 관리 API 권한 상승** — `requireAdmin`만 통과하면(operator 포함) 임의 회원을 super_admin으로 승급·역할 변경 가능 | C | `admin-operators.ts:51,139-140,197-198` | operator 등급이 자신을 super_admin으로 자가 승격 → 4계층 권한 무력화. **전제: 이미 operator 계정 존재**(외부 공격 아님) | 코드(super_admin 게이팅) |

> **P0-2 확정 (2026-05-23 Swain)**: **슈퍼어드민·어드민·운영자 3계층 전부 운영 예정** → operator 등급을 실제 발급하므로 **운영 전 필수 차단 확정**(조건부 아님). operator가 자신/타인을 super_admin으로 승급하는 경로를 막아야 함. 형제 함수(`admin-service-rnr.ts`·`admin-role-permissions.ts`)는 super_admin을 강제하는데 이 함수만 누락.

---

## 2. P1 — 기능 오작동·워크플로우 단절 (대부분 "성공처럼 보이나 실동작 안 함")

### 2-A. 교차·인프라
| # | 발견 | 영역 | 위치 | 영향 |
|---|---|---|---|---|
| **P1-1** | **cron 7~12종 netlify.toml 미등록** (인라인 config.schedule만 의존) | 메인·B·C | `netlify.toml` ↔ `cron-payroll-monthly`·`cron-agent-8`·`cron-task-risk`·`cron-billing-card-expiry`·`cron-workspace-trash-cleanup`·`cron-milestone-quarter`·`cron-att-late/remote-streak`·`cron-ms-*`·`cron-auto-trigger-evaluator`·`cron-tracking-stats-rollup` | 인라인이 안 먹는 환경이면 급여 월집계·일일브리핑·카드만료알림·휴지통정리 영구 무동작. ✅ **해결책 확정(2026-05-23): 대시보드 확인 불필요 — 수정 라운드에서 빠진 cron을 netlify.toml에 마저 등록(이중 등록은 무해)하면 논쟁 자체 종결.** C 담당 |

### 2-B. 결제·알림 (메인)
| # | 발견 | 위치 | 영향 |
|---|---|---|---|
| **P1-2** | **KICC 빌링키 관리 화면 전체 404** — `admin-billing-keys`·`admin-billing-logs`에 `export const config={path}` 누락 | `admin-billing-keys.ts`·`admin-billing-logs.ts` ↔ `cms-tbfa.js:2580~2836` | 어드민 "💳 KICC 빌링" 탭 진입 시 빌링키 목록·통계·해지·로그 전부 404. **단 자동청구 cron은 독립 정상** → 화면 조회만 영향 (C 발견·메인 교차확인) |
| **P1-3** | **카드 만료 사전 안내가 KICC 빌키에서 영구 무작동** — 빌키 저장 시 `card_expiry_month` 미저장 | `billing-approve.ts:186~202` + `cron-billing-card-expiry.ts:113~206` | 만료 알림 대상 조회가 NULL → 30/14일·만료 알림 0건 |
| **P1-4** | **KICC 웹훅 서명 검증 없음** — 위조 노티로 미결제 pending→completed 가능 | `kicc-webhook.ts:6,88~108` | 가짜 완료 후원 가능(영수증·포인트 미발급·pgOrderNo 추측난해라 영향 제한). 재무 무결성 하드닝 |
| **P1-5** | **AI 백그라운드 함수 무인증** — `INTERNAL_TRIGGER_SECRET` 미설정 시 인증 스킵(`expected && …` 통과) | `ai-task-summary/completion/milestone-match-background.ts` | 외부에서 유효 taskId로 POST → 기존 작업 AI 요약 반복 호출(비용). **메인 직접 확인**(권위 B는 미등재) → env 설정 + 빈값=차단 하드닝 |

### 2-C. 신고·유족·공개사이트 (A)
| # | 발견 | 위치 | 영향 |
|---|---|---|---|
| **P1-6** | **신고 수정 시 본문·분류 손실** (프론트 `content` ↔ 서버 `contentHtml`, 3종 동일) + 수정 모달 빈 본문 | `my-reports.js:471` ↔ `incident/harassment/legal-*-update.ts:35` / `user-my-reports.ts:46~118` | "수정됨" 토스트는 뜨나 제목만 저장·내용 사라짐 |
| **P1-7** | **전문가 상담 내역 항상 "내역 없음"** (서버 `{active,closed}` ↔ 프론트 `items/matches`) | `expert-match-list.ts:102~109` ↔ `mypage-expert-match.js:195` | 매칭돼도 채팅입장 버튼 안 뜸 |
| **P1-8** | **게시글 구독 버튼 항상 실패** (미존재 엔드포인트 `board-subscription-status/toggle` 호출) | `board.js:476,497` (실제는 `user-post-subscribe`) | 클릭 시 "네트워크 오류"(404) |
| ~~P1-9~~ | ~~익명 신원공개 super_admin 게이팅 부재~~ → ✅ **정책상 해소 (2026-05-23 Swain): 일반 관리자 전원 허용이 의도** | `admin-anonymous-reveal.ts:35~37` | **수정 불필요.** 신원 열람은 의도적으로 전 관리자 허용. 전건 감사로그(`anonymous_reveal_logs`: adminId·사유·IP·레벨)로 사후 추적 유지 |

### 2-D. 워크스페이스·근태·성과급여·AI (B)
| # | 발견 | 위치 | 영향 |
|---|---|---|---|
| **P1-10** | **운영자 목록 응답 이중 래핑** → 카드 토스 셀렉트 + @멘션 자동완성 둘 다 빈 채 | `admin-workspace-member-list.ts:45`(`ok({data})`) ↔ `workspace-task-modal.js:246`·`workspace-kanban.js:1561` | **1원인 2증상 — 수정 1곳으로 동시 해소**(files.js는 `res.data.data`로 정상) |
| **P1-11** | **카드 본문 @멘션 영구 미표시** (저장 `workspace_id=0` vs 조회 `=1`) | `admin-workspace-tasks.ts:115~123` ↔ `workspace.js:1483`·`workspace-task-mentions.ts:27` | 카드 제목/설명 멘션 안 뜸(댓글 멘션은 정상) |
| **P1-12** | **보관 카드 "복원" 버튼 무동작** (없는 `deleted_at` 컬럼 갱신) | `admin-workspace-tasks.ts:903~924` (`workspace_tasks`엔 deletedAt 없음) | 모달 복원 안 됨(드래그 unarchive는 정상) |
| **P1-13** | **휴가 다건 동시신청 시 잔여 초과** (승인대기 PENDING 합산 미검증) | `att-leave-request.ts:101~125` | 겹치지 않는 PENDING 다건 통과 → used_days > total_days |
| **P1-14** | **1주년 연차 부여가 만근 보너스 덮어씀** (`GREATEST(total,15)` 재설정) | `cron-att-leave-auto.ts:107,144~150` | 동월 발생 직원 만근 +1 무시 |
| **P1-15** | **비매출 성과 자동제출 분기경계 누락 ×2** (수동·AI 매칭 모두 과거 done 누적 합산) | `workspace-milestone-task-match.ts:93~99` + `ai-task-milestone-match-background.ts:172~178` | 목표 도달 오판 → 엉뚱한 분기 보너스 오생성 |
| **P1-16** | **급여 force 재집계 시 조정라인·기타공제 정합 깨짐** (calc 공식이 adjustments/otherDeduction 미반영) | `lib/payroll-calc.ts:190,194~196` vs `admin-payroll.ts:201~204` | 수동 조정 후 재집계 시 세전/실수령 불일치 |
| **P1-17** | **급여 계산기준 저장 무동작** (seed 행 없으면 UPDATE 0행·INSERT 없음) | `admin-payroll-settings.ts:51~68` | "저장 완료" 떠도 요율 미반영(집계는 기본값 폴백). **DB seed 확인 필수** |
| **P1-18** | **Agent-9 주간 보고서 super_admin 수신자 누락** (`memberSubtype="super_admin"` 잘못된 컬럼) | `cron-agent-9.ts:134~137` (정답은 `members.role`) | super_admin들에게 미발송(ADMIN_NOTIFY_EMAIL 1곳만) |

> **B 도메인 즉시 fix 권장 묶음**: P1-10(이중래핑·1곳으로 2건)·P1-11·P1-12·P1-15(보너스 오생성). 모두 필드명/응답키/컬럼 정합 — 수정 규모 작음.

---

## 3. P2 — 개선·정합·UX·잔재 (운영 후 단기 정리·약 38건)

원본 리포트에 상세. 도메인별 핵심 테마만:

- **메인 (5)**: `/api/donate` 죽은 레거시(카드→"toss" 라벨·KICC 미연동·호출처 0) / 휴대폰 인증 "5분" 오안내(실제 3분) / 후원 채널 "toss" 라벨 잔재(KICC인데 통계에 토스·**C 교차**) / 발송 래퍼 파일명 "aligo" 레거시(내용은 솔라피) / 카카오 알림톡 미설정 시 silent `ok:true`
- **A (3 + 관찰 4)**: 신고 알림 딥링크 404(`admin-siren.html`·`mypage-siren.html` 미존재) / 내신고 페이지네이션 어긋남(서버 limit 20 고정·total 미반환) / `incident.js` 미정의 MOCK 잔재 / (관찰) 첨부 AI 미반영·차단가드 경미 불일치·`test-attachment.html`·migrate 잔재
- **B (23)**: 캘린더·칸반 mock 폴백 잔재 / RSVP 2시스템 분리 / done 재매칭 가드 스네이크케이스 오타 / 비-REMOTE 재택보고서 오안내 / `att-my-leaves` dead / AI featureKey 8종 비용통제 누락 / cron-ai-schedule-runner 자유입력 / 가격표·폴백체인 불일치 / payroll PAID 주석 누락 등 (b.md 본문)
- **C (7)**: 전표↔예산/은행 FK 미설정 / **migrate-* 9개 잔존(가드 있어 P2·정책 위반·삭제 대상)** / 발송잡 templateId 타입폭 / 폼빌더 file 필드 미완성(첨부해도 저장 안 됨·조용한 손실) / 자격심사 역할제한 검토 / 'toss-billing' 내부키 잔재 / tabLabels·사이드바 누락

> **migrate-* 9개**: C가 직접 재검증 — `requireAdmin` 가드가 있어 **P0 아님 P2**(메인 fan-out 초안의 P0는 오탐). 단 정책상(CLAUDE.md §9.1.2) 삭제 대상이라 오픈 전 일괄 정리 권장.

---

## 4. ⭐ 오픈 전 게이트 — Swain 핸즈온 (검수로 확인 불가·코드 무관)

코드 수정과 별개로 **오픈 직전 1회 확인이면 해소**되는 항목:

| 게이트 | 확인 | 미설정 시 | 연결 |
|---|---|---|---|
| **이메일** | Resend 도메인 검증 + `RESEND_TEST_RECIPIENT` **제거** + `EMAIL_FROM`=검증도메인 | 모든 사용자 메일 미수신/미발송 | P0-1 |
| **AI 시크릿** | `INTERNAL_TRIGGER_SECRET` 설정 (+ 코드: 빈값=차단 하드닝) | AI 백그라운드 무인증 호출 | P1-5 |
| **솔라피 알림톡** | 카카오 승인 후 `SOLAPI_KAKAO_PFID` + `SOLAPI_TPL_*` 6개 | 알림톡 미발송(인앱/이메일 백업은 됨) | 메인 P2 |
| **KICC 결제** | `KICC_MALL_ID`·`KICC_SECRET_KEY`·`KICC_API_DOMAIN`·`KICC_MODE`(+MID 권한) | 카드 결제·자동청구 불가 | — |
| **cron 등재** | Netlify 대시보드 Scheduled Functions에 7~12종 실제 등재 확인 | 급여집계·브리핑·카드만료·휴지통 미실행 | P1-1 |
| **DB seed** | `payroll_settings(id=1)` / 근태 `att_policies(default)`·`att_leave_types`·`att_workplaces` 행 | 급여 요율 미반영·근태 검증 오류 | P1-17 |
| **migrate 정리** | 9개 파일 삭제 + 커밋 | 정책 위반·공격표면(가드는 있음) | C P2 |

---

## 5. 도메인 경계 교차검증 결과

- **cron 미등록**: 메인(card-expiry)·B(7종)·C(전수) 독립 발견 → P1-1 단일 통합. C 판정(인라인 무해)과 B·메인 판정(P1) 상충 → **수정 라운드에서 netlify.toml 일괄 등록(무해)으로 종결 확정(2026-05-23 Swain)** — 대시보드 확인 불요.
- **KICC 빌링 화면 404**: C 발견(어드민 화면)·메인 교차확인(결제). 메인 fan-out은 P0, C 재검증은 P1(cron 독립 정상) → **P1 채택**.
- **채널 "toss" 라벨**(P2): donor-status.ts(메인·후크) + admin 통계(C) 양쪽 동기 정정.
- **발송 어댑터 alligo import**(C 교차질문): **메인 확인 완료** — `aligo-client`·`sms-aligo`·`kakao-aligo`는 전부 솔라피 위임 래퍼(`solapiSendSms/Mms/Alimtalk`). `admin-system-notification-list`의 import는 미리보기 헬퍼라 실발송 무관 → **기능 잔재 아님, 파일명 잔재(P2)만.** SMS는 라이브 검증 완료(HANDOFF §8).
- **익명성**(A P1-9): A 단독 도메인·정책 결정.
- **누락 없음**: 4영역이 §2 도메인 경계대로 커버. 발송 엔진=메인/발송 화면=C 경계 충돌 0.

---

## 6. 다음 단계 (Swain 결정 요청)

1. **P0 2건 오픈 전 필수 (둘 다 확정)**: P0-1(이메일 env 게이트·§4) · P0-2(operator 권한 차단 — **운영자 3계층 운영 확정으로 필수**).
2. **Swain 검토 결정 반영(2026-05-23)**: P1-9(익명공개 게이팅) = **의도된 정책으로 해소·수정 불필요** / P1-1(cron) = **netlify.toml 일괄 등록으로 종결·대시보드 확인 불요**.
3. **수정 라운드 도메인 분배 제안**(검수와 동일 = 충돌 0):
   - **메인** = KICC 빌링화면 config·카드만료 저장·웹훅 하드닝·AI시크릿 하드닝·잔재(P1-2,3,4,5 / P2)
   - **A** = 신고수정·전문가내역·구독버튼(P1-6,7,8) — 필드명/응답키/엔드포인트라 소규모 (P1-9 제외)
   - **B** = 이중래핑·멘션·복원·휴가합산·분기경계·급여정합·Agent-9(P1-10~18)
   - **C** = operator 권한 차단(P0-2)·cron toml 일괄 등록(P1-1)·게이미피케이션 라우팅·migrate 삭제·FK(P2)
3. **§4 게이트 7종은 Swain이 Netlify·DB에서 직접 확인**(코드 무관·1회).
4. 합의 후 본 master.md → `docs/history/`로 이동, PROJECT_STATE·HANDOFF 갱신.

---

## 7. 검수 못 한/불확실 (공통)
- **실제 Netlify 환경·DB seed**: env 실값·Scheduled Functions 등재·payroll_settings/근태 시드는 대시보드/DB 직접 확인 필요(코드만으로 불가).
- **C 자체 재검증**: 에이전트 1차 P0 6·P1 11 → 확정 P0 1·P1 1. 나머지 오탐은 c.md "오탐 정정표" 참조(마스터 미반영).
- **라이브 재현 미수행**: 전 P1은 읽기전용 정적 추적 — fix 착수 전 라이브 재현 권장.
- 효성 CSV 매칭·communication 발송큐·grade/badge(메인) / 어드민 처리화면 심층·AI 라이브러리 내부(A·B) / 재정 세부·KPI 렌더링·캐시버스터 런타임(C) 깊이 미검수.
