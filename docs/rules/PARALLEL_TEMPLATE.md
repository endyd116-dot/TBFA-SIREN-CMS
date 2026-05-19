# PARALLEL_TEMPLATE.md — 라운드 설계서 표준 양식

> **용도**: 메인(Opus 4.7)이 새 라운드를 시작할 때 이 파일을 복사해서 빈 칸을 채운다.
> **저장 위치**: `docs/milestones/{YYYY-MM-DD}-phase{N}-r{M}-{키워드}.md`
> **목적**: Sonnet 4.6(A·B)이 헤매지 않도록 모든 결정을 미리 못박는다.
> **참조**: [`PARALLEL_GUIDE.md`](PARALLEL_GUIDE.md) §1·§2 (역할·머지 순서)

---

## ▼▼▼ 아래 양식을 그대로 복사 ▼▼▼

# Phase {N} R{M} — {라운드 제목}

> **작성**: {YYYY-MM-DD} / 메인 채팅
> **상위 Phase**: Phase {N} {Phase 제목} ([카탈로그](2026-05-10-phase10-22-catalog.md) 또는 별도 설계서)
> **추정**: 메인 설계 {Xh} / B 백 {Xh} / A 프론트 {Xh} / C 검증 {Xh} / 합계 {X~Yh}
> **모드**: 직렬 / 평행 / 평행+단계머지 (택 1, 사유 명시)

---

## 1. DB 설계 (B용)

### 1.1 신규 테이블

```typescript
// db/schema.ts 끝에 추가 — 마이그 호출 후 활성화
export const {tableName} = pgTable("{table_name}", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  // ... 컬럼
}, (t) => ({
  // ... 인덱스
}));
```

### 1.2 기존 테이블 컬럼 추가

| 테이블 | 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|---|
| {tableName} | {colName} | {type} | NULL/NOT NULL/DEFAULT/UNIQUE/FK | {용도} |

### 1.3 마이그레이션 SQL

```sql
-- IF NOT EXISTS · 멱등 보장
CREATE TABLE IF NOT EXISTS {table_name} (...);
ALTER TABLE {existing_table} ADD COLUMN IF NOT EXISTS {col} {type};
CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name}({col});
-- 시드(필요 시)
INSERT INTO {table_name} (...) VALUES (...) ON CONFLICT DO NOTHING;
```

### 1.4 schema.ts import 점검

- [ ] 사용 타입 모두 import 라인 포함: `bigserial`, `numeric`, `jsonb` 등
- [ ] DB 적용 전 schema 정의는 **주석 처리** (마이그 후 활성화)

---

## 2. API 명세 (B용)

### 2.1 함수 목록

| 함수 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `netlify/functions/{name}.ts` | `/api/{path}` | GET/POST | requireAdmin / requireActiveUser / public | {설명} |

### 2.2 함수별 상세

#### `{함수명}` (`{경로}` {메서드})

**권한**: `requireAdmin` / `requireActiveUser` / public

**요청**:
```json
{ "{field}": "{type}" }
```

**응답 (성공)**:
```json
{ "ok": true, "{key}": "{value}" }
```

**응답 (실패)**:
```json
{
  "ok": false,
  "error": "{user-facing}",
  "step": "{auth|validate|select_X|insert|map|...}",
  "detail": "{...}",
  "stack": "{...}"
}
```

**처리 단계** (try/catch step 라벨 그대로):
1. `auth` — 권한 가드
2. `validate` — body 검증
3. `select_{X}` — 의존 데이터 조회
4. `insert` 또는 `update` — 본 처리
5. `map` — 응답 매핑

**필수 체크**:
- [ ] `export const config = { path: "/api/{path}" }`
- [ ] `requireAdmin` 반환은 `auth.res` (response 아님)
- [ ] 보조 SELECT는 try/catch + 빈 배열 fallback

### 2.3 `lib/` 헬퍼 (있을 시)

| 헬퍼 파일 | 시그니처 | 용도 |
|---|---|---|
| `lib/{name}.ts` | `{fn}({...})` → `{return}` | {설명} |

---

## 3. 화면 명세 (A용)

### 3.1 페이지 목록

| 페이지 | 경로 | 진입점 | 권한 |
|---|---|---|---|
| `public/{name}.html` | `/{path}` | {헤더 메뉴 위치 / SPA 진입} | {사용자/어드민} |

### 3.2 페이지별 와이어프레임

#### `{페이지명}` (`/{경로}`)

```
┌─ {페이지 제목} ─────────────────────┐
│                                       │
│  [필드 1: {타입}]  [필드 2]            │
│                                       │
│  ┌─{표/카드/탭}──────────────┐         │
│  │ {컬럼·행·동작}            │         │
│  └──────────────────────────┘         │
│                                       │
│  [버튼 1: {동작}]  [버튼 2]           │
└───────────────────────────────────────┘
```

### 3.3 사용자 동작 → API 매핑

| 사용자 동작 | 호출 API | 요청 body | 응답 처리 | 에러 토스트 |
|---|---|---|---|---|
| {버튼·폼·진입} | `{함수}` | `{...}` | `{화면 갱신}` | `"{문구}"` |

### 3.4 토스트·문구 모음

| 상황 | 문구 |
|---|---|
| 성공 | "{...}" |
| 실패 | "{서버 detail 노출}" |
| 검증 실패 | "{...}" |

### 3.5 캐시버스터

신규 또는 변경된 JS·CSS 파일 목록:
- `public/{name}.js?v={N+1}`
- `public/{name}.css?v={N+1}`

---

## 4. 검증 시나리오 (C용)

### 4.1 라이브 시나리오 (Q1~Qn)

| # | 시나리오 (사용자 동작) | 기대 동작 (사용자가 보는 결과) |
|---|---|---|
| Q1 | {로그인 → 메뉴 진입 → 동작} | {화면 결과 + DB 변경 결과} |
| Q2 | {경계 케이스} | {기대 결과} |
| Q3 | {에러 케이스} | {기대 에러 표시} |

> 시나리오는 **함수명·코드 용어 없이 사용자 동작·결과 위주**로 (CLAUDE.md §6.14).

### 4.2 회귀 점검 영역

이번 변경이 깨뜨릴 수 있는 기존 기능 목록:
- {기존 화면 1} — {확인 방법}
- {기존 흐름 2} — {확인 방법}
- 어드민 로그인 (광범위 회귀 점검 — schema 변경 시 항상)

### 4.3 백필 필요 여부

- [ ] 백필 불필요
- [ ] 백필 필요 → 1회용 마이그 작성: `migrate-{이름}.ts` / SQL 초안: {...}

---

## 5. 머지 순서·환경변수

### 5.1 머지 모드

- [ ] 직렬 (B 머지 → A 시작)
- [ ] 평행 (A는 mock으로 시작)
- [ ] 평행 + 단계 머지 (B 2회 머지)

사유: {...}

### 5.2 머지 순서

```
1. B push → 메인이 main 머지 → push
2. Netlify 배포 1~3분 대기
3. 메인이 Swain께 마이그 호출 안내: /api/migrate-{이름}?run=1
4. Swain 응답 보고 → 메인 또는 C가 schema 활성화·마이그 파일 삭제 → push
5. A push → 메인이 main 머지 → push
6. C 검증 트리거 → C push → 메인 머지 → 라운드 마감
```

### 5.3 신규 환경변수 (Swain 등록)

| 키 | 용도 | 필수 시점 |
|---|---|---|
| `{KEY}` | {설명} | B 머지 후 / 외부 심사 통과 후 / 운영 전환 시 |

---

## 6. 4채팅 시작 프롬프트 (Swain 복붙용)

### 6.1 메인 (Opus 4.7) — 이미 작업 중이므로 생략 (이 설계서가 산출물)

### 6.2 B 채팅 — 백 구현

> **체크박스 패턴 (2026-05-12 도입)**: Sonnet 4.6은 일반 지시("§2 명세 그대로")보다 **체크박스 항목별 매핑**에 훨씬 충실. 메인이 라운드별로 설계서 §1·§2의 모든 항목을 체크박스로 1:1 변환해서 박을 것. 아래 양식의 `{체크박스 §1}`·`{체크박스 §2}` 자리에 라운드 고유 체크리스트 채움.

```
[B — Phase {N} R{M} 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/phase{N}-r{M}-back (베이스 main @ {커밋})
정독 (필수): docs/milestones/{날짜}-phase{N}-r{M}-{키워드}.md §1·§2
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담), §7 (자체 검증)

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example, package.json
금지: public/, assets/, PROJECT_STATE.md, docs/HANDOFF.md, docs/ (상태 기록은 push 후 메인에 보고 텍스트로만)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§1 DB 체크리스트 (설계서 §1.1·§1.2·§1.3 1:1 매핑)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{체크박스 §1 — 라운드별 채움. 예시:
  - [ ] §1.1 신규 테이블 N개 정의 추가 (이름 정확히): {tableA}, {tableB}, ...
  - [ ] §1.2 컬럼 추가 — {tableX}: {col1}/{col2} / {tableY}: {col3}
  - [ ] §1.3 SQL 멱등 — IF NOT EXISTS (테이블·컬럼·인덱스) / ON CONFLICT 또는 WHERE NOT EXISTS (시드)
  - [ ] §1.4 import 라인에 사용 타입 모두 — bigserial / numeric / boolean / date / time / jsonb / uniqueIndex 누락 점검
  - [ ] schema.ts append-only — 파일 끝에 /* === Phase {N} R{M} === */ 헤더 후 추가, 다른 라운드 정의 덮어쓰기 금지
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§2 API 체크리스트 (설계서 §2.1·§2.2·§2.3 1:1 매핑)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{체크박스 §2 — 라운드별 채움. 예시:
  - [ ] §2.1 함수 신규 N개 + 수정 M개 — 표 그대로 (경로·메서드·권한 일치)
  - [ ] §2.2 응답 구조 — 키명 1글자도 안 바꿈 (예: actionUrl·assignedTo·sourceType·sourceId 그대로)
  - [ ] §2.2 처리 단계 step 라벨 — auth/validate/select_X/insert/map (설계서 그대로)
  - [ ] §2.3 lib/ 헬퍼 시그니처 — 함수 이름·인자·반환 타입 §2.3 그대로
  - [ ] 표준 응답 패턴 — export const config = { path } (cron 제외) / requireAdmin 반환 auth.res / 응답 키 다중 fallback (data.X || X) / try/catch step·detail·stack
  - [ ] 보조 SELECT 실패 시 빈 배열 fallback (메인 데이터로만 응답)
}

작업 순서:
  1) 마이그레이션 함수 작성 (1회용·requireAdmin·GET ?run=1·멱등)
  2) schema.ts 정의 추가 (주석 상태 — 마이그 후 활성화)
  3) lib/ 헬퍼 작성 (있으면)
  4) API 함수 — §2 명세 그대로
  5) `npx tsc --noEmit` 통과 후 push

⚠️ schema 격차 발견 시 (가정한 테이블·컬럼이 실재 X 등): 추측해서 코드 작성 금지. 실제 schema 정독·grep 후 적응안 적용 + 메인에 사후 보고 (2026-05-12 사고 패턴 — adminUsers 가정 등).

push 후 메인에 보고:
  - 브랜치명·커밋 해시·변경 파일 요약
  - 위 체크박스 모두 체크된 상태인지 한 줄 명시
  - schema 격차·적응안 적용한 경우 별도 표로 정리
```

### 6.3 A 채팅 — 프론트 구현

> **체크박스 패턴 + mock 임베드 (2026-05-12 도입)**: Sonnet 4.6용.
> 1) §3 화면 명세를 페이지·모달·동작 단위로 1:1 체크박스 변환
> 2) **mock JSON은 트리거에 그대로 임베드** (설계서 §3.3·§5 참조 금지 — Sonnet은 긴 설계서 끝까지 안 읽음. memory/feedback_design_routine.md §4 정책)
> 3) 응답 키는 1글자도 안 바꿈 — B §2.2와 1:1 일치

```
[A — Phase {N} R{M} 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/phase{N}-r{M}-front (베이스 main @ {커밋})
정독 (필수): docs/milestones/{날짜}-phase{N}-r{M}-{키워드}.md §3
참고: docs/PARALLEL_GUIDE.md §3 (영역 분담)

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, .env.example, PROJECT_STATE.md, docs/HANDOFF.md, docs/ (상태 기록은 push 후 메인에 보고 텍스트로만)

모드: {직렬 / 평행 mock / 평행 단계머지}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
mock 데이터 (B 머지 전 사용 — 응답 키는 1글자도 안 바꿈)
※ 메인이 라운드별로 직접 JSON 임베드 (설계서 §3.3·§5 참조 금지)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{모든 API 응답을 JSON 예시로 그대로 — A가 설계서 안 읽고 트리거만 봐도 작업 가능해야 함}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§3 화면 체크리스트 (설계서 §3.1·§3.2·§3.3·§3.4·§3.5 1:1 매핑)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{체크박스 §3 — 라운드별 채움. 예시:
  - [ ] §3.1 신규 페이지 N개 + 수정 M개 — 모두 존재
  - [ ] §3.2 와이어프레임 — 모든 필드·버튼·탭·모달 ID 그대로
  - [ ] §3.3 사용자 동작 → API 매핑 — 모든 행 동작 구현
  - [ ] §3.3 응답 키 사용 — §2.2 명세 키명 그대로 (1글자도 안 바꿈)
  - [ ] §3.4 토스트 문구 — 정확히 일치 (한국어 그대로)
  - [ ] §3.5 캐시버스터 — 변경된 모든 JS·CSS 버전 갱신
  - [ ] 권한 조건부 노출 — 어드민/일반 운영자/사용자 권한별 분기 정확히
  - [ ] api() 헬퍼 사용 (이중 stringify 금지) / 401 시 자동 admin.html 리다이렉트 유지
  - [ ] public/ 외 파일 변경 0
}

⚠️ mock 키 ↔ B 응답 키 불일치 위험: §2.2 응답 키를 1글자도 바꾸지 말 것 (snake_case·camelCase 등 임의 변환 금지). 머지 후 코드 변경 폭증 사고 패턴.

push 후 메인에 보고:
  - 브랜치명·커밋 해시·변경 파일 요약
  - 위 체크박스 모두 체크된 상태인지 한 줄 명시
  - mock 사용한 위치 목록 (B 2차 머지 후 실 API 전환 대비)
```

### 6.4 C 채팅 — 검증·fix

```
[C — Phase {N} R{M} 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/phase{N}-r{M} (베이스 main @ {머지 후 커밋})
정독: docs/milestones/{날짜}-phase{N}-r{M}-{키워드}.md §4
참고: docs/PARALLEL_GUIDE.md §7 (검증 책임), §8 (대기열)

작업 순서:
  1) §4.1 Q1~Qn 라이브 시나리오 (사용자 동작·결과 기록)
  2) §4.2 회귀 점검 영역 1건씩 확인
  3) bug 발견 시 fix 커밋 (브랜치 그대로) → 메인 보고
  4) §4.3 백필 필요 시 1회용 마이그 작성·Swain 호출 안내·삭제
  5) 보고서 docs/verify/{날짜}-phase{N}-r{M}.md 작성
  6) push → 메인 보고

표현 규칙 (CLAUDE.md §6.14):
  - 함수명·코드 용어 없이 사용자 동작·결과 위주
  - 예) "회원 명단 화면에 진짜 7명 표시" (O), "DEMO_* 제거 + cms-tbfa.js fetch" (X)
```

---

## 7. 라운드 마감 체크리스트 (메인)

- [ ] B·A·C 모두 머지 완료
- [ ] C 보고서 push 완료
- [ ] 라이브 검증 결과 모두 PASS (또는 fix 후 재검증 PASS)
- [ ] PROJECT_STATE §2 마지막 업데이트 행 추가
- [ ] PROJECT_STATE §5 마일스톤 진행률 갱신
- [ ] 다음 라운드 설계서 작성 시작 또는 다음 Phase 진입

---

**템플릿 마지막 갱신**: 2026-05-12 (§6.2·§6.3 체크박스 패턴 + mock 트리거 임베드 강제 — memory/feedback_design_routine.md §4와 정합)
