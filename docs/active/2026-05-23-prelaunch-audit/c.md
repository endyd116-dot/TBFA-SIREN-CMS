# C 영역(어드민CMS·재정·권한·빌더·인프라) 전수 검수 리포트
> 2026-05-23 / C 검수자 (Claude Sonnet 4.6)

---

## 요약: P0 2건 / P1 16건 / P2 5건

---

## 검수한 워크플로우 (시나리오 + 결과)

| 워크플로우 | 결과 |
|---|---|
| 전체 cron 함수 ↔ netlify.toml schedule 1:1 대조 | **P1** — 12개 미등록 |
| migrate-* 1회용 파일 잔존 여부 | **P0** — 9개 잔존 |
| admin-billing-keys/logs API 라우팅 정합 | **P0** — config path 미등록, 클라이언트 경로 불일치 |
| 재정 워크플로우 (지출→증빙→예산→결산) | PASS — config, 권한, guard 정상 |
| 재정 권한 (예산·지출 승인 = super_admin 전용) | PASS |
| 전표 생성→제출→승인 워크플로우 | PASS |
| 은행 거래 자동 추출→매칭→전표 생성 워크플로우 | PASS |
| 폼빌더 생성→공개→응답 수집→집계 워크플로우 | PASS |
| 사이트빌더 편집→홈 반영 (nav-menus, site-settings) | PASS |
| 큐레이션·팝업 CRUD | PASS |
| 권한 정책 (4계층) — requireRole 적용 현황 | PASS |
| 운영자 관리 (admin-operators.ts) | PASS |
| 게이미피케이션 badge-definitions 경로 정합 | **P1** — /ID 경로 → 와일드카드 미등록 |
| 게이미피케이션 admin-rewards 경로 정합 | **P1** — /ID 경로 → 와일드카드 미등록 |
| 급여관리 (payroll) 워크플로우 | PASS |
| 발송 화면 (send-jobs·templates·recipient-groups·auto-trigger·analytics) | PASS |
| cms-tbfa iframe 4곳 등록 정합 | PASS |
| 근태 화면 (att-ops, att-config iframe 리다이렉트) | PASS |
| 감사 로그 super_admin 전용 | PASS |
| AI 비서 설정 권한 | PASS |
| admin-gamification 경로 | **P1** (badge-definitions, rewards) |

---

## 발견사항

### P0 — 즉시 장애급

---

**[P0-1] migrate-* 1회용 파일 9개 잔존 — 운영 중 어드민이 재호출 시 데이터 덮어쓰기·보안 구멍**

| 항목 | 내용 |
|---|---|
| 위치 | `netlify/functions/migrate-ai-agent-settings.ts`, `migrate-ai-agent.ts`, `migrate-ai-cost-tracking.ts`, `migrate-ai-tools-f7.ts`, `migrate-ai-tools-readplus.ts`, `migrate-ai-tools-x.ts`, `migrate-phase22a-c-seed.ts`, `migrate-potential-donors.ts`, `migrate-static-pages.ts` |
| 증상 | 1회용 마이그레이션 함수가 호출 완료 후에도 삭제되지 않고 라이브 엔드포인트로 남아있음 |
| 기대 | 호출 성공 확인 즉시 파일 삭제 + 커밋 (CLAUDE.md §6.8, §9.1.2) |
| 근거 | CLAUDE.md §9.1.2: "1회용. 호출 후 즉시 삭제 (보안 + 코드 청결성)". `migrate-phase22a-c-seed.ts`는 시드 데이터 INSERT 용도로 운영 DB에 테스트 데이터 오염 위험이 특히 높음 |
| 심각도 이유 | `migrate-phase22a-c-seed.ts` — GET ?cleanup=1로 운영 데이터 삭제 가능. `migrate-static-pages.ts` — 이용약관·개인정보처리방침 본문을 덮어씀. 인증 없는 GET 진단 엔드포인트도 모두 라이브 노출 |

---

**[P0-2] admin-billing-keys.ts, admin-billing-logs.ts — export const config 누락으로 API 404**

| 항목 | 내용 |
|---|---|
| 위치 | `netlify/functions/admin-billing-keys.ts` (전체), `netlify/functions/admin-billing-logs.ts` (전체) |
| 증상 | 두 함수 모두 `export const config = { path }` 없음. Netlify 기본 라우팅은 `/.netlify/functions/admin-billing-keys`. 클라이언트는 `/api/admin/billing-keys`, `/api/admin/billing-logs` 경로로 호출 → 404 |
| 기대 | `export const config = { path: "/api/admin/billing-keys" }`, `export const config = { path: "/api/admin/billing-logs" }` 추가 |
| 근거 | `public/js/cms-tbfa.js:2580` — `api('/api/admin/billing-keys?stats=1')`, `cms-tbfa.js:2720` — `api('/api/admin/billing-logs', ...)`. 두 파일에 config 없음은 직접 grep 확인 |
| 영향 | KICC 자동결제 빌링키 관리 화면 전체 불동작 (빌링키 목록 조회·비활성화·재활성화·로그 조회 모두 404) |

---

### P1 — 기능 오작동·워크플로우 단절

---

**[P1-1] cron 12개 netlify.toml 미등록 — 코드 내부 schedule만 있어 실행 보장 불확실**

| cron 함수 | 내부 schedule | 역할 |
|---|---|---|
| `cron-agent-8.ts` | `0 21 * * *` | 일일 브리핑 생성 (CLAUDE.md §8 운영 목록) |
| `cron-task-risk.ts` | `30 21 * * *` | 작업 리스크 점수 갱신 (CLAUDE.md §8 운영 목록) |
| `cron-billing-card-expiry.ts` | `0 0 * * *` | 카드 만료 알림 (CLAUDE.md §8 운영 목록) |
| `cron-workspace-trash-cleanup.ts` | `0 18 * * *` | 워크스페이스 휴지통 30일 정리 (CLAUDE.md §8 운영 목록) |
| `cron-payroll-monthly.ts` | `0 17 1 * *` | 월간 급여 자동 집계 |
| `cron-auto-trigger-evaluator.ts` | `*/30 * * * *` | 자동 발송 트리거 평가 (30분) |
| `cron-att-late-streak.ts` | `5 23 * * *` | 근태 지각 연속 알림 |
| `cron-att-remote-streak.ts` | `0 23 * * *` | 재택 연속 알림 |
| `cron-milestone-quarter.ts` | `0 0 * * *` | 분기 마일스톤 점검 |
| `cron-ms-anomaly.ts` | `0 22 * * *` | 마일스톤 이상 감지 |
| `cron-ms-deadline-remind.ts` | `0 0 * * *` | 마일스톤 마감 리마인더 |
| `cron-tracking-stats-rollup.ts` | `0 */6 * * *` | 트래킹 통계 롤업 (6시간) |

- **위치**: `netlify.toml` 전체, 각 `.ts` 파일 내 `export const config = { schedule }`
- **근거**: netlify.toml:182 주석 — "일부 환경에서 인식 안 됨 → netlify.toml에도 명시해 이중 등록". 이 주석이 붙어있는 `cron-communication-send-dispatcher`는 toml에 등록되어 있으나 위 12개는 미등록
- **기대**: 각 cron에 대해 netlify.toml에 `[functions."cron-xxx"] schedule = "..."` 블록 추가, 또는 코드 내부 schedule 방식이 해당 환경에서 충분히 인식됨을 별도 확인

---

**[P1-2] admin-badge-definitions.ts — 클라이언트 `/api/admin-badge-definitions/{code}` 호출 시 404**

| 항목 | 내용 |
|---|---|
| 위치 | `netlify/functions/admin-badge-definitions.ts:7`, `public/admin-gamification.html:567,583` |
| 증상 | 클라이언트: `api('/api/admin-badge-definitions/' + code, { method: 'DELETE' })`, 서버 config: `path: "/api/admin-badge-definitions"` (와일드카드 없음). `/ID` 경로는 404 |
| 기대 | config를 `path: "/api/admin-badge-definitions*"` 로 변경하고, 서버에서 `url.pathname`에서 ID 추출 |
| 근거 | `admin-gamification.html:567` — `api('/api/admin-badge-definitions/' + delBtn.dataset.badgeDel, { method: 'DELETE' })`, 함수는 `url.searchParams.get("code")` 로만 처리 (line 16) |

---

**[P1-3] admin-rewards.ts — 클라이언트 `/api/admin-rewards/{id}` 호출 시 404**

| 항목 | 내용 |
|---|---|
| 위치 | `netlify/functions/admin-rewards.ts`, `public/admin-gamification.html:644,660` |
| 증상 | 클라이언트: `api('/api/admin-rewards/' + id, { method: 'PATCH' })` / `api('/api/admin-rewards/' + id, { method: 'DELETE' })`. 서버 config: `path: "/api/admin-rewards"` (와일드카드 없음) → 404 |
| 기대 | config를 `path: "/api/admin-rewards*"` 로 변경하고, url.pathname에서 ID 추출 |
| 근거 | `admin-gamification.html:644,660` 직접 확인 |

---

**[P1-4] 재정 계층별 승인 권한 API — 클라이언트에서 super_admin 체크 없이 승인 버튼 노출 (UX 단절)**

| 항목 | 내용 |
|---|---|
| 위치 | `public/js/admin-expenses.js:790`, `public/js/admin-expenses-voucher.js:787` |
| 증상 | 서버에서 super_admin만 승인 가능하도록 requireRole로 보호하지만, 클라이언트 UI에서 admin/operator에게도 승인 버튼이 표시됨. 버튼 클릭 → 서버 403 반환 → 오류 토스트만 뜸 |
| 기대 | 클라이언트가 `/api/admin/me` 호출로 role을 판단해 super_admin에게만 승인 버튼 렌더링 (UX 완성도) |
| 근거 | `admin-expense-approve.ts:17` — `requireRole(auth.ctx.member, "super_admin")`. `admin-expenses.js:790` — 버튼 표시 분기 없음 |
| 비고 | 보안상 서버 403이 있어 권한 구멍은 아니나, 워크플로우상 불필요한 오류 경험 |

---

**[P1-5] cron-billing-card-expiry.ts CLAUDE.md §8 운영 목록인데 toml 미등록**

위 P1-1 포함. 카드 만료 알림은 후원자 결제 연속성에 직접 영향. 별도 강조.

---

**[P1-6] cron-agent-8 toml 미등록 — 일일 브리핑 안 돌아감**

위 P1-1 포함. CLAUDE.md §8 명시 운영 cron으로 운영 즉시 필요.

---

**[P1-7] cron-task-risk toml 미등록 — AI 리스크 점수 갱신 안 돌아감**

위 P1-1 포함. CLAUDE.md §8 명시 운영 cron.

---

**[P1-8] cron-workspace-trash-cleanup toml 미등록 — 휴지통 30일 정리 안 돌아감**

위 P1-1 포함. CLAUDE.md §8 명시 운영 cron.

---

### P2 — 개선·정합·UX·잔재

---

**[P2-1] CLAUDE.md 환경변수 목록에 KICC 관련 변수 미등재**

| 항목 | 내용 |
|---|---|
| 위치 | `CLAUDE.md §5 환경변수`, `lib/kicc.ts:106,110,115,116` |
| 증상 | `KICC_MALL_ID`, `KICC_SECRET_KEY`, `KICC_API_DOMAIN`, `KICC_MODE` 가 코드에서 사용되지만 CLAUDE.md §5에 없음 |
| 기대 | CLAUDE.md §5 환경변수 목록에 KICC_* 추가 |
| 근거 | `lib/kicc.ts:106` — `process.env.KICC_MODE`, `lib/kicc.ts:115` — `process.env.KICC_MALL_ID`, `cron-kicc-billing.ts:58` — 필수 검증 |

---

**[P2-2] migrate-phase22a-c-seed.ts — 검증용 시드 데이터 함수가 1회용이 아닌 양방향(run/cleanup) 설계로 잔존**

| 항목 | 내용 |
|---|---|
| 위치 | `netlify/functions/migrate-phase22a-c-seed.ts:1-5` |
| 증상 | 테스트 시드 INSERT/DELETE 기능이 라이브에 남아있음. cleanup 파라미터로 운영 데이터 삭제 가능 |
| 기대 | 검증 완료 후 삭제 (P0-1에 포함이지만 특히 위험하므로 별도 언급) |

---

**[P2-3] cms-tbfa.html 탭 tabLabels에 일부 탭 누락 (타이틀 바 표시 이상)**

| 항목 | 내용 |
|---|---|
| 위치 | `public/js/cms-tbfa.js:256-299` (tabLabels 객체) |
| 증상 | `forms-builder` 탭이 tabLabels에 없어 타이틀 바가 '교유협 CMS'로 기본값 표시 |
| 기대 | `'forms-builder': '📋 응답폼·신청폼 관리'` 추가 |
| 근거 | `cms-tbfa.js:256-299` tabLabels에 `forms-builder` 키 없음. `cms-tbfa.js:320` — renderFormsBuilder() 분기는 있음 |

---

**[P2-4] admin-attendance-settings.html — redirect 파일만 남아있고 실제 내용 없음 (SEO·직접 접근 혼란)**

| 항목 | 내용 |
|---|---|
| 위치 | `public/admin-attendance-settings.html:1-18` |
| 증상 | 전체 내용이 `location.replace('/admin-workspace-management.html?group=ops')` 리다이렉트만. 외부 링크나 즐겨찾기로 진입 시 인지 혼란 |
| 기대 | 파일 존재는 괜찮으나 robots noindex가 있어 P2 수준. 운영상 문제 없음 |
| 근거 | `admin-attendance-settings.html:8` — `<meta name="robots" content="noindex,nofollow">` |

---

**[P2-5] cms-tbfa.html comment-reports 탭이 사이드바 메뉴에 없음 (직접 URL로만 접근 가능)**

| 항목 | 내용 |
|---|---|
| 위치 | `public/cms-tbfa.html` 사이드바 메뉴 섹션 |
| 증상 | `page-comment-reports` section과 JS 분기 `_nfLoadIframe('page-comment-reports')`는 있으나 사이드바 `data-tab="comment-reports"` 메뉴가 없음. URL 해시로만 진입 가능 |
| 기대 | 관리자가 사이드바에서 댓글 신고 관리로 접근 가능해야 함 |
| 근거 | 사이드바 `data-tab=` 목록(470~567줄) 전체 grep 결과 `comment-reports` 없음, `page-comment-reports` section은 `cms-tbfa.html:2226`에 있음 |

---

## 검수 못 한/불확실 영역

1. **Netlify Scheduled Functions 실제 인식 여부**: 코드 내부 `export const config = { schedule }` 방식이 현재 Netlify 배포 환경에서 실제로 인식되는지 확인 불가. `cron-communication-send-dispatcher` 주석("일부 환경에서 인식 안 됨")이 있어 불확실. 실제 Netlify 대시보드에서 Functions 탭의 scheduled functions 목록 확인 필요.

2. **DB 실제 상태**: migrate-* 파일들이 이미 호출 완료됐는지 여부. 코드만으로는 DB 적용 여부 불확인. Neon DB SQL Editor에서 테이블 존재 여부 확인 필요.

3. **KICC 환경변수 Netlify 등록 여부**: `KICC_MALL_ID`, `KICC_SECRET_KEY` 가 Netlify 환경변수에 실제 등록됐는지 대시보드 확인 필요.

4. **admin-comment-reports 진입 경로**: 사이드바에 없지만 admin.html iframe `src="/admin-comment-reports.html"`(admin.html:3419)으로 admin.html에서는 진입 가능. cms-tbfa.html에서만 사이드바 없음 — 운영팀이 cms-tbfa.html을 기본으로 쓰는지 admin.html을 쓰는지에 따라 P2 수준 달라짐.

5. **재정 금액 무결성 DB 제약**: vouchers·expenses 테이블의 amount NOT NULL, 음수 방지 제약 등은 DB SQL Editor 직접 확인 없이 코드 레벨에서만 확인. schema.ts 레벨 integer 타입 확인은 완료(음수 DB 제약은 코드 검증에 의존).
