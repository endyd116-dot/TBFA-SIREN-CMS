# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/handover/v20.md`](handover/v20.md) 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-15 새벽 / **🎉 Phase 22-A·22-C 완전 마감** / main @ `76bf068`

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa.co.kr> (공식 메인) / <https://tbfa-siren-cms.netlify.app> (Netlify 기본)
- 베이스 브랜치: `main`
- 상세 스택·환경·구조: [`CLAUDE.md`](../CLAUDE.md) §1~5

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md 정독
2) PROJECT_STATE.md §2·§3·§5·§7 정독
3) docs/PARALLEL_GUIDE.md §1~§19 정독 (§12~§19 = 2026-05-14 신규 정책)
4) memory/MEMORY.md 인덱스 + feedback_* 메모리 본문 정독
5) 본 §3 (지금 진행 중인 일) 확인
6) C R3 진행 결과 받으면 머지 진행
```

---

## 3. 지금 진행 중인 일

### 3.0 🎉 Phase 22-A·22-C — 완전 마감 (2026-05-15 새벽)

**브랜치**: `main` @ `76bf068` (R3 8건 fix 머지 완료)
**설계서**:
- [`docs/milestones/2026-05-14-phase22a-revenue-management.md`](milestones/2026-05-14-phase22a-revenue-management.md)
- [`docs/milestones/2026-05-14-phase22c-expense-management.md`](milestones/2026-05-14-phase22c-expense-management.md)

#### 진행 흐름 요약

| 단계 | 상태 | 핵심 |
|---|---|---|
| 22-A 0단계 schema·마이그 | ✅ | revenueCategories + otherRevenues |
| 22-A 1단계 B 백엔드 (Opus 재시작) | ✅ | 7 API + AI 도구 6+1 (revenue_refund 보강) |
| 22-A 1단계 A 프론트 | ✅ | 사이드바 + KPI 6개 + admin-other-revenues |
| 22-A 코드 머지 (B → A) | ✅ | 메인 선택적 체크아웃 |
| 22-C 0단계 schema·마이그 | ✅ | expenseCategories + expenses, 마이그 호출 완료 |
| 22-C 1단계 B 백엔드 | ✅ | 9 API + AI 도구 5 + pl_summary 지출 통합 |
| 22-C 1단계 A 프론트 | ✅ | admin-expenses.html 신규 + finance-income/report 확장 |
| 22-C 코드 머지 (B → A) | ✅ | 충돌 2건 해결 (BUG-002 + 22-C 통합) |
| C 검증 R1 | ✅ | PASS / BUG 12건 발견 (Critical 2 + High 3 + Medium·Low 7) |
| C 자체 BUG fix R1 (BUG-001~005) | ✅ | 권한 시드 정정 마이그 포함 |
| revenue_refund admin UI super_admin 정정 | ✅ | Swain 수동 |
| C 검증 R2 | ✅ | PASS 23/27, BUG-013(이미 fix 됨) + BUG-015 |
| BUG-015 fix 머지 | ✅ | 지출 환불 누적 처리 (BUG-001 패턴 재발 차단) |
| docs/ 정리 (3개 archive) | ✅ | 17,746줄 → 1,500줄 (94% 감축) |
| C 검증 R3 — Medium·Low 8건 | ✅ | PASS 8/8 |
| R3 fix 머지 (BUG-006~012 + 22-C 확장) | ✅ | ensureRole 헬퍼·PUT/PATCH·키명 이중·키워드 13종·description enum·categoryCode·?all=1 |
| **🎉 Phase 22-A·22-C 완전 마감** | ✅ | 운영 가능 상태 확정 |

#### R3 완료 (8건 모두 PASS)

| BUG | fix 방식 |
|---|---|
| BUG-006 환불 권한 안전망 | `ensureRole` 헬퍼 도입 + 4구 가드 (revenue/expense approve·refund) |
| BUG-007 PUT vs PATCH | 둘 다 허용 (미래 확장 대비, 클라이언트 영향 0) |
| BUG-008 키명 일관성 | `id ?? revenueId`, `rejectionReason ?? reason` 이중 지원 |
| BUG-009 selectRelevantTools | 키워드 13종 추가 (강연·정부·기업·인건비·사업비·PL·재정 등) |
| BUG-010 도구 description enum | action·status·categoryCode enum 명시 |
| BUG-011 categoryCode 지원 | categoryId 또는 categoryCode 둘 중 하나 (LLM 사전 list 호출 절약) |
| BUG-012 ?all=1 페이지네이션 | 22-A 기본 active만, ?all=1 시 비활성 포함 |
| 22-C selectRelevantTools 확장 | BUG-009와 통합 (지출 5개 도구·키워드 8종) |

**Phase 22-A·22-C 라운드 합산**: R1 5건 + R2 2건 + R3 8건 = **BUG 15건 전부 해소. 미해결 0.**

#### 핵심 커밋 (오늘 누적)

| 커밋 | 내용 |
|---|---|
| `9604207` | 22-A schema + 마이그레이션 (0단계) |
| `9841f0a` | 22-A 마이그 호출 완료 → 파일 삭제 |
| `43196e9` | 22-C schema + 마이그 + 설계서 |
| `e266fc1` | C 검증 시드 함수 + 22-C 트리거 라벨 명확화 |
| `6063440` | 22-C 트리거 자율주행 정책 조항 |
| `0d7e5a5` | CLAUDE.md §6.16 진행률 + §6.17 자율주행 |
| `3572420` | docs/ 옛 문서 12개 정리 (DESIGN_PHASE*·HANDOFF_A/B/C 등) |
| `9d46baa` | 22-C 설계서 pl_summary 스펙 정정 |
| `791b7da` | 22-C 마이그 호출 완료 → 파일 삭제 |
| `6c71d1b` | A 22-A 프론트 실 API 교체 push (이때 main 미머지 상태) |
| `21104ef` | A 22-A 프론트 머지 (사고 fix — §15 사례) |
| `160e560` | B 22-A 백엔드 7 API + AI 도구 7개 머지 |
| `cfd4776` | C BUG-001~005 fix 머지 (R1 BUG fix) |
| `e46f69f` | B 22-C 백엔드 9 API + AI 도구 5 머지 |
| `a616772` | A 22-C 프론트 머지 |
| `ae09399` | 배포 빌드 fix (donationRefund const→let) |
| `063f451` | docs/ 폴더 단위 압축 (3개 archive + 67개 삭제) |
| `39dd203` | 22-A 권한 시드 정정 마이그 호출 후 파일 삭제 |
| `34ba615` | R2 BUG-015 지출 환불 누적 fix 머지 |
| `18cf127` | PARALLEL_GUIDE §12~§19 + HANDOFF 재작성 |
| `76bf068` | R3 8건 fix 머지 (Phase 22-A·22-C 완전 마감) |

#### 신규 정책 (오늘 정착, 향후 라운드에 자동 적용)

CLAUDE.md 추가:
- **§6.16 진행률 % 보고 의무** — 큰 단계 완료마다 "📊 진행률 X%" 한 줄
- **§6.17 A·B·C 자율주행** — push와 애매한 로직만 묻고 자율

PARALLEL_GUIDE.md 추가 (§12~§19):
- §12 자율주행 정책 (`.claude/settings.json` + 트리거 본문)
- §13 트리거 영역 라벨 (🔧🎨🔍) + git 원격 확인 의무
- §14 진행률 % 보고
- §15 머지 검증 의무 — 응답 키 호환 ≠ 실 머지
- §16 선택적 체크아웃 패턴 (옛 main 베이스 브랜치)
- §17 C 검증 → C 자체 fix → 메인 머지 패턴
- §18 Subagent 병렬 활용 (큰 압축·정독)
- §19 사고 사례 5건 (오늘 22-A 라운드 신규)

메모리 신규:
- `feedback_trigger_role_labels` — A·B·C 트리거 영역 라벨
- `feedback_subchat_autonomy` — 자율주행 정책
- `feedback_progress_reporting` — 진행률 % 보고
- `feedback_merge_actual_verification` — 실 머지 확인 의무

#### docs/ 정리 결과

| Before | After | 감축 |
|---|---|---|
| 89개 파일·17,746줄 | 12개 파일·1,500줄 | 94% |

archive 3개:
- `docs/issues-archive.md` (147줄, 13건)
- `docs/verify-archive.md` (354줄, 32건)
- `docs/milestones-archive.md` (496줄, 22건)

진행 중인 마일스톤만 `docs/milestones/`에 유지:
- `2026-05-14-phase22a-revenue-management.md`
- `2026-05-14-phase22c-expense-management.md`

---

## 4. 즉시 해야 할 일 (새 메인)

```
1. Phase 22-A·22-C 완전 마감 — 추가 작업 없음
2. Swain과 Phase 22-B (예산 편성·다단계 결재·풀세트 회계 보고서) 진행 협의
   - 22-C 설계 시 누락 발견되어 22-C로 분리됐던 지출 관리는 완료
   - 22-B는 차년도 예산 편성 + 다단계 결재 워크플로우 + 정식 회계 보고서
3. Phase 22-B 착수 시 PARALLEL_GUIDE §1~§19 그대로 적용
   (§12~§19 = 22-A·22-C 라운드에서 정착된 신규 정책)
4. 또는 Phase 18 성능 최적화 (B 진행 중) / Phase 19 자동 테스트 (미착수) 등 다른 영역
```

---

## 5. 4채팅 구조 (현재)

| 채팅 | 모델 | 역할 | 현재 상태 |
|---|---|---|---|
| 메인 | Opus 4.7 | 설계·머지·조율·문서 | Phase 22-A·22-C 마감 완료 |
| A | Sonnet 4.6 | 프론트 (`public/`) | 22-A·22-C 마감, 대기 |
| B | Opus 4.7 (22-A부터 교체) | 백 (`netlify/functions/`, `lib/`, `db/`) | 22-A·22-C 마감, 대기 |
| C | Opus 4.7 | 검증 + 자체 fix | R3 마감, 대기 |

**worktree 폴더:**
```
tbfa-mis        (메인) — 머지·조율 전용
../tbfa-mis-A  (A 채팅)
../tbfa-mis-B  (B 채팅)
../tbfa-mis-C  (C 채팅) — 현재 fix/phase22a-r3-cleanup
```

---

## 6. 핵심 정보

### 6.1 반복 사고 패턴 방지 (PARALLEL_GUIDE §10·§19 통합)

| 날짜 | 사고 | 방지 |
|---|---|---|
| 2026-05-09 | worktree 미분리 충돌 | worktree 강제 |
| 2026-05-09 | schema 영역 덮어쓰기 | B만 schema, append-only |
| 2026-05-09 | #BUG-1 `uid` 필드명 오류 | 헬퍼 도입 직후 사용처 1회 검증 |
| 2026-05-10 | bigserial import 누락 502 | B push 전 `npx tsc --noEmit` 의무 |
| 2026-05-11 | A가 PROJECT_STATE.md 자발 수정 → 머지 충돌 | A·B·C는 PROJECT_STATE·docs 수정 금지 |
| 2026-05-14 | 트리거 오발송 (A·B 둘 다 프론트) | 트리거 영역 라벨 🔧🎨🔍 + 본문 첫 줄 안내 (§13) |
| 2026-05-14 | "응답 키 호환 = 머지 불필요" 오판 | git log origin/main..feature/X 0개 확인 (§15) |
| 2026-05-14 | 옛 main 베이스 브랜치 머지 → 정리된 파일 재등장 | 선택적 체크아웃 패턴 (§16) |
| 2026-05-14 | const→let 변형 tsc gate 누락 → 배포 실패 | push 전 `npx tsc --noEmit` 재강조 |
| 2026-05-14 | 같은 패턴 BUG 22-A→22-C 재발 (BUG-001→015) | 신규 라운드 트리거 작성 전 docs/issues-archive 직전 BUG 정독 |

### 6.2 마이그레이션 호출 표준

```
어드민 로그인 상태에서 주소창:
https://tbfa.co.kr/api/migrate-{이름}?run=1
→ { "ok": true } 확인 후 메인에 알림
→ 메인: schema 활성화 + 마이그 파일 삭제 + push
```

### 6.3 requireAdmin 패턴 (반드시 준수)

```typescript
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

const auth = await requireAdmin(req);
if (guardFailed(auth)) return auth.res;  // TS2339 narrowing fix
const adminUid = auth.ctx?.admin?.uid;   // id 아님
```

### 6.4 P&L 응답 키 구조 (22-A·22-C 통합 후 표준)

```json
{
  "fiscalYear": 2026,
  "revenue": {
    "donations": { "gross": N, "refund": N, "net": N },
    "other": {
      "gross": N, "refund": N, "net": N,
      "byCategory": [{ "code": "lecture", "name": "강연·교육", "gross": N, "refund": N, "net": N }]
    },
    "totalNet": N
  },
  "expenditure": {
    "total": N, "gross": N, "refund": N,
    "byCategory": [{ "code": "personnel", "name": "인건비", "gross": N, "refund": N, "total": N }]
  },
  "netIncome": N,
  "monthly": [{ "month": 1, "revenue": N, "expenditure": N, "net": N }]
}
```

---

## 7. Phase 진행률 스냅샷

| 묶음 | 상태 |
|---|---|
| Phase 1~3, 3-extra | ✅ 100% |
| 4·5·6순위 전체 | ✅ 100% |
| Phase 4 대표 보고 | ✅ 100% |
| Phase 5~7 재정 | ✅ 100% |
| Phase 8 알림 인프라 | ✅ 100% |
| Phase 9 외부 API | ✅ 코드 100% / 🟡 실발송 환경변수 등록 후 자동 |
| Phase 10 R1~R4 | ✅ 100% |
| Phase 11·12 멘션·신고 공개 | ✅ 100% |
| Phase 13·14·15·16 | ✅ 100% |
| Phase 17 보안·감사 | ✅ 코드 머지·검증 / BUG-17-04·05 후속 권고 |
| Phase 18 성능 최적화 | 🟡 설계 완료 / B 진행 중 |
| Phase 19 자동 테스트 | ✅ 설계 / ⏸ 미착수 |
| Phase 20 어드민 UI | Phase 20-A ❌ 거부 / 20-B·20-C ✅ |
| Phase 21 워크스페이스 v3 | ✅ 100% (R1·R2+R3·R4) |
| **Phase 22-A 매출 통합 관리** | ✅ 100% (R1·R2·R3 합산 BUG 15건 해소) |
| **Phase 22-C 지출 관리** | ✅ 100% (NPO 4분류·R2 영수증·환불 누적) |
| Phase 22-B 예산·다단계 결재·풀세트 회계 | ⏸ 22-A·C 마감 완료 → Swain 협의 시점 |

누적 약 **72%** / 약 670h+

---

## 8. AI 에이전트 v3 (참고 — 종료된 시스템)

**상태**: 개발 종료(2026-05-14 새벽). main @ `9f147a5` 시점에 84개 도구로 마감.
**현재 도구 수**: 90개 (22-A 7개 + 22-C 5개 추가, 22-A 라운드에서 revenue_refund 누락 보강)
**표준 문서**: [`docs/standards/AI_AGENT_PLATFORM_STANDARD.md`](standards/AI_AGENT_PLATFORM_STANDARD.md) v1.4

자세한 내용은 메모리 `project_ai_cost_safety.md` 정독.

**원칙**: Phase 5 추가 도구는 1주 운영 후 사용 패턴 보고 결정. 임의 도구 추가 금지.

---

## 9. 새 메인 첫 메시지 권장

```
인수인계 정독 완료.

현재 상태:
- Phase 22-A 매출 통합 관리·Phase 22-C 지출 관리 ✅ 완전 마감 (main @ 76bf068)
  · R1·R2·R3 합산 BUG 15건 전부 해소, 운영 가능
- 다음: Phase 22-B (예산 편성·다단계 결재·풀세트 회계 보고서) 진행 협의
  또는 다른 영역 (Phase 18 성능·Phase 19 자동 테스트 등)

Swain께 다음 작업 방향 여쭙겠습니다.
```
