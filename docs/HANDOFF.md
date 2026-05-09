# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/)에 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-10 / 메인 채팅 / Phase 3 코드 완료 + D1·D2 버그 수정 — Swain V1·V2·V3 검증 대기

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
- ✅ 6순위 #6 (자격 변경) + #15 (CSV 자동 매핑) 코드 main 머지
- ✅ 마일스톤 #16 단계 A·B·C 완료
- 🟡 **마일스톤 #16 단계 D — 코드 100% 완료, Swain V1·V2·V3 검증 대기** (커밋 `89d3547`)
  - M1·M2 라이브러리 완료 (효성 양식 매핑 + 흡수 정책)
  - B 채팅 백엔드 머지 완료 (D1~D7 백엔드)
  - A 채팅 프론트 머지 완료 (D3·D4·D7 프론트)
  - **D1·D2 핵심 버그 수정 완료** (커밋 `89d3547`) — 효성 파일 업로드가 효성 전용 저장소에 직접 적재되도록 수정
- ✅ #BUG-1·#BUG-2 모두 해결

누적 마스터플랜 진행률 약 36% (5.5/22 Phase + 4·5순위 + 6순위 #6·#15 + #16 단계 A·B·C).

---

## 4. 진행 중 마일스톤 — #16 통합 회원·후원 회원 시스템

| 단계 | 상태 | 핵심 |
|---|---|---|
| A 메뉴 재배치 | ✅ 완료 | 사이드바 그룹화·이름 변경·placeholder |
| B 통합 일반 회원 + 상세 모달 | ✅ 완료 | 가짜 회원 제거 + 진짜 명단 + 상세 모달. #BUG-2 해소. tag `phase1-complete-20260510` |
| C 후원 회원 분류 정착 | ✅ 완료 | 분류 칸 4개 + 자동 갱신 후크 4건 + 정기/잠재 화면. tag `phase2-complete-20260510` |
| **D 효성 SOT 정합성 + 토스 자동 매핑 + 검증 대시보드** | 🟡 **코드 완료 — 검증 대기** | 효성 계약정보·수납내역 → 효성 전용 저장소 직접 적재 + 회원 자동 연결. 통합 회원·정기 후원자 화면에 효성 컬럼 표시. 종합 검증 대시보드 |

설계서: [docs/DESIGN_PHASE3.md](DESIGN_PHASE3.md) + [docs/milestones/2026-05-10-donor-system.md](milestones/2026-05-10-donor-system.md)

---

## 5. ★ 새 메인 채팅이 즉시 해야 할 일

**Swain V1·V2·V3 검증 안내 + 결과 접수 → Phase 3 완료 처리**

### 검증 순서 (Swain에게 안내)

**V1 — 효성 계약정보 업로드** (가장 먼저)
- cms-tbfa.html → 왼쪽 **📥 CSV 종합 검증 매핑** → 종류: "효성 — 계약정보" → 파일 업로드
- 결과창에 "N명 매칭, N명 신규 생성, N건 계약 갱신" 형태로 나오면 정상
- 이후 **👥 통합 일반 회원** → 회원 행에 효성 계약 열(계약상태·결제수단·약정일) 값이 보이면 정상
- 회원 이름 클릭 → 상세 모달 🏦 효성 계약 탭 → 11개 항목 표시 확인

**V2 — 효성 수납내역 업로드**
- 종류: "효성 — 수납내역" → 파일 업로드
- 결과창에 "N건 수납내역 저장, N건 후원 생성" 나오면 정상
- **🔁 정기 후원자 관리** → 결제수단·등록상태·청구 기간 열 값 확인

**V3 — 종합 검증 대시보드**
- **🔍 종합 검증 대시보드** 클릭
- 상단 카드 6개(전체 회원·정기·효성·토스·잠재·비후원) 숫자 표시 확인
- 🔔 검증 Alert 패널, 📥 CSV Import 이력 확인

**검증 통과 시**:
1. `git tag phase3-complete-20260510 && git push origin --tags`
2. PROJECT_STATE.md §5.1 단계 D ✅ 갱신 + §2 행 추가 후 push

---

## 6. D1·D2 버그 수정 경위 (신규 메인 채팅 필독)

**문제**: B 채팅이 효성 파일 처리를 임시 보관함(pending_donations) 방식으로만 구현해서, 효성 계약·수납내역이 전용 저장소(hyosungContracts·hyosungBillings)에 들어가지 않음. 그 결과 통합 회원 화면 효성 컬럼·정기 후원자 화면·대시보드 모두 데이터 없음.

**수정**: 커밋 `89d3547` — 효성 계약정보 업로드 시 hyosungContracts UPSERT + members 자동 연결, 효성 수납내역 업로드 시 hyosungBillings UPSERT + donations 생성. M1·M2 라이브러리 정상 활용. 기업은행(IBK)은 기존 방식 유지.

---

## 7. 알려진 이슈

| ID | 상태 |
|---|---|
| ~~#BUG-1~~ | ✅ 해결 (bb529f9) |
| ~~#BUG-2~~ | ✅ 해결 (phase1 머지) |

현재 미해결 이슈 0건.

---

## 8. 다음 작업 후보

전체 인벤토리는 [docs/REMAINING_WORK.md](REMAINING_WORK.md). 핵심만:

1. **Phase 3 Swain 검증 통과** → tag 부여 → 마일스톤 #16 완료 선언
2. **6순위 #8 1:1 매칭 채팅** — 15~18h, #16 완료 후 진행 권장
3. **TypeScript 타입 에러 149건** — 운영 영향 0, 자투리 시간에
4. **Phase 4~22 (19개)** — 스펙 미정, 별도 설계 세션 필요

---

## 9. worktree 현황

| 폴더 | 브랜치 | 상태 |
|---|---|---|
| `tbfa-mis` (메인) | `main` @ `89d3547` | 모든 변경 origin 반영 완료 |
| `../tbfa-mis-A` | `feature/phase3-frontend` @ `46047a5` | Phase 3 프론트 완료, 머지됨 — 정리 가능 |
| `../tbfa-mis-B` | `feature/phase3-backend` | Phase 3 백엔드 완료, 머지됨 — 정리 가능 |

---

## 10. 작업 시 필독

- [CLAUDE.md](../CLAUDE.md) — 자동 로드, 코딩 컨벤션·권한·자율성 원칙(§6.10~6.12)
- [PROJECT_STATE.md](../PROJECT_STATE.md) — 휘발성 상태, 채팅·worktree·진행률
- [docs/DESIGN_PHASE3.md](DESIGN_PHASE3.md) — Phase 3 설계서 (API 계약·매핑 표·검증 시나리오)
- [.claude/settings.json](../.claude/settings.json) — 권한 정책

---

## 11. 최근 변경 이력 (이 문서)

| 일시 | 내용 |
|---|---|
| 2026-05-10 | **Phase 3 코드 완료 + D1·D2 버그 수정** — A·B 채팅 머지 + admin-donation-import.ts 핵심 수정(효성 파일 → 전용 저장소 직접 적재). Swain V1·V2·V3 검증 대기. §5 즉시 해야 할 일 신설 |
| 2026-05-10 | **§10 효성 SOT 원칙 신설** — 효성 CMS+ PDF 양식 SOT 합의. 일방향 흡수 + 고유 컬럼 보존 |
| 2026-05-10 | **Phase 1·2 완료** — 단계 B·C 머지·검증 통과. tag `phase1/2-complete-20260510` |
| 2026-05-10 | 신설. 단일 최신 인수인계 도입. v20은 `docs/handover/v20.md`로 archive |
