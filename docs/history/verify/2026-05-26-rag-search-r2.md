# RAG 검색 인프라 R2 — 재검증 보고서

> 검증: 2026-05-26 / C 채팅 (Opus 4.7)
> 브랜치: verify/rag-search-r2 (베이스 origin/main @ 5313ce8)
> 설계서: docs/active/2026-05-26-rag-search.md §1·§2·§4
> 모드: 코드 정합 정독 + 운영 Neon DB 직접 조회 (라이브 어드민 세션·운영 함수 로그는 C 접근 불가 → 일부 항목은 운영 검증으로 이관)

---

## 0. 한 줄 결론 (Swain용)

재색인이 0건이던 **1차 원인**은 "시작 신호를 보내기도 전에 트리거 함수가 끝나버려 백그라운드 색인이 한 번도 안 돌던 것"이고, 메인이 이미 고쳤다(즉시 종료 → 응답 받을 때까지 대기로 전환). **단 운영 DB가 아직 0건**이라, 고친 버전으로 재색인을 **한 번 더 눌러** ① 즉시 응답의 백그라운드 상태 ② 함수 로그 ③ 문서 수 3가지를 봐야 "진짜 해결됐는지 / 임베딩 키 권한 같은 2차 문제가 남았는지"가 최종 확정된다.

---

## 1. §A 재색인 0건 원인 규명 (최우선)

### 1.1 데이터 흐름 추적 결과
재색인 = 트리거(admin-rag-reindex) → 백그라운드 함수(admin-rag-reindex-background) → 파일 읽기 → 임베딩 → DB UPSERT.

| 단계 | 검증 | 판정 |
|---|---|---|
| 트리거 → 백그라운드 호출 | void fetch였을 때 트리거가 즉시 종료 → 진행 중 요청이 함수 종료로 취소 → 백그라운드 미실행(로그 비어있음). 메인이 await fetch로 전환(5313ce8) → 요청 전송 보장 | **1차 원인 확정·해결** |
| base URL | process.env.URL → SITE_URL → 기본값(.netlify.app) 순. self-fetch 경로 정합 | PASS(코드)·운영값 확인 권고 |
| 트리거 시크릿 | INTERNAL_TRIGGER_SECRET 미설정 시 트리거가 503 반환(fail-closed)·백그라운드 미호출 | 운영 환경변수 확인 필요 |
| 파일 읽기(readFileSafe) | process.cwd() 기준 경로 — 검증된 폰트 함수(영수증 PDF: join(process.cwd(),"assets","fonts",...))와 동일 방식. 운영 PDF 한글 정상 = 이 패턴 입증됨 | PASS(검증된 패턴) |
| JSONL 6개 경로·포맷 | 6개 파일 실존, 한 줄 = {"question","answer",...}. parseJsonl이 question/answer만 추출 → 정합. Q&A 합계 328문항 | PASS |
| 메뉴얼 번들 | netlify.toml included_files를 background 함수에 적용("docs/manual/**"·"public/manual.html"·"manual-admin.html"). included_files는 publish 폴더 여부와 무관하게 함수 zip에 복사 | PASS(코드)·운영 로그 확인 권고 |
| 임베딩 API(embedText) | 엔드포인트·모델명(text-embedding-004)·body·응답경로(embedding.values)·768차원 모두 표준 형식 정합. **단 GEMINI 키가 embedContent(임베딩) 권한을 갖는지는 미검증** — 기존 코드는 generateContent만 사용. 로컬은 키가 보안 마스킹되어 직접 호출 테스트 불가 | 형식 PASS·**키 권한 운영 검증 필수** |

### 1.2 0건 원인 확정
- **1차(확정·해결)**: void fetch → 트리거 조기 종료로 백그라운드 요청 미전송. await 전환으로 해결.
- **2차 후보(await로도 안 풀릴 수 있음·우선순위순)**:
  1. **임베딩 키 권한** — text-embedding-004(embedContent) 접근 불가 시 모든 임베딩 실패 → 0건. 코드는 실패해도 throw 안 하고 warn만 → 조용히 0건. **가장 의심.**
  2. **INTERNAL_TRIGGER_SECRET 운영 미설정** — 트리거 503·백그라운드 미호출 (백그라운드 로그 비어있음 = 1차 시도 증상과도 일치).
  3. **base URL** — 운영 self-fetch 주소 오류 시 호출 실패.
- **운영 함수 로그가 원인을 즉시 가린다**:
  - `[rag-reindex-bg] start — Q&A 0 ...` → 파일 번들 문제
  - `[rag-reindex-bg] start — Q&A 328 ...` + `임베딩 실패` 도배 → 키 권한 문제
  - start 로그 자체가 없음 → 백그라운드 미실행(트리거·시크릿·URL 문제)

### 1.3 답: (a)await fetch로 해결 / (b)파일 번들 / (c)임베딩 API / (d)복합
**(a)가 1차 원인의 올바른 해결**이나, DB가 여전히 0건이므로 **(c) 임베딩 키 권한이 2차로 남아있을 가능성이 높다.** 최종 판정은 await 배포본에서 재색인 1회 후 운영 로그·DB로 확정. → **(d) 복합 가능성**(1차 a 해결 + 2차 c 잔존 의심).

---

## 2. §B 검색·AI 비서 주입 정합 — 전부 PASS

| 항목 | 판정 | 근거 |
|---|---|---|
| searchRag 벡터 안전성 | PASS | embedText가 number[] 768 보장 → join(",")으로 숫자만 리터럴화. 문자열 주입 여지 없음. `<=>` 거리·WHERE embedding IS NOT NULL·ORDER BY·LIMIT 정합. 실패 시 빈 배열(fire-safe) |
| status GET 현황 | PASS | byType·total·lastIndexedAt·enabled 집계. featureKey row 없으면 enabled=true 기본 |
| status POST 검색 테스트 | PASS | title·sourceType·sourceRef·score·snippet 응답 키 정합 |
| ai-agent §2.5 주입 | PASS | featureKey OFF 시 무동작·searchRag 실패 시 try/catch로 기존 대화 흐름 100% 보존·[참고 자료] 블록을 마지막 user 메시지 첫 text 파트에 prepend |

---

## 3. §C featureKey 토글 UPSERT (메인 c109e21) — 회귀 0·PASS

| 항목 | 판정 | 근거 |
|---|---|---|
| 4조합(enabled만/budget만/둘다/budget_null) | PASS | INSERT … ON CONFLICT(feature_key) DO UPDATE. 보내지 않은 항목은 기존값 보존(budget만 변경 시 enabled 미변경) |
| values 인덱스 | PASS | enabled만 values[0] / budget만 values[0] / 둘다 enabled=values[0]·budget=values[1] / budget_null은 null. hasEnabled 분기로 인덱스 정확 |
| NOT NULL 컬럼 | PASS | feature_name·category·sort_order를 카탈로그(getFeatureMeta)에서 보충, ?? 폴백까지 이중 안전 |
| getFeatureMeta import | PASS | import·export 모두 존재 |
| 기존 21개 row 회귀 | PASS | 전부 ON CONFLICT DO UPDATE 경로 — 동작 동일 |

---

## 4. §D 운영 DB 실태 (2026-05-26 조회)

| 항목 | 값 |
|---|---|
| ai_rag_documents 문서 수 | **0개** (source_type 분포 없음·최근 색인 시각 없음) |
| ai_rag_search featureKey row | **없음** (토글/UPSERT 미발생 — 재색인만으로는 row 안 생김) |
| ai_feature_settings 총 row | 21 (변동 없음) |
| pgvector 확장 | 설치됨 |
| 인덱스 | pkey · _src_uq(UNIQUE) · _hnsw(HNSW) 정상 |

→ 인프라(확장·테이블·인덱스)는 완비. **재색인이 한 번도 성공하지 못함**(문서 0·색인시각 없음). featureKey row 부재는 정상(아직 토글을 누른 적 없음).

---

## 5. §E 프론트 폴링 UX — 결함 발견·fix 적용

### BUG-R2-1 (fix 완료) — 색인 0건을 사용자에게 알리지 못함
- **증상**: 재색인 후 폴링이 "문서 수 3회 연속 동일 + 0 초과"를 완료 조건으로 삼아, **0건이 지속되면 완료 판정을 못 하고 5분(60틱)간 조용히 돌다가 버튼만 풀림**. 사용자는 "왜 0건인지" 전혀 모름. 또 트리거 응답의 bgStatus·bgError(메인 5313ce8 추가)를 프론트가 무시.
- **fix** (public/js/admin-ai-config.js, v3→v4):
  1. 재색인 클릭 시 트리거 응답의 bgStatus/bgError 점검 — 백그라운드 호출 실패면 "서버 환경(트리거 시크릿·주소) 점검 필요" 즉시 경고 (줄 320~)
  2. 폴링 중 30초(6틱) 지나도 0건이면 조기 중단 + "색인 0건 — 실패 가능성(임베딩 키·데이터 파일 점검)" 경고 (줄 369~). 정상 동작 시 30초엔 순차 UPSERT로 이미 문서가 쌓이므로 false positive 없음
  3. 5분 상한 도달 시에도 0건이면 "완료 판정 안 됨 — 새로고침 확인" 안내
- **효과**: Swain이 재색인 누를 때 화면만으로 (호출 실패) vs (호출됐으나 색인 0건)을 구분 → 2차 원인 추적이 쉬워짐.

---

## 6. Swain/메인 액션 필요

1. **(최우선) await 배포본에서 재색인 1회 실행** → 다음 3개 동시 확인:
   - 재색인 클릭 직후 응답의 bgStatus(202면 백그라운드 호출 성공) / bgError
   - Netlify 함수 로그에서 `[rag-reindex-bg]` start·실패·done 메시지
   - 잠시 후 ai_rag_documents 문서 수
2. **임베딩 키 권한 확인** — GEMINI_API_KEY가 text-embedding-004(embedContent)에 접근 가능한지. (로그에 임베딩 실패가 도배되면 이 문제)
3. **환경변수 확인** — INTERNAL_TRIGGER_SECRET 운영 설정 여부, process.env.URL 운영 값.
4. **featureKey row 시드** — RAG 토글을 화면에서 한 번 ON/OFF 하면 UPSERT로 ai_rag_search row 생성됨(코드 정상). 또는 라운드 마감 §7 권한·한도 등록.

---

## 7. 변경 파일 (C fix)

| 파일 | 변경 |
|---|---|
| public/js/admin-ai-config.js | 재색인 bgStatus/bgError 표시 + 0건 조기 경고 + 헤더 v3→v4 |
| public/admin-ai-config.html | 캐시버스터 v3→v4 |

> 운영 DB 쓰기·마이그레이션 호출 없음. 코드 fix(프론트 진단)만.
