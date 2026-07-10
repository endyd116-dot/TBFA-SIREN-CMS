# A 채팅 시작 트리거 — 전 페이지 이모지 → SVG 아이콘 전환

> 2026-07-11 Swain 지시 · 아래 블록을 **tbfa-mis-A 워크트리의 A 채팅**에 그대로 붙여넣으세요.
> Swain 확정 결정: 범위=가능한 모두 / 방식=공용 아이콘 시스템 / 세트=Lucide.

---

너는 **A 작업자**다. 영역 = **전 페이지 이모지 → SVG 아이콘 전환**. 워크트리 `tbfa-mis-A`에서 작업한다.

## 자율주행 정책 (CLAUDE.md §6.17)
- **자율(allow)**: Read·Edit·Write 모든 `public/` 파일, git status/log/diff/add/**commit**/rebase, node --check, 일반 bash/PowerShell.
- **금지(deny)**: `git push`(메인 단독), force push, hard reset, `netlify/functions/**`·`lib/**`·`db/**` 수정(**서버 텍스트 이모지는 메인이 처리** — 건드리지 말 것), lib/auth.ts·admin-guard.ts 등.
- **묻기(ask)**: 설계 변경, `package.json` 수정, npm 설치, 아이콘 세트 교체.
- **완료 보고**: 끝나면 브랜치·커밋 해시·처리 파일수·남은 영역을 메인에 전달 → 메인이 머지·push.

## 베이스
- 로컬 `main` 최신(워크트리 공유)에서 분기: `git worktree`는 이미 있음. `feature/emoji-to-svg` 브랜치 생성 후 작업.
- ⚠️ 메인이 동시에 일부 `public/js/workspace-*.js`를 audit 수정 중 → **너는 public/ 이모지만**, 충돌 시 메인이 머지한다. workspace-*.js도 이모지 전환은 진행하되, onclick·기능 로직은 절대 건드리지 말 것.

## Swain 확정 사항 (그대로 반영)
1. **범위 = 가능한 모두**: ① 화면 UI 이모지(버튼·헤더·카드·탭·네비·패널 등) → SVG 아이콘. ② 알림·토스트·alert·confirm·JS 렌더 **텍스트의 이모지도 제거**하고 문구를 자연스럽게 정리(텍스트엔 SVG 안 넣음 — 이모지만 빼고 말끔히).
2. **방식 = 공용 아이콘 시스템**: `public/js/icons.js` 단일 출처. 라이브러리·CDN 없이 **인라인 SVG**.
3. **세트 = Lucide** (MIT). 경로만 인라인 복사(외부 요청 0). 24×24·`stroke="currentColor"`·`fill="none"` 기본.

## 규모 (사전 파악)
- 이모지 약 **6,149곳 · 225개 파일 · 241종**(public 기준). 한 번에 쓸지 말고 **아래 단계**를 지켜라.

## 작업 체크박스

### Phase 0 — 아이콘 시스템 구축 (기반, 먼저)
- [ ] `public/js/icons.js` 생성: 전역 `Icons` 객체.
  - [ ] `SIREN_ICONS = { name: '<svg …><path …/></svg>', … }` — Lucide 경로 인라인. `width/height` 없이 viewBox만(크기는 CSS). `class="siren-icon"` 부여.
  - [ ] `Icons.svg(name, opts)` — 이름으로 SVG 문자열 반환(JS 렌더용). 없는 이름은 콘솔 경고 + 빈 문자열.
  - [ ] `DOMContentLoaded`에 `document.querySelectorAll('[data-icon]')` 일괄 하이드레이션(`el.innerHTML = Icons.svg(el.dataset.icon)`), `data-icon-done` 가드로 중복 방지.
  - [ ] 접근성: 의미 있는 아이콘은 `aria-label`(data-icon-label 속성) 부여, 순수 장식은 `aria-hidden="true"`.
- [ ] `public/css/`에 `.siren-icon` 기본 스타일(1em 크기·수직정렬·currentColor). 기존 이모지 크기감과 맞춤.
- [ ] **241종 이모지 → 아이콘 매핑표** 작성(`docs/active/emoji-icon-map.md`): 각 이모지 → Lucide 이름(또는 "제거"/"근접:xxx"). 대응 없으면 근접 아이콘 또는 텍스트 제거 판단.
- [ ] `icons.js`를 **전 HTML에 포함**: `<script src="/js/icons.js?v=1"></script>`를 다른 스크립트보다 먼저. partials(header/footer) 쓰는 페이지는 partial에, 독립 페이지는 직접.

### Phase 1 — 샘플 검증 (확산 전 승인) ⚠️
- [ ] 대표 페이지 **2개 완전 전환**: ① 사용자측 `index.html`(또는 대표 공개페이지) ② 백오피스 `workspace.html`.
- [ ] 정적 이모지 → `<i data-icon="…" aria-hidden="true"></i>` (또는 라벨). JS 렌더 이모지 → `${Icons.svg('…')}`. 텍스트 이모지 → 제거+문구정리.
- [ ] 커밋 후 **메인에 리뷰 요청** — 6천여 곳 확산 전에 접근·아이콘 톤·크기 승인받기. (여기서 멈추고 보고)

### Phase 2~N — 영역별 확산 (승인 후)
- [ ] **사용자 공개 페이지** 전체(donate·campaign·report-*·memorial 등)
- [ ] **어드민 통합 CMS**(cms-tbfa.html + admin-*.html 조각)
- [ ] **워크스페이스·백오피스**(workspace-*.html/js, admin-workspace-*)
- [ ] **partials·공통 모듈**(header/footer/modals, 공용 js)
- [ ] 각 영역 = 1커밋(또는 2~3커밋). 커밋 메시지에 처리 파일·이모지 수.

### 마무리
- [ ] 변경한 모든 JS의 **캐시버스터 `?v=` 갱신**(참조 HTML 전부). icons.js 포함.
- [ ] 잔여 이모지 재스캔(0 목표, 못 바꾼 건 매핑표에 사유). `git grep -nP` 대신 node 스크립트로 유니코드 스캔.
- [ ] node --check 전 JS 통과.

## 규칙
- **기능 보존 최우선**: 이모지가 버튼 식별·상태 표시(예: 🔴긴급, ✅완료)에 쓰이면 **같은 의미 아이콘**으로. onclick·data-*·로직 절대 변경 금지.
- 답변·주석·문구 한국어(CLAUDE.md §6.13). 진행률 % 가끔 보고(§6.16).
- 매 Phase 끝 커밋. push는 하지 않는다(메인이 머지).

Phase 0 → Phase 1까지 하고 **메인 리뷰 요청**으로 일단 멈춰라.

---
