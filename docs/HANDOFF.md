# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-11 / Phase 10 R3 100% 완료 + BUG-8 fix / R4 설계 완료 + B·A 트리거 메시지 제공

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa-siren-cms.netlify.app>
- 베이스 브랜치: `main` (최신 커밋 `a8845ae` — verify/phase10-r3 머지)
- 상세 스택·환경·구조: [`CLAUDE.md`](../CLAUDE.md) §1~5

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독 (지금 읽고 있음)
2) PROJECT_STATE.md §2·§3·§5·§7 정독
3) docs/PARALLEL_GUIDE.md §1~§3 정독 (4채팅 구조 핵심)
4) 본 §3 (지금 진행 중인 일) 확인
5) B·A 채팅 진행 상황을 Swain께 확인 (트리거 메시지 이미 제공됨)
6) B 보고 있으면 1차 머지 → 마이그 호출 안내 → schema 활성화 순서 진행
```

---

## 3. 지금 진행 중인 일 (이전 메인 채팅 종료 시점)

### 3.1 Phase 10 R4 — 통합 발송 시스템 마무리 (추적·AI·분석·재발송·이력)

**현재 상태**: B·A 트리거 메시지를 Swain에게 제공한 직후. B·A 작업 시작 또는 진행 중일 수 있음.

**설계서**: [`docs/milestones/2026-05-11-phase10-r4-tracking-ai-analytics.md`](milestones/2026-05-11-phase10-r4-tracking-ai-analytics.md)

#### 머지 순서 (강제)

```
1. B feature/phase10-r4-back-1 push (추적·재발송·이력) → 메인 머지 → push
2. Netlify 배포 1~3분 대기
3. 메인이 Swain께 마이그 호출 안내:
   https://tbfa-siren-cms.netlify.app/api/migrate-phase10-r4-tracking-ai?run=1
4. Swain success 응답 → 메인:
   - schema.ts R4 정의 주석 해제 (3테이블 + 5컬럼)
   - migrate 파일 삭제
   → push
5. B feature/phase10-r4-back-2 push (AI 트리거·분석 — 1차 머지 후 시작) → 메인 머지 → push
6. A feature/phase10-r4-front push → 메인 머지 → push
7. C verify/phase10-r4 트리거 → Q1~Q18 검증
```

#### R4 범위 요약

| # | 영역 | 담당 | 파일 수 |
|---|---|---|---|
| A | 이메일 추적 (open pixel + click redirect) | B | lib + 2 함수 |
| B | AI 트리거 자동 발송 + 5종 시드 | B | lib + 11 함수 + cron 2개 |
| C | 트리거 관리 화면 | A | 2 HTML + 2 JS |
| D | 발송 분석 대시보드 | A | 1 HTML + 1 JS |
| E | 실패 수신자 재발송 | B+A | 2 함수 + 기존 화면 보강 |
| F | 발송 이력 검색 (회원별·사용자 본인) | B+A | 2 함수 + 2 HTML + 2 JS |

#### B 1차 작업 (feature/phase10-r4-back-1)

| 순번 | 파일 | 역할 |
|---|---|---|
| 1 | `lib/communication-tracking.ts` | token 생성 + open pixel/click URL 생성 + HTML 삽입 |
| 2 | `netlify/functions/migrate-phase10-r4-tracking-ai.ts` | 3테이블 + 5컬럼 + 시드 5건 |
| 3 | `db/schema.ts` (주석 상태) | R4 3테이블 + 5컬럼 정의 |
| 4 | `netlify/functions/track-open.ts` | 1×1 PNG + open 이벤트 기록 |
| 5 | `netlify/functions/track-click.ts` | 302 redirect + click 이벤트 기록 (오픈 redirect 방지) |
| 6 | `netlify/functions/admin-send-job-retry.ts` | 개별 재발송 |
| 7 | `netlify/functions/admin-send-job-retry-failed.ts` | 실패만 재발송 |
| 8 | `netlify/functions/admin-member-send-history.ts` | 어드민 회원 발송 이력 |
| 9 | `netlify/functions/user-my-send-history.ts` | 사용자 본인 이력 |
| 10 | R3 cron 1줄 수정 | recipient INSERT 시 tracking_token 자동 생성 |
| 11 | R3 어댑터 수정 | 이메일 발송 직전 injectTrackingIntoHtml 호출 |

#### B 2차 작업 (feature/phase10-r4-back-2, 1차 머지 후)

| 순번 | 파일 | 역할 |
|---|---|---|
| 12 | `lib/communication-auto-trigger.ts` | evaluateTrigger + executeTrigger |
| 13~20 | `admin-auto-triggers-list/detail/create/update/delete/toggle/runs.ts` | AI 트리거 CRUD |
| 21~23 | `admin-send-analytics-overview/job/channel.ts` | 분석 대시보드 API |
| 24 | `cron-auto-trigger-evaluator.ts` | 30분 단위 트리거 평가 |
| 25 | `cron-tracking-stats-rollup.ts` | 6시간 단위 통계 롤업 |

#### A 작업 (feature/phase10-r4-front, B와 평행 시작 가능)

| 순번 | 파일 | 역할 |
|---|---|---|
| 1~2 | `admin-auto-triggers.html + .js` | 트리거 목록 (토글·삭제·이력) |
| 3~4 | `admin-auto-trigger-edit.html + .js` | 트리거 편집 (종류별 동적 조건) |
| 5~6 | `admin-send-analytics.html + .js` | 분석 대시보드 (Chart.js) |
| 7~8 | `admin-member-send-history.html + .js` | 회원 이력 |
| 9~10 | `my-send-history.html + .js` | 사용자 본인 이력 |
| 11~12 | R3 상세 화면 보강 | 재발송 버튼 추가 |
| 13 | 사이드바 2줄 추가 | AI 자동 발송·발송 분석 메뉴 |
| 14~15 | 기존 화면 버튼 추가 | 회원 상세·마이페이지 |

#### C 검증 시나리오 (B·A 머지 후)

Q1~Q18 + cron 2종 + 성능 + 보안 체크. 설계서 §4 참조.

---

### 3.2 완료된 Phase 10 라운드 (참조용)

| 라운드 | 상태 | 커밋 |
|---|---|---|
| R1 템플릿 빌더 | ✅ 100% | `8db8ffb`·`cef0f69` |
| R2 수신자 그룹 | ✅ 100% | `7f2163b`·`b969bb2` |
| R3 발송 예약 큐 | ✅ 100% + BUG-8 fix | `897cad4`·`857674d`·`a8845ae` |

---

### 3.3 4채팅 구조 (현재)

| 채팅 | 모델 | 역할 | 현재 상태 |
|---|---|---|---|
| 메인 | Opus 4.7 | 설계·머지·조율 | 이 채팅 — 종료 직전 |
| A | Sonnet 4.6 | 프론트 (`public/`) | R4 트리거 메시지 제공됨 |
| B | Sonnet 4.6 | 백 (`netlify/functions/`, `lib/`, `db/`) | R4 트리거 메시지 제공됨 |
| C | Opus 4.7 | 검증·fix | R3 완료 — R4 검증 대기 |

**worktree 폴더**:
```
tbfa-mis        (메인) — 머지·조율 전용
../tbfa-mis-A  (A 채팅)
../tbfa-mis-B  (B 채팅)
../tbfa-mis-C  (C 채팅)
```

---

### 3.4 Swain 운영 액션 대기 (코드 외)

| 액션 | 상태 |
|---|---|
| 효성 자료 재 import (계약 관리 → 수납 파일 순서) | ⏸ Swain 직접 — 옛 자료 삭제 완료(`897cad4`) |
| 카카오 알림톡 심사 통과 후 환경변수 2개 등록 | ⏸ 대기 (심사 영업일 3~5일) — 등록 시 Q8 진입 |

카카오 환경변수:
- `ALIGO_TEMPLATE_BILLING_FAILED`
- `ALIGO_TEMPLATE_CARD_EXPIRING`

---

## 4. 즉시 해야 할 일 (새 메인 선택)

### 옵션 A — B 보고 없음 → 대기 + 설계 리뷰

1. B·A 진행 상황 Swain께 확인
2. 아직 시작 안 했으면 트리거 메시지 재전달 (설계서 §6.2·§6.3)
3. 진행 중이면 진행률 보고 받기

### 옵션 B — B 1차 보고 왔음 → 머지 + 마이그

1. B feature/phase10-r4-back-1 main 머지
2. push → 배포 대기 1~3분
3. Swain에게 마이그 호출 안내:
   `https://tbfa-siren-cms.netlify.app/api/migrate-phase10-r4-tracking-ai?run=1`
4. success 응답 → schema 활성화 (3테이블 + 5컬럼 주석 해제) + 마이그 파일 삭제 + push

### 옵션 C — B 2차 + A 보고 모두 왔음 → 머지 + C 검증 트리거

1. B 2차 머지 → push
2. A 머지 → push
3. C verify/phase10-r4 트리거

---

## 5. 핵심 정보 (자주 참조)

### 5.1 반복 사고 패턴 방지

| 날짜 | 사고 | 클래스 | 방지 |
|---|---|---|---|
| 2026-05-09 | worktree 미분리 충돌 | 구조 | worktree 강제 |
| 2026-05-09 | schema 영역 덮어쓰기 | 충돌 | B만 schema 작성, append-only |
| 2026-05-09 | #BUG-1 `uid` 필드명 오류 | 헬퍼 | 도입 직후 사용처 1회 검증 |
| 2026-05-10 | `bigserial` import 누락 502 | tsc | B push 전 `npx tsc --noEmit` 의무 |
| 2026-05-11 | #BUG-8 `auth.admin?.id` → 항상 undefined | BUG-5 회귀 | `auth.ctx?.admin?.uid` 직접 참조 |

**BUG-5/8 패턴** (Phase 5~7·R3에서 반복):
- 틀림: `auth.admin?.id` / `auth.user?.id`
- 맞음: `auth.ctx?.admin?.uid` (requireAdmin 반환 구조)

### 5.2 환경변수 — Aligo (이미 등록됨)

- `ALIGO_API_KEY` ✅
- `ALIGO_USER_ID` ✅
- `ALIGO_SENDER` ✅
- `ALIGO_KAKAO_CHANNEL_ID` ✅
- `NOTIFICATION_TEST_MODE` ✅
- `SITE_URL` ✅ (R4 추적 URL 생성에도 사용)

### 5.3 R4 신규 환경변수

- 없음. SITE_URL 재사용.
- 선택: `TRACKING_DOMAIN_WHITELIST` (외부 redirect 허용 도메인 목록 — 운영 시 필요 시 등록)

---

## 6. Phase 진행률 스냅샷 (PROJECT_STATE §5 기준)

| 묶음 | 상태 |
|---|---|
| Phase 1~3, 3-extra | ✅ 100% |
| 4·5·6순위 (#1~#16) | ✅ 100% |
| Phase 4 대표 보고 | ✅ 100% |
| Phase 5~7 재정 | ✅ 100% |
| Phase 8 알림 인프라 | ✅ 100% |
| Phase 9 외부 API + 수신 설정 | ✅ 코드 100% / 🟡 Q7(SMS)·Q8(카카오 심사 대기) |
| **Phase 10 R1·R2·R3** | ✅ 각 100% |
| **Phase 10 R4** | 🟢 설계 완료 — B·A 트리거 진행 중 |
| Phase 11~22 | ⏸ 카탈로그만 |

누적 약 47% / 약 450h+

---

## 7. 새 메인 첫 메시지 권장

```
인수인계 정독 완료.

현재 상태:
- Phase 10 R3 발송 예약 큐 ✅ 100% 완료 (코드 + C 라이브 검증 + BUG-8 fix)
- Phase 10 R4 설계 완료 — B·A 트리거 메시지 제공됨

B·A 진행 상황 알려주시면 즉시 이어서 진행합니다.
(B 1차 보고 왔으면 머지 + 마이그 호출 안내 / 아직이면 대기)
```
