# 순직 인정 지원 시스템 = Deep-Relief AI v0 (내부 엔진·PoC) — 설계서

> **P1·P2 구현 완료·Swain 라이브 검증 완료(2026-05-26).** 완료된 P1·P2 구현 설계(§1~§7·§P2.0~§P2.6)는 [`docs/history/milestones/2026-05-26-deeprelief-p1-p2.md`](../history/milestones/2026-05-26-deeprelief-p1-p2.md)로 이동. 현 DB·API 현황은 milestone + db/schema.ts 참조. 이하는 **P3·P4 설계 진행용 forward spec**.

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
| **✅ P1 토대** | DB 코어 + 사건 CRUD + 자료 업로드 + 추출(OCR) + 자동분류 + 색인 + **사건 구조 자동 추출** + 법령 시드 / ⑦감사 로그 + ①절차·기한(경량) + ③부족 증거 표시 / **G6 자료 원문 뷰어** + **G2 일괄 이관(기초)** / **가 이벤트 알림(완료/실패·경량)** + **나 처리 상태 가시화·재시도** | 자료 올리면 글자 뽑히고 자동 분류·구조 정리·부족 증거가 보이고, 완료/실패 알림·재시도가 되는가 |
| **✅ P2 분석** | ③전략 + ①골든타임 + ②인정요건 대조 + ⑨모순 탐지 + ⑩마스터 타임라인+공백 + ⑪반론 대비 + ⑫준비도 게이지 + ①기한 트래커 풀(cron) + ③부족증거 액션 + ⑥학습 피드백 시작 / **G3 다중 사건 대시보드** / **다 운영자 코퍼스 검색** + **라 유족 동의·보존/파기** | 요건 충족·모순·완성도 %·부족 자료·기한이 한눈에 보이는가 |
| **P3 서면** | **④유족급여신청서 초안 = 인정 보고서 형식·전개·증거 통째 학습 + 법령 보완·섹션별 생성** + 출력물 검토 + ⑤전문가 검토 + ④논리맵 시각화 + ⑥종결 자동 학습 / **G1 보고서 내보내기(HTML·PDF)** + **G4 사건 패키지 zip** | 인정 보고서 모델 15~30p 초안이 근거와 함께·제출용 다운로드·전문가 검토되는가 |
| **P4 마감** | AI 비서 도구(읽기) + ⑧유족 전달용 쉬운 요약 + G5 인정률·성과 통계 + **R 연구 발간지(비식별화·외부 발간·§9.4)** + featureKey 정착 + 메뉴얼·knowledge.md 동기화 + 설계서 history 이동 | 라운드 종결 체크리스트 (연구 발간은 데이터 축적 후 별도 라운드 가능) |

> **첫 분배는 P1만.** P1 Swain 검증 통과 후 P2 트리거를 §6에서 확정·분배. 이렇게 4단계 기능을 다 만들되 위험을 단계로 쪼갬.

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

# ★ P3 구현 설계 (확정 2026-05-26 — Swain 결정 반영·"한 번에 전부")

> P1 토대 + P2 분석 라이브 작동 확인됨(milestone 참조). P3 = **서면 생성·전문가 검토·논리맵·종결 학습·내보내기·패키지**. 사전 정독(§9.1.9)으로 기존 테이블 컬럼·lib 함수·응답 키·프론트 패턴 확인 완료 — 아래는 그 정확한 식별자를 재사용.

## §P3.0 요구사항 확정 (Swain 2026-05-26)

| # | 결정 | 값 |
|---|---|---|
| 1 | **P3 범위** | 한 번에 전부(P2처럼) — ④서면 생성 + 출력물 검토 + ⑤전문가 검토 + ④논리맵 시각화 + ⑥종결 자동학습 + G1 내보내기 + G4 패키지 zip. B·A·C 병렬 |
| 2 | **서면 생성 방식** | **목차 확인 후 섹션별** — AI 목차 제안 → 운영자 확인·수정 → 섹션별 순차 생성(진행 오버레이) → 합본. 각 섹션 근거(ragSources) 표시 |
| 3 | **내보내기 형식** | **Word(docx) / PDF 중 운영자 선택** — PDF=기존 pdf-lib+NotoSansKR 재사용 / Word=신규 라이브러리 필요(아래 확인 대기) |
| 4 | **전문가 검토자** | **협회 내부 배정** — 슈퍼관리자·지정 운영자가 검토자 배정→코멘트→승인/수정요청 (외부 연동 0) |

**불변 원칙 유지**(P1·P2와 동일): AI 출력=전문가 검토용 초안 / 근거 추적(ragSources) / 운영자 전용(requireAdmin) / 사건 격리(case_id) / 감사 로그.

### ✅ 분배 전 Swain 확인 2건 — 완료 (2026-05-26 Swain 승인·추천안 둘 다)
1. **DB 스키마**: 신규 테이블 2개(`martyrdom_draft_sections`·`martyrdom_reviews`) + `martyrdom_ai_outputs.outputType`에 값 `'draft'` 추가(컬럼 변경 없음·varchar). 기존 6 outputType과 동일 패턴. → **✅ 승인(섹션별 별도 저장).**
2. **새 라이브러리(Word 생성)**: PDF는 기존 `pdf-lib`, zip은 기존 `fflate` 재사용 → **추가 0**. Word(docx)만 신규 의존성 → **`docx`(npm·순수 JS·네이티브 의존 없음·Node 20 호환·한글 OK)**. → **✅ 승인(docx 추가).**

## §P3.1 DB 설계

### 신규 테이블 2개 (append-only — schema.ts 끝 `/* === P3 서면 === */` 헤더 아래)

```typescript
/* === P3 서면 === */
// (1) 유족급여신청서 초안 섹션 — 목차 확인 후 섹션별 생성·편집
export const martyrdomDraftSections = pgTable("martyrdom_draft_sections", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => martyrdomCases.id),
  outputId: integer("output_id").references(() => martyrdomAiOutputs.id), // 부모 'draft' ai_outputs 행
  sectionKey: varchar("section_key", { length: 40 }).notNull(),           // intro·deceased·duty·medical·timeline·criteria·counter·conclusion 등
  title: varchar("title", { length: 200 }).notNull(),
  sectionOrder: integer("section_order").notNull().default(0),
  intent: text("intent"),                                                  // 목차 단계의 섹션 의도(생성 지시)
  content: text("content"),                                                // 생성·편집된 본문
  ragSources: jsonb("rag_sources"),                                        // [{title,sourceRef,snippet}]
  status: varchar("status", { length: 20 }).notNull().default("pending"),  // pending|generating|done|edited
  wordCount: integer("word_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// (2) 전문가 검토 배정·결정 (협회 내부)
export const martyrdomReviews = pgTable("martyrdom_reviews", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => martyrdomCases.id),
  outputId: integer("output_id").notNull().references(() => martyrdomAiOutputs.id), // 검토 대상 'draft'
  assignedTo: integer("assigned_to").notNull().references(() => members.id),         // 검토자(운영자)
  assignedBy: integer("assigned_by").references(() => members.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"),            // pending|approved|changes_requested
  note: text("note"),                                                                // 검토 코멘트
  createdAt: timestamp("created_at").defaultNow(),
  decidedAt: timestamp("decided_at"),
});
```

- **`outputType='draft'`**: 부모 `martyrdom_ai_outputs` 행. `contentJson` = `{ outline: [{sectionKey,title,intent,order}], assembledAt? }`(목차). 섹션 본문은 `martyrdom_draft_sections`에 분리(큰 본문·개별 재생성·편집 위함). `status` draft→reviewed(승인 시).
- **종결 학습(⑥)·exemplar**: 신규 테이블 없음. `martyrdom_cases.status='closed'`+`outcome='approved'` 시 background가 `learnFromClosedCase`(기존) + 인정 사건 application 문서를 `ai_rag_documents`(source_type `martyr_case`·sourceRef "approved-report")로 색인.

### 마이그레이션 `migrate-martyrdom-p3` (§6.8 표준·GET ?run=1·B 작성)
- `CREATE TABLE IF NOT EXISTS martyrdom_draft_sections / martyrdom_reviews`(위 컬럼·FK·default). 멱등.
- `outputType='draft'`는 값 추가일 뿐 DDL 불필요(varchar).
- 인덱스: `martyrdom_draft_sections(case_id)`·`(output_id)`, `martyrdom_reviews(case_id)`·`(output_id)`·`(assigned_to)`.
- requireAdmin GET ?run=1. 호출·삭제·schema 활성화는 P2와 동일 흐름.

## §P3.2 API 명세 (모든 함수 `export const config = { path }` — #56)

### lib/martyrdom-ai.ts 신규 함수
| 함수 | 시그니처 | 동작 |
|---|---|---|
| `draftOutline` | `(caseId) → GenResult<DraftOutlineJson>` | 사건 구조(extraction)+전략+요건 + **인정 보고서 exemplar 구조**(searchRag martyr_case approved)로 **목차 제안**. `{sections:[{sectionKey,title,intent,order}]}` |
| `draftSection` | `(caseId, section, priorTitles[]) → GenResult<{content,ragSources}>` | 섹션 1개 본문 생성. 입력 3종(§9.2): ①인정 보고서 exemplar(few-shot·searchRag martyr_case) ②사건 구조·전략·타임라인 ③법령(searchRag martyr_law). `temperature 0.4`·`maxOutputTokens 4096`·`timeoutMs 120000`·`internalBulk` |
| `indexApprovedReport` | `(caseId) → {ok,indexed}` | 인정(approved) 사건의 application 문서 텍스트를 `ai_rag_documents`(martyr_case·sourceRef "approved-report:{caseNo}")로 색인 = **형식 모델 exemplar** |

### lib/martyrdom-export.ts (신규)
| 함수 | 반환 | 비고 |
|---|---|---|
| `buildDraftHtml(caseId, outputId)` | `string` | 합본 HTML(제목·섹션 순서·근거 각주) — PDF·docx·미리보기 공용 소스 |
| `buildDraftPdf(caseId, outputId)` | `Uint8Array` | pdf-lib + NotoSansKR(pdf-receipt 패턴). A4·섹션 페이지 |
| `buildDraftDocx(caseId, outputId)` | `Uint8Array` | `docx` 라이브러리. 제목·섹션 heading·본문 단락 |
| `buildCasePackageZip(caseId)` | `Uint8Array` | fflate `zipSync`. 자료 원문 텍스트 + 분석(전략·요건·준비도 txt) + 보고서 pdf |

### 함수 목록 (netlify/functions)
| 함수 | 메서드 | 요청 | 용도 |
|---|---|---|---|
| `admin-martyrdom-draft-outline` | POST | `{caseId}` | 목차 제안 생성·`draft` ai_outputs 행 INSERT/UPDATE |
| `admin-martyrdom-draft-outline` | PATCH | `{caseId, outputId, sections}` | 운영자 목차 편집(추가·삭제·순서·제목·intent) |
| `admin-martyrdom-draft-generate` | POST | `{caseId, sectionKey?}` | sectionKey 있으면 1섹션 동기 생성, 없으면 전 섹션 background 큐 |
| `admin-martyrdom-draft-generate-background` | POST(INTERNAL) | `{caseId, secret}` | 섹션 순차 생성(pending→done)·실패 사유 기록 |
| `admin-martyrdom-draft-section` | PATCH | `{sectionId, content}` | 운영자 섹션 본문 편집(status→edited·wordCount 갱신) |
| `admin-martyrdom-draft` | GET | `?caseId=N` | 목차+섹션+검토 로드(화면 렌더용) |
| `admin-martyrdom-review` | POST | `{caseId, outputId, assignedTo}` | 검토자 배정 |
| `admin-martyrdom-review` | PATCH | `{reviewId, status, note?}` | 승인/수정요청 결정(+draft status→reviewed) |
| `admin-martyrdom-review` | GET | `?caseId=N` | 검토 이력·배정 현황 |
| `admin-martyrdom-export` | POST | `{caseId, outputId, format}` | format `pdf`\|`docx` → `{ok,fileName,mimeType,base64}` |
| `admin-martyrdom-package` | POST | `{caseId}` | 사건 패키지 zip → `{ok,fileName,base64}`(or queued) |
| `admin-martyrdom-reviewers` | GET | `-` | 배정 가능한 운영자 목록(members operatorActive) |

- **종결 학습 훅**: 기존 `admin-martyrdom-cases` PATCH 확장 — `status`가 `closed`로 바뀌고 `outcome` 설정 시 `admin-martyrdom-learn-background`(INTERNAL) 트리거.
- `admin-martyrdom-learn-background`: `learnFromClosedCase`(기존) + `indexApprovedReport`(approved일 때).
- **논리맵**: 신규 API 없음 — 프론트가 기존 `strategy.contentJson.causalChain`(factor·link·evidence)+`extraction.causalChain`을 시각화. evidence 있으면 초록·`evidenceMissing` 매칭 시 빨강.
- **알림(가)**: 섹션 생성 완료·검토 배정·검토 결정 시 기존 알림 인프라(notifications) 1줄.

### 응답 JSON 계약 (A mock·B 동일 — 키명 고정)
```jsonc
// draft-outline POST
{ "ok": true, "outputId": 30, "outputType": "draft", "status": "draft",
  "outline": { "sections": [
    { "sectionKey":"intro", "title":"신청 취지", "intent":"유족급여 청구 취지·근거 법령 개요", "order":1 },
    { "sectionKey":"deceased", "title":"고인 및 직무 개요", "intent":"고인 인적사항·담당 업무·근무 환경", "order":2 }
  ] } }

// draft-generate (1섹션 동기)
{ "ok": true, "section": { "id": 101, "sectionKey":"intro", "title":"신청 취지",
  "content":"본 신청은 …", "ragSources":[{"title":"공무원재해보상법 §4","sourceRef":"martyr_law","snippet":"공무로 인한 …"}],
  "status":"done", "wordCount": 320 } }

// draft-generate (전 섹션 큐)
{ "ok": true, "queued": true, "total": 6, "outputId": 30 }

// draft GET
{ "ok": true, "outputId": 30, "status":"draft",
  "outline": { "sections":[ /* 위와 동일 */ ] },
  "sections": [ { "id":101, "sectionKey":"intro", "title":"신청 취지", "content":"…",
    "ragSources":[…], "status":"done", "order":1, "wordCount":320 } ],
  "reviews": [ { "id":5, "assignedTo":12, "assignedToName":"김간사", "status":"pending", "note":null,
    "createdAt":"2026-05-26T01:00:00Z", "decidedAt":null } ] }

// review POST
{ "ok": true, "reviewId": 5, "status":"pending", "assignedTo": 12 }
// review PATCH
{ "ok": true, "reviewId": 5, "status":"approved" }
// reviewers GET
{ "ok": true, "reviewers":[ {"id":12,"name":"김간사","role":"operator"} ] }

// export POST
{ "ok": true, "fileName":"유족급여신청서_2026-001.pdf", "mimeType":"application/pdf", "base64":"JVBERi0…" }
// package POST
{ "ok": true, "fileName":"사건패키지_2026-001.zip", "base64":"UEsDBB…" }
```

## §P3.3 화면 설계 (`public/admin-martyrdom.js`·`admin-martyrdom.html` 확장·캐시버스터 `?v=P3`)

**④서면 탭(`tab-draft`) 전면 구현** (현재 placeholder 교체):
```
[④ 서면]  유족급여신청서 초안
┌─────────────────────────────────────────────┐
│ 준비도 84% — 충분 ✓   (낮으면: ⚠ ○○ 보완 권장 배너)│
│ ── 1단계 목차 ──────────────────────────────  │
│ [목차 제안 생성]                                │
│  1. 신청 취지        [✎][↑↓][✕]                │
│  2. 고인 및 직무 개요  [✎][↑↓][✕]   [+ 섹션 추가] │
│ ── 2단계 본문 ──────────────────────────────  │
│ [본문 생성 시작] → 진행 오버레이(3/6 섹션)        │
│  ▸ 1. 신청 취지            [재생성]             │
│     <편집 textarea>  📎 근거 3건(펼치기)         │
│  ▸ 2. 고인 및 직무 개요 …                        │
│ ── 3단계 합본·검토·내보내기 ──────────────────  │
│ [합본 미리보기]  [📄 PDF] [📝 Word] [📦 패키지 zip]│
│ 전문가 검토: [검토자 배정 ▼] → 상태 뱃지·코멘트   │
│            (배정자: [승인][수정요청]+메모)        │
└─────────────────────────────────────────────┘
```
- **목차 단계**: [목차 제안 생성]→`draft-outline` POST→편집 가능 목록(제목·intent·순서·추가/삭제)→`draft-outline` PATCH 저장.
- **본문 단계**: [본문 생성 시작]→`draft-generate`(전 섹션·background)→`openBulkProgress`로 N/total→`pollGenerated` 패턴(4초)→섹션별 textarea(편집=`draft-section` PATCH)+[재생성](`draft-generate` sectionKey)+`renderRagSources`.
- **준비도 연동(§9.2)**: `outputCache.readiness.score` 낮으면(<60) "약한 보고서 — 보완 권장" 배너 후 생성 허용.
- **내보내기**: [📄 PDF][📝 Word]→`export` POST→base64 Blob 다운로드. [📦 패키지 zip]→`package` POST.
- **전문가 검토(⑤)**: `reviewers` GET로 배정 드롭다운→`review` POST 배정. 배정된 검토자는 [승인]/[수정요청]+메모(`review` PATCH). 상태 뱃지(대기/승인/수정요청). (기존 `outputReviewBar` 확장)
- **④논리맵 시각화**: `tab-analysis` 전략 하단에 "🔗 인과관계 논리맵" — `strategy.causalChain` 노드(요인)→화살표(연결), evidence 있으면 초록·`evidenceMissing` 매칭 빨강. **HTML/CSS/SVG·신규 라이브러리 없음**(순수 JS #js_no_typescript).
- cms-tbfa iframe: 이미 등록(키 `martyrdom`) — 변경 없음.

## §P3.4 검증 시나리오 (C)
| Q | 시나리오 | 기대 |
|---|---|---|
| Q1 | 목차 제안 생성 | 사건 구조 기반 섹션 목록·운영자 편집·저장 |
| Q2 | 본문 섹션별 생성 | 진행 오버레이 N/total·각 섹션 근거 표시·실패 사유 노출 |
| Q3 | 섹션 편집·재생성 | textarea 편집 저장(status edited)·개별 재생성 |
| Q4 | 준비도 낮을 때 | "약한 보고서 보완 권장" 배너 후 생성 가능 |
| Q5 | PDF 내보내기 | 한글 정상·A4·섹션 순서·다운로드 |
| Q6 | Word 내보내기 | docx 열림·제목/섹션 구조 |
| Q7 | 사건 패키지 zip | 자료+분석+보고서 동봉·열림 |
| Q8 | 전문가 검토 배정·승인 | 배정→검토자 승인/수정요청→draft status reviewed |
| Q9 | 논리맵 | causalChain 시각화·증거 유무 색상 |
| Q10 | 종결 자동학습 | status=closed+outcome=approved → 학습 background·exemplar 색인 |
| 회귀 | P1·P2 | 업로드·추출·분류·전략·골든·요건·준비도·기한·대시보드·코퍼스·동의 무회귀 + **순직 자료 일반검색 격리 유지** |

### 검증 분담 (operational_standards §4)
- C: 코드·응답키·schema 정합 정독 + 라우팅(401) + tsc + `node --check admin-martyrdom.js` + 라이브 자산 배포 확인 + 격리 회귀.
- Swain: 브라우저 라이브(목차→본문→내보내기→검토 UI).

## §P3.5 mock 데이터 (A — B 머지 전·§P3.2 계약 키 1:1·`USE_P3_MOCK` 토글)
```javascript
const USE_P3_MOCK = true; // B 머지·마이그 후 false
const MOCK_DRAFT_OUTLINE = { sections: [
  { sectionKey:"intro",    title:"신청 취지",        intent:"유족급여 청구 취지·근거 법령 개요", order:1 },
  { sectionKey:"deceased", title:"고인 및 직무 개요", intent:"고인 인적사항·담당 업무·근무 환경", order:2 },
  { sectionKey:"duty",     title:"공무상 과로·스트레스", intent:"업무량·시간외·민원 등 공무 관련성", order:3 },
  { sectionKey:"medical",  title:"의학적 인과관계",   intent:"진단·심리부검·사인과 공무의 연결", order:4 },
  { sectionKey:"criteria", title:"인정 요건 충족",   intent:"공무원재해보상법 요건별 대조", order:5 },
  { sectionKey:"conclusion", title:"결론 및 신청",   intent:"순직 인정·유족급여 지급 요청", order:6 },
]};
const MOCK_DRAFT_SECTION = { id:101, sectionKey:"intro", title:"신청 취지",
  content:"본 신청은 고(故) ○○○ 교사의 사망이 공무로 인한 것임을 근거로 유족급여 지급을 청구하는 것입니다. …",
  ragSources:[{title:"공무원재해보상법 제4조", sourceRef:"martyr_law", snippet:"공무로 인한 사망 …"},
    {title:"유사 인정 사례(2024)", sourceRef:"martyr_case", snippet:"과로·민원 스트레스 인정 …"}],
  status:"done", order:1, wordCount:320 };
const MOCK_REVIEWS = [{ id:5, assignedTo:12, assignedToName:"김간사", status:"pending", note:null,
  createdAt:"2026-05-26T01:00:00Z", decidedAt:null }];
const MOCK_REVIEWERS = [{ id:12, name:"김간사", role:"operator" }, { id:3, name:"이변호사", role:"super_admin" }];
```

## §P3.6 4채팅 트리거 (PARALLEL_TEMPLATE §6 양식·Swain 복붙용)

> **베이스 정합 (PARALLEL_GUIDE §4.1·feedback_parallel_base)**: 워크트리 공유 → A·B·C 모두 **로컬 `main` HEAD**(이 설계서 커밋 포함)에서 분기. origin push 불필요(배포 0). `{BASE_HASH}` = 분배 직전 메인이 설계서를 로컬 main에 commit한 HEAD(메인이 채워 전달). 셋업은 `checkout -B ... main`(origin/main 아님).
> **머지 순서 (§5 강제)**: B 백 머지 → Swain `migrate-martyrdom-p3?run=1` → schema 활성화·마이그 삭제 → A 프론트 머지 → C 검증. push는 B 머지(마이그)·A 머지(라이브)만.

### 6.0 워크트리 셋업 (모든 채팅 공통·그대로 실행 — 워크트리 공유·push 0)
```
■ 셋업 (그대로 실행)
  cd ../tbfa-mis-{X}                                   # B=tbfa-mis-B / A=tbfa-mis-A / C=tbfa-mis-C
  git fetch origin                                     # (선택·harmless)
  git checkout -B {브랜치} main                        # ★ 로컬 main(설계 포함)·origin/main 아님·대문자 -B 강제
  git log --oneline -1                                 # 베이스 = 로컬 main HEAD {BASE_HASH} 확인
  git merge-base --is-ancestor {BASE_HASH} HEAD && echo "베이스 OK" || echo "⚠️ 어긋남 — 메인 보고 후 중단"
  # 이미 옛 베이스로 분기돼 있으면: git rebase main
```

### 6.P3-B — 🔧 백 구현 (프론트 작업 ❌)
```
[B — 딥릴리프 P3 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/martyrdom-p3-back (베이스 로컬 main @ {BASE_HASH})
■ 셋업 (§6.0): cd ../tbfa-mis-B; git fetch origin; git checkout -B feature/martyrdom-p3-back main; git log --oneline -1; git merge-base --is-ancestor {BASE_HASH} HEAD && echo 베이스 OK || echo "⚠️ 어긋남-메인보고"
정독 (필수): docs/active/2026-05-26-survivor-support.md §P3.1·§P3.2
참고: docs/rules/PARALLEL_GUIDE.md §3(영역 분담)·§7(자체 검증)

[자율주행] Read·Edit·Write·git add/commit/rebase·tsc·node check 자율. **git push 금지(메인 단독)**. 설계·로직 결정만 메인 확인. (docx 설치는 Swain 승인됨 — 진행)
영역: netlify/functions/, lib/, db/schema.ts, drizzle/, .env.example, package.json
금지: public/, assets/, PROJECT_STATE.md, docs/rules/HANDOFF.md, docs/ (상태는 push 후 메인 보고 텍스트로만)

━━━ §P3.1 DB 체크리스트 ━━━
 - [ ] 신규 테이블 2개 (이름·컬럼·FK·default 정확히): martyrdom_draft_sections / martyrdom_reviews
 - [ ] schema.ts append-only — 파일 끝 /* === P3 서면 === */ 헤더 후 추가, 다른 영역 덮어쓰기 금지
 - [ ] import 점검 — serial·integer·varchar·text·jsonb·timestamp 모두 (누락 시 ReferenceError·#57)
 - [ ] migrate-martyrdom-p3.ts — GET ?run=1·requireAdmin·CREATE TABLE IF NOT EXISTS·인덱스(case_id·output_id·assigned_to)·멱등
 - [ ] outputType 'draft'는 값 추가일 뿐 DDL 불필요(varchar) — 마이그에 컬럼 변경 금지
 - [ ] schema 정의는 주석 상태로 추가 → 마이그 호출 후 메인이 활성화 (DB 적용 전 활성화 금지·#9.1.1)

━━━ §P3.2 API 체크리스트 ━━━
 - [ ] lib/martyrdom-ai.ts 신규 3함수: draftOutline(caseId) / draftSection(caseId,section,priorTitles) / indexApprovedReport(caseId) — callGemini featureKey "martyrdom_ai"·timeoutMs 120000·internalBulk:true·temperature 0.4·maxOutputTokens 4096
 - [ ] draftSection 입력 3종(§9.2): ①exemplar few-shot(searchRag martyr_case "approved-report") ②사건 구조·전략·타임라인 ③법령(searchRag martyr_law)
 - [ ] lib/martyrdom-export.ts 신규: buildDraftHtml / buildDraftPdf(pdf-lib+@pdf-lib/fontkit+NotoSansKR — pdf-receipt 패턴) / buildDraftDocx(docx 라이브러리) / buildCasePackageZip(fflate zipSync)
 - [ ] npm install docx (Swain 승인) → package.json·lock 커밋
 - [ ] 함수 12개 — 전부 export const config = { path } (#56). 목록: draft-outline(POST·PATCH)/draft-generate(POST)/draft-generate-background(POST INTERNAL·config.path 없음)/draft-section(PATCH)/draft(GET)/review(POST·PATCH·GET)/reviewers(GET)/export(POST)/package(POST)/learn-background(POST INTERNAL·config.path 없음)
 - [ ] 종결 훅 — admin-martyrdom-cases PATCH 확장: status→'closed' & outcome 설정 시 admin-martyrdom-learn-background(learnFromClosedCase + indexApprovedReport)
 - [ ] 응답 최상위 키 = §P3.2 계약 1글자도 안 바꿈: outline.sections / section{id,sectionKey,title,content,ragSources,status,wordCount} / sections[] / reviews[] / reviewId / fileName,mimeType,base64 / queued,total,outputId
 - [ ] requireAdmin 반환 auth.res (#58) / reviewedBy·assignedBy·decidedBy = admin.uid (필드명 uid·#BUG-1)
 - [ ] INTERNAL background 2개 — config.path 없음 + INTERNAL_TRIGGER_SECRET 검증(fail-closed·#61)
 - [ ] try/catch step·detail·stack / 응답 키 다중 fallback / 보조 SELECT 실패 시 빈 배열
 - [ ] 알림(가) — 섹션 생성 완료·검토 배정·검토 결정 시 기존 notifications 1줄

작업 순서: 1) migrate-martyrdom-p3 2) schema.ts 주석 정의 3) npm install docx 4) lib(martyrdom-ai 3·martyrdom-export 4) 5) API 12+종결 훅 6) npx tsc --noEmit 7) commit·메인 보고
⚠️ schema 격차 발견 시(가정 컬럼 실재 X 등) 추측 코드 금지 — 실제 schema grep 후 적응 + 메인 사후 보고(2026-05-12 패턴).
push 후 메인 보고: 브랜치명·커밋 해시·변경 파일·응답 키 목록·마이그 함수명·체크박스 전부 체크 여부.
```

### 6.P3-A — 🎨 프론트 구현 (백·lib·db 작업 ❌)
```
[A — 딥릴리프 P3 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/martyrdom-p3-front (베이스 로컬 main @ {BASE_HASH})
■ 셋업 (§6.0): cd ../tbfa-mis-A; git fetch origin; git checkout -B feature/martyrdom-p3-front main; git log --oneline -1; git merge-base --is-ancestor {BASE_HASH} HEAD && echo 베이스 OK || echo "⚠️ 어긋남-메인보고"
정독 (필수): docs/active/2026-05-26-survivor-support.md §P3.3
참고: docs/rules/PARALLEL_GUIDE.md §3(영역 분담)

[자율주행] Read·Edit·Write·git add/commit/rebase·node check 자율. **git push 금지(메인 단독)**. public/js/*.js는 순수 JS — as/interface/제네릭 금지·커밋 전 node --check.
영역: public/ (admin-martyrdom.js·admin-martyrdom.html)
금지: lib/, netlify/functions/, db/, drizzle/, package.json, PROJECT_STATE.md, docs/ (상태는 push 후 메인 보고 텍스트로만)
모드: 평행 mock (USE_P3_MOCK=true → B 머지·마이그 후 메인이 false)

━━━ mock 데이터 (B 머지 전·응답 키 1글자도 안 바꿈·B §P3.2와 1:1) ━━━
const USE_P3_MOCK = true;
const MOCK_DRAFT_OUTLINE = { sections: [
  { sectionKey:"intro",    title:"신청 취지",        intent:"유족급여 청구 취지·근거 법령 개요", order:1 },
  { sectionKey:"deceased", title:"고인 및 직무 개요", intent:"고인 인적사항·담당 업무·근무 환경", order:2 },
  { sectionKey:"duty",     title:"공무상 과로·스트레스", intent:"업무량·시간외·민원 등 공무 관련성", order:3 },
  { sectionKey:"medical",  title:"의학적 인과관계",   intent:"진단·심리부검·사인과 공무의 연결", order:4 },
  { sectionKey:"criteria", title:"인정 요건 충족",   intent:"공무원재해보상법 요건별 대조", order:5 },
  { sectionKey:"conclusion", title:"결론 및 신청",   intent:"순직 인정·유족급여 지급 요청", order:6 },
]};
const MOCK_DRAFT_SECTION = { id:101, sectionKey:"intro", title:"신청 취지",
  content:"본 신청은 고(故) ○○○ 교사의 사망이 공무로 인한 것임을 근거로 유족급여 지급을 청구하는 것입니다. …",
  ragSources:[{title:"공무원재해보상법 제4조", sourceRef:"martyr_law", snippet:"공무로 인한 사망 …"},
    {title:"유사 인정 사례(2024)", sourceRef:"martyr_case", snippet:"과로·민원 스트레스 인정 …"}],
  status:"done", order:1, wordCount:320 };
const MOCK_REVIEWS = [{ id:5, assignedTo:12, assignedToName:"김간사", status:"pending", note:null, createdAt:"2026-05-26T01:00:00Z", decidedAt:null }];
const MOCK_REVIEWERS = [{ id:12, name:"김간사", role:"operator" }, { id:3, name:"이변호사", role:"super_admin" }];
// draft-generate 전 섹션 큐 응답: { ok:true, queued:true, total:6, outputId:30 }
// export 응답: { ok:true, fileName:"유족급여신청서_2026-001.pdf", mimeType:"application/pdf", base64:"JVBERi0…" }
// package 응답: { ok:true, fileName:"사건패키지_2026-001.zip", base64:"UEsDBB…" }

━━━ §P3.3 화면 체크리스트 ━━━
 - [ ] tab-draft placeholder 교체 — 3단계: 목차(목차 제안 생성·제목/intent 편집·순서·추가/삭제·저장) → 본문([본문 생성 시작]·진행 오버레이 N/total·섹션별 textarea 편집·[재생성]·renderRagSources 근거 펼치기) → 합본/검토/내보내기
 - [ ] 준비도 연동 — outputCache.readiness.score<60 시 "약한 보고서 — ○○ 보완 권장" 배너 후 생성 허용
 - [ ] 내보내기 — [📄 PDF][📝 Word]→export POST→base64 Blob 다운로드 / [📦 사건 패키지 zip]→package POST
 - [ ] 전문가 검토 UI — reviewers GET 배정 드롭다운→review POST 배정 / 배정자 [승인][수정요청]+메모 review PATCH / 상태 뱃지(대기·승인·수정요청) — 기존 outputReviewBar 확장
 - [ ] tab-analysis 논리맵 — strategy.contentJson.causalChain 노드(요인)→화살표(연결), evidence 있으면 초록·evidenceMissing 매칭 빨강. HTML/CSS/SVG·신규 라이브러리 없음
 - [ ] mock 키 ↔ B 응답 키 1:1 (snake/camel 임의 변환 금지) — pickContentJson·pickOutputId·outputCache·pollGenerated(4초)·apiFetch 기존 패턴 재사용
 - [ ] 캐시버스터 — admin-martyrdom.html <script src=/js/admin-martyrdom.js?v=P3>
 - [ ] node --check admin-martyrdom.js (순수 JS) / public/ 외 변경 0
push 후 메인 보고: 브랜치명·커밋 해시·변경 파일·체크박스 전부 체크 여부·mock 사용 위치(실 API 전환 대비).
```

### 6.P3-C — 🔍 검증·fix (B·A 머지 후 발사)
```
[C — 딥릴리프 P3 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/martyrdom-p3 (베이스 로컬 main @ A·B 머지 후 HEAD)
■ 셋업 (§6.0): cd ../tbfa-mis-C; git fetch origin; git checkout -B verify/martyrdom-p3 main; git log --oneline -1
정독: docs/active/2026-05-26-survivor-support.md §P3.4
참고: docs/rules/PARALLEL_GUIDE.md §7(검증 책임)·§8(대기열)

작업 순서:
 1) §P3.4 Q1~Q10 — 코드·응답키·schema 정합 정독 + 라우팅(401 게이트) + npx tsc --noEmit + node --check admin-martyrdom.js + 라이브 자산 배포 확인
 2) 회귀 — P1·P2 무회귀 + 순직 자료 일반검색 격리(P2 fix) 유지 확인
 3) B 응답 키 vs A mock 키 1:1 대조 보고
 4) bug 발견 시 fix 커밋(verify 브랜치 그대로) → 메인 보고
 5) 보고서 docs/history/verify/2026-05-26-martyrdom-p3.md
 6) commit → 메인 보고 (push는 메인)

표현 규칙 (CLAUDE.md §6.14): 함수명·코드 용어 없이 사용자 동작·결과 위주.
검증 분담(§7): C=코드·라우팅·tsc·자산 / Swain=브라우저 라이브(목차→본문→내보내기→검토).
```

## §P3.7 라운드 마감 체크리스트 (메인)
- [ ] 분배 전 Swain 확인: 스키마 2테이블·docx 의존성 (§P3.0)
- [ ] 설계서 로컬 main commit → {BASE_HASH} 트리거 채움 → B·A·C 분배
- [ ] B 머지 → Swain migrate-martyrdom-p3?run=1 → schema 활성화·마이그 삭제 → A 머지 → C 검증
- [ ] C PASS 후 release_checklist: 메뉴얼·knowledge.md·jsonl P3 서면 안내 + 권한(검토 배정)·AI 도구는 P4 / docx 부록 기록
- [ ] PROJECT_STATE·HANDOFF 갱신 / 설계서 §P3 → milestone 이동(P4 forward 보존)
- [ ] push = B 머지(마이그)·A 머지(라이브)·C fix 등 라이브 필수 시점만(§9.3 배치)

---

# ★ P4 구현 설계 (확정 2026-05-27 — Swain 결정·딥릴리프 마감 라운드)

> P3 서면 생성까지 라이브. P4 = **마감 라운드** — ① AI 비서 순직 읽기 도구(운영자 전용) ② 유족 전달용 쉬운 요약 ③ 인정률·성과 통계(G5) ④ 연구 발간지(R·§9.4). 사전 정독(§9.1.9)으로 AI 에이전트 도구 시스템·순직 격리·집계 패턴·산출물 저장 제약 확인 완료.

## §P4.0 요구사항 확정 (Swain 2026-05-27)

| # | 결정 | 값 |
|---|---|---|
| 1 | **범위** | 4개 전부 한 라운드 (AI 도구 + 유족 요약 + 통계 + 연구 발간) |
| 2 | **AI 비서 순직 읽기** | **운영자 전용 읽기 도구 추가** — 사건 목록·상태·준비도·기한 조회. **일반 검색 격리(P2 fix·`qna·manual` 한정)는 절대 불변.** 도구는 순직 테이블 직접 조회(일반 RAG 안 거침) |
| 3 | **연구 발간 구성** | **자체 조사(축적 사건·통계·인정패턴) + AI 최근 동향조사·분석 블렌드.** 비율 **운영자 설정**(기본 **자체 7 : AI 3**). ⚠️ AI 동향분석 = Gemini 일반지식 기반(실시간 웹검색 아님)·운영자 검수 필수 |
| 4 | **발간 3종** | 종합 가이드·동향 보고서·익명 사례 연구 (§9.4). 경량 비식별화(실명 부분가림·제3자 가림·수준 조절)·외부 발간 검수 게이트·super_admin |

**불변 원칙 유지**: AI 출력=검토용 초안 / 근거 추적 / 운영자 전용 / **순직 자료 격리(P2 fix 불변 — AI 비서 일반 검색은 계속 `qna·manual`만)** / 외부 발간물은 사람 검수·승인 후만.

### ★ 분배 전 Swain 확인 (§6.10 — DB 스키마·AI 보안)
1. **DB 스키마**: 신규 테이블 1개 `martyrdom_publications`(연구 발간물 — 여러 사건 집계라 사건ID 없음 → 산출물 저장소에 못 넣어 신규 필요) + `martyrdom_ai_outputs.outputType`에 값 `'family_summary'` 추가(varchar·DDL 없음) + `ai_tool_permissions` 시드(신규 순직 도구 권한 행).
2. **AI 보안**: 순직 읽기 도구는 운영자 이상만(`ensureRole`)·`is_mutation=false`·순직 테이블 직접 조회. **`admin-ai-agent` 일반 검색의 `["qna","manual"]` 한정은 건드리지 않음**(P2 격리 불변).

## §P4.1 DB 설계

### 신규 테이블 1개 (append-only — schema.ts 끝 `/* === P4 발간 === */` 헤더)
```typescript
/* === P4 발간 === */
// 연구 발간물 (여러 사건 집계·외부 발간용·비식별화) — caseId 없음(다중 사건)
export const martyrdomPublications = pgTable("martyrdom_publications", {
  id: serial("id").primaryKey(),
  pubType: varchar("pub_type", { length: 20 }).notNull(),       // guide | trend | case_study
  title: varchar("title", { length: 200 }).notNull(),
  contentHtml: text("content_html"),                             // 발간 본문(HTML·export 소스)
  contentJson: jsonb("content_json"),                            // 섹션 구조·근거
  blendRatio: jsonb("blend_ratio"),                              // {self:70, ai:30} 운영자 설정
  sourceCaseIds: jsonb("source_case_ids"),                       // 포함 사건 ID 배열
  anonymized: boolean("anonymized").notNull().default(true),
  reidRisk: varchar("reid_risk", { length: 10 }).default("low"), // low|medium|high
  ragSources: jsonb("rag_sources"),
  status: varchar("status", { length: 12 }).notNull().default("draft"), // draft|reviewed|published
  createdBy: integer("created_by").references(() => members.id),
  reviewedBy: integer("reviewed_by").references(() => members.id),
  publishedBy: integer("published_by").references(() => members.id),
  createdAt: timestamp("created_at").defaultNow(),
  publishedAt: timestamp("published_at"),
});
```
- **`outputType='family_summary'`**: 사건별 유족 요약 → 기존 `martyrdom_ai_outputs`(caseId 있음) 재사용·신규 컬럼 없음.
- **`ai_tool_permissions` 시드**: 신규 순직 도구(아래 §P4.2) 행 — `enabled=true`·`required_role`=운영자 이상·`is_mutation=false`·`category='martyrdom'`. 마이그가 멱등 INSERT.
- 마이그 `migrate-martyrdom-p4`(§6.8·B 작성): `CREATE TABLE IF NOT EXISTS martyrdom_publications` + 인덱스(pub_type·status) + `ai_tool_permissions` 시드 INSERT(ON CONFLICT DO NOTHING). outputType 'family_summary'는 DDL 불필요.

## §P4.2 API·도구·lib

### lib/martyrdom-ai.ts 신규 함수
| 함수 | 동작 |
|---|---|
| `buildFamilySummary(caseId)` | 사건 진행을 **쉬운 말**로 요약 + 다음 할 일(전문용어 풀어서·유족 전달용). `family_summary` 저장 |
| `buildPublication(pubType, caseIds, blendRatio, maskLevel)` | **자체 조사**(축적 사건 recognitionPattern·통계·인정요건 패턴) + **AI 동향조사·분석**(Gemini 지식 기반)을 `blendRatio`로 혼합 → 발간 본문. **비식별화 마스킹**(실명 부분가림·제3자 가림) + `reidRisk` 평가. ragSources 근거 |

### lib/ai-agent-tools.ts 신규 순직 읽기 도구 (운영자 전용·읽기·격리 불변)
`TOOL_DECLARATIONS`에 추가 + `tool_X(args, adminId)` 핸들러 + `executeTool` 케이스. 전부 `ensureRole`로 운영자 이상 게이트·순직 테이블 **직접 조회**(일반 RAG·`searchRag` 안 거침):
| 도구 | 입력 | 반환 |
|---|---|---|
| `martyrdom_case_list` | `{status?}` | 진행 사건 목록(caseNo·title·status·준비도%·다음 기한) |
| `martyrdom_case_status` | `{caseId 또는 caseNo}` | 사건 종합(상태·준비도·인정요건 충족 수·부족 증거·다음 기한) |
| `martyrdom_deadlines_upcoming` | `{days?}` | 임박 기한 사건들(D-day) |
- **시스템 프롬프트**(`ai_agent_settings.system_prompt`): "딥릴리프 순직 사건 조회 도구는 운영자 전용·민감자료" 1줄(메인이 admin-ai-config에서 갱신 or B가 시드).
- ⚠️ **`netlify/functions/admin-ai-agent.ts`의 `searchRag(msg, 5, ["qna","manual"])`는 절대 변경 금지**(P2 격리 불변). 순직 노출은 위 명시적 도구로만.

### 함수 목록 (netlify/functions·전부 `export const config = { path }`)
| 함수 | 메서드 | 용도 |
|---|---|---|
| `admin-martyrdom-family-summary` | POST `{caseId}` / GET `?caseId` | 유족 요약 생성·로드 (ai_outputs family_summary) |
| `admin-martyrdom-stats` | GET | G5 인정률·유형별·추이 집계(GROUP BY·dashboard 패턴) |
| `admin-martyrdom-publication` | POST `{pubType,caseIds?,blendRatio?,maskLevel?}` / GET list / GET `?id` / PATCH `{id,status,...}` / DELETE `?id` | 발간물 생성·목록·상세·검수/발간·삭제 (super_admin) |
| `admin-martyrdom-publication-generate-background` | POST INTERNAL | 발간 본문 생성(블렌드·비식별화·무거운 AI — background) |
| `admin-martyrdom-publication-export` | POST `{id,format}` | 발간물 HTML/PDF export (pdf-lib·G1 패턴) |

### 응답 JSON 계약 (A mock·B 동일·키 고정)
```jsonc
// family-summary POST/GET
{ "ok": true, "summary": { "id": 50, "outputType":"family_summary", "contentText":"○○ 선생님 사건은 현재 …(쉬운 말)", "nextSteps":["자료 보완","전문가 검토 대기"], "status":"draft" } }
// stats GET
{ "ok": true, "totals": { "cases": 12, "approved": 5, "rejected": 2, "pending": 5 },
  "recognitionRate": 0.71, "byCaseType": [{"type":"overwork","total":6,"approved":4}],
  "byStatus": [{"status":"analysis","count":4}], "trend": [{"month":"2026-03","approved":1}] }
// publication POST (생성 큐)
{ "ok": true, "queued": true, "id": 9, "pubType":"guide", "status":"draft" }
// publication GET ?id
{ "ok": true, "publication": { "id":9, "pubType":"guide", "title":"교사 사망 시 순직 인정까지", "contentHtml":"<h1>…", "blendRatio":{"self":70,"ai":30}, "anonymized":true, "reidRisk":"low", "status":"draft", "ragSources":[…] } }
// publication GET list
{ "ok": true, "publications": [{ "id":9, "pubType":"guide", "title":"…", "status":"draft", "createdAt":"…" }] }
// publication PATCH (검수/발간)
{ "ok": true, "id": 9, "status": "published" }
// publication-export POST
{ "ok": true, "fileName":"종합가이드.pdf", "mimeType":"application/pdf", "base64":"JVBERi0…" }
```

## §P4.3 화면 설계 (`public/admin-martyrdom.js`·`admin-martyrdom.html`·캐시버스터 `?v=P4`)
- **⑧ 유족 요약**: ④서면 탭(또는 디테일 헤더)에 [🧑‍🤝‍🧑 유족 전달용 요약 생성] → 쉬운 말 요약 + 다음 할 일 카드 → [복사][PDF]. 운영자가 유족에게 전달(유족 로그인 아님).
- **G5 통계 탭(신규 `tab-stats`)**: 인정률 도넛·유형별 막대·월별 추이 선(Chart.js). 진행 사건 준비도 분포.
- **연구 발간 탭(신규 `tab-publications`·super_admin)**: 유형 선택(가이드·동향·사례연구) → **혼합 비율 슬라이더(자체 ↔ AI·기본 70:30)** + 마스킹 수준 → [발간물 생성](background·진행 표시) → 미리보기 + 비식별화 검수(reidRisk 표시) → [검수 완료]→[발간] → [HTML/PDF export]. 발간물 목록.
- **AI 도구**: 백엔드+프롬프트라 A 작업 없음(AI 비서 화면·admin-ai-config에 자동 노출). 도구 권한은 admin-ai-config 권한 테이블에서 운영자가 관리(§6.18).
- 신규 탭 2개는 admin-martyrdom 내부 탭 → **cms-tbfa iframe 변경 없음**(딥릴리프 메뉴 그대로).

## §P4.4 검증 시나리오 (C)
| Q | 시나리오 | 기대 |
|---|---|---|
| Q1 | 유족 요약 생성 | 쉬운 말 요약·다음 할 일·복사/PDF |
| Q2 | 통계 | 인정률·유형별·추이 차트 정상 집계 |
| Q3 | 발간물 생성(가이드) | 자체+AI 블렌드·비율 반영·비식별화·reidRisk |
| Q4 | 발간 비율 슬라이더 | 70:30 기본·운영자 변경 반영 |
| Q5 | 발간 검수→발간→export | 상태 전이·HTML/PDF 다운로드·super_admin 게이트 |
| Q6 | **AI 도구(운영자)** | AI 비서에 "진행 중 순직 사건 알려줘" → 목록/상태 응답(운영자 계정) |
| Q7 | **격리 회귀(핵심)** | 비운영자/일반 질문엔 순직 안 나옴·일반 검색 여전히 `qna·manual`만 (P2 fix 불변) |
| 회귀 | P1·P2·P3 | 업로드·분석·서면·검토·내보내기 무회귀 |

## §P4.5 mock 데이터 (A — `USE_P4_MOCK` 토글)
```javascript
const USE_P4_MOCK = true; // B 머지·마이그 후 false
const MOCK_FAMILY_SUMMARY = { id:50, outputType:"family_summary",
  contentText:"○○ 선생님 사건은 현재 자료를 모아 전략을 분석하는 단계입니다. 쉽게 말씀드리면 …",
  nextSteps:["병원 진료기록 보완","전문가 검토 대기"], status:"draft" };
const MOCK_STATS = { totals:{cases:12,approved:5,rejected:2,pending:5}, recognitionRate:0.71,
  byCaseType:[{type:"overwork",total:6,approved:4},{type:"harassment",total:4,approved:1}],
  byStatus:[{status:"analysis",count:4},{status:"hearing",count:3}],
  trend:[{month:"2026-03",approved:1},{month:"2026-04",approved:2}] };
const MOCK_PUBLICATION = { id:9, pubType:"guide", title:"교사 사망 시 순직 인정까지",
  contentHtml:"<h1>교사 사망 시 순직 인정까지</h1><p>…</p>", blendRatio:{self:70,ai:30},
  anonymized:true, reidRisk:"low", status:"draft", ragSources:[{title:"인정 사례 종합",sourceRef:"martyr_case",snippet:"…"}] };
const MOCK_PUBLICATIONS = [{ id:9, pubType:"guide", title:"교사 사망 시 순직 인정까지", status:"draft", createdAt:"2026-05-27T00:00:00Z" }];
// publication 생성 큐: { ok:true, queued:true, id:9, pubType:"guide", status:"draft" }
// export: { ok:true, fileName:"종합가이드.pdf", mimeType:"application/pdf", base64:"JVBERi0…" }
```

## §P4.6 4채팅 트리거 (PARALLEL_TEMPLATE §6 양식·Swain 복붙용)

> **베이스**: 워크트리 공유 → 로컬 `main` 분기. `{BASE_HASH}` = **P3 종결 후** 메인이 채워 전달(P4는 P3 검증·종결 뒤 분배). 셋업 `checkout -B ... main`.
> **머지 순서(§5)**: B 머지 → Swain `migrate-martyrdom-p4?run=1` → schema 활성화·마이그 삭제 → A 머지 → C 검증.

### 6.P4-B — 🔧 백 구현 (프론트 작업 ❌)
```
[B — 딥릴리프 P4 백 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-B
브랜치: feature/martyrdom-p4-back (베이스 로컬 main @ {BASE_HASH})
■ 셋업: cd ../tbfa-mis-B; git fetch origin; git checkout -B feature/martyrdom-p4-back main; git log --oneline -1; git merge-base --is-ancestor {BASE_HASH} HEAD && echo 베이스 OK || echo "⚠️ 어긋남-메인보고"
정독 (필수): docs/active/2026-05-26-survivor-support.md §P4.1·§P4.2
참고: docs/rules/PARALLEL_GUIDE.md §3·§7

[자율주행] Read·Edit·Write·git add/commit/rebase·tsc·node check 자율. git push 금지(메인 단독). 설계·로직만 메인 확인.
영역: netlify/functions/, lib/, db/schema.ts, drizzle/, package.json
금지: public/, assets/, PROJECT_STATE.md, docs/rules/HANDOFF.md, docs/

━━━ §P4.1 DB ━━━
 - [ ] 신규 테이블 martyrdom_publications (컬럼·default §P4.1 그대로) — schema.ts 끝 /* === P4 발간 === */ append-only
 - [ ] import 점검(serial·integer·varchar·text·jsonb·boolean·timestamp·index) / schema 주석 상태 → 마이그 후 메인 활성화
 - [ ] migrate-martyrdom-p4.ts — GET ?run=1·requireAdmin·CREATE TABLE IF NOT EXISTS·인덱스(pub_type·status)·ai_tool_permissions 시드 INSERT ON CONFLICT DO NOTHING·멱등
 - [ ] outputType 'family_summary'는 값 추가일 뿐(varchar·DDL 없음)

━━━ §P4.2 API·도구·lib ━━━
 - [ ] lib/martyrdom-ai.ts: buildFamilySummary(caseId) / buildPublication(pubType,caseIds,blendRatio,maskLevel) — featureKey "martyrdom_ai"·timeoutMs 120000·internalBulk·blendRatio 기본 {self:70,ai:30}·비식별화 마스킹·reidRisk 평가
 - [ ] lib/ai-agent-tools.ts: 순직 읽기 도구 3개(martyrdom_case_list·martyrdom_case_status·martyrdom_deadlines_upcoming) — TOOL_DECLARATIONS 추가 + tool_X(args,adminId) 핸들러 + executeTool 케이스. **ensureRole로 운영자 이상 게이트**·is_mutation=false·순직 테이블 직접 조회(searchRag 안 거침). ⚠️ 기존 requireAdmin/운영자 권한 모델 grep 후 정확한 역할값 적용(§9.1.9)
 - [ ] ⚠️ netlify/functions/admin-ai-agent.ts의 searchRag(...,["qna","manual"]) **절대 변경 금지**(P2 격리 불변)
 - [ ] 함수 5개 — 전부 export const config = { path }: family-summary / stats / publication(POST·GET·GET?id·PATCH·DELETE) / publication-generate-background(INTERNAL·config.path 없음) / publication-export
 - [ ] 발간물 super_admin 게이트 / 응답 키 = §P4.2 계약 1글자도 안 바꿈(summary/totals,recognitionRate,byCaseType,byStatus,trend/publication{…}/publications[]/fileName,mimeType,base64/queued,id)
 - [ ] requireAdmin auth.res / createdBy·reviewedBy·publishedBy = admin.uid / INTERNAL_TRIGGER_SECRET 검증 / try-catch step·detail·stack
 - [ ] npx tsc --noEmit 통과
작업 순서: 1)마이그 2)schema 주석 3)lib(ai 2함수·도구 3개) 4)API 5 5)tsc 6)commit·보고
push 후 보고: 브랜치·해시·응답 키·마이그명·도구 3개 권한 게이트 방식·격리 불변 확인.
```

### 6.P4-A — 🎨 프론트 구현 (백·lib·db 작업 ❌)
```
[A — 딥릴리프 P4 프론트 구현]

모델: Sonnet 4.6
워크트리: ../tbfa-mis-A
브랜치: feature/martyrdom-p4-front (베이스 로컬 main @ {BASE_HASH})
■ 셋업: cd ../tbfa-mis-A; git fetch origin; git checkout -B feature/martyrdom-p4-front main; git log --oneline -1; git merge-base --is-ancestor {BASE_HASH} HEAD && echo 베이스 OK || echo "⚠️ 어긋남-메인보고"
정독 (필수): docs/active/2026-05-26-survivor-support.md §P4.3
참고: docs/rules/PARALLEL_GUIDE.md §3

[자율주행] Read·Edit·Write·git add/commit/rebase·node check 자율. git push 금지. 순수 JS(as/interface/제네릭 금지·node --check).
영역: public/ (admin-martyrdom.js·admin-martyrdom.html)
금지: lib/, netlify/functions/, db/, drizzle/, package.json, PROJECT_STATE.md, docs/
모드: 평행 mock (USE_P4_MOCK=true → B 머지·마이그 후 메인이 false)

━━━ mock 데이터 (B 머지 전·키 1:1·B §P4.2와 동일) ━━━
const USE_P4_MOCK = true;
const MOCK_FAMILY_SUMMARY = { id:50, outputType:"family_summary", contentText:"○○ 선생님 사건은 현재 자료를 모아 전략을 분석하는 단계입니다. …", nextSteps:["병원 진료기록 보완","전문가 검토 대기"], status:"draft" };
const MOCK_STATS = { totals:{cases:12,approved:5,rejected:2,pending:5}, recognitionRate:0.71, byCaseType:[{type:"overwork",total:6,approved:4},{type:"harassment",total:4,approved:1}], byStatus:[{status:"analysis",count:4},{status:"hearing",count:3}], trend:[{month:"2026-03",approved:1},{month:"2026-04",approved:2}] };
const MOCK_PUBLICATION = { id:9, pubType:"guide", title:"교사 사망 시 순직 인정까지", contentHtml:"<h1>교사 사망 시 순직 인정까지</h1><p>…</p>", blendRatio:{self:70,ai:30}, anonymized:true, reidRisk:"low", status:"draft", ragSources:[{title:"인정 사례 종합",sourceRef:"martyr_case",snippet:"…"}] };
const MOCK_PUBLICATIONS = [{ id:9, pubType:"guide", title:"교사 사망 시 순직 인정까지", status:"draft", createdAt:"2026-05-27T00:00:00Z" }];
// publication 생성 큐: { ok:true, queued:true, id:9, pubType:"guide", status:"draft" } / export: { ok:true, fileName:"종합가이드.pdf", mimeType:"application/pdf", base64:"JVBERi0…" }

━━━ §P4.3 화면 체크리스트 ━━━
 - [ ] 유족 요약 — ④서면 탭/디테일에 [유족 전달용 요약 생성] → 쉬운 말 요약+다음 할 일 카드 → [복사][PDF]
 - [ ] 통계 탭(신규 tab-stats) — 인정률 도넛·유형별 막대·월별 추이 선(Chart.js)·준비도 분포
 - [ ] 연구 발간 탭(신규 tab-publications·super_admin) — 유형 선택·혼합 비율 슬라이더(자체↔AI·기본 70:30)·마스킹 수준 → [생성](진행 표시) → 미리보기+reidRisk 검수 → [검수][발간] → [HTML/PDF] · 발간물 목록
 - [ ] 권한 조건부 — 발간 탭은 super_admin만 노출
 - [ ] mock 키 ↔ B 응답 1:1 (apiFetch·pickContentJson·outputCache·pollGenerated·진행 오버레이 재사용)
 - [ ] 탭 추가는 admin-martyrdom 내부 탭(switchTab) — cms-tbfa iframe 변경 0
 - [ ] 캐시버스터 admin-martyrdom.js?v=P4 / node --check / public/ 외 변경 0
push 후 보고: 브랜치·해시·체크박스·USE_P4_MOCK 키 정합·mock 위치.
```

### 6.P4-C — 🔍 검증·fix (B·A 머지 후·P3 종결 후)
```
[C — 딥릴리프 P4 검증·fix]

모델: Opus 4.7
워크트리: ../tbfa-mis-C
브랜치: verify/martyrdom-p4 (베이스 로컬 main @ {머지 후 HEAD})
■ 셋업: cd ../tbfa-mis-C; git fetch origin; git checkout -B verify/martyrdom-p4 main; git log --oneline -1
정독: docs/active/2026-05-26-survivor-support.md §P4.4 / 참고 PARALLEL_GUIDE §7

[자율주행] 검증·fix만(신규 기능 ❌). git push 금지(메인 단독).
작업 순서:
 1) §P4.4 Q1~Q7 — 코드·응답키·schema 정합 + 라우팅(401·super_admin 게이트) + tsc + node --check + 라이브 자산
 2) ★ Q7 격리 회귀(최우선) — AI 비서 일반 검색이 여전히 qna·manual만인지·순직 도구가 운영자만인지·비운영자/일반 질문에 순직 안 나오는지
 3) 회귀 — P1·P2·P3 무회귀
 4) B 응답 키 vs A mock 키 1:1 대조
 5) fix 커밋(verify 브랜치) → 메인 보고 / 보고서 docs/history/verify/{날짜}-martyrdom-p4.md
표현 규칙(§6.14): 사용자 동작·결과 위주. 검증 분담(§7): C=코드·라우팅·격리·tsc / Swain=브라우저(통계·발간·유족요약·AI 도구 대화).
```

## §P4.7 라운드 마감 체크리스트 (메인)
- [ ] 분배 전 Swain 확인: martyrdom_publications 스키마·AI 도구 격리 (§P4.0)
- [ ] **P3 종결 후** 설계 로컬 main commit → {BASE_HASH} 채움 → B·A·C 분배
- [ ] B 머지 → migrate-martyrdom-p4?run=1 → schema 활성화·마이그 삭제 → A 머지 → C 검증
- [ ] ★ 격리 회귀(Q7) 반드시 PASS — AI 도구가 P2 격리 안 깨는지
- [ ] release_checklist: 메뉴얼·knowledge.md·jsonl P4 안내 + **AI 도구 카탈로그·권한·시스템 프롬프트 동기화(#2 — 코드·DB성·검토 필수)** + 발간 권한(super_admin)
- [ ] **딥릴리프 전체(P1~P4) 설계서 → milestone 이동·active 비움**(연구 발간 후속 라운드 여지만 forward)
- [ ] PROJECT_STATE·HANDOFF 갱신 / push = 머지·라이브 필수 시점만(§9.3)
