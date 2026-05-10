# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-11 / Phase 11+12 B+A 머지 완료 / C 검증 대기 / Phase 13 라운드 병행 작업 추가 예정

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa-siren-cms.netlify.app>
- 베이스 브랜치: `main` (최신 커밋 `bc43cd3`)
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

### 3.1 Phase 11+12 — B+A 머지 완료, C 검증 대기

**상태**: B(`feature/phase11-12-back`) + A(`feature/phase11-12-front`) 모두 main 머지 완료 (`bc43cd3`).

- C 채팅이 현재 `fix/typescript-errors` (TS 149건 정리) 작업 중
- C 완료 보고 오면 → Phase 11+12 검증 트리거로 전환

**주의 — API 경로 불일치 이미 수정 완료**:
A가 사용하는 경로와 B 구현 경로가 달랐던 문제를 메인이 직접 수정 후 머지. 아래가 실제 연결된 경로:

| A 호출 | B 실제 경로 |
|---|---|
| `/api/user-post-subscriptions` | `user-post-subscriptions.ts` |
| `/api/user-post-subscribe` | `user-post-subscribe.ts` |
| `/api/user-mentions` (알림 탭) | `user-mentions.ts` |
| `/api/user-mention-read` | `user-mention-read.ts` |
| `/api/user-my-reports?type=X` | `user-my-reports.ts` |
| `/api/admin-report-list-by-status` | `admin-report-list-by-status.ts` |
| `/api/admin-anonymous-reveal` | `admin-anonymous-reveal.ts` |
| `/api/admin-anonymous-reveal-logs` | `admin-anonymous-reveal-logs.ts` |

### 3.2 Phase 13 + 병행 작업 — 다음 라운드 (설계 진행 중)

**배경**: Phase 13(신고 통계 대시보드)만 하면 B는 API 1개·A는 SPA 섹션 1개라 작업량이 너무 작아 대기 시간이 길어짐. 병행 작업을 추가해야 함.

**새 메인이 해야 할 일**: Phase 13과 병행할 작업을 선정·설계 후 B·A 트리거 발송.

병행 후보 (작업량 관점):
- **Phase 16 일부** — 통합 분석 대시보드 중 이탈 위험 회원 목록 + KPI 위젯 (B: 집계 API 2~3개 / A: 대시보드 섹션)
- **6순위 #6 자격 변경 사용자 검증 화면 보강** — 마이페이지 자격변경 신청·진행 상태 화면 (A만, B 불필요)
- **mypage.html 접근 차단 해제** — A 보고에서 deny 목록 확인됨, settings.json 정책 검토 필요

**설계서 위치**: [docs/milestones/2026-05-11-phase13-incident-stats.md](docs/milestones/2026-05-11-phase13-incident-stats.md) (Phase 13 단독분)

### 3.3 충돌 재발 방지 정책 (2026-05-11 적용)

**A·B 채팅은 `PROJECT_STATE.md`, `docs/HANDOFF.md`, `docs/` 수정 절대 금지.**
원인: A가 자발적으로 PROJECT_STATE.md 갱신 → 메인 머지 2회 충돌.
트리거 프롬프트 `금지:` 항목에 명시 완료 (PARALLEL_TEMPLATE.md §6.2·§6.3, PARALLEL_GUIDE.md §3).

### 3.4 4채팅 구조 (현재)

| 채팅 | 모델 | 역할 | 현재 상태 |
|---|---|---|---|
| 메인 | Opus 4.7 | 설계·머지·조율 | 컨텍스트 한계 — 새 메인으로 인수인계 |
| A | Sonnet 4.6 | 프론트 (`public/`) | Phase 11+12 완료, 대기 중 |
| B | Sonnet 4.6 | 백 (`netlify/functions/`, `lib/`, `db/`) | Phase 11+12 완료, 대기 중 |
| C | Opus 4.7 | 검증·fix | `fix/typescript-errors` 작업 중 |

**worktree 폴더:**
```
tbfa-mis        (메인) — 머지·조율 전용
../tbfa-mis-A  (A 채팅)
../tbfa-mis-B  (B 채팅)
../tbfa-mis-C  (C 채팅)
```

---

### 3.5 머지 순서 (Phase 11+12 C 검증 후)

```
1. C fix/typescript-errors 완료 보고
   → 메인 머지 → push

2. C에게 Phase 11+12 검증 트리거
   브랜치: verify/phase11-12 (베이스 main 최신)
   설계서: docs/HANDOFF.md §3.1 API 경로 표 참고

3. C 검증 PASS → Phase 11+12 마감
   → Phase 13 + 병행 작업 B·A 동시 트리거
```

---

## 4. 즉시 해야 할 일 (새 메인)

```
1. Swain께 C 진행 상황 확인 (TS 정리 완료 여부)
2. Phase 13 병행 작업 선정·설계 (Swain과 합의)
3. C 완료 보고 오면 머지 → Phase 11+12 검증 트리거
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
| 2026-05-11 | A가 PROJECT_STATE.md 자발 수정 → 머지 2회 충돌 | A·B 트리거 프롬프트 `금지:` 항목에 명시 |

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
| Phase 10 R1~R4 | ✅ 100% |
| **Phase 11 멘션·구독** | 🟢 B+A 머지 완료 / ⏸ C 검증 대기 |
| **Phase 12 신고 공개·익명** | 🟢 B+A 머지 완료 / ⏸ C 검증 대기 |
| TypeScript 149건 | 🟢 C 작업 중 (`fix/typescript-errors`) |
| **Phase 13 신고 통계** | ✅ 설계서 완료 / ⏸ 병행 작업 추가 후 B·A 트리거 |
| Phase 14~22 | ⏸ 카탈로그만 |

누적 약 **52%** / 약 490h+

---

## 7. 새 메인 첫 메시지 권장

```
인수인계 정독 완료.

현재 상태:
- Phase 11+12: B+A 머지 완료, C 검증 대기
- C: fix/typescript-errors 작업 중
- Phase 13: 설계서 완료, 병행 작업 추가 필요

B·A·C 진행 상황 알려주시면 즉시 이어서 처리합니다.
```
