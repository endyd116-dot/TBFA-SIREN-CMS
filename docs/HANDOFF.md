# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/)에 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-10 / 메인 채팅

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
| Backend | Netlify Functions v2 (Node 20 / esbuild), 170+ 함수 |
| DB | Neon PostgreSQL + Drizzle ORM (postgres-js, 56+ 테이블) |
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
- ✅ 6순위 #6 (자격 변경) + #15 (CSV 자동 매핑) 코드 main 머지 — 사용자 검증 대기
- ✅ 마일스톤 #16 단계 A 완료 (메뉴 재배치)
- ✅ #BUG-1 해결 (커밋 `bb529f9`)
- 🟡 다음 본격 작업: **마일스톤 #16 단계 B** (1.5~2.5h, 단계 C·D 후속)

누적 마스터플랜 진행률 약 33% (5.5/22 Phase + 4·5순위 + 6순위 #6·#15 + #16 단계 A).

---

## 4. 진행 중 마일스톤 — #16 통합 회원·후원 회원 시스템

| 단계 | 상태 | 추정 | 핵심 |
|---|---|---:|---|
| A 메뉴 재배치 | ✅ 완료 | — | 사이드바 그룹화·이름 변경·placeholder |
| **B** 통합 일반 회원 실제 API + 회원 상세 모달 | ⬜ 미착수 | 1.5~2.5h | DEMO_* 제거 + admin-members 필터 확장 + 후원 내역 탭 → **#BUG-2 자동 해결** |
| C donor_type 컬럼 + 정기/잠재 화면 | ⬜ 미착수 | 3~4h | members 4개 컬럼 추가 + 토스 즉시 반영 + 효성 CSV 일괄 |
| D CSV 종합 검증 강화 + 자동 상태 전이 | ⬜ 미착수 | 3~5h | 효성 billings 파서 + cron-donor-status-sync |

설계서: [docs/milestones/2026-05-10-donor-system.md](milestones/2026-05-10-donor-system.md)
시작 절차: 위 설계서 §8 (worktree 생성 + 첫 메시지 복붙)

---

## 5. 알려진 이슈

| ID | 위치 | 심각도 | 상태 |
|---|---|---|---|
| **#BUG-2** | `public/js/cms-tbfa.js:60-90` (DEMO_*) | 🟠 High | 진행 예정 — 마일스톤 #16 단계 B에서 자동 해결. 임시 회피: `admin.html` 회원 관리 사용 |

[상세](issues/2026-05-10-cms-tbfa-demo-data.md)

---

## 6. 다음 작업 후보 (요약)

전체 인벤토리는 [docs/REMAINING_WORK.md](REMAINING_WORK.md). 핵심만 5개:

1. **6순위 #6 / #15 사용자 검증** — 0.5~1h, 검증만 통과하면 즉시 ✅
2. **마일스톤 #16 단계 B** — 1.5~2.5h, #BUG-2 동시 해결
3. **마일스톤 #16 단계 C·D** — 6~9h, donor_type 정착 + CSV 종합 검증
4. **6순위 #8 1:1 매칭 채팅** — 15~18h, #16 후 진행 권장
5. **TypeScript 타입 에러 149건** [신규] — 운영 영향 0이지만 자동완성·회귀 방지

Phase 4~22 (19개)는 스펙 미정 — 별도 설계 세션 필요.

---

## 7. 인프라·운영 잔여 (휘발성)

- 안전 patch/minor 의존성 갱신 4건 — aws-sdk, @types/node, resend (미결정)
- Major 의존성 갱신 7건 — netlify/blobs·functions, drizzle, typescript, zod, bcryptjs (보류 권장)
- 도메인 마이그레이션 — `tbfa.co.kr` 메인 + `yoonsiren.com` 리다이렉트 (미착수)

---

## 8. 작업 시 필독

- [CLAUDE.md](../CLAUDE.md) — 자동 로드, 코딩 컨벤션·권한·자율성 원칙(§6.10~6.12)
- [PROJECT_STATE.md](../PROJECT_STATE.md) — 휘발성 상태, 채팅·worktree·진행률
- [docs/REMAINING_WORK.md](REMAINING_WORK.md) — 잔여 작업 인벤토리
- [docs/handover/v20.md](handover/v20.md) — 이전 시점 영구 스냅샷 (자발적 안 읽음)
- [.claude/settings.json](../.claude/settings.json) — 권한 정책

---

## 9. 문서 운영 규칙

| 문서 | 갱신 빈도 | 역할 |
|---|---|---|
| `CLAUDE.md` | 정책 변경 시 | 자동 로드, 코딩 컨벤션·권한·자율성 원칙 |
| `PROJECT_STATE.md` | 매 세션 | 휘발성 상태(채팅·worktree·진행률) |
| **`docs/HANDOFF.md`** (본 문서) | **항상 단일 최신** | 한 화면 인수인계 — 새 사람·새 채팅이 처음 보는 곳 |
| `docs/REMAINING_WORK.md` | 우선순위 합의 시 재생성 | 잔여 작업 인벤토리 |
| `docs/handover/v*.md` | **마일스톤 단위 영구 스냅샷** | 자발적 안 읽음, 역사 기록 |
| `docs/milestones/*.md` | 마일스톤 신설 시 | 단일 마일스톤 설계서 |
| `docs/issues/*.md` | 이슈 발견 시 | 상세 분석 (PROJECT_STATE §6.6에 한 줄 인덱스) |

---

## 10. 최근 변경 이력 (이 문서)

| 일시 | 내용 |
|---|---|
| 2026-05-10 | 신설. 단일 최신 인수인계 도입. v20은 `docs/handover/v20.md`로 archive 역할. |
