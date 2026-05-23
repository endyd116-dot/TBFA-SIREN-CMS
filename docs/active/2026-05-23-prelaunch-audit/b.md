# B 영역(워크스페이스·근태·성과·급여·AI) 전수 검수 리포트
> 2026-05-23 / B 검수자

---

## 요약: P0 1건 / P1 3건 / P2 5건

---

## 검수한 워크플로우

| 시나리오 | 결과 |
|---|---|
| 출근체크 → 위치 검증 → 기록 저장 → 알림 | PASS (att-checkin.ts 정상) |
| 퇴근체크 → 근무시간 계산 → 조퇴 판정 → 기록 갱신 | PASS (att-checkout.ts 정상) |
| 휴가 신청 → 잔여 검증 → 충돌 검사 → PENDING 저장 | PASS |
| 관리자 휴가 승인 → 상태 APPROVED | PASS (admin-att-leave-review.ts 확인) |
| 마일스톤 결산 제출 → AI 계산 → UPSERT | PASS (milestone-settlement.ts 정상) |
| 결산 승인(APPROVED) → PAID → 다음 분기 자동 생성 | PASS |
| 급여 자동 집계 cron → payroll_slips UPSERT | 이슈 (P1-1: netlify.toml 미등록) |
| 급여 명세서 승인 → PDF 발송 → SENT → PAID | PASS (admin-payroll-send.ts 정상) |
| 칸반 카드 생성 → AI 요약 트리거 → 백그라운드 실행 | PASS (fire-and-forget, 폴백 있음) |
| 카드 완료 → AI 완료 보고서 → 마일스톤 매칭 트리거 | PASS |
| AI 에이전트 대화 → 도구 호출 → 비용 기록 → 응답 | PASS (5층 안전장치 확인) |
| Agent-8 cron → 브리핑 생성 → 이메일 발송 | 이슈 (P1-2: netlify.toml 미등록) |
| 리스크 cron → 70점+ 알림 | 이슈 (P1-2: netlify.toml 미등록) |
| AI 백그라운드 함수 보안 | 이슈 (P0-1: 비밀 키 없으면 누구나 호출) |
| 워크스페이스 캘린더 → 이벤트 로드 → Mock 폴백 | P2 (주석에 "B 머지 전" 잔재) |
| 칸반 AI 검색 → Mock 폴백 | P2 (API는 실존, mock은 방어코드) |

---

## 발견사항

### P0

**[P0-1] AI 백그라운드 함수 3개가 비밀 키 미설정 시 인증 없이 누구나 호출 가능**

- 위치: `netlify/functions/ai-task-summary-background.ts:28-32`, `ai-task-completion-background.ts:25-30`, `ai-task-milestone-match-background.ts` 동일 패턴
- 증상: `INTERNAL_TRIGGER_SECRET` 환경변수가 없으면 `expected=""` → 조건 `if (expected && secret !== expected)` 가 false → 인증 완전 스킵. 외부에서 임의의 taskId로 POST 호출 시 Gemini AI를 무제한 호출할 수 있음.
- 근거: `ai-task-summary-background.ts` line 29-31: `const expected = process.env.INTERNAL_TRIGGER_SECRET || ""; if (expected && secret !== expected) { ... }` — expected가 빈 문자열이면 조건 전체가 false.
- 기대 동작: Netlify 환경변수 `INTERNAL_TRIGGER_SECRET`를 반드시 설정하거나, 빈 문자열일 때도 차단(`if (!secret || secret !== expected)`로 변경).
- AI 비용 안전장치(checkFeatureBeforeCall 등)는 이 함수에 없음 — 직접 `generateTaskSummary` 호출.
- CLAUDE.md §5 환경변수 목록에 `INTERNAL_TRIGGER_SECRET` 누락.

---

### P1

**[P1-1] 급여 월간 자동 집계 cron이 netlify.toml에 미등록 — 실행 안 될 수 있음**

- 위치: `netlify/functions/cron-payroll-monthly.ts:19` — `export const config: Config = { schedule: "0 17 1 * *" }` 파일 내부 선언만 있음.
- 위치: `netlify.toml` — `cron-payroll-monthly` 블록 없음 (grep 결과 0건).
- 증상: netlify.toml 주석(line 182-184)에 `cron-communication-send-dispatcher`가 "일부 환경에서 인식 안 됨 → netlify.toml에도 명시해 이중 등록"이라 설명. 동일 이슈로 `cron-payroll-monthly`도 매월 급여 자동 집계가 미실행될 위험. 자동 집계 미실행 시 해당 월 급여 명세서가 아예 생성되지 않음.
- 기대 동작: netlify.toml에 `[functions."cron-payroll-monthly"] schedule = "0 17 1 * *"` 이중 등록.

**[P1-2] Agent-8(일일 브리핑) 및 리스크 점수 cron도 netlify.toml 미등록**

- 위치: `netlify/functions/cron-agent-8.ts:333-335` — 파일 내부 `schedule: "0 21 * * *"` 선언만.
- 위치: `netlify/functions/cron-task-risk.ts:143-145` — 파일 내부 `schedule: "30 21 * * *"` 선언만.
- netlify.toml에 `cron-agent-8`, `cron-task-risk` 블록 없음 (grep 결과 0건).
- 증상: 매일 KST 06:00 브리핑 생성 및 KST 06:30 리스크 알림이 실행 안 될 수 있음. CLAUDE.md §8 운영 중 등재된 기능이나 실제 cron이 침묵함.
- 기대 동작: netlify.toml에 이중 등록 필요. (`cron-agent-9`는 등록되어 있으나 `cron-agent-8`은 누락).

**[P1-3] 급여 계산: 분기 성과급이 같은 분기 안에서 매월 중복 합산될 위험**

- 위치: `lib/payroll-calc.ts:170-188`
- 증상: 분기 결산이 PAID 되면 `quarterTotalBonus / 3`이 해당 분기 3개월 각 급여에 모두 반영됨. 예를 들어 1분기 결산이 2월에 PAID, 1~3월 급여 자동 집계 시 1월·2월·3월 명세서 각각 `totalBonus/3` 포함. 하지만 2월(이미 DRAFT로 존재) 재집계 시 `force=false`면 `DRAFT` 상태는 덮어쓰여 `totalBonus/3` 다시 반영. 즉, PAID가 2월에 이루어지면 2월 명세서는 괜찮으나 1월(이미 DRAFT) 재집계 여부에 따라 1월에 성과급이 들어갈 수 있음. 단, 실제 매월 1일 cron은 직전 달만 집계하고 lockable 조건으로 보호되어 있어 REVIEWED+ 이상 슬립은 보존됨. 실제 위험: 직전 달 집계 시점(매월 1일)에 해당 분기가 이미 PAID인 경우, 분기 내 1~3월 3개 슬립 중 모두 `totalBonus/3` 반영 → 합계가 `totalBonus`(정확) — 의도한 동작이나, 만약 분기 경계가 맞지 않으면(예: 3월에 4분기 결산 PAID 처리) 분기 쿼리가 잘못된 quarter 값을 참조할 수 있음.
- 근거: `lib/payroll-calc.ts:95` `const q = quarterOfMonth(month)` — 현재 집계 월의 분기 계산. 1월 집계 시 q=1, 분기 1의 PAID 결산 총합 / 3 포함. 정상 케이스에서는 의도된 로직. 단, 분기 결산이 해당 분기 마감 전(예: 1분기인데 2월 PAID)되면 1월 집계에 반영됨.
- 기대 동작: 설계서에서 "분기 3개월 균등 안분"으로 명시적 설계이나, 실제 운영 전 비즈니스 담당자 확인 필요. P1으로 분류한 이유는 실수령액 오류로 이어질 수 있기 때문.

---

### P2

**[P2-1] workspace-calendar.js 내 mock 데이터 주석 "B 머지 전 사용" — 잔재**

- 위치: `public/js/workspace-calendar.js:15-28`
- 증상: `MOCK_EVENTS`, `MOCK_RSVPS`, `MOCK_GCAL_STATUS` 상수가 API 실패 폴백으로 남아있음. 코드는 try/catch로 API 먼저 호출하고 실패 시 mock으로 폴백하는 방어 패턴. API가 정상이면 mock은 노출되지 않으나, 주석 "B 머지 전"은 이미 B가 머지됐음에도 제거되지 않은 dead code에 해당.
- 기대 동작: B 머지 완료 후 mock 상수 및 관련 catch 블록 제거.

**[P2-2] workspace-kanban.js 내 mock 데이터 "B 머지 전" 잔재**

- 위치: `public/js/workspace-kanban.js:25-35`, `322`, `1180`
- 증상: `MOCK_AI_RESULT`(AI 검색 결과), `MOCK_PREFS`(사용자 설정) — 두 API(`/api/admin-workspace-task-search`, `/api/admin-user-preferences`) 모두 실존하므로 운영에서 mock은 미노출. 단, mock 데이터에 실제 회원명("박OO"), 내부 ID(42) 하드코딩.
- 기대 동작: 실제 API 확인 후 mock 상수 제거.

**[P2-3] payroll_slips schema 주석에서 PAID 상태 누락**

- 위치: `db/schema.ts:3832` — `// 상태·발송 (DRAFT|REVIEWED|APPROVED|SENT|HOLD)` 주석에 PAID 없음.
- 실제 코드(`admin-payroll.ts:292-308`)에서 PAID 상태 전환 로직 구현됨.
- 기대 동작: 주석에 `PAID` 추가하여 혼동 방지.

**[P2-4] admin-ai-agent.ts에서 adminId 추출 경로 비일관성**

- 위치: `netlify/functions/admin-ai-agent.ts:475` — `const adminId = (auth as any).ctx?.admin?.uid ?? null`
- `auth.ctx.admin`은 JWT 페이로드(AdminPayload), `auth.ctx.member`는 DB 행. `admin.uid`는 존재(lib/auth.ts:39 확인). 그러나 `cron-agent-8.ts`나 다른 AI 함수들은 `member.id`를 사용. 값은 동일하나 접근 경로가 불일치 — 유지보수 시 혼동 위험.
- 기대 동작: `auth.ctx.member.id` 통일 권장.

**[P2-5] att-leave-request.ts 반차 컬럼 동적 확인 — 매 요청마다 information_schema 조회**

- 위치: `netlify/functions/att-leave-request.ts:154-162` — 반차 신청 시 `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='att_leave_requests'...` 실행.
- 증상: 마이그레이션 미적용 환경을 위한 방어코드이나, 운영 환경에서는 마이그레이션이 완료된 상태. 매 휴가 신청마다 schema 조회 → 불필요한 DB I/O.
- 기대 동작: 마이그레이션 완료 확인 후 동적 조회 제거, 직접 INSERT 사용.

---

## 검수 못 한/불확실 영역

1. **근태 cron 3종(`cron-att-morning`, `cron-att-evening`, `cron-att-ai-daily`, `cron-att-leave-auto`)의 실제 실행 이력**: netlify.toml에 등록 확인됨(line 215-229)이나 실제 로그 미확인.
2. **payroll_settings 테이블 실 존재 여부**: `loadPayrollSettings`가 행 없으면 기본값 반환하므로 기능 자체는 동작하나, 운영 DB에 실제 설정 행이 없으면 기본값(소득세율 0% 등)으로 계산될 수 있음.
3. **att-checkin 위치 검증 우회 가능 여부**: REMOTE 모드 출근 시 위치 검증 미수행(의도적 설계)이나, 운영자가 workMode를 임의 변경하면 우회 가능한지 여부 — 관련 권한 체계 완전 추적 불완료.
4. **AI 에이전트 도구 실행 가드**: `checkToolAllowed`가 DB에서 `ai_tool_permissions`를 조회하는데, 해당 테이블이 실제로 시드 데이터로 채워져 있는지 미확인.
5. **milestone-settlement.ts 권한 문제**: `requireAdmin` 가드 통과 후 admin.id 기준으로 결산 조회/제출하는데, 이 함수는 워크스페이스 운영자(type='admin') 전용이 맞으나 super_admin도 본인 결산만 제출 가능한지, 대리 제출 방지가 충분한지 확인 필요.
