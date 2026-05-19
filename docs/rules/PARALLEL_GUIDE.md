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

---

## 12. 자율주행 정책 (2026-05-14 정착)

A·B·C 서브 채팅은 **완전 자율주행** — 작업 흐름을 끊지 않게 push와 애매한 로직만 묻고 나머지는 자율 진행.

### 12.1 정책 표

| 카테고리 | 정책 |
|---|---|
| 파일 Read·Edit·Write | ✅ 자율 (lib/auth.ts·admin-guard.ts·hyosung-parser.ts deny 항목 제외) |
| git status·log·diff·fetch·pull·add·commit·rebase·restore·worktree | ✅ 자율 |
| bash·PowerShell 일반 명령 | ✅ 자율 |
| npm install·run | ✅ 자율 |
| **git push** | ❓ ask (push 직전 1회 확인) |
| 설계·로직 결정 (애매한 영역) | ❓ ask |
| package.json·package-lock 수정 | ❓ ask |
| npm uninstall·update, netlify, curl, Invoke-WebRequest | ❓ ask |
| force push, hard reset, rm -rf | ❌ deny |
| lib/auth.ts·admin-guard.ts·hyosung-parser.ts 수정 | ❌ deny |
| public/js/auth.js·admin-mypage-cancellation.js·admin-eligibility.js | ❌ deny |

### 12.2 적용 위치

1. **`.claude/settings.json`** — 메인 + A + B + C 4개 워크트리에 동일 배포 (`.claude/`는 gitignored이므로 직접 cp)
2. **트리거 본문** 첫 줄 박스에 명시:
   ```
   [자율주행 정책]
   - push와 애매한 로직만 묻고 나머지는 자율 진행
   - 파일 읽기·수정·git·bash·PowerShell·npm install은 묻지 말 것
   - 막히면 즉시 보고 (혼자 30분 이상 헤매지 말 것)
   ```

관련 메모리: `feedback_subchat_autonomy`.

---

## 13. 트리거 영역 라벨 (2026-05-14 정착)

A·B 둘 다에게 같은 프론트 트리거가 발송된 22-A 1단계 사고(2026-05-14) 재발 방지.

### 13.1 헤더 + 본문 첫 줄에 영역 명시

```
## §6.1 B 트리거 (feature/phase{N}-back) — 🔧 백엔드 전용
## §6.2 A 트리거 (feature/phase{N}-front) — 🎨 프론트엔드 전용
## §6.3 C 트리거 — 🔍 검증 전용
```

본문 첫 줄:
```
[메인 → B 채팅] Phase X — 🔧 백엔드 + AI 도구 (프론트 작업 ❌)

이 트리거는 백엔드 + AI 도구 작업 전용입니다.
화면·HTML·JS 작업이 포함된 트리거를 받았다면 잘못 받은 것이니 즉시 메인에 문의.
```

### 13.2 머지 전 git 원격 확인 의무

머지 보고가 와도 그대로 믿지 말고 실제 push 여부 확인:
```bash
git fetch origin --prune
git log origin/main..origin/feature/X --oneline   # 1개 이상이어야 머지 가능
```

A·B 둘 다 같은 종류 보고(예: 모두 프론트 완료)가 오면 트리거 오발송 의심.

관련 메모리: `feedback_trigger_role_labels`.

---

## 14. 진행률 % 보고 의무 (2026-05-14 정착, CLAUDE.md §6.16)

A·B·C·메인 모두 큰 단계 완료마다 진행률 % 한 줄 보고.

### 14.1 형식

```
📊 진행률 35% (3/9 완료) — 다음: API 4 작성 중
[진행률 60% ▓▓▓▓▓▓░░░░] — 카테고리 관리 3개 완료, 지출 항목 6개 진행 중
```

### 14.2 빈도·분모·분자

| 항목 | 기준 |
|---|---|
| 빈도 | 큰 단계(체크박스 1개) 완료마다 + 30분 이상 작업 시 1회 이상. **매 응답마다 ❌** |
| 분모 | 트리거 체크박스 항목 수 (예: API 9개 + AI 도구 6개 = 15개) |
| 분자 | 완료된 체크박스 수 |
| 메인 분모 | 라운드 4단계(설계·머지·검증·문서) 또는 6단계(§2 기준) |

### 14.3 트리거 본문 박스

```
[진행률 보고 의무]
- 큰 단계(체크박스 1개) 완료마다 진행률 % 한 줄 보고
- 형식: "📊 진행률 35% (3/N 완료) — 다음: ..."
- 매 응답마다 ❌ (큰 단계마다만)
```

관련 메모리: `feedback_progress_reporting`.

---

## 15. 머지 검증 의무 — 실 머지 확인 (2026-05-14 정착)

**"머지 = 응답 키 호환"이 아니라 "코드가 main 브랜치에 들어감"**.

### 15.1 사고 사례 (2026-05-14)

메인이 B 백엔드 머지 후 "A의 mock 응답 키가 B 실 API와 1:1 일치 = A는 별도 머지 불필요"로 판단. 22-C 프론트 트리거 발송. A 채팅이 git diff로 확인하다 발견: A의 `feature/phase22a-front` 가 origin/main에 미머지 상태. 사이드바·KPI 6개 등 모두 main에 없음. 22-C가 그 위에 작업하면 충돌.

### 15.2 머지 보고 후 검증 명령어

```bash
git fetch origin
git log origin/main..origin/feature/X --oneline   # 0개여야 머지 완료
git diff origin/main..origin/feature/X --stat     # 빈 결과여야 함
```

### 15.3 PROJECT_STATE 표현 규칙

- "A 자동 정렬·머지 불필요" 같은 모호한 표현 금지
- 명확히 "A `feature/X@hash` → main @ hash 머지 완료" 또는 "미머지 (이유: ...)"

관련 메모리: `feedback_merge_actual_verification`.

---

## 16. 선택적 체크아웃 머지 패턴 (2026-05-14 정착)

서브 채팅이 옛 main 베이스에서 시작했을 때 그대로 머지하면 그 사이 정리된 옛 파일(docs·삭제된 마이그)이 다시 등장. **신규 변경 파일만 선택적 체크아웃**.

### 16.1 진단

```bash
git diff main..origin/feature/X --name-status
# A = 새 파일 (가져올 것)
# M = 수정 파일 (가져올 것)
# D = 삭제 표시 (가져오면 main의 현재 파일이 사라짐 — 위험 신호)
```

D 표시가 많거나 메인이 최근 정리·삭제한 파일을 다시 가져오려 하면 → 선택적 체크아웃 강제.

### 16.2 선택적 체크아웃

```bash
git checkout origin/feature/X -- {신규/수정 파일만 1개씩 명시}
git status                # M 또는 A로만 표시되어야 함
git diff --staged --stat  # 의도한 파일만
git commit -m "merge: ..."
git push origin main
```

### 16.3 22-A 라운드 실제 사례

B의 `feature/phase22a-back @ 232bad4` 머지 시 옛 main 베이스라 docs 12개·삭제 마이그이 재등장하려 함. 선택적 체크아웃으로 신규 10개 파일만(REST API 7 + lib 3) 통합. C의 `fix/phase22a-r2-bugs` 머지 시도 옛 docs 재등장 + 이미 fix된 BUG-013 중복 — 신규 2개 파일(`admin-expense-refund.ts` + `tool_expenseRefund`) 만 체크아웃.

---

## 17. C 검증 → C 자체 fix → 메인 머지 패턴 (2026-05-14 정착)

이전: C는 검증만 → 메인이 fix → C가 재검증.
**새 패턴: C 검증 중 BUG 발견 시 C가 직접 `fix/{이름}` 브랜치 작업** → 메인은 머지만.

### 17.1 흐름

```
C 검증 라운드 R1 (verify/phase{N}-r1)
  → BUG N건 발견 + docs/issues/ 작성
  → 메인이 'C가 직접 fix' 트리거 발송
  
C fix 라운드 (fix/phase{N}-bugs)
  → BUG 5건(예) fix + 1회용 마이그(필요 시)
  → 자율 결정: BUG별 커밋 or 묶음 커밋
  → push
  
메인 머지
  → 선택적 체크아웃 (옛 main 베이스라면 §16)
  → Swain께 1회용 마이그 호출 안내 (있으면)
  → push
  
C 검증 R2 (verify/phase{N}-r2)
  → fix 검증 + 신규 BUG 발견
  → BUG 발견 시 다시 fix/phase{N}-r2-bugs
```

### 17.2 트리거 본문 예시

```
[메인 → C 채팅] Phase X BUG fix — 🔧 머지 차단 N건 (역할 전환: 검증→fix)

C 검증 라운드에서 발견한 BUG M건 중 머지 차단 N건(Critical 2 + High 3)을 
C가 직접 fix합니다. 메인은 docs/ 정리 작업 병행.

[자율주행 정책]
[진행률 보고 의무]

워크트리:
  git checkout main && git pull
  git checkout -b fix/phase{N}-bugs

(각 BUG 별 위치·방법·1회용 마이그 명시)
```

### 17.3 장점

- 라운드 처리 시간 단축 (메인이 fix 안 해도 됨)
- Opus C가 fix까지 책임 → 일관된 시각
- 메인은 정리·문서·머지에 집중

---

## 18. Subagent 병렬 활용 패턴 (2026-05-14 정착)

큰 정독·압축·다중 파일 조사는 메인이 직접 하지 말고 **general-purpose Subagent 3~5개를 병렬 launch**.

### 18.1 적합한 작업

- 폴더 단위 압축 (docs/issues/·verify/·milestones/ → archive)
- 코드베이스 광역 검색·통계
- 큰 문서 정독 + 요약
- 다중 파일 일괄 분석

### 18.2 launch 방식

```
Agent (general-purpose, run_in_background=true)
- 폴더 A 정독·압축 → docs/A-archive.md 작성

Agent (general-purpose, run_in_background=true)
- 폴더 B 정독·압축 → docs/B-archive.md 작성

Agent (general-purpose, run_in_background=true)
- 폴더 C 정독·압축 → docs/C-archive.md 작성
```

병렬 launch 후 메인은 완료 알림 받으며 다른 작업 진행.

### 18.3 22-A 라운드 실제 사례

docs/ 폴더 67개 파일(16,260줄) 압축:
- Agent 1: issues/ 13개 → issues-archive.md (147줄, 92%↓)
- Agent 2: verify/ 32개 → verify-archive.md (354줄, 92%↓)
- Agent 3: milestones/ 22개 → milestones-archive.md (496줄, 95%↓)
- 합계: 16,260줄 → 997줄 (94% 감축)

세 에이전트 동시 진행, 메인은 B 머지·BUG fix 머지 병행.

### 18.4 주의

- **Subagent에 정확한 형식 명세 전달**: "표 + 상세 + 교훈 섹션 80% 감축" 등
- **결과 파일 경로 정확히 지정**
- **완료 보고는 250자 이내로 요청** (컨텍스트 절감)
- run_in_background=true 시 자동 알림 기다림 (poll 금지)

---

## 19. 사고 사례 학습 (2026-05-14 22-A 라운드 신규)

§10 사고 사례에 누적:

### 2026-05-14 — 트리거 오발송 (A·B 둘 다 프론트)
**원인**: Swain이 A 채팅 트리거를 B 채팅에도 복붙 → B가 프론트 작업.
**영향**: B 백엔드 미생산, B 브랜치 자체가 origin에 없음. 메인이 B 머지 시도 시점에 발견.
**대응**: 트리거 헤더+본문 첫 줄 영역 라벨 명시(§13). 트리거 오발송 시 즉시 문의 안내. 메모리 `feedback_trigger_role_labels`.

### 2026-05-14 — "응답 키 호환 = 머지 불필요" 잘못된 판단
**원인**: 메인이 B 백엔드 머지 후 "A의 mock과 B 응답 키가 1:1 일치하니 A는 별도 머지 불필요"로 판단. 데이터 호환성과 코드 머지를 혼동.
**영향**: A의 사이드바·KPI 6개 등 main에 없는 상태로 22-C 트리거 발송. A 보고로 발견.
**대응**: §15 머지 검증 의무. git log origin/main..feature/X 0개 확인 의무. 메모리 `feedback_merge_actual_verification`.

### 2026-05-14 — 옛 main 베이스 브랜치 머지 시 정리된 파일 재등장
**원인**: B·C 브랜치가 옛 main 베이스에서 작업. 그 사이 메인이 docs/ 12개 정리·마이그 삭제. 그대로 머지하면 옛 파일이 모두 부활.
**영향**: docs/ 압축 작업이 두 번 무효화될 뻔.
**대응**: §16 선택적 체크아웃 패턴. `git diff --name-status` 의 D 표시 위험 신호로 인식.

### 2026-05-14 — 변수 선언 변형(let→const) tsc gate 누락
**원인**: C가 BUG-002 fix 시 `const donationRefund = 0` 선언 후 line 70에서 `donationRefund += t` 시도. 로컬 tsc gate 통과해야 했으나 누락 → Netlify 배포 빌드 실패.
**대응**: B·C push 전 `npx tsc --noEmit` 의무 통과 재강조(§7). 머지 시 빌드 fix 즉시 push 정책.

### 2026-05-14 — 같은 패턴 BUG 22-A→22-C 재발 (BUG-001→015)
**원인**: 매출 환불 누적 fix(BUG-001) 후 22-C 지출 환불에서 같은 덮어쓰기 패턴 재등장(BUG-015). 신규 라운드 설계 시 직전 issues 정독 누락.
**대응**: §14.1 CLAUDE.md "memory 정독 + docs/issues-archive 직전 라운드 BUG 패턴 정독 의무". 신규 라운드 트리거 작성 전 이 정독 단계 추가.

---

**최종 갱신**: 2026-05-14 심야 (Phase 22-A·22-C 라운드 신규 정책 6개 추가 — §12 자율주행·§13 영역 라벨·§14 진행률·§15 머지 검증·§16 선택적 체크아웃·§17 C 자체 fix·§18 Subagent 병렬·§19 사고 사례 5건)
