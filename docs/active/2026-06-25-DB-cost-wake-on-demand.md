# 🔔 MIS 메인 전달문 — Neon DB 비용 절감(wake-on-demand 전환) (2026-06-25)

> AutoMarketing 메인 ↔ 사장님 진단 결과를 MIS 메인에게 인계. **tbfa-siren-cms Neon DB 비용이 과다** → 크론 폴링이 DB를 24/7 깨워둠. **이벤트 기반(즉시 발송) + 저빈도 안전망**으로 전환해 "유휴 시 잠·접속 시 깸" 모델 구현(지연 0·비용↓). 사장님 승인 방향.

## 1. 문제 (실측)
- **Neon DB `tbfa-siren-cms`: Compute units 30일 = 718 GB-hours** (≈24 GB-hr/day = 거의 24/7 가동).
- 그래프가 **납작한 상시 가동** 패턴(사람 트래픽이면 주간 피크가 보여야 함 → 납작 = **크론 상시 가동**).
- Neon 설정은 정상: **autosuspend 5분(300s)·1 CU**. 즉 "접속하면 깨고 5분 유휴면 잠"은 이미 자동 동작.
- ⚠️ 진짜 원인 = **`*/10`(10분) 크론 3개**가 유저가 없어도 시계처럼 DB를 깨워서 5분 sleep을 무력화:
  - `cron-notification-retry` (`*/10`)
  - `cron-communication-send-dispatcher` (`*/10`)  ← communication_send_jobs 큐(즉시+예약 발송) 처리
  - `cron-ai-schedule-runner` (`*/10`)
  - (참고: `cron-workspace-task-reminder` `*/30`도 보조 기여)

## 2. 목표 (사장님)
**"평소엔 DB가 자고, 누가 접속하면 깨고, 활동 없으면 다시 잠"** — 단 **발송은 지연 없이**(오히려 더 빠르게). Neon은 유저 트래픽엔 이미 wake-on-demand. **크론이 망치는 부분만 이벤트 기반으로 전환.**

## 3. 설계
### ① 즉시 발송 = 이벤트 기반 (지연 0·크론 불필요)
- communication_send_jobs에 **즉시 발송 job을 적재하는 순간**(= 이미 유저 요청으로 DB가 깨어있는 그 시점) **디스패처를 fire-and-forget로 즉시 호출**(`-background` 함수·202) → 10분 대기 없이 **즉시 발송**.
- 적재 지점이 다수(`INSERT INTO communication_send_jobs`·예: admin-donation-confirm·admin-expert-assign·통신발송 트리거 전반) → 각 적재 후 디스패처 트리거 한 줄 추가(디스패처 로직 자체는 재사용).
- 아무도 안 쓰면 적재도 없음 → 깨울 일 없음 → **DB 잠듦**.

### ② 예약/재시도/예약AI = 저빈도 안전망 (본질적으로 미래 시점 wake 필요)
- 예약 발송(scheduled_at 미래)·실패 재시도·예약 AI는 이벤트로 못 잡음(미래에 깨어나야) → **10분 → 30~60분**으로 낮춤.
  - 예약/재시도는 초단위 아님 → 30분 지연 무해.
  - 깨우는 횟수 **144회/일 → 24~48회/일**로 급감.
- (선택) 디스패처 안전망 cron은 "due 잡 0이면 즉시 종료"로 가볍게(어차피 쿼리 1회는 깨우나 짧게).

### 결과
- 유휴(밤·유저0·예약건 없음) = DB sleep = 비용 0 수렴.
- 활동/메시지 발생 = **즉시 처리(지연0)**. 비용↓·지연↓ 동시.

## 4. ⚠️ 구현 주의 (SIREN 크리티컬 경로)
- communication_send_jobs는 **결제·후원·문자·알림톡** 등 크리티컬 발송. 즉시-fire 도입 시 **중복/누락 절대 금지**:
  - job 픽업은 **원자적 status 전이**(pending→processing·`UPDATE ... WHERE status='pending' RETURNING`)로 멱등 유지 → 즉시-fire와 안전망 cron이 동시에 같은 job을 잡아도 한 쪽만 처리.
  - fire-and-forget 실패해도 안전망 cron이 줍게(이중화) → 발송 누락 0.
  - 서버 응답 후 freeze 주의(Netlify) — 적재 트랜잭션 커밋 후 fire.
- 카카오 알림톡 adapter skip 등 기존 분기 보존.

## 5. 권장 단계
1. **즉효·무위험(지금)**: 크론 3종 `*/10 → */30` (DB 깨우기 절반↓·예약/재시도 지연만 무해·배포 1회). netlify.toml만 수정.
2. **이상적(지연0)**: 즉시 발송 이벤트-fire 도입(각 적재 지점 + 디스패처 재사용·멱등 검증) → 한 라운드로 검증 포함 진행.
3. **추가 점검**: 외부 uptime 모니터/keepwarm가 5분 미만 핑하면 그것도 24/7 원인 → 있으면 제거/완화.

## 6. 참고
- Neon endpoint: `ep-polished-pond-aj4edu9p`·autoscale 1/1 CU·suspend 300s (설정 자체는 최적·바꿀 필요 없음·문제는 크론 폴링).
- 이건 **tbfa-mis 자체 배포**가 필요(AutoMarketing과 별개 프로젝트·별건 비용).
- AutoMarketing 측 비용 1위는 별개로 "배포 693회(61%)" → 거긴 배치푸시로 대응 중.

---

## 7. 구현 완료 (2026-06-25 · MIS 메인 · A안=Step1+Step2 묶음)

마이그레이션 불필요(`status`는 text 컬럼 — 중간 상태 'preparing' 추가에 스키마 변경 없음). 배포 1회로 적용.

### Step 1 — 빈발 크론 3종 `*/10 → */30`
- `netlify.toml` + 각 함수 인라인 `config.schedule` 동시 수정(이중 등록 정합):
  `cron-notification-retry`·`cron-communication-send-dispatcher`·`cron-ai-schedule-runner`.
- DB 깨우기 144→48회/일. 거래성 알림(결제·후원 등)은 `dispatch()` 이벤트 발송이라 영향 0.

### Step 2 — 즉시 발송 = 이벤트 기반 (지연 0)
- **`lib/communication-dispatcher-core.ts` 신설**: 기존 디스패처 로직 추출 + drain 루프(`runDispatcher({maxMs})`) + `hasDispatchWork()` + `triggerDispatchBackground()`.
- **`communication-send-dispatch-background.ts` 신설**: 15분 백그라운드 드레이너(12분 예산으로 끝까지 완주 → 대량발송도 즉시 처리·기존 1,500건/h 한계 해소). `INTERNAL_TRIGGER_SECRET` fail-closed.
- **`cron-communication-send-dispatcher.ts`**: 안전망으로 축소 — 할 일 있을 때만 백그라운드 깨우고 종료(DB wake 최소).
- **즉시-fire 연결**: `admin-send-job-create`(지금 발송)·`admin-send-job-retry`·`admin-send-job-retry-failed`·`admin-send-job-restart`가 적재/복구 직후 드레이너 즉시 fire.

### 동시성 안전 (중복/누락 0)
- 작업 픽업 = 원자적 `pending → 'preparing'` claim(다른 러너가 잡았으면 0행 → 스킵). 스냅샷 INSERT 완료 후 `'preparing' → 'processing'`(준비 중인 작업은 발송 단계에 안 보임 → 조기 완료 마킹 불가).
- 수신자 발송 = 원자적 `pending → 'sending'` claim(한 수신자 1회 발송).
- fire 실패해도 30분 안전망 크론이 동일 작업을 줍게 이중화 → 발송 누락 0.
- 멈춘 'preparing'(스냅샷 INSERT 중 함수 사망)은 5분 경과 시 부분 스냅샷 삭제 후 pending 환원(발송 전이라 안전).

### 변경 파일
- 신규: `lib/communication-dispatcher-core.ts`, `netlify/functions/communication-send-dispatch-background.ts`
- 수정: `netlify.toml`, `cron-communication-send-dispatcher.ts`, `cron-notification-retry.ts`, `cron-ai-schedule-runner.ts`, `admin-send-job-create.ts`, `admin-send-job-retry.ts`, `admin-send-job-retry-failed.ts`, `admin-send-job-restart.ts`, `public/js/admin-send-jobs.js`, `public/js/admin-send-job-detail.js`(+'preparing' 라벨·캐시버스터)

### 검증 포인트(배포 후 라이브)
1. 운영자 "지금 발송" → **즉시** 발송(최대 10분 대기 사라짐).
2. 대량 그룹발송도 백그라운드가 끝까지 완주(중간에 멈추지 않음).
3. 유휴 시간대 Neon Compute(GB-hrs) 급감(다음 청구주기 그래프로 확인).
4. 실패 재발송·작업 재시작도 즉시 반영.
