# Phase 8·9 — 알림 채널 통합 인프라 + 외부 API 연동 + 사용자 수신 설정

> **합의 시점**: 2026-05-10 / 메인 채팅 (설계 세션)
> **목적**: 알림이 인앱 단일 채널로만 동작하는 문제 해결 → 다중 채널(인앱·이메일·SMS·알림톡)로 확장 + 사용자가 채널 선택 가능
> **베이스 브랜치**: `main` @ `af33e18`
> **상태**: ✅ 설계 합의 완료 / ⏸ 코드 미착수

---

## 1. 배경 및 문제 정의

### 1.1 현재 상태

알림이 발생하는 모든 코드 지점이 `notifications` 테이블에 INSERT만 하고 종료. 이메일·SMS·알림톡 발송 자리는 코드에 7개 미구현 자리(TODO 주석)로 남아 있음.

| # | 발생 지점 | 알림 종류 | 현재 채널 |
|---|---|---|---|
| 8-1 | 카드 만료 d-7 / d-3 / d-1 | 카드 갱신 안내 | 인앱만 |
| 8-2 | 토스 빌링 성공 / 실패 / 해지 | 결제 결과 | 인앱만 |
| 8-3 | 워크스페이스 댓글·할당·완료 | 활동 알림 | 인앱만 (channel별 분기 미구현) |
| 8-4 | 어드민 일일 브리핑 (06:00 KST) | 운영 요약 | DB만 (이메일 자동발송 X) |

### 1.2 문제

- 사용자가 카드 만료를 인앱에서만 보고 놓쳐서 결제 실패 → 후원 끊김
- 어드민이 일일 브리핑을 매일 사이트 들어와야만 봄
- 워크스페이스 활동 알림이 외부에서 도달하지 않음 → 협업 지연
- SMS·알림톡 자리가 placeholder도 없어 신규 발신 추가 시 또다시 흩어진 자리에 코드 박아야 함

### 1.3 해결 방향

**Phase 8** = 채널 다중화 인프라 (디스패처 + 7개 미구현 자리 통합 + 발송 로그)
**Phase 9** = 외부 API 실연동 (SMS·알림톡) + 사용자 수신 설정 UI

---

## 2. 핵심 결정 사항 (Swain 합의 완료)

| 결정 | 내용 |
|---|---|
| Phase 9 범위 | 9-A 외부 API 실연동 + 9-B 사용자 수신 설정 UI 묶음 |
| 재시도 정책 | 지수 백오프 3회 (1s → 5s → 25s) 후 dead-letter |
| 외부 서비스 선택 | Phase 9 시작 시점에 비교·결정 (Phase 8은 placeholder로 완성) |
| Phase 8 분배 | A(디스패처) → B(7개 자리) + C(어드민 화면·검증) 순차 |

---

## 3. Phase 8 — 알림 채널 통합 인프라

### 3.1 로직 설계

핵심 아이디어: **발신 지점은 채널을 직접 모름**. 이벤트 타입과 대상자만 던지면 디스패처가 정책에 따라 다중 채널 발송.

```
[발신 지점] ── dispatch({event, target, params})
                       │
                       ▼
              [정책 조회] 이벤트 카탈로그 + (Phase 9 후) 사용자 수신 설정
                       │
              ┌────────┼────────┬────────┐
              ▼        ▼        ▼        ▼
          [인앱]   [이메일]   [SMS]   [알림톡]
                  (Resend)   (P9)    (P9)
              │        │        │        │
              └─ notification_dispatch_logs (성공·실패·재시도 추적) ─┘
```

### 3.2 이벤트 카탈로그 (확정 9종)

Phase 8에서 코드 한 곳에 enum으로 고정. 신규 알림 추가 시 카탈로그 갱신만으로 작업 가능.

| 이벤트 키 | 설명 | 기본 채널 (Phase 8) | 미래 확장 (Phase 9 사용자 설정 가능 여부) |
|---|---|---|---|
| `billing.success` | 정기 결제 성공 | 인앱 + 이메일 | 사용자 선택 가능 |
| `billing.failed` | 정기 결제 실패 | 인앱 + 이메일 + 알림톡 | **필수 채널 포함** (실패 알림은 강제) |
| `billing.canceled` | 정기 후원 해지 | 인앱 + 이메일 | 사용자 선택 가능 |
| `card.expiring` | 카드 만료 임박 (d-7/d-3/d-1) | 인앱 + 이메일 + 알림톡 | **필수 채널 포함** |
| `workspace.activity` | 워크스페이스 활동 (댓글·할당·완료) | 인앱 | 사용자 선택 (이메일 요약) |
| `admin.daily_briefing` | 어드민 일일 브리핑 | 어드민 이메일 | 어드민 전용 |
| `support.reply` | 유족 지원 답변 도착 | 인앱 + 이메일 | 사용자 선택 가능 |
| `siren.assigned` | SIREN 신고 담당자 배정 | 인앱 + 이메일 | 사용자 선택 가능 |
| `member.eligibility_decided` | 자격 변경 승인·반려 | 인앱 + 이메일 | 사용자 선택 가능 |

### 3.3 재시도 정책

- 외부 채널(이메일·SMS·알림톡)은 발송 실패 시 지수 백오프 재시도
- 1차: 1초 후 → 2차: 5초 후 → 3차: 25초 후
- 3회 모두 실패 시 status=`dead`, 어드민에 인앱 알림 발송 (메타-알림은 재시도 안 함)
- 인앱 채널은 DB INSERT라 실패 거의 없음 → 재시도 없음, 1회 실패 시 즉시 `dead`
- 재시도 큐는 DB 폴링 방식 (별도 cron — `cron-notification-retry.ts` 1분 주기, Phase 8에서 신설)

### 3.4 테스트 모드

- 환경변수 `NOTIFICATION_TEST_MODE=true` 시 모든 외부 채널 발송이 콘솔 로그 + DB 기록만 (실제 발송 X)
- 어드민 redirect: `NOTIFICATION_TEST_RECIPIENT_EMAIL`, `..._SMS`, `..._KAKAO` (Resend의 `RESEND_TEST_RECIPIENT` 패턴 따름)
- 운영 시 `NOTIFICATION_TEST_MODE=false`

### 3.5 DB 설계

#### 신규 테이블: `notification_dispatch_logs`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | bigserial | PK | |
| `notification_id` | bigint | NULLABLE, FK → notifications.id | 인앱 알림이 함께 만들어진 경우만 |
| `event_type` | text | NOT NULL | 이벤트 카탈로그 키 (예: `billing.success`) |
| `target_type` | text | NOT NULL | `member` / `admin` |
| `target_id` | bigint | NOT NULL | 수신자 ID (members.id 또는 admins.id) |
| `channel` | text | NOT NULL | `inapp` / `email` / `sms` / `kakao` |
| `status` | text | NOT NULL DEFAULT `pending` | `pending` / `sent` / `failed` / `dead` |
| `attempt` | integer | NOT NULL DEFAULT 0 | 재시도 횟수 (0~3) |
| `provider_message_id` | text | NULLABLE | Resend 등 추적 ID |
| `params_snapshot` | jsonb | NULLABLE | 템플릿 파라미터 스냅샷 (디버깅·재발송용) |
| `error` | text | NULLABLE | 실패 사유 (slice 500자) |
| `latency_ms` | integer | NULLABLE | 발송 소요 시간 |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `next_retry_at` | timestamptz | NULLABLE | 재시도 예정 시각 (cron이 polling) |
| `sent_at` | timestamptz | NULLABLE | 최종 성공 시각 |

**인덱스**:
- `(target_type, target_id, created_at desc)` — 어드민 화면 사용자별 조회
- `(status, next_retry_at) WHERE status = 'pending'` — 재시도 cron 폴링
- `(event_type, created_at desc)` — 이벤트별 통계
- `(channel, status, created_at desc)` — 채널별 성공률

#### 기존 활용 (변경 없음)

- `notifications` — 인앱 채널 표시용
- `members.email`, `members.phone` — 채널 타깃 주소
- `admins.email` — 어드민 알림 주소

### 3.6 구현 영역 (A·B·C 분배)

| 채팅 | 영역 | 추정 |
|---|---|---|
| **A** | 디스패처 + DB + 이벤트 카탈로그 + 재시도 cron + placeholder 어댑터 | 4~5h |
| **B** | 7개 미구현 자리 통합 (워크스페이스·토스·카드·브리핑) | 3~4h |
| **C** | 발송 로그 어드민 화면 + 라이브 검증 + 회귀 테스트 | 2~3h |

---

## 4. Phase 9 — 외부 API 실연동 + 사용자 수신 설정

### 4.1 9-A 외부 API 실연동

Phase 8의 SMS·알림톡 placeholder 어댑터를 실제 외부 서비스로 교체.

**Phase 9 시작 시점 결정 사항**:
- SMS 서비스: Aligo / SOLAPI / NHN Cloud Notification 등 비교 후 선택
- 알림톡 서비스: BizM / 카카오비즈 / SOLAPI 등 비교 후 선택
- 발신번호 등록 절차 (KISA·통신사) — 운영자가 사전 처리
- 알림톡 템플릿 사전 등록 — 카카오 심사 (영업일 3~5일)
- 비용 정산 흐름 (선결제 충전 vs 후정산)
- 정보통신망법 동의 흐름 (회원가입 시 필수 vs 선택)

### 4.2 9-B 사용자 수신 설정 UI

마이페이지에 "결제 알림은 알림톡, 워크스페이스는 이메일" 식으로 사용자가 채널 선택. 어드민은 전역 기본 정책 관리.

#### DB 설계

##### 신규 테이블: `notification_preferences`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | bigserial | PK | |
| `member_id` | bigint | NOT NULL FK | members.id |
| `event_type` | text | NOT NULL | 이벤트 카탈로그 키 |
| `channels` | jsonb | NOT NULL | 예: `["inapp","email"]` |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

UNIQUE: `(member_id, event_type)`
인덱스: `(member_id)` — 마이페이지 사용자 설정 조회

##### 컬럼 추가: `members`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `phone_verified_at` | timestamptz | NULLABLE | SMS·알림톡 발송 가능 여부 (인증 시각) |
| `kakao_marketing_consent_at` | timestamptz | NULLABLE | 정보통신망법 광고성 알림 동의 (필수 알림은 동의 불필요) |

#### 정책 (사용자 미설정 시 기본값)

| 이벤트 카테고리 | 사용자 설정 가능 | 기본값 |
|---|---|---|
| 결제·법적 의무 (`billing.*`, `card.expiring`) | 일부만 (인앱·이메일은 강제) | 인앱 + 이메일 + 알림톡 (전화번호 인증 시) |
| 운영 알림 (`support.reply`, `siren.assigned`, `member.eligibility_decided`) | 전체 | 인앱 + 이메일 |
| 워크스페이스 (`workspace.activity`) | 전체 | 인앱만 |

### 4.3 Phase 9 분배 (9-A + 9-B)

| 채팅 | 영역 | 추정 |
|---|---|---|
| **A** | SMS API 어댑터 실연동 + 발신번호 검증 헬퍼 | 3~5h |
| **B** | 카카오 알림톡 어댑터 실연동 + 템플릿 ID 매핑 | 4~6h |
| **C** | `notification_preferences` 테이블 + 마이페이지 UI + 어드민 전역 정책 화면 | 4~5h |

---

## 5. 일정 및 머지 순서

```
[Phase 8 라운드]
  A 디스패처 머지         → 1주차 전반
   ├─ B 7개 자리 통합 시작  → 1주차 후반
   └─ C 어드민 화면 시작   → 1주차 후반 (B와 병렬)
  C 라이브 검증           → 2주차 전반 (B 머지 후)
  Phase 8 완료            → 2주차 중반

[Phase 8 검증 완료 후 외부 서비스 비교·선정 세션]

[Phase 9 라운드]
  A·B·C 완전 병렬          → 3주차
  Phase 9 완료            → 4주차 전반
```

---

## 6. 위험 요소 및 회피책

| 위험 | 회피 |
|---|---|
| 카카오 알림톡 템플릿 심사 지연 (3~5영업일) | Phase 9 시작 즉시 템플릿 등록 신청 (분배안 A·B·C 작업과 병렬로 심사 진행) |
| 외부 API 일시 장애 → 알림 누락 | Phase 8 재시도 cron + dead-letter 어드민 알림 |
| 사용자 알림 폭격 → 이탈 | Phase 9 9-B 수신 설정 UI 우선 — 광고성 알림 동의 흐름 명확화 |
| `notifications` 테이블 비대 | 별도 정리 cron 신설 안 함 (Phase 8 범위 외) — 추후 Phase 19~22(품질) 검토 |
| 디스패처 인터페이스 변경 시 7개 자리 재작업 | A 머지 전 인터페이스 확정 (Swain·B·C 합의 후 코드 시작) |

---

## 7. 참고

- Phase 8·9 스펙 추출 보고: 메인 채팅 2026-05-10 세션 (Explore subagent)
- 인접 인프라: `lib/email.ts` (Resend 23개 템플릿), `notifications`/`workspace_notifications` 테이블, `lib/notify.ts`, `card_expiry_alerts` 테이블, `billing_logs` 테이블
- TODO 주석 위치: `lib/workspace-logger.ts:131`, `cron-billing-card-expiry.ts:233·235`, `cron-toss-billing.ts:338·394·414`, `cron-agent-8.ts` (검토 필요)
