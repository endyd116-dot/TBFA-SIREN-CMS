# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/)에 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-10 / 메인 채팅 / Phase 3 코드 + DB 정합성 100% — Swain V1 통과 재검증 대기

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
- 🟡 **마일스톤 #16 단계 D — 코드 + DB 정합성 100%, Swain V1 통과 재검증 대기** (커밋 `455f992`)
  - 효성 CSV 흐름 복원 (검토 단계 부활) — 업로드 → 미확정 목록 → 통과 → 효성 저장소·회원·후원 적재
  - **2회 1회용 마이그 호출·삭제 완료**: v14↔schema.ts 컬럼 어긋남 9개+ + timestamp 1개 정합성 복구
  - 효성 2테이블(hyosung_contracts·hyosung_billings) schema.ts와 100% 일치
- ✅ #BUG-1·#BUG-2 모두 해결

누적 마스터플랜 진행률 약 36% (5.5/22 Phase + 4·5순위 + 6순위 #6·#15 + #16 단계 A·B·C).

---

## 4. 진행 중 마일스톤 — #16 통합 회원·후원 회원 시스템

| 단계 | 상태 | 핵심 |
|---|---|---|
| A 메뉴 재배치 | ✅ 완료 | 사이드바 그룹화·이름 변경·placeholder |
| B 통합 일반 회원 + 상세 모달 | ✅ 완료 | 가짜 회원 제거 + 진짜 명단 + 상세 모달. #BUG-2 해소. tag `phase1-complete-20260510` |
| C 후원 회원 분류 정착 | ✅ 완료 | 분류 칸 4개 + 자동 갱신 후크 4건 + 정기/잠재 화면. tag `phase2-complete-20260510` |
| **D 효성 SOT 정합성 + 토스 자동 매핑 + 검증 대시보드** | 🟡 **코드 + DB 100% — V1 재검증 대기** | 효성 계약·수납 업로드 → 미확정 목록 → 통과 시 효성 저장소·회원·후원 적재 + 자동 분류 |

설계서: [docs/DESIGN_PHASE3.md](DESIGN_PHASE3.md) + [docs/milestones/2026-05-10-donor-system.md](milestones/2026-05-10-donor-system.md)

---

## 5. ★ 새 메인 채팅이 즉시 해야 할 일

**Swain V1 통과 재검증 → V2·V3 진행 → Phase 3 완료 처리**

### 현재 상태 (반드시 먼저 이해)

이전 메인 채팅에서 다음을 완료:
1. **효성 CSV 흐름 복원** (`1447295`) — 직전 D1·D2 수정이 검토 단계를 통째로 건너뛰어 미확정 목록이 비어 보였던 문제를 되돌림. 업로드 → 미확정 목록(자동 매칭 점수까지) → 사용자 통과 처리 → 효성 저장소·회원 적재 흐름이 표준
2. **통과 처리 jsonb 파싱 + 실패 사유 노출** (`f57a11a`) — db.execute(raw SQL)이 jsonb를 자동 파싱 안 해서 통과 100% 실패하던 문제. drizzle 표준 select로 전환 + 실패 시 행별 사유 alert 표시
3. **DB 컬럼 정합성 1차 마이그** (`5e06e64` 호출 → `05b9ec3` 삭제) — v14가 만든 효성 2테이블 컬럼명이 schema.ts와 9개 가까이 어긋나 있어 통과 시 "column ... does not exist" 오류 → RENAME 7+4건 + ADD 1+5건 + NOT NULL 해제 등으로 정합
4. **DB timestamp 정합성 2차 마이그** (`4c836cf` 호출 → `455f992` 삭제) — `imported_at` → `created_at` (양 테이블)

→ **현재**: 두 효성 테이블이 schema.ts와 100% 정합. Swain은 마이그까지 호출했으나 **V1 통과 재시도는 아직 안 함**. 미확정 목록에 50건+ 효성 계약 행이 그대로 있음.

### V1 통과 재검증 (가장 먼저)

1. cms-tbfa.html 새로고침 (Ctrl+Shift+R 권장)
2. **📥 CSV 종합 검증 매핑** → 미확정 목록에서 행 1건 ✅ 통과 클릭
   - **성공 1건**: 일괄 통과 진행 → V2로 이동
   - **실패**: alert 메시지(실패 사유)를 받아서 분석. 이번엔 진짜 다른 원인일 가능성 (예: members 테이블 무관 컬럼, hyosung_member_no 인덱스 등)
3. 일괄 통과 후 **👥 통합 일반 회원** 화면 새로고침
   - 효성 회원 50명+ 명단 출현 확인
   - 효성 컬럼(계약상태·결제수단·약정일) 채워짐 확인
   - 회원 행 클릭 → 상세 모달 🏦 효성 계약 탭 11개 항목 표시 확인

### V2 효성 수납내역 업로드

- cms-tbfa → 📥 CSV 종합 검증 매핑 → 종류 "효성 — 수납내역" → 파일 업로드 → 미확정 목록 → 통과
- **🔁 정기 후원자 관리** 화면 → 결제수단·등록상태·청구 기간 열 채워짐 확인

### V3 종합 검증 대시보드

- **🔍 종합 검증 대시보드** → 카드 6개 숫자 + Alert 패널 + Import 이력 표시 확인

### V1·V2·V3 모두 통과 시 (자율 진행)

1. `git tag phase3-complete-20260510 && git push origin --tags`
2. PROJECT_STATE.md §2 마지막 업데이트 행 추가 + §5.1 단계 D ✅ 갱신
3. docs/HANDOFF.md §3·§4·§5·§11 갱신 (Phase 3 완료 반영, §5는 다음 작업 후보로 교체)
4. main에 push
5. 다음 작업 후보 안내 (REMAINING_WORK.md §8 참고)

---

## 6. D1·D2 수정 경위 + DB 정합성 마이그 사고 기록

### 사고 흐름
1. **B 채팅(Sonnet)이 효성 파일을 임시 보관함(pending_donations)에만 적재** → 효성 저장소 미반영 → 통합 회원 화면 효성 컬럼 비어 있음
2. **이전 메인 채팅 1차 수정 (89d3547)**: 임시 보관함 우회하고 효성 저장소 직접 적재로 변경 → 검토 단계 사라짐 → Swain이 원하는 운영 흐름(검토 → 통과) 깨짐
3. **이번 메인 채팅 복원 (1447295)**: 검토 단계 부활. 업로드 → pending_donations 적재 + 자동 매칭 → 통과 시 효성 저장소·회원·후원 정식 반영
4. **통과 0/50 실패 (f57a11a)**: 원인은 db.execute(raw SQL) jsonb 자동 파싱 안 됨 → drizzle select로 전환
5. **통과 0/N "column does not exist" (5e06e64)**: v14 마이그가 만든 컬럼명과 schema.ts 컬럼명이 9개 가까이 어긋남 → 1차 마이그로 RENAME/ADD/ALTER
6. **통과 0/N "created_at does not exist" (4c836cf)**: 2차 마이그로 imported_at → created_at RENAME

### 교훈 (다음 채팅도 활용)

- **schema.ts 갱신 시 운영 DB 컬럼 동기화 필수** — schema.ts만 고치고 마이그를 안 만들면 SELECT/INSERT가 컬럼 없음 오류로 터짐. CLAUDE.md §6.7 강조점 (정상 흐름: 마이그 작성 → 호출 → 적용 확인 → schema 정의 추가)
- **drizzle execute(sql) jsonb 자동 파싱 X** — db.select() 사용해야 jsonb가 객체로 옴. raw SQL은 string으로 올 위험
- **컬럼 정합성 진단 모드 마이그가 효율적** — 어떤 컬럼이 어긋나 있는지 사전에 보여주고, 적용도 같은 함수로 — Swain이 ?run=1 한 번만 누르면 됨

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

1. **Phase 3 Swain V1 재검증 통과** → V2·V3 → tag 부여 → 마일스톤 #16 완료 선언
2. **6순위 #8 1:1 매칭 채팅** — 15~18h, #16 완료 후 진행 권장
3. **TypeScript 타입 에러 149건** — 운영 영향 0, 자투리 시간에
4. **Phase 4~22 (19개)** — 스펙 미정, 별도 설계 세션 필요

---

## 9. worktree 현황

| 폴더 | 브랜치 | 상태 |
|---|---|---|
| `tbfa-mis` (메인) | `main` @ `455f992` | 모든 변경 origin 반영 완료 |
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
| 2026-05-10 | **효성 CSV 흐름 복원 + DB 정합성 2회 마이그** — 검토 단계 부활(`1447295`) + jsonb 파싱·실패 사유 노출(`f57a11a`) + 컬럼 정합 1차(`5e06e64`→`05b9ec3`) + timestamp 정합 2차(`4c836cf`→`455f992`). Swain V1 통과 재검증 대기. §5·§6 신규 사고 기록 |
| 2026-05-10 | **Phase 3 코드 완료 + D1·D2 버그 수정** — A·B 채팅 머지 + admin-donation-import.ts 핵심 수정(효성 파일 → 전용 저장소 직접 적재). Swain V1·V2·V3 검증 대기. §5 즉시 해야 할 일 신설 |
| 2026-05-10 | **§10 효성 SOT 원칙 신설** — 효성 CMS+ PDF 양식 SOT 합의. 일방향 흡수 + 고유 컬럼 보존 |
| 2026-05-10 | **Phase 1·2 완료** — 단계 B·C 머지·검증 통과. tag `phase1/2-complete-20260510` |
| 2026-05-10 | 신설. 단일 최신 인수인계 도입. v20은 `docs/handover/v20.md`로 archive |
