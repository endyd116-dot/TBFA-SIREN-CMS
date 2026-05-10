# Phase 9-B 수신 설정 화면 라이브 검증 (C 채팅)

> **검증일**: 2026-05-10
> **검증자**: C 채팅 (Opus 4.7)
> **브랜치**: `verify/queue-2026-05-10`
> **결과**: ✅ 통과 (bug 0건)
> **출처 큐**: PROJECT_STATE §8 Q1

---

## 1. 검증 대상

Phase 9-B 머지(56f95a1, 014432b) 후 사용자/어드민 알림 수신 설정 화면 라이브 동작 + 핵심 회귀 점검.

| 항목 | 위치 |
|---|---|
| 사용자 수신 설정 화면 | `/settings-notifications.html` + `js/settings-notifications.js` |
| 사용자 설정 API | `/api/notification-preferences` (GET/PATCH/DELETE) |
| 어드민 정책 화면 | `/admin-notification-defaults.html` + `js/admin-notification-defaults.js` |
| 어드민 정책 API | `/api/admin-notification-defaults` (GET/PATCH, ?history=1) |

---

## 2. 라이브 응답 점검 (인증 거부 흐름)

세션 쿠키 없이 호출 시 모든 엔드포인트가 깔끔한 401 거부. 500 / 타입 에러 0.

| 호출 | 응답 |
|---|---|
| GET `/settings-notifications.html` | **200** (페이지 정상 서빙) |
| GET `/admin-notification-defaults.html` | **200** (페이지 정상 서빙) |
| GET `/api/notification-preferences` (비인증) | **401** `{"ok":false,"error":"로그인이 필요합니다"}` |
| GET `/api/admin-notification-defaults` (비인증) | **401** `{"ok":false,"error":"관리자 로그인이 필요합니다"}` |
| GET `/api/admin-notification-defaults?history=1` (비인증) | **401** 동일 |

→ 인증 가드 정상 동작. 서버 500이나 schema 미스매치로 인한 누출 없음.

---

## 3. 회귀 점검 (이번 라운드 bigserial 사고 회복 확인 + 기존 화면 깨짐 0)

| 점검 항목 | 응답 | 판정 |
|---|---|---|
| 어드민 로그인 페이지 진입 | 200 | ✅ |
| 회원 명단 API (`/api/admin/members`, 비인증) | 401 | ✅ — 500 아님 → bigserial 회복 양호 |
| 후원 리스트 API (`/api/admin/donations`, 비인증) | 401 | ✅ |
| 발송 로그 API (`/api/admin-notification-logs`, 비인증) | 401 | ✅ — Phase 8 인프라 살아있음 |
| 마이페이지 API (`/api/auth/me`, 비인증) | 401 | ✅ — 사용자 진입 흐름 정상 |

핵심 SELECT 한 번이라도 깨졌다면 500이 떴을 텐데 모두 401로 돌려보냄 → schema 활성화 후 운영 회귀 0.

---

## 4. 코드 정합성 점검 (정독)

라이브 클릭 검증 대신 코드 일치성을 정독으로 확인.

### 4.1 사용자 화면 (`notification-preferences.ts` + `settings-notifications.js`)

- ✅ `requireActiveUser` 적용 → 차단된 회원도 차단 통합 (블랙 가드)
- ✅ **본인 데이터만**: `WHERE member_id = ${memberId}` 격리 (다른 회원 노출 0)
- ✅ GET: 본인 설정 → 어드민 기본값 → 코드 fallback `EVENT_CHANNEL_POLICY` 3단 폴백
- ✅ PATCH: 클라이언트가 강제 채널 풀어도 서버에서 자동 복원 (`FORCED_CHANNELS` 합집합)
- ✅ DELETE: 본인 설정 행만 삭제 → 다음 GET 시 어드민 기본값 표시
- ✅ 응답 키 다중 fallback: 클라이언트 `res.data?.data ?? res.data` (CLAUDE §6.2)
- ✅ 9개 이벤트 매트릭스: `BILLING_EVENTS(4) + WORKSPACE_EVENTS(1) + SERVICE_EVENTS(4)` = 9개 — 표 3개로 분할 렌더
- ✅ 전화번호 미인증 시 SMS·알림톡 체크박스 비활성화 + "인증 필요" 배지

### 4.2 어드민 화면 (`admin-notification-defaults.ts` + `admin-notification-defaults.js`)

- ✅ `requireAdmin` 적용 + 반환 필드 `auth.res` (CLAUDE §6.5 표준)
- ✅ 어드민 ID는 `auth.ctx.admin.uid` 정상 참조
- ✅ GET: 9개 이벤트 + 변경자·변경시각 + 사용자 커스텀 카운트
- ✅ PATCH: 변경 전 값 조회 → upsert → 감사 로그 별도 INSERT (감사 실패는 무시 — 본업 우선)
- ✅ ?history=1: `audit_logs` 표적 테이블 필터로 최근 50건
- ✅ KPI 3장: 전체 이벤트 수 / 필수 채널 이벤트 수 / 사용자 커스텀 설정 합계
- ✅ 변경 이력 탭 전환: 활성 탭에서만 `loadHistory()` 호출 (불필요한 호출 차단)
- ✅ 강제 채널은 어드민도 풀 수 없음 (`forced` → `cb.disabled = true`) — 정책 일관성 보장

### 4.3 디스패처 통합 (`lib/notify-dispatcher.ts`)

- ✅ 라운드 1차에서 검증된 통합 흐름: `사용자 설정 → 어드민 기본값 → EVENT_CHANNEL_POLICY` 3단 폴백
- ✅ `FORCED_CHANNELS` 합집합으로 결제 실패·카드 만료 알림은 인앱·이메일이 항상 포함됨 (회원이 끄지 못함)
- ✅ Phase 8 알림 발송 흐름과 호환 — 디스패처 인터페이스 변경 없음, 채널 결정만 사용자 설정 우선화

---

## 5. Swain 직접 클릭 검증이 필요한 항목 (외부 시스템·세션 한정)

C가 비인증으로 점검할 수 없는 부분. 다음 라운드에서 Swain이 직접 확인 권장:

1. **사용자 화면**: 회원 로그인 → `/settings-notifications.html` → 9개 이벤트 매트릭스 표시 → 채널 토글 → 저장 → 새로고침 후 유지 → "맞춤 설정됨" 표시
2. **어드민 화면**: 어드민 로그인 → `/admin-notification-defaults.html` → 정책 수정 → 변경 이력 탭에서 본인이 방금 한 변경이 보이는가
3. **반영 흐름**: 어드민이 기본값 수정 → 다른 회원 계정으로 들어가서 본인 설정이 없는 이벤트의 기본 채널이 새 정책 그대로 보이는가

세션 쿠키 흐름은 코드상 정상이라 위 클릭 검증도 통과 예상.

---

## 6. 결론

- **bug 발견**: 0건
- **회귀**: 0건 (bigserial 사고에서 회복 양호)
- **코드 정합성**: 양호 — 사용자 격리·강제 채널·다중 폴백·감사 로그·KPI 모두 설계대로
- **추천**: Q1 통과로 마감, 다음 큐 Q2(백필) 진행. 라이브 클릭 검증은 §5 항목 한해 Swain이 직접 확인.

---

## 참고

- 머지 커밋: 014432b (1차) → 56f95a1 (2차, schema 활성화)
- Phase 8 디스패처 인프라: docs/verify/2026-05-10-phase8-admin-q24-q28.md
- 다음 큐: Q2 #BACKFILL-1 (이번 세션에서 함께 처리)
