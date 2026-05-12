# PARALLEL_GUIDE.md — 4채팅 병렬 작업 가이드

> **정적 가이드**. 새 라운드 시작 시 메인이 정독.
> 휘발성 상태(현재 진행률·worktree 현황·C 대기열)는 [`PROJECT_STATE.md`](../PROJECT_STATE.md).
> 라운드 설계서 빈 양식: [`PARALLEL_TEMPLATE.md`](PARALLEL_TEMPLATE.md).

> 적용 시점: **2026-05-10** (Phase 9 마무리 직후 도입). 이전 3-way 정책은 history 참고.

---

## 1. 4채팅 역할·모델 분배

| 채팅 | 모델 | 역할 | 변경 가능 영역 | 절대 금지 영역 |
|---|---|---|---|---|
| **메인** | Opus 4.7 | 로직·DB 설계 + 머지·조율 | `docs/milestones/`, `PROJECT_STATE.md`, 머지 커밋 | 코드 직접 작성 (설계만) |
| **A** | Sonnet 4.6 | 프론트 구현 | `public/**` (HTML·CSS·JS), `assets/**` | `lib/`, `netlify/functions/`, `db/`, `drizzle/` |
| **B** | Sonnet 4.6 | 백 구현 | `netlify/functions/`, `lib/`, `db/schema.ts`, `drizzle/`, `.env.example` | `public/`, `assets/` |
| **C** | Opus 4.7 | 라이브 검증 + fix + 백필 | 모든 영역 (단 fix·백필·검증 보고서 한정) | 신규 기능 추가 |

### 핵심 원칙

1. **메인이 설계를 못박는다** — Sonnet이 헤매지 않도록 라운드 설계서에 모든 결정을 미리 적는다 (DB·API·화면·검증 시나리오).
2. **A·B는 평행 가능, 영역이 폴더 단위로 분리** — 머지 충돌 거의 0.
3. **C는 항상 마지막** — 라이브 검증·회귀 점검·bug fix·1회용 백필 마이그.
4. **D는 휴면** — 큰 단독 작업(Phase 19 자동 테스트 등) 발생 시에만 임시 가동.
5. **자동 진행 우선 (2026-05-10 Swain 추가)** — 로직·DB 마이그레이션 같은 정말 중요한 결정 외에는 묻지 말고 판단해서 진행. Bash·PowerShell 명령은 의미 추론 가능하면 그대로 실행. 작업이 완전히 막혀 사용자 결정이 필요한 시점에만 질문.
6. **중간 진행률 보고 (2026-05-10 Swain 추가)** — 작업 중 한 번씩 "현재 X% 완료" 형식으로 진행률 알림. 작업 단계가 명시된 경우 단계 기준(예: "4/6 단계 완료 = 67%"), 아니면 시간·작업량 기준 추정. 매 큰 단계 끝날 때 1회.
7. **설계 모호성 즉시 질문 (2026-05-11 Swain 추가)** — 라운드 설계서 작성 중 로직·기능에 모호한 부분(예: "사용자 수신 동의를 어디까지 존중할지", "그룹이 비어있으면 등록 거부할지 빈 발송으로 둘지", "취소 시 이미 보낸 수신자 어떻게 처리할지" 등)이 있으면 **추측해서 결정하지 말고 즉시 Swain에게 선택지로 질문**. 질문 형식: 함수명·코드 용어 X, 로직·기능·사용자 시나리오 위주. 예) "발송 진행 중 운영자가 취소를 누르면 (1)이미 발송된 사람은 그대로·미발송분만 취소 (2)전체 작업 즉시 멈춤·대기열 0건 처리 (3)운영자에게 어느 정도 진행됐는지 보여주고 다시 확인 — 어느 안이 맞나요?". 모호한 부분 그대로 진행 시 사용자 의도와 어긋난 코드를 만들고 라운드 마감 후에야 발견되어 재작업 발생.

---

## 2. 표준 라운드 6단계

한 Phase는 4~5개 기능 라운드로 쪼개고, 매 라운드는 같은 6단계를 반복.

```
[0] 메인 설계 (Opus 4.7, 1~3h)
       ↓ 설계서 작성 (§2.2 응답 구조·§3 화면 명세 정확히)
[1+2] B 백 + A 프론트 동시 시작 (Sonnet 4.6 각각 2~6h, 평행)
       ↓ 각자 push
[3] 메인 머지 (Opus 4.7)
       B 머지 → Swain 마이그 호출 → schema 활성화·마이그 파일 삭제 → A 머지
       ↓
[4] C 검증·fix (Opus 4.7, 1~3h)
       ↓ 보고서 + 필요 시 fix push
[5] 메인 라운드 마감 (Opus 4.7)
       PROJECT_STATE 갱신 → 다음 라운드 0단계로
```

### A·B 평행 전제 (Swain 정책 — 2026-05-10)

**모든 라운드는 무조건 평행 진행**. 직렬 모드 선택지 없음.

전제 조건:
- 메인 설계서가 §2.2 응답 구조·필드명·§3 화면 명세를 정확히 못박는다 → A가 mock 없이 명세대로 바로 작성
- 영역 폴더 단위 분리(A=`public/`, B=`netlify/functions·lib·db·drizzle`) → 머지 충돌 0
- A의 라이브 동작 검증은 B 머지·schema 활성화 후 (코드 작성 자체는 평행 가능)

라운드 규모별 머지 흐름:

| 라운드 규모 | 머지 흐름 |
|---|---|
| 작은 라운드 (B 4h 미만) | A·B 동시 push → 1회 머지 사이클 |
| 중간 라운드 (4~8h) | A·B 동시 push → 1회 머지 사이클 |
| 큰 라운드 (8h+) | A·B 동시 진행, B는 단계 머지(스키마 → API) — A는 명세 변경 영향 점검 |

설계서 §5.1에 모드 칸은 유지하되 항상 "평행"으로 체크.

---

## 3. 영역 분담 표 (충돌 회피)

A·B 영역이 폴더 단위로 분리되므로 이전의 복잡한 매트릭스가 필요 없음.

| 폴더·파일 | A 가능 | B 가능 | C 가능 (fix) |
|---|---|---|---|
| `public/**` | ✅ | ❌ | ✅ |
| `assets/**` | ✅ | ❌ | ✅ |
| `netlify/functions/**` | ❌ | ✅ | ✅ |
| `lib/**` | ❌ | ✅ | ✅ |
| `db/schema.ts` | ❌ | ✅ | ✅ |
| `drizzle/**` | ❌ | ✅ | ✅ |
| `package.json`, `package-lock.json` | ❌ | ✅ | ✅ |
| `.env.example` | ❌ | ✅ | ✅ |
| `PROJECT_STATE.md`, `docs/HANDOFF.md` | ❌ **절대 금지** | ❌ **절대 금지** | ✅ (보고서만) |
| `docs/**` (그 외) | ❌ | ❌ | ✅ |

> **A·B가 PROJECT_STATE.md / HANDOFF.md를 수정하면 반드시 머지 충돌 발생** — 메인이 B 머지 기록을 먼저 쓰고, A가 이전 베이스로 덮어쓰기 때문. 상태 기록은 push 후 메인에 보고 텍스트로 전달하는 것으로 충분. (2026-05-11 사고 사례: A가 자발적으로 PROJECT_STATE.md 갱신 → 메인 머지 2회 충돌)

### 회귀 위험 영역 (B·C 모두 주의)

- `lib/auth.ts`, `lib/admin-guard.ts` — **수정 금지** (회귀 사고 최다)
- `db/schema.ts` import 라인 — 새 컬럼 타입 추가 시 import 누락 점검 (2026-05-10 `bigserial` 사고)
- 마이그레이션 파일 — 1회용. Swain 호출 성공 후 즉시 삭제 + 커밋.

---

## 4. worktree 정책

병렬 작업은 반드시 worktree로 폴더 분리. 같은 working directory를 두 채팅이 공유하면 `git checkout`이 다른 채팅 워킹 트리에 영향(2026-05-09 사고 사례).

```bash
git worktree add ../tbfa-mis-A feature/{branch-A} origin/main
git worktree add ../tbfa-mis-B feature/{branch-B} origin/main
git worktree add ../tbfa-mis-C verify/{branch-C}  origin/main
```

| 폴더 | 채팅 | 브랜치 명명 |
|---|---|---|
| `tbfa-mis` | 메인 | `main` (직접 작업 X — 머지·조율만) |
| `../tbfa-mis-A` | A | `feature/phase{N}-r{M}-front` |
| `../tbfa-mis-B` | B | `feature/phase{N}-r{M}-back` |
| `../tbfa-mis-C` | C | `verify/phase{N}-r{M}` 또는 `fix/{이름}` |

새 채팅 시작 시 **반드시 본인 worktree 폴더에서 시작**.

---

## 5. 머지 순서 (강제)

```
B 백 머지 → Swain 마이그 호출 → schema 활성화·마이그 파일 삭제 → A 프론트 머지 → C 검증 → C fix(있으면) 머지
```

> **B 머지 전 필수 대조**: B 응답 키와 A mock 키가 일치하는지 확인 후 머지.
> 설계서 §2.2 응답 구조 ↔ §5.4 mock JSON 키명이 1:1 일치해야 A mock → 실 API 교체 시 코드 변경 없음.
> 불일치 발견 시 B 브랜치에 수정 커밋 추가 후 머지. (2026-05-11 사고: B가 독자 키명 사용 → 머지 후 메인이 응답부 수정 필요)

이 순서를 어기면:
- A 먼저 머지: 프론트가 호출할 백이 없음 → 라이브 깨짐
- 마이그 전 schema 활성화: drizzle SELECT 깨짐 → 어드민 로그인 불가 등 광범위 회귀
- C 먼저 검증: 검증할 코드가 없음

### 마이그 호출 흐름 (Swain 액션 포함)

```
1. B push
2. 메인이 B 브랜치 → main 머지 → push
3. Netlify 자동 배포 (1~3분)
4. 메인이 Swain께 마이그 URL 안내: /api/migrate-{이름}?run=1
5. Swain 어드민 로그인 후 주소창 입력
6. {"ok":true,...} 응답 확인 → 메인에 보고
7. 메인 또는 C가 schema 정의 활성화 + 마이그 파일 삭제 → push
8. A 머지 가능
```

---

## 6. 4채팅 시작 프롬프트 (라운드 설계서 §6에 자동 포함)

매 라운드 메인이 설계서를 작성하면 §6에 4종 프롬프트가 자동으로 채워진다. Swain은 복붙만.

표준 양식은 [`PARALLEL_TEMPLATE.md`](PARALLEL_TEMPLATE.md) §6 참고.

---

## 7. 검증 책임 분배

### B·A의 자체 검증 (push 전)

| 채팅 | 자체 검증 항목 |
|---|---|
| **B** | `npx tsc --noEmit` 통과 / curl 또는 단위 테스트로 API 동작 확인 / schema import 누락 점검 |
| **A** | 화면 진입·버튼·폼 제출 흐름 동작 / 캐시버스터 갱신 / 콘솔 에러 0 |

### C의 라이브 검증 (대행)

이전엔 Swain이 라이브 클릭 검증. 새 구조에서는 **C가 Opus 4.7로 라이브 검증 대행**.

C 검증 시나리오:
1. 라운드 설계서 §4 Q1~Qn 시나리오 라이브 실행
2. 회귀 점검 — 어드민 로그인·기존 화면·핵심 흐름 깨짐 여부
3. bug 발견 시 fix 커밋 (verify 브랜치 그대로) → 메인 보고 → 머지
4. 백필 필요 시 1회용 마이그 작성·Swain 호출·삭제
5. 보고서 `docs/verify/{날짜}-phase{N}-r{M}.md`

### Swain 검증 (외부 시스템 한정)

다음만 Swain이 직접:
- 외부 API 실 발송 (SMS·카카오 알림톡 수신 확인)
- 결제 PG 라이브 흐름
- 외부 콘솔 작업 (Netlify 환경변수·DB 백업)

---

## 8. C 대기열 (Live-Verify Queue)

C가 라이브 검증·백필 대기 중인 작업 목록은 [`PROJECT_STATE.md §9`](../PROJECT_STATE.md)에서 관리. C는 매 세션 시작 시 큐에서 가장 위 항목 1건을 처리.

큐 우선순위 정책:
1. 머지된 코드의 라이브 검증 (선입선출)
2. 발견된 bug fix
3. 백필·1회용 마이그
4. 외부 시스템 검증 대행 (SMS·알림톡 등 환경변수 등록 후)

---

## 9. 머지·검증 체크리스트 (메인용)

### B 머지 전
- [ ] B 브랜치 `npx tsc --noEmit` 통과 보고 받음
- [ ] `git fetch origin` 후 conflict 없음 확인
- [ ] schema.ts import 라인 점검 (사용 타입 모두 import)
- [ ] 마이그 파일 1회용 정책(GET ?run=1·requireAdmin·멱등) 확인

### B 머지 후 (마이그 흐름)
- [ ] Netlify 배포 1~3분 대기
- [ ] Swain께 마이그 URL 안내
- [ ] 응답 success 확인 후 schema 활성화·마이그 파일 삭제 push

### A 머지 전
- [ ] A 브랜치 화면 진입 동작 보고 받음
- [ ] 캐시버스터 갱신 확인
- [ ] B와 영역 충돌 0 확인 (`git diff main...A -- lib db netlify` = empty)

### C 트리거
- [ ] 라운드 설계서 §4 검증 시나리오 그대로 전달
- [ ] 회귀 점검 영역 명시
- [ ] 백필 필요 여부 명시

### 라운드 마감
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 마일스톤 진행률 갱신
- [ ] 다음 라운드 설계 또는 다음 Phase 진입

---

## 10. 사고 사례 학습

### 2026-05-09 — 같은 working directory 공유 충돌
**원인**: 두 채팅이 같은 폴더 사용. `git checkout`이 다른 채팅 워킹 트리 변경.
**대응**: worktree 폴더 분리 강제 (§4).

### 2026-05-09 — schema 영역 덮어쓰기
**원인**: C가 자기 섹션 추가하면서 다른 작업 정의 함께 삭제.
**대응**: B만 schema 작성. C는 fix 시에만 예외(파일 끝 헤더 명시).

### 2026-05-09 — `requireActiveUser` uid 필드명 오류 (#BUG-1)
**원인**: 헬퍼 도입 후 9개 사용처 1회 검증 누락.
**대응**: 헬퍼 도입 직후 모든 사용처 1회 검증 의무화.

### 2026-05-10 — `bigserial` import 누락
**원인**: schema.ts에 신규 타입 사용하면서 상단 import 라인 갱신 누락 → 함수 임포트 시점에 깨짐 → 라이브 광범위 502.
**대응**: B는 push 전 `npx tsc --noEmit` 의무 통과.

---

---

## 11. 배포 흐름 — dev → main 2단계 규칙 (2026-05-12 도입)

`tbfa.co.kr` 도메인이 운영에 연결된 이후부터 **main 직접 머지 금지**.

```
feature/xxx (A·B·C 작업) → dev (테스트 서버 검증) → main (운영 자동 배포)
```

- **dev 테스트 서버**: `dev--tbfa-siren-cms.netlify.app`
- **운영**: `tbfa.co.kr` (main 브랜치)

**머지 순서 변경:**
- 기존: B→A→C fix → **main** 머지
- 변경: B→A→C fix → **dev** 머지 → Swain 검증 → **main** 머지

**바뀌지 않는 것:**
- 로컬 작업 폴더 (`tbfa-mis`, `tbfa-mis-A`, `tbfa-mis-B`, `tbfa-mis-C`)
- worktree 병렬 구조
- A·B·C 브랜치 명명 규칙

**최종 갱신**: 2026-05-12 (dev→main 2단계 배포 규칙 추가)
