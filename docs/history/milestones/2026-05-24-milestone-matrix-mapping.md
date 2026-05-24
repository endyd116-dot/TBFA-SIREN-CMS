# ③ 마일스톤 매트릭스 AI 매핑 — 설계서 (단일 출처)

> 2026-05-24 / 메인 솔로 라운드 (스키마 0·마이그 0·외부연동 0)
> 요구 원문·접근: `docs/active/2026-05-24-milestone-and-news.md` §③
> 구현 결과·검증 권장은 본 문서 하단에 누적.

---

## 1. 한 줄 정의

슈퍼어드민이 **분기 성과 기준표(매트릭스)를 텍스트로 붙여넣으면**, AI가 마일스톤 정의 후보를 추출하고 **기존 정의와 겹치는지 판정**하여 — 고신뢰·충돌 없는 신규는 자동 선택, **충돌·삭제 후보는 수정/삭제/유지를 물어** 한 번에 적용한다.

## 2. Swain 결정 (2026-05-24 확정)

| 항목 | 결정 |
|---|---|
| 입력 방식 | **텍스트 붙여넣기** (워드/한글 표·문장 그대로) |
| 반영 방식 | **신뢰도 높으면 자동 적용** + 충돌만 확인 |
| 매핑 단위 | **상시 정의 집합 갱신** (분기 복제 아님) |
| 감사 테이블 | **신설 안 함** (기존 `milestone_definition_history`로 충분) |

## 3. 데이터 모델 (기존 재활용 — 변경 0)

"마일스톤 매트릭스" = `milestone_definitions` 집합 = **역할 기반 템플릿**(사람별 아님). 사람별 배정은 별도(`members.milestoneRole`).

`milestone_definitions` 컬럼(전부 기존): `code`(unique·필수)·`name`(필수)·`category`(REVENUE_LINKED|NON_REVENUE·필수)·`targetMilestoneRole`(필수·`milestone_roles.code`)·`businessUnit`·`revenueSource`·`thresholdEnabled`·`thresholdValue`·`thresholdUnit`·`bonusFormula`(jsonb·필수)·`quarterApplicable`·`isActive`(소프트삭제)·`sortOrder`.

`bonusFormula` 유형(설정·결산 계산 기준):
- `{type:"FLAT", unitAmount}` — 건당 정액
- `{type:"PERCENT", rate}` — 비율(소수, 5%=0.05)
- `{type:"BRACKET", brackets:[{min,max,amount}]}` — 구간별 정액
- `{type:"EVENT_RANGE"}` — 어드민이 건별 금액 결정

**스키마 변경 없음 / 마이그레이션 없음.** 결산 참조는 `quarterly_settlements.calculation_snapshot`에 스냅샷되어, 정의 수정·소프트삭제해도 과거 결산 무손상.

## 4. featureKey (비용 게이트)

`lib/ai-feature.ts` FEATURE_REGISTRY에 추가 (DB 시드 불필요 — `loadFeatureState`가 행 없으면 기본 enabled, fail-open):
```
{ key:"milestone_matrix_mapping", name:"마일스톤 매트릭스 AI 매핑", category:"admin_action",
  description:"분기 성과 기준표(매트릭스) 텍스트에서 마일스톤 정의 추출·기존 충돌 판정", sortOrder:296 }
```

## 5. 신규 API — `admin-milestone-matrix-parse` (POST·읽기 전용·DB 쓰기 0)

- `export const config = { path:"/api/admin-milestone-matrix-parse" }`
- `requireAdmin` + **super_admin 전용**(`auth.ctx.member.role`, 아니면 403). `guardFailed`·단계별 try/catch + step·detail.
- 입력: `{ text:string, roleHint?:string }`
- 처리:
  1. 활성 `milestone_definitions` 로드(요약 컬럼) + 활성 `milestone_roles`(code·name) 로드 → 프롬프트 동봉(AI가 역할명→코드 매핑·중복 코드 회피).
  2. `callGeminiJSON`(featureKey·mode `pro`·maxOutputTokens 큼) — 매트릭스 텍스트에서 후보 추출. 후보별:
     `{code,name,category,targetMilestoneRole,businessUnit,revenueSource,thresholdEnabled,thresholdValue,thresholdUnit,bonusFormula,quarterApplicable, confidence(0~1), matchExistingId(or null), action('NEW'|'UPDATE'|'KEEP'), reason}`
  3. **코드 후처리(결정론적·AI 신뢰 안 함)**:
     - bonusFormula 객체·type 유효성 검사(실패 시 confidence 강등·needsReview)
     - targetMilestoneRole이 활성 역할 코드인지(아니면 unknownRole 플래그)
     - category 화이트리스트
     - code 중복·기존 충돌: NEW인데 code가 기존과 같으면 action을 UPDATE로 교정
     - **orphans 계산**: 활성 기존 정의 중 어떤 후보의 matchExistingId로도 참조 안 된 것 → 삭제 후보(`{id,code,name,role}`)
  4. 응답: `{ ok:true, data:{ candidates:[...], orphans:[...], existingCount, modelUsed, summary } }`
- AI 실패 시: `{ok:false, error, step:"ai"}` → 클라이언트가 토스트 + 수동 "+ 신규 등록" 폴백 안내.

## 6. 프론트 — 정의 탭(`#panelDefs`)에 통합

### HTML (`public/admin-milestones.html`)
- 정의 탭 헤더에 `🤖 매트릭스 분석` 버튼(`#btnMatrixImport`) 추가(+ 신규 등록 옆).
- 신규 모달 `#matrixModal`: ① 안내 ② 역할 힌트 select(선택) ③ textarea(`#matrixText`) ④ `분석`(`#matrixParseBtn`) ⑤ 결과 검토 영역(`#matrixReview`) ⑥ `적용`(`#matrixApplyBtn`)·`닫기`.

### JS (`public/js/admin-milestones.js`)
- `openMatrixModal()` / `runMatrixParse()` → `/api/admin-milestone-matrix-parse` 호출 → `renderMatrixReview(data)`.
- 검토 영역 4구역:
  - **✅ 자동 적용**(NEW·confidence≥0.8·code 고유·formula 유효): 기본 체크. 한 번의 적용으로 신규 등록.
  - **⚠️ 충돌(UPDATE)**: 기존값↔새값 비교 + 라디오 `수정 적용`/`유지(스킵)`. 필드 인라인 편집 가능.
  - **⚠️ 저신뢰·역할 미확인**: 기본 미체크·인라인 편집 후 등록.
  - **🗑 삭제 후보(orphans)**: 라디오 `비활성화`/`유지`. **기본 유지**(자동 삭제 안 함·안전).
  - **변경 없음(KEEP)**: 정보 표시만.
- `applyMatrixActions()`: 선택된 액션을 **기존 엔드포인트 재사용**으로 순차 적용 —
  신규=`POST /api/milestone-definitions`, 수정=`PATCH /api/milestone-definitions/:id`, 삭제=`PATCH :id {isActive:false}`.
  per-item 성공/실패 집계 → 토스트 `N건 등록·M건 수정·K건 비활성(실패 X)` → `loadDefs()`·모달 닫기.
- **재사용 근거**: 기존 POST/PATCH가 필수필드·코드 unique·formula JSON·history·알림을 이미 검증 → 검증 중복 0(작동 보장 5원칙). 분기당 1회·소량(10~30행)이라 순차 호출 비용 무시.
- 캐시버스터 `?v=9-matrix`.

## 7. Swain 요구 충족 매핑

| Swain 요구 | 충족 |
|---|---|
| 매트릭스 업데이트하면 새 마일스톤 셋업 | NEW 자동 선택·등록 |
| 겹치면 수정/삭제 물어봐 | UPDATE 라디오 + orphan(삭제후보) 라디오 |
| 신뢰도 높으면 자동 | confidence≥0.8 NEW 기본 체크 |
| 언급 안 된 워크플로우 보완 | orphan 자동 탐지·KEEP 식별·인라인 편집·변경이력 자동 적재·역할명→코드 매핑 |

## 8. 종결 체크리스트(release_checklist 동기)
- [ ] featureKey 등록 + AI 비서 설정 화면 노출 확인
- [ ] 매뉴얼(성과관리) "매트릭스 분석" 안내 추가
- [ ] 성과 명세 갱신
- [ ] 캐시버스터 일괄
- [ ] tsc 0
- [ ] super_admin 가드(서버·UI)
- [ ] C 코드 검증

---

## 구현 결과 (2026-05-24·메인 솔로·tsc 0·JS 문법 0)

### 변경 파일
- **신규** `netlify/functions/admin-milestone-matrix-parse.ts` — AI 파싱 엔드포인트(POST·super_admin·읽기 전용·DB 쓰기 0). 기존 정의+역할 로드 → Gemini(`callGeminiJSON`·mode pro·featureKey `milestone_matrix_mapping`) → 결정론적 후처리(공식·역할·카테고리·코드 충돌 검증, orphans 계산).
- `lib/ai-feature.ts` — FEATURE_REGISTRY에 `milestone_matrix_mapping`(sortOrder 296) 추가. DB 시드 불필요(`loadFeatureState` fail-open).
- `public/admin-milestones.html` — 정의 탭 '🤖 매트릭스 분석' 버튼 + `#matrixModal`(입력·검토 2단계). 캐시버스터 `?v=9-matrix`.
- `public/js/admin-milestones.js` — 매트릭스 모듈(`openMatrixModal`·`runMatrixParse`·`renderMatrixReview`·`mxCandCard`·`mxApply`) + 역할 힌트 드롭다운 동적 채움. 적용은 기존 `milestone-definitions` POST/PATCH 재사용.

### 핵심 동작
- 4구역 검토: ✅자동적용(NEW·신뢰≥0.8·플래그 없음·기본 체크) / ⚠️충돌(UPDATE·기본 미체크·기존↔새 비교) / 🔍검토필요(저신뢰·역할미확인·기본 미체크) / 🗑삭제후보(orphan·기본 유지) + ⏸변경없음(KEEP).
- **PATCH 제약 반영**: 기존 정의 수정(UPDATE)은 이름·공식·임계·사업체·분기만 PATCH(코드·역할·카테고리 불변). 신규(NEW)만 전체 POST.
- 적용 전 모든 값 인라인 편집 가능. 공식 JSON 파싱 오류는 해당 항목만 실패 처리(나머지 진행). 결과 토스트 `N건 등록·M건 수정·K건 비활성(실패 X)`.

### 종결 시 잔여(Swain 라이브 검증 통과 후)
- [ ] 매뉴얼(`manual-admin.html` 성과관리) '매트릭스 분석' 안내 추가
- [ ] 성과 명세(`docs/specs/성과관리시스템_명세서.md`) 항목 추가
- [ ] 설계서 → `docs/history/milestones/` 이동
