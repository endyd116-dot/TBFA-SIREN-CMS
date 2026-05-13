# Milestones Archive — SIREN 완료 Phase 설계서

> 22개 완료 Phase의 설계 결정·결과 압축 (2026-05-10 ~ 2026-05-12).
> 진행 중인 22-A (매출 관리) 와 22-C (지출 관리) 는 `docs/milestones/` 에 별도 유지.
> 원본 개별 파일은 git history에서 복구 가능 (각 파일 머지 hash 기재).

---

## 인덱스 표

| Phase | 영역 | 핵심 결정 | 주요 산출물 | 머지 hash | 비고 |
|----|----|----|----|----|----|
| #16 단계 B~D | 통합 회원·후원 시스템 | 단일 마스터 회원 + `donor_type` 컬럼 분류 + 효성 SOT 일방향 흐름 | `members.donor_type` 컬럼, `admin-donor-regular-list`, CSV 종합 검증, `cron-donor-status-sync` | `3ceea07` (Phase2 schema), `5451547` (마이그), `cce5e6a` (D1·D2) | admin·cms-tbfa 분리 + 데이터 연동 |
| Phase 5~7 | 재정 관리 | 수입 집계 + 사업별 예산 + 지출 승인 흐름 + 보고서 | `admin-finance-income/budget/report.html`, 백엔드 8개, 테이블 3종 (`budget_categories`/`budgets`/`expenditures`) | `b0a6279` 머지, `8023057` schema 활성화, `d4bf4c6` BUG-5 fix, `cbf40e6` BUG-6·7 fix | 회계연도 ISO date COALESCE 패턴 정착 |
| Phase 8 | 알림 채널 통합 인프라 | 이벤트 카탈로그 9종 + 4채널 어댑터 + 지수 백오프 3회 + dead-letter | `lib/notify-dispatcher.ts`, `notification_dispatch_logs`, 발송 로그 어드민 화면 | `5fd603a` (A 디스패처), `1b0a3e8` (B 7자리 통합), `0911515` (C 어드민) | 발신 지점은 채널 모름 — dispatch만 |
| Phase 9 | 외부 API 실연동 + 수신 설정 | **시나리오 B Aligo 통합** (SMS+알림톡 1계정) + 협회 대표번호 + 선결제 + 알림톡 2종(billing.failed/card.expiring) | `lib/aligo-client.ts`, `lib/aligo-kakao-client.ts`, `notification_preferences` 테이블, 마이페이지 수신 설정 UI | `c198112` (SMS), `45c9e20` (카카오), `1420dfb` (9-B 수신 설정), `7b94d98` (schema 활성화), `16e37b6` (Q7-Q8 검증) | placeholder fallback로 심사 통과 전 시뮬 |
| Phase 10 R1 | 발송 시스템 — 템플릿 빌더 | mustache `{{key}}` 치환 + 변수 정의·미리보기 + Aligo 알림톡 템플릿과 분리 | `communication_templates`, `lib/template-render.ts`, 7개 API + 시드 3종 | (R1 백·프론트 머지, Phase 10 묶음 안에 통합) | 채널 4종 enum (email/sms/kakao/inapp) |
| Phase 10 R2 | 발송 시스템 — 수신자 그룹 | 필터 동적/수동 명단 2가지 방식 + N+1 SELECT memberCount + 시드 5종 | `recipient_groups`, 8개 API (list/detail/create/update/delete/preview/members/migrate) | (R2 머지) `be83454` (donorType 검증 fix) | criteria JSONB 두 type — filter/manual |
| Phase 10 R3 | 발송 시스템 — 발송 큐 | 1분 cron + chunk 50건 + Phase 8 어댑터 직접 호출 + 예약·즉시 | `communication_send_jobs`, `communication_send_recipients`, `cron-communication-send-dispatcher`, 7 API | (R3 머지) | Background Function 안 씀 — 큰 발송 chunk 분할 |
| Phase 10 R4 | 발송 시스템 — 추적·AI 트리거·분석 | 6 영역 통합(추적·AI·트리거 화면·분석·재발송·이력) + open pixel·click redirect + 트리거 5종 시드(이탈/캠페인 부진/환영/기념일/생일) | `tracking_events`, `auto_triggers`, `auto_trigger_runs`, `send_recipients` 컬럼 5개, AI 트리거 cron | (R4 머지) | 큰 라운드 — A·B·C·D·E·F 6 영역 |
| Phase 13 | 신고 통계 대시보드 | 탭 전환 4(전체·사건·괴롭힘·법률) + 프리셋 4 + AI 심각도 도넛 + print PDF | `admin-incident-stats` 단일 API, schema 변경 0 | (Phase 13 머지) | 기존 3 테이블 집계만 |
| Phase 14 | 외부 기관 인계 | 기관별 양식 편집(`{{변수}}`) + PDF 자동 생성 + 회신 상태 수동 갱신 | `externalAgencies`, `referralLogs`, 기관 관리·인계 이력 2 메뉴 | `fb8d1e1` (schema 활성화·마이그 파일 삭제) | 기존 `pdf-receipt.ts`·`pdf-activity-report.ts` 패턴 재사용 |
| Phase 15 | 전문가 매칭 고도화 | **Gemini AI 적합도 점수(0~100)** + 사용자 별점 누적 → AI 추천에 반영 | `expertProfiles`, `matchingFeedbacks`, on-demand AI 호출 (캐시 X) | (Phase 15 머지) `8de5304` (Handoff C 검증 완료) | 어드민 수동 배정 유지 + AI 순위 표시 |
| Phase 16 | 통합 분석 대시보드 | 후원 KPI 우선 + 코호트 (신규→첫후원→정기→이탈) + 이탈 위험 패널 + 이사회용 분기·연간 탭 | `admin-dashboard-kpi/cohort/churn/board` 4개 API, 신규 테이블 0 | `aa8851f` (검증+BUG-16-01/02 fix), `58fe9cf` (100%) | Phase 4 보고서에 이사회 탭 추가 |
| Phase 17 | 보안·감사 강화 | JWT 2h + 비활성 30분 경고 + 마스킹(010-****-****, 주민 뒤 7자리) + 감사 로그 `session_id`/`risk_level` | `audit_logs` 컬럼 2개, `members.login_fail_streak`, `lib/masking.ts`, 3 API | `eccc45d` (V1+BUG3), `66f2b93` (V2+BUG2), `370c982` (공식 검증), `b5b7f96` (실 API) | 마스킹은 어드민 화면 표시만 |
| Phase 18 | 성능 최적화 | Netlify Blobs 캐싱 5~10분 TTL + admin-donations stats 6→1 쿼리 통합 + dashboard 7→1 CTE | `lib/cache.ts`, 3 API 수정 (donations/dashboard/source-kpi) | `b7434e8` (머지), `2accfc5` (캐싱+튜닝) | 프론트 변경 0 — 백 단독 |
| Phase 19 | 자동 테스트 보강(헬스체크) | Node.js .mjs 단일 스크립트 + 어드민 로그인 → 15개 API 체크 + 응답시간 3000ms | `scripts/healthcheck.mjs` | `43cd96f` (B 작성), `1eb623e` (머지), `0b0e767` (검증+BUG4 fix), `cca16c2` (머지) | 401 인증 전 + 200 인증 후 |
| Phase 20-A | 어드민 UI 완전 리뉴얼 (거부) | 9그룹 IA + 사이드바 호버 + Cmd+K + 즐겨찾기 + 모바일 320px+ | `admin_favorites`, `admin_recent_views`, 통합 API 4개 | `0e6ffcb` (백), `5c211ca` (프론트 mock), `126e2a2` (실 API), `47fb408` (검증+BUG3 fix), 이후 **거부됨** `f5b2782` (브랜치 3개 폐기) | 큰 UI 리뉴얼 사용자 거부 → 점진 패턴 교훈 |
| Phase 20-B | 어드민 UI 점진 (후원·재정·발송·AI) | 통합 API 4개 (donations/finance/send/ai-unified) + 권한별 분기 | `971e553` (백), `1694ca3` (프론트 mock), `64599ce` (실 API), `39bb5f9` (BUG-20B-01~06 fix) | 점진 적용 — 백 통합 + 프론트는 mock·실 분리 머지 |
| Phase 20-C | 어드민 UI 점진 (나머지·Cmd+K·즐겨찾기) | 유가족·콘텐츠·시스템 그룹 + Cmd+K 전역 검색 + 즐겨찾기 위젯 + 모바일 풀반응형 | `eee405b` (백 + 전역 검색), `4c27d56` (프론트), `6a918bc` (API 경로·필드명 fix), `4d9c21e` (admin-login 하드코딩 제거) | 모바일 3 breakpoint 일괄 점검 |
| Phase 21 R1 | 워크스페이스 v3 — WBS↔워크툴 연동 기반 | `activityLog` 카드 모달 타임라인 활성화 + BroadcastChannel + `#task=ID` hash | `admin-workspace-tasks` 단건 응답 확장 (schema 변경 0) | `b044382` (백), `db0a8c0` (프론트), `e0bc08c` (검증+BUG2 fix), `e714fd7` (머지) | 칸반→WBS 전역 리네이밍 |
| Phase 21 R2+R3 | 워크스페이스 v3 — 할당·이관·알림 + 서비스↔카드 동기화 + R&R 통합 | 4 신규 테이블 (transfers/watchers/serviceRnr) + members 부재 컬럼 + 4종 서비스 자동 카드 생성 hook + 알림 드롭다운 | `fdf2f09` (1차 schema), `66f0d5c` (2차 머지), `66f0d5c` (schema 활성화), `17eb7d4` (2차 백+크론), `b7b072a` (프론트 1차), `007ce58` (2차), `4ca61df` (검증+BUG1 fix), `cb68157` (머지) | **schema 격차 적응 보고** — `admin_users` 없어서 `members` 컬럼으로 정정 |
| Phase 21 R4 | 워크스페이스 v3 — 캘린더·메모·피드·템플릿·검색 마무리 | 메모 캘린더 미러링 + WBS 보기 모드 사용자별 + 업무 템플릿 10종 시드 + 자연어 검색(AI) + 활동 피드 그룹핑 | `workspaceMemos` 3 컬럼, `members.defaultWbsView`, `4e199b2` (백), `245cd95` (프론트), `355abeb` (schema 활성화), `545644d` (검증+BUG1 fix), `c1d8d16` (머지) | Phase 21 ✅ 100% 마감 `4f49031` |
| siren-admin-fixes | 싸이렌 어드민 4건 메인 단독 fix | 가입회원 멈춤·자격승인 첨부·외부기관·정적페이지 | (메인 단독, fix 4건) | Phase 21 직후 fix (소규모) | A·B·C 병렬 안 함 — 메인 단일 채팅 |

---

## 상세 — Phase별 설계 결정

### #16 단계 B~D — 통합 회원·후원 시스템

**목표**: cms-tbfa의 DEMO_MEMBERS 7명 더미 제거 → 실 회원 명단 + 후원 회원 분류 자동화.

**핵심 결정**:
- 통합 일반 회원은 마스터 풀 (싸이렌 가입·효성·수기), 후원 회원은 별도 테이블이 아닌 `members.donor_type` 컬럼으로 분류 (`regular`/`prospect`/`none`)
- 정기: 토스 빌링 진행 중 OR 효성 'active' / 잠재: 일시(`onetime`) 또는 정기 중단(`cancelled`)
- 토스는 즉시 반영(빌링키 등록·결제 성공 hook), 효성은 CSV 업로드 시 일괄 반영 + `cron-donor-status-sync` 안전망
- admin·cms-tbfa 화면은 분리 유지, 같은 DB로 데이터 연동

**§10 효성 CMS+ SOT 원칙 (2026-05-10 신설)**: 회원·정기 후원자 명단은 효성이 SOT, 토스 빌링은 SIREN 자체. **일방향 흐름** (효성 → SIREN). 효성 운영 컬럼은 매번 덮어쓰기 / SIREN 고유 컬럼(메모·태그·블랙리스트)은 보존 / 미매칭 회원번호는 자동 생성.

**산출물**: `donor_type`/`donor_channels`/`prospect_subtype`/`donor_evaluated_at` 4 컬럼, `admin-donor-regular-list`·`admin-donor-prospect-list`, CSV 종합 검증 대시보드, 효성 contracts/billings 파서, 자동 매핑 + 상태 전이 미리보기.

**교훈**: SOT 분리 원칙은 추후 모든 결제 채널(IBK·우리·카카오) 추가 시 동일 정책 적용. 자동 가입 매핑은 `signupSource='hyosung_csv'` 명시.

---

### Phase 5~7 — 재정 관리

**목표**: 수입 집계 + 사업별 예산 배분 + 지출 승인 흐름 + 재무 보고서 출력.

**핵심 결정**:
- 신규 테이블 3종: `budget_categories`(심리상담·법률·장학·운영비·홍보) / `budgets`(연도×카테고리 UNIQUE) / `expenditures`(draft→approved→rejected 승인 흐름)
- 수입 데이터는 기존 `donations`+`billing_logs` 집계 (신규 테이블 0)
- 지출 입력 모달: 영수증 R2 첨부 + 기안→슈퍼어드민 승인 + Resend 알림
- 보고서: 월간·분기·연간 + SheetJS 엑셀 + window.print 인쇄 (3 시트: 수입·지출·예산비교)

**산출물**: `admin-finance-income/budget/report.html` 3 페이지, 백엔드 API 8개 (budget-list/upsert·expenditure-list/create/approve 등), 마이그 후 활성화 패턴 적용.

**교훈**: 회계 연도 처리는 ISO date COALESCE 패턴 정착. BUG-5(감사 추적 컬럼 영구 NULL)·BUG-6(지출 목록 마비)·BUG-7(승인 멱등성 차단)은 schema 활성화 후 발견 → 라이브 검증 가치 입증.

---

### Phase 8 — 알림 채널 통합 인프라

**목표**: 인앱 단일 채널 → 다중 채널(인앱·이메일·SMS·알림톡) 확장 + 7개 미구현 자리 통합.

**핵심 결정 (Swain 합의 2026-05-10)**:
- 발신 지점은 채널 모름 — `dispatch({event, target, params})`만 던지면 정책 + 사용자 설정 따라 다중 채널 발송
- 이벤트 카탈로그 **9종 고정**: billing.success/failed/canceled, card.expiring, workspace.activity, admin.daily_briefing, support.reply, siren.assigned, member.eligibility_decided
- `billing.failed`·`card.expiring`은 **필수 채널 포함**(사용자 수신 설정 무시·강제 발송)
- 재시도 지수 백오프 3회 (1s → 5s → 25s) → dead-letter + 어드민 인앱 알림
- 테스트 모드: `NOTIFICATION_TEST_MODE=true` 시 콘솔 + DB 기록만

**산출물**: `notification_dispatch_logs` (12 컬럼·4 인덱스), `lib/notify-dispatcher.ts`, 4 채널 placeholder 어댑터, `cron-notification-retry` 1분 폴링, 발송 로그 어드민 화면 (Q24~Q27 라이브 통과).

**구현 분배**: A(디스패처 + 카탈로그 + 재시도 cron) / B(7개 미구현 자리 통합 — 워크스페이스·토스 빌링 3·카드 만료·일일 브리핑) / C(발송 로그 어드민 + 검증).

---

### Phase 9 — 외부 API 실연동 + 사용자 수신 설정

**시나리오 비교 (5종)**: SOLAPI / Aligo / NHN Cloud / BizM / 카카오비즈

**Swain 결정 (2026-05-10)**:
- **시나리오 B Aligo 통합** (SMS+알림톡 1계정·비용 우선)
- 협회 대표번호 그대로 사용
- 알림톡 템플릿 메인 위임 (메인 초안 → Swain 검토 → 심사 신청)
- **선결제** (NPO 비용 통제)

**알림톡 등록 범위**: 필수 채널 2종만 사전 등록 (`billing.failed`·`card.expiring`) — 카카오 심사 3~5영업일 + 광고성 알림 제약 회피.

**산출물**: `lib/aligo-client.ts` (SMS), `lib/aligo-kakao-client.ts` (알림톡), 어댑터 2개로 placeholder 교체, `notification_preferences` 테이블 + 마이페이지 수신 설정 UI + 어드민 전역 정책, 환경변수 7종 (API_KEY·USER_ID·SENDER·KAKAO_CHANNEL_ID·TEMPLATE 2종·TEST_MODE).

**교훈**: 템플릿 ID 미등록 시 placeholder fallback 동작 → 심사 통과 전 전체 흐름 검증 가능. Aligo SDK 단순함 → 자체 TypeScript 래퍼 1~2h 추가.

---

### Phase 10 R1 — 발송 시스템 템플릿 빌더

**목표**: 협회 자체 발송 템플릿 빌더 (변수 치환·미리보기) — Aligo 카카오 심사 통과 템플릿과는 별개 시스템.

**핵심 결정**:
- 채널 4종 enum (`email`/`sms`/`kakao`/`inapp`), 카테고리 5종 (`newsletter`/`announcement`/`auto_trigger`/`campaign`/`system`)
- mustache 스타일 `{{key}}` 치환, sample 또는 overrides 우선순위, HTML 이스케이프 X (이메일 raw 의도적)
- 본문에 정의 안 된 `{{key}}` 거부 (참조 검증 — 400)
- soft delete (`is_active=false`)
- 채널별 동적 UI: 이메일·인앱은 제목 노출, SMS는 글자수 카운터, 카카오는 "Aligo 별도" 안내

**산출물**: `communication_templates` 테이블 (10 컬럼·3 인덱스), `lib/template-render.ts` (3 함수: renderTemplate/extractVariableKeys/findUndefinedVariables), 7 API (list/detail/create/update/delete/preview/migrate), 시드 3종 (뉴스레터·공지·AI 트리거), 어드민 화면 2개 (목록·편집), 모드 **직렬** (B 머지 → A 시작).

---

### Phase 10 R2 — 수신자 그룹

**목표**: 발송 대상 회원 묶음을 재사용 가능한 그룹으로 정의·저장.

**핵심 결정**:
- 2 방식 — **필터 동적**(`type:filter`, logic and/or, filters 배열) + **수동 명단**(`type:manual`, memberIds 배열)
- criteria JSONB 단일 컬럼에 두 type 동거
- 시드 5종 (전체 활성·정기 후원자·일시 후원자 90일·등급 honor/lifetime·운영자 admin/staff)
- `memberCount`는 list 응답 시점 N+1 SELECT (작은 운영 규모이므로 허용)
- `sampleMembers` 5명 — 상세 응답에 포함

**산출물**: `recipient_groups` 테이블, 8 API (group preview + group members API 추가), 시드 5종, 어드민 화면 + 필터 조건 빌더 UI.

**fix 사례**: `be83454` (수신자그룹 donorType 검증 + 트리거 편집 + 시드 5+5+5).

---

### Phase 10 R3 — 발송 큐 (즉시 + 예약)

**목표**: R1 템플릿 + R2 그룹 결합 → 실 발송.

**핵심 결정**:
- 2 방식 — 즉시 발송(다음 cron tick), 예약(scheduledAt)
- **cron 1분 단위 + chunk 50건/회** — Background Function 안 씀 (15분 제한·실패 대응 어려움)
- Phase 8 어댑터 직접 호출 (Phase 8 이벤트 라우팅은 거치지 않음 — R3는 마케팅성 발송, 사용자 수신 설정은 별도 R3.5)
- 발송 시점 변수 치환된 본문 스냅샷(`rendered_subject`·`rendered_body`) — 감사·재시도 시 동일성 보장

**산출물**: `communication_send_jobs` (작업 메타) + `communication_send_recipients` (수신자 스냅샷·결과), 9 함수 (7 API + cron + 마이그), preflight API로 등록 전 미리보기 (N명·샘플 5·렌더링 1건), 진행률 폴링 API.

---

### Phase 10 R4 — 추적·AI 트리거·분석·재발송·이력 (큰 라운드)

**목표**: 카탈로그 R4(추적) + R5(AI 트리거) 통합. 운영자 편의 기능 추가.

**핵심 결정 (6 영역)**:
- **A 이메일 추적**: open pixel + link click redirect, `tracking_token` UNIQUE 컬럼 + `opened_at`/`first_clicked_at` 캐시
- **B AI 트리거**: 6 종류 (`churn_risk` 이탈 위험·`campaign_slump` 부진·`welcome` 가입 N일 후·`anniversary` 후원 N개월·`birthday` 생일·`custom_filter`) + 쿨다운 N일 + 시드 5종
- **C 트리거 관리 화면** (A 영역 머지 후)
- **D 발송 분석 대시보드** (A 영역 머지 후)
- **E 실패 수신자 재발송** (B+A)
- **F 발송 이력 통합 검색** (B+A, 회원별)

**산출물**: 3 신규 테이블 (`tracking_events`·`auto_triggers`·`auto_trigger_runs`) + `send_recipients` 5 컬럼 추가 + `send_jobs.triggered_by_auto_id` FK + AI 트리거 평가 cron + 6 화면 영역.

**교훈**: 큰 라운드 (B 12~14h / A 13~15h)로 메인 대기 시간 감축 (Swain 정책 2026-05-11).

---

### Phase 13 — 신고 통계 대시보드

**Swain 결정 (2026-05-11)**:
- 탭 전환 — 전체·사건·괴롭힘·법률 4
- 기간 프리셋 4 (이번달·지난달·올해·작년) + 직접 입력
- AI 심각도 도넛 차트 (높음·중간·낮음·미분석)
- print CSS 방식 PDF (`window.print`)
- 이메일 발송 제외 (Phase 16에서 처리)

**산출물**: `admin-incident-stats` 단일 API, schema 변경 0 (기존 3 테이블 집계). 사이드바 위치 — 🚨 사이렌 관리 그룹 아래 신규 메뉴 1개.

**주의**: `legalConsultations.aiUrgency` (다른 2종은 `aiSeverity`) — 필드명 차이.

---

### Phase 14 — 외부 기관 인계

**Swain 결정 (2026-05-11)**:
- 기관별 양식 편집 (어드민이 변수 포함 양식 틀 작성, 인계 시 사건 정보 자동 채움)
- 기관 회신 추적 — 어드민 수동 상태 갱신 (전화·이메일 회신 시)
- 인계 대상 — 사건·괴롭힘·법률 3종 모두
- `{{피해자명}}`·`{{신고번호}}`·`{{사건내용}}` 변수 → PDF 자동 채움
- 기존 `lib/pdf-receipt.ts`·`lib/pdf-activity-report.ts` 패턴 재사용 (pdf-lib + NotoSansKR 6MB)

**산출물**: `externalAgencies`(기관 마스터) + `referralLogs`(인계 이력, 멱등 추가 전용), 사이드바 사이렌 그룹 아래 신규 2 메뉴 (기관 관리·인계 이력), PDF 변수 치환 헬퍼.

**머지**: `fb8d1e1` (schema 활성화 + 마이그 파일 삭제).

---

### Phase 15 — 전문가 매칭 고도화

**Swain 결정 (2026-05-11)**:
- **Gemini AI 적합도 점수 0~100** + 코멘트 반환 (사건 내용 + 전문가 프로필 텍스트 전송)
- 사용자 별점 1~5점 + 한 줄 후기 → 다음 추천 점수 자동 반영
- 어드민 수동 배정 유지 + AI 추천 순위만 표시 (강제 자동화 아님)
- AI 호출 시점 — 어드민 배정 화면 열 때 on-demand (캐시 X)
- 별점 평균은 `expertProfiles.avgRating`·`ratingCount` 비정규화 (JOIN 없이 빠른 조회)

**산출물**: `expertProfiles`(전문 분야·언어·요일·시간대·지역·자기소개·별점), `matchingFeedbacks`(matchId UNIQUE — 매칭당 1회), AI 프롬프트 빌더, 어드민·마이페이지 UI.

---

### Phase 16 — 통합 분석 대시보드

**Swain 결정 (2026-05-11)**:
- **KPI 우선 — 후원 현황** (월간 수입·신규 후원자·정기 후원 유지율)
- 이사회 보고서 — 기존 Phase 4 보고서 화면에 분기·연간 탭 추가 (1안)
- 회원 라이프사이클 코호트 — 신규→첫후원→정기→이탈 전환율·평균 기간
- 이탈 위험 패널 — 기존 `churnRiskScore≥70` 활용 + 재참여 메시지 발송 버튼
- 발송 KPI — Phase 10 `communicationSendJobs` 활용

**산출물**: `admin-dashboard-kpi/cohort/churn/board` 4 API (신규 테이블 0). `aa8851f` 라이브 검증 PASS + BUG-16-01/02 fix. Phase 16 ✅ 100% (`58fe9cf`).

---

### Phase 17 — 보안·감사 강화

**Swain 결정 (2026-05-11)**:
- JWT 2h 유지 + 비활성 30분 시 경고 팝업 → 미응답 시 강제 로그아웃 (1안)
- 마스킹 — 어드민 화면 표시만 (1안). 전화번호 뒷 4자리 마스킹 (010-****-1234 → 010-****-****), 주민번호 뒤 7자리
- 권한 변경·블랙 처리·환불 승인 시 어드민 이메일 알림
- 감사 로그에 `session_id`·`risk_level` 추가
- `members.login_fail_streak` (연속 실패, 기존 `login_fail_count`는 누적)

**산출물**: `audit_logs` 컬럼 2개 + `members` 컬럼 1개, `lib/audit.ts` optional 파라미터 추가, `lib/masking.ts` 신규, 3 API (audit-list/stats/security-alert).

**머지·검증**: `eccc45d`(V1+BUG3 fix), `66f2b93`(V2+BUG2 fix), `370c982`(공식 검증), `b5b7f96`(실 API 머지). BUG-17-06은 Phase 21 전화번호 마스킹으로 이관.

---

### Phase 18 — 성능 최적화

**Swain 결정 (2026-05-11)**:
- 캐싱 — **Netlify Blobs** (TTL 수동, expires 필드)
- TTL — 통계/집계 10분 / KPI 대시보드 5분
- 무효화 — 데이터 변경 API 완료 시 선택적 삭제, TTL 만료는 자동 갱신
- 튜닝 대상 3개:
  - `admin-donations` stats 집계 6→1 쿼리 (CASE WHEN 통합)
  - `admin-donation-dashboard` 7→1 CTE 쿼리 + 캐싱 5분
  - `admin-members-source-kpi` 캐싱 10분

**산출물**: `lib/cache.ts` (getCache/setCache/deleteCache 3 export), 3 API 수정. 프론트 변경 0 — B 단독.

**머지**: `2accfc5` (캐싱+튜닝), `b7434e8` (머지). 응답 키 변경 없음 (`cached:true` 선택 추가).

---

### Phase 19 — 자동 테스트 보강 (헬스체크)

**Swain 결정 (2026-05-11)**:
- Node.js .mjs 단일 스크립트 (`scripts/healthcheck.mjs`) — 프레임워크 0
- 대상 라이브 URL (`https://tbfa-siren-cms.netlify.app`)
- 어드민 ID·PW 환경변수 (`HC_BASE_URL`·`HC_ADMIN_ID`·`HC_ADMIN_PW`) → 로그인 후 쿠키 추출
- 15 API 체크 — 인증 전 401 + 인증 후 200 + 응답시간 3000ms 기준
- 출력 — 터미널 컬러 표 + 실패 1건 시 `exit(1)` (CI 연동 대비)

**산출물**: `scripts/healthcheck.mjs` 단일 파일. CI에서 매 배포마다 실행 가능.

**머지·검증**: `43cd96f` (작성), `1eb623e` (머지), `0b0e767` (BUG4 fix — 스크립트 2 + 라이브 회귀 2), `cca16c2` (머지).

---

### Phase 20-A — 어드민 UI 완전 리뉴얼 (사용자 거부)

**Swain 결정 (2026-05-11)**:
- 3 단계 (20-A·B·C), 각 1.5주, 총 4.5주
- IA 9그룹 — 대시보드·회원·후원·사이렌·유가족·발송·콘텐츠·AI 에이전트·시스템
- 디자인 — 기존 미니멀 라이트 + CSS 변수 토큰만 정돈
- 사이드바 — 아이콘 고정 + 호버 시 라벨 펼침
- 반응형 — 모바일 320px+ 풀 반응형
- 부가 — Cmd+K + 즐겨찾기 + 최근 본 메뉴
- `admin-legacy.html` 백업 유지 (안전망)

**산출물**: `admin_favorites`·`admin_recent_views` 2 테이블, 통합 API 4개 (members/siren/donations/finance unified), CSS 토큰, mock→실 API 단계 머지.

**거부 사례 (2026-05-14)**: 20-A 완전 리뉴얼 거부 → 브랜치 3개 폐기 (`f5b2782`). 20-B·20-C는 점진 적용으로 살아남음 (`64599ce`·`4c27d56`·`6a918bc`). **교훈**: 큰 UI 리뉴얼은 사용자 거부 가능성 ↑ → 점진 패턴이 안전.

---

### Phase 20-B — 어드민 UI 점진 (후원·재정·발송·AI)

**산출물**: 통합 API 4개 (`admin-donations-unified`·`admin-finance-unified`·`admin-send-unified`·`admin-ai-unified`) + 권한별 응답 분기 (super_admin vs admin), 후원/재정/발송/AI 그룹 화면 (4탭·3탭·5메뉴·3메뉴).

**머지**: `971e553`(백) → `ffc3d13`(머지) → `1694ca3`(프론트 mock) → `f6cff33`(머지) → `64599ce`(실 API) → `2320611`(머지) → `39bb5f9`(검증+BUG-20B-01~06 fix) → `d7ef080`(머지).

---

### Phase 20-C — 어드민 UI 점진 (Cmd+K + 즐겨찾기 + 모바일)

**산출물**: `admin-global-search` 전역 검색 API (메뉴·회원·후원자·신고 동시) + 권한 분기, 유가족·콘텐츠·시스템 그룹 화면, Cmd+K 모달 (↑↓ Enter 네비), 즐겨찾기 위젯, 모바일 320/768/1024 일괄 점검.

**머지**: `eee405b`(백) → `730982c`(머지) → `4c27d56`(프론트) → `4a93c64`(머지) → `6a918bc`(API 경로·필드명 fix). `4d9c21e`(admin-login 하드코딩 ID·PW 제거 + 초기 접속 안내 삭제).

---

### Phase 21 R1 — 워크스페이스 v3 WBS↔워크툴 연동 기반

**핵심 결정 (Swain 2026-05-12)**: v2 코드 재활용 **금지** (보존만) — 처음부터 재설계. 통합 작업 모달로 모든 화면(워크툴·WBS·캘린더) 동일 카드 UX.

**작업 범위**:
- 카드 모달 타임라인 활성화 (`workspaceActivityLog` 미연결 → 연결)
- BroadcastChannel + 탭 복귀 시 refetch
- 워크툴 작업 클릭 → WBS 페이지 이동 + `#task=ID` hash 자동 모달 오픈
- 칸반→WBS 전역 리네이밍
- 사이드바 정리 (내작업/지시함/일정/메모 1뎁스 제거, 워크툴 메인에서만 접근)

**산출물**: `admin-workspace-tasks` 단건 응답에 `activityLog` 50건 포함. schema 변경 0.

**머지**: `b044382`(백) → `2e62ee3`(머지) → `db0a8c0`(프론트) → `88d9b38`(머지) → `e0bc08c`(검증+BUG-21R1-01/02 fix) → `e714fd7`(머지). Phase 21 R1 ✅ 100% (`e553f10`).

---

### Phase 21 R2+R3 — 할당·이관·알림 + 서비스↔카드 동기화 + R&R 통합

**Swain 지시 (2026-05-12)**: R2와 R3 영역 분리 명확 → 통합 라운드로 한 마이그·한 검증 사이클로 절약. 모드 **평행 + 단계 머지** (B는 schema → 마이그 → API 2단계로 안정성 확보).

**핵심 결정**:
- 서비스→카드 동기화 — **접수 즉시 자동 생성**
- 이관(토스) — **카드 자체 이동 + 이력 누적** (할당한 작업 탭 추적)
- R&R 매핑 — 1차 담당자 + 백업 (서비스 유형 × 카테고리)
- 부재 처리 — 1차 부재 → 백업 + 원래 담당자에 "복귀 후 확인" 메모
- 부재 토글 — 마이페이지 입력
- 워처(관찰자) — 본인만 자기 등록 가능

**산출물**: 4 신규 테이블 (`workspaceTaskTransfers`·`workspaceTaskWatchers`·`serviceRnr`·신규 알림 컬럼), `members` 부재 4 컬럼 + 작업 sourceServiceKind/Id 2 컬럼, 4종 서비스(incident/harassment/legal/support) `assignedTo`+`workspaceTaskId` FK, `incidentReports.category` varchar + 시드 4종, 알림 드롭다운 최근 10건 + 전체 보기, 마감 임박 cron 24h·72h, 토스 모달, R&R 탭, 미할당 풀.

**schema 격차 적응 사례**: 설계서 초안은 `admin_users`·`assigneeUid`·`linkUrl` 가정 → B가 schema 정독 후 **`admin_users` 없음 (members.role+operatorActive로 운영자 식별)** 적응 보고 → 메인 결정 폭증·머지 후 키 정정 코드 변경 폭증. **CLAUDE.md §9.1.9 사전 정독 의무화** 신설 계기.

**머지**: `fdf2f09`(1차 schema 적응) → `14aef0f`(머지) → `66d0fc5`(schema 활성화+마이그 삭제) → `17eb7d4`(2차 백+크론) → `007ce58`(머지) → `d33c9cd`(프론트 1차) → `b7b072a`(2차) → `4ca61df`(검증+BUG-21R2R3-01 fix) → `cb68157`(머지). R2+R3 ✅ 100% (`0ec11c9`).

---

### Phase 21 R4 — 캘린더·메모·피드·템플릿·검색 마무리

**핵심 결정**:
- 메모-캘린더 연동 — 메모 테이블에 `eventDate`/`eventTime`/`showInCalendar` 시간 필드 + 캘린더 통합 조회
- 사용자별 기본 보기 모드 — `members.defaultWbsView` (board/list/calendar)
- 캘린더 보강 — YIQ 컬러·빈 셀 3옵션·메모 미러링
- 자연어 검색 — 키워드 + AI 하이브리드
- 활동 피드 — 자연어 강화 + 시간 그룹핑 + 클릭 이동
- 업무 템플릿 10종 시드 (회원 가입 검증·후원자 응대·SIREN 1차 검토·법률 매칭·심리상담 매칭·행사 기획·자료집·카드 만료·CMS+ 이체·월간 보고서)

**산출물**: `workspaceMemos` 3 컬럼 + `members.defaultWbsView`, 캘린더·피드·검색 백·프론트, 템플릿 시드 10건. AI 검색 lib + 자연어 파서.

**머지**: `4e199b2`(백) → `9c4d7f3`(머지) → `245cd95`(프론트) → `acc656d`(머지) → `355abeb`(schema 활성화) → `545644d`(검증+BUG-21R4-01 fix — 활동 피드 클릭 이동) → `c1d8d16`(머지). **Phase 21 ✅ 100% 마감** (`4f49031`).

---

### siren-admin-fixes — 메인 단독 4건 fix

**작업 모드**: 메인 단독 (A·B·C 병렬 X). Phase 21 마감 직후 1~3h.

**4건**:
1. **Bug-A1**: 가입 회원 관리 "불러오는 중..." 멈춤 → `admin-members.ts` SOURCE_ENUM_TO_CODE `siren` 매핑 누락 또는 `signup_sources` 시드 누락 → 코드 매핑 보정 + 빈 배열 UI 안내
2. **Bug-A2**: 회원 자격 승인 증빙 파일 첨부 → DB·API는 있음 (`evidenceBlobId`), `admin-eligibility.js renderRow()`에 증빙 칸 추가
3. **Bug-A3**: 외부 기관 관리 메뉴 클릭 무반응 → Phase 14 라우팅 미연결 → 사이드바 라우터 추가
4. **Bug-A4**: 메인 화면 편집 정적 페이지 저장 안 됨 → 진단 후 fix

---

## 카테고리별 설계 패턴 (학습 자료)

### 1. 발송 시스템 (Phase 10 R1~R4)

**4 라운드 분할 패턴**: 큰 영역을 의존 흐름 순으로 분할.
- R1 템플릿 빌더 (백 4~6h / 프론트 4~5h / 직렬 모드)
- R2 수신자 그룹 (백 5~7h / 프론트 5~6h / 평행 모드)
- R3 발송 큐 (백 7~9h / 프론트 6~7h / 평행) — R1·R2 결합
- R4 추적·AI·분석·재발송·이력 마무리 (큰 라운드 B 12~14h / A 13~15h)

**핵심 패턴**:
- **본문 스냅샷 정책**: 발송 시점 변수 치환된 본문(`rendered_subject`·`rendered_body`)을 수신자 테이블에 저장 → 재시도·감사 시 동일성 보장 + 원본 템플릿 수정에 무관
- **chunk 분할 cron**: Background Function 안 씀 (15분 제한·실패 대응). 1분 cron + chunk 50건 → 중간 chunk 실패 시 다음 tick이 이어받음
- **Phase 8 어댑터 직접 호출**: R3는 마케팅성 발송이라 Phase 8 이벤트 라우팅(사용자 수신 설정 정책) 우회. 강제 발송 시나리오와 분리
- **Aligo 알림톡 ↔ 자체 템플릿 분리**: Aligo 외부 심사 ID는 환경변수, 자체 템플릿은 DB. 두 시스템을 R3에서 매핑
- **AI 트리거 쿨다운**: 같은 회원에 N일 내 재발송 금지 (`auto_trigger_runs`로 추적). 5종 시드(이탈·부진·환영·기념·생일)

---

### 2. 신고 시스템 (Phase 13·14·15)

**구조**: 통계 → 인계 → 매칭 고도화 순.

- **Phase 13 통계**: schema 변경 0 (기존 3 테이블 집계만). 필드명 차이 주의 (`aiSeverity` vs `aiUrgency`)
- **Phase 14 외부 기관 인계**: 기존 pdf-lib + NotoSansKR 패턴 재사용 + 변수 치환 양식 + `referralLogs` 멱등 추가 전용
- **Phase 15 매칭 고도화**: **Gemini AI 적합도 점수 + 사용자 별점 누적 반영**. 어드민 수동 배정 유지 + AI 순위만 표시 (강제 자동화 X). on-demand 호출 (캐시 X) — 매 요청 시 최신 별점 평균 반영

**공통 결정**: 사이렌 그룹 사이드바 신규 메뉴 추가. 신고 3종 (사건·괴롭힘·법률) 통합 처리.

---

### 3. 워크스페이스·관리 (Phase 16·21)

**Phase 16 통합 분석**: 후원 KPI 우선 + 코호트 + 이탈 위험 + Phase 4 보고서 이사회 탭 추가. 신규 테이블 0 (기존 집계만).

**Phase 21 워크스페이스 v3 (3 라운드 100% 마감)**:
- v2 코드 재활용 **금지** (롤백 사유 — 기능 따로 + 모달 호환 X)
- 통합 작업 모달 — 모든 화면 동일 카드 UX
- WBS↔워크툴 양방향 (BroadcastChannel + `#task=ID` hash)
- 서비스 4종 접수 즉시 자동 카드 생성 + R&R 1차+백업 + 부재 토글
- 카드 이관(토스) + 이력 누적 + 워처
- 캘린더 메모 미러링 + 사용자별 기본 보기

**큰 통합 결정**: Swain 지시로 R2+R3 통합 → 마이그·검증 1 사이클로 절약. 평행 + 단계 머지 (schema → API 2단계).

---

### 4. 보안·성능·테스트 (Phase 17·18·19)

**Phase 17 보안**: 마스킹은 어드민 화면 표시만(1안 — 보수적). JWT 2h + 비활성 30분 경고 → 강제 로그아웃. 감사 로그에 `session_id`·`risk_level` + `login_fail_streak` 연속 추적.

**Phase 18 성능**: Netlify Blobs 캐싱 (TTL 수동 — expires 필드). 통계 10분 / KPI 5분. **SQL 통합** — donations stats 6→1 CASE WHEN, dashboard 7→1 CTE. 응답 키 변경 0.

**Phase 19 헬스체크**: Node.js .mjs 단일 스크립트 + 라이브 URL + 어드민 로그인 → 15 API 체크. CI 연동 가능 `exit(1)`.

**패턴**: 백 단독 또는 스크립트 단독 라운드 (프론트 변경 0) → A 채팅은 다음 Phase 대기.

---

### 5. 어드민 UI 리뉴얼 (Phase 20-A·B·C)

**3 단계 분할**:
- 20-A 기반 시스템 + 회원·사이렌 (1.5주)
- 20-B 후원·재정·발송·AI (1.5주)
- 20-C 나머지 + 모바일 + Cmd+K + 즐겨찾기 (1.5주)

**표준 패턴 (각 단계)**: B·A 동시 mock 시작 → B 머지 → A 실 API → C 검증.

**핵심 결정**:
- 9그룹 IA (대시보드·회원·후원·사이렌·유가족·발송·콘텐츠·AI·시스템)
- `admin-legacy.html` 백업 유지 (안전망)
- URL hash 호환성 — 기존 hash 자동 매핑, 미처리 hash는 admin-legacy.html 폴백
- 통합 API 패턴 — 각 그룹 한 번에 (`-unified.ts` 4~6개)
- 권한 분기 — super_admin / admin 응답 차이

**거부 사례 (큰 교훈)**: 20-A 완전 리뉴얼은 사용자 거부 → 브랜치 3개 폐기. 20-B·20-C 점진 적용은 살아남음. **교훈**: 큰 UI 리뉴얼은 사용자 거부 가능성 ↑. **점진 패턴이 안전** — 새 그룹씩 통합 API + 권한 분기 + 모바일 점검 단계별 적용.

---

### 6. 단일 fix 묶음 (Phase 12·siren-admin-fixes)

**메인 단독 작업 패턴**: A·B·C 병렬 X, 단일 채팅에서 정독·진단·fix·검증 모두 수행. 1~3h 짧은 라운드 (4건 작은 fix·schema 변경 0).

**예시 — siren-admin-fixes 4건**: 가입회원 멈춤(enum 매핑) / 자격승인 증빙 첨부 UI / 외부기관 메뉴 라우팅 / 정적페이지 저장. Phase 21 마감 직후 별도 작업으로 흡수.

**적용 기준**: 비즈니스 로직 변경 0 + schema 변경 0 + 영역 좁음 + A·B·C 병렬 가치 낮음 → 메인 단독.

---

## 운영 메타 패턴 (공통 학습)

### A. schema.ts append-only 원칙

병렬 작업 핵심: 본인 섹션 파일 끝에 `/* === 작업 X === */` 헤더 후 추가. 다른 작업 영역 덮어쓰기 금지. 2026-05-09 사고 사례(작업 C가 작업 A의 eligibilityType 정의 삭제) 이후 정착.

### B. 마이그 호출 흐름 (어드민 GET ?run=1)

1. AI가 schema 정의 추가 (주석 상태) → 마이그 함수 작성 → push
2. Swain이 admin 로그인 → 주소창에 `/api/migrate-xxx?run=1` 직접 입력
3. 응답 success 확인 → AI에게 알림
4. AI가 schema 정의 활성화 (주석 해제) + 마이그 파일 삭제 → push

### C. Phase별 평행 모드 분류

| 패턴 | 적용 Phase |
|---|---|
| 직렬 (B 머지 → A 시작) | 10 R1 (작은 라운드 + 화면이 API 응답에 직결) |
| 평행 | 5~7·8·9·10 R2·R3·R4·13·14·15·16·20-A·B·C·21 R1·R4 |
| 평행 + 단계 머지 (B schema → 마이그 → API 2단계) | 21 R2+R3 (큰 통합 + schema 안정성) |
| 백 단독 (프론트 변경 0) | 18 (성능 캐싱·튜닝), 19 (헬스체크 스크립트) |
| 메인 단독 | siren-admin-fixes, 12 (단일 fix) |

### D. 사전 정독 의무화 (CLAUDE.md §9.1.9 정착 계기)

**사고 패턴 (2026-05-12 R2+R3)**: 메인이 `adminUsers`/`assigneeUid`/`linkUrl` 일반 가정으로 설계 → B가 schema 정독 후 적응 보고 → 메인 결정 폭증 + 머지 후 키 정정 코드 변경 폭증.

**정착 규칙**: 새 라운드 설계서 작성 전 ① `db/schema.ts` 영향 테이블 정독 + 명명 후보 키 grep ② `lib/auth.ts`·`lib/admin-guard.ts`로 사용자/관리자 모델 확정 ③ 영향 받는 4종 서비스 API 본문 단편 정독 ④ `drizzle/` 폴더 ls로 컬럼 진화 추적 ⑤ `docs/issues/` 최근 3건 정독.

---

## 가장 가치 큰 교훈

**큰 UI 리뉴얼은 사용자 거부 가능성 ↑ — 점진 패턴이 안전 (Phase 20-A·B·C)**: 9그룹 IA + 통합 API + 모바일 풀반응형까지 완성한 20-A는 머지 후 거부 → 브랜치 3개 폐기. 20-B(후원·재정·발송·AI)·20-C(Cmd+K·즐겨찾기·시스템)는 동일 표준 패턴이지만 한 그룹씩 단계 적용해서 살아남음. **결론**: 비즈니스 결정자(Swain)는 자기 운영 화면이 한 번에 통째로 바뀌면 위험 인식 ↑. 단계별 적용 + 백업(admin-legacy.html) + URL hash 호환성 + super_admin 권한 분기 보존이 점진 패턴의 안전망.
