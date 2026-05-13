# Phase 20 — 어드민 UI/UX 전면 리뉴얼

> 설계 확정일: 2026-05-11
> 담당: 메인(설계·머지) / B(백엔드) / A(프론트) / C(검증)
> 선행 조건: Phase 17 검증 마감 + Phase 19 검증 마감 후 시작
> Phase 20-A 완전 리뉴얼은 거부됨(2026-05-14). 20-B·20-C는 점진 적용 완료. 인벤토리 파일은 삭제 (git 히스토리 참조).

---

## §0 결정 사항 요약

| 항목 | 결정 |
|---|---|
| 단계 구조 | **3단계** (20-A·20-B·20-C) — 각 1.5주, 총 4.5주 |
| 단계별 흐름 | 표준 패턴 (B·A 동시 mock → B 머지 → A 실API → C 검증) |
| 머지 전략 | **단계별 main 머지** + **`admin-legacy.html` 백업** 유지 (안전망) |
| 라이브 반영 | 단계마다 push (운영 전이므로 자유) |
| IA 그룹 | **9그룹** (대시보드·회원·후원·사이렌·유가족·발송·콘텐츠·AI 에이전트·시스템) |
| 디자인 톤 | 기존 미니멀 라이트 유지 + 토큰만 정돈 (CSS 변수) |
| 사이드바 | 아이콘 고정 + 호버 시 라벨 펼침 |
| 반응형 | 모바일까지 풀 반응형 (320px+) |
| 부가 기능 | Cmd+K 빠른 검색 + 즐겨찾기 + 최근 본 메뉴 |
| 추가 흡수 | 영수증 설정→후원 / AI 추천→AI 에이전트 / 익명 신원 식별→사이렌 사건 |
| 신규 테이블 | 2개 (`admin_favorites`, `admin_recent_views`) |
| 기존 화면 영향 | 35개 메뉴 → 9그룹 통합. URL hash 그대로 두고 메뉴 라벨·구조만 변경 |

---

## §1 IA 9그룹 최종 구조

```
🏠 대시보드 (단독)
   └ 통합 분석 대시보드 (기존 dashboard·unified-dashboard·ai 통합)

👥 회원·운영자
   ├ 회원 관리 (members + 자격 변경 + 가입 승인 4탭)
   ├ 운영자 관리
   └ 1:1 매칭 / 전문가 프로필 / 외부 기관 / 인계 이력 (4탭)

💰 후원·재정
   ├ 후원금 관리 (donations + 효성 + CSV 자동 매핑 + 영수증 설정 4탭)
   ├ 수입·예산·재무 보고서 (3탭)
   └ 캠페인 관리

🚨 사이렌 신고
   ├ 신고 처리 (사건·악성민원·법률·자유게시판 4탭, 익명 식별 사건 탭 안에 흡수)
   ├ 신고 통계
   └ 익명 감사 로그 (super_admin 전용)

🤝 유가족 지원·문의
   ├ 유가족 지원 관리
   └ 문의 관리 (채팅)

📨 알림·발송
   ├ 발송 작업 (즉시·예약)
   ├ 발송 템플릿
   ├ 수신자 그룹
   └ 발송 분석 + 알림 로그 (2탭)

📝 콘텐츠
   ├ 메인 화면 편집 (site-builder, 별도 유지)
   ├ 콘텐츠 관리
   └ 주간 보고서

🤖 AI 에이전트
   ├ AI 추천 센터 (구 ai)
   ├ AI 활동보고서 (구 activity-report)
   └ AI 자동 발송 트리거 (구 admin-auto-triggers)

⚙️ 시스템·보안
   ├ 시스템 설정
   └ 감사 로그 + 보안·감사 로그 (2탭)

🛠 워크스페이스 (그대로 토글)
```

---

## §2 단계 구조 + B·A·C 분배

### 단계 흐름 (표준 패턴)

```
1주차 월: 메인 트리거 → B 백 시작, A 프론트 mock 시작
1주차 금: B 푸시 → 메인 머지 → A에 실 API 신호
2주차 월: A 실 API 작업 + C 이전 단계 검증
2주차 화: A 푸시 → 메인 머지
2주차 수: C 검증 보고 → 메인 BUG fix 머지 → 단계 마감
2주차 목~다음주 화: 다음 단계 준비 (메인이 트리거 발송하며 다음 단계 시작)
```

각 단계 = 1.5주. 6주차 전체 완료. 메인이 매 단계 시작·머지·검증 트리거를 모두 운영.

---

### 20-A 기반 시스템 + 회원·사이렌 (1.5주)

**B 분담**
- `lib/css-tokens.css` 신규 (디자인 토큰: 컬러·여백·폰트·라운드·섀도)
- `db/schema.ts` 추가: `admin_favorites`(member_id, menu_key, created_at), `admin_recent_views`(member_id, menu_key, viewed_at, count)
- `netlify/functions/migrate-phase20-favorites.ts` (마이그레이션, 1회용)
- `netlify/functions/admin-favorites-list.ts` / `admin-favorites-toggle.ts`
- `netlify/functions/admin-recent-views-list.ts` / `admin-recent-views-record.ts`
- 회원 통합 응답: `admin-members-unified.ts` (members + operators + eligibility 한 번에)
- 사이렌 통합 응답: `admin-siren-unified.ts` (4종 + 익명 식별 사건 탭 통합)

**A 분담**
- `public/admin.html` 사이드바 9그룹 + 호버 펼침 + Cmd+K 마운트 div
- `public/css/admin-tokens.css` (B의 lib/css-tokens.css 참조)
- `public/css/admin-shell.css` (사이드바·헤더·콘텐츠 래퍼)
- `public/js/admin-shell.js` (사이드바 호버 동작·테마 토큰 적용)
- `public/admin-legacy.html` (현 admin.html 그대로 백업, 안전망)
- 회원 그룹 4탭 화면 (`admin-members-group.js`)
- 사이렌 그룹 4탭 화면 (`admin-siren-group.js`) — 익명 식별 사건 탭 안 흡수
- mock 모드 (`USE_MOCK = true`)

**C 분담** (20-A 머지 후)
- §4 시나리오 Q1~Q15 라이브 검증
- BUG fix → 보고서 `docs/verify/2026-05-11-phase20-a.md`

---

### 20-B 후원·재정 + 발송·AI 에이전트 (1.5주)

**B 분담**
- 후원 통합 응답: `admin-donations-unified.ts` (donations + 효성 + CSV 자동 매핑 + 영수증 설정 한 번에)
- 재정 통합 응답: `admin-finance-unified.ts` (수입·예산·재무 보고)
- 발송 통합 응답: `admin-send-unified.ts` (작업 + 템플릿 + 그룹 + 분석 + 알림 로그)
- AI 에이전트 통합 응답: `admin-ai-unified.ts` (추천 + 활동보고서 + 자동 트리거)
- 권한별 응답 분기 추가 (super_admin이 보는 정보 vs 일반 admin)

**A 분담**
- 후원 그룹 화면 (`admin-donations-group.js`) — 4탭 (후원·효성·CSV·영수증)
- 재정 그룹 화면 (`admin-finance-group.js`) — 3탭 (수입·예산·재무)
- 캠페인 관리 (그대로)
- 발송 그룹 화면 (`admin-send-group.js`) — 5메뉴 (작업·템플릿·그룹·분석+로그)
- AI 에이전트 그룹 화면 (`admin-ai-group.js`) — 3메뉴 (추천·활동보고서·자동 트리거)
- mock 모드

**C 분담** (20-B 머지 후)
- §4 시나리오 Q16~Q30 라이브 검증
- BUG fix → 보고서 `docs/verify/2026-05-11-phase20-b.md`

---

### 20-C 나머지 + 모바일 + 부가 기능 + 마감 (1.5주)

**B 분담**
- Cmd+K 전역 검색 API: `admin-global-search.ts` (메뉴·회원·후원자·신고 동시 검색)
- 권한 바인딩 검증 (admin/super_admin 분기 정확성 점검)
- 기존 API 응답 시간 회귀 점검 (Phase 18 캐싱과 충돌 없는지)

**A 분담**
- 유가족·문의 그룹 화면 (`admin-support-group.js`)
- 콘텐츠 그룹 화면 (`admin-content-group.js`) — 메인 화면 편집은 별도 유지
- 시스템·보안 그룹 화면 (`admin-system-group.js`) — 감사 로그 2탭
- Cmd+K 빠른 검색 UI (`admin-cmdk.js`)
- 즐겨찾기·최근 본 메뉴 사이드바 상단 위젯 (`admin-favorites.js`)
- **모바일 반응형 일괄 점검** (320px·768px·1024px breakpoint 전 화면 검증)
- mock → 실 API 일괄 전환

**C 분담** (20-C 머지 후)
- §4 시나리오 Q31~Q45 라이브 검증 (전체 최종 점검 포함)
- BUG fix → 보고서 `docs/verify/2026-05-11-phase20-c.md`
- **`admin-legacy.html` 폐기 결정 검토** (안정 확인 시 삭제 권고)

---

## §3 DB 설계

### 3.1 admin_favorites (즐겨찾기)

```typescript
export const adminFavorites = pgTable("admin_favorites", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  menuKey: varchar("menu_key", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberIdx: index("admin_fav_member_idx").on(t.memberId),
  uniqueFav: uniqueIndex("admin_fav_unique").on(t.memberId, t.menuKey),
}));
```

### 3.2 admin_recent_views (최근 본 메뉴)

```typescript
export const adminRecentViews = pgTable("admin_recent_views", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }).notNull(),
  menuKey: varchar("menu_key", { length: 100 }).notNull(),
  viewedAt: timestamp("viewed_at").defaultNow().notNull(),
  count: integer("count").default(1).notNull(),
}, (t) => ({
  memberIdx: index("admin_recent_member_idx").on(t.memberId),
  uniqueView: uniqueIndex("admin_recent_unique").on(t.memberId, t.menuKey),
}));
```

마이그레이션: `migrate-phase20-favorites.ts` (1회용, 호출 후 삭제)

---

## §4 검증 시나리오

### 20-A (Q1~Q15)
| Q | 시나리오 | 기대 결과 |
|---|---|---|
| Q1 | 어드민 로그인 → 사이드바 9그룹 표시 | 9개 1뎁스 그룹, 호버 시 라벨 펼침 |
| Q2 | 사이드바 호버 동작 | 아이콘만 → 호버 시 라벨 펼침 부드러움 |
| Q3 | 회원·운영자 그룹 → 회원 관리 진입 | 4탭 (회원·운영자·자격 심사·가입 승인) 표시 |
| Q4 | 회원 관리 4탭 전환 | 각 탭 데이터 정상 로드 (실 API) |
| Q5 | 사이렌 신고 그룹 → 신고 처리 진입 | 4탭 (사건·악성민원·법률·게시판) + 익명 식별 사건 탭 안 |
| Q6 | 사이렌 4탭 전환 | 각 탭 데이터 정상 |
| Q7 | 익명 식별 — 사건 탭 안 [신원 확인] 버튼 | 기존 외부 페이지 로직 동일하게 동작 |
| Q8 | 신고 통계 + 익명 감사 로그 | super_admin만 익명 감사 노출 |
| Q9 | 디자인 토큰 일관성 | 컬러·여백·폰트가 토큰 변수로 통일 |
| Q10 | `admin-legacy.html` 직접 접근 | 구 UI 그대로 표시 (안전망) |
| Q11 | TypeScript tsc --noEmit | 신규 0 errors |
| Q12 | API 응답 시간 회귀 | Phase 18 캐싱 효과 유지 |
| Q13 | 모바일 폰 시뮬레이션 (320px) | 사이드바·헤더 깨지지 않음 |
| Q14 | 회귀 점검 — 기존 동작 | 워크스페이스·후원·발송 등 영향 없음 |
| Q15 | URL hash 직접 입력 (#adm-members) | 새 회원 그룹 4탭 화면으로 라우팅 |

### 20-B (Q16~Q30)
| Q | 시나리오 | 기대 결과 |
|---|---|---|
| Q16 | 후원 그룹 → 후원금 관리 4탭 | 후원·효성·CSV·영수증 탭 정상 |
| Q17 | 효성 CMS+ 탭 | 매칭 키 phone 노출 정상 (Phase 18 마스킹 정책 준수) |
| Q18 | CSV 자동 매핑 탭 | 기존 cms-tbfa.html#csv-import 로직 그대로 |
| Q19 | 영수증 설정 탭 | 폼 동작 정상 |
| Q20 | 재정 3탭 (수입·예산·재무) | 각 탭 차트·표 정상 |
| Q21 | 캠페인 관리 | 기존 동작 동일 |
| Q22 | 발송 그룹 → 발송 작업 | 즉시·예약 정상 |
| Q23 | 발송 템플릿·수신자 그룹 | 기존 외부 페이지 로직 SPA 안에 흡수 |
| Q24 | 발송 분석 + 알림 로그 2탭 | 분석 차트 + 로그 테이블 |
| Q25 | AI 에이전트 → AI 추천 센터 | 기존 ai 화면 동일 |
| Q26 | AI 에이전트 → AI 활동보고서 | 기존 activity-report 동일 |
| Q27 | AI 에이전트 → AI 자동 발송 트리거 | 기존 auto-triggers 동일 |
| Q28 | 권한별 응답 분기 | super_admin과 admin이 보는 데이터 차이 정확 |
| Q29 | 모바일 (768px·320px) | 후원·재정·발송·AI 그룹 모두 깨지지 않음 |
| Q30 | 회귀 — 기존 외부 페이지 직접 접근 | 자체 페이지 그대로 동작 (마이그 미완 시 안전망) |

### 20-C (Q31~Q45)
| Q | 시나리오 | 기대 결과 |
|---|---|---|
| Q31 | 유가족 지원 + 문의 채팅 | 정상 |
| Q32 | 콘텐츠 관리 + 메인 화면 편집 (별도 유지) | 정상 |
| Q33 | 콘텐츠 → 주간 보고서 | 정상 |
| Q34 | 시스템 설정 + 감사 로그 2탭 | super_admin만 보안 감사 탭 노출 |
| Q35 | Cmd+K 단축키 | 모달 표시 + 메뉴·회원·후원·신고 검색 작동 |
| Q36 | Cmd+K 키보드 네비게이션 | ↑↓ Enter 작동 |
| Q37 | 즐겨찾기 메뉴 토글 | 사이드바 상단에 즉시 표시 |
| Q38 | 최근 본 메뉴 자동 기록 | 메뉴 클릭 시 자동 갱신 (admin_recent_views) |
| Q39 | 모바일 320px·768px·1024px 전 그룹 일괄 | 모든 화면 깨짐 0 |
| Q40 | TypeScript tsc --noEmit | 신규 0 errors |
| Q41 | API 회귀 — Phase 1~19 모든 기능 | 영향 0 |
| Q42 | URL hash 호환성 | 모든 기존 hash가 새 그룹으로 자동 매핑 |
| Q43 | `admin-legacy.html` 폐기 검토 | 한 주 안정 확인 시 삭제 권고 보고 |
| Q44 | 디자인 토큰 회귀 | 모든 페이지에서 컬러·여백 일관성 |
| Q45 | 키보드 단축키 충돌 점검 | Cmd+K 외 단축키와 충돌 없음 |

---

## §5 mock 데이터 정의 (B·A 동시 작업용 키)

각 단계 시작 시 메인이 mock 응답 키를 확정해 B·A에 공유. 응답 키 변경 시 양쪽 동기화.

| 단계 | 통합 API | 응답 키 (mock·실 API 동일) |
|---|---|---|
| 20-A | admin-members-unified | `{ ok, members[], operators[], eligibility[], totalCount }` |
| 20-A | admin-siren-unified | `{ ok, incidents[], harassment[], legal[], board[], anonRevealCases[] }` |
| 20-B | admin-donations-unified | `{ ok, donations[], hyosung[], csvMapping[], receiptSettings }` |
| 20-B | admin-finance-unified | `{ ok, income, budget, report }` |
| 20-B | admin-send-unified | `{ ok, jobs[], templates[], groups[], analytics, logs[] }` |
| 20-B | admin-ai-unified | `{ ok, recommendations[], activityReports[], autoTriggers[] }` |
| 20-C | admin-global-search | `{ ok, menus[], members[], donors[], reports[] }` |

각 통합 API는 권한 바인딩 적용:
- super_admin: 전체 데이터
- admin: 권한 범위 데이터만 (effort: `auth.role === 'super_admin'` 분기)

---

## §6 채팅 시작 프롬프트

각 단계 시작 시 메인이 아래 트리거를 발송. 단계마다 4개 트리거 (B·A·C·메인 본인 머지 체크).

### 6.1 단계 20-A 트리거 — B 채팅

```
[B — Phase 20-A 기반 시스템 + 회원·사이렌 백엔드]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase20a-back ← git checkout -b feature/phase20a-back origin/main
설계서: docs/milestones/2026-05-11-phase20-admin-renewal.md §2 20-A

영역: lib/, netlify/functions/, db/schema.ts, drizzle/
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━ 신규 파일 7개 ━━━
lib/css-tokens.css                           ← 디자인 토큰 CSS 변수
netlify/functions/migrate-phase20-favorites.ts (1회용)
netlify/functions/admin-favorites-list.ts
netlify/functions/admin-favorites-toggle.ts
netlify/functions/admin-recent-views-list.ts
netlify/functions/admin-recent-views-record.ts
netlify/functions/admin-members-unified.ts
netlify/functions/admin-siren-unified.ts

━━━ 수정 파일 1개 ━━━
db/schema.ts — 파일 끝에 /* === Phase 20 === */ 섹션 헤더 + admin_favorites + admin_recent_views

━━━ 응답 키 (메인 확정 — A와 동일) ━━━
admin-members-unified:    { ok, members[], operators[], eligibility[], totalCount }
admin-siren-unified:      { ok, incidents[], harassment[], legal[], board[], anonRevealCases[] }
admin-favorites-list:     { ok, favorites: [{ menuKey, createdAt }] }
admin-favorites-toggle:   { ok, action: 'added' | 'removed' }
admin-recent-views-list:  { ok, recentViews: [{ menuKey, viewedAt, count }] }
admin-recent-views-record: { ok }

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/phase20a-back
  □ npx tsc --noEmit 신규 0 errors
  □ schema.ts 끝에 Phase 20 섹션 헤더 + admin_favorites/recent_views 정의
  □ 마이그레이션 함수 작성 (호출 후 즉시 삭제 예정)

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약
```

### 6.2 단계 20-A 트리거 — A 채팅

```
[A — Phase 20-A 기반 시스템 + 회원·사이렌 프론트 mock]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase20a-front ← git checkout -b feature/phase20a-front origin/main
설계서: docs/milestones/2026-05-11-phase20-admin-renewal.md §2 20-A

영역: public/
금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/HANDOFF.md, docs/

━━━ 신규 파일 7개 ━━━
public/admin-legacy.html (현 admin.html 그대로 복사 — 안전망)
public/css/admin-tokens.css
public/css/admin-shell.css
public/js/admin-shell.js          ← 사이드바 호버·테마·라우팅
public/js/admin-members-group.js  ← 회원 그룹 4탭 (mock 모드)
public/js/admin-siren-group.js    ← 사이렌 그룹 4탭 + 익명 식별 사건 탭 (mock 모드)

━━━ 수정 파일 1개 ━━━
public/admin.html
  · 사이드바 9그룹 구조 + 호버 펼침 마운트
  · Cmd+K 마운트 div (20-C에서 채워짐)
  · 9그룹 모든 섹션 div (mock 단계는 비어있어도 됨, 단 20-A의 회원·사이렌 그룹은 채워짐)

━━━ mock 응답 키 (메인 확정, B와 동일) ━━━
USE_MOCK = true 모드로 다음 키 그대로 사용:
admin-members-unified:    { ok, members[], operators[], eligibility[], totalCount }
admin-siren-unified:      { ok, incidents[], harassment[], legal[], board[], anonRevealCases[] }
admin-favorites-list, toggle, recent-views-list, record (즐겨찾기·최근 본은 20-C에서 본격 사용)

━━━ push 전 체크 ━━━
  □ 브랜치명: feature/phase20a-front
  □ admin-legacy.html 백업 완료 (현 admin.html 100% 동일)
  □ admin.html 사이드바 9그룹 + 호버 동작 확인
  □ 회원·사이렌 그룹 4탭 mock 표시 정상

push 후 메인에 보고: 브랜치명·커밋 해시·변경 파일 요약
```

### 6.3 단계 20-A 트리거 — C 채팅 (B+A 머지·실API 연결 후)

```
[C — Phase 20-A 라이브 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase20a (베이스 main @ {머지 후 커밋})
정독: docs/milestones/2026-05-11-phase20-admin-renewal.md §4 (Q1~Q15)

작업 순서:
  1) §4 Q1~Q15 시나리오 순서대로 실행·기록
  2) bug 발견 시 fix 커밋 → 메인 보고
  3) 보고서 docs/verify/2026-05-11-phase20-a.md 작성
  4) push → 메인 보고

표현 규칙: 함수명·코드 용어 없이 사용자 동작·결과 위주.
금지: PROJECT_STATE.md, docs/HANDOFF.md 수정.
```

### 6.4 단계 20-B / 20-C 트리거

20-A와 동일 구조. 20-A 머지 마감 후 메인이 본 설계서 §2 20-B / §2 20-C 분담을 따라 트리거 작성·발송.

---

## §7 라운드 마감 체크리스트

### 20-A 마감
- [ ] feature/phase20a-back B push + 응답키 메인 검증
- [ ] Phase 20 마이그레이션 호출 (Swain) → schema 활성화 + 마이그 파일 삭제
- [ ] feature/phase20a-back B 머지
- [ ] feature/phase20a-front A 머지
- [ ] A에 실 API 연결 신호 (USE_MOCK → false)
- [ ] feature/phase20a-live A 머지
- [ ] verify/phase20a C 검증 보고 → BUG fix 머지
- [ ] PROJECT_STATE.md §5 Phase 20-A → ✅ 100%

### 20-B 마감
- [ ] (위와 동일 7단계 반복)
- [ ] PROJECT_STATE.md §5 Phase 20-B → ✅ 100%

### 20-C 마감
- [ ] (위와 동일 7단계 반복)
- [ ] **`admin-legacy.html` 폐기 검토 (안정 확인 후 삭제)**
- [ ] PROJECT_STATE.md §5 Phase 20 → ✅ 100% 종합 갱신

---

## §8 위험 관리

| 위험 | 대응 |
|---|---|
| URL hash 호환성 깨짐 | A가 admin.html에서 기존 hash → 새 그룹 자동 매핑 (예: `#adm-members` → 회원 그룹의 회원 탭) |
| 사이드바 9그룹 이외 메뉴 호출 | 라우팅에서 처리 안 되는 hash는 admin-legacy.html로 자동 폴백 |
| Phase 18 캐싱 회귀 | 통합 API에서 기존 캐시 키 보존 (cache key invalidation 정책 메인 확인) |
| super_admin 분기 빠짐 | C 검증에서 권한별 시나리오 필수 포함 (Q8·Q28·Q34) |
| Cmd+K 단축키 충돌 | 운영자 키맵에서 제외 키 확인 후 Ctrl+K도 매핑 |
| 모바일 사이드바 토글 | 햄버거 버튼으로 fallback (768px 미만) |

---

## §9 변경 이력

| 일시 | 작성 | 내용 |
|---|---|---|
| 2026-05-11 | 메인 | 신설 — 9그룹 IA + 3단계 구조 + 표준 패턴 분담 + 시나리오 45개 |
