# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/)에 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-10 / 새 메인 채팅 / Phase 4 A·B 머지 완료 — Swain V1·V2·V3 검증 대기 + 6순위 #8 검증 병행

---

## 1. 프로젝트

**SIREN(싸이렌)** 은 (사)교사유가족협의회의 통합 NPO 플랫폼이다. 후원·회원관리·유족지원·SIREN 신고(사건/괴롭힘/법률)·게시판·1:1 채팅·워크스페이스(칸반/캘린더/파일함/템플릿)·AI 비서를 한 곳에서 운영한다. 라이브: <https://tbfa-siren-cms.netlify.app>.

| 항목 | 값 |
|---|---|
| 운영 주체 | (사)교사유가족협의회 (사업자번호 1188271215) |
| 호스팅 | Netlify Pro + Functions + Blobs + Scheduled |
| 도메인 (예정) | `tbfa.co.kr` 메인 + `yoonsiren.com` 리다이렉트 |

상세는 [CLAUDE.md §1](../CLAUDE.md).

---

## 2. 기술 스택 (요약)

| 영역 | 사용 |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Toast UI Editor v3, Chart.js 4, FullCalendar 6, SheetJS, JSZip, SortableJS |
| Backend | Netlify Functions v2 (Node 20 / esbuild), 175+ 함수 |
| DB | Neon PostgreSQL + Drizzle ORM (postgres-js, 75+ 테이블) |
| 저장소 | Cloudflare R2 (Pre-signed URL + base64 인라인) |
| 결제 | 토스페이먼츠 + 효성 CMS+ + 토스 빌링 자동청구 |
| AI | Google Gemini 3-flash (cron 자동 호출) |
| 이메일 | Resend (redirect 모드) |
| Cron | Netlify Scheduled Functions (11종 운영 중) |

상세는 [CLAUDE.md §2](../CLAUDE.md).

---

## 3. 지금 어디까지 왔나

- ✅ Phase 1·2·3·3-extra 모두 가동 중 — 효성 CMS+ / 토스 빌링 / 워크스페이스 / 파일함
- ✅ 4순위·5순위 모두 완료
- ✅ 마일스톤 #16 전 단계(A·B·C·D) 검증 완료 — 통합 회원·후원 회원 시스템
- ✅ 6순위 #6 (자격 변경) + #15 (CSV 자동 매핑) 코드 main 머지
- ✅ 6순위 #8 (1:1 매칭 채팅) UX 재설계 + 버그수정 완료 (`89555cb`) — Swain 검증 대기
- ✅ UI 개선 4건 라이브 반영: 자동 허브 리다이렉트 제거 / 퀵이동 컴포넌트 / 효성 표시 버그 fix / KPI 카드
- ✅ #BUG-1·#BUG-2 모두 해결, Netlify Neon Extension 빌드 이슈 해결
- ✅ **Phase 4 대표 보고 시스템 + Agent-9 코드 100% main 안착** — Swain V1·V2·V3 검증 대기
  - 백엔드: report_snapshots DB + 통계 수집 + 보고서 API 3개 + cron-agent-9
  - A(`0d8a206`): admin-report.js + admin.html 탭 + admin.js 라우터
  - B(`5f70b7a`): 이메일 재발송 API + 인쇄 CSS (admin-report-print.css head 추가)

**누적 마스터플랜 진행률 약 45%** (6/22 Phase + 4·5순위 전체 + 6순위 #6·#8·#15·#16 + Phase 4 진행중)

---

## 4. 6순위 완료 현황

| 항목 | 코드 상태 | 검증 |
|---|---|---|
| #1 블랙 통합 | ✅ | ✅ |
| #6 교원 자격 변경 시스템 | ✅ main 머지 | 🟡 Swain 검증 대기 |
| #8 변호사·심리상담사 1:1 매칭 채팅 | ✅ 재설계+버그수정 완료 (`89555cb`) | 🟡 Swain 검증 대기 |
| #9 관련 사이트 | ✅ | ✅ |
| #10 정기후원 해지 안내 | ✅ | ✅ |
| #15 효성 + 기업은행 CSV 자동 매핑 | ✅ main 머지 | 🟡 Swain 검증 대기 |
| #16 통합 회원·후원 시스템 (A~D) | ✅ | ✅ |

### 6순위 #8 검증 시나리오 (Swain 가이드)

> ⚠️ **재설계됨 (89555cb)**: 마이페이지 신청 폼 방식 → 어드민 서비스 목록 직접 배정 방식으로 변경

**V1-A (유가족 지원 배정)** — 어드민 → 유가족지원관리 → 신청 목록 → 아직 배정 안 된 행의 "⚕️ 전문가 배정" 버튼 클릭 → 전문가(심리상담사) 선택 → 배정 → 채팅방 자동 생성 확인

**V1-B (법률 지원 배정)** — 어드민 → 법률지원관리 → 신청 목록 → 아직 배정 안 된 행의 "⚖️ 변호사 배정" 버튼 클릭 → 변호사 선택 → 배정 확인 (익명 신청은 버튼 없음)

**V1-C (1:1 매칭 관리 화면)** — 어드민 → 사이드바 "1:1 매칭 관리" 클릭 → 화면 정상 표시 확인 (이전 버그: ID 불일치로 빈 화면 → `89555cb` 수정)

**V2 (사용자 채팅 버튼)** — 마이페이지 → 신청 내역 탭(유가족지원 또는 법률지원) → 배정 완료된 건에 "💬 전문가 채팅" 버튼 표시 확인 → 버튼 클릭 → 채팅 창 열림 확인

> ⚠️ **Swain 수동 작업 필요** (설정 파일 제한으로 AI 편집 불가):  
> `public/mypage.html` 내 `mypage-applications.js?v=2026-05` → `mypage-applications.js?v=2026-05-10-chat1` 변경 후 저장

**V3 (세션 종료)** — 어드민 → 1:1 매칭 관리 → 진행중 탭 → 세션 종료 → 사용자 마이페이지 완료 탭 확인

---

## 5. ★ 새 메인 채팅이 즉시 해야 할 일

### 현재: Phase 4 코드 main 안착 — Swain 검증 대기

A·B 머지 완료. Swain V1·V2·V3 검증 진행:

**V1 (보고서 생성 + 조회)** — 어드민 → 사이드바 "📊 주간 보고서" → "보고서 생성" 버튼 → 날짜 범위 선택 → 생성 확인 → 목록에서 행 클릭 → 5개 영역 통계 + 차트 + AI 요약 표시 확인

**V2 (이메일 재발송)** — 보고서 상세 화면 → "📧 이메일 재발송" 버튼 → 발송 성공 메시지 확인

**V3 (인쇄)** — 보고서 상세 화면 → "🖨️ 인쇄" 버튼 → 인쇄 미리보기에서 사이드바·버튼 숨겨지고 보고서 본문만 A4 형식으로 표시 확인

### 병행: 6순위 #6·#8·#15 검증 (Swain 직접)
- #6 교원 자격 변경: 마이페이지 → 자격 변경 탭 → 신청 → 어드민 승인
- #8 1:1 매칭 채팅: V1-A/B/C(배정 버튼+화면) → V2(마이페이지 채팅 버튼) → V3(세션종료)
  - **먼저 Swain 수동**: `public/mypage.html`에서 `mypage-applications.js?v=2026-05` → `?v=2026-05-10-chat1`
- #15 CSV 자동 매핑: 어드민 → CSV 업로드 → 자동 매칭 → 확정

### 옵션: Phase 5 설계 (Phase 4 머지 후)

6순위 코드 작업 전체 완료. 남은 코드 작업은 Phase 4~22 (19개, 모두 스펙 미정).

| Phase | 그룹 | 예상 규모 |
|---|---|---|
| 4 | 대표 보고 시스템 + Agent-9 | 중~대 |
| 5~7 | 재정 관리 (3개) | 중 × 3 |
| 8~11 | 커뮤니케이션 — 알림톡·SMS·이메일 (4개) | 중 × 4 |
| 12~15 | SIREN 서비스 고도화 (4개) | 중~대 × 4 |
| 16~18 | 분석·경영 (3개) | 중 × 3 |
| 19~22 | 품질·안정성 (4개) | 소~중 × 4 |

→ **Swain이 어떤 Phase/묶음부터 시작할지 방향 합의 후 설계 문서 작성 + 병렬 분담 시작**

### 옵션 2: 자투리 정리 (합의 없이 진행 가능)

| 항목 | 규모 | 비고 |
|---|---|---|
| TypeScript 에러 149건 정리 | 소~중 | 운영 영향 0, 코드 품질 개선 |
| stale 이슈 문서 헤더 갱신 | 극소 | `docs/issues/2026-05-09` 1줄 |
| PROJECT_STATE admin-donation-policy 보강 | 극소 | 문서 누락 패치 |

---

## 6. 사고 기록 (핵심만)

| 날짜 | 사고 | 교훈 |
|---|---|---|
| 2026-05-09 | schema.ts 병렬 덮어쓰기 (작업 C가 A 정의 삭제) | append-only 원칙 + 섹션 헤더 |
| 2026-05-09 | requireActiveUser user.id→user.uid (#BUG-1) | 헬퍼 도입 후 전 사용처 1회 검증 |
| 2026-05-10 | 효성 CSV 흐름 역행 (검토 단계 소실) → 2회 마이그 | schema 갱신 전 DB 동기화 필수 |
| 2026-05-10 | admins 테이블 참조 오류 (SIREN은 members 통합) | REFERENCES admins → REFERENCES members |

---

## 7. 알려진 이슈

현재 미해결 이슈 0건. ~~#BUG-1~~ ✅ · ~~#BUG-2~~ ✅

---

## 8. worktree 현황

| 폴더 | 브랜치 | 상태 |
|---|---|---|
| `tbfa-mis` (메인) | `main` @ `35ff775` | 6순위 #8 재설계·버그수정(`89555cb`) + PROJECT_STATE 갱신(`35ff775`) |
| `../tbfa-mis-A` | `feature/phase4-frontend` @ `0d8a206` | ✅ 완료, main 머지됨 — 정리 가능 |
| `../tbfa-mis-B` | `feature/phase4-email-print` @ `5f70b7a` | ✅ 완료, main 머지됨 — 정리 가능 |

---

## 9. 작업 시 필독

- [CLAUDE.md](../CLAUDE.md) — 자동 로드, 코딩 컨벤션·권한·자율성 원칙(§6.10~6.12), §14 컨텍스트 관리 정책
- [PROJECT_STATE.md](../PROJECT_STATE.md) — 휘발성 상태(진행률·worktree·이슈)
- [docs/PARALLEL_GUIDE.md](PARALLEL_GUIDE.md) — 병렬 작업·머지·충돌 회피 가이드 (필요 시만)
- [docs/PAGES.md](PAGES.md) — 페이지 진입점 카탈로그
- [docs/CONTEXT_OPTIMIZATION.md](CONTEXT_OPTIMIZATION.md) — 컨텍스트 다이어트 진단·결정
- [.claude/settings.json](../.claude/settings.json) — 권한 정책

---

## 10. 최근 변경 이력 (이 문서)

| 일시 | 내용 |
|---|---|
| 2026-05-10 | **Phase 4 A·B 머지 완료** — A(`0d8a206`): admin-report.js+admin.html탭+admin.js. B(`5f70b7a`): 이메일재발송API+인쇄CSS. admin-report-print.css head 추가. Swain V1·V2·V3 검증 대기 |
| 2026-05-10 | **6순위 #8 재설계·버그수정** (`89555cb`) — 어드민 화면 ID 불일치 수정 / 서비스 목록 직접 배정 버튼(유가족·법률) / 신규 배정 API / 마이페이지 채팅 버튼 / expert_matches separate query |
| 2026-05-10 | **Phase 4 병렬 시작 + HANDOFF 현행화** — 메인 2차(`94a725c`). A(phase4-frontend) + B(phase4-email-print) 개발 중. 새 메인 채팅 대기 |
| 2026-05-10 | **6순위 #8 코드 완료** — A·B 머지(`fe84ed9`). Swain V1·V2·V3 검증 대기 |
| 2026-05-10 | **Phase 3 검증 완료 + 후속 개선 4건 + Netlify 빌드 복구** |
| 2026-05-10 | **효성 CSV 흐름 복원 + DB 정합성 2회 마이그** |
| 2026-05-10 | **Phase 1·2 완료** — 단계 B·C 머지·검증 통과 |
