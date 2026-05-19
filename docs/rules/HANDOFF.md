# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v20.md`](handover/v20.md) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-18 / **AI 에이전트 대폭 확장 + 라운드 7 설계 완료** / main @ `0a31dc7`

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa.co.kr> (공식 메인) / <https://tbfa-siren-cms.netlify.app> (Netlify 기본)
- 베이스 브랜치: `main`
- 상세 스택·환경·구조: [`CLAUDE.md`](../CLAUDE.md) §1~5

운영 완성도 (2026-05-16 기준):
- 🟢 교유협 자체 운영: **약 95%** (실제 운영 단계)
- 🟡 외부 판매(이전·라이선싱): 약 75%
- 🟠 SaaS화: 약 50%
- 🔵 콘텐츠·커뮤니티 플랫폼 동급: 약 80%

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독
2) PROJECT_STATE.md §2·§3·§5·§7 정독
3) docs/REMAINING_WORK.md §8 (잔여 작업 인벤토리) 정독 — 라운드 계획 핵심
4) memory/MEMORY.md 인덱스 + feedback_* 메모리 본문 정독
5) 본 §4 (다음 메인이 할 일) 확인
6) Swain과 라운드 시작 확인 → §4 라운드 1부터 진행
```

---

## 3. 2026-05-18 완료한 일 (AI 에이전트 확장 세션)

### 3.0 AI 에이전트 도구 대폭 확장 (main @ `0a31dc7`)

이번 세션에서 AI 비서 채팅 기능을 대폭 강화했습니다.

| 커밋 | 내용 |
|---|---|
| `11029a5` | email_send — 파일함 파일 첨부 + 외부 이메일 주소(toEmails) 지원 |
| `2f47e2d` | email_send — wrapWithLayout + layout 파라미터 (4종 템플릿 선택) |
| `ff42309` | lib/email.ts — 이메일 레이아웃 3종 신규 (minimal·gradient·editorial) |
| `79bd855` | 이메일 템플릿 CRUD 4개 도구 추가 (AI가 템플릿 생성·수정·삭제 가능) |
| `0a31dc7` | 읽기 전용 9개 → CRUD 전환 (수신자 그룹·채팅방·후원 정책·법률/악성민원 답변) |

**현재 AI 에이전트 도구 총 116개** (기존 107개 + 9개 추가)

**라운드 7 설계 완료**: AI 구조 4개 레이어 확장 설계서 → `docs/milestones/2026-05-18-round7-ai-layers.md`

---

### 3.1 이전 완료 — 영업 자료 목업 HTML

### 3.0-prev 영업 자료 — 함께워크_SI NPO 제안서 목업 HTML

이번 세션은 **SIREN 플랫폼 개발 아님** — Swain의 외부 영업(함께워크_SI 브랜드) 슬라이드 제작 지원 세션.

**생성된 파일**: [`public/siren-mockup-slides.html`](../public/siren-mockup-slides.html)

| 화면 | 내용 | 슬라이드 용도 |
|---|---|---|
| 01 대시보드 | KPI 4개 + 월별 후원 차트 + 최근 회원 + SIREN 긴급 알림 | 레퍼런스 페이지 |
| 02 핵심기능 6가지 | 다크 배경 6카드 (후원·회원·유족지원·신고·워크스페이스·AI) | 기능 소개 페이지 |
| 03 AI 에이전트 채팅 | 워크스페이스 + 채팅 패널 (승인 전 미리보기 플로우) | AI 에이전트 페이지 |
| 04 SIREN 신고 관리 | 신고 목록 테이블 + AI 리스크 분석 통계 | 레퍼런스 보조 |
| 05 AI 일일 브리핑 | 매일 06:30 자동 생성 브리핑 — 요약·KPI·우선순위·트렌드 | AI 기능 증빙 |
| 06 AI 칸반 리스크 점수 | 카드별 AI 위험도 점수(0~100) + 100자 AI 요약 + 완료 보고서 | AI 기능 증빙 |
| 07 AI 지출 자동 분류 | 통장 거래내역 업로드 → AI 자동 분류 90% + 도넛 차트 | AI 기능 증빙 |

**이미지 저장 기능**: 상단 "📸 이미지 저장" / "💾 전체 저장(7장)" 버튼 추가 (html2canvas CDN 사용)

**⚠ 미완료 — 다음 메인이 처리 가능**: html2canvas를 CDN으로 불러오기 때문에 `file://` 더블클릭으로 열면 이미지 저장 버튼이 작동 안 함. 해결책 두 가지 중 Swain 선택 대기:
- **A안**: html2canvas 코드를 파일 안에 직접 내장 → 더블클릭으로 바로 작동 (파일 크기 +300KB)
- **B안**: `npm run dev` 켜고 `localhost:8888/siren-mockup-slides.html` 로 접속

**함께워크_SI 영업 전략 컨텍스트** (코드 없음, 대화 내용):
- NPO 패키지 제안서 14슬라이드 텍스트 초안 작성 (Swain이 PPT로 완성: `함께워크_SI_NPO_패키지_제안서_V1.0.pdf`)
- AI 에이전트 도구 수 검증: 실제 103개(53개 실행형 + 50개 읽기전용) 코드 확인 완료
- 온·오프라인 영업 전략 종합 수립 (크몽·위시켓 등록 + 6대 교원단체 미팅 전략)
- Swain 스토리텔링 스크립트 (교사유가족협의회 활동 → IT 비전 → 함께워크 탄생) 작성

---

## 이전 완료 (2026-05-17) — 라운드 1~6 전체 완결

### 3.1 라운드 1 SIREN 4건 fix (✅ 전체 완결)

| fix | 내용 | 커밋 |
|---|---|---|
| 빌링키 자동 비활성화 | 회원 탈퇴 시 billing_keys.is_active=false 자동 처리 | `410679d` |
| 신고 responded 상태 | 3종 신고(사건·괴롭힘·법률) 답변 등록 시 status 자동 전환 | `410679d` |
| 자격 강제 변경 | 어드민 회원 상세에 "자격 직접 변경" + expert 분기 처리 | `5dddc92` |
| 익명 신고 실명 표시 | 어드민 목록·상세 6곳 hardcoding 제거, memberName 우선 표시 | `cf0ecf1` |
| C 검증 | Q1~Q12 12건 전부 통과, BUG-Q10 발견·즉시 fix | `0320fa2` |

→ 검증 보고서: `docs/verify/2026-05-17-round1-siren.md` (C 작성)

### 3.1 라운드 2 워크스페이스 8건 + 구글 캘린더 (✅ 전체 완결)

- 3개 테이블 신설: workspace_task_mentions·workspace_event_rsvps·google_calendar_tokens
- 마이그레이션 호출 완료, B 9건·A 4건 머지 완료
- C 검증 Q1~Q12 통과 (BUG-Q4 멘션 INSERT·BUG-Q6 workspaceId fix 포함)
→ 검증 보고서: `docs/verify/2026-05-17-round2-workspace.md`

### 3.2 라운드 3 통합 CMS 6건 (✅ 전체 완결)

- donations.paidAt 신설 마이그 + 백필 완료
- 자동 발송 cooldown 중복 차단·환불 권한 통일·빌링키 재활성화 API·채널 검증
- B 5건·A 1건 머지 완료
- C 검증 Q1~Q9 전부 통과 (BUG 0)
→ 검증 보고서: `docs/verify/2026-05-17-round3-cms.md`

### 3.3 라운드 4 3단 권한 체계 (✅ 전체 완결)

- lib/admin-role.ts 신설, DB 마이그 완료 (operator→admin 1명)
- 로그인 role 하드코딩 제거, requireRole 헬퍼 7개 파일 통일
- admin 등급 체크 4개 파일 추가 (블랙·자격·빌링키·환불)
- admin-role-policy.html 신규 + iframe 4곳 등록
- C 검증 Q1~Q8 전부 통과 (BUG 0)
→ 검증 보고서: `docs/verify/2026-05-17-round4-rbac.md`

### 3.4 라운드 5 발송 센터 UX (✅ 전체 완결)

- 채널별 미리보기 탭 (이메일·SMS·카카오·인앱) + 파일함 재사용 첨부
- C 검증 Q1~Q10 전부 통과 (BUG 0) → `7a2f557`
→ 검증 보고서: `docs/verify/2026-05-17-round5-send-ux.md`

### 3.5 라운드 6 게이미피케이션 + 큐레이션·팝업 (✅ 전체 완결)

- DB 8테이블 신설: pointRules·memberPointLogs·badgeDefinitions·memberBadges·rewards·rewardRedemptions·sitePopups·siteCurations
- lib/badge-checker.ts 신설 (후원 횟수·포인트 잔액 기준 자동 뱃지 부여)
- B API 18개: 사용자 5(포인트·뱃지·랭킹·리워드) + 어드민 9 + 공개 4(팝업·큐레이션)
- 이벤트 후킹 3곳: 토스·효성 후원 완료 + 일일 로그인 (fire-and-forget)
- A 페이지 5개: mypage-points·ranking·admin-gamification·admin-popups·admin-curations + site-popup.js + iframe 12곳
- C 검증 Q1~Q15 전부 통과 (BUG 0) → `a474978`
→ 검증 보고서: `docs/verify/2026-05-17-round6-gamification.md`

---

## 이전 완료 (2026-05-16, 약 40 커밋)

박새로이 카톡 중복 발송 사고가 발단이 되어 운영 안정성·사용자 경험·인프라·외부 판매 준비까지 모두 한 단계 끌어올린 큰 사이클.

### 3.1 사고 대응 & AI
- `07f8479` AI 메일 발송 인자 정규화 + 오류 사유 화면 노출
- `4787548` cron-billing scheduled+retry 중복 청구 dedup (박새로이 카톡 2번 사고)
- `d400f61` C 검증 fix — donations_stats enum + email_send SQL 배열 직렬화
- `ab7e916` Netlify 빌드 단축 (aws-sdk·pdf-lib·resend external)

### 3.2 자동 발송 통합 CMS (B안 — 5단계)
- `1de15c2` D1 마이그 — notification_admin_settings 컬럼 7개 + 9개 이벤트 + 카카오 본문 2건
- `5ccbe95` D2 schema 활성화 + loadEventTemplate 헬퍼
- `cb0bd9a` D3 어댑터 4종 (DB 본문 우선 + 토글 + 폴백)
- `c33f4da` D4 어드민 UI (admin-system-notification.html) — 카드 그리드 + 4탭 편집 모달
- `510e531` D5 사이드바 메뉴 등록
- `45de698` 흰 화면 fix (iframe 라우팅 4곳 등록 누락 — 메모리화)
- `7e9ae4e` 코드 기본값 미리보기 표시
- `34eac6d` 강제 채널 박스 조건부 표시 (forcedChannels 비어있으면 숨김)

→ 운영자가 어드민에서 9개 시스템 이벤트의 본문·채널 토글·강제 채널 모두 편집 가능.

### 3.3 효성 후원자 가입 흐름 (A안 — 5단계 + C 검증 3라운드)
- `9f4bf9a` D1 phone_verifications 테이블 마이그
- `1d3285c` D2 schema 활성화 + 인증 헬퍼·API 2개 (phone-verify-send/check)
- `0724fa7` D3 auth-signup.ts 분기 (verifyToken → 기존 row UPDATE)
- `6343274` D4 가입 모달 UI + auth.js 핸들러
- `a563aed` D5 만료 row cleanup cron
- C 검증 1·2·3차 통과 (BUG-1·2·3 모두 해소):
  - `061af1c` C BUG-2 fix (SMS 실패 시 INSERT 롤백)
  - `846f567` SMS Oracle 프록시 (BUG-1 메인 해결)
  - `4783ed3` C timeout fix (10초 AbortController)
  - `f1c04fe` MMS 프록시 라우트 + signup 핸들러 partials:loaded 바인딩
  - `52b94b2`·`73d3d7f` 검증 보고서 archive

→ 효성·기업은행 등 외부 연동 후원자가 사이트 회원으로 전환 가능 (전화 인증 → 기존 row 활성화).

### 3.4 응답폼·신청폼 빌더 (5단계)
- `4b6a33a` D1 마이그 — forms·formFields·formSubmissions 3 테이블
- `bd33139` D2 공개 API 2개 (form.ts·form-submit.ts) + 공개 페이지 form.html
- `865113d` D3+D4+D5 어드민 빌더·응답 조회·CSV·사이드바 메뉴

→ 운영자가 행사 신청·설문·이벤트 폼 코드 없이 만들고 응답 수집·CSV 다운.

### 3.5 미디어 처리 + 메일 첨부 + 인프라
- `5ce3f11`·`dd11663` 카카오·MMS 이미지 자동 압축 (sharp + JPEG quality·resize 단계적)
- `0293f18` 메일 웹 감싸기 + 이메일 첨부파일 (R2 → base64 → Resend attachments)
- SMS·MMS Oracle 프록시 인프라 신규 구축 (server.js에 /aligo/sms·/aligo/mms 라우트 + ALIGO_SMS_PROXY_URL Netlify env)

### 3.6 외부 판매 준비
- `bb60b59`·`30a69c5`·`8a180ae` 잔여 작업 §8에 SaaS·외부 판매 약점 4개 + 효성 가입 + 파일함 통합 등록
- 35개 모듈 카탈로그 영업 자료 토대 정리

### 3.7 전 영역 정독·진단 (오늘 마지막)
- SIREN·워크스페이스·통합 CMS 3개 영역 정독으로 19건(Critical 9 + Important 10) 발견
- 영역별 라운드 계획 수립 (다음 §4 참조)

---

## 4. 다음 메인이 할 일 — 영역별 라운드 계획

### 4.1 라운드 1 — SIREN 영역 ✅ 완결 (2026-05-17)

| # | 우선 | 이슈 | 수정안 |
|---|---|---|---|
| 1 | 🔴 | 회원 탈퇴 시 빌링키 자동 비활성화 | `auth-withdraw.ts`에 `billingKeys.isActive=false` UPDATE 추가 |
| 2 | 🔴 | 신고 status `responded` 미구현 정리 | A) `responded` 제거 단순화 / B) 명시적 endpoint 신설 — Swain 선택 |
| 3 | 🟡 | 자격 변경 되돌리기 (어드민 강제 변경) | `admin-eligibility-force-change` endpoint 신설 |
| 4 | 🟡 | 익명 신고 보고자 정보 일관성 | 어드민 UI에 "등록 회원명(익명 시 마스킹)" 표시 |

### 4.2 라운드 2 — 워크스페이스 영역 ✅ 완결 (2026-05-17)

| # | 우선 | 이슈 | 수정안 |
|---|---|---|---|
| 1 | 🔴 | 작업 소유자(`memberId`) 변경 금지 | `assign` 시 `assignedTo`만 변경, `memberId` 고정 |
| 2 | 🔴 | 멘션 조회·읽음 추적 | `workspace_task_mentions` 테이블 신설 |
| 3 | 🔴 | 파일 삭제 시 `blob_uploads` orphan 정리 | 휴지통 cron에 SQL 추가 |
| 4 | 🔴 | 완료 되돌리기 시 `completedAt` clear | done→todo 시 `completedAt=null`·`completedBy=null` 강제 |
| 5 | 🟡 | 이벤트 RSVP 히스토리 | `workspace_event_rsvps` 테이블 신설 |
| 6 | 🟡 | 마감 알림 타임존·휴일 | `reminderConfig.timezone` + 한국 공휴일 캘린더 |
| 7 | 🟡 | 다른 운영자 task 조회 권한 모호 | `assignedByMe` 기본 ON + 권한 정책 명시 |
| 8 | 🟡 | 휴지통 복원 불가 | "휴지통" UI + `restore` action |
| 9 | 🆕 | **구글 캘린더 API 연동** (Swain 2026-05-16 추가 요청) | OAuth2 + 워크스페이스 이벤트 양방향 동기. 추정 5~7일 별도 라운드 |

→ 9번은 큰 모듈이라 워크스페이스 라운드 2 후 별도 라운드 검토 (또는 라운드 2.5).

### 4.3 라운드 3 — 통합 CMS 영역 (Critical 3 + Important 4 = 7건, 3~5일)

| # | 우선 | 이슈 | 수정안 |
|---|---|---|---|
| 1 | 🔴 | **환불 권한 통일 — `admin` 통합** (Swain 정책 결정) | 후원 환불·지출 환불 모두 `admin` 권한으로 통일 (super_admin 아님) |
| 2 | 🔴 | 자동 발송 중복 차단 | 실 발송 시점에 `cooldown_days` + `trigger_runs` 이력 검사 + `triggered_by` 추적 |
| 3 | 🔴 | 재정 기준일 통일 (`paidAt` 단일) | 모든 재정 리포트 `paidAt` 단일 기준 + 환불 시 예산·잔액 자동 갱신 |
| 4 | 🟡 | admin 권한 경계 모호 | 모든 어드민 함수에 role 검증 추가 (라운드 4와 통합 검토) |
| 5 | 🟡 | 블랙·자격·해지 되돌리기 | 각각 unblacklist·자격 복원·빌링키 재활성화 API 추가 (사유 기록 필수) |
| 6 | 🟡 | 발송 채널·템플릿 호환성 검증 | template.channel과 request.channels 호환성 검증 + 경고 |
| 7 | 🟡 | 후원·캠페인·응답폼 폼 경계 문서화 | CLAUDE.md에 각 폼 용도 명시 |

### 4.4 라운드 4 — 권한 체계 신설 (Swain 2026-05-16 추가 요청, 4~6일)

**3단 권한 체계 신설**: `super_admin` / `admin` / `operator`

| 작업 | 내용 |
|---|---|
| schema | `members.role` enum 3단 명확화 (기존 super_admin·admin만 → operator 추가 또는 정리) |
| 모든 어드민 함수 | 3단 권한 검증 일관 적용 — 라운드 3 #4와 통합 |
| **R&R 정책 문서** | `docs/policies/roles-and-permissions.md` 신설 — 각 권한이 무엇을 할 수 있는지 매트릭스 |
| **싸이렌·효성 CMS 통합 권한 정책 관리** | 어드민 화면에 "권한 정책 관리" 페이지 신설 — 운영자가 권한 매트릭스 조회·일부 수정 가능 |
| 감사 로그 | 권한 변경·정책 변경도 감사 로그에 기록 |

### 4.5 라운드 5 — 잔여 §8 점진 진행

순서대로:
1. 🔵 새 발송 — 채널별 미리보기 분리 (1~2일)
2. ★★ 게이미피케이션 (포인트·뱃지 중 1개부터, 5~7일/항목)
3. ★ 큐레이션·팝업 (3~4일)
4. 옵션 대관·예약 (4~5일)
5. 🟣 파일 첨부 — 워크스페이스 파일함 재사용 통합 (3~4일, 최후)

---

## 5. 라운드 진행 원칙

1. **라운드 1 SIREN부터 시작** — 가장 작고 사용자 영향 큼
2. **운영 결정 자동 안내** — 데이터 정리·정책 결정 필요한 부분은 어드민 팝업·통지로 안내, Swain이 별도 처리
3. **각 fix push 후 사용자 검증** — 다음 항목 진행 전 작동 확인
4. **컨텍스트 80% 도달 시 새 채팅 전환** — 라운드 단위로 나누는 것이 자연스러움
5. **메모리·CLAUDE.md 자동 로드** — feedback_* 메모리 본문 정독 의무 (특히 design_routine·iframe_page_routing)

---

## 6. 관련 문서

- [CLAUDE.md](../CLAUDE.md) — 코딩 컨벤션·자율성 원칙·체크리스트
- [PROJECT_STATE.md](../PROJECT_STATE.md) — 휘발성 상태 (진행률·worktree·이슈)
- [docs/REMAINING_WORK.md](REMAINING_WORK.md) — 잔여 작업 §8 인벤토리 (라운드 계획 단일 출처)
- [docs/verify-archive.md](verify-archive.md) — 검증 보고 archive (2026-05-16 A안 3라운드 통과 포함)
- [docs/PAGES.md](PAGES.md) — 페이지 진입점 카탈로그
- [memory/MEMORY.md](../../../../.claude/projects/c--Users-Administrator-Desktop----dev-tbfa-mis/memory/MEMORY.md) — 인덱스
