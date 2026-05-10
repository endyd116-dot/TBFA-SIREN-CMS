# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-11 / Phase 10 R1·R2·R3 모두 코드 100% 머지 / R4 통합 마무리 설계 완료 / #BACKFILL-1 해결 / A·B 작업량 ↑ 정책

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa-siren-cms.netlify.app>
- 베이스 브랜치: `main` (최신은 push 시점 확인)
- 상세 스택·환경·구조: [`CLAUDE.md`](../CLAUDE.md) §1~5

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독 (지금 읽고 있음)
2) PROJECT_STATE.md §1·§2·§3·§5·§7·§8 정독
3) docs/PARALLEL_GUIDE.md §1~§3 정독 (4채팅 새 구조 핵심)
4) docs/PARALLEL_TEMPLATE.md 존재 인지 (라운드 설계서 표준 양식)
5) 본 §3 (지금 진행 중인 일) + §4 (즉시 트리거 가능한 작업) 확인
6) Swain에 "어떤 작업부터 진행할지" 선택지 제시
```

---

## 3. 지금 진행 중인 일 (이전 메인 채팅 종료 시점)

### 3.1 Phase 9 외부 API 실연동 + 수신 설정 UI — 코드 100%

| 영역 | 상태 |
|---|---|
| 9-A SMS 어댑터 (Aligo) | ✅ main 머지 (`45c9e20`) — A 채팅 종료 |
| 9-B 카카오 알림톡 어댑터 (Aligo) | ✅ main 머지 — B 채팅 종료 / 카카오 심사 통과 대기 (영업일 3~5일) |
| 9-B 사용자 수신 설정 화면 | ✅ main 머지 1차 + 2차(`56f95a1`) — schema·마이그·UI 완료 |
| 9-B 어드민 전역 정책 화면 | ✅ main 머지 — `/admin-notification-defaults.html` |
| 9-A SMS 실 발송 검증 | ⏸ C 큐 Q7 대기 |
| 9-B 카카오 실 발송 검증 | ⏸ C 큐 Q8 — 심사 통과 + 환경변수 등록 후 |
| 9-B 화면 라이브 검증 | 🟢 C 큐 Q1 — **현재 C 새 세션이 처리 중일 가능성** |

**카카오 심사 통과 시 액션** (Swain):
- Netlify 환경변수 2개 추가:
  - `ALIGO_TEMPLATE_BILLING_FAILED`
  - `ALIGO_TEMPLATE_CARD_EXPIRING`
- 등록 즉시 카카오 어댑터가 placeholder → 실 발송으로 자동 전환

### 3.2 4채팅 새 구조 (2026-05-10 도입)

| 채팅 | 모델 | 역할 |
|---|---|---|
| 메인 | **Opus 4.7** | 로직·DB 설계 + 머지·조율 |
| A | Sonnet 4.6 | 프론트 구현 (`public/`) |
| B | Sonnet 4.6 | 백 구현 (`netlify/functions/`, `lib/`, `db/`) |
| C | **Opus 4.7** | 라이브 검증 + fix + 백필 |

상세: [`docs/PARALLEL_GUIDE.md`](PARALLEL_GUIDE.md) §1.

머지 순서 강제: **B → 마이그 호출 → schema 활성화 → A → C**.

### 3.3 C 대기열 큐 (PROJECT_STATE §8)

C(Opus 4.7)가 라이브 검증·fix·백필을 순서대로 처리. 8건 등록.

| # | 작업 | 선행 |
|---|---|---|
| Q1 | Phase 9-B 수신 설정 화면 라이브 검증 | 즉시 (이전 메인이 새 C 세션 트리거 메시지 발송함) |
| Q2 | #BACKFILL-1 옛 효성 결제일 7건 백필 | 즉시 |
| Q3 | 6순위 #16 단계 D 라이브 검증 | 즉시 |
| Q4 | 6순위 #8 1:1 매칭 라이브 검증 | 즉시 |
| Q5 | Phase 4 대표 보고 V1·V2·V3 라이브 검증 | 즉시 |
| Q6 | Phase 5~7 재정 라이브 검증 | 즉시 |
| Q7 | Phase 9-A SMS 실 발송 검증 | 즉시 |
| Q8 | Phase 9-B 카카오 실 발송 검증 | 카카오 심사 통과 + 환경변수 등록 |

C 새 세션은 **세션당 Q1~Q2 처리** 정도로 분할 운영. 매번 PROJECT_STATE §8에서 큐 상태 확인.

### 3.4 Phase 10 R1 — 코드 100% 머지 완료 (2026-05-11)

**설계서**: [`docs/milestones/2026-05-10-phase10-r1-template-builder.md`](milestones/2026-05-10-phase10-r1-template-builder.md)

- DB: `communication_templates` 테이블 + 시드 3건 (Swain 마이그 호출 success 확인)
- API 7개 + lib/template-render.ts (변수 치환 헬퍼)
- 화면 2개: `/admin-templates.html` + `/admin-template-edit.html` (사이드바 [📝 발송 템플릿] 메뉴)
- schema 활성화·마이그 파일 삭제 완료 (`8db8ffb`)
- A 머지 완료 (`cef0f69` 포함)
- ⏸ C Q9 라이브 검증 트리거 대기

### 3.5 Phase 10 R2 설계 완료 — B·A 트리거 대기 (2026-05-11)

**설계서**: [`docs/milestones/2026-05-11-phase10-r2-recipient-groups.md`](milestones/2026-05-11-phase10-r2-recipient-groups.md)

내용 요약:
- 통합 발송 시스템 R2 = 수신자 그룹 선택 (필터 조건 또는 수동 명단)
- 신규 테이블 1개(`recipient_groups`) + 시드 5종 + API 8개 + 화면 2개
- `lib/recipient-resolve.ts` 헬퍼 (criteria → 회원 ID, 화이트리스트 검증, 한 줄 요약)
- 필터 화이트리스트 9개 필드 × 6개 op (§2.4)
- B 5~7h / A 5~6h / C 1~2h / 평행 모드
- 4채팅 시작 프롬프트 §6에 작성 완료 (Swain 복붙용)

### 3.7 Phase 10 R3 설계 완료 — R2 머지 후 트리거 (2026-05-11, 예고 작성)

**설계서**: [`docs/milestones/2026-05-11-phase10-r3-send-queue.md`](milestones/2026-05-11-phase10-r3-send-queue.md)

내용 요약:
- 통합 발송 시스템 R3 = 발송 예약 큐 + 즉시 발송 (실 발송)
- 신규 테이블 2개(`communication_send_jobs`, `communication_send_recipients`) — 작업 메타 + 수신자 스냅샷
- API 7개 + cron 1개(1분 단위 dispatcher, chunk 50건/회 + 동시 작업 5개) + 1회용 마이그
- `lib/communication-send.ts` 헬퍼 (어댑터 직접 호출, Phase 8 이벤트 라우팅 우회)
- 화면 3개 (목록·생성·상세 폴링)
- B 7~9h / A 6~7h / C 2~3h / 평행 모드
- R2 머지 후 트리거 (R3 schema가 recipientGroups FK 의존)

### 3.6 정책 변경 (2026-05-11 도입)

- **평행 전제** — 모든 라운드 무조건 평행, 직렬 옵션 제거 (PARALLEL_GUIDE §2)
- **자동 진행 우선** — 로직·DB 마이그레이션 외 결정은 묻지 말고 판단해서 진행 (§1.5)
- **중간 진행률 % 보고** — 큰 단계 끝날 때 1회 (§1.6)

---

## 4. 즉시 트리거 가능한 작업 (새 메인이 선택)

### 옵션 A — C 큐 진행 상황 점검 + Phase 10 R1 트리거

1. C 채팅이 Q1·Q2 보고 보내왔나 Swain께 확인
2. 보고가 있으면 C 보고 흡수 + main 머지 + PROJECT_STATE 갱신
3. C에게 다음 큐(Q3) 메시지 또는 새 세션 트리거
4. Phase 10 R1 B·A 동시 트리거 (영역 분리, A는 직렬이므로 B 먼저 → 머지 후 A)
5. B 트리거 메시지: 설계서 §6.2 그대로 복붙

### 옵션 B — Phase 10 R1만 트리거 (C는 별도 진행)

1. B 채팅 새 세션 시작 + 설계서 §6.2 메시지 발송
2. 동시에 A는 mock 모드로 시작 가능 (설계서 §5.1 모드는 직렬이지만 A가 먼저 화면만 만들어둠)
3. C 큐 처리는 새 메인이 별도 트리거

### 옵션 C — Swain이 라이브 검증 직접 진행 후 결정

1. 새 메인이 Swain께 다음 안내:
   - https://tbfa-siren-cms.netlify.app/settings-notifications.html (회원 로그인)
   - https://tbfa-siren-cms.netlify.app/admin-notification-defaults.html (어드민 로그인)
2. 회원·어드민 로그인 회귀 점검 결과를 받은 후 다음 단계 결정
3. 단, C가 같은 작업을 큐 Q1로 갖고 있으므로 중복 가능성 — 새 메인이 조율

**추천**: 옵션 A. C 큐 처리와 Phase 10 R1 평행 진행이 가장 효율적. 영역이 완전 분리되어 머지 충돌 0.

---

## 5. 핵심 정보 (자주 참조)

### 5.1 환경변수 — Aligo (이미 등록됨)

- `ALIGO_API_KEY` ✅
- `ALIGO_USER_ID` ✅
- `ALIGO_SENDER` ✅ (협회 대표번호)
- `ALIGO_KAKAO_CHANNEL_ID` ✅
- `NOTIFICATION_TEST_MODE` ✅

심사 통과 후 추가:
- `ALIGO_TEMPLATE_BILLING_FAILED` ⏸
- `ALIGO_TEMPLATE_CARD_EXPIRING` ⏸

### 5.2 worktree 폴더

```
tbfa-mis      (메인) — 머지·조율 전용. 직접 작업 X.
../tbfa-mis-A         — A 채팅 (Sonnet 4.6, 프론트)
../tbfa-mis-B         — B 채팅 (Sonnet 4.6, 백)
../tbfa-mis-C         — C 채팅 (Opus 4.7, 검증·fix·백필)
../tbfa-mis-D         — 휴면 (큰 단독 라운드 시 가동)
```

### 5.3 회귀 사고 누적 (반복 방지)

| 날짜 | 사고 | 대응 |
|---|---|---|
| 2026-05-09 | 같은 working dir 공유 충돌 | worktree 강제 |
| 2026-05-09 | schema 영역 덮어쓰기 | B만 schema 작성 |
| 2026-05-09 | `requireActiveUser` uid 필드명 오류 (#BUG-1) | 헬퍼 도입 직후 사용처 1회 검증 |
| 2026-05-10 | `bigserial` import 누락 → 라이브 502 | B는 push 전 `npx tsc --noEmit` 의무 |

### 5.4 미해결 이슈 (PROJECT_STATE §6)

- #BACKFILL-1 — 옛 효성 후원 7건 결제일 NULL → C 큐 Q2

---

## 6. Phase 진행률 스냅샷 (PROJECT_STATE §5 발췌)

| 묶음 | 상태 |
|---|---|
| Phase 1~3, 3-extra | ✅ 100% |
| 4·5·6순위 (#1~#16) | ✅ 100% |
| Phase 4 대표 보고 | ✅ 코드 100% / 🟡 라이브 검증 대기 (큐 Q5) |
| Phase 5~7 재정 | ✅ 100% / 🟡 라이브 검증 대기 (큐 Q6) |
| Phase 8 알림 인프라 | ✅ 100% |
| **Phase 9 외부 API + 수신 설정** | ✅ 코드 100% / 🟡 라이브 검증·심사·#BACKFILL 대기 |
| **Phase 10 통합 발송** | 🟢 R1 설계 완료 — B·A 트리거 대기 |
| Phase 11~22 | ⏸ 카탈로그만 |

누적 약 47% / 약 450h+

---

## 7. 다음 라운드 예고 (Phase 10 이후)

PARALLEL_GUIDE 새 구조에서 Phase별 라운드 분해는 [`docs/milestones/2026-05-10-phase10-22-catalog.md`](milestones/2026-05-10-phase10-22-catalog.md) 참조.

다음 메인이 Phase 10 R1 마감 후 R2(수신자 그룹 선택) 설계 시작 → R3(발송 예약 큐) → R4(추적) → R5(AI 트리거) 순.

---

## 8. 새 메인 첫 메시지 권장

새 메인 채팅이 시작될 때 Swain에게 보낼 첫 메시지 예시:

```
인수인계 정독 완료.

현재 상태:
- Phase 9 코드 100% 머지 완료 (9-A SMS·9-B 카카오·9-B 수신 설정 UI)
- 4채팅 새 구조 도입 — 메인(Opus 4.7) / A·B(Sonnet 4.6) / C(Opus 4.7)
- C 큐 8건 등록, C 새 세션이 Q1·Q2 처리 중일 수 있음
- Phase 10 R1 설계서 작성 완료 — B·A 트리거 대기

다음 진행 옵션:
1) C Q1·Q2 보고 받은 적 있나요? 있으면 흡수해야 함
2) Phase 10 R1 B 채팅 트리거할까요? (영역 분리, C와 평행 가능)
3) 카카오 심사 통과 알림 왔나요? 왔으면 환경변수 2개 등록 안내

어디서부터 시작할까요?
```

---

**최종 정독 권장**: 본 HANDOFF + PROJECT_STATE §1~§5·§7·§8 + PARALLEL_GUIDE §1~§3.
