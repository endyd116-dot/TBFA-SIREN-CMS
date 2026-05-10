# PARALLEL_GUIDE.md — 병렬 작업·머지·충돌 회피 가이드

> **정적 가이드**. 병렬 작업을 새로 시작하거나 머지 충돌이 우려될 때 참조.
> 메인 채팅 시작 시 자동 정독 X (필요할 때만).
> 휘발성 상태(현재 진행률·worktree 현황)는 [`PROJECT_STATE.md`](../PROJECT_STATE.md).

---

## 1. 병렬 작업 의존성

새 병렬 작업을 분배할 때 의존성 매트릭스를 작성한다. 도메인이 독립이면 동시 시작 가능. 의존이 있으면 직렬화.

| 예시 매트릭스 | A | B | C |
|---|---|---|---|
| **A** | — | 독립 | 독립 |
| **B** | 독립 | — | 독립 |
| **C** | 독립 | 독립 | — |

→ 도메인 독립이면 머지 충돌만 §3에서 회피.

---

## 2. worktree 환경 (병렬 작업 필수)

병렬 작업은 반드시 worktree로 폴더를 분리한다.
같은 working directory를 두 채팅이 공유하면 `git checkout`이 다른 채팅의 워킹 트리에 영향.

```bash
git worktree add ../tbfa-mis-A feature/{브랜치-A} origin/main
git worktree add ../tbfa-mis-B feature/{브랜치-B} origin/main
```

| 폴더 | 브랜치 | 용도 |
|---|---|---|
| `tbfa-mis` | `main` | 메인 폴더 — 머지·조율 전용. **직접 작업 X** |
| `../tbfa-mis-A` | feature/* | 작업 A 채팅 |
| `../tbfa-mis-B` | feature/* | 작업 B 채팅 |
| `../tbfa-mis-D` 등 | feature/* | 추가 작업 시 신설 |

⚠️ 새 채팅 시작 시 **반드시 본인 worktree 폴더에서 시작**.

### 2.1 worktree 사고 사례 (2026-05-09)

같은 working directory 공유 시 `git checkout`으로 인한 HEAD 변경 발생.
**사고**: `b5167bf` → `0453071` cherry-pick 정리.
**대응**: `../tbfa-mis-{식별자}` 별도 폴더 사용.

---

## 3. 공유 파일 충돌 매트릭스

| 파일 | 위험 | 회피 전략 |
|---|---|---|
| `db/schema.ts` | 🔴 | **파일 끝**에 본인 섹션 헤더(`/* === 작업 X === */`) 추가, append-only. 다른 작업 영역 절대 손대지 말 것 |
| `public/admin.html` | 🟡 | 사이드바 `<nav>` 끝에 추가, emoji 라벨로 식별 |
| `public/admin.js` | 🟡 | 신규 모듈은 별도 `admin-{도메인}.js`로 분리, 라우터 1줄만 객체 끝에 추가 (중간 삽입 금지) |
| `public/mypage.html` | 🟡 | 탭 영역 끝에 추가 |
| `public/cms-tbfa.html` | 🟢 | 영역 분리되면 단독 |
| `netlify/functions/chat-*.ts` | 🟡 | 가드 추가 시 본인 영역만 |
| `lib/audit.ts` | 🟢 | append-only(호출만) |
| `lib/auth.ts`, `lib/admin-guard.ts` | ⛔🔴 | **변경 금지** (회귀 위험 최고) |

### 3.1 충돌 회피 7대 원칙

1. **schema.ts**: 파일 끝 append-only + 섹션 헤더 (`/* === 작업 X === */`)
2. **admin.html / mypage.html / cms-tbfa.html**: 메뉴/탭 영역 끝에 추가
3. **admin.js**: 신규 모듈은 별도 `admin-{도메인}.js`로 분리, 라우터 1줄만
4. **마이그레이션**: 함수명 prefix 강제, 호출 순서 = 머지 순서, 멱등 보장
5. **캐시버스터**: 본인 파일만 갱신, 머지 시점 일괄 검증
6. **package.json**: 가능하면 신규 dep 없이 진행, 추가 시 lock 충돌 = `npm install` 재실행
7. **lib/auth·admin-guard**: 절대 변경 금지

---

## 4. 채팅별 시작 프롬프트 — 템플릿

새 병렬 작업 채팅에 첫 메시지로 아래를 채워서 붙여넣는다.

```
[작업 {X} — {우선순위 #N}: {제목}]

PROJECT_STATE.md 와 CLAUDE.md 를 먼저 읽고 작업해줘.

## 읽어야 할 섹션
- CLAUDE.md 전체 (자동 로드)
- PROJECT_STATE.md §4.{X} (본인 작업 정의), §6.6 미해결 이슈
- docs/PARALLEL_GUIDE.md §3 (충돌 매트릭스)
- {추가로 읽을 코드 파일·라인}

## 작업 범위 (이 채팅에서만 작업)
PROJECT_STATE.md §4.{X} 의 신규/확장 파일 목록만. 다른 작업 영역 절대 건드리지 말 것.

## 금지 영역
- public/admin.html / public/mypage.html / public/admin.js / db/schema.ts: 본인 섹션 끝에만 추가
- lib/auth.ts, lib/admin-guard.ts: 변경 금지
- 다른 작업의 신규/확장 파일: 일체 손대지 말 것

## 완료 조건
1. 마이그레이션 호출 성공(사용자 ?run=1) → schema.ts 활성화 → 함수 삭제 + 커밋
2. {기능별 검증 시나리오 — 사용자가 검증 가능}
3. 사용자 검증 완료 보고
4. PROJECT_STATE.md §4.{X} 진행률 100% 갱신 + §2 마지막 업데이트 행 추가

## 갱신 의무
- 시작 시: §4.{X} 진행률 ⬜0% → 🟡 진행중
- 마일스톤마다: 다음 할 일 갱신
- 종료 시: ✅ 100% + §2 행 추가 + git push

## 브랜치 / worktree
- 브랜치: feature/{브랜치명} (베이스: origin/main)
- 폴더: ../tbfa-mis-{X} (없으면 docs/PARALLEL_GUIDE.md §2 참고하여 생성)

자, CLAUDE.md + PROJECT_STATE.md 읽고 시작 보고해줘.
```

---

## 5. 머지·검증 체크리스트 (모든 채팅 공통)

### 머지 전
- [ ] `git fetch origin && git rebase origin/main` 충돌 해결
- [ ] CLAUDE.md §13 체크리스트 통과
- [ ] 마이그레이션 호출 성공 → schema 정의 활성화 → 함수 삭제 완료
- [ ] 캐시버스터 갱신
- [ ] 로컬 동작 확인 (`npm run dev` → 핵심 시나리오)

### 머지 후
- [ ] Netlify 배포 확인 (1~2분)
- [ ] 사용자 검증 시나리오 안내
- [ ] PROJECT_STATE.md §4.{X} 진행률 100% + §2 마지막 업데이트 행 추가 후 push

### 머지 순서 권장
- 의존성 있는 작업: A → B → C 순서로 직렬
- 독립 작업: 임의 순서, 단 매 머지 직전 `git fetch origin && git merge origin/main` (또는 rebase) 후 충돌 해결
- schema.ts append-only 위반 시 즉시 push 보류 → 본인 섹션 헤더 누락 여부 검증 → 재푸시
