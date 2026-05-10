# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 이전 시점 스냅샷은 [`docs/handover/v*.md`](handover/)에 영구 보관(자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-10 / 메인 채팅 / Phase 3 검증 완료 + 후속 개선 4건 푸시 (라이브 반영 대기 — Netlify Neon Extension 인프라 이슈)

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
- ✅ 마일스톤 #16 단계 A·B·C·**D 검증 완료** — Swain V1·V2·V3 모두 통과
- 🟡 **후속 개선 코드 4건 푸시 — 라이브 반영 대기** (커밋 `60f9fb2`):
  1. `admin.html` 진입 자동 허브 리다이렉트 제거 (어떤 경로로도 어드민 본체 직행)
  2. 퀵이동 컴포넌트 — 모든 어드민·워크스페이스 좌측 상단 고정 + 워크스페이스 5개 메뉴 1뎁스 토글
  3. 정기·잠재 후원자 화면 효성 회원 표시 버그 수정:
     - 정기금액 0 → 한국어/영문(`사용`/`active`) 양쪽 매칭
     - 다음결제일 0 → 효성 약정일(`hyosung_promise_day`) 기반 fallback
     - 누적개월·합계 0 → `hyosung_billings` 직접 합산 fallback
  4. 통합 일반 회원 화면 가입경로별 인원수 KPI 카드 5종 신설
- ✅ #BUG-1·#BUG-2 모두 해결
- 🔴 **Netlify Neon Extension 인프라 이슈로 빌드 실패 반복** — 지원팀 티켓 진행 중

누적 마스터플랜 진행률 약 38% (5.5/22 Phase + 4·5순위 + 6순위 #6·#15 + #16 단계 A·B·C·D + UI/표시 개선).

---

## 4. 진행 중 마일스톤 — #16 통합 회원·후원 회원 시스템

| 단계 | 상태 | 핵심 |
|---|---|---|
| A 메뉴 재배치 | ✅ 완료 | 사이드바 그룹화·이름 변경·placeholder |
| B 통합 일반 회원 + 상세 모달 | ✅ 완료 | 가짜 회원 제거 + 진짜 명단 + 상세 모달. #BUG-2 해소. tag `phase1-complete-20260510` |
| C 후원 회원 분류 정착 | ✅ 완료 | 분류 칸 4개 + 자동 갱신 후크 4건 + 정기/잠재 화면. tag `phase2-complete-20260510` |
| D 효성 SOT 정합성 + 토스 자동 매핑 + 검증 대시보드 | ✅ **검증 완료** — V1·V2·V3 통과. 빌드 풀리는 즉시 `phase3-complete-20260510` 태그 부여 예정 |

설계서: [docs/DESIGN_PHASE3.md](DESIGN_PHASE3.md) + [docs/milestones/2026-05-10-donor-system.md](milestones/2026-05-10-donor-system.md)

---

## 5. ★ 새 메인 채팅이 즉시 해야 할 일

**Netlify 빌드 복구 → 라이브 반영 검증 → Phase 3 완료 태그**

### 현재 막힘: Netlify Neon Extension 인프라 이슈

```
❯ Installing extensions
   - neon              ← 마지막 정상 출력
   ↓
Dependencies installation error (1분 후)
npm error network request to https://***.netlify.app/packages/buildhooks.tgz failed
reason: getaddrinfo ENOTFOUND ***.netlify.app
```

- **자동 git push 빌드는 100% 실패** (4회 연속)
- **수동 "Clear cache and deploy"도 1회 성공·1회 실패** — 간헐적 동작
- **우리 코드 무관** (`netlify.toml`·`package.json`·`.npmrc` 일체 변경 없음 검증)
- 진단: Netlify 빌드 환경의 Neon Extension이 자체 build hook 패키지(`buildhooks.tgz`) 다운로드 호스트(`***.netlify.app`)를 DNS resolution 못 함
- **Netlify 지원팀 티켓 진행 중** — 빌드 ID 다수 제공: `6a00276bcc735e00085200eb`, `6a00283d5b8d4f5847190614`, `6a00297dea1c0eb16ae67174`, `6a00320e390586000801919a`, `6a00343c87eb23b9cc0b1ccf`

### 빌드 풀리면 검증할 항목 (라이브 반영 대기 4건)

#### V-A. 자동 허브 리다이렉트 제거 (`344500b`)
- 어떤 경로로 `/admin.html` 진입해도 곧바로 어드민 본체 (허브 안 거침)

#### V-B. 퀵이동·1뎁스 토글 UI (`ca9f39e`)
- 모든 어드민·워크스페이스 좌측 상단 **🚀 퀵이동** 한 줄 — 클릭 시 5개 펼침
- 사이드바 워크스페이스 5개 메뉴는 **🛠 워크스페이스** 1뎁스 토글로 묶임 (기본 접힘)

#### V-C. 효성 정기·잠재 후원자 표시 버그 fix (`123c27c` + `60f9fb2`)
- 정기 후원자 화면:
  - 효성 회원의 **정기금액**이 채워짐 (한국어/영문 매핑 보정)
  - **다음결제일**이 채워짐 (효성 약정일 기준 계산)
  - **누적개월·누적합계**가 채워짐 (`hyosung_billings` 직접 합산 fallback)
- 잠재 후원자 화면:
  - 같은 fallback으로 **누적·마지막 후원일/금액** 채워짐

#### V-D. 통합 일반 회원 가입경로별 KPI 카드 (`123c27c`)
- 좌측 사이드바 → **👥 통합 일반 회원** 진입
- 화면 상단에 5개 카드: **전체 / 🌐 싸이렌 / 🏦 효성 / ✍️ 수기 / 🤝 기타**
- 새로고침 버튼 클릭 시 자동 갱신

### 검증 모두 통과 시 (자율 진행)

1. `git tag phase3-complete-20260510 && git push origin --tags`
2. PROJECT_STATE.md §2 마지막 업데이트 행 추가
3. HANDOFF.md §3·§4·§5 갱신 (다음 작업 후보로 교체)
4. 다음 작업: 6순위 #8 (1:1 매칭 채팅) 또는 Phase 4~22 설계

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
| 2026-05-10 | **Phase 3 검증 완료 + 후속 개선 4건 푸시** — V1·V2·V3 통과(라이브 코드 `ffa8399`). 후속 작업 4건 푸시(`344500b`/`ca9f39e`/`123c27c`/`60f9fb2`). **Netlify Neon Extension 빌드 인프라 이슈로 라이브 반영 대기** (지원팀 진행 중). §3·§4·§5·§11 갱신 |
| 2026-05-10 | **효성 CSV 흐름 복원 + DB 정합성 2회 마이그** — 검토 단계 부활(`1447295`) + jsonb 파싱·실패 사유 노출(`f57a11a`) + 컬럼 정합 1차(`5e06e64`→`05b9ec3`) + timestamp 정합 2차(`4c836cf`→`455f992`). Swain V1 통과 재검증 대기. §5·§6 신규 사고 기록 |
| 2026-05-10 | **Phase 3 코드 완료 + D1·D2 버그 수정** — A·B 채팅 머지 + admin-donation-import.ts 핵심 수정(효성 파일 → 전용 저장소 직접 적재). Swain V1·V2·V3 검증 대기. §5 즉시 해야 할 일 신설 |
| 2026-05-10 | **§10 효성 SOT 원칙 신설** — 효성 CMS+ PDF 양식 SOT 합의. 일방향 흡수 + 고유 컬럼 보존 |
| 2026-05-10 | **Phase 1·2 완료** — 단계 B·C 머지·검증 통과. tag `phase1/2-complete-20260510` |
| 2026-05-10 | 신설. 단일 최신 인수인계 도입. v20은 `docs/handover/v20.md`로 archive |
