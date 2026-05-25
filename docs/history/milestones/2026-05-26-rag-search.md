# RAG 검색 인프라 — 설계서 (종결·history archive)

> 작성: 2026-05-26 / 메인 채팅
> **종결: 2026-05-26 — 운영(tbfa.co.kr) 정상 작동 확인. 설계서 docs/active → docs/history/milestones 이동.**
> 목적: AI 비서가 Q&A 328문항 + 메뉴얼 본문을 의미 검색해 답변 근거를 주입 → 정확도↑
> 모드: 평행 (B 백 중심 + A 프론트 소규모 + C 검증)
> 추정: 메인 설계 2h / B 8~12h / A 3h / C 3h

---

## 종결 요약 (2026-05-26)

- **운영 검증 PASS**: 전체 재색인 535문서(Q&A 328 + 메뉴얼 청크) 성공, 검색 테스트 "기부금 영수증 발급" → 관련 Q&A 5건 유사도순 정상 반환.
- **설계는 Sonnet·결함 수정은 메인(Opus)**. 디버깅 중 잡은 결함 5건:
  1. **BUG-2**: AI 기능 토글 저장이 UPDATE-only라 DB row 없는 신규 featureKey(`ai_rag_search`)가 저장 안 됨 → UPSERT 전환 (`c109e21`).
  2. 재색인 background 호출이 fire-and-forget이라 함수 종료로 취소됨 → `await fetch` (`5313ce8`).
  3. 메뉴얼·Q&A 데이터 파일이 함수 번들에 누락 → `netlify.toml` included_files 추가 (`b54a43c`).
  4. **BUG-R2-1**: 폴링이 색인 0건을 완료 판정 못 해 5분 무통지 → 진단 가시화 (`1a37d6e`).
  5. 임베딩 모델 `text-embedding-004`가 이 API 키에서 404 → `gemini-embedding-001`로 교체, 모델명·차원 환경변수화 + 모델 조회 진단(`?diag=models`) (`9639e2e`).
- **신규 운영 환경변수 2개**: `GEMINI_EMBED_MODEL=gemini-embedding-001`, `GEMINI_EMBED_OUTPUT_DIM=768`.
- **C 2회 검증**: R1·R2 보고서 2건 (`docs/history/verify/2026-05-26-rag-search.md`·`2026-05-26-rag-search-r2.md`).
- **관련 커밋(최신순)**: `9639e2e`, `1a37d6e`, `5313ce8`, `c109e21`, `bf5f48a`, `b54a43c`, `ea1d831`, `2ede14b`.

---

## §0 요구사항 확정 (Swain 결정 2026-05-26)

| 항목 | 결정 |
|---|---|
| 역할 | 기존 고정 지식(knowledge.md 프롬프트 부록) **유지** + Q&A·메뉴얼 의미 검색 **보강** |
| 검색 대상 | Q&A 311문항(jsonl) + 메뉴얼 본문(manual.html·manual-admin.html·knowledge.md 청킹) |
| 벡터 저장 | **Neon pgvector** (확장 무료 지원·768차원·hnsw 인덱스) |
| 임베딩 | **Gemini `text-embedding-004`** (기존 GEMINI_API_KEY 재사용·768차원) → ※ 종결 시점 `gemini-embedding-001`로 교체(결함 5번) |
| 주입 방식 | AI 비서 질문 시 top-K(5) 검색 → 사용자 메시지 앞 `[참고 자료]` 블록으로 주입 |
| 비용 | featureKey `ai_rag_search` 신규 + rate limit·월 한도 통합 |
| 토글 | RAG ON/OFF (featureKey) — OFF 시 기존 동작 그대로 (안전망) |

---

## §1 DB 설계 (B)

### 1.1 pgvector 확장 + 신규 테이블
```sql
-- 마이그 (migrate-rag-setup): 멱등
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ai_rag_documents (
  id          bigserial PRIMARY KEY,
  source_type varchar(16) NOT NULL,        -- 'qna' | 'manual'
  source_ref  text NOT NULL,               -- 출처 식별(파일명#섹션·문항ID) — UPSERT 키
  title       text,                        -- 섹션 제목·질문
  content     text NOT NULL,               -- 임베딩·주입 본문
  embedding   vector(768),                 -- text-embedding-004
  token_count integer DEFAULT 0,
  created_at  timestamp DEFAULT now(),
  updated_at  timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_rag_documents_src_uq ON ai_rag_documents(source_ref);
CREATE INDEX IF NOT EXISTS ai_rag_documents_hnsw ON ai_rag_documents USING hnsw (embedding vector_cosine_ops);
```

### 1.2 drizzle vector 타입
- drizzle-orm은 `vector` 기본 미지원 → `customType<{ data: number[]; driverData: string }>` 정의(`lib/` 또는 schema.ts).
  - toDriver: `[0.1,0.2,...]` → `'[0.1,0.2,...]'` (pgvector 리터럴)
  - fromDriver: 문자열 → number[]
- 또는 검색·INSERT는 `sql` raw로만 접근하고 schema 정의는 embedding 제외(회귀 격리). **권장: embedding은 raw SQL로만 다루고 schema.ts엔 embedding 외 컬럼만 정의** (billing_keys.card_expiry_month 격리 패턴과 동일).

### 1.3 schema.ts
- `ai_rag_documents` 정의 추가(embedding 제외 컬럼) — 마이그 후 활성화. append-only 헤더.

---

## §2 API 명세 (B)

### 2.1 신규 lib
| 파일 | 시그니처 | 용도 |
|---|---|---|
| `lib/ai-embedding.ts` | `embedText(text): Promise<number[]>` | Gemini embedding-004 호출(768) |
|  | `searchRag(query, topK=5): Promise<RagHit[]>` | query 임베딩 → `ORDER BY embedding <=> $q LIMIT k` |
|  | `chunkManual(html\|md): Chunk[]` | 메뉴얼을 헤더(##/###) 단위·최대 ~500토큰 청크 |

### 2.2 신규 함수
| 파일 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `admin-rag-reindex.ts` | `/api/admin-rag-reindex` | POST | super_admin | jsonl + 메뉴얼 파싱·청킹 → embedText → `ai_rag_documents` UPSERT(source_ref 멱등). 전체 재색인(반복 가능) |
| `admin-rag-status.ts` | `/api/admin-rag-status` | GET/POST | super_admin | GET: 색인 현황(source_type별 문서 수·최근 색인). POST(query): 검색 테스트 top-K 미리보기 |

### 2.3 기존 함수 수정
- `admin-ai-agent.ts`: `callGeminiWithTools` 호출 직전 — featureKey `ai_rag_search` ON이면 `searchRag(userMessage)` → top-K를 사용자 메시지 앞 `[참고 자료]\n- {title}: {content}\n...` 블록으로 주입. OFF면 기존 그대로. (실패해도 빈 결과로 계속 — fire-safe)
- `lib/ai-feature.ts`: FEATURE_REGISTRY에 `ai_rag_search` 추가(기본 ON·월 한도 별도).

### 2.4 비용
- 임베딩 호출은 `recordFeatureUsage('ai_rag_search', ...)`. embedding-004 단가 미미하나 통합.

---

## §3 화면 명세 (A)

### 3.1 위치
- 통합 CMS → AI 에이전트 → 설정(`/admin-ai-config.html`)에 **"RAG 검색" 섹션 추가** (신규 페이지 X·기존 화면 확장 → iframe 4곳 등록 불필요).

### 3.2 구성
```
┌─ RAG 검색 (지식 의미 검색) ──────────────┐
│ [ ] RAG 검색 사용 (ai_rag_search 토글)    │
│ 색인 현황: Q&A 311 · 메뉴얼 N · 총 M개     │
│ 최근 재색인: 2026-05-26 14:00             │
│ [전체 재색인]  (진행률 표시)               │
│ ── 검색 테스트 ──                          │
│ [질문 입력_________]  [검색]               │
│  → top-5 결과(제목·유사도·발췌) 미리보기   │
└────────────────────────────────────────┘
```
- 동작: 토글 저장(featureKey API) / [전체 재색인] → `admin-rag-reindex`(시간 걸림·진행 안내) / 검색 테스트 → `admin-rag-status` POST.
- 캐시버스터 `admin-ai-config.js?v=N+1`.

---

## §4 검증 시나리오 (C)

| # | 시나리오 | 기대 |
|---|---|---|
| Q1 | 전체 재색인 실행 | Q&A 311 + 메뉴얼 청크 임베딩·저장, 현황에 문서 수 표시 |
| Q2 | 검색 테스트 "기부금 영수증 발급" | 관련 Q&A·메뉴얼 청크 top-5가 유사도순 반환 |
| Q3 | RAG ON 상태로 AI 비서에 질문 | 답변에 검색 근거 반영(정확도↑)·`[참고 자료]` 주입 동작 |
| Q4 | RAG OFF | 기존 동작 그대로(주입 없음·회귀 0) |
| Q5 | 재색인 멱등 | 2회 실행 시 중복 INSERT 없이 UPSERT |

### 4.2 회귀
- AI 비서 기존 답변·도구 호출(주입 OFF/ON 모두 깨짐 없는지)
- 어드민 로그인·AI 설정 화면 기존 탭
- 비용 안전장치(월 한도·rate limit)에 RAG 호출 합산

### 4.3 백필
- 초기 색인 = `admin-rag-reindex` 1회(Swain 또는 C 호출). 마이그 아님(반복 도구).

---

## §5 mock (A용·B 머지 전)
```json
// admin-rag-status GET
{ "ok": true, "data": { "total": 540, "byType": { "qna": 311, "manual": 229 }, "lastIndexedAt": "2026-05-26T05:00:00Z", "enabled": true } }
// admin-rag-status POST {query}
{ "ok": true, "data": { "hits": [ { "title": "기부금 영수증 발급", "sourceType": "qna", "score": 0.91, "snippet": "연말 1~2월 일괄..." } ] } }
// admin-rag-reindex POST
{ "ok": true, "data": { "indexed": 540, "qna": 311, "manual": 229, "elapsedMs": 42000 } }
```

---

## §6 4채팅 트리거 (발사 시 메인이 전문 출력)
- 베이스: 분배 전 본 설계서를 **origin/main에 push**(§4.1 베이스 정합) → 트리거에 베이스 해시 명시.
- B(백): §1·§2 — pgvector 마이그·drizzle vector·ai-embedding·reindex/status·ai-agent 주입·featureKey. 체크박스 패턴.
- A(프론트): §3 — admin-ai-config RAG 섹션. mock(§5) 임베드.
- C(검증): §4.

> ⚠️ B 주의: ① embedding은 raw SQL 격리 권장(schema 회귀 차단) ② Gemini embedding-004 응답 차원(768) 확인 ③ 메뉴얼 청킹 토큰 상한 ④ admin-ai-agent 주입은 featureKey OFF 시 완전 무동작(기존 보존).

---

## §7 라운드 마감 체크리스트 (전부 완료)
- [x] B·A·C 머지 + 1회 push
- [x] Swain: `migrate-rag-setup?run=1`(pgvector·테이블) → schema 활성화·마이그 삭제 (pgvector 확장·테이블·인덱스 운영 완비 확인 — R2 §4)
- [x] Swain: [전체 재색인] 1회 실행(초기 임베딩) — 535문서 색인 성공
- [x] featureKey `ai_rag_search` 권한·한도 등록 (UPSERT 전환으로 토글 저장 동작)
- [ ] knowledge.md·메뉴얼에 "RAG 검색" 운영 안내(C 메뉴얼) — release_checklist #3·#4 (잔여·다음 메뉴얼 동기화 라운드로)
- [x] PROJECT_STATE·HANDOFF 갱신 + 설계서 history 이동
