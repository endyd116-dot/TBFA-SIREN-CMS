# PARALLEL_PLAN.md — SIREN 남은 작업 병렬 진행 설계

> **목적**: 여러 채팅을 병렬로 돌릴 때 각 채팅이 이 파일을 읽고 자기 작업 스코프와 충돌 회피 규칙을 파악할 수 있도록.
> **마지막 업데이트**: 2026-05-09 (5순위 #10 완료 직후)
> **베이스**: `main` 브랜치, 커밋 `1bda417` 이후

---

## 0. 전제

### 직전 완료 (참고)
- 4순위 자잘 버그 3건: 후원 모달 3초 딜레이, 회원 엑셀, 수납내역 엑셀
- 5순위 #1 블랙 통합, #9 관련 사이트, #10 정기후원 해지 안내

### 남은 작업 분류
- **즉시 병렬 가능 (3건)**: 6순위 큰 기능 — **작업 A / B / C**
- **추후 분석**: Phase 4~22 (19개) — 스펙 미정, §9 참고

### 사전 확인 (모든 채팅 공통)
1. `CLAUDE.md` 필독 — 코딩 컨벤션 §6, 회귀 위험 §9, 자율 권한 §6.9
2. **마이그레이션 호출은 사용자 액션** — AI는 함수만 작성, 호출은 사용자가 직접
3. `requireAdmin` 반환 필드는 `auth.res` (response 아님)
4. 신규 함수에 `export const config = { path: "/api/..." }` 누락 금지
5. **schema.ts 컬럼 정의는 마이그레이션 적용 후에 추가** (역순 금지)

---

## 1. 작업 정의

### 작업 A — 6순위 #6: 교원 회원 자격 변경 시스템
**목적**: 회원이 본인 자격(현직/은퇴/예비/일반 등) 변경 신청 → 어드민 심사 → 승인/반려 → 등급·권한 갱신
**예상 시간**: 12~15h
**브랜치**: `feature/eligibility-change`

#### 1.1 신규 파일
| 경로 | 역할 |
|---|---|
| `netlify/functions/eligibility-request.ts` | 사용자 신청 POST |
| `netlify/functions/eligibility-status.ts` | 사용자 본인 신청 내역 GET |
| `netlify/functions/admin-eligibility-list.ts` | 어드민 심사 대기 목록 |
| `netlify/functions/admin-eligibility-review.ts` | 어드민 승인/반려 |
| `netlify/functions/migrate-add-eligibility-change.ts` | 1회용 마이그 (eligibility_change_requests + members 컬럼) |
| `public/js/mypage-eligibility.js` | 마이페이지 자격 변경 모듈 |
| `public/js/admin-eligibility.js` | 어드민 심사 모듈 |

#### 1.2 확장 파일 (다른 작업과 충돌 가능 → §7 참조)
- `db/schema.ts` — `eligibilityChangeRequests` 테이블 + `members.eligibilityType` 컬럼 추가
- `public/mypage.html` — "자격 변경" 탭 추가 + 스크립트 include
- `public/admin.html` — "자격 심사" 메뉴 추가 + 스크립트 include
- `public/js/admin.js` — 라우터 등록 (1줄)
- `lib/audit.ts` — 자격 변경 로그 (옵션, append-only)

#### 1.3 핵심 데이터 모델 (제안)
```sql
-- 신규 테이블
CREATE TABLE eligibility_change_requests (
  id serial PRIMARY KEY,
  member_id int NOT NULL REFERENCES members(id),
  current_type varchar(30),      -- 변경 전 (스냅샷)
  requested_type varchar(30),    -- 변경 신청 자격
  reason text,
  evidence_blob_id int,          -- 증빙 (선택)
  status varchar(20) DEFAULT 'pending', -- pending/approved/rejected
  admin_note text,
  reviewed_by int REFERENCES admins(id),
  reviewed_at timestamp,
  created_at timestamp DEFAULT now()
);
-- members 테이블 컬럼 추가 (현재 없음 — Grep 확인됨)
ALTER TABLE members ADD COLUMN eligibility_type varchar(30);
```

---

### 작업 B — 6순위 #8: 변호사·심리상담사 ↔ 사용자 1:1 매칭 채팅
**목적**: 사용자가 SIREN 신고/유족지원 신청 시 전문가 매칭 → 1:1 전용 채팅방 + 세션 관리
**예상 시간**: 15~18h
**브랜치**: `feature/expert-matching-chat`

#### 2.1 기존 인프라 (활용 가능)
- 전문가는 이미 `members.type='volunteer'` + `member_subtype='lawyer'/'counselor'`로 관리됨 (`db/schema.ts:1069-1071`)
- `chat_rooms`, `chat_messages` 테이블 존재 (`db/schema.ts:440-481`)
- `assigned_expert_name` 컬럼 일부 도메인에 존재
- 즉, **신규 채팅 시스템 만들지 말고 chat_rooms 확장(room_type='expert_1on1')**

#### 2.2 신규 파일
| 경로 | 역할 |
|---|---|
| `netlify/functions/expert-match-request.ts` | 사용자 매칭 요청 |
| `netlify/functions/expert-match-list.ts` | 본인 매칭 목록 |
| `netlify/functions/admin-expert-list.ts` | 어드민 전문가 목록 (members 필터) |
| `netlify/functions/admin-expert-assign.ts` | 어드민 매칭 승인 + 채팅방 생성 |
| `netlify/functions/expert-session-end.ts` | 세션 종료 (양측 가능) |
| `netlify/functions/migrate-expert-matching.ts` | 1회용 마이그 (expert_matches 테이블) |
| `public/js/mypage-expert-match.js` | 마이페이지 매칭/세션 |
| `public/js/admin-expert.js` | 어드민 전문가·매칭 관리 |

#### 2.3 확장 파일 (충돌 가능)
- `db/schema.ts` — `expertMatches` 테이블 추가 + `chatRooms.roomType` 컬럼 추가
- `netlify/functions/chat-*.ts` — 1:1 매칭 채팅의 권한 가드 강화 (member_id 외 expert_id도 확인)
- `public/mypage.html`, `public/admin.html` — 메뉴/탭
- `public/js/auth.js` — 채팅방 진입 시 type 분기 (옵션)

#### 2.4 핵심 데이터 모델 (제안)
```sql
CREATE TABLE expert_matches (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES members(id),
  expert_id int NOT NULL REFERENCES members(id),  -- volunteer + lawyer/counselor
  match_type varchar(20),           -- 'lawyer'/'counselor'
  source_domain varchar(30),        -- 'incident'/'harassment'/'legal'/'support' 등 발신 도메인
  source_id int,                    -- 발신 도메인 PK
  chat_room_id int REFERENCES chat_rooms(id),
  status varchar(20) DEFAULT 'pending',  -- pending/active/closed
  assigned_at timestamp,
  closed_at timestamp,
  closed_reason varchar(50),
  created_at timestamp DEFAULT now()
);
-- chat_rooms 확장
ALTER TABLE chat_rooms ADD COLUMN room_type varchar(20) DEFAULT 'general'; -- 'general'|'expert_1on1'
ALTER TABLE chat_rooms ADD COLUMN expert_id int REFERENCES members(id);
```

---

### 작업 C — 6순위 #15: 효성 + 기업은행 CSV 자동 매핑 + 후원 확정
**목적**: 기업은행 CSV 파서 신규 + 효성 CSV(기존 hyosung-parser.ts) 통합 + 자동 매칭 룰 + 미확정→확정 워크플로
**예상 시간**: 10~13h
**브랜치**: `feature/csv-donation-mapping`

#### 3.1 기존 인프라 (활용 가능)
- `lib/hyosung-parser.ts` 존재 (Phase 1 완료)
- `public/cms-tbfa.html` — 기부 통합 관리 페이지

#### 3.2 신규 파일
| 경로 | 역할 |
|---|---|
| `lib/ibk-parser.ts` | 기업은행 CSV 파서 |
| `lib/donation-matcher.ts` | 자동 매칭 룰 엔진 (이름·금액·날짜·계좌끝4자리) |
| `netlify/functions/admin-donation-import.ts` | CSV 업로드 (multipart) → pending_donations 적재 |
| `netlify/functions/admin-donation-pending-list.ts` | 미확정 후원 목록 |
| `netlify/functions/admin-donation-confirm.ts` | 후원 확정 (1건 또는 일괄) |
| `netlify/functions/migrate-add-pending-donations.ts` | 1회용 마이그 |
| `public/js/cms-tbfa-import.js` | CSV 업로드·매핑 UI 모듈 |

#### 3.3 확장 파일 (충돌 가능)
- `db/schema.ts` — `pendingDonations`, `donationMatchingRules` 테이블 추가
- `public/cms-tbfa.html` — "CSV 자동 매핑" 탭 추가 + 스크립트 include
- `public/admin.html` — 메뉴 등록
- `public/js/cms-tbfa.js` — 라우터 등록 (옵션)

#### 3.4 핵심 데이터 모델 (제안)
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
  match_score numeric(4,2),          -- 0~1 (자동 매칭 신뢰도)
  match_reason varchar(200),
  status varchar(20) DEFAULT 'pending', -- pending/confirmed/rejected
  confirmed_donation_id int REFERENCES donations(id),
  imported_by int REFERENCES admins(id),
  created_at timestamp DEFAULT now()
);
```

---

## 2. 의존성 매트릭스

|   | A 자격변경 | B 1:1 매칭 | C CSV 매핑 |
|---|---|---|---|
| **A** | — | 독립 | 독립 |
| **B** | 독립 | — | 독립 |
| **C** | 독립 | 독립 | — |

→ **3개 모두 도메인이 독립적**, 직렬 의존 없음. 동시 시작 가능.

---

## 3. 공유 파일 (충돌 위험 매트릭스)

| 파일 | A | B | C | 위험도 | 회피 전략 |
|---|---|---|---|---|---|
| `db/schema.ts` | ✅ | ✅ | ✅ | 🔴 **높음** | 파일 끝에 본인 섹션 헤더(`/* === 작업 X === */`) 추가, append-only |
| `public/admin.html` | ✅ | ✅ | ✅ | 🟡 중간 | 사이드바 `<nav>` 끝에 추가, 메뉴 라벨 명시 |
| `public/admin.js` | ✅ | ✅ | ✅ | 🟡 중간 | 작업별 `admin-{도메인}.js`로 분리, 라우터 등록은 1줄만 |
| `public/mypage.html` | ✅ | ✅ | — | 🟡 중간 | 탭 영역 끝에 추가 |
| `public/cms-tbfa.html` | — | — | ✅ | 🟢 낮음 | C 단독 |
| `public/js/auth.js` | — | ✅ | — | 🟢 낮음 | B 단독 (채팅 진입 분기만 추가) |
| `netlify/functions/chat-*.ts` | — | ✅ | — | 🟡 중간 | B만 영향, 가드 추가만 |
| `lib/audit.ts` | ✅ | ✅ | ✅ | 🟢 낮음 | append-only (logAdminAction 호출만) |
| `package.json` | — | — | △ | 🟢 낮음 | C가 csv 라이브러리 추가 가능 — Lock 충돌 시 npm install 재실행 |

---

## 4. 동시 진행 가능 여부

| 조합 | 가능 여부 | 비고 |
|---|---|---|
| A + B 병렬 | ✅ 가능 | mypage.html, admin.html 충돌 회피 규칙 준수 |
| A + C 병렬 | ✅ 가능 | schema.ts 외 공유 파일 거의 없음 (가장 안전) |
| B + C 병렬 | ✅ 가능 | mypage.html은 B만, cms-tbfa.html은 C만 |
| A + B + C 병렬 | ⚠️ 가능(주의) | schema.ts·admin.html 동시 수정 — 머지 시 수동 충돌 해결 1~2건 예상 |

---

## 5. 추천 진행 순서

### 권장: **부분 병렬** (충돌 최소화)
```
[1단계 동시 시작]
  ├─ 작업 C (가장 작음, ~10h) — schema 변경 가장 적음
  └─ 작업 A (중간, ~13h)

[2단계 — A 또는 C 머지 후 시작]
  └─ 작업 B (가장 큼, ~16h, chat 시스템 영향)
```

### 머지 순서 (충돌 최소화)
**C → A → B** (변경량 작은 → 큰 순)

각 단계마다 `git fetch && git rebase origin/main` 후 진행.

---

## 6. 브랜치 이름

| 작업 | 브랜치 | 베이스 |
|---|---|---|
| A | `feature/eligibility-change` | `origin/main` |
| B | `feature/expert-matching-chat` | `origin/main` |
| C | `feature/csv-donation-mapping` | `origin/main` |

각 채팅 시작 시:
```bash
git fetch origin
git checkout -b feature/{이름} origin/main
```

---

## 7. 충돌 위험 요소 + 대응 방안

### 7.1 db/schema.ts (🔴 가장 큰 위험)
- **원인**: 3개 작업 모두 신규 테이블 추가
- **회피**:
  1. 파일 **끝**에 본인 작업 섹션 추가 (다른 테이블 사이에 끼우지 말 것)
  2. 섹션 헤더 강제: `/* === 작업 A: 자격 변경 시스템 (6순위 #6) === */`
  3. import 라인 변경 시 알파벳 정렬 유지
  4. 머지 시 충돌 = 신규 섹션 모두 보존(둘 다 keep)
- **사후**: 첫 머지 후 push → 다음 작업은 `git rebase origin/main`으로 자동 흡수

### 7.2 public/admin.html (🟡 사이드바 메뉴 충돌)
- **원인**: 3개 작업이 메뉴 추가
- **회피**:
  1. 사이드바 `<nav class="sb-menu">` 영역 **끝**에 추가
  2. 각 메뉴 항목은 단일 `<a>` 태그 — 라인 단위 머지 가능
  3. emoji 라벨로 식별 가능하게: `🎓 자격 심사` (A), `⚖️ 전문가 매칭` (B), `📥 후원 자동 매핑` (C)

### 7.3 public/admin.js (🟡 라우터)
- **원인**: SPA 라우터에 신규 페이지 등록
- **회피**:
  1. **모든 신규 모듈은 `public/js/admin-{도메인}.js`로 분리**
  2. admin.js의 라우터 테이블에 1줄만 추가
  3. 라우터 객체 끝에 추가 (중간 삽입 금지)

### 7.4 마이그레이션 함수 (🟡 호출 순서)
- **원인**: 동시 적용 시 schema 충돌 가능
- **회피**:
  1. 작업별 prefix: `migrate-{도메인}-{이름}.ts`
  2. **호출 순서 = 머지 순서 (C → A → B)**
  3. 각자 호출 후 응답 확인 → 다음 작업 진행
  4. 모든 마이그레이션은 멱등 보장 (`IF NOT EXISTS`, 기존 키 스킵)
  5. 호출 후 즉시 파일 삭제 + 커밋 (CLAUDE.md §6.8)

### 7.5 캐시버스터 (🟢 낮음)
- **원인**: 동일 HTML 파일 동시 수정
- **회피**:
  1. 본인 변경 시 본인 파일만 갱신
  2. 머지 시점에 한 번 더 일괄 갱신 (필요시)
  3. 형식 통일: `?v=2026-05-09-N` (날짜 + 일련번호)

### 7.6 lib/auth.ts, lib/admin-guard.ts (🟢 매우 낮음)
- 이 파일은 **변경 금지** (회귀 위험 최고). 사용만.
- 변경이 꼭 필요하면 사용자에게 사전 확인 후 진행.

### 7.7 package.json / package-lock.json
- **원인**: 작업 C가 CSV 파싱 라이브러리 추가 가능 (papaparse 등)
- **회피**:
  1. 가능하면 신규 dep 없이 기존(SheetJS) 사용
  2. 추가 시 머지 후 `npm install` 재실행으로 lock 정리

---

## 8. 각 작업 채팅 시작 절차

```
1. CLAUDE.md, PARALLEL_PLAN.md 자기 작업 섹션 읽기
2. git fetch origin && git checkout -b feature/{이름} origin/main
3. 작업 진행 (마이그레이션 함수 + API + UI 단계별)
4. 사용자에게 마이그레이션 호출 안내 (?run=1)
5. 호출 응답 success → schema.ts 컬럼 정의 활성화 → 마이그레이션 함수 삭제 → 커밋·푸시
6. main 머지 전: git fetch && git rebase origin/main 충돌 해결
7. main 머지(또는 PR) → 배포 확인 → 사용자 검증
```

---

## 9. Phase 4~22 (추후 분석 필요)

스펙이 인수인계서에 미정. 별도 설계 세션 필요.

| Phase | 그룹 | 비고 |
|---|---|---|
| Phase 4 | 대표 보고 시스템 + Agent-9 | 핵심 인프라 |
| Phase 5~7 | 재정 관리 | 회계·예산·정산 |
| Phase 8~11 | 커뮤니케이션 | 알림·뉴스레터·일정 |
| Phase 12~15 | SIREN 서비스 고도화 | SIREN 3개 도메인 심화 |
| Phase 16~18 | 분석·경영 | 대시보드·KPI |
| Phase 19~22 | 품질·안정성 | 테스트·모니터링·보안 |

→ 6순위 3건 완료 후 별도 설계 세션에서 PARALLEL_PLAN.md v2 작성 권장.

---

## 10. 머지·검증 체크리스트 (모든 작업 공통)

머지 전:
- [ ] `git fetch origin && git rebase origin/main` 충돌 해결
- [ ] CLAUDE.md §13 체크리스트 통과
- [ ] 마이그레이션 호출 → 응답 success → schema 정의 활성화 → 함수 삭제 완료
- [ ] 캐시버스터 갱신
- [ ] 로컬 동작 확인 (npm run dev → 핵심 시나리오)

머지 후:
- [ ] Netlify 배포 완료 (1~2분)
- [ ] 사용자 검증 시나리오 안내 (어드민/사용자)
- [ ] CLAUDE.md §10 진행 상황 갱신 (옵션 — 큰 마일스톤만)

---

**문의·갱신**: 각 작업 채팅에서 추가 발견 사항이 있으면 이 파일을 수정 후 push. 다른 채팅이 다음 fetch에서 흡수.
