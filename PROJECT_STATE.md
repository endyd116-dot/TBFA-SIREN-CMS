# PROJECT_STATE.md — SIREN 작업 상태 통합 문서

> **목적**: 단일 휘발성 상태 문서. "지금 누가 뭘 하고 있나" 한 곳에 모음.
> **자동 로드는 안 됨** — 각 채팅 시작 시 명시적으로 읽어야 함 (`CLAUDE.md`만 자동 로드).
> **갱신 의무**: 작업 진행률·다음 할 일이 바뀌면 본인 채팅이 직접 갱신 후 push.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 이름 | **SIREN (싸이렌)** — 교사유가족협의회 통합 NPO 플랫폼 |
| 라이브 URL | https://tbfa-siren-cms.netlify.app |
| 스택 | Vanilla JS + Netlify Functions v2 + Neon PG + Drizzle + R2 |
| 베이스 브랜치 | `main` |
| 자동 로드 문서 | `CLAUDE.md` (코딩 컨벤션·구조·자율 권한) |
| 단일 최신 인수인계 | `docs/HANDOFF.md` (한 화면, 새 사람·새 채팅이 처음 보는 곳) |
| 잔여 작업 인벤토리 | `docs/REMAINING_WORK.md` (우선순위별 카탈로그) |
| 영구 스냅샷 | `docs/handover/v20.md`, `docs/handover/v17-expanded.md` (자발적 안 읽음, 역사 기록) |

상세 스택·환경변수·폴더 구조는 `CLAUDE.md` §2~5 참조.

---

## 2. 마지막 업데이트

| 시각 | 갱신자 | 내용 |
|---|---|---|
| 2026-05-10 | 메인 채팅 | **Phase 2 (#16 단계 C) 완료** — schema 4컬럼·마이그·후크 4건·야간 cron·조회 API 2건·정기/잠재 화면 모두 안착(c3d2249). Swain 화면 검증 통과(양식만 효성과 차이). tag `phase2-complete-20260510`. 다음: Phase 3 단계 D — 효성 양식 정합성 본격 |
| 2026-05-10 | 메인 채팅 | **Phase 1 (#16 단계 B) 완료** — A·B 채팅 코드 머지(0917e67·f026c6b) + Swain 화면 검증 통과. **#BUG-2 해소**. tag `phase1-complete-20260510` |
| 2026-05-10 | 메인 채팅 | CLAUDE.md §6.14 절대명제 신설 — 검증·설명은 로직·기능 위주(함수·변수 코드 용어 회피) |
| 2026-05-10 | 메인 채팅 | **Phase 1 설계 확정** — DESIGN_PHASE1.md 본격 11섹션, A/B 분담 + Mock + API 계약 옵션 (a). tag `phase1-design-complete-20260510` |
| 2026-05-10 | 메인 채팅 | Phase 분류 시나리오 B 채택 — 이번 사이클에 #16 B·C·D 처리, PHASE_PROPOSAL.md / DESIGN_PHASE1.md 신설 |

> 갱신 시 위 표 **맨 위**에 행 추가. 5행 넘으면 오래된 행 삭제.

---

## 3. 현재 작업 모드

```
🟢 시나리오 B (균형형) — 마일스톤 #16 B·C·D
   Phase 1 ✅ 완료 (단계 B: 통합 일반 회원 + 상세 모달 + #BUG-2 해소)
   Phase 2 ✅ 완료 (단계 C: 정기/잠재/비후원 분류 정착 + 자동 갱신)
   Phase 3 진입 준비 (단계 D: 효성 양식 정합성 + CSV 종합 검증·일괄 갱신)
```

- 시나리오 채택 근거: [docs/PHASE_PROPOSAL.md](docs/PHASE_PROPOSAL.md)
- Phase 1 분담 상세: [docs/DESIGN_PHASE1.md](docs/DESIGN_PHASE1.md)
- 단일(serial) 모드: main 채팅 하나만 작업
- 병렬(parallel) 모드: 작업별 브랜치 + 별도 채팅으로 분배

각 채팅이 작업 시작 시 본인 진행률을 §4의 표에 갱신.

---

## 4. 병렬 작업 분리

### 4.0 의존성 매트릭스

|   | A 자격변경 | B 1:1 매칭 | C CSV 매핑 |
|---|---|---|---|
| **A** | — | 독립 | 독립 |
| **B** | 독립 | — | 독립 |
| **C** | 독립 | 독립 | — |

→ 도메인 독립. 동시 시작 가능. 머지 충돌만 §6에서 회피.

### 4.1 작업 A — 6순위 #6: 교원 회원 자격 변경 시스템

| 항목 | 값 |
|---|---|
| 브랜치 | `feature/eligibility-change` |
| 베이스 | `origin/main` |
| 진행률 | 🟡 코드 100% / 검증 보류 — #BUG-1로 차단 (§6.6 참고) |
| 담당 채팅 | A 채팅 → 메인 채팅(머지 완료, 검증 보류) |
| 예상 시간 | 12~15h |
| 다음 할 일 | #BUG-1 (`lib/auth.ts:128` user.id → user.uid) 수정 → 사용자 검증(마이페이지 신청 → 어드민 승인) → ✅ 100% |

**목적**: 회원이 본인 자격(현직/은퇴/예비/일반) 변경 신청 → 어드민 심사 → 승인/반려 → 등급·권한 갱신

**신규 파일**
- `netlify/functions/eligibility-request.ts` — 사용자 신청 POST
- `netlify/functions/eligibility-status.ts` — 본인 신청 내역 GET
- `netlify/functions/admin-eligibility-list.ts` — 어드민 심사 대기 목록
- `netlify/functions/admin-eligibility-review.ts` — 어드민 승인/반려
- `netlify/functions/migrate-add-eligibility-change.ts` — 1회용 마이그
- `public/js/mypage-eligibility.js` — 마이페이지 모듈
- `public/js/admin-eligibility.js` — 어드민 심사 모듈

**확장 파일** (§6 충돌 주의)
- `db/schema.ts` — `eligibilityChangeRequests` 테이블 + `members.eligibilityType` 컬럼
- `public/mypage.html` — "자격 변경" 탭 + 스크립트 include
- `public/admin.html` — "자격 심사" 메뉴 + 스크립트 include
- `public/js/admin.js` — 라우터 1줄
- `lib/audit.ts` — 자격 변경 로그 (옵션, append-only)

**데이터 모델 (제안)**
```sql
CREATE TABLE eligibility_change_requests (
  id serial PRIMARY KEY,
  member_id int NOT NULL REFERENCES members(id),
  current_type varchar(30),
  requested_type varchar(30),
  reason text,
  evidence_blob_id int,
  status varchar(20) DEFAULT 'pending',
  admin_note text,
  reviewed_by int REFERENCES admins(id),
  reviewed_at timestamp,
  created_at timestamp DEFAULT now()
);
ALTER TABLE members ADD COLUMN eligibility_type varchar(30);
```

---

### 4.2 작업 B — 6순위 #8: 변호사·심리상담사 ↔ 사용자 1:1 매칭 채팅

| 항목 | 값 |
|---|---|
| 브랜치 | `feature/expert-matching-chat` |
| 베이스 | `origin/main` |
| 진행률 | ⬜ 0% (미착수) |
| 담당 채팅 | 미배정 |
| 예상 시간 | 15~18h |
| 다음 할 일 | 채팅 시작 → 브랜치 생성 → expert_matches 테이블 + chat_rooms.room_type 마이그 |

**기존 인프라 활용** (신규 채팅 시스템 만들지 말 것)
- 전문가는 `members.type='volunteer'` + `member_subtype='lawyer'/'counselor'`로 관리됨 (`db/schema.ts:1069-1071`)
- `chat_rooms`, `chat_messages` 테이블 존재 (`db/schema.ts:440-481`)
- → **chat_rooms 확장(`room_type='expert_1on1'`) + 권한 가드 강화** 방향

**신규 파일**
- `netlify/functions/expert-match-request.ts`
- `netlify/functions/expert-match-list.ts`
- `netlify/functions/admin-expert-list.ts`
- `netlify/functions/admin-expert-assign.ts` — 매칭 + 채팅방 생성
- `netlify/functions/expert-session-end.ts`
- `netlify/functions/migrate-expert-matching.ts`
- `public/js/mypage-expert-match.js`
- `public/js/admin-expert.js`

**확장 파일** (§6 충돌 주의)
- `db/schema.ts` — `expertMatches` + `chatRooms.roomType`/`expertId` 컬럼
- `netlify/functions/chat-*.ts` — 권한 가드 강화 (member_id 외 expert_id 확인)
- `public/mypage.html`, `public/admin.html` — 메뉴/탭
- `public/js/auth.js` — 채팅방 진입 시 type 분기 (옵션)

**데이터 모델 (제안)**
```sql
CREATE TABLE expert_matches (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES members(id),
  expert_id int NOT NULL REFERENCES members(id),
  match_type varchar(20),         -- 'lawyer'/'counselor'
  source_domain varchar(30),      -- 'incident'/'harassment'/'legal'/'support'
  source_id int,
  chat_room_id int REFERENCES chat_rooms(id),
  status varchar(20) DEFAULT 'pending',
  assigned_at timestamp,
  closed_at timestamp,
  closed_reason varchar(50),
  created_at timestamp DEFAULT now()
);
ALTER TABLE chat_rooms ADD COLUMN room_type varchar(20) DEFAULT 'general';
ALTER TABLE chat_rooms ADD COLUMN expert_id int REFERENCES members(id);
```

---

### 4.3 작업 C — 6순위 #15: 효성 + 기업은행 CSV 자동 매핑 + 후원 확정

| 항목 | 값 |
|---|---|
| 브랜치 | `feature/csv-donation-mapping` |
| 베이스 | `origin/main` |
| 진행률 | 🟢 95% — main 머지 완료 (705296d), 사용자 검증 대기 → 검증 통과 시 100% |
| 담당 채팅 | C (csv-mapping) → 메인 채팅(머지 완료) |
| 예상 시간 | 10~13h |
| 다음 할 일 | 사용자 검증(어드민 → CSV 자동 매핑 탭 → 효성/IBK CSV 업로드 → 자동 매칭 점수 확인 → 1건/일괄 확정) → 검증 통과 시 ✅ 100% |

**기존 인프라 활용**
- `lib/hyosung-parser.ts` 존재 (Phase 1 완료) → 신규 ibk-parser와 인터페이스 통일
- `public/cms-tbfa.html` — 기부 통합 관리 페이지

**신규 파일**
- `lib/ibk-parser.ts` — 기업은행 CSV 파서
- `lib/donation-matcher.ts` — 자동 매칭 룰 엔진(이름·금액·날짜·계좌끝4자리)
- `netlify/functions/admin-donation-import.ts` — multipart 업로드 → pending_donations 적재
- `netlify/functions/admin-donation-pending-list.ts`
- `netlify/functions/admin-donation-confirm.ts` — 확정(1건/일괄)
- `netlify/functions/admin-donation-policy.ts` — 후원 정책 GET/PATCH (효성 카운트다운 등, super_admin 전용)
- `netlify/functions/migrate-add-pending-donations.ts`
- `public/js/cms-tbfa-import.js` — CSV 업로드·매핑 UI

**확장 파일** (§6 충돌 주의)
- `db/schema.ts` — `pendingDonations` + `donationMatchingRules` 테이블
- `public/cms-tbfa.html` — "CSV 자동 매핑" 탭 + 스크립트 include
- `public/admin.html` — 메뉴 등록
- `public/js/cms-tbfa.js` — 라우터 등록 (옵션)

**데이터 모델 (제안)**
```sql
CREATE TABLE pending_donations (
  id serial PRIMARY KEY,
  source varchar(20),                -- 'hyosung'|'ibk'
  source_file_name varchar(200),
  source_row_index int,
  raw_data jsonb,
  parsed_name varchar(100),
  parsed_amount int,
  parsed_date date,
  parsed_memo text,
  matched_member_id int REFERENCES members(id),
  match_score numeric(4,2),
  match_reason varchar(200),
  status varchar(20) DEFAULT 'pending',
  confirmed_donation_id int REFERENCES donations(id),
  imported_by int REFERENCES admins(id),
  created_at timestamp DEFAULT now()
);
```

### 4.4 권장 머지 순서

**C → A → B** (변경량 작은 → 큰)

각 머지 전: `git fetch origin && git rebase origin/main` 충돌 해결.

> ※ 2026-05-09: A 먼저 머지(91f4e2f) → B 머지 완료(705296d). 실제 순서: A → B (둘 다 main 안착, 사용자 검증 진행 중)
> ※ B 1차 push에서 schema 회귀(A의 eligibilityType + eligibilityChangeRequests 삭제) 발견 → 메인 채팅이 push 보류 → B가 fix(schema) 커밋(b45d0fa)으로 복구 후 재머지·검증 통과. 교훈: schema.ts는 append-only + 본인 섹션 헤더(CLAUDE.md §6.3) 엄격 준수

### 4.5 작업 환경 (worktree)

| 채팅 호칭 | 작업 폴더 | 브랜치 | 작업 식별자 |
|---|---|---|---|
| 메인 채팅 | `tbfa-mis` (현재 폴더) | `main` | (조율용) |
| A 채팅 | `../tbfa-mis-A` | `feature/eligibility-change` | 작업 A (#6) |
| B 채팅 | `../tbfa-mis-B` | `feature/csv-donation-mapping` | 작업 C (#15) |

⚠️ 새 채팅 시작 시 **반드시 본인 worktree 폴더에서 시작**
⚠️ 메인 폴더(`tbfa-mis`)는 `main` 브랜치 전용, **직접 작업 X**
⚠️ 같은 working directory 공유 **절대 X** (사고 사례 §6.5 참고)

### 4.6 마일스톤 #16 — 통합 회원·후원 회원 시스템 + CSV 종합 검증

> 6순위 #6·#15 검증 단계에서 발견된 더미 데이터 + 운영 도메인 모델 정립을 위한 신규 마일스톤. 6순위 #8(1:1 매칭 채팅)보다 **우선 권장**.

| 항목 | 값 |
|---|---|
| 식별자 | 6순위 #16 |
| 진행률 | 🟡 단계 A ✅ / 단계 B ✅ (tag phase1-complete-20260510) / **단계 C ✅ 완료** (c3d2249 + Swain 검증 통과 + tag phase2-complete-20260510) / 단계 D 다음 진입 (효성 양식 정합성 SOT) |
| 추정 시간 | 8~12h (B 1.5~2.5h + C 3~4h + D 3~5h) |
| 우선순위 | 6순위 #8보다 우선 (운영 핵심) |
| 시나리오·분담 | [docs/PHASE_PROPOSAL.md](docs/PHASE_PROPOSAL.md) / [docs/DESIGN_PHASE1.md](docs/DESIGN_PHASE1.md) |
| 상세 설계 | [docs/milestones/2026-05-10-donor-system.md](docs/milestones/2026-05-10-donor-system.md) |
| 관련 이슈 | [#BUG-2](docs/issues/2026-05-10-cms-tbfa-demo-data.md) (단계 B에서 해결) |

**도메인 모델** (사용자 합의):
- **통합 일반 회원** = 마스터 풀 (싸이렌+효성+수기 모두)
- **후원 회원** = 통합 회원의 부분집합
  - 정기: 토스 진행 중 OR 효성 'active'
  - 잠재: 일시 후원 OR 정기 중단

**단계 진행 순서**:
1. **단계 A** ✅ 완료 — 메뉴 재배치 (사이드바 그룹화·이름 변경·placeholder)
2. **단계 B** (1.5~2.5h) — 통합 일반 회원 실제 API 연동 + 회원 상세 모달 + 후원 내역 탭 → #BUG-2 해결
3. **단계 C** (3~4h) — donor_type 컬럼 + 정기/잠재 화면 + 토스 즉시 반영
4. **단계 D** (3~5h) — CSV 종합 검증 강화 + 효성 일괄 갱신 + 자동 상태 전이

**시작 절차**: docs/milestones/2026-05-10-donor-system.md §8 참고 (worktree 생성 + 첫 메시지 복붙).

---

## 5. 진행 상황 (직전 ~ 현재)

### 5.1 마일스톤 진행률 (CLAUDE.md §10 기준)

| 묶음 | 상태 |
|---|---|
| Phase 1 효성 CMS+ | ✅ 100% |
| Phase 2 토스 빌링 자동청구 | ✅ 100% |
| Phase 3 워크스페이스 본체 | ✅ 100% |
| Phase 3-extra 파일함 | ✅ 100% (9/9 Step + 통합 라우팅) |
| 4순위 자잘한 버그 3건 | ✅ 100% |
| 5순위 중간 작업 | ✅ #1 / #9 / #10 모두 완료 |
| 6순위 #6 자격 변경 | ✅ 코드 100% 안착 (`feature/eligibility-change`), 사용자 검증 가능 |
| 6순위 #15 CSV 자동 매핑 + 엑셀 업로드 | ✅ 코드 100% 안착 (`feature/csv-donation-mapping`), admin.html 회원 관리에서 검증 가능 |
| **6순위 #16 통합 회원·후원 시스템** | 🟢 단계 A ✅ / 단계 B ✅ / **단계 C ✅** / 단계 D 다음 진입 |
| 6순위 #8 1:1 매칭 채팅 | ⏸ 다음 사이클 (15~18h, 한 사이클 안 어려움) |
| TypeScript 타입 에러 149건 | ⏸ 다음 사이클 자투리 (운영 영향 0) |
| Phase 4~22 (19개) | ⏸ 스펙 미정 (별도 설계 세션 필요) |

**누적**: 약 33% / 약 440h+

### 5.2 직전 7개 커밋 (오늘 작업 포함)

| 커밋 | 요약 |
|---|---|
| `87a034c` | docs(claude): 세션 마무리 — 2026-05-10 작업 인수인계 갱신 |
| `67e04cf` | docs(milestone): #16 통합 회원·후원 회원 시스템 설계 + #BUG-2 등록 |
| `42fd6c6` | feat(menu): 단계 A — 사이드바 그룹화 + 통합 일반 회원 + 후원 관리 강화 |
| `55417f5` | feat(csv-mapping): 엑셀(xlsx/xls) 업로드 지원 — 클라이언트 SheetJS 변환 |
| `bb529f9` | fix(auth): #BUG-1 requireActiveUser user.id → user.uid (UNDEFINED_VALUE 해결) |
| `4c25685` | docs(issue): #BUG-1 오류 리포트 — requireActiveUser user.id undefined 버그 |
| `4872a36` | docs: 작업 C 머지 완료 — §2·§4.3·§4.4 갱신 |

### 5.3 인수인계 — 다음 세션·다른 채팅이 알아야 할 공통 변경 (2026-05-10)

#### A. DB·스키마·마이그레이션
| 항목 | 상태 |
|---|---|
| 오늘 schema.ts 변경 | ❌ 0건 (코드 머지·문서·UI만) |
| 오늘 신규 마이그레이션 | ❌ 0건 |
| **다음 단계 C 예정** (마일스톤 #16) | `members` 테이블 4개 컬럼 추가: `donor_type`, `donor_channels`(jsonb), `prospect_subtype`, `donor_evaluated_at` + 1회용 마이그 `migrate-add-members-donor-type.ts` |

#### B. 코드 변경 영역 (다른 채팅 fetch·rebase 시 흡수)
| 영역 | 변경 내용 |
|---|---|
| `lib/auth.ts:128` | #BUG-1 fix — `user.id` → `user.uid` (requireActiveUser 사용 9개 API 정상화) |
| `public/cms-tbfa.html` | 사이드바 4개 그룹화 (워크스페이스/운영/후원관리/운영도구) + CSV 입력 accept(.csv,.xlsx,.xls) + 정기/잠재 후원자 placeholder + 캐시버스터 |
| `public/admin.html` | 사이드바 워크스페이스 그룹화 (워크툴/칸반/캘린더/템플릿/파일함) |
| `public/js/cms-tbfa.js` | 페이지 타이틀 매핑 갱신 (`통합 일반 회원`, 정기/잠재, CSV 종합 검증) |
| `public/js/cms-tbfa-import.js` | `excelToCsvFile()` 신규 + handleUpload 분기 (xlsx/xls → CSV 변환 후 업로드) |

#### C. 워크트리 현황
| 폴더 | 브랜치 | 상태 |
|---|---|---|
| `tbfa-mis` (메인) | `main` @ `87a034c` | 모든 변경 origin 반영 완료 |
| `../tbfa-mis-A` | `feature/eligibility-change` @ `91f4e2f` | 작업 A 완료, 머지됨 — 정리 가능 또는 유지 |
| `../tbfa-mis-B` | `feature/csv-donation-mapping` @ `705296d` | 작업 C 완료, 머지됨 — 정리 가능 또는 유지 |
| `../tbfa-mis-D` (예정) | `feature/donor-step-b` | 단계 B 시작 시 신규 생성 |

#### D. 미해결·진행 중
- ✅ #BUG-1 해결 (`bb529f9`)
- 🟠 #BUG-2 진행 예정 (마일스톤 #16 단계 B에서 해결)
- 🟡 사용자 검증 보류:
  - 작업 A(#6 자격 변경) — #BUG-1 fix 적용됨, 마이페이지 → 자격 변경 탭 정상 로드 확인 필요
  - 작업 C(#15 CSV) — admin.html 회원 관리에서 매칭 결과 검증 가능 (cms-tbfa는 #BUG-2로 보류)

#### E. 다음 세션 시작 절차
**단계 B (마일스톤 #16) 시작 권장**:
```bash
git worktree add ../tbfa-mis-D feature/donor-step-b origin/main
# 새 VS Code 창에서 ../tbfa-mis-D 열기
# Claude Code 새 채팅 → docs/milestones/2026-05-10-donor-system.md §8의 첫 메시지 복붙
```

---

## 6. 주의사항 및 위험 요소

### 6.1 모든 채팅 공통 (CLAUDE.md §6 요약)
1. **마이그레이션 호출은 사용자 액션** — AI는 함수만 작성
2. **`requireAdmin` 반환 필드는 `auth.res`** (response 아님)
3. 신규 함수에 `export const config = { path: "/api/..." }` 누락 금지
4. **schema.ts 컬럼 정의는 마이그레이션 적용 후에 추가** (역순 금지 — 즉시 운영 깨짐)
5. 응답 키 다중 fallback (`data.data.X || data.X || X`)
6. 캐시버스터 형식 통일: `?v=2026-05-09-N`

### 6.2 공유 파일 충돌 매트릭스

| 파일 | A | B | C | 위험 | 회피 전략 |
|---|---|---|---|---|---|
| `db/schema.ts` | ✅ | ✅ | ✅ | 🔴 | **파일 끝에** 본인 섹션 헤더(`/* === 작업 X === */`) 추가, append-only |
| `public/admin.html` | ✅ | ✅ | ✅ | 🟡 | 사이드바 `<nav>` 끝에 추가, emoji 라벨로 식별(🎓/⚖️/📥) |
| `public/admin.js` | ✅ | ✅ | ✅ | 🟡 | 라우터 1줄만, 객체 끝에 추가 (중간 삽입 금지) |
| `public/mypage.html` | ✅ | ✅ | — | 🟡 | 탭 영역 끝에 추가 |
| `public/cms-tbfa.html` | — | — | ✅ | 🟢 | C 단독 |
| `public/js/auth.js` | — | ✅ | — | 🟢 | B 단독 |
| `netlify/functions/chat-*.ts` | — | ✅ | — | 🟡 | B만 가드 추가 |
| `lib/audit.ts` | ✅ | ✅ | ✅ | 🟢 | append-only(호출만) |
| `lib/auth.ts`, `lib/admin-guard.ts` | ⛔ | ⛔ | ⛔ | 🔴 | **변경 금지** (회귀 위험 최고) |

### 6.3 충돌 회피 7대 원칙

1. **schema.ts**: 파일 끝 append-only + 섹션 헤더
2. **admin.html / mypage.html / cms-tbfa.html**: 메뉴/탭 영역 끝에 추가
3. **admin.js**: 신규 모듈은 별도 `admin-{도메인}.js`로 분리, 라우터 1줄만
4. **마이그레이션**: 함수명 prefix 강제, 호출 순서 = 머지 순서, 멱등 보장
5. **캐시버스터**: 본인 파일만 갱신, 머지 시점 일괄 검증
6. **package.json**: 가능하면 신규 dep 없이 진행, 추가 시 lock 충돌 = `npm install` 재실행
7. **lib/auth·admin-guard**: 절대 변경 금지

### 6.4 Phase 4~22 추후 안내

| Phase | 그룹 |
|---|---|
| Phase 4 | 대표 보고 시스템 + Agent-9 |
| Phase 5~7 | 재정 관리 |
| Phase 8~11 | 커뮤니케이션 |
| Phase 12~15 | SIREN 서비스 고도화 |
| Phase 16~18 | 분석·경영 |
| Phase 19~22 | 품질·안정성 |

→ 6순위 3건 머지 후 별도 설계 세션에서 본 문서 v2 작성.

### 6.5 worktree 사고 사례 (2026-05-09)

병렬 작업 시 worktree 사용 필수.
같은 working directory 공유 시 `git checkout`으로 인한 HEAD 변경 발생.

**사고**: 2026-05-09 `b5167bf` → `0453071` cherry-pick 정리.
**대응**: `../tbfa-mis-A`, `../tbfa-mis-B` 별도 폴더 사용 (§4.5).

### 6.6 미해결 이슈 (Open Issues)

| ID | 발견 | 위치 | 심각도 | 상태 | 리포트 |
|---|---|---|---|---|---|
| ~~#BUG-2~~ | 2026-05-10 | `cms-tbfa.js:60-90` | 🟠 High | ✅ 해결 (마일스톤 #16 단계 B 머지 — 545b523/f026c6b로 더미 제거) | [docs/issues/2026-05-10-cms-tbfa-demo-data.md](docs/issues/2026-05-10-cms-tbfa-demo-data.md) |
| ~~#BUG-1~~ | 2026-05-09 | `lib/auth.ts:128` | 🔴 Critical | ✅ 해결 (bb529f9) | [docs/issues/2026-05-09-requireActiveUser-uid-bug.md](docs/issues/2026-05-09-requireActiveUser-uid-bug.md) |

**처리 원칙**:
- 새 이슈 발견 시 `docs/issues/{날짜}-{키워드}.md` 별도 파일에 상세 분석 작성
- 본 표에 한 줄 인덱스 (ID·발견·위치·심각도·상태·링크)
- 해결 후 상태 갱신 (✅ 해결) 또는 영구 보존이 필요한 사고는 §6.5 같은 사고 사례 섹션으로 이동

---

## 7. 채팅별 시작 프롬프트

각 작업 채팅에 **첫 메시지로** 아래 프롬프트를 그대로 붙여넣으세요.

### 7.1 작업 A 채팅 (자격 변경)

```
[작업 A — 6순위 #6 교원 회원 자격 변경 시스템]

PROJECT_STATE.md 와 CLAUDE.md 를 먼저 읽고 작업해줘.

## 읽어야 할 섹션
- CLAUDE.md 전체 (자동 로드)
- PROJECT_STATE.md §4.1 (작업 A 정의), §6 (주의사항)
- db/schema.ts 의 members 테이블 정의 (라인 211 부근 pendingExpertReview, 374 assignedExpertName 참고)

## 작업 범위 (이 채팅에서만 작업)
PROJECT_STATE.md §4.1 의 신규/확장 파일 목록만. 다른 작업(B/C) 영역 절대 건드리지 마.

## 금지 영역
- public/admin.html / public/mypage.html / public/admin.js / db/schema.ts: 본인 섹션 끝에만 추가, 다른 작업 영역 손대지 말 것
- lib/auth.ts, lib/admin-guard.ts: 변경 금지
- 다른 작업(B/C)의 신규/확장 파일: 일체 손대지 말 것

## 완료 조건
1. 마이그레이션 함수 호출 성공(사용자가 ?run=1 실행) → schema.ts 컬럼 활성화 → 함수 삭제 + 커밋
2. 사용자 마이페이지에서 자격 변경 신청 → 어드민이 심사·승인 가능
3. 사용자 검증 완료 보고
4. PROJECT_STATE.md §4.1 진행률 100% 갱신 + §2 마지막 업데이트 행 추가

## 갱신 의무
- 작업 시작 시: §4.1 진행률 ⬜0% → 🟡 진행중, 담당 채팅 표시
- 마일스톤마다: §4.1 다음 할 일 갱신
- 종료 시: §4.1 ✅ 100% + §2 행 추가 + git push

## 브랜치
feature/eligibility-change (베이스: origin/main)

자, CLAUDE.md + PROJECT_STATE.md 읽고 시작 보고해줘.
```

### 7.2 작업 B 채팅 (1:1 매칭 채팅)

```
[작업 B — 6순위 #8 변호사·심리상담사 ↔ 사용자 1:1 매칭 채팅]

PROJECT_STATE.md 와 CLAUDE.md 를 먼저 읽고 작업해줘.

## 읽어야 할 섹션
- CLAUDE.md 전체 (자동 로드)
- PROJECT_STATE.md §4.2 (작업 B 정의), §6 (주의사항)
- db/schema.ts:440-481 (chat_rooms, chat_messages), :1069-1071 (전문가 관리 방식)
- netlify/functions/chat-*.ts (기존 채팅 권한 가드 구조)

## 작업 범위 (이 채팅에서만 작업)
PROJECT_STATE.md §4.2 의 신규/확장 파일 목록만. **신규 채팅 시스템 만들지 말고 chat_rooms 확장 방향**.

## 금지 영역
- 신규 chat 테이블 생성 금지 — 기존 chat_rooms / chat_messages 확장
- public/admin.html / public/mypage.html / public/admin.js / db/schema.ts: 본인 섹션 끝에만 추가
- lib/auth.ts, lib/admin-guard.ts: 변경 금지
- 다른 작업(A/C)의 신규/확장 파일: 일체 손대지 말 것

## 완료 조건
1. 마이그레이션 호출 성공 → schema.ts 활성화 → 삭제 커밋
2. 사용자 신고/유족지원 신청 → 어드민이 전문가 매칭 → 1:1 채팅방 자동 생성
3. 양측 모두 채팅 + 세션 종료 가능
4. 사용자 검증 완료 보고
5. PROJECT_STATE.md §4.2 진행률 100% 갱신

## 갱신 의무
- §4.2 진행률, 담당 채팅, 다음 할 일 / 종료 시 §2 행 추가

## 브랜치
feature/expert-matching-chat (베이스: origin/main)

자, CLAUDE.md + PROJECT_STATE.md 읽고 시작 보고해줘.
```

### 7.3 작업 C 채팅 (CSV 자동 매핑)

```
[작업 C — 6순위 #15 효성 + 기업은행 CSV 자동 매핑]

PROJECT_STATE.md 와 CLAUDE.md 를 먼저 읽고 작업해줘.

## 읽어야 할 섹션
- CLAUDE.md 전체 (자동 로드)
- PROJECT_STATE.md §4.3 (작업 C 정의), §6 (주의사항)
- lib/hyosung-parser.ts 전체 (인터페이스 통일 참고)
- public/cms-tbfa.html 구조 (탭 추가 위치)

## 작업 범위 (이 채팅에서만 작업)
PROJECT_STATE.md §4.3 의 신규/확장 파일 목록만. ibk-parser는 hyosung-parser와 동일 인터페이스로.

## 금지 영역
- 기존 hyosung-parser.ts 시그니처 변경 금지 (호출하는 곳 회귀 위험)
- public/admin.html / public/cms-tbfa.html / db/schema.ts: 본인 섹션 끝에만 추가
- lib/auth.ts, lib/admin-guard.ts: 변경 금지
- 다른 작업(A/B)의 신규/확장 파일: 일체 손대지 말 것

## 완료 조건
1. 마이그레이션 호출 성공 → schema 활성화 → 삭제
2. 어드민이 효성 CSV + 기업은행 CSV 업로드 → 자동 매칭 → 미확정 목록에서 확정 처리
3. 자동 매칭 점수가 표시되고 1건/일괄 확정 가능
4. 사용자 검증 완료 보고
5. PROJECT_STATE.md §4.3 진행률 100% 갱신

## 갱신 의무
- §4.3 진행률, 담당 채팅, 다음 할 일 / 종료 시 §2 행 추가

## 브랜치
feature/csv-donation-mapping (베이스: origin/main)

자, CLAUDE.md + PROJECT_STATE.md 읽고 시작 보고해줘.
```

---

## 8. 머지·검증 체크리스트 (모든 채팅 공통)

머지 전:
- [ ] `git fetch origin && git rebase origin/main` 충돌 해결
- [ ] CLAUDE.md §13 체크리스트 통과
- [ ] 마이그레이션 호출 성공 → schema 정의 활성화 → 함수 삭제 완료
- [ ] 캐시버스터 갱신
- [ ] 로컬 동작 확인 (npm run dev → 핵심 시나리오)

머지 후:
- [ ] Netlify 배포 확인 (1~2분)
- [ ] 사용자 검증 시나리오 안내
- [ ] §4.X 진행률 100% + §2 마지막 업데이트 행 추가 후 push
