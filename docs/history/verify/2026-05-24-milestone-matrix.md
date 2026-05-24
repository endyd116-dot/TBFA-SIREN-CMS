# ③ 마일스톤 매트릭스 AI 매핑 — 검증 리포트 (C영역)

> 베이스: origin/main @ `f37f5ad` / 브랜치: `verify/2026-05-24-milestone-matrix`
> 대상 커밋: `f37f5ad`(매트릭스 매핑) + `5ec8d04`(직전 배치 BUG-1 fix 재확인)
> 방식: 코드 레벨 정합·로직·회귀 검증 (라이브 클릭은 Swain — 하단 체크리스트)
> 결과: **PASS 8/8 + 회귀 0 · BUG 0건 · tsc 0 · JS 문법 0**
> 설계 단일 출처: `docs/active/2026-05-24-milestone-matrix-mapping.md`

---

## 검증 결과표

| 항목 | 결과 | 근거 |
|---|---|---|
| **V1 파싱 엔드포인트** | ✅ PASS | super_admin 가드(`auth.ctx.member.role`, 비-super 403)·POST 외 405·읽기 전용(SELECT 2건만·INSERT/UPDATE 0)·step+detail 에러·길이 가드(10자 미만·12,000자 초과 400) |
| **V2 AI 후처리 정합** | ✅ PASS | 공식 type 검증(FLAT/PERCENT/BRACKET/EVENT_RANGE·불충족→EVENT_RANGE+신뢰강등)·역할 화이트리스트(roleCodes)·카테고리 화이트리스트·코드 충돌→UPDATE 교정·내부 중복 코드 회피(seen+existing) |
| **V3 orphans 계산** | ✅ PASS | matchedIds=후보의 matchExistingId(non-null) → 활성 정의 중 미참조분만 삭제후보. 결정론적·AI 비의존. KEEP/UPDATE는 matchExistingId 보유 → orphan 제외 정확 |
| **V4 자동선택 기준** | ✅ PASS | `autoApply = action==='NEW' && confidence>=0.8 && flags.length===0`. UPDATE·저신뢰·플래그 보유는 기본 미체크 |
| **V5 적용 분기** | ✅ PASS | NEW=POST 전체(code·name·category·role·…)·UPDATE=PATCH 7필드(name·businessUnit·quarter·threshold3·bonusFormula)가 milestone-definitions PATCH 허용목록의 부분집합. 코드·역할·카테고리 미전송(불변) |
| **V6 적용 흐름** | ✅ PASS | 공식 JSON 오류 항목만 실패(continue)·나머지 진행·per-item 집계·orphan PATCH{isActive:false}·결과 토스트(N등록·M수정·K비활성·실패X)·`loadDefs()`·모달 닫기 |
| **V7 회귀 0** | ✅ PASS | 기존 정의 탭·역할 드롭다운(`fillRoleDropdownsDynamic` 동일 소스)·캐시버스터 `?v=9-matrix`·모듈 자기완결(`?.` 가드, AM 네임스페이스). tsc 0·JS 문법 0 |
| **V8 featureKey** | ✅ PASS | FEATURE_REGISTRY `milestone_matrix_mapping`(sortOrder 296) 등록·`loadFeatureState` 기본 `{enabled:true}`·행/테이블 없으면 enabled(fail-open·시드 불필요)·callGeminiJSON featureKey 게이트 경유 |

| 회귀·문법 | 결과 |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `node --check public/js/admin-milestones.js` | ✅ OK |
| 직전 배치 BUG-1 fix(5ec8d04) main 잔존 | ✅ rebuildSingleSession 헬퍼·record-edit·correction-review 동기화 온전 |

---

## 상세 검증

### V1 — 파싱 엔드포인트 (admin-milestone-matrix-parse.ts)
- 권한: `requireAdmin` + `guardFailed` → `auth.res` / `member.role !== "super_admin"` → 403. 메서드 POST 외 405.
- **읽기 전용 확인**: 본문에 `milestone_definitions`·`milestone_roles` SELECT 2건 외 DB 쓰기 없음(적용은 프론트가 기존 정의 API로). ✅
- 길이: `< 10` 400 / `> 12000` 400. 역할 로드 실패는 빈 배열로 계속(메인 분석 가능).

### V2 — 결정론적 후처리
AI 출력을 신뢰하지 않고 전부 재검증: 신뢰도 0~1 클램프 → 카테고리(미확인 시 NON_REVENUE+플래그) → 역할(미확인 플래그) → 사업체(화이트리스트 외 null) → 공식(불충족 시 EVENT_RANGE+플래그) → 코드(소문자·정규식·20자, 빈값 자동생성) → 충돌(byCode 우선·환각 id 방어) → action 교정(matched→UPDATE/KEEP, 아니면 NEW) → NEW 내부 중복 코드 회피.

### V3 — orphans
`matchedIds = candidates.matchExistingId(non-null)`. orphans = 활성 정의 − matchedIds. NEW(매칭 null)는 matchedIds에 미기여, KEEP/UPDATE는 기여 → KEEP된 정의가 삭제후보로 잘못 분류되지 않음. ✅

### V5 — PATCH 허용필드 1:1 정합 (핵심)
milestone-definitions PATCH allowed = `[name, thresholdEnabled, thresholdValue, thresholdUnit, bonusFormula, quarterApplicable, isActive, effectiveFrom, effectiveTo, sortOrder, businessUnit, revenueSource]`.
- 매트릭스 UPDATE 전송 = `{name, businessUnit, quarterApplicable, thresholdEnabled, thresholdValue, thresholdUnit, bonusFormula}` → **전부 허용목록에 포함(부분집합)**, code·targetMilestoneRole·category 미전송 → 불변 보장. ✅
- orphan 비활성 = `{isActive:false}` → 허용·boolean 검증 통과. ✅
- NEW POST 필수(code·name·category·role·bonusFormula) 프론트 사전 검증 + 서버 재검증. ✅

### V6 — 적용 흐름
`mxApply`가 체크된 `.mx-cand`만 순회 → 공식 `JSON.parse` 실패는 해당 항목 failed+continue → UPDATE는 PATCH/:id, NEW는 POST → orphan 체크분 PATCH{isActive:false} → `created·updated·deactivated·failed` 집계 토스트 → `loadDefs()`. KEEP은 정보 표시만(카드 아님)이라 적용 대상에서 자연 제외.

### 직전 배치 BUG-1 fix 재확인
- `admin-att-record-edit`: `newSessions`는 **시각이 수정될 때만**(`newCheckIn/newCheckOut !== undefined`) 빌드·SET. 근무형태·메모만 수정 시 sessions 미터치. ✅
- `admin-att-correction-review`: 정정 승인 UPSERT(INSERT+DO UPDATE)에 sessions 동기화. ✅
- `rebuildSingleSession`(lib/att-session.ts): 위치 보존·퇴근 전이면 진행중(out=null) 단일 세션 유지. ✅

---

## 관찰 (비차단·참고)

- **역할 힌트 드롭다운 비동기 채움**: `#matrixRoleHint`는 `window.MilestoneRoles.loadActiveRoles()`(IIFE)로 채워짐. 로드 직후 즉시 모달을 열면 잠깐 '자동 판별'만 보일 수 있으나, NEW 후보 역할 select는 `mxRoleOptions`에 '(미확인)' 폴백이 있어 값 보존·적용 가능. 실사용 영향 미미.
- **AI 실패 응답 detail**: 파싱 엔드포인트 AI 실패는 step만 반환(stack 없음). 설계 §5(step·detail)는 충족. §6.2 표준의 stack은 생략 — 비차단.
- **callGeminiJSON 폴백 안내**: AI 실패 시 프론트가 "+ 신규 등록 직접 입력" 폴백 토스트 노출. ✅

---

## Swain 브라우저 라이브 체크리스트 (코드로 확정 불가·실제 클릭)

운영 관리 → 성과관리 → **정의** 탭에서:

1. **매트릭스 분석 진입**: '🤖 매트릭스 분석' 버튼 → 모달 오픈·역할 힌트 드롭다운에 역할 코드 표시·textarea 입력 가능
2. **분석 실행**: 분기 성과 기준표(워드/한글 표·문장) 붙여넣기 → '🔍 분석' → 요약줄(추출 N·자동선택·충돌·검토필요·변경없음·삭제후보) 표시
3. **4구역 표시 확인**:
   - ✅ 자동 적용(고신뢰 신규) — 기본 체크
   - ⚠️ 충돌(기존 수정) — 기본 미체크·기존↔새 공식 비교 표시·역할/카테고리/코드 '변경 안 됨' 안내
   - 🔍 검토 필요(저신뢰·역할 미확인) — 기본 미체크
   - 🗑 삭제 후보(새 매트릭스에 없는 기존 정의) — 기본 유지(미체크)
4. **인라인 편집**: 적용 전 이름·공식 JSON·임계·사업체·분기(신규는 코드·역할·카테고리도) 값 수정 가능
5. **적용**: 체크 후 '선택 항목 적용' → 확인창 → 결과 토스트(N건 등록·M건 수정·K건 비활성)·정의 목록 즉시 반영
6. **공식 오류 격리**: 일부러 공식 JSON을 깨서 1건만 실패하고 나머지는 적용되는지
7. **AI 키 동작**: 실제 Gemini 호출로 후보 추출되는지 / 일시 실패 시 "+ 신규 등록" 폴백 안내 토스트
8. **회귀**: 기존 정의 탭 로드·신규 등록·수정·비활성 토글·역할 드롭다운·다른 탭(분기·역할·비매출 검토) 정상
