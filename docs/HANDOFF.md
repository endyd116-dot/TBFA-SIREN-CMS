# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-11 / Phase 10 R4 100% 완료 / Phase 11+12 B·A 트리거 발송 + C TypeScript 정리 트리거 발송

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa-siren-cms.netlify.app>
- 베이스 브랜치: `main` (최신 커밋 `a729561` — HANDOFF 갱신)
- 상세 스택·환경·구조: [`CLAUDE.md`](../CLAUDE.md) §1~5

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독 (지금 읽고 있음)
2) PROJECT_STATE.md §2·§3·§5·§7 정독
3) docs/PARALLEL_GUIDE.md §1~§3 정독
4) 본 §3 (지금 진행 중인 일) 확인
5) B·A·C 채팅 진행 상황을 Swain께 확인
6) 보고 온 채팅 있으면 즉시 머지 순서대로 처리
```

---

## 3. 지금 진행 중인 일 (이전 메인 채팅 종료 시점)

### 3.1 Phase 11 + 12 — 진행 중 (B·A 작업 중)

**시작 시점**: 2026-05-11, 트리거 메시지 전달 완료

#### B 채팅 — feature/phase11-12-back

**Phase 12 백엔드 (먼저 구현):**

| 파일 | 경로 | 역할 |
|---|---|---|
| `admin-incident-anonymity-update.ts` | `/api/admin-incident-anonymity-update?id=X` | POST — 익명 단계 변경 (0=완전익명·1=기본·2=전체) + 로그 기록 |
| `admin-incident-anonymity-logs.ts` | `/api/admin-incident-anonymity-logs?incidentId=X` | GET — 익명 변경 이력 조회 |
| `user-incident-list.ts` | `/api/user-incident-list` | GET — 사용자 본인 신고 목록 (사건·괴롭힘·법률 통합) |
| `user-incident-timeline.ts` | `/api/user-incident-timeline?type=&id=X` | GET — 특정 신고 단계별 진행 이력 |
| `admin-incident-status-notify.ts` | `/api/admin-incident-status-notify?id=X` | POST — 신고자에게 Phase 10 발송 시스템으로 알림 |
| `migrate-phase12-incident-anonymity.ts` | `/api/migrate-phase12-incident-anonymity?run=1` | 1회용 마이그 — incident_anonymity_logs 테이블 + 3테이블 anonymity_level 컬럼 추가 |

**Phase 11 백엔드 (Phase 12 후):**

| 파일 | 경로 | 역할 |
|---|---|---|
| `user-subscription-toggle.ts` | `/api/user-subscription-toggle` | POST — 게시글 구독/해제 토글 |
| `user-subscriptions.ts` | `/api/user-subscriptions` | GET — 본인 구독 목록 |
| `admin-mention-search.ts` | `/api/admin-mention-search?q=&limit=5` | GET — 어드민 멘션 자동완성 |
| `user-mention-search.ts` | `/api/user-mention-search?q=&limit=5` | GET — 사용자 멘션 자동완성 |
| `admin-board-post-notify.ts` | `/api/admin-board-post-notify` | POST — 새 댓글 시 구독자·멘션 대상 알림 |
| `migrate-phase11-subscription.ts` | `/api/migrate-phase11-subscription?run=1` | 1회용 마이그 — board_subscriptions 테이블 |
| `cron-chat-unread-notify.ts` | schedule `0 */2 * * *` | 채팅 안 읽음 2시간 누적 시 알림 |

**schema.ts 추가 예정 (마이그 후 활성화):**
```typescript
// Phase 12
incidentAnonymityLogs — incident_anonymity_logs 테이블

// Phase 11
boardSubscriptions — board_subscriptions 테이블
```

#### A 채팅 — feature/phase11-12-front

**Phase 12 프론트:**
- `public/my-incident-status.html` + `public/js/my-incident-status.js` — 사용자 신고 현황 + 단계 타임라인 모달
- `public/mypage.html` — "📋 내 신고 현황" 메뉴 추가
- `public/js/admin-incidents-crud.js` 보강 — 익명 단계 제어 드롭다운 + 변경 이력 + 알림 발송 버튼

**Phase 11 프론트:**
- `public/board-view.html` + `public/js/board.js` 보강 — "🔔 구독" 토글 버튼
- `public/js/board-mention.js` 신규 — `@` 멘션 자동완성 드롭다운
- `public/my-subscriptions.html` + `public/js/my-subscriptions.js` 신규 — 구독 목록
- `public/mypage.html` — "📌 구독 목록" 메뉴 추가

#### C 채팅 — fix/typescript-errors (B·A와 독립)

TypeScript 타입 에러 149건 정리:
- TS2353 (schema 컬럼 누락) 72건
- TS2339 (requireAdmin narrowing) 49건
- TS2769 (insert 키 불일치) 21건
- 기타 7건

`npx tsc --noEmit` → 0건 달성 후 push

---

### 3.2 머지 순서 (강제)

```
1. B feature/phase11-12-back push 보고
   → B 머지 → push
   → Swain: /api/migrate-phase12-incident-anonymity?run=1 호출
   → schema 활성화 (incidentAnonymityLogs) + 마이그 파일 삭제 + push
   → Swain: /api/migrate-phase11-subscription?run=1 호출
   → schema 활성화 (boardSubscriptions) + 마이그 파일 삭제 + push

2. A feature/phase11-12-front push 보고
   → A 머지 → push

3. C fix/typescript-errors push 보고 (B·A와 독립, 언제든 머지 가능)
   → C 머지 → push

4. 메인이 C에게 Phase 11+12 검증 트리거
```

---

### 3.3 4채팅 구조 (현재)

| 채팅 | 모델 | 역할 | 현재 상태 |
|---|---|---|---|
| 메인 | Opus 4.7 | 설계·머지·조율 | 컨텍스트 한계 — 새 메인으로 인수인계 |
| A | Sonnet 4.6 | 프론트 (`public/`) | feature/phase11-12-front 작업 중 |
| B | Sonnet 4.6 | 백 (`netlify/functions/`, `lib/`, `db/`) | feature/phase11-12-back 작업 중 |
| C | Opus 4.7 | 검증·fix | fix/typescript-errors 작업 중 |

**worktree 폴더:**
```
tbfa-mis        (메인) — 머지·조율 전용
../tbfa-mis-A  (A 채팅)
../tbfa-mis-B  (B 채팅)
../tbfa-mis-C  (C 채팅)
```

---

### 3.4 Swain 운영 액션 대기

| 액션 | 상태 |
|---|---|
| 카카오 알림톡 심사 후 환경변수 2개 등록 | ⏸ 대기 (ALIGO_TEMPLATE_BILLING_FAILED, ALIGO_TEMPLATE_CARD_EXPIRING) |
| SMS 실발송 확인 (결제 실패 시 알림 로그) | ⏸ Swain 직접 |

---

## 4. 즉시 해야 할 일 (새 메인)

```
1. Swain께 B·A·C 진행 상황 확인
2. 보고 온 채팅 있으면 §3.2 머지 순서대로 즉시 처리
3. 아직 없으면 대기
```

---

## 5. 핵심 정보

### 5.1 반복 사고 패턴 방지

| 날짜 | 사고 | 방지 |
|---|---|---|
| 2026-05-09 | worktree 미분리 충돌 | worktree 강제 |
| 2026-05-09 | schema 영역 덮어쓰기 | B만 schema, append-only |
| 2026-05-09 | #BUG-1 `uid` 필드명 오류 | 헬퍼 도입 직후 사용처 1회 검증 |
| 2026-05-10 | bigserial import 누락 502 | B push 전 `npx tsc --noEmit` 의무 |
| 2026-05-11 | #BUG-8 `auth.admin?.id` undefined | `auth.ctx?.admin?.uid` 직접 참조 |
| 2026-05-11 | #BUG-9 schema 컬럼 누락 (마이그 후 미반영) | 마이그 직후 schema 전수 대조 필수 |

### 5.2 마이그레이션 호출 표준

```
어드민 로그인 상태에서 주소창:
https://tbfa-siren-cms.netlify.app/api/migrate-{이름}?run=1
→ { "ok": true } 확인 후 메인에 알림
→ 메인: schema 활성화 + 마이그 파일 삭제 + push
```

### 5.3 requireAdmin 패턴 (반드시 준수)

```typescript
const auth = await requireAdmin(req);
if (!auth.ok) return auth.res;  // 'res' — 'response' 아님
const adminUid = auth.ctx?.admin?.uid;  // id 아님
```

---

## 6. Phase 진행률 스냅샷

| 묶음 | 상태 |
|---|---|
| Phase 1~3, 3-extra | ✅ 100% |
| 4·5·6순위 전체 | ✅ 100% |
| Phase 4 대표 보고 | ✅ 100% |
| Phase 5~7 재정 | ✅ 100% |
| Phase 8 알림 인프라 | ✅ 100% |
| Phase 9 외부 API | ✅ 코드 100% / 🟡 실발송 환경변수 등록 후 자동 |
| Phase 10 R1~R4 | ✅ 100% (R4: `0f98042`) |
| **Phase 11 멘션·구독** | 🟢 B·A 작업 중 |
| **Phase 12 신고 공개·익명** | 🟢 B·A 작업 중 (Phase 11과 동시) |
| TypeScript 149건 | 🟢 C 작업 중 |
| Phase 13 신고 통계 | ⏸ Phase 11+12 완료 후 |
| Phase 16 통합 분석 | ⏸ Phase 11+12 완료 후 |
| Phase 14~15·17~22 | ⏸ 카탈로그만 |

누적 약 **50%** / 약 470h+

---

## 7. 새 메인 첫 메시지 권장

```
인수인계 정독 완료.

현재 상태:
- Phase 10 R4 ✅ 100% 완료
- B: feature/phase11-12-back 작업 중 (Phase 12→11 백엔드)
- A: feature/phase11-12-front 작업 중 (Phase 12→11 프론트)
- C: fix/typescript-errors 작업 중 (149건 타입 정리)

B·A·C 진행 상황 알려주시면 즉시 이어서 처리합니다.
```
