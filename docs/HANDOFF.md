# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-11 / Phase 10 R4 100% 완료 + BUG-9 fix / 다음 작업 설계 대기

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa-siren-cms.netlify.app>
- 베이스 브랜치: `main` (최신 커밋 `0f98042` — verify/phase10-r4 머지)
- 상세 스택·환경·구조: [`CLAUDE.md`](../CLAUDE.md) §1~5

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독 (지금 읽고 있음)
2) PROJECT_STATE.md §2·§3·§5·§7 정독
3) docs/PARALLEL_GUIDE.md §1~§3 정독 (4채팅 구조 핵심)
4) 본 §3 (지금 진행 중인 일) 확인
5) B·A 채팅 진행 상황을 Swain께 확인
```

---

## 3. 지금 진행 중인 일 (이전 메인 채팅 종료 시점)

### 3.1 Phase 10 R4 — 완료 ✅

**완료 시점**: 2026-05-11 `0f98042`

| 영역 | 결과 |
|---|---|
| 이메일 오픈·클릭 추적 | ✅ |
| 재발송 (개별·일괄) | ✅ |
| 발송 이력 (어드민·마이페이지) | ✅ |
| AI 자동 트리거 (CRUD·토글·크론·쿨다운) | ✅ |
| 발송 분석 대시보드 | ✅ |
| R3 회귀 | ✅ 0건 |

**BUG-9 fix**: `db/schema.ts` R4 마이그 후 컬럼 6개 누락 → C가 검증 중 발견·수정 (tracking_token 등)

**보고서**: `docs/verify/2026-05-11-phase10-r4.md`

---

### 3.2 다음 작업 — 미정 (설계 세션 필요)

Phase 10이 모두 완료됐으므로 **다음 Phase 선택**이 필요합니다.

후보 (PROJECT_STATE §5 기준):

| 후보 | 예상 규모 | 비고 |
|---|---|---|
| Phase 11 — 멘션·구독 | 중 | 게시판·채팅 알림 강화 |
| Phase 12 — 신고 진행 공개 + 익명 강화 | 중 | SIREN 신고 고도화 |
| Phase 13 — 신고 통계 대시보드 | 소~중 | Phase 12 선행 권장 |
| TypeScript 149건 정리 | 소 | 품질·안정성 |
| Phase 16 — 통합 분석 대시보드 | 대 | Phase 4 인계 보강 포함 |

**새 메인 채팅 첫 액션**: Swain과 다음 Phase 합의 → 설계 → A·B 트리거

---

### 3.3 4채팅 구조 (현재)

| 채팅 | 모델 | 역할 | 현재 상태 |
|---|---|---|---|
| 메인 | Opus 4.7 | 설계·머지·조율 | 이 채팅 — 종료 직전 |
| A | Sonnet 4.6 | 프론트 (`public/`) | R4 완료 — 새 세션 대기 |
| B | Sonnet 4.6 | 백 (`netlify/functions/`, `lib/`, `db/`) | R4 완료 — 새 세션 대기 |
| C | Opus 4.7 | 검증·fix | R4 검증 완료 — 다음 검증 대기 |

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
| 카카오 알림톡 심사 통과 후 환경변수 2개 등록 | ⏸ 대기 (심사 영업일 3~5일) |
| SMS 실발송 확인 (결제 실패 이벤트 발생 시) | ⏸ Swain 직접 |

카카오 환경변수:
- `ALIGO_TEMPLATE_BILLING_FAILED`
- `ALIGO_TEMPLATE_CARD_EXPIRING`

---

## 4. 즉시 해야 할 일 (새 메인 선택)

### 옵션 A — 다음 Phase 합의 + 설계

1. Swain과 다음 Phase 선택 합의
2. 설계서 작성 (`docs/milestones/`)
3. A·B 트리거 메시지 작성 + 전달

### 옵션 B — TypeScript 149건 먼저 정리

1. C에게 타입 에러 정리 트리거 (단독 작업)
2. 이후 다음 Phase 진입

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
| 2026-05-11 | #BUG-9 schema 컬럼 누락 (마이그 후 미반영) | schema | 마이그 직후 schema 활성화 체크리스트 필수 |

**BUG-5/8 패턴** (반복 주의):
- 틀림: `auth.admin?.id` / `auth.user?.id`
- 맞음: `auth.ctx?.admin?.uid` (requireAdmin 반환 구조)

**BUG-9 패턴** (신규):
- 마이그레이션으로 DB에 컬럼 추가 후 `db/schema.ts` 미반영 시 `db:push` 때 DROP 위험
- 마이그 완료 직후 schema 활성화 + 컬럼 정의 전수 대조 필수

### 5.2 환경변수 — Aligo (이미 등록됨)

- `ALIGO_API_KEY` ✅
- `ALIGO_USER_ID` ✅
- `ALIGO_SENDER` ✅
- `ALIGO_KAKAO_CHANNEL_ID` ✅
- `NOTIFICATION_TEST_MODE` ✅
- `SITE_URL` ✅ (R4 추적 URL 생성에 사용)

### 5.3 R4 추가 환경변수

- 없음. SITE_URL 재사용.
- 선택: `TRACKING_DOMAIN_WHITELIST` (외부 redirect 허용 도메인 목록)

---

## 6. Phase 진행률 스냅샷 (PROJECT_STATE §5 기준)

| 묶음 | 상태 |
|---|---|
| Phase 1~3, 3-extra | ✅ 100% |
| 4·5·6순위 (#1~#16) | ✅ 100% |
| Phase 4 대표 보고 | ✅ 100% |
| Phase 5~7 재정 | ✅ 100% |
| Phase 8 알림 인프라 | ✅ 100% |
| Phase 9 외부 API + 수신 설정 | ✅ 코드 100% / 🟡 실발송 환경변수 등록 후 자동 |
| **Phase 10 R1·R2·R3·R4** | ✅ 각 100% (R4: `0f98042`) |
| Phase 11~22 | ⏸ 카탈로그만 — 다음 Phase 합의 필요 |
| TypeScript 149건 | ⏸ 미착수 |

누적 약 **50%** / 약 470h+

---

## 7. 새 메인 첫 메시지 권장

```
인수인계 정독 완료.

현재 상태:
- Phase 10 R1~R4 ✅ 100% 완료
- A·B 새 세션 대기 중

다음 Phase 선택 합의 후 설계·트리거 진행합니다.
어떤 Phase부터 시작할까요?
```
