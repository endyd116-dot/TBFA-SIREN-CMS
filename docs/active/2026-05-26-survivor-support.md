# 순직 인정 지원 시스템 = Deep-Relief AI v0 (내부 엔진·PoC) — 설계서

> 작성: 2026-05-26 / 메인 채팅(Opus)
> 단일 출처. A·B·C 트리거는 §6에서 복사.
> **토대**: RAG 인프라(`ai_rag_documents`·`embedText`·`searchRag`·`chunkManual`·`admin-rag-reindex-background`) 재사용.
> 메모리: `project_next_survivor_support` (§0 결정 출처)
> **재포지셔닝(2026-05-26 Swain)**: 본 모듈은 초기창업패키지 사업계획서 **'Deep-Relief AI'의 무료·즉시 가동 MVP이자 데이터 적재 엔진(v0)**. 계획서 일정(데이터 이관·색인→알파→교육청 PoC)의 내부 코어가 되고, 사건 데이터를 오늘부터 구조화·색인해 본편(정부지원·전담팀)의 핵심 자산을 선적재. 관계·로드맵 = §8.

---

## 비전 (한 문장)

교유협이 직접 6건의 교사 순직을 인용시킨 도메인지식 + 법률지식을 RAG로 색인해, **새 교사 사망 사건 발생 시 운영자(간사·전문가)가 순직 인정을 준비하도록 AI가 ① 골든타임 자료 제언 → ② 사건 자료 업로드·AI 자동 추출 → ③ 인정 전략 분석 → ④ 청구서·의견서 초안을 지원**하는 시스템. **모든 AI 출력은 "전문가 검토용 초안"**(법적 책임 경계·전문가 검증 루프 필수 = 계획서의 "하이브리드 지원").

---

## §0 요구사항 확정 (2026-05-26 Swain 결정)

| 항목 | 결정 |
|---|---|
| **이번 범위** | **4단계 전부(완성형)** — ①골든타임 제언 + ②자료 업로드·AI 자동 추출 + ③전략 분석(부족자료 안내) + ④청구서·의견서 초안 |
| **문서 읽기** | 텍스트 PDF·워드(docx)는 무료 라이브러리로 추출 + **스캔본(이미지 PDF·사진)은 Gemini 멀티모달로 글자 인식**(추가 외부 OCR 계약·비용 0·기존 `GEMINI_API_KEY` 재사용). 한글(hwp)은 워드/PDF 변환 안내 |
| **지식 시드** | 과거 인정/불인정 **사례는 운영자 업로드 → 자동 색인** / **공무원재해보상법·인사혁신처 심의기준·대표 판례는 구축 시 초기 1회 시드**(이후 어드민 추가·수정). 그 외 추가 지식은 AI 일반지식 보조. **법령·판례 시드는 메인(Claude)이 공개 법령 기반 초안 작성 → 전문가 검수**(2026-05-26 Q2) |
| **자료 분류** | 운영자는 유형 안 고르고 **아무 자료나 업로드 → AI가 맥락 파악해 8대분류 자동 판정 + 한줄요약 + 확신도**. 운영자 교정은 드문 오분류 때만(예외·§1.5) |
| **AI 출력 노출** | **협회 운영자 전용**(간사·전문가·super_admin만). 유족은 검토를 거친 결과만 받음. 이번 라운드 유족(회원) 화면 없음 |
| **★ 자동화 원칙(핵심)** | **98% AI 자동·사람 개입 2%**(Swain 2026-05-26). 업로드 1번이면 → 추출 → 맥락 파악 → 8대분류 → 색인(RAG) → **사건 구조 정리 → 분석 초안까지 딥릴리프가 자동**. 사람은 **검토·교정·전문가 검증(2%)** 만. 수동 분류 수정·수동 텍스트 입력은 **드문 예외(폴백)**, 기본 동선 아님 |
| **아키텍처** | **싸이렌 통합 CMS(cms-tbfa) 임베드 + 독립 모듈 설계**(2026-05-26). v0는 허브에 얹어 무료·즉시·데이터 적재 / 데이터·로직은 SIREN 운영(후원·회원)과 분리된 독립 모듈 → 본편(정부지원) 때 standalone SaaS로 떼어내기 쉽게(§8.6). 효성CMS는 결제 전용·무관 |
| **보완 로직** | **추천 8종 전부 단계 반영**(2026-05-26): 절차·기한 트래커·인정요건 대조·부족증거 액션·인과관계 논리맵·전문가 검토·학습 피드백·감사/보안 로그·유족용 쉬운 요약. 단계 배치 = §9 |

### ★ 자동화 원칙 — 98% AI / 2% 사람 (Swain 2026-05-26 "이게 핵심")

운영자가 **파일을 올리는 것** 외에 손댈 일이 없어야 한다. 딥릴리프가 받아서 읽고·맥락 파악하고·분류하고·색인하고·사건 구조를 정리하고·분석 초안까지 **자동으로 이어서** 수행한다.

```
[자동 98%]  업로드 → 추출(OCR 포함) → 맥락 파악 → 8대분류 → 색인(RAG)
            → (자동 이어짐) 사건 구조 정리 → 전략·서면 초안
[사람 2%]   결과 검토 · 드문 오분류 교정 · 전문가 최종 검증(법적 책임 경계)
```

- **자동 체인**: 자료 업로드 시 추출·분류·색인이 자동, **끝나면 사건 구조 추출도 자동 이어짐**(운영자가 "분석" 버튼을 누를 필요 없음). 전략·서면도 자동 초안 생성(검토 대기 상태로).
- **사람 개입 = 예외**: 분류가 틀렸을 때만 드롭다운 교정, 도저히 못 읽는 파일에만 텍스트 직접 입력. 이건 **2%의 폴백**이지 표준 흐름이 아님.
- **전문가 검증은 별개**: "전문가 검토용 초안" 원칙(법적 책임)은 유지 — 자동 생성된 초안을 전문가가 검증. 자동화 ≠ 무검증.

### 단계화 전략 (Swain 승인 대기 — 완성형 vs "작게 증명" 긴장 해소)

범위는 4단계 전부지만 **한 번에 다 푸시하지 않는다.** 단계별 Swain 라이브 검증 단위로 나눠 push (§9.3 배치):

보완 8종(§9)을 단계에 녹임 — ⓝ = 보완 번호.

| Phase | 내용 (핵심 + 보완) | Swain 라이브 검증 단위 |
|---|---|---|
| **P1 토대** | DB 코어 + 사건 CRUD + 자료 업로드 + 추출(OCR) + 자동분류 + 색인 + **사건 구조 자동 추출** + 법령 시드 / ⑦감사 로그 + ①절차·기한(경량) + ③부족 증거 표시 / **G6 자료 원문 뷰어** + **G2 일괄 이관(기초)** / **가 이벤트 알림(완료/실패·경량)** + **나 처리 상태 가시화·재시도** | 자료 올리면 글자 뽑히고 자동 분류·구조 정리·부족 증거가 보이고, 완료/실패 알림·재시도가 되는가 |
| **P2 분석** | ③전략 + ①골든타임 + ②인정요건 대조 + ⑨모순 탐지 + ⑩마스터 타임라인+공백 + ⑪반론 대비 + ⑫준비도 게이지 + ①기한 트래커 풀(cron) + ③부족증거 액션 + ⑥학습 피드백 시작 / **G3 다중 사건 대시보드** / **다 운영자 코퍼스 검색** + **라 유족 동의·보존/파기** | 요건 충족·모순·완성도 %·부족 자료·기한이 한눈에 보이는가 |
| **P3 서면** | **④유족급여신청서 초안 = 인정 보고서 형식·전개·증거 통째 학습 + 법령 보완·섹션별 생성** + 출력물 검토 + ⑤전문가 검토 + ④논리맵 시각화 + ⑥종결 자동 학습 / **G1 보고서 내보내기(HTML·PDF)** + **G4 사건 패키지 zip** | 인정 보고서 모델 15~30p 초안이 근거와 함께·제출용 다운로드·전문가 검토되는가 |
| **P4 마감** | AI 비서 도구(읽기) + ⑧유족 전달용 쉬운 요약 + G5 인정률·성과 통계 + **R 연구 발간지(비식별화·외부 발간·§9.4)** + featureKey 정착 + 메뉴얼·knowledge.md 동기화 + 설계서 history 이동 | 라운드 종결 체크리스트 (연구 발간은 데이터 축적 후 별도 라운드 가능) |

> **첫 분배는 P1만.** P1 Swain 검증 통과 후 P2 트리거를 §6에서 확정·분배. 이렇게 4단계 기능을 다 만들되 위험을 단계로 쪼갬.

---

## §1 DB 설계

### 1.1 신규 테이블 4개

기존 명명 관습 준수: `caseNo`/`docType` 등 camelCase 컬럼·snake_case DB명, `status` enum default, FK `onDelete`, `createdAt`/`updatedAt` defaultNow notNull, 인덱스 `{table}_{col}_idx`. **append-only** — schema.ts 끝에 `/* === 순직 인정 지원 시스템 (2026-05-26) === */` 헤더 후 추가.

#### (1) `martyrdom_cases` — 순직 사건 (사건 단위 엔티티)
```typescript
export const martyrdomCases = pgTable("martyrdom_cases", {
  id: serial("id").primaryKey(),
  caseNo: varchar("case_no", { length: 30 }).unique().notNull(),     // MTR-YYYYMMDD-XXXX
  caseKind: varchar("case_kind", { length: 12 }).default("active").notNull(), // 'active'(지원대상) | 'reference'(과거 학습사례)
  title: varchar("title", { length: 200 }).notNull(),
  deceasedName: varchar("deceased_name", { length: 50 }),            // 고인 성명
  schoolName: varchar("school_name", { length: 150 }),               // 소속(학교)
  position: varchar("position", { length: 50 }),                     // 직위
  deceasedAt: date("deceased_at"),                                   // 사망일
  occurredSummary: text("occurred_summary"),                         // 운영자 1차 메모
  status: varchar("status", { length: 20 }).default("intake").notNull(),
  // active 라이프사이클: intake(접수)→collecting(자료수집)→analyzing(분석)→drafting(서면)→submitted(청구)→closed(종결)
  outcome: varchar("outcome", { length: 12 }),                       // 'approved'(인정) | 'rejected'(불인정) | null(진행중)
  outcomeNote: text("outcome_note"),                                 // 인정/불인정 사유 요지 (reference 사례 학습 핵심)
  /* ── 보완① 절차·기한 (P1 경량 — 풀 트래커·cron은 P2 martyrdom_deadlines·§9) ── */
  procedureStage: varchar("procedure_stage", { length: 20 }),        // 행정 절차: 'apply'(신청)|'review'(심의)|'decided'(결정)|'reappeal'(재심)
  nextDeadlineAt: date("next_deadline_at"),                          // 다음 법정/행정 기한 (D-day 표시)
  nextDeadlineLabel: varchar("next_deadline_label", { length: 100 }),
  extractionJson: jsonb("extraction_json"),                          // 사건 구조 자동 추출 결과(§2.5 스키마)
  extractedAt: timestamp("extracted_at"),
  assignedAdminId: integer("assigned_admin_id").references(() => members.id, { onDelete: "set null" }),
  workspaceTaskId: integer("workspace_task_id"),                     // (옵션) 칸반 카드 연동 — P4
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  caseNoIdx: index("martyrdom_cases_case_no_idx").on(t.caseNo),
  kindIdx: index("martyrdom_cases_kind_idx").on(t.caseKind),
  statusIdx: index("martyrdom_cases_status_idx").on(t.status),
  outcomeIdx: index("martyrdom_cases_outcome_idx").on(t.outcome),
}));
```

#### (2) `martyrdom_case_documents` — 사건별 첨부 자료
```typescript
export const martyrdomCaseDocuments = pgTable("martyrdom_case_documents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => martyrdomCases.id, { onDelete: "cascade" }).notNull(),
  blobId: integer("blob_id"),                                        // → blob_uploads.id (R2 원본)
  fileName: varchar("file_name", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  sizeBytes: integer("size_bytes").default(0),
  docType: varchar("doc_type", { length: 30 }),                      // AI 자동 분류(§1.5 8대분류)·운영자 수정 가능
  docTypeAuto: varchar("doc_type_auto", { length: 30 }),             // AI 원판정(감사·비교용·운영자 수정과 분리)
  docSummary: text("doc_summary"),                                   // AI 한 줄 요약
  classifyConfidence: integer("classify_confidence").default(0),     // 0~100 (낮으면 '확인 필요' 배지)
  extractStatus: varchar("extract_status", { length: 20 }).default("pending").notNull(), // pending|processing|done|failed
  extractMethod: varchar("extract_method", { length: 20 }),          // 'native_pdf'|'docx'|'gemini_ocr'|'manual'
  extractedText: text("extracted_text"),                             // 추출/OCR 텍스트
  extractError: text("extract_error"),
  indexedToRag: boolean("indexed_to_rag").default(false),            // reference 사례면 RAG 색인 여부
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  caseIdx: index("martyrdom_docs_case_idx").on(t.caseId),
  statusIdx: index("martyrdom_docs_status_idx").on(t.extractStatus),
}));
```

#### (3) `martyrdom_ai_outputs` — AI 산출물 + 근거 추적 (불변 원칙 ③)
```typescript
export const martyrdomAiOutputs = pgTable("martyrdom_ai_outputs", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => martyrdomCases.id, { onDelete: "cascade" }).notNull(),
  outputType: varchar("output_type", { length: 20 }).notNull(),
  // 'extraction'(구조추출)|'golden'(골든타임)|'strategy'(전략)|'draft_petition'(청구서)|'draft_opinion'(의견서)
  version: integer("version").default(1).notNull(),
  contentText: text("content_text"),                                 // 사람이 읽는 본문(초안)
  contentJson: jsonb("content_json"),                                // 구조화 결과(전략 항목·부족자료 배열 등)
  ragSources: jsonb("rag_sources"),                                  // [{id,title,sourceType,score}] — 근거 추적·환각 방지
  modelUsed: varchar("model_used", { length: 40 }),
  status: varchar("status", { length: 12 }).default("draft").notNull(), // draft|reviewed|discarded
  reviewedBy: integer("reviewed_by").references(() => members.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  caseIdx: index("martyrdom_outputs_case_idx").on(t.caseId),
  typeIdx: index("martyrdom_outputs_type_idx").on(t.outputType),
}));
```

#### (4) `martyrdom_golden_items` — 골든타임 자료 체크리스트 마스터 (시드 + 어드민 CRUD·§6.18)
```typescript
export const martyrdomGoldenItems = pgTable("martyrdom_golden_items", {
  id: serial("id").primaryKey(),
  channel: varchar("channel", { length: 12 }).notNull(),             // 'online'(휘발성↑) | 'offline'(보존)
  label: varchar("label", { length: 150 }).notNull(),                // 예: "메신저·SNS 대화 백업"
  guidance: text("guidance"),                                        // 확보 방법·주의
  volatility: integer("volatility").default(3),                      // 1~5 (5=가장 휘발성·우선)
  sortOrder: integer("sort_order").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### 1.2 RAG는 기존 `ai_rag_documents` 재사용 + `case_id` 컬럼 추가 (사건 격리 검색)
처리 파이프라인(자료 1건): **받기(R2) → 글자 읽기(추출/OCR) → 분류(§1.5) → 청킹·임베딩·색인(RAG)**. 검색(RAG)은 **분석 시점**에 일어남.

- **`source_type` 값 3종**:
  - `'martyr_active'` — **지원 중 사건 자료**(그 사건 안에서만 검색·민감정보 격리). `case_id` 필수.
  - `'martyr_case'` — **과거 인정/불인정 학습 사례**(모든 사건이 cross 검색). reference 사건의 `case_id`.
  - `'martyr_law'` — **법령·판례 시드**(공통 지식·`case_id` NULL).
- **`ai_rag_documents`에 `case_id integer NULL` 컬럼 + 인덱스 추가**(마이그·기존 qna/manual row는 NULL·회귀 0). 사건 격리 검색용.
- **`source_ref` 규칙**: 사건 `martyr_active#{caseId}#{docId}#{chunkIdx}` / 사례 `martyr_case#{caseId}#{docId}#{chunkIdx}` / 법령 `martyr_law#{slug}#{chunkIdx}`. 청크 단위 UPSERT 멱등.
- **색인 메타**: 청크 `title`에 분류 라벨·문서 요약을 붙여 검색 품질↑(예: `[의학·심리] 진단서 — ...`).
- **검색**(§2.1 `searchRag(query, topK, sourceTypes?, caseId?)`): 순직 분석 = `martyr_active`(이 `caseId`만) + `martyr_case`(전체) + `martyr_law`. 기존 싸이렌 `qna`·`manual`은 제외(§2.8). AI 비서 RAG와 코퍼스 분리.

### 1.3 blob_uploads 재사용
- 사건 자료 업로드는 `context='martyrdom_doc'`, `referenceTable='martyrdom_cases'`, `referenceId=caseId`, `uploadedByAdmin=admin.uid`, `isPublic=false`(운영자 전용·민감).

### 1.4 마이그레이션 `migrate-martyrdom-setup.ts` (§6.8 표준)
- super_admin·GET `?run=1` 실행 / GET 진단. 멱등 `IF NOT EXISTS`.
- 4테이블 + 인덱스 생성 + `martyrdom_golden_items` 기본 시드 INSERT(중복 방지). 법령 시드는 별도(§2.6 reindex 확장으로).
- 호출·확인 후 schema.ts 정의 활성화 + 파일 삭제(§9.2).

### 1.5 자료 자동 분류 — 8대분류 (Swain 2026-05-26: "아무 자료나 올리면 AI가 판단해서 대단원 분류")
운영자는 **자료 유형을 고르지 않고 아무 파일이나 업로드** → AI가 8개 중 하나로 자동 분류 + 한 줄 요약 + 확신도(0~100). 확신 낮으면 화면에 "확인 필요" 배지. **운영자가 드롭다운으로 수정 가능**(잘못된 분류만). `docType`=최종(수정 반영), `docTypeAuto`=AI 원판정. 분류값은 사건 구조 추출·전략 분석에 컨텍스트로 투입.

**★ 이미지·사진 자료도 분류 대상 (Swain 2026-05-26 추가)**: 문서뿐 아니라 **사진·이미지(카톡 민원 캡처·진단서 사진·현장/CCTV 사진·유서 촬영본 등)** 도 어디 분류인지 판단해야 함. 텍스트 파일은 추출 텍스트로 분류하지만, **이미지·스캔본은 Gemini Vision이 시각 내용 + 글자(OCR)를 함께 보고 분류**한다(글자가 거의 없는 현장 사진도 시각 판단). 예: 카톡 민원 캡처→`duty_stress` / 진단서 사진→`medical` / 현장·CCTV 사진→`death_scene`. 즉 분류 입력은 **텍스트(추출형) 또는 이미지(시각형)** 둘 다 받는다(§2.1 `classifyDocument`).

| code | 대분류 | 들어가는 자료(예) | 입증 역할 |
|---|---|---|---|
| `application` | 신청·행정 서류 | 순직유족급여청구서(순직신청서)·인사혁신처 제출·행정 결정문 | 신청 절차·요건 |
| `work_record` | 근무·인사 기록 | 근무시간·초과근무·업무분장·복무/인사기록 | 직무성·업무 부담 |
| `duty_stress` | 직무 스트레스·괴롭힘 | 악성 민원·학부모 항의·협박 메신저/통화/SNS **+ 고인이 가족·지인과 나눈 카톡 등에서 드러난 업무 고통·과로·민원 토로** | 직무 스트레스 |
| `medical` | 의학·심리 소견 | 심리부검·진단서·정신건강 진료기록·사망진단서 | 인과관계(의학) |
| `investigation` | 수사·공적 조사 | 경찰·검찰·노동청·교육청 감사 기록 | 객관적 사실 입증 |
| `statement` | 진술·증언·유족 정리 | 진술서·탄원서·동료/목격자 증언 **+ 유족이 1차 정리한 사건 개요·경위·타임라인** | 정황 보강·사건 개요 |
| `death_scene` | 사망 정황·현장 | 사망 경위서·유서·현장 사진·CCTV | 사망 사실·경위 |
| `other` | 기타·참고 | 개인 일기·메모·언론 보도·분류 애매 | 보류·참고 |

분류 라벨 맵(`MARTYRDOM_DOC_TYPES`)은 `lib/martyrdom-ai.ts`에 상수로 두고 프론트는 동일 맵으로 배지·드롭다운 렌더(한 곳 정의·양쪽 사용).

**★ 모든 파일 거부 없이 수용 (Swain 2026-05-26 추가)**: 자료 종류는 미리 정해지지 않음 — 가족 카톡 대화(캡처 이미지 또는 내보낸 .txt), 유족이 1차 정리한 사건 개요(워드·한글·메모), 일기, 통화 녹취록, 스프레드시트 등 **운영자가 가진 무엇이든 업로드 가능**. 처리 원칙:
- **추출 성공**: 텍스트형(§2.1) 또는 이미지형(Vision) → 자동 분류.
- **추출 실패·미지원 형식**(예: 한글 hwp·암호화·깨진 파일): **업로드 자체는 막지 않음** — 원본은 R2 보관, `extractStatus='failed'` 표시 + **운영자가 화면에서 텍스트/요약을 직접 입력**(`extractMethod='manual'`)하면 그 텍스트로 분류·분석에 편입. (hwp는 워드/PDF 변환 권장 안내 병행)
- 카톡은 **두 경로 모두 수용**: 캡처 이미지 → Vision OCR / 내보낸 텍스트(.txt·.csv) → 텍스트 추출.

---

## §2 API 명세

> 전부 `/api/*` → `export const config = { path }` 필수. 응답 `{ ok, ... }` / 에러 `{ ok:false, error, step, detail, stack }`(§6.2). 권한: 관리=`requireAdmin`(type admin), 파괴/재색인=`requireRole(member,'super_admin')`. 무거운 처리(추출·분석·서면)는 **background 함수**(`*-background.ts`·`INTERNAL_TRIGGER_SECRET` 내부 인증·fail-closed).

### 2.1 신규 lib
| 파일 | 시그니처 | 용도 |
|---|---|---|
| `lib/ai-ocr.ts` | `extractDocText({ base64, mimeType, fileName }): Promise<{ text, method, error? }>` | 형식별 분기: **텍스트 PDF→`pdf-parse`** / **docx→`mammoth`** / **txt·md·csv·rtf·카톡 export→평문 디코드** / **이미지·스캔PDF→`callGemini({inlineFiles,mode:'pro'})` OCR**. 미지원·실패는 throw 대신 `{error}` 반환(업로드 유지·운영자 수동 입력 유도) |
| `lib/martyrdom-ai.ts` | `MARTYRDOM_DOC_TYPES` (상수 맵) | 8대분류 code↔라벨(§1.5)·프론트 공유 |
|  | `classifyDocument({ text?, imageBase64?, mimeType?, fileName }): Promise<{ docType, summary, confidence }>` | **텍스트형**(추출 텍스트) **또는 이미지형**(사진·스캔본) → 8대분류 자동 판정 + 한줄요약 + 확신도. 이미지는 `callGemini({inlineFiles, mode:'pro'})` Vision으로 시각+글자 함께 판단(§1.5) / 텍스트는 `callGeminiJSON` |
|  | `extractCaseStructure(caseId, docs): Promise<ExtractionResult>` | 자료 텍스트(+분류) → 사건 구조 JSON(§2.5). **대용량 사건은 within-case RAG(`martyr_active`·이 caseId)로 항목별 관련 대목 retrieve 후 추출**(수만 페이지 대응) |
|  | `analyzeStrategy(caseRow, hits): Promise<StrategyResult>` | **두 자료원 검색**(이 사건 `martyr_active` + 과거 `martyr_case` + `martyr_law`) + 사건 구조 → 전략·부족자료 (§2.8) |
|  | `buildGoldenAdvice(caseRow, items, hits): Promise<GoldenResult>` | 체크리스트 + RAG → 골든타임 제언 |
|  | `computeReadiness(caseId): Promise<Readiness>` | **보완⑫**. 인정요건 충족도(②)+증거 확보율(③)+타임라인 완결성(⑩)+모순 없음(⑨) 합산 → 완성도 %·부족 항목·기여도(`+N%`) |
|  | `retrieveApprovedExemplars(caseRow): Promise<RagHit[]>` | 유사 **인정(approved) 사례의 보고서/신청서** 검색 → 형식·전개·증거 배열 모델(few-shot) |
|  | `draftDocument(type, caseRow, strategy, exemplars, hits): Promise<DraftResult>` | **유족급여신청서(순직신청서)·의견서 초안**. **인정받은 과거 보고서를 형식·목차·전개방식·증거 배열까지 few-shot 모델로** + 이 사건 구조·전략 + 법령 보완. 15~30p는 **섹션별 생성**(출력 토큰 한계 대응) |
| `lib/ai-embedding.ts` (수정) | `searchRag(query, topK, sourceTypes?, caseId?)` | sourceTypes·caseId 필터 추가(기본=전체·하위호환). **순직 분석은 `martyr_active`(이 caseId)+`martyr_case`+`martyr_law`로 한정**(§1.2·§2.8). `martyr_active`는 `case_id=caseId` 강제(사건 격리) |

### 2.2 함수 — Phase 1 (토대)
| 함수 | 경로 | 메서드 | 권한 | 용도 |
|---|---|---|---|---|
| `admin-martyrdom-cases` | `/api/admin-martyrdom-cases` | GET/POST/PATCH | admin | 사건 목록·생성·수정(상태·outcome 포함). DELETE는 super_admin |
| `admin-martyrdom-case-detail` | `/api/admin-martyrdom-case-detail` | GET | admin | 사건 1건 + 자료 목록 + AI 산출물 목록 (separate query + Map) |
| `admin-martyrdom-doc-upload` | `/api/admin-martyrdom-doc-upload` | POST | admin | blob presign(R2) 발급 + `martyrdom_case_documents` row 생성(pending) 반환 |
| `admin-martyrdom-doc-register` | `/api/admin-martyrdom-doc-register` | POST | admin | R2 업로드 완료 통지 → blob_uploads completed + 추출 background 트리거 |
| `admin-martyrdom-extract-background` | (내부) | POST | INTERNAL | **자동 체인**: `extractDocText`→`extractedText` 저장 → `classifyDocument` 8대분류+요약+확신도(이미지는 Vision·§1.5) → **청킹·임베딩·`ai_rag_documents` UPSERT**(active→`martyr_active`+`case_id` / reference→`martyr_case`+`case_id`) → `indexedToRag=true` → **사건 자료면 `analyze-background` 자동 트리거(디바운스·운영자 클릭 불필요)** |
| `admin-martyrdom-analyze-background` | (내부) | POST | INTERNAL | **자동 호출**(extract 체인 끝·디바운스). `extractCaseStructure` → `extractionJson` + `ai_outputs(extraction)`. (P2: 전략 초안도 자동 이어 생성·검토 대기) |
| `admin-martyrdom-doc-reclassify` | `/api/admin-martyrdom-doc-reclassify` | PATCH | admin | **(예외·2% 폴백)** 드문 오분류 교정(`docType`·`docTypeAuto` 보존) 또는 못 읽는 파일 수동 텍스트 입력(`extractedText`·`extractMethod='manual'`) |
| `admin-martyrdom-reanalyze` | `/api/admin-martyrdom-reanalyze` | POST | admin | **(예외)** 사건 구조 강제 새로고침(자동 체인이 기본·이건 수동 재실행 버튼) |

### 2.3 응답 JSON (A mock 기준·키명 고정)
```jsonc
// GET admin-martyrdom-cases?kind=active&status=&q=
{ "ok": true, "cases": [
  { "id": 1, "caseNo": "MTR-20260526-0001", "caseKind": "active",
    "title": "○○초 △△ 선생님 사건", "deceasedName": "△△△", "schoolName": "○○초",
    "deceasedAt": "2026-05-01", "status": "collecting", "outcome": null,
    "docCount": 3, "hasExtraction": true,
    "assignedAdminName": "김간사", "createdAt": "2026-05-26T01:00:00Z" }
], "total": 1 }

// GET admin-martyrdom-case-detail?id=1
{ "ok": true,
  "case": { "id":1, "caseNo":"MTR-20260526-0001", "caseKind":"active", "title":"...",
            "deceasedName":"△△△","schoolName":"○○초","position":"교사","deceasedAt":"2026-05-01",
            "occurredSummary":"...", "status":"collecting", "outcome":null, "outcomeNote":null,
            "procedureStage":"apply", "nextDeadlineAt":"2026-06-15", "nextDeadlineLabel":"순직유족급여 청구 기한",
            "extractionJson": { /* §2.5 — evidenceMissing 포함 */ }, "extractedAt":"...", "assignedAdminId":7 },
  "documents": [
    { "id":10, "fileName":"순직신청서.pdf", "docType":"application", "docTypeAuto":"application",
      "docSummary":"순직유족급여청구서 — 고인 인적사항·청구 요지", "classifyConfidence":92,
      "mimeType":"application/pdf", "extractStatus":"done", "extractMethod":"native_pdf",
      "indexedToRag":false, "blobUrl":"https://...", "createdAt":"..." }
  ],
  "outputs": [
    { "id":50, "outputType":"extraction", "version":1, "status":"draft",
      "contentJson":{...}, "ragSources":[], "modelUsed":"gemini-3-flash", "createdAt":"..." }
  ] }

// POST admin-martyrdom-doc-upload  { caseId, fileName, mimeType, sizeBytes }  (docType 안 받음 — AI 자동분류)
{ "ok": true, "uploadUrl": "https://r2-presigned...", "blobKey":"...", "docId": 10, "expiresIn": 600 }

// POST admin-martyrdom-doc-register { docId }   (R2 PUT 완료 통지 → 추출+자동분류 background)
{ "ok": true, "docId": 10, "extractQueued": true }

// PATCH admin-martyrdom-doc-reclassify { docId, docType?, extractedText? }  (분류 수정 또는 수동 텍스트 입력)
{ "ok": true, "docId": 10, "docType": "duty_stress", "extractMethod": "manual" }

// POST admin-martyrdom-reanalyze { caseId }
{ "ok": true, "analyzeQueued": true }
```

### 2.4 함수 — Phase 2~3 (요약·트리거는 P1 검증 후 확정)
| 함수 | 경로 | 용도 |
|---|---|---|
| `admin-martyrdom-strategy-background` | 내부 | RAG 검색 + `analyzeStrategy` → `ai_outputs(strategy)`. contentJson: 가능논리[]·부족자료[]·쟁점[]·**인과관계 논리 체인[]**·**유사 인정/불인정 사례 일치·불일치 요소[]**·ragSources. ⚠️ **정량 % 일치율 금지**(검증 안 된 숫자가 심의·유족에 오해) — 정성 + 유사 사례 근거로만(§8 경고2) |
| `admin-martyrdom-golden` | `/api/...` | `buildGoldenAdvice` → `ai_outputs(golden)` (체크리스트 우선순위 + 사건 맞춤) |
| `admin-martyrdom-golden-items` | `/api/...` | 체크리스트 마스터 CRUD(super_admin) |
| `admin-martyrdom-readiness` | `/api/...` | **보완⑫ 보고서 준비도/완성도 게이지** — 인정요건 충족도(②)+핵심 증거 확보율(③)+타임라인 완결성(⑩)+모순 없음(⑨)을 합산해 **완성도 % + 부족 항목(무엇을 더 확보하면 +N%)** 반환. **최종 보고서 생성 전 단계에서 직관 표시**(Swain) |
| `admin-martyrdom-draft-background` | 내부 | **인정 보고서 exemplar**(approved 사례 `application` 문서 = 내용·형식·전개·증거 배열 모델) + 사건 구조·전략 + 법령 → `draftDocument` **섹션별 생성** → `ai_outputs(draft_petition)`. 15~30p A4 유족급여신청서 |
| `admin-martyrdom-generate` | `/api/...` | strategy/golden/readiness/draft 생성 트리거(background 호출·type 파라미터) |
| `admin-martyrdom-output-review` | `/api/...` | 산출물 reviewed/discarded + reviewNote |

### 2.5 사건 구조 추출 JSON 스키마 (`extractionJson` / `ai_outputs(extraction).contentJson`)
```jsonc
{
  "deceased": { "name": "...", "school": "...", "position": "...", "servicePeriod": "...", "deceasedAt": "2026-05-01" },
  "death": { "cause": "...", "place": "...", "datetime": "..." },
  "dutyRelevance": { "overwork": "...", "harassment": "...", "stress": "...", "narrative": "..." },
  "medicalCausation": { "psychAutopsy": "심리부검 소견 요지", "diagnosis": "...", "opinion": "업무-질병 인과 의학소견" },
  "causalChain": [ { "factor": "주 60시간 초과근무", "link": "수면장애·우울 악화", "evidence": "근무기록·진단서" } ],
  "timeline": [ { "date": "2026-04-10", "event": "..." } ],
  "evidenceHave": [ "근무기록", "진단서" ],
  "evidenceMissing": [ "메신저 대화", "CCTV" ],
  "keyIssues": [ "공무상 과로 인과관계" ],
  "confidence": 0.0,
  // ↓ caseKind='reference'(과거 인정/불인정 사례)에서만 추출 — 계획서 '인정받는 증거 패턴'(핵심 자산)
  "recognitionPattern": { "outcome": "approved", "decisiveEvidence": ["악성민원 누적 기록","심리부검"], "winningLogic": "민원 강도↔심리 압박↔질병 발생 다중 연결", "rejectionReason": null }
}
```

> 추출 입력 가중치: **유족이 1차 정리한 사건 개요(`statement`)·고인의 카톡 토로(`duty_stress`)** 가 있으면 사건 구조 추출의 **강한 단서(prior)** 로 우선 반영(흩어진 자료보다 정리된 서사가 골격을 잡아줌). 단 출처는 ragSources/문서에 남겨 검토 가능하게.

### 2.6 RAG 색인 (자료 업로드 시 자동 + 법령 시드)
- **자료 업로드 시 자동 색인(주 경로)**: `admin-martyrdom-extract-background`가 자료 1건마다 추출→분류→**청킹·임베딩·UPSERT**. active 사건→`martyr_active`+`case_id`(사건 격리) / reference 사례→`martyr_case`+`case_id`(cross 검색). 전체 재색인 불필요.
- **법령·판례 시드(`martyr_law`)**: `docs/law/martyrdom/*.md`(메인 초안→전문가 검수·§0 Q2) → `chunkManual(md,'md')`. `admin-rag-reindex-background.ts` 확장 + `netlify.toml` included_files. `case_id` NULL.
- **기존 Q&A·메뉴얼(`qna`·`manual`) 색인 회귀 0**(별도 source_type·순직 검색에서 제외).

### 2.7 featureKey (lib/ai-feature.ts)
- `martyrdom_ai` 1개 추가(category `agent_chat` 계열·sortOrder 430). OCR·추출·전략·서면 호출 모두 `recordFeatureUsage('martyrdom_ai', ...)`. 토글 OFF면 생성 차단(조회는 가능). DB 시드는 마이그 또는 UPSERT(BUG-2 교훈 — UPSERT).

### 2.8 분석의 두 자료원 (Swain 2026-05-26 확인 — Deep-Relief AI 분석·서면 생성 방식)
모든 분석(사건 구조 추출·전략·골든타임·서면)은 **두 자료원**을 결합한다:

| 자료원 | 정체 | 역할 | 구현 |
|---|---|---|---|
| **① 우리 도메인 자료** | 순직 사례(`martyr_case` 인정/불인정) + 법령·판례 시드(`martyr_law`) | **근거(grounding)·환각 방지** — "이 논리는 ○○ 사건(인정)·○○법 §N 근거"로 출처 추적 | `searchRag(query, k, ['martyr_case','martyr_law'])` → `ragSources`에 인용 기록 |
| **② AI 학습자료(지식)** | Gemini 모델의 법률·일반 추론·작문 능력 | ①의 근거를 **읽고 논리를 엮어 글로** 생성 | `callGemini`/`callGeminiJSON` system prompt에 ① hits를 `[근거 자료]`로 주입 |

- **순직 코퍼스 한정**: RAG는 `martyr_*`만 검색. 기존 싸이렌 일반 Q&A(`qna`·`manual` — 기부·회원 안내)는 순직 법리와 무관 → **섞지 않음**(노이즈 차단). `searchRag` sourceTypes 필터로 분리.
- **근거 없는 단정 금지**: ② 단독 생성(①에 근거 없음)이면 그 문장은 "(근거 자료 없음·일반 지식)" 표시 → 검토자가 환각 가능성 인지. 불변 원칙 ③(근거 추적)·계획서 XAI 그대로.

---

## §3 화면 설계 (A·프론트)

### 3.1 위치 — 통합 CMS 신규 iframe 페이지 (§6.18·iframe 등록)
- 신규: `public/admin-martyrdom.html` + `public/js/admin-martyrdom.js`
- `cms-tbfa.html` 등록 2곳(자동매핑 포함 4지점):
  1. 사이드바 `ops-mgmt` 그룹에 `<li><a data-tab="martyrdom"><i>🕊️</i><span>순직 인정 지원</span></a></li>`
  2. `<section class="cms-page nf-iframe-page" id="page-martyrdom"><iframe class="nf-iframe" data-nf-src="/admin-martyrdom.html" title="순직 인정 지원"></iframe></section>`
  3·4. `data-tab="martyrdom"` ↔ `id="page-martyrdom"` 자동 매핑 + `data-nf-src` 자동 로드(추가 JS 불필요).

### 3.2 레이아웃 (마스터-디테일)
```
🕊️ 순직 인정 지원 시스템            [+ 새 사건]  [지원대상|과거사례] 토글
┌──────────────┬───────────────────────────────────────────────┐
│ 사건 목록      │  사건 상세: MTR-20260526-0001 ○○초 △△ 선생님   │
│ ─────────────│  상태:[수집중▾] 담당:[김간사▾] 결과:[진행중▾]    │
│ □ ○○초 △△   │ ┌── 탭 ──────────────────────────────────┐   │
│   수집중 3건   │ │ ① 골든타임  ② 자료  ③ 분석  ④ 서면      │   │
│ □ ◇◇중 ▢▢   │ │                                          │   │
│   분석중 5건   │ │ [② 자료 탭]                              │   │
│ □ (과거)인정   │ │  [⬆ 아무 자료나 업로드] (AI 자동분류)      │   │
│   □□초 사건   │ │  ─ 신청보고서.pdf  ✅추출완료  [보기]      │   │
│              │ │  ─ 근무기록.docx   ⏳추출중               │   │
│              │ │  [🔄 사건 구조 재추출]                    │   │
│              │ │  ── 자동 추출 결과 ──                     │   │
│              │ │  고인:△△△ / 사망:2026-05-01 / 쟁점:과로  │   │
│              │ │  확보:[근무기록,진단서] 부족:[메신저,CCTV] │   │
│              │ └──────────────────────────────────────────┘   │
└──────────────┴───────────────────────────────────────────────┘
```
- **① 골든타임 탭**(P2): 휘발성 우선 체크리스트(online 빨강·offline 회색) + [AI 맞춤 제언 생성] → 사건 정황 반영 우선순위.
- **③ 분석 탭**(P2): [전략 분석 생성] → 가능 논리·부족 자료·핵심 쟁점 + **모순·불일치(⑨)·마스터 타임라인+공백(⑩)·예상 반론(⑪)** 카드 + **근거(인용 사례·법령) 펼치기**(환각 방지 가시화).
- **④ 서면 탭**(P3) — 보고서 생성 전 **준비도 게이지(⑫)** 가 맨 위:
  ```
  📊 인정 보고서 준비도  78%  ▓▓▓▓▓▓▓░░
  부족: 심리부검 자료(+12%) · 2024.3 근무기록 공백(+6%) · 동료 진술(+4%)
  [지금 생성] (78%·약한 보고서 경고)   [부족 자료 먼저 보완 권장]
  ── 생성 후 ──
  [유족급여신청서(순직신청서) 초안]  ← 인정 보고서 형식·전개·증거 모델 + 법령
   본문(15~30p·섹션별)+ 섹션마다 근거(인용 사례·조문) + [검토완료/폐기]·검토 메모
   [📄 내보내기 HTML·PDF(G1)]   [📦 사건 패키지 zip(G4)]
  ```
  상단 항상 "⚠️ 전문가 검토용 초안 — 변호사·노무사 확인 필수" 배너.
- 캐시버스터 `admin-martyrdom.js?v=1`.

### 3.3 업로드 흐름 (프론트) — 유형 선택 없음·AI 자동분류
1. `[⬆ 아무 자료나 업로드]` → 파일 선택(유형 안 고름) → `POST admin-martyrdom-doc-upload`(메타·docType 없음) → presigned URL
2. `PUT uploadUrl`(R2 직접·진행률) → 성공 시 `POST admin-martyrdom-doc-register` → 서버가 추출+자동분류 background 트리거
3. 폴링/새로고침으로 `extractStatus` done 확인(진단 가시화 교훈 — 실패 조기 경고) → 자료 행에 **분류 배지(드롭다운으로 수정 가능·`MARTYRDOM_DOC_TYPES` 8종)** + AI 한 줄 요약 + 확신도(낮으면 "확인 필요") 표시
4. 운영자가 배지 드롭다운 변경 → `PATCH admin-martyrdom-doc-reclassify`(docType만 갱신). 분류 라벨·드롭다운은 §1.5 맵을 프론트에 동일 정의(B 합의)

---

## §4 검증 시나리오 (C)

| # | 시나리오 | 기대 |
|---|---|---|
| P1-1 | 새 사건 생성(active) | caseNo 자동·목록 표시 |
| P1-2 | 텍스트 PDF 업로드 | R2 저장·extractStatus done·extractedText 채워짐(native_pdf) |
| P1-3 | docx 업로드 | mammoth 추출 done |
| P1-4 | 스캔본(이미지 PDF) 업로드 | Gemini OCR로 extractMethod=gemini_ocr·텍스트 추출 |
| P1-5 | 사건 구조 재추출 | extractionJson에 고인·사망·쟁점·부족자료 채워짐 |
| P1-6 | 과거 사례(reference) + outcome=인정 업로드 | RAG `martyr_case` 색인(indexedToRag=true) |
| P1-7 | 법령 시드 reindex | `martyr_law` 문서 색인·status 현황 노출 |
| P1-8 | 권한 | 비운영자 401/403·DELETE super_admin only |
| P1-9 | 카톡 자료 수용 | 캡처 이미지→Vision 분류(duty_stress 등) / 내보낸 .txt→텍스트 추출·분류, 둘 다 done |
| P1-10 | 미지원·추출 실패 파일 | 업로드 거부 안 됨·`failed` 표시 + 운영자 수동 텍스트 입력 시 분류·분석 편입(`manual`) |
| P1-11 | 유족 정리 개요 업로드 | `statement` 분류 + 사건 구조 추출 시 강한 단서로 반영 |
| P2-1 | 전략 분석 생성 | 가능논리·부족자료·쟁점 + ragSources(근거) 반환 |
| P2-2 | 골든타임 제언 | online(휘발성) 우선 정렬 + 사건 맞춤 |
| P3-1 | 청구서/의견서 초안 | 본문 + 근거 + "검토용 초안" 배너 |
| P3-2 | 검토완료/폐기 | status reviewed/discarded·reviewNote 저장 |

### 4.2 회귀
- 기존 RAG(AI 비서 `ai_rag_search`) 검색·색인 정상(코퍼스 공유·sourceTypes 필터 하위호환).
- 어드민 로그인·CMS 기존 탭·blob 업로드 다른 기능.
- 비용 안전장치에 `martyrdom_ai` 합산. OCR 실패해도 throw 안 함(fail-safe).

### 4.3 검증 분담 (operational_standards §4)
- C: 코드·응답키·스키마 정합 + 라우팅(401)·tsc·라이브 자산 배포 확인.
- Swain: 브라우저 라이브(업로드·OCR·추출·분석·서면 — 실제 자료 필요).

---

## §5 mock 데이터 (A·B 머지 전)
```javascript
// admin-martyrdom-cases GET
const MOCK_CASES = { ok:true, total:2, cases:[
  { id:1, caseNo:"MTR-20260526-0001", caseKind:"active", title:"○○초 △△ 선생님 사건",
    deceasedName:"△△△", schoolName:"○○초", deceasedAt:"2026-05-01", status:"collecting",
    outcome:null, docCount:3, hasExtraction:true, assignedAdminName:"김간사", createdAt:"2026-05-26T01:00:00Z" },
  { id:2, caseNo:"MTR-20250110-0007", caseKind:"reference", title:"□□초 인정 사례",
    deceasedName:"□□□", schoolName:"□□초", deceasedAt:"2024-12-20", status:"closed",
    outcome:"approved", docCount:5, hasExtraction:true, assignedAdminName:"이전문", createdAt:"2025-01-10T00:00:00Z" } ]};
// admin-martyrdom-case-detail GET
const MOCK_DETAIL = { ok:true,
  case:{ id:1, caseNo:"MTR-20260526-0001", caseKind:"active", title:"○○초 △△ 선생님 사건",
    deceasedName:"△△△", schoolName:"○○초", position:"교사", deceasedAt:"2026-05-01",
    occurredSummary:"과중 업무·악성 민원 정황", status:"collecting", outcome:null,
    extractionJson:{ deceased:{name:"△△△",school:"○○초",position:"교사"},
      death:{cause:"과로 추정",place:"자택",datetime:"2026-05-01"},
      dutyRelevance:{overwork:"주 60시간",harassment:"학부모 민원 다수",stress:"",narrative:"..."},
      timeline:[{date:"2026-04-10",event:"민원 폭주"}], evidenceHave:["근무기록","진단서"],
      evidenceMissing:["메신저 대화","CCTV"], keyIssues:["공무상 과로 인과관계"], confidence:0.62 },
    extractedAt:"2026-05-26T02:00:00Z", assignedAdminId:7 },
  documents:[ { id:10, fileName:"순직신청서.pdf", docType:"application", docTypeAuto:"application",
    docSummary:"순직유족급여청구서 — 고인 인적사항·청구 요지", classifyConfidence:92,
    mimeType:"application/pdf", extractStatus:"done", extractMethod:"native_pdf", indexedToRag:false, blobUrl:"#", createdAt:"..." },
    { id:11, fileName:"민원기록.png", docType:"duty_stress", docTypeAuto:"duty_stress",
    docSummary:"학부모 악성 민원 메시지 캡처", classifyConfidence:88,
    mimeType:"image/png", extractStatus:"done", extractMethod:"gemini_ocr", indexedToRag:false, blobUrl:"#", createdAt:"..." },
    { id:12, fileName:"개인메모.pdf", docType:"other", docTypeAuto:"other",
    docSummary:"유족 개인 정리 메모", classifyConfidence:58,
    mimeType:"application/pdf", extractStatus:"processing", extractMethod:null, indexedToRag:false, blobUrl:"#", createdAt:"..." } ],
  outputs:[ { id:50, outputType:"extraction", version:1, status:"draft", contentJson:{}, ragSources:[],
    modelUsed:"gemini-3-flash", createdAt:"..." } ] };
// P2/P3 mock — strategy/golden/draft (P2 트리거 시 추가)
```

---

## §6 4채팅 트리거 (PARALLEL_TEMPLATE §6 정합·이번 분배는 P1만)

> **베이스 정합(PARALLEL_GUIDE §4.1·필수)**: 분배 **전에** 본 설계서를 `origin/main`에 **push**한다(베이스 push는 §9.3 예외 — 라운드당 1회 필수 enabler). 그 push된 커밋 해시를 아래 `{BASE_HASH}`에 채워 발사. 미push 로컬 main을 베이스로 주면 A·B 베이스 어긋남(2026-05-24 사고).
> **모드**: 평행(A는 §5 mock으로 시작) — A=`public/`, B=`netlify·lib·db·drizzle·package.json` 폴더 분리·충돌 0.
> **머지 순서**: B → Swain `migrate-martyrdom-setup?run=1` → schema 활성화·마이그 삭제 → A → C. (B 응답 키 ↔ A mock 키 1:1 대조 후 머지.)

### 6.0 워크트리 셋업 (모든 트리거 공통·그대로 실행)
```
cd ../tbfa-mis-{X}
git fetch origin
git checkout -B {브랜치} origin/main      # 대문자 -B: 옛 브랜치 강제 재설정
git log --oneline -1                       # 베이스가 {BASE_HASH} 인지 확인
git merge-base --is-ancestor {BASE_HASH} HEAD && echo "베이스 OK" || echo "⚠️ 어긋남 — 메인 보고 후 중단"
```

### 6.1 B 트리거 — 🔧 백엔드 전용 (프론트 작업 ❌)
```
[B — 순직 인정 지원 P1 백 구현] 🔧 백엔드 전용 (화면·HTML·JS 포함 트리거 받았으면 잘못 받은 것·메인 문의)

모델: Sonnet 4.6 / 워크트리: ../tbfa-mis-B / 브랜치: feature/martyrdom-p1-back (베이스 origin/main @ {BASE_HASH})
■ 셋업(§6.0): cd ../tbfa-mis-B; git fetch origin; git checkout -B feature/martyrdom-p1-back origin/main; git log --oneline -1; git merge-base --is-ancestor {BASE_HASH} HEAD && echo 베이스OK || echo "⚠️어긋남-메인보고"
정독(필수): docs/active/2026-05-26-survivor-support.md §1·§2(§2.5·§2.8 포함). 참고: PARALLEL_GUIDE §3·§7
영역: netlify/functions/, lib/, db/schema.ts, drizzle/, package.json, .env.example
금지: public/, assets/, PROJECT_STATE.md, docs/ (상태는 메인에 보고 텍스트로만), lib/auth.ts·admin-guard.ts 수정

[자율주행 정책]
- git push 안 함(메인 단독) — commit까지만, 완료 시 메인에 머지 요청(브랜치·해시·변경 요약)
- 파일 읽기·수정·git(push 제외)·bash·PowerShell·npm install은 묻지 말 것
- 설계·로직·netlify/curl만 묻기 / package.json은 pdf-parse·mammoth 추가만 사전 승인(Swain §0 Q2)
- 막히면 즉시 보고(30분 이상 혼자 헤매지 말 것)

[진행률 보고 의무] 큰 단계(체크박스 1개) 완료마다 "📊 진행률 X% (n/14 완료) — 다음: ..." 한 줄. 매 응답마다 ❌

━━━ §1 DB 체크리스트 ━━━
□ schema.ts append-only(파일 끝 /* === 순직 인정 지원 (2026-05-26) === */ 헤더) — 4테이블 martyrdom_cases·martyrdom_case_documents·martyrdom_ai_outputs·martyrdom_golden_items + **기존 aiRagDocuments에 caseId 컬럼 추가** (마이그 적용 전엔 정의 주석/보류)
□ import 점검: serial·integer·varchar·text·jsonb·date·timestamp·boolean·index 누락 없이
□ migrate-martyrdom-setup.ts (super_admin·GET?run=1·진단 GET·멱등 IF NOT EXISTS·golden_items 8~12행 시드 ON CONFLICT + **ALTER ai_rag_documents ADD COLUMN IF NOT EXISTS case_id integer + 인덱스**)

━━━ §2 API·lib 체크리스트 ━━━
□ lib/ai-ocr.ts — extractDocText({base64,mimeType,fileName}): pdf-parse(텍스트PDF)·mammoth(docx)·평문(txt·md·csv·rtf·카톡 export)·callGemini inlineFiles(이미지/스캔PDF OCR) 분기. 미지원·실패는 throw 금지·{error} 반환(업로드 유지·수동 입력 유도)
□ lib/martyrdom-ai.ts — MARTYRDOM_DOC_TYPES(8대분류·§1.5) + classifyDocument({text?,imageBase64?,mimeType?,fileName}→docType·summary·confidence·이미지는 Vision 시각분류) + extractCaseStructure(§2.5 전체·인과관계 논리체인·심리부검 인과·reference면 recognitionPattern)
□ lib/ai-embedding.ts — searchRag(query,topK,sourceTypes?,caseId?) 필터(기본 전체·하위호환). 순직 분석은 martyr_active(이 caseId 강제)+martyr_case+martyr_law (§1.2·§2.8)
□ lib/ai-feature.ts — featureKey 'martyrdom_ai' 추가(UPSERT 시드·BUG-2 교훈)
□ admin-martyrdom-cases (GET/POST/PATCH·DELETE super_admin·caseNo 자동 MTR-YYYYMMDD-XXXX·PATCH에 procedureStage·nextDeadlineAt·nextDeadlineLabel 포함·보완①경량)
□ admin-martyrdom-case-detail (GET·separate query + JS Map·leftJoin 체인 금지)
□ 보완⑦ 감사·접근 로그: 기존 lib/audit.ts(audit_logs) 재사용 — 사건 조회·자료 열람·산출물 생성에 audit 기록(신규 테이블 X)
□ admin-martyrdom-doc-upload (presign R2·doc row pending·docType 안 받음) / admin-martyrdom-doc-register (blob completed + extract background 호출)
□ admin-martyrdom-doc-reclassify (PATCH {docId, docType?, extractedText?}·분류 수정 또는 추출 실패 파일 수동 텍스트 입력·extractMethod='manual')
□ admin-martyrdom-extract-background (INTERNAL·자동체인: extractDocText→저장→classifyDocument(이미지면 원본 이미지로)→청킹·임베딩·ai_rag_documents UPSERT(active→martyr_active+case_id / reference→martyr_case+case_id·분류·요약 메타)→indexedToRag=true→**사건 자료면 analyze-background 자동 트리거(디바운스·운영자 클릭 불필요)**)
□ admin-martyrdom-analyze-background (INTERNAL·자동 호출됨·extractCaseStructure(대용량은 within-case RAG)→extractionJson + ai_outputs(extraction))
□ admin-martyrdom-reanalyze (POST·예외·수동 강제 새로고침 버튼용)
□ 점검-가 이벤트 알림: extract/analyze background 완료·실패 시 담당 운영자/super_admin에 알림(기존 알림 인프라 재사용·신규 테이블 0)
□ 점검-나 처리 상태 가시화 + 재시도: 자료별 extractStatus(pending/processing/done/failed) 정확 갱신 + 실패 시 재시도(admin-martyrdom-doc-register 재호출 또는 -doc-retry). 조용한 멈춤 금지(RAG BUG-R2-1 교훈)
□ admin-rag-reindex-background 확장 — martyr_law 시드(docs/law/martyrdom/*.md·chunkManual) + netlify.toml included_files (기존 qna·manual 색인 회귀 0)

━━━ 응답 구조 (A mock=§2.3과 키 1:1·1글자도 변경 금지) ━━━
{발사 시 §2.3 JSON 전문 임베드}

━━━ push(=메인 머지) 전 체크 ━━━
□ export const config = { path } 각 /api 함수 / requireAdmin→auth.res·super_admin은 requireRole(member,'super_admin')
□ background는 INTERNAL_TRIGGER_SECRET 인증·fail-closed·throw 안 함 / embedding은 raw SQL만(schema 회귀 격리)
□ npx tsc --noEmit 통과 / 마이그 적용 전 schema 4테이블 활성화 금지(헤더만)
□ 완료 보고: 브랜치·해시·변경 파일 + 체크박스 전체 체크 한 줄 + schema 격차 적응 시 별도 표
```

### 6.2 A 트리거 — 🎨 프론트 전용 (백·lib·db 작업 ❌)
```
[A — 순직 인정 지원 P1 프론트 구현] 🎨 프론트 전용 (lib·함수·DB 포함 트리거 받았으면 잘못 받은 것·메인 문의)

모델: Sonnet 4.6 / 워크트리: ../tbfa-mis-A / 브랜치: feature/martyrdom-p1-front (베이스 origin/main @ {BASE_HASH})
■ 셋업(§6.0): cd ../tbfa-mis-A; git fetch origin; git checkout -B feature/martyrdom-p1-front origin/main; git log --oneline -1; git merge-base --is-ancestor {BASE_HASH} HEAD && echo 베이스OK || echo "⚠️어긋남-메인보고"
정독(필수): docs/active/2026-05-26-survivor-support.md §3. 참고: PARALLEL_GUIDE §3
영역: public/, assets/  금지: lib/, netlify/functions/, db/, drizzle/, PROJECT_STATE.md, docs/
모드: 평행(아래 mock으로 시작·B 머지 후 실 API 자동 전환)

[자율주행 정책] git push 안 함(메인 단독)·commit 후 머지 요청 / 파일·git(push제외)·bash·npm install 자율 / 설계·로직만 묻기 / 막히면 즉시 보고
[진행률 보고 의무] 큰 단계 완료마다 "📊 진행률 X% (n/8 완료) — 다음: ..." 한 줄

━━━ mock (B 머지 전·키 1글자도 변경 금지) ━━━
{발사 시 §5 MOCK_CASES·MOCK_DETAIL 전문 임베드}

━━━ §3 화면 체크리스트 ━━━
□ public/admin-martyrdom.html — 마스터-디테일 + 탭 4개(①골든타임 ②자료 ③분석 ④서면). P1은 ②자료만 실동작·①③④ placeholder
□ public/js/admin-martyrdom.js — api()(credentials:'include'·이중 stringify 금지)·showToast·로딩·401시 admin.html 리다이렉트·캐시버스터 ?v=1
□ 사건 목록: 지원대상/과거사례 토글·새 사건 모달(제목·고인·학교·사망일)·상세(상태·담당·결과 셀렉트 PATCH)
□ 보완① 상세에 절차 단계(신청→심의→결정→재심)·다음 기한 D-day 표시·편집(procedureStage·nextDeadlineAt·nextDeadlineLabel PATCH)
□ 보완③ 자동 추출 결과에 "부족 증거(evidenceMissing)" 강조 표시(운영자가 다음 확보 대상 한눈에)
□ ②자료 탭 업로드: [⬆ 아무 자료나 업로드](유형 선택 X·**다중 파일 동시 선택=G2 일괄 이관 기초**) → doc-upload(메타) → PUT R2 → doc-register → extractStatus 폴링
□ G6 자료 원문 뷰어: 행 [보기] → 업로드 원본(PDF·이미지) 인라인 미리보기(presigned URL·추출·분류 대조용)
□ 자료 행: AI 자동분류 배지(8대분류 드롭다운 수정→doc-reclassify)·한줄요약·확신도(낮으면 "확인 필요")·자동 추출 결과 표시 — ※ 이미지·사진·카톡 캡처도 분류 표시(§1.5)
□ 추출 실패(failed)·미지원 파일: 행에 "텍스트 직접 입력" 버튼 → 운영자가 요약/내용 붙여넣기 → doc-reclassify(extractedText) (업로드는 어떤 파일도 거부 안 함)
□ 점검-나 처리 상태 가시화: 자료별 상태 배지(대기/처리중/완료/실패) + 실패 행 "재시도" 버튼 + 사건 단위 진행 표시(조용한 멈춤 방지)
□ MARTYRDOM_DOC_TYPES 8대분류 라벨 맵 프론트에 동일 정의(코드 키 B와 1:1)
□ cms-tbfa.html 2곳 등록: 사이드바 li(data-tab="martyrdom"·🕊️) + section nf-iframe-page id="page-martyrdom" data-nf-src="/admin-martyrdom.html"
□ ④서면 탭 상단 "⚠️ 전문가 검토용 초안 — 변호사·노무사 확인 필수" 배너 자리(P3 연결)

━━━ push(=메인 머지) 전 체크 ━━━
□ mock 키명 = B 응답(§2.3)과 1:1 / <script> 캐시버스터 ?v=1 / public/ 외 변경 0
□ cms-tbfa에서 🕊️ 메뉴 클릭 시 iframe 로드 확인(자산 경로)
□ 완료 보고: 브랜치·해시·변경 파일 + mock 사용 위치(실 API 전환 대비) + 체크박스 전체 체크 한 줄
```

### 6.3 C 트리거 — 🔍 검증 전용 (B·A 머지 후 발사)
```
[C — 순직 인정 지원 P1 검증·fix] 🔍 검증 전용

모델: Opus 4.7 / 워크트리: ../tbfa-mis-C / 브랜치: verify/martyrdom-p1 (베이스 origin/main @ {B·A 머지 후 해시})
■ 셋업(§6.0): cd ../tbfa-mis-C; git fetch origin; git checkout -B verify/martyrdom-p1 origin/main; git log --oneline -1
정독: docs/active/2026-05-26-survivor-support.md §4. 참고: PARALLEL_GUIDE §7·§8

작업 순서:
  1) §4 P1-1~P1-8 시나리오 — 코드·응답키·스키마 정합 정독 + 라우팅(401 게이트) + npx tsc --noEmit + 라이브 자산 배포 확인. 항목별 검증 방식 명시(브라우저 라이브 불가 항목은 "정독만" 명시)
  2) §4.2 회귀 — 기존 RAG(ai_rag_search) 검색·색인 / 어드민 로그인·CMS 기존 탭 / blob 업로드 다른 기능 / 비용 안전장치 martyrdom_ai 합산
  3) BUG 발견 시 fix 커밋(verify 브랜치 그대로) → 메인 보고 (역할 전환 fix는 PARALLEL_GUIDE §17)
  4) 보고서 docs/history/verify/2026-05-26-martyrdom-p1.md
표현 규칙(§6.14): 함수·코드 용어 없이 사용자 동작·결과 위주
[자율주행 정책] git push 안 함·commit 후 메인 보고  [진행률 보고 의무] 큰 단계마다 한 줄
```

> P2(전략·골든타임)·P3(서면) 트리거는 P1 Swain 라이브 검증 통과 후 본 §6에 추가.

---

## §7 라운드 마감 체크리스트

- [ ] **P1**: 코어 + 자동분류·색인·구조추출 + 보완⑦감사로그·①경량 기한·③부족증거 표시. B·A·C 머지 + Swain `migrate-martyrdom-setup?run=1` → schema 활성화·마이그 삭제 → 자료 업로드·OCR·추출 라이브 검증 → 1회 push
- [ ] **P2**: 전략·골든타임 + 보완②인정요건 대조·④논리맵 데이터·①기한 트래커 풀(cron)·③액션 추적·⑥학습 피드백 시작
- [ ] **P3**: 서면 초안 + 보완⑤전문가 검토·④논리맵 UI·⑥학습 피드백 완성
- [ ] **P4 종결**: AI 비서 도구(martyrdom_cases_list/detail 읽기) + 보완⑧유족 전달용 쉬운 요약 출력 + featureKey 정착 + 메뉴얼(manual-admin)·`docs/manual/ai-assistant-knowledge.md`·jsonl에 "순직 인정 지원" 안내 + 권한 시드 + iframe 4곳 확인(release_checklist) + 설계서 history 이동
- [ ] 불변 원칙 점검: 모든 AI 출력 "전문가 검토용 초안" 배너 / 근거(ragSources) 노출 / 인정+불인정 둘 다 색인

---

## 부록 A — 신규 npm 의존성
- **P1(Swain §0 Q2 승인)**: `pdf-parse`(텍스트 PDF 추출)·`mammoth`(docx→텍스트). 스캔본 OCR·이미지 분류는 기존 `GEMINI_API_KEY`(의존성 0). hwp는 변환 안내(파싱 0).
- **P3 보고서 내보내기(G1)**: PDF는 기존 `pdf-lib`+NotoSansKR 또는 print CSS(의존성 0) / **편집가능 docx 직접 생성 시 신규 lib**(`html-to-docx` 등)는 그때 Swain 확인. MVP는 편집가능 HTML+PDF로 의존성 0 가능.
- **사건 패키지(G4)**: 기존 `JSZip` 재사용(의존성 0).

## 부록 B — 신규 환경변수
- 없음(기존 `GEMINI_API_KEY`·`GEMINI_EMBED_*`·`INTERNAL_TRIGGER_SECRET`·R2 재사용). featureKey `martyrdom_ai`는 DB 시드.

---

## §8 Deep-Relief AI 사업계획서 정합·로드맵 (2026-05-26 Swain 확정)

본 모듈 = 초기창업패키지 사업계획서 **'Deep-Relief AI'의 v0(내부 엔진·MVP·데이터 적재)**. 계획서 일정(데이터 이관·색인 26.04~06 → 알파 26.09 → 교육청 PoC 26.09~12)의 내부 코어.

### 8.1 지금 흡수 (계획요소 일부·싸고 가치 큼)
| # | 계획서 요소 | 본 설계 반영 |
|---|---|---|
| 1 | "인정받는 증거 패턴"(핵심 자산) | reference 사례에서 `recognitionPattern`(결정적 증거·인정 논리·패인) 구조 추출·색인(§2.5) |
| 2 | 인과관계 추론(multi-hop) | 전략 분석에 `causalChain`(업무요인→의학소견→인정사례 일치 논리 사슬)·지식그래프 없이 프롬프트 경량 구현(§2.4·§2.5) |
| 3 | 국과수 심리부검 패턴 | `medicalCausation.psychAutopsy` 1급 요소·의학 인과 소견(§2.5) |
| 4 | XAI(출처 명시) | 기존 `ragSources` 근거 추적이 그대로 충족 |
| 5 | 하이브리드(AI+전문가 검증) | "전문가 검토용 초안" + reviewed/discarded 검증 루프 |

### 8.2 본편으로 미룸 (정부지원·전담팀·GPU 단계)
- 독자 LLM 파인튜닝(DR-LLM)·지식그래프(Knowledge Graph)·온톨로지·환각제어 레이어·정량 % 인과추론 엔진
- B2C(유족 직접 업로드)·B2B(노무법인 라이선스)·B2G(교육청 구독)·조달청 혁신제품
- 폐쇄형 인프라·데이터 비식별화·암호화·ISO 27001·외부 보안 감사

### 8.3 솔직한 경고 (설계에 박음)
1. **6건 파인튜닝 비권장** — 표본 과소·환각·과적합 위험. 계획서도 "환각 제거는 RAG". → RAG-우선이 정답. 파인튜닝은 데이터 수백 건 후 선택.
2. **정량 % 일치율 금지(현 단계)** — 미검증 숫자가 심의·유족에 "확정 판단" 오해. 정성 + 유사 사례 근거로만(§2.4).
3. **유족 직접 노출 금지(현 단계)** — 운영자 검증 루프 필수(Q4 운영자 전용). 틀리면 유족에 치명적.

### 8.4 데이터 자산·이관
- 사건 데이터를 **오늘부터 구조화·색인** → 본편의 가장 비싼 자산을 선적재.
- **Flowith AI** 흩어진 학습 데이터는 텍스트로 내보내 본 RAG(`martyr_case`·`martyr_law`)로 이관·색인 가능(외부 도구 종속 해소·계획서 step1 "데이터 이관" 내부 실현). P4 또는 별도 라운드.

### 8.5 보안 현 수준 + 레벨업 트리거
- 현재(내부 PoC): 운영자 전용 인증 게이트 + R2 비공개(`isPublic=false`) + 감사 로그(보완⑦). 소규모 내부엔 충분.
- 레벨업 필요 시점(확장·B2C·기관 연동): 비식별화·저장 암호화·접근 감사 강화·ISO 27001. → 본편 과제.

### 8.6 독립 모듈 경계 (standalone 분리 준비 — 임베드+독립 모듈 결정)
v0는 싸이렌 CMS에 임베드하되 **딥릴리프를 독립 모듈로 격리**해 본편 때 떼어내기 쉽게:
- **전용 자산**: 테이블 `martyrdom_*` / RAG source_type `martyr_*`(+ `case_id`) / 화면 `admin-martyrdom*` / lib `martyrdom-ai`·`ai-ocr`. → 분리 시 이 세트만 이관.
- **공용 의존 최소화**: SIREN 공용은 **인증·R2·Gemini·RAG 엔진**만 공유(인터페이스). SIREN 도메인 테이블(members 등) 직접 의존은 **담당자 FK 정도로만** 한정(분리 시 사용자 매핑만 교체).
- **분리 로드맵**: 본편(정부지원)에서 `martyrdom_*` + `martyr_*` row + 전용 함수/화면을 독립 앱(자체 도메인·인증·B2G/B2C·ISO27001)으로 이관. v0는 협회 내부 인스턴스로 잔존 또는 이관.

---

## §9 보완 로직·워크플로우 8종 (단계 배치·forward spec)

Swain 2026-05-26 "8종 전부 단계 반영". **P1은 ⑦·①(경량)·③(표시)만 실제 구현**, ②④⑤⑥⑧은 해당 Phase 트리거 때 상세 확정(여기선 데이터·접근만 못박음).

| ⓝ | 보완 | 데이터 (신규/재사용) | 핵심 로직·API | Phase |
|---|---|---|---|---|
| **①** | 절차·기한 트래커 + 데드라인 알림 | P1: `martyrdom_cases.procedureStage`·`nextDeadlineAt`·`nextDeadlineLabel`(경량) / P2: 신규 `martyrdom_deadlines`(caseId·label·dueDate·stage·status·alertedAt) | P2: `cron-martyrdom-deadline`(D-day·소멸시효 임박 운영자 알림) | P1경량·P2풀 |
| **②** | 인정 요건 대조 체크리스트 | 신규 `martyrdom_criteria`(요건 master·seed·super_admin CRUD) + 사건별 결과는 `ai_outputs(outputType='criteria_check'·요건별 충족/미흡/근거·ragSources)` | 분석 시 요건 매트릭스 자동 대조 | P2 |
| **③** | 부족 증거 → 액션 | P1: `extractionJson.evidenceMissing` 표시 / P2: 신규 `martyrdom_actions`(caseId·item·status·source·dueDate) | 부족 증거를 확보 액션으로(워크스페이스 칸반 연동 옵션) | P1표시·P2추적 |
| **④** | 인과관계 논리맵 | `extractionJson.causalChain`(이미 §2.5) | P2 데이터 정교화·P3 시각화 UI(public·고리마다 증거/부족) | P2·P3 |
| **⑤** | 전문가 검토 워크플로우 | `ai_outputs.status/reviewedBy/reviewNote`(이미) + 배정·코멘트(`ai_outputs` 확장 또는 신규 `martyrdom_reviews`) | 초안→전문가 배정→코멘트→승인. `admin-martyrdom-output-review` 확장 | P3 |
| **⑥** | 사건 종결 → 학습 피드백 루프 | 종결(`status='closed'`+`outcome`) 시 `recognitionPattern`(§2.5) 자동 추출 → `martyr_case` 색인 | 종결 훅·background(통한/안 통한 논리 자동 학습) | P2~P4 |
| **⑦** | 감사·접근 로그 + 민감정보 보호 | **기존 `audit_logs` 재사용**(`lib/audit.ts`) | 사건 조회·자료 열람·출력 생성·다운로드 기록 + 운영자 전용 게이트 | **P1 기본** |
| **⑧** | 유족 전달용 쉬운 요약 | `ai_outputs(outputType='family_summary')` | 쉬운 말 진행 요약·다음 할 일. **운영자가 생성·전달**(유족 로그인 화면 아님·Q4 정합) | P4 |

> 신규 테이블 총계: P1 코어 4 + (P2) `martyrdom_deadlines`·`martyrdom_criteria`·`martyrdom_actions`(+P3 `martyrdom_reviews` 선택). 각 Phase 트리거 때 §1에 정식 추가(append-only).

### 9.1 추가 핵심 로직 (2026-05-26 Swain "핵심 로직만 반영")
8종 외에 입증의 질을 좌우하는 핵심 로직 추가 — **P2 분석에 핵심으로 편입**:
| ⓝ | 보완 | 내용 | 데이터 | Phase |
|---|---|---|---|---|
| **⑨** | **모순·불일치 탐지(Semantic Matching)** ⭐ | 자료 간 날짜·사실 모순 자동 탐지(진단일 vs 근무기록 vs 진술) → 심의 제출 전 치명적 오류 거름. 사업계획서 시그니처 | `ai_outputs(outputType='conflicts')`·자료 cross-check | P2 |
| **⑩** | **마스터 타임라인 + 공백 탐지** ⭐ | 모든 자료의 날짜를 하나의 연표로 병합(과로→발병→사망 선후) + "비어있는 구간(자료 필요)" 표시 | `extractionJson.timeline` 확장(출처 doc·gap 플래그) | P2 |
| **⑪** | **예상 반론·패인 대비** ⭐ | 공단·심의위 예상 반론(개인 사유·기존 질환 등) 예측 + 대비 논리(불인정 사례 역활용) | `ai_outputs(strategy).contentJson.counterArguments[]` | P2~P3 |
| (흡수) | **증거 강도·객관성** | 자료별 증거력(공문서>진단서>진술>캡처) 평가 → 전략 우선순위 | `martyrdom_case_documents.evidenceStrength`(강/중/약) — classifyDocument가 함께 판정 | 추출 흡수 |
| (흡수) | **사건 유형 분류** | 과로/괴롭힘/사고/질병 유형 → 맞춤 전략·요건·유사사례 | `extractionJson.caseType` | 추출 흡수 |
| **⑫** | **보고서 준비도/완성도 게이지** ⭐ | **최종 보고서 생성 전**, "지금 몇 % 완성·무엇을 더 채우면 인정 가능성↑"을 직관 표시(Swain 2026-05-26). 완성도 % = 인정요건 충족도(②)+핵심 증거 확보율(③)+타임라인 완결성(⑩)+모순 없음(⑨) 합산. 부족 항목마다 "이거 채우면 +N%" | `admin-martyrdom-readiness` → `ai_outputs(readiness)` (점수·부족 체크리스트·기여도) | P2~P3 |

### 9.2 최종 보고서 생성 = "인정받은 보고서" 통째 학습 (Swain 2026-05-26 핵심 요청)
운영자가 사건별로 **순직 신청서**를 업로드 → 인정된 사건의 신청서/보고서는 **형식·목차·전개방식·증거 배열까지** 학습 대상이 됨.

- **exemplar 색인**: 인정(`outcome='approved'`) 사례의 `application` 문서를 RAG에 **형식 모델**로 색인(분류·요약 메타 + "approved report" 표시). `draftDocument`가 유사 사건의 인정 보고서를 few-shot으로 검색.
- **생성 입력 3종**: ① 인정 보고서 exemplar(형식·전개·증거 배열) + ② 이 사건의 구조·전략·타임라인 + ③ 법령 보완(`martyr_law`).
- **분량**: 유족급여신청서 평균 A4 15~30p → **섹션별 생성**(목차 → 섹션 순차 생성·출력 토큰 한계 대응) 후 합본. 각 섹션 근거(ragSources) 표시.
- **준비도 게이지(⑫)와 연동**: 완성도가 낮으면 "지금 생성하면 약한 보고서 — ○○ 먼저 보완 권장" 안내 후 생성.

> **가드레일**: 별도 기능 추가는 보류(Swain "핵심 로직만")하되, **이미 설계에 내재된 안전장치는 유지** — 근거 추적(`ragSources`)·"검토용 초안" 배너·검토 상태(reviewed/discarded)·운영자 전용·감사 로그(⑦). 별도 빌드 없이 그대로 동작.

### 9.3 추가 기능 6종 (2026-05-26 Swain "6개 전부 반영" — 끝까지 쓸 수 있는 완결성)
| Gn | 기능 | 내용 | 데이터·API | Phase |
|---|---|---|---|---|
| **G1** | **보고서 내보내기** ⭐ | 생성된 유족급여신청서를 **제출용으로 다운로드**. MVP = 편집가능 HTML(운영자가 한글/Word로 열어 수정) + PDF(print CSS·NotoSansKR). docx 직접 생성은 신규 lib 필요 → 옵션 | `admin-martyrdom-export`(caseId·outputId·format) | P3 |
| **G2** | **기존 데이터 일괄 이관·색인** ⭐ | 6건+Flowith 자료를 **여러 파일 한 번에** 업로드→추출→분류→색인(코퍼스 부트스트랩). 업로드 파이프라인 배치 재사용 | 일괄 업로드 화면 + `admin-martyrdom-bulk-import`(또는 업로드 반복+reindex) | P1~P4 도구 |
| **G3** | **다중 사건 대시보드** | 진행 사건들의 **기한 임박·준비도(⑫)·상태**를 한눈에 + 임박 사건 상단 표시 | `admin-martyrdom-dashboard`(집계) + 대시보드 화면/탭 | P2~P4 |
| **G4** | **사건 패키지 내보내기(zip)** | 자료+분석+보고서를 한 묶음 zip → 변호사·노무사 전달·종결 archive (JSZip 보유) | `admin-martyrdom-package`(caseId→zip) | P3~P4 |
| **G5** | **인정률·성과 통계** | 지원 사건 **인정/불인정 추이·유형별 인정률** — 운영 인사이트 + 사업계획서 KPI 근거 | `admin-martyrdom-stats`(집계) + 통계 화면 | P4 |
| **G6** | **자료 원문 뷰어** | 업로드 원본(PDF·이미지)을 화면에서 바로 보며 추출·분류 대조 | blob presigned URL 인라인 뷰어(②자료 탭) | P1 경량 |

### 9.4 연구 발간지 (외부 발간·비식별화 필수 — Swain 2026-05-26)
사단법인의 **연구 발간 미션** — 축적된 사건·법령·인정 패턴·통계를 종합해 **외부 발간용 연구 자료**를 생성. 개별 사건 지원과 별개로 "분야 전체"에 기여(계획서 ESG-S 공익과 정합). **단, 실명·식별정보 절대 비공개.**

**발간물 3종(운영자가 선택 생성)**
| 유형 | 내용 | 데이터 |
|---|---|---|
| **종합 가이드** | "교사 사망 시 순직 인정까지 — 단계별 **해야 할 것·확보할 자료·인정 받는 법**" 실무 가이드 | 축적 사례 + 골든타임(①) + 인정요건(②) + 인정 패턴(⑥) 종합 |
| **순직 인정 동향 보고서** | 인정률 추이·유형별 경향·인정/불인정 요인·정책 시사점 | 통계(G5) + recognitionPattern cross-case 종합 |
| **익명 사례 연구** | 선정 사례를 **익명화**해 인정 논리·교훈 분석 | martyr_case(비식별 처리) |

**비식별화 수준 (Swain 2026-05-26: "어느 정도 익명화 안 해도 OK·서이초 ○○선생님 정도")**
- **기본 = 경량 마스킹**: **고인·유족 실명만 부분 가림**(○○ 선생님), **학교명·지명·맥락은 유지 가능**(예: "서이초 ○○선생님"). 강한 일반화 강제 X.
- **단 제3자는 가림**: 가해 민원인·동료 등 **사건 당사자 아닌 제3자 실명은 마스킹**(이들은 공개 동의 없음).
- **수준 조절**: 발간물별로 운영자가 마스킹 강도 선택(이미 언론에 공개된 사건=가볍게 / 비공개·민감 사건=강하게 또는 유족 동의).
- **외부 공개 전 사람 검수·승인 게이트 유지**: 외부로 나가는 유일한 산출물이라, 자동 생성 후 운영자/책임자가 검수·승인해야 발간 확정.
- **3종 전부 발간**(Swain): 종합 가이드·동향 보고서·익명 사례 연구 모두 생성.

**데이터·구현**
- 신규 `martyrdom_publications`(type·title·contentHtml·anonymized boolean·reidRisk·status[draft|reviewed|published]·publishedBy·publishedAt) — 또는 `ai_outputs(outputType='publication')`.
- cross-case 종합(한 사건 X·여러 사건 집계) + 비식별화 → G1 내보내기로 HTML/PDF 발간물 export.
- 화면: "📚 연구 발간" 탭(운영자) — 유형 선택 → 생성 → 익명화 검수 → 발간 export.
- featureKey `martyrdom_ai` 공유. 권한 super_admin(외부 발간 책임).
- **Phase: P4**(데이터가 어느 정도 축적된 뒤 의미). 또는 P4 직후 별도 라운드.

---

## §10 전체 정독 점검 결과 (2026-05-26 — Swain "P1~P4 정독해 빠진 것 체크")

메인이 설계서 전체를 정독해 점검. **새 기능 추가보다 빠진 연결고리·정합성·범위 조언** 위주.

### 10.1 정합성 (1줄 명확화)
- **상태축 2개 역할 구분**: `status`=내부 작업 단계(접수→수집→분석→서면→종결) / `procedureStage`=외부 행정 절차(신청→심의→결정→재심). 둘은 독립(작업이 끝나도 행정은 진행 중일 수 있음). 화면·문서에 이 구분 명시.

### 10.2 빠진 로직·워크플로우 (추천)
| # | 빠진 것 | 이유 | 권장 |
|---|---|---|---|
| **가** | **이벤트 알림** | 98% 자동인데 추출·분석 완료/실패·검토 요청·기한 임박 알림이 없으면 운영자가 인지 못 함. 플랫폼 알림(`workspace-logger`/notifications) 재사용 | P1 경량(완료/실패) → P2(기한·검토) |
| **나** | **처리 상태 가시화 + 실패 재시도** | 자동 체인 중 단계 실패(OCR·임베딩 404 등) 조용히 멈춤 방지. 단계별 상태 노출 + 재시도. RAG "0건 무통지"(BUG-R2-1) 교훈 | P1 |
| **다** | **운영자 코퍼스 검색** | 과거 사례·법령 직접 의미 검색(AI 비서 대화 외 검색창). `searchRag` 그대로 노출 | P2 |
| **라** | **유족 동의·데이터 보존/파기** | 고인·유족 민감정보 동의 기록 + 보존기간·파기. 데이터 수명 워크플로우 | P2+ |

> **Swain 결정(2026-05-26): 가·나·다·라 전부 단계 반영.** → **가·나는 P1 흡수**(알림·상태 가시화·재시도 — 신규 테이블 0·기존 알림/상태 재사용), **다(코퍼스 검색)·라(동의·보존/파기)는 P2+** forward spec. P1은 여전히 신규 테이블 4개 + 기존 컬럼 추가만.

### 10.3 범위 조언 (중요)
- 설계가 매우 큼(코어 + 보완 12 + G 6 + 연구발간 + §10.2). **여러 달짜리 프로그램.**
- **P1 먼저 배포·검증** 후 P2~P4 진행 강력 권장. 토대(자료→자동분류→색인→구조추출)가 실제 자료로 작동함을 확인한 뒤 분석·서면·발간을 얹는다. 전부 설계는 유지하되 **빌드·배포는 P1부터 단계.**

---

# ★ P2 구현 설계 (확정 2026-05-26 — Swain 결정 반영·"한 번에 전부")

> P1 토대(자료→자동분류→색인→구조추출·알림·재시도·CRUD·전 형식 추출)는 라이브 작동 확인됨.
> P2 = **분석·요건·기한·액션·대시보드·코퍼스·보존알림**을 한 라운드에 구현(B·A·C 병렬).
> 단일 출처는 본 문서. 트리거는 §P2.6에서 복사.

## §P2.0 요구사항 확정 (Swain 2026-05-26)

| # | 항목 | 결정 |
|---|---|---|
| 1 | **P2 범위** | **한 번에 전부**(P2a/b 분할 안 함) — 분석 6종 + 운영 6종 |
| 2 | **자동 분석 범위** | 자료 업로드 → **추출 → 전략(③+⑨모순+⑩타임라인+⑪반론)까지 자동**. 골든(①)·요건대조(②)·준비도(⑫)는 **운영자 [생성] 버튼**(AI 비용 통제) |
| 3 | **인정요건(②) master 출처** | **법령 시드 파싱 → 자동 생성 + 어드민 수정**. 마이그가 기본 요건 세트 시드(즉시 작동) + `criteria-generate`로 법령 AI 파싱 보강 |
| 4 | **준비도 게이지(⑫)** | **규칙(코드) 계산 %**(요건40·증거30·타임라인15·모순15 가중·재현 가능·"인정 확률 아님·내부 가늠용" 라벨) **+ AI 첨언**(정성 코멘트만·숫자 X) |
| 5 | **모순 탐지(⑨)** | 날짜+사실+인과 모순·**심각도(치명/주의) 표기** (메인 기본안) |
| 6 | **코퍼스 검색(다)** | **과거사례(`martyr_case`)+법령(`martyr_law`)만**. 진행 사건(`martyr_active`) 제외(교차 노출 방지) (메인 기본안) |
| 7 | **부족증거 액션(③)** | **자체 목록**. 워크스페이스 칸반 연동은 옵션(컬럼만·기본 OFF) (메인 기본안) |
| 8 | **증거 강도** | 분류(`classifyDocument`) 시 **강/중/약 함께 판정** → 자료 행 배지·전략 우선순위 (메인 기본안) |
| 9 | **라 유족 동의·보존/파기** | **파기 안 함**(원본·데이터=자산 축적). **저장 용량 임계 초과 시 알림** → 운영자가 백업 후 수동 파기(기존 삭제 재사용). 동의는 최소 기록 필드(`consentNote`·`consentObtainedAt`) |
| 10 | **자동화/사람** | 98% 자동/2% 사람 유지. AI 출력은 **운영자 전용**(유족 화면 X)·**정량 % 일치율 금지**(정성+근거만) |

## §P2.1 DB 설계

### 신규 테이블 3개 (append-only — schema.ts 끝 `/* === P2 순직 === */` 헤더 아래)

```typescript
/* === P2 순직 인정 지원 (2026-05-26) === */

// 보완① 절차·기한 풀 트래커
export const martyrdomDeadlines = pgTable("martyrdom_deadlines", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => martyrdomCases.id, { onDelete: "cascade" }).notNull(),
  label: varchar("label", { length: 200 }).notNull(),          // '소멸시효(3년)'·'심의위 자료 제출'
  kind: varchar("kind", { length: 30 }).default("custom"),     // statute_limit | submission | hearing | custom
  dueDate: date("due_date").notNull(),
  stage: varchar("stage", { length: 40 }),                     // procedureStage 연동
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending|done|overdue
  alertedAt: timestamp("alerted_at"),                          // 중복 알림 방지
  note: text("note"),
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ caseIdx: index("martyrdom_deadlines_case_idx").on(t.caseId) }));

// 보완② 인정요건 master (super_admin CRUD·법령 시드)
export const martyrdomCriteria = pgTable("martyrdom_criteria", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),    // duty_performance·causation 등
  category: varchar("category", { length: 60 }).notNull(),     // 대분류: 공무수행성·인과관계·과실·절차
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),                            // 무엇을 입증해야 하나
  evidenceHint: text("evidence_hint"),                        // 충족시키는 자료(8대분류 매핑)
  lawRef: varchar("law_ref", { length: 300 }),                // 근거 법령·시드 출처
  weight: integer("weight").default(1),                       // 준비도 요건 점수 배분
  sortOrder: integer("sort_order").default(0),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 보완③ 부족 증거 → 확보 액션
export const martyrdomActions = pgTable("martyrdom_actions", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => martyrdomCases.id, { onDelete: "cascade" }).notNull(),
  item: varchar("item", { length: 300 }).notNull(),
  detail: text("detail"),
  status: varchar("status", { length: 20 }).default("todo").notNull(),  // todo|doing|done
  source: varchar("source", { length: 30 }).default("manual"),          // missing_evidence(AI)|manual
  dueDate: date("due_date"),
  workspaceTaskId: integer("workspace_task_id"),                        // 칸반 연동 옵션(기본 NULL)
  sortOrder: integer("sort_order").default(0),
  createdBy: integer("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ caseIdx: index("martyrdom_actions_case_idx").on(t.caseId) }));
```

### 기존 테이블 컬럼 추가
- `martyrdom_case_documents.evidence_strength varchar(10)` — strong|medium|weak (보완 증거강도·classifyDocument 함께 판정·NULL 허용).
- `martyrdom_cases.consent_note text` + `consent_obtained_at timestamp` — 유족 동의 최소 기록(라·NULL 허용).
- **`ai_outputs.output_type` 신규 값**(varchar라 스키마 변경 0): `strategy`·`golden`·`criteria_check`·`readiness`.

### 마이그레이션 `migrate-martyrdom-p2` (§6.8 표준·GET ?run=1)
1. CREATE 3 테이블 (IF NOT EXISTS) + 인덱스.
2. ALTER martyrdom_case_documents ADD evidence_strength / martyrdom_cases ADD consent_note·consent_obtained_at (IF NOT EXISTS).
3. **martyrdom_criteria 기본 요건 시드**(멱등·code UNIQUE) — 순직 인정 핵심 요건 세트:
   | code | category | title | weight |
   |---|---|---|---|
   | `duty_performance` | 공무수행성 | 공무(교육활동·부수업무) 수행 중 발생 | 3 |
   | `causation_medical` | 인과관계 | 공무와 사망(질병·사고) 사이 상당인과관계(의학) | 3 |
   | `overwork` | 직무부담 | 과로·장시간근무 입증 | 2 |
   | `duty_stress` | 직무부담 | 악성민원·괴롭힘 등 직무 스트레스 입증 | 2 |
   | `mental_causation` | 인과관계 | 정신질환·심리적 요인과 공무 관련성(심리부검 등) | 2 |
   | `no_private_cause` | 과실/기여 | 개인적 사유·기존질환 기여도 반박 | 2 |
   | `objective_record` | 객관입증 | 수사·감사·공문서 등 객관 자료 확보 | 1 |
   | `procedure_eligibility` | 절차 | 청구 자격·기한(소멸시효) 충족 | 1 |
   - 이후 `admin-martyrdom-criteria-generate`로 법령 문서(`docs/law/martyrdom/02`) AI 파싱해 보강·운영자 검토.
4. 환경변수 `MARTYRDOM_STORAGE_ALERT_GB`(기본 20) — 저장 용량 알림 임계.
5. 호출 성공 후 schema 정의 활성화·파일 삭제.

## §P2.2 API 명세

### 함수 목록

| 함수 | path | method | 권한 | 역할 |
|---|---|---|---|---|
| `admin-martyrdom-generate` | `/api/admin-martyrdom-generate` | POST | admin | 버튼 디스패처 `{caseId, type}` — strategy/golden/criteria는 status processing + generate-background 트리거. **readiness는 inline 계산** |
| `admin-martyrdom-generate-background` | (내부·config.path **금지**) | POST | INTERNAL secret | `type`별 lib 호출→`ai_outputs` INSERT(version++). strategy=③+⑨+⑩+⑪ 통합 1콜 |
| `admin-martyrdom-readiness` | `/api/admin-martyrdom-readiness` | POST | admin | **규칙 % 계산**(요건·증거·타임라인·모순) + AI 첨언 1콜 → `ai_outputs(readiness)` |
| `admin-martyrdom-output-review` | `/api/admin-martyrdom-output-review` | PATCH | admin | `{outputId, status:reviewed\|discarded, reviewNote}` |
| `admin-martyrdom-criteria` | `/api/admin-martyrdom-criteria` | GET/POST/PATCH/DELETE | super_admin(쓰기) | 요건 master CRUD |
| `admin-martyrdom-criteria-generate` | `/api/admin-martyrdom-criteria-generate` | POST | super_admin | 법령 시드 AI 파싱→요건 후보 제안(검토 저장) |
| `admin-martyrdom-deadlines` | `/api/admin-martyrdom-deadlines` | GET/POST/PATCH/DELETE | admin | 기한 CRUD |
| `admin-martyrdom-actions` | `/api/admin-martyrdom-actions` | GET/POST/PATCH/DELETE | admin | 부족증거 액션 CRUD |
| `admin-martyrdom-dashboard` | `/api/admin-martyrdom-dashboard` | GET | admin | G3 다중사건(기한임박·준비도·상태·저장용량 집계) |
| `admin-martyrdom-corpus-search` | `/api/admin-martyrdom-corpus-search` | POST | admin | 코퍼스 검색(`searchRag` martyr_case+law) |
| `cron-martyrdom-deadline` | scheduled(KST 08:00) | — | — | D-day·소멸시효 임박 알림 + 저장용량 임계 알림 |
| `admin-martyrdom-close-learn-background` | (내부·config.path 금지) | POST | INTERNAL | 종결(closed+outcome)→recognitionPattern 추출→`martyr_case` 색인(⑥) |
| **(수정)** `admin-martyrdom-analyze-background` | — | — | — | extraction 후 active 사건이면 **generate-background(type=strategy) 자동 트리거** 추가(자동 체인 연장) |
| **(수정)** `admin-martyrdom-cases` PATCH | — | — | — | status→`closed`+outcome 시 close-learn-background 트리거 |
| `migrate-martyrdom-p2` | `/api/migrate-martyrdom-p2` | GET | admin(run) | §P2.1 마이그 |

### lib/martyrdom-ai.ts 신규 함수
- `analyzeStrategy(caseId, caseKind)` → `searchRag(q, k, ['martyr_case','martyr_law'], caseId)` 다중 쿼리 + extractionJson → strategy JSON(아래). **③⑨⑩⑪ 1콜 통합.**
- `buildGoldenAdvice(caseId)` → golden_items master + 사건 정황 → 우선순위·맞춤 제언.
- `checkCriteria(caseId)` → martyrdom_criteria + extractionJson + RAG → 요건별 met/partial/unmet+근거.
- `computeReadiness(caseId)` → **규칙 계산**(criteria_check·evidenceHave·timeline gap·conflicts 읽어 가중 합산) + AI 첨언 1콜(정성 note).
- `learnFromClosedCase(caseId)` → reference 전환·recognitionPattern 추출→martyr_case 색인.
- (재사용) 증거강도: `classifyDocument`에 `evidenceStrength` 판정 추가(분류와 동시·1콜 내).

### 응답 JSON 계약 (A mock·B 동일 — 키명 고정)

`ai_outputs(strategy).contentJson`:
```jsonc
{
  "possibleLogics":  [{ "title":"", "reasoning":"", "strength":"강|중|약" }],
  "missingEvidence": ["..."],
  "keyIssues":       ["..."],
  "causalChain":     [{ "factor":"", "link":"", "evidence":"" }],
  "similarCases":    [{ "ref":"", "outcome":"approved|rejected", "match":"", "diff":"" }],
  "counterArguments":[{ "argument":"예상 반론", "rebuttal":"대비 논리", "basis":"근거" }],   // ⑪
  "conflicts":       [{ "severity":"치명|주의", "desc":"", "sources":["docA","docB"] }],     // ⑨
  "masterTimeline":  [{ "date":"", "event":"", "source":"", "gap":false }],                  // ⑩
  "ragSources":      [{ "title":"", "sourceRef":"", "snippet":"" }]
}
```
`ai_outputs(criteria_check).contentJson`: `{ "items":[{ "code","category","title","status":"met|partial|unmet","evidence","ragSources":[] }], "metCount":0, "totalCount":0 }`
`ai_outputs(readiness).contentJson`:
```jsonc
{
  "score": 78,
  "breakdown": { "criteria":32, "evidence":24, "timeline":12, "conflicts":10 },
  "max":       { "criteria":40, "evidence":30, "timeline":15, "conflicts":15 },
  "gaps":      [{ "label":"심리부검 자료", "plus":12 }],
  "aiNote":    "심리부검 자료가 없어 의학적 인과관계 입증이 약합니다 …(정성)",
  "label":     "보고서 준비도 — 인정 확률 아님·내부 가늠용"
}
```
`ai_outputs(golden).contentJson`: `{ "items":[{ "channel","label","guidance","volatility":"high|low","priority":1,"caseFit":"" }] }`

> 모든 생성 함수: `featureKey:"martyrdom_ai"`·`internalBulk:true`·background는 `timeoutMs` 넉넉히·`config.path` 금지. 정량 % 금지(유사도 숫자 출력 X).

## §P2.3 화면 설계 (`public/admin-martyrdom.js`·`admin-martyrdom.html` 확장)

- **① 골든타임 탭**: 휘발성 우선 체크리스트(online 빨강·offline 회색) + [🔔 AI 맞춤 제언] → golden 카드(우선순위·맞춤 사유).
- **③ 분석 탭**(핵심): [전략 분석 생성](자동도 채워짐) → ⓐ가능 논리·부족 자료·핵심 쟁점 ⓑ**모순·불일치(⑨)** 카드(치명/주의 배지) ⓒ**마스터 타임라인(⑩)**(공백 구간 회색 표시) ⓓ**예상 반론(⑪)** 카드 ⓔ**요건 매트릭스(②)** [요건 대조] 버튼→met/partial/unmet ⓕ**근거 펼치기**(ragSources 인용·환각 방지) ⓖ부족 자료→[+ 액션 추가].
- **④ 서면 탭**: **준비도 게이지(⑫)** [준비도 계산] → `%` 막대 + breakdown(요건/증거/타임라인/모순) + gaps("+N%") + **AI 첨언** + "인정 확률 아님" 라벨. (생성 버튼은 P3 — 배너 자리 유지.)
- **기한 탭/패널**: martyrdom_deadlines 목록·D-day·CRUD.
- **부족증거 액션 패널**: martyrdom_actions 목록·상태 토글·CRUD.
- **G3 대시보드**(사건 목록 상단 카드 or "📊 현황" 탭): 기한 임박·준비도·상태·**저장 용량** 한눈.
- **코퍼스 검색**("🔎 사례·법령 검색" 탭/모달): 검색어→과거사례·법령 결과(snippet·출처).
- **동의 기록**: 사건 상세에 consentNote·obtainedAt 입력.
- 캐시버스터 `admin-martyrdom.js?v=P2`.

## §P2.4 검증 시나리오 (C)

| # | 시나리오 | 기대 |
|---|---|---|
| P2-1 | 자료 업로드→추출 완료 | active 사건이면 **전략 자동 생성**(strategy output·검토 대기) |
| P2-2 | [전략 분석 생성] 버튼 | 가능논리·부족자료·쟁점 + 모순⑨·타임라인⑩·반론⑪ + ragSources |
| P2-3 | [요건 대조] | 요건별 met/partial/unmet + 근거. metCount/total |
| P2-4 | [준비도 계산] | 규칙 % + breakdown + gaps + AI 첨언. 같은 자료 재호출 시 **동일 %**(재현성) |
| P2-5 | 기한 CRUD + cron | 기한 추가→D-day. cron이 임박(D-7·소멸시효) 알림 |
| P2-6 | 부족증거 액션 | 전략의 missingEvidence→[액션 추가]→목록·상태 |
| P2-7 | 요건 master CRUD(super_admin) | 시드 요건 수정·추가. criteria-generate 법령 파싱 제안 |
| P2-8 | G3 대시보드 | 다중 사건 기한·준비도·상태·저장용량 |
| P2-9 | 코퍼스 검색 | martyr_case+law만(active 제외) 결과 |
| P2-10 | 종결(closed+outcome) | recognitionPattern 추출→martyr_case 색인(⑥) |
| P2-11 | 저장 용량 임계 | MARTYRDOM_STORAGE_ALERT_GB 초과 시 알림 |
| 회귀 | P1 추출·분류·삭제·재처리·진행오버레이 정상 |

## §P2.5 mock 데이터 (A — B 머지 전·§P2.2 계약 키 1:1·USE_MOCK 토글)
```javascript
const MOCK_STRATEGY = {
  possibleLogics: [
    { title: "지속적 악성민원으로 인한 직무 스트레스 → 적응장애 → 사망", reasoning: "3~5월 민원 폭주와 정신과 진료 시점이 일치, 직무관련성 인정 논리 성립", strength: "강" },
    { title: "과중한 업무부담(담임+행정) 누적 과로", reasoning: "근무기록상 초과근무 확인되나 직접 인과는 보강 필요", strength: "중" }
  ],
  missingEvidence: ["심리부검 자료", "2024년 3월 근무기록(공백)", "동료 진술서"],
  keyIssues: ["기존 질환 여부 반박", "민원과 사망 사이 시간적 인과 입증"],
  causalChain: [{ factor: "악성민원 반복", link: "→ 불면·불안·적응장애", evidence: "진료기록·동료 증언" }],
  similarCases: [{ ref: "○○초 교사 인정 사례(2023)", outcome: "approved", match: "악성민원+정신과 진료", diff: "유서 존재 여부" }],
  counterArguments: [{ argument: "개인적 성격·기존 우울증 기여", rebuttal: "초진이 민원 발생 후이며 이전 정신과력 없음", basis: "진료기록 초진일" }],
  conflicts: [{ severity: "주의", desc: "진술서상 사망일과 사망진단서 날짜 1일 차이", sources: ["동료진술서", "사망진단서"] }],
  masterTimeline: [
    { date: "2024-03-04", event: "담임 배정", source: "인사기록", gap: false },
    { date: "2024-03-18", event: "악성민원 시작", source: "통화기록", gap: false },
    { date: "2024-04", event: "(근무기록 공백 — 자료 필요)", source: "", gap: true },
    { date: "2024-06-11", event: "사망", source: "사망진단서", gap: false }
  ],
  ragSources: [{ title: "공무원 재해보상법 §5", sourceRef: "martyr_law#12", snippet: "공무수행과 상당인과관계…" }]
};
const MOCK_CRITERIA_CHECK = {
  items: [
    { code: "duty_performance", category: "공무수행성", title: "공무 수행 중 발생", status: "met", evidence: "담임·교육활동 중 스트레스", ragSources: [] },
    { code: "causation_medical", category: "인과관계", title: "공무-사망 상당인과관계", status: "partial", evidence: "진료기록 있으나 심리부검 부족", ragSources: [] },
    { code: "mental_causation", category: "인과관계", title: "정신질환 공무관련성", status: "unmet", evidence: "심리부검 자료 없음", ragSources: [] }
  ],
  metCount: 5, totalCount: 8
};
const MOCK_READINESS = {
  score: 78,
  breakdown: { criteria: 32, evidence: 24, timeline: 12, conflicts: 10 },
  max: { criteria: 40, evidence: 30, timeline: 15, conflicts: 15 },
  gaps: [{ label: "심리부검 자료", plus: 12 }, { label: "2024.3 근무기록 공백", plus: 6 }, { label: "동료 진술", plus: 4 }],
  aiNote: "전반적으로 직무 스트레스 입증은 탄탄하나, 심리부검 자료가 없어 의학적 인과관계 고리가 약합니다. 이 자료를 보완하면 인정 논리가 크게 강해집니다.",
  label: "보고서 준비도 — 인정 확률 아님·내부 가늠용"
};
const MOCK_GOLDEN = {
  items: [
    { channel: "online", label: "고인 SNS·메신저 보존", guidance: "계정 잠금 전 캡처·내보내기", volatility: "high", priority: 1, caseFit: "민원·업무 토로가 메신저에 집중" },
    { channel: "offline", label: "동료 진술 확보", guidance: "기억이 선명할 때 서면화", volatility: "low", priority: 2, caseFit: "목격 동료 다수" }
  ]
};
const MOCK_DEADLINES = [{ id: 1, label: "소멸시효(3년)", dueDate: "2027-06-11", kind: "statute_limit", status: "pending" }];
const MOCK_ACTIONS = [{ id: 1, item: "심리부검 자료 확보", status: "todo", source: "missing_evidence", dueDate: null }];
```

## §P2.6 4채팅 트리거 (병렬 평행 + 작업 규칙 전부 포함·복사용)

> **베이스 정합(PARALLEL_GUIDE §4.1·필수)**: 분배 **전에** 본 설계서를 `origin/main`에 **push**(베이스 push는 §9.3 예외·라운드당 1회 enabler). 그 해시를 `{BASE_HASH}`에 채워 발사. 미push 로컬 베이스 금지(2026-05-24 어긋남 사고).
> **모드**: 평행 — A는 §P2.5 mock으로 시작·B 머지 후 실 API 자동 전환. 폴더 분리(A=`public/` / B=`netlify·lib·db·drizzle·package.json`)로 충돌 0.
> **머지 순서**: B → Swain `migrate-martyrdom-p2?run=1` → schema 활성화·마이그 삭제 → A → C. (**B 응답 키 ↔ A mock 키 1:1 대조 후** 머지·workflow_standards §6.)

### 6.0 워크트리 셋업 (모든 트리거 공통·그대로 실행)
```
cd ../tbfa-mis-{X}
git fetch origin
git checkout -B {브랜치} origin/main          # 대문자 -B: 옛 브랜치 강제 재설정
git log --oneline -1                           # 베이스가 {BASE_HASH} 인지 확인
git merge-base --is-ancestor {BASE_HASH} HEAD && echo "베이스 OK" || echo "⚠️ 어긋남 — 메인 보고 후 중단"
```

### 6.P2-B 트리거 — 🔧 백엔드 전용 (프론트 작업 ❌)
```
[B — 순직 인정 지원 P2 백 구현] 🔧 백엔드 전용 (화면·HTML·JS 포함 트리거 받았으면 잘못 받은 것·메인 문의)

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/martyrdom-p2-back (베이스 origin/main @ {BASE_HASH})
■ 셋업 (§6.0 그대로):
  cd ../tbfa-mis-B
  git fetch origin
  git checkout -B feature/martyrdom-p2-back origin/main      # 대문자 -B: 옛 브랜치 강제 재설정
  git log --oneline -1                                        # 베이스가 {BASE_HASH} 인지 확인
  git merge-base --is-ancestor {BASE_HASH} HEAD && echo "베이스 OK" || echo "⚠️ 어긋남 — 메인 보고 후 중단"
정독 (필수): docs/active/2026-05-26-survivor-support.md §P2.0 · §P2.1 · §P2.2 (+ 기존 토대 §1 · §2 · §2.5 · §2.8)
참고: docs/rules/PARALLEL_GUIDE.md §3(영역 분담) · §7(자체 검증)

영역: netlify/functions/, lib/, db/schema.ts, drizzle/, package.json, .env.example
금지: public/, assets/, PROJECT_STATE.md, docs/ (상태는 메인에 보고 텍스트로만), lib/auth.ts · lib/admin-guard.ts · lib/hyosung-parser.ts 수정

[자율주행 정책 — CLAUDE.md §6.17]
- git push 안 함 (메인 단독) — commit 까지만, 완료 시 메인에 머지 요청 (브랜치명 · 커밋 해시 · 변경 요약)
- force push · hard reset · rm -rf 금지
- 자율 (묻지 말 것): 파일 Read·Write·Edit, git status/log/diff/add/commit/rebase/fetch, bash · PowerShell, npm install · run
- 묻기: 설계 · 로직 결정 / package.json · lock 수정(신규 의존성) / npm uninstall · update / netlify · curl
- 막히면 즉시 보고 (30분 이상 혼자 헤매지 말 것)

[진행률 보고 의무 — CLAUDE.md §6.16]
큰 단계(체크박스 1개) 완료마다 "📊 진행률 X% (n/17 완료) — 다음: …" 한 줄. 매 응답마다 ❌

[코드 표준 — code_standards #55~61 · 필독]
- background 함수(-background)는 export const config 금지 — 붙이면 /.netlify/functions 비동기 호출이 안 먹혀 자동체인이 멈춤 (2026-05-26 근본원인). /api 함수는 export const config = { path } 필수 (cron·background 제외)
- requireAdmin 반환은 auth.res (response 아님) / super_admin 쓰기는 역할 확인 / INTERNAL_TRIGGER_SECRET fail-closed · background는 throw 안 함
- drizzle 다중 leftJoin 체인 금지 → separate query + JS Map / 보조 SELECT 실패 시 빈 배열 fallback / embedding은 raw SQL만 (schema 회귀 격리)
- 응답 키 다중 fallback / try/catch step·detail·stack 응답 패턴
- AI 호출: featureKey:"martyrdom_ai" · internalBulk:true · timeoutMs 넉넉히 / 정량 % 일치율 출력 금지 (정성+근거만·§8)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§P2.1 DB 체크리스트 (설계서 §P2.1 1:1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- [ ] schema.ts append-only — 파일 끝 /* === P2 순직 인정 지원 (2026-05-26) === */ 헤더 후 추가, 다른 영역 정의 덮어쓰기 금지
- [ ] 신규 3테이블: martyrdom_deadlines · martyrdom_criteria · martyrdom_actions (§P2.1 컬럼·인덱스 정확히)
- [ ] 컬럼 추가: martyrdom_case_documents.evidence_strength(varchar 10) / martyrdom_cases.consent_note(text) · consent_obtained_at(timestamp)
- [ ] import 점검: serial · integer · varchar · text · date · timestamp · boolean · index 누락 없이
- [ ] migrate-martyrdom-p2.ts (admin · GET ?run=1 · 진단 GET · 멱등 IF NOT EXISTS — 3테이블+인덱스 / ALTER ADD COLUMN IF NOT EXISTS / martyrdom_criteria 기본 요건 8종 ON CONFLICT(code) DO NOTHING / MARTYRDOM_STORAGE_ALERT_GB 안내)
- [ ] 마이그 적용 전 schema 신규 정의는 활성화 금지 (헤더만 · 주석)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§P2.2 lib·API 체크리스트 (설계서 §P2.2 1:1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- [ ] lib/martyrdom-ai.ts analyzeStrategy(caseId,caseKind): searchRag(q,k,['martyr_case','martyr_law'],caseId) 다중쿼리 + extractionJson → strategy JSON(③가능논리·부족자료·쟁점·causalChain·similarCases + ⑨conflicts(severity 치명/주의)·⑩masterTimeline(gap)·⑪counterArguments·ragSources) — ③⑨⑩⑪ 1콜 통합
- [ ] lib/martyrdom-ai.ts buildGoldenAdvice / checkCriteria(met|partial|unmet+근거) / computeReadiness(규칙 요건40·증거30·타임라인15·모순15 + AI 첨언 1콜·정성 note) / learnFromClosedCase
- [ ] classifyDocument에 evidenceStrength(강/중/약) 판정 추가 (분류와 동시·1콜 내·기존 응답키 유지)
- [ ] admin-martyrdom-generate (POST {caseId,type}) — strategy/golden/criteria는 status processing + generate-background 트리거 / readiness는 inline 계산
- [ ] admin-martyrdom-generate-background (INTERNAL · config 금지 · type별 lib→ai_outputs INSERT version++ · status draft)
- [ ] admin-martyrdom-readiness / admin-martyrdom-output-review (PATCH {outputId,status:reviewed|discarded,reviewNote})
- [ ] admin-martyrdom-criteria (CRUD·쓰기 super_admin) / admin-martyrdom-criteria-generate (법령 docs/law/martyrdom AI 파싱→요건 후보 제안)
- [ ] admin-martyrdom-deadlines (CRUD) / admin-martyrdom-actions (CRUD·source=missing_evidence|manual)
- [ ] admin-martyrdom-dashboard (G3 집계 + 저장용량 sum size_bytes) / admin-martyrdom-corpus-search (searchRag martyr_case+law만·active 제외)
- [ ] cron-martyrdom-deadline (netlify.toml 등록·KST 08:00·D-7/소멸시효 + 저장용량 임계 알림·notifyAdmins 재사용·alertedAt 중복방지)
- [ ] admin-martyrdom-close-learn-background (INTERNAL·config 금지) + admin-martyrdom-cases PATCH status→closed+outcome 시 트리거(⑥)
- [ ] (수정) admin-martyrdom-analyze-background: extraction 후 active면 generate-background(type=strategy) 자동 트리거 추가
- [ ] 응답 키 1글자도 안 바꿈 (§P2.2 계약: possibleLogics·conflicts·masterTimeline·counterArguments·breakdown·gaps·aiNote·metCount 등)

━━━ 응답 구조 (A mock=§P2.2 계약과 키 1:1·1글자도 변경 금지) ━━━
{발사 시 §P2.2 strategy/criteria_check/readiness/golden JSON 전문 임베드}

작업 순서:
  1) migrate-martyrdom-p2.ts 작성 (1회용·admin·GET ?run=1·멱등·요건 8종 시드)
  2) schema.ts 정의 추가 (헤더·주석 상태 — 마이그 후 활성화)
  3) lib/martyrdom-ai.ts 함수 5종 + classifyDocument evidenceStrength
  4) API 함수 — §P2.2 명세 그대로 (background는 config 금지)
  5) cron-martyrdom-deadline + analyze-bg 전략 자동체인 + cases 종결훅
  6) npx tsc --noEmit 통과

⚠️ schema 격차 발견 시 (가정한 컬럼·테이블이 실재 X 등): 추측 코드 작성 금지. 실제 schema 정독·grep 후 적응안 적용 + 메인 사후 보고 (2026-05-12 사고 패턴 — adminUsers 가정 등).

push(=메인 머지) 전 체크:
  - [ ] export const config = { path } 각 /api 함수 (background · cron 은 config 없음)
  - [ ] requireAdmin→auth.res / super_admin 역할 확인 / INTERNAL secret fail-closed
  - [ ] npx tsc --noEmit 통과 / 마이그 적용 전 schema 신규 정의 활성화 금지
  - [ ] 정량% 미출력 · embedding raw SQL 준수

push 후 메인에 보고:
  - 브랜치명 · 커밋 해시 · 변경 파일 요약
  - 위 체크박스 모두 체크된 상태인지 한 줄 명시
  - schema 격차·적응안 적용한 경우 별도 표로 정리
```

### 6.P2-A 트리거 — 🎨 프론트 전용 (백·lib·db 작업 ❌)
```
[A — 순직 인정 지원 P2 프론트 구현] 🎨 프론트 전용 (lib·함수·DB 포함 트리거 받았으면 잘못 받은 것·메인 문의)

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/martyrdom-p2-front (베이스 origin/main @ {BASE_HASH})
■ 셋업 (§6.0 그대로):
  cd ../tbfa-mis-A
  git fetch origin
  git checkout -B feature/martyrdom-p2-front origin/main     # 대문자 -B: 옛 브랜치 강제 재설정
  git log --oneline -1                                        # 베이스가 {BASE_HASH} 인지 확인
  git merge-base --is-ancestor {BASE_HASH} HEAD && echo "베이스 OK" || echo "⚠️ 어긋남 — 메인 보고 후 중단"
정독 (필수): docs/active/2026-05-26-survivor-support.md §P2.3 (+ §P2.0 결정)
참고: docs/rules/PARALLEL_GUIDE.md §3(영역 분담)

영역: public/, assets/
금지: lib/, netlify/functions/, db/, drizzle/, .env.example, PROJECT_STATE.md, docs/
모드: 평행 (아래 mock으로 시작 · B 머지 후 실 API 자동 전환)

[자율주행 정책 — CLAUDE.md §6.17]
- git push 안 함 (메인 단독) — commit 까지만, 완료 시 메인에 머지 요청 (브랜치명 · 커밋 해시 · 변경 요약)
- force push · hard reset · rm -rf 금지
- 자율 (묻지 말 것): 파일 Read·Write·Edit, git status/log/diff/add/commit/rebase/fetch, bash · PowerShell, npm install · run
- 묻기: 설계 · 로직 결정 / package.json 수정 / netlify · curl
- 막히면 즉시 보고 (30분 이상 혼자 헤매지 말 것)

[진행률 보고 의무 — CLAUDE.md §6.16]
큰 단계(체크박스 1개) 완료마다 "📊 진행률 X% (n/12 완료) — 다음: …" 한 줄. 매 응답마다 ❌

[코드 표준 — code_standards #3 · 필독]
- public/js/*.js 는 순수 JS — as·interface·제네릭<T> 등 TypeScript 문법 절대 금지 (무한로딩 사고). 커밋 전 node --check <file> 필수
- api() 헬퍼 사용 (credentials:'include' · opts.body 자동 stringify → 이중 stringify 금지) / 401 시 admin.html 자동 리다이렉트 유지
- 응답 키 다중 fallback (res.data.data.X || res.data.X || res.X)
- 캐시버스터: 변경한 모든 JS·CSS 의 ?v= 버전 갱신 (admin-martyrdom.js?v=P2)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
mock 데이터 (B 머지 전 사용 · 응답 키 1글자도 변경 금지)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{발사 시 §P2.5 MOCK_STRATEGY·MOCK_CRITERIA_CHECK·MOCK_READINESS·MOCK_GOLDEN·MOCK_DEADLINES·MOCK_ACTIONS 전문 임베드}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§P2.3 화면 체크리스트 (설계서 §P2.3 1:1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- [ ] ①골든타임 탭 placeholder→실동작: 휘발성 우선 체크리스트(online 빨강·offline 회색) + [🔔 AI 맞춤 제언] → golden 카드(우선순위·caseFit)
- [ ] ③분석 탭 핵심: [전략 분석 생성](자동도 채워짐) → 가능논리·부족자료·쟁점 카드
- [ ] ③분석 탭 모순(⑨) 카드(치명/주의 배지) + 마스터 타임라인(⑩·공백 회색 표시) + 예상 반론(⑪) 카드
- [ ] ③분석 탭 요건 매트릭스(②) [요건 대조] → met/partial/unmet + 근거 / 근거 펼치기(ragSources 인용·환각 방지)
- [ ] ③분석 탭 부족자료(missingEvidence) → [+ 액션 추가] → martyrdom_actions
- [ ] ④서면 탭 준비도 게이지(⑫) [준비도 계산] → % 막대 + breakdown(요건/증거/타임라인/모순) + gaps(+N%) + AI 첨언 + "인정 확률 아님·내부 가늠용" 라벨
- [ ] 기한 패널: martyrdom_deadlines 목록·D-day 배지·추가/수정/완료(CRUD)
- [ ] 부족증거 액션 패널: martyrdom_actions 목록·상태 토글(todo/doing/done)·CRUD
- [ ] G3 대시보드("📊 현황" 탭 또는 사건목록 상단 카드): 기한임박·준비도·상태·저장용량 한눈
- [ ] 코퍼스 검색("🔎 사례·법령" 탭/모달): 검색어 → 과거사례·법령 결과(snippet·출처)
- [ ] 동의 기록: 사건 상세에 consentNote·consentObtainedAt 입력 칸
- [ ] 산출물 검토 UI: 생성된 전략/요건/준비도에 [검토 완료]/[폐기] + 메모 (output-review)
- [ ] 권한 조건부 노출: super_admin 전용(요건 master 편집) 분기 / public/ 외 파일 변경 0

⚠️ mock 키 ↔ B 응답 키 불일치 위험: §P2.2 응답 키를 1글자도 바꾸지 말 것 (camelCase·snake_case 임의 변환 금지). 머지 후 코드 변경 폭증 사고 패턴.

push(=메인 머지) 전 체크:
  - [ ] mock 키명 = B 응답(§P2.2)과 1:1 일치
  - [ ] 변경한 모든 JS node --check 통과 · <script> 캐시버스터 ?v=P2 · public/ 외 변경 0
  - [ ] (P1에서 cms-tbfa iframe · 🕊️ 메뉴 이미 등록됨 — P2는 admin-martyrdom 확장만 · 신규 iframe 등록 불필요)

push 후 메인에 보고:
  - 브랜치명 · 커밋 해시 · 변경 파일 요약
  - 위 체크박스 모두 체크된 상태인지 한 줄 명시
  - mock 사용한 위치 목록 (B 머지 후 실 API 전환 대비)
```

### 6.P2-C 트리거 — 🔍 검증 전용 (B·A 머지 후 발사)
```
[C — 순직 인정 지원 P2 검증·fix] 🔍 검증 전용

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/martyrdom-p2 (베이스 origin/main @ {B·A 머지 후 해시})
■ 셋업 (§6.0 그대로):
  cd ../tbfa-mis-C
  git fetch origin
  git checkout -B verify/martyrdom-p2 origin/main
  git log --oneline -1                                        # 베이스가 B·A 머지 후 해시인지 확인
정독 (필수): docs/active/2026-05-26-survivor-support.md §P2.4 (+ §P2.0 결정·§P2.2 응답 계약)
참고: docs/rules/PARALLEL_GUIDE.md §7(검증 책임) · §8(대기열) · §17(역할 전환 fix)

영역: 검증 — 전 영역 정독·fix 가능 (verify 브랜치). 코드 fix 외 docs/PROJECT_STATE는 메인에 보고 텍스트로

[자율주행 정책 — CLAUDE.md §6.17]
- git push 안 함 (메인 단독) — fix는 verify 브랜치에 commit, 완료 시 메인에 보고 (브랜치·해시·BUG·fix 요약)
- force push · hard reset · rm -rf 금지 / 파일 Read·Edit·git(push 제외)·bash·tsc 자율 / 막히면 즉시 보고
[진행률 보고 의무 — CLAUDE.md §6.16] 큰 단계 완료마다 "📊 진행률 X% (n/N) — 다음: …" 한 줄

작업 순서:
  1) §P2.4 P2-1~P2-11 — 코드·응답키·스키마 정합 정독 + 라우팅(401·super_admin 게이트) + npx tsc --noEmit + **background config.path 부재 확인** + 라이브 자산 배포 확인. 브라우저 라이브 불가 항목은 "정독만" 명시
  2) 핵심 점검: 추출→전략 자동 체인 작동 / 준비도 규칙 % **재현성**(같은 입력=같은 값) / 정량% 미노출 / 코퍼스 검색 active 제외 / cron 중복 알림 방지(alertedAt) / 저장용량 알림 임계 / 응답 키 1:1(A↔B)
  3) §P2.4 회귀 — P1(추출·분류·삭제·재처리·진행오버레이·음성영상 전사·전사 후 원본삭제) / 기존 RAG(ai_rag_search) / 어드민 로그인·CMS 기존 탭 / AI 비용 안전장치 martyrdom_ai 합산
  4) BUG 발견 시 fix 커밋(verify 브랜치 그대로) → 메인 보고 (역할 전환 fix는 PARALLEL_GUIDE §17)
  5) 보고서 docs/history/verify/2026-05-26-martyrdom-p2.md (PASS/FAIL·BUG·fix·미해결)

표현 규칙 (CLAUDE.md §6.14): 함수명·코드 용어 없이 사용자 동작·결과 위주 — 예) "전략 카드에 모순 2건 표시" (O) / "conflicts 배열 렌더" (X)
```
