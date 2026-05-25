# RAG 검색 인프라 — 검증 보고서

> 검증: 2026-05-26 / C 채팅 (Opus 4.7)
> 브랜치: verify/rag-search-r1 (베이스 origin/main @ ea1d831)
> 설계서: docs/active/2026-05-26-rag-search.md
> 모드: 코드·DB 정합 검증 (라이브 어드민 세션 미가용 → Neon DB 직접 조회로 실상태 확인)

---

## 1. 검증 방식

라이브 어드민 세션은 C가 직접 띄울 수 없어, 두 축으로 검증했다.
1. **구현 코드 정합 정독**: lib·API 2종·AI 비서 주입·featureKey·schema·프론트 전 경로
2. **운영 DB 직접 조회**: pgvector 확장·테이블·인덱스·색인 문서 수·featureKey row (일회성 Node 스크립트, 조회 후 삭제)

---

## 2. Q1~Q5 시나리오 판정

| # | 시나리오 | 판정 | 사용자 관점 결과 |
|---|---|---|---|
| Q1 | 전체 재색인 | **FAIL → fix** | 재색인 눌러도 메뉴얼·Q&A 파일이 함수에 안 담겨 "0개 색인"으로 조용히 끝남 (BUG-3). included_files 추가로 fix |
| Q2 | 검색 테스트 | **조건부 PASS** | 색인된 문서가 있으면 유사도순 top-5 정상 표시 (코드·DB 경로 정합). Q1 fix 후 재색인해야 결과 나옴 |
| Q3 | RAG ON 질문 | **조건부 PASS** | 색인 데이터 있으면 질문 앞에 [참고 자료] 블록 주입 → 근거 반영 답변. 색인 0개면 주입 없이 기존 동작 |
| Q4 | RAG OFF 저장 | **부분 FAIL** | 토글 OFF가 DB에 반영 안 됨 (featureKey row 부재 — 기존 시스템 구조적 갭, RAG 신규 회귀 아님). 메인 보고 |
| Q5 | 재색인 멱등 | **PASS (코드)** | source_ref UNIQUE + ON CONFLICT DO UPDATE → 2회 실행해도 중복 없이 갱신. DB에 UNIQUE 인덱스(_src_uq) 확인 |

---

## 3. DB 실상태 (운영 Neon)

| 항목 | 결과 |
|---|---|
| pgvector 확장 | 설치됨 |
| ai_rag_documents 테이블 | 존재 (embedding vector 컬럼 포함) |
| 인덱스 | pkey · _src_uq(UNIQUE) · _hnsw(HNSW) 모두 존재 |
| 색인 문서 수 | **0개** (재색인 미실행 — 초기 색인 대기) |
| ai_rag_search featureKey row | **없음** (ai_feature_settings 21 row 중 부재) |

→ 마이그레이션(pgvector·테이블·인덱스)은 이미 적용 완료. 남은 건 초기 재색인 + featureKey row 시드.

---

## 4. 발견 BUG·fix

### BUG-1 (fix 완료) — 프론트가 가짜 데이터 모드로 머지됨
- **증상**: AI 설정의 RAG 화면이 실제 백엔드 대신 고정 가짜 데이터(문서 540개·고정 검색결과 3건)만 표시. 재색인·검색·현황 3경로 전부 mock.
- **원인**: 백엔드가 함께 머지(2ede14b)됐는데 프론트의 가짜데이터 스위치(`USE_RAG_MOCK`)가 켜진 채 남음.
- **fix**: 스위치 OFF(false) + 캐시버스터 v2→v3 (admin-ai-config.js·.html)

### BUG-3 (fix 완료) — 재색인이 읽을 원본 파일이 함수에 안 담김
- **증상**: 라이브에서 [전체 재색인]을 눌러도 에러 없이 "0개 색인"으로 조용히 완료. 검색·AI 주입도 데이터가 없어 무동작.
- **원인**: 함수 번들 포함목록(included_files)이 db·lib만 포함. 재색인이 읽는 Q&A jsonl 6종·메뉴얼 2종·knowledge.md가 함수 환경에 없음. 파일 읽기 실패 시 빈 문자열 반환 설계라 에러도 안 남.
- **fix**: netlify.toml에 admin-rag-reindex 함수용 included_files 추가 (docs/manual/** · public/manual.html · public/manual-admin.html). 기존 폰트 함수(영수증 PDF)가 같은 process.cwd() 기준 방식으로 라이브 작동 중 → 검증된 패턴.
- **재색인 가능 데이터 확인**: Q&A 합계 328문항 + 메뉴얼 3파일(약 215KB) 모두 존재.

### BUG-2 (메인 보고 — fix 보류) — 토글 OFF가 안 먹음
- **증상**: RAG 토글 OFF 저장 시 DB에 반영 안 됨 → 다음 로드 시 다시 ON. 회귀 안전망(OFF) 무력화.
- **원인**: 토글 저장(admin-ai-features POST)이 UPDATE만 함. ai_rag_search의 featureKey row가 ai_feature_settings에 없어 0건 영향. (읽기는 메모리 카탈로그 폴백으로 기본 ON 동작 → Q1~Q3엔 영향 없음)
- **구조적 성격**: 신규 featureKey(payroll_ai_summary·org_news_analysis·memorial_story_detail 등)가 코드엔 24개인데 DB는 21 row. 토글 OFF 무반영은 RAG만의 신규 회귀가 아니라 **신규 featureKey 공통의 기존 갭**.
- **권고(메인 결정)**: ① featureKey 시드(라운드 마감 §7 "ai_rag_search 권한·한도 등록") 또는 ② 토글 저장을 UPSERT로 보강(전체 AI 기능에 영향 — API 동작 변경이라 C 단독 fix 영역 아님). 메인 확인 필요.

---

## 5. 회귀 점검

| 영역 | 판정 | 근거 |
|---|---|---|
| AI 비서 OFF 회귀 | **PASS** | 주입부 try/catch fire-safe + featureKey OFF·검색 실패·빈 결과 모두 기존 동작 그대로. RAG가 본 응답 흐름을 막지 않음 |
| AI 비서 ON 동작 | **PASS (코드)** | 색인 데이터 있으면 [참고 자료] 주입 후 정상 도구 호출. 비용 fire-and-forget 기록 |
| AI 설정 화면 기존 탭 | **PASS** | RAG 섹션은 별도 DOM·이벤트로 추가. 기존 시스템 프롬프트·도구·기능 토글 로직 미변경 |
| 비용 합산 | **PASS (코드)** | 재색인·주입 모두 recordFeatureUsage('ai_rag_search') 호출. ai_cost_summary featureKey별 집계 경로 정합 |
| schema 회귀 격리 | **PASS** | embedding 컬럼은 schema.ts 미정의(raw SQL 전용) → drizzle SELECT 회귀 차단 (설계 §1.2 권장 준수) |

---

## 6. 종합

- **핵심 인프라(pgvector·테이블·인덱스·임베딩·검색·청킹·주입) 구현·DB 적용 모두 정상.**
- **C 단독 fix 2건**: BUG-1(가짜데이터 OFF)·BUG-3(재색인 파일 포함) — 둘 다 RAG가 라이브에서 작동하기 위한 필수 fix.
- **메인 결정 1건**: BUG-2(토글 OFF 무반영) — featureKey 시드 또는 토글 저장 UPSERT. 라운드 마감 §7과 연결.
- **라운드 마감 잔여(Swain·메인)**: ① featureKey row 시드 ② [전체 재색인] 1회 실행(현재 0개) ③ 토글 저장 방식 결정.

---

## 7. 변경 파일 (C fix)

| 파일 | 변경 |
|---|---|
| public/js/admin-ai-config.js | USE_RAG_MOCK true→false, 헤더 v2→v3 |
| public/admin-ai-config.html | 캐시버스터 v2→v3 |
| netlify.toml | admin-rag-reindex 함수 included_files 추가 (재색인 원본 파일 번들 포함) |
