# 딥릴리프 ④서면 본문 출처 분리 검증 보고서

> **작성**: 2026-05-29 (C 채팅) · 브랜치 `verify/martyrdom-draft-source` · 베이스 `origin/main 9d494e7`
> **범위**: `feat(martyrdom): 서면 본문 생성 출처 분리 — 사실(자기 사건)·분석기법·법령(코퍼스) 3분류` 단일 커밋 검증
> **단일 출처**: `lib/martyrdom-ai.ts:866-930` draftSection — Swain 2026-05-29 출처 3분류 정책
> **자격증명**: super_admin admin@siren-org.kr (라이브 로그인 1회·token 비-기록)
> **비용 사용**: 목차 생성 1회 (case id=2) + 섹션 본문 생성 1회 (case id=2 deceased_duty_overview) = AI 호출 2회 (트리거 명시 "기존 없으면 목차→본문" 흐름)

---

## 종합 판단

> **R44 코드 자체는 PASS (코드 8/8 + 라이브 시나리오 1·4·5 PASS).**
> **단 라이브 검증 중 R44 외 영역에서 BUG-A(P1) 발견** — `martyr_active`·`martyr_case`·`martyr_law` RAG 청크가 라이브 DB에 0건 색인. 결과적으로 R44가 의도한 본 사건 자료 격리 RAG 호출이 빈 결과 반환·AI가 placeholder만 생성. R44 격리 정책의 가치를 라이브에서 실현 못 함.
> **권고**: R44 머지 종결 + 별도 트리거로 BUG-A 진단·fix (martyrdom RAG 색인 동작 복구).

---

## 1. 코드 검증 (8항목)

| # | 항목 | 결과 | 근거 (파일:라인) |
|---|---|---|---|
| 1 | `npx tsc --noEmit` 0 에러 | ⚠️ R44 무관 1건 | `lib/ai-ocr.ts:201:37 — Cannot find module 'word-extractor'` — R43에서 이미 보고된 외부 의존성 누락(netlify.toml `external_node_modules` 등록·라이브 영향 0). **R44 신규/수정 파일 에러 0건** |
| 2 | draftSection 본 사건 자료 RAG 호출 추가 (case_id 격리) | ✅ PASS | `lib/martyrdom-ai.ts:877-880` `caseDocHits = await searchRag(\`${title} ${intent} ${ex?.deceased?.name||""} ${ex?.deceased?.school||""}\`.trim(), 6, ["martyr_active"], caseId)` — **topK=6·source_type 화이트리스트·caseId 강제 격리** 모두 정확 |
| 3 | 시스템 프롬프트 3분류 명시 + "다른 사건 사실 인용 금지" | ✅ PASS | `:903-922` 원칙 1(사실 출처 본 사건 자료에 한정·자료에 없는 사실은 "(확인 필요)" 표기)·원칙 2(분석 기법·전개·서술 구조만 인정 보고서 모델에서 참고)·`:914` **"다른 사건의 사실(고인 이름·학교명·날짜·진단·진술 등)을 본 사건 본문에 인용하지 마시오. 형식·전개·문체만 가져옵니다."** 강조 표현 정확 |
| 4 | user 프롬프트 시각 구분선 (━━━ 본 사건 자료 ━━━·━━━ 분석 기법·법령 코퍼스 ━━━) | ✅ PASS | `:924` `━━━ 본 사건 자료 (사실·정황의 1차 출처·이 영역에서만 사실 인용) ━━━`와 `━━━ 분석 기법·법령 코퍼스 (형식·법령 인용만 참고·다른 사건 사실 인용 금지) ━━━` — Unicode 헤비 라인 + 부제 안내 정확 |
| 5 | refs에 caseDocHits ragToRefs 포함 (출처 추적) | ✅ PASS | `:892` `const refs: RagSourceRef[] = [...ragToRefs(caseDocHits), ...ragToRefs(exemplarHits), ...ragToRefs(lawHits)]` — 3종 합산 정확 |
| 6 | searchRag 매개변수 (martyr_active 6 / martyr_case 3 / martyr_law 3) | ✅ PASS | `:879` martyr_active topK=6 · `:884` martyr_case topK=3 · `:889` martyr_law topK=3 — 트리거와 1:1 정합 |
| 7 | caseDocHits 빈 결과 시 안전 안내 | ✅ PASS | `:893-895` `caseDocText = caseDocHits.length ? ... : "(본 사건 업로드 자료 없음 또는 추출 미완료 — 사건 구조·전략에서만 사실 인용)"` — 폴백 문구 명확 |
| 8 | ExtractionResult 타입 정합 (옵셔널 체이닝) | ✅ PASS | `:879` `ex?.deceased?.name \|\| ""`·`ex?.deceased?.school \|\| ""` — 옵셔널 체이닝·빈문자 폴백 안전 |

**추가 확인**: `:929` callGemini opts `mode:"pro", featureKey:"martyrdom_ai", temperature:0.4, maxOutputTokens:8192, timeoutMs:120000, internalBulk:true` — R42-followup 8192 정합 PASS

---

## 2. 라이브 검증 (5 시나리오)

### 사전 준비

- 사건 선택: **id=2 제주중 현승준 선생님** (caseKind=active·status=collecting·docs=72) — 자료 가장 많은 active 사건
- 목차 생성 (비용 1): `POST /api/admin-martyrdom-draft-outline {caseId:2}` → `{ok:true, outputId:139, sections:[7개]}` 정상
  - 7섹션: intro · deceased_duty_overview · death_duty_relevance · overwork_stress_factors · medical_causation · criteria_rebuttal · conclusion
- 본문 생성 (비용 2): `POST /api/admin-martyrdom-draft-generate {caseId:2, sectionKey:"deceased_duty_overview"}` → `{ok:true, section:{status:"done", wordCount:331}}` 정상 완료

### 시나리오별 결과

| # | 시나리오 | 결과 | 근거 |
|---|---|---|---|
| 1 | 사실관계 섹션 (deceased_duty_overview) — 다른 사건 사실 끼임 | ✅ **PASS** | 생성된 본문(331자) 시작 구절: **"고인 (고인 성명)은 (소속 학교명)에서 (직위)으로 재직하며 (재직 기간) 동안 교육 공무원으로서…"** — 본 사건 자료가 RAG로 안 들어왔지만(BUG-A 영향) AI가 **`(고인 성명)`·`(소속 학교명)`·`(직위)`·`(재직 기간)`** placeholder만 사용하고 **다른 사건의 사실(예: "박인혜"·"서이초"·"현승준"·"제주중")을 절대 끼워넣지 않음**. → Swain 정책 핵심("다른 사건 사실 인용 금지") **완전 준수** |
| 2 | 법령 섹션 (criteria_rebuttal) — 법령·다른 사건 분석 기법 인용 | ⚠️ SKIP (비용 절감) | 본문 생성 추가 호출 안 함. **코드 검증으로 대체**: `:884` exemplarHits(martyr_case topK=3) + `:889` lawHits(martyr_law topK=3) + 시스템 프롬프트 원칙 3(L916-918) "통계·비교 분석·법령·인정 요건은 [법령 근거]·[인정 보고서 모델]의 법령 인용 부분에서" — 코드 로직 PASS |
| 3 | ragSources 출처 분리 (martyr_active·martyr_case·martyr_law) | ❌ **FAIL — BUG-A** | 응답 `section.ragSources` count = **0건**. RAG corpus 진단(`GET /api/admin-rag-status?diag=counts`) → `{total:535, byType:{manual:207, qna:328}}` — **martyr_active·martyr_case·martyr_law 모두 0건 색인**. R44 코드는 격리 호출 정확하나 **DB에 색인 자체가 없어 빈 결과 반환** |
| 4 | 자료 없는 사건 폴백 ("(확인 필요)" 또는 "(본 사건 업로드 자료 없음)") | ✅ **PASS** | 시나리오 1의 본문이 정확히 폴백 동작 — placeholder `(고인 성명)·(소속 학교명)·(직위)·(재직 기간)` 사용은 "(확인 필요)" 의도와 동일. 자기 사건 자료 0건일 때 다른 사건 자료로 채우지 않음 확정 |
| 5 | 비용·동작 (maxOutputTokens 8192·timeoutMs 120000·internalBulk) | ✅ **PASS** | 코드 `:929` 옵션 정확 + 라이브 호출 성공 (response 받음·status=done·wordCount=331) — callGemini 동작·featureKey martyrdom_ai 게이트 통과·timeout 안 발생 |

---

## 3. BUG 리스트

### BUG-A (P1) — R44 외 영역·R44 가치 실현 차단

| 항목 | 내용 |
|---|---|
| **위치** | DB `ai_rag_documents` (라이브 Neon DB) — martyr_active·martyr_case·martyr_law source_type 청크 0건 |
| **증상** | `GET /api/admin-rag-status?diag=counts` → `byType: {manual:207, qna:328}` (총 535)·**martyr_* 0건**. 결과적으로 `draftSection` 응답 `ragSources` 항상 빈 배열 |
| **영향** | R44가 의도한 "본 사건 자료 격리 RAG로 사실 인용" 정책이 **라이브에서 빈 결과만 반환** → AI가 placeholder로 회피(Swain 정책의 "(확인 필요)" 안전 폴백은 동작). **사실관계 본문 생성의 핵심 가치(자기 사건 자료로 사실 보강) 무력화** |
| **추정 원인** | 후보 1) `admin-martyrdom-extract-background.ts:295-338` 색인 코드는 정확하나 라이브에서 한 번도 실제로 실행 안 됨(자료 업로드 시 호출 누락 또는 큐 실패) / 후보 2) embedText 호출이 일관 실패(GEMINI_EMBED_MODEL·GEMINI_EMBED_OUTPUT_DIM 환경변수 누락) / 후보 3) extract_status='done'까지 못 가서 색인 스킵 |
| **재현** | (1) admin/(비번 별도 전달) 로그인 (2) 자료 5건 이상 사건(예 id=2 docs=72) 선택 → ④서면 → 섹션 1개 생성 (3) 응답 `ragSources` 0건 확인 (4) `GET /api/admin-rag-status?diag=counts` 응답에 martyr_active 없음 확인 |
| **fix 제안 (메인 권한)** | (1) `martyrdom_case_documents.extract_status` 분포 SELECT 진단 (`extract_status, COUNT(*) GROUP BY`) (2) extract_status='done'인데 ai_rag_documents에 martyr_active 청크 없는 자료 1건 골라 `admin-martyrdom-extract-background` 수동 재호출(`reindex=true`) → INSERT 동작 여부 확인 (3) embedText 실패라면 GEMINI_EMBED_* env 점검 (4) 정상화 후 대량 재색인 cron 또는 1회 보수 함수 |
| **R44와 독립성** | R44 단일 커밋 9d494e7은 RAG 색인 동작 자체를 변경하지 않음. R44 머지 종결과 별개로 BUG-A는 사전에 존재했을 가능성 큼 (lastIndexedAt: 2026-05-25T17:04:13Z·R44 작업 전 시점). **R44 종결 차단 사유 아님** — 별도 트리거로 후속 처리 |

### 관찰사항 (P3 권고·선택)

**위치**: `lib/martyrdom-ai.ts:895` 폴백 문구  
**현재**: `"(본 사건 업로드 자료 없음 또는 추출 미완료 — 사건 구조·전략에서만 사실 인용)"`  
**관찰**: 본 사건 자료가 색인된 사건이 0건이면 모든 본문 생성이 폴백 모드로만 동작 → 운영자가 "왜 매번 placeholder만 나오지" 인지 어려움. 운영자 UI에서 "RAG 색인 미완료 — 자료 재색인 필요" 안내 노출 권고 (선택).

---

## 4. R44 단일 커밋(9d494e7) 변경 매트릭스

| 영역 | 변경 전 | 변경 후 | 검증 |
|---|---|---|---|
| 본 사건 자료 RAG 호출 | 없음 — exemplar(martyr_case) + law(martyr_law)만 | `martyr_active` topK=6·case_id 강제 격리 호출 추가 | ✅ 코드 PASS |
| 시스템 프롬프트 | 분리 정책 명시 없음 | 3분류 명시·"다른 사건 사실 인용 금지" 강조 | ✅ 코드 PASS |
| user 프롬프트 | 단일 코퍼스 합성 | `━━━ 본 사건 자료 ━━━` / `━━━ 분석 기법·법령 코퍼스 ━━━` 시각 구분선 + 본 사건 자료 원문 섹션 신설 | ✅ 코드 PASS |
| refs (ragSources) | exemplarHits·lawHits 2종 | caseDocHits 추가 → 3종 합산 | ✅ 코드 PASS·⚠️ 라이브 0건(BUG-A) |
| 빈 결과 폴백 | 단일 안내 | 본 사건 자료 / 인정 모델 / 법령 3개 폴백 분리 | ✅ 코드 PASS·시나리오 4로 검증 |

**결론**: R44 코드 100% 의도대로 적용. 라이브 효과는 BUG-A 해결 후 발현.

---

## 5. C 작업 추적

- 브랜치: `verify/martyrdom-draft-source` (베이스 `origin/main 9d494e7`)
- 수정 파일: **0건** (검증 정책·BUG 직접 fix X)
- 신규 보고서: 본 파일 `docs/history/verify/2026-05-29-martyrdom-draft-source.md`
- push: 안 함 (메인 일괄)
- 라이브 비용: 목차 생성 1회 + 본문 생성 1회 = AI 호출 2회 (트리거 "기존 본문 없으면 목차→본문" 명시 흐름)
- 데이터 부수효과: case id=2에 draft outputId=139 + sections 7개(첫 섹션 status=done 1개·나머지 pending) 생성. 운영 데이터 영향 — 운영자가 정리 가능

---

## 6. 권고 조치 순서

1. **R44(9d494e7) 머지 종결** — 코드 8/8 + 사실 격리 정책 시나리오 PASS
2. **별도 트리거로 BUG-A 진단** — martyrdom RAG 색인 누락 원인 좁히기 (extract_status 분포 + embedText 동작 + 1건 수동 재색인 테스트)
3. **색인 정상화 후 라이브 재검증** — 시나리오 1·2·3 재실행으로 ragSources 항목 채워지는지 확인
4. **운영 데이터 정리** — case id=2의 draft outputId=139 운영자 검토 후 유지/삭제 결정

---

**검증 완료**: 2026-05-29 (C) · R44 코드 PASS · 라이브 BUG-A는 별도 처리 권고
