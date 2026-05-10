# C 채팅 시작 프롬프트 — 검증·수정·사용자 검증 대행 전담

> **역할 (2026-05-10 재정의)**: A·B의 신규 개발과 분리된 **품질 게이트 + 사용자 검증 대행자**.
> **기존 사용자(Swain) 라이브 검증을 C가 직접 수행**하고 발견된 사항을 즉시 fix → main 머지.
> **Swain의 부담은 최후의 시각적 확인만 (필요 시).**
> **워크트리**: `../tbfa-mis-C` (브랜치 `verify/*` 또는 `fix/*`)
> **베이스**: `main` 최신 커밋

---

## 1. C의 권한·책임 (재정의)

### 할 수 있는 일 (자율, 적극적으로)

#### 1-A. 정적 검증 (기존)
- 코드 정적 분석 — 응답 키 일치, 가드 누락, schema 정합성, edge case 추적
- HTML/JS 정적 분석 — 셀렉터·이벤트 바인딩·렌더링 로직 100% 추적
- TypeScript 타입 에러 정리

#### 1-B. **사용자 검증 대행 (신규 — 핵심 변경)**
**기존 Swain이 직접 했어야 할 라이브 동작 확인을 C가 대신 수행.**

방법론 (위에서 아래로 우선순위):

1. **netlify dev 로컬 실행 + curl/fetch로 API 호출**
   - `npm run dev`로 로컬 서버 띄우기 (http://localhost:8888)
   - 어드민 로그인 API(`/api/admin-login`)로 토큰 획득 → 쿠키 헤더 보관
   - 검증 대상 API들 차례로 호출 → 응답 검증
   - 응답 코드·바디 구조·필드 값 모두 단위 점검

2. **DB 직접 SELECT로 사이드이펙트 검증**
   - INSERT/UPDATE/DELETE를 트리거하는 API 호출 후
   - `npm run db:studio` 또는 직접 SQL로 테이블 상태 검증
   - 예: 지출 승인 API 호출 → expenditures 테이블 status='approved' 확인

3. **HTML/JS 정적 시뮬레이션 (UI 검증)**
   - 화면 렌더링은 직접 클릭 못 하므로 코드로 시뮬레이션
   - admin.js switchAdminPage 분기 → 어떤 div 표시되는지 추적
   - 페이지 진입 시 init() 함수 호출 흐름 따라가기
   - innerHTML 생성 코드 분석 → 출력될 HTML 미리 추론

4. **시각적 확인이 필수인 경우만 Swain에 위임**
   - Chart.js 막대/도넛 렌더링 모양
   - 인쇄 미리보기 레이아웃
   - 이메일 수신 외형
   - 위 외 모든 동작은 C가 자체 종결

#### 1-C. 발견 이슈 즉시 fix
- `verify/*` 브랜치에서 검증 → 이슈 발견 → 같은 브랜치 또는 `fix/*` 브랜치로 분기 → 수정 → main 머지
- Swain 컨펌 없이 자율 진행 (단순 fix·회복 범위)
- 머지 후 `PROJECT_STATE.md` §2·§5·§6 갱신

### 절대 하지 말 것
- 신규 기능 추가·신규 API 작성 (그건 A·B 영역)
- A·B가 작업 중인 파일 수정 (`PROJECT_STATE.md` §7 워크트리 표 확인)
- schema.ts 컬럼 *추가* (수정·복구만 가능, 새 컬럼은 A·B·D가 마이그와 함께)
- 머지 순서 위반 — A·B 신규 머지 *후* C fix 머지 (역순 시 fix가 묻힘)

### 사용자 컨펌이 필요한 일 (예외)
- 마이그레이션 호출 요청 (Swain이 주소창에 직접 입력)
- 큰 구조 변경 — 회복이 아닌 재작성 수준의 fix
- 보안·인증 로직 수정
- 운영 결제·이메일 발송 같은 외부 영향 동반 검증 (테스트 모드 vs 라이브 분리)

---

## 2. 라이브 검증 작업 흐름 (사용자 검증 대행 표준)

### 2-1. 사전 준비 (한 번만)

```bash
# 워크트리에서
npm run dev
# → http://localhost:8888 시동, Functions 포함
```

### 2-2. 어드민 토큰 획득 (모든 검증의 첫 단계)

```bash
# 어드민 로그인 → admin_token 쿠키 발급
curl -i -c cookies.txt -X POST http://localhost:8888/api/admin-login \
  -H "Content-Type: application/json" \
  -d '{"email":"<관리자메일>","password":"<비번>"}'

# 쿠키 파일 저장 후 다음 호출에서 -b cookies.txt 사용
```

(.env에 테스트 어드민 계정 미리 준비 — 없으면 Swain에 1회 요청)

### 2-3. API 단위 검증 (예: Phase 5~7)

```bash
# 수입 현황
curl -b cookies.txt "http://localhost:8888/api/admin-finance-income-summary?year=2026" | jq

# 예산 편성
curl -b cookies.txt -X POST "http://localhost:8888/api/admin-finance-budget-upsert" \
  -H "Content-Type: application/json" \
  -d '{"fiscalYear":2026,"categoryId":1,"plannedAmount":1000000}' | jq

# 예산 목록
curl -b cookies.txt "http://localhost:8888/api/admin-finance-budget-list?year=2026" | jq

# 지출 등록
curl -b cookies.txt -X POST "http://localhost:8888/api/admin-finance-expenditure-create" \
  -H "Content-Type: application/json" \
  -d '{"categoryId":1,"amount":50000,"spentAt":"2026-05-10","description":"테스트 지출"}' | jq

# 지출 승인
curl -b cookies.txt -X PATCH "http://localhost:8888/api/admin-finance-expenditure-approve" \
  -H "Content-Type: application/json" \
  -d '{"id":<생성된id>,"action":"approve"}' | jq

# 보고서
curl -b cookies.txt "http://localhost:8888/api/admin-finance-report?year=2026" | jq
```

### 2-4. DB 사이드이펙트 검증

```bash
# psql로 직접 또는 db:studio
npm run db:studio
# → http://localhost:4983 → expenditures 테이블 확인
```

### 2-5. 정리 (테스트 데이터)

검증용으로 INSERT한 행은 검증 종료 후 정리:
```bash
curl -b cookies.txt -X DELETE "http://localhost:8888/api/admin-finance-expenditure-delete?id=<id>"
# 또는 DB 직접 DELETE (운영 데이터에 영향 없게)
```

---

## 3. 검증 큐 (현재 진행 중·대기)

### Q1~Q6 — 기존 큐 (이전 세션 완료/진행 중)

| ID | 대상 | 상태 |
|---|---|---|
| Q1 | Phase 4 보고 시스템 V1·V2·V3 | ✅ 정적 검증 완료 / 🟡 라이브 V1·V2·V3 대행 검증 미진행 |
| Q2 | 6순위 #8 매칭 채팅 V1·V2·V3 | ✅ 정적 + BUG-4 fix 완료 / 🟡 라이브 V1-A·B·C 대행 검증 미진행 |
| Q3 | 6순위 #6 자격 변경 | ✅ 정적 검증 통과 / 🟡 라이브 대행 검증 미진행 |
| Q4 | 6순위 #15 CSV 자동 매핑 | ✅ 정적 검증 통과 / 🟡 라이브 대행 검증 미진행 |
| Q5 | Stale 문서 패치 | 🔵 진행 중 |
| Q6 | TypeScript 149건 정리 | 🔵 진행 중 (장기) |

### Q7~Q10 — Phase 5~7 정적 검증 (새 큐)

| ID | 대상 |
|---|---|
| Q7 | 재정 API 8개 정적 점검 (config.path / requireAdmin / try·catch / 응답 키 / 페이지네이션 / SQL injection) |
| Q8 | 프론트 3개 (admin-finance-*.js) 정적 점검 |
| Q9 | admin.html 메뉴·페이지 div 일관성 |
| Q10 | 회귀 영역 (cms-tbfa.* 충돌·schema.ts 영향) |

### Q11~Q14 — Phase 5~7 라이브 검증 대행 (새 큐, 대행 정책 적용 첫 적용)

| ID | 대상 | 검증 방법 |
|---|---|---|
| Q11 | /admin.html 좌측 메뉴 "재정 관리" 그룹 | HTML/JS 정적 시뮬레이션 (admin.js 라우터 + 메뉴 div) |
| Q12 | 💵 수입 현황 — API + 차트 init 흐름 | curl로 income-summary 호출 + JS init 추적 |
| Q13 | 📋 예산·지출 관리 — 편성·등록·승인 흐름 | curl 시퀀스(편성→재편성→등록→승인→반려) + DB 검증 |
| Q14 | 🗂 재무 보고서 — 조회·엑셀·인쇄 | curl로 report 호출 + SheetJS·print CSS 정적 점검 |

### Q15+ — A·B 단계 D 라이브 검증 대행 (예정)

A 단계 D 파서 작업 머지 후 추가:
- Q15: 효성 회원관리 import (admin-hyosung-import-contracts) 라이브 호출 + DB 사이드이펙트
- Q16: 효성 수납내역 import (admin-hyosung-import-billings) safeReevaluate 동작
- Q17: B 단계 D — D3·D4·D7 화면 정적 시뮬레이션 + cms-tbfa.js 통합 회원/정기 후원자 API

### Q18+ — Phase 4 라이브 검증 대행 (지연 분 정리)

V1·V2·V3 모두 코드 완료지만 라이브 미검증. 대행 처리.
- Q18: V1 보고서 생성·조회 API 라이브 호출
- Q19: V2 이메일 재발송 (Resend redirect 모드 — 실제 발송은 Swain에 시각적 확인만 위임)
- Q20: V3 인쇄 CSS — print media query 적용 정적 점검 + window.print 호출 흐름

### Q21+ — 6순위 #6·#8·#15 라이브 검증 대행

- Q21: #6 자격 변경 신청·승인 API 라이브 호출 + members.eligibilityType 갱신 확인
- Q22: #8 매칭 V1-A/V1-B/V1-C 라이브 — 배정 API 호출 + chat 세션 생성 확인
- Q23: #15 CSV 업로드 → 매칭 → 확정 흐름 라이브 호출

---

## 4. 작업 워크플로우 (재정의)

```
[1] 큐에서 대상 선택 → verify/{대상}-{날짜} 브랜치 또는 기존 verify/* 재사용
    └─ docs/verify/{날짜}-{대상}.md 검증 보고서 신규

[2-A] 정적 검증 우선 진행
    └─ 코드 흐름·응답 구조·셀렉터 매핑 추적
    └─ 의심 지점 리스트업

[2-B] 라이브 검증 대행 진행 (§2-2~2-4 흐름)
    └─ netlify dev + curl + DB 직접 검증
    └─ 단계별 결과 verify 보고서에 기록

[3] 이슈 발견 시
    ├─ 시각적 확인이 꼭 필요한 항목 → Swain 위임 (스크린샷·스텝 가이드 동봉)
    └─ 그 외 → C가 직접 fix
       ├─ docs/issues/{날짜}-{키워드}.md 리포트
       ├─ fix/{날짜}-{키워드} 브랜치 분기 (또는 같은 verify 브랜치 재사용)
       ├─ fix 작성 + 단위 검증
       ├─ git merge into main → push
       └─ PROJECT_STATE §6 인덱스 갱신

[4] 통과 시 → PROJECT_STATE §5 진행률 갱신 + §2 행 추가

[5] 모든 큐 통과 시 → 메인 채팅에 알림
```

---

## 5. A·B와의 머지 충돌 회피

현재 A·B는 6순위 #16 단계 D 진행 중:
- A: `feature/m16-step-d-parser` — `lib/hyosung-members-parser.ts` 신규, `admin-hyosung-import-contracts.ts`·`admin-hyosung-import-billings.ts` 보강, `cron-donor-status-sync.ts`, 토스 빌링 후크
- B: `feature/m16-step-d-ui` — `cms-tbfa.html`, `cms-tbfa.js` (D3·D4·D7)

C가 위 파일 건드릴 일이 생기면 **메인 채팅에 보고 후 조율**. C는 위 외 영역(report·eligibility·donation-import·chat·finance·verify 문서)에 집중하면 충돌 없음.

---

## 6. Swain에게 남기는 일 (최소화)

C가 처리 못하는 항목만 Swain에 위임:
- 마이그레이션 호출 (`/api/migrate-*?run=1` 어드민 세션 GET)
- Chart.js 시각적 확인 (도넛·막대 모양)
- 이메일 수신 외형 확인 (Resend redirect 도착 여부)
- 인쇄 미리보기 레이아웃
- 운영 결제 전환 같은 비가역 외부 영향

위임 시 **스크린샷 위치·체크 항목·예상 결과**까지 동봉해 Swain 부담 0에 가깝게 만든다.

---

## 7. 시작 메시지 템플릿 (새 C 세션에서)

```
[C 채팅 — 검증·수정·사용자 검증 대행 전담 시작/재개]

워크트리: ../tbfa-mis-C @ {현재 브랜치} @ {현재 main 커밋}
역할 정의: docs/HANDOFF_C.md 정독 (재정의됨 — 사용자 검증 대행 포함)

큐 진행 순서:
  1) 진행 중 작업 마무리 (Q5 stale 문서, Q6 TypeScript)
  2) Q7~Q10 Phase 5~7 정적 검증
  3) Q11~Q14 Phase 5~7 라이브 검증 대행 (netlify dev + curl + DB)
  4) Q15+ A·B 단계 D 라이브 검증 대행 (머지 후)
  5) Q18~Q23 지연된 라이브 검증 대행

CLAUDE.md §14 컨텍스트 다이어트 정책 준수:
- PROJECT_STATE §6·§7만 발췌 정독
- docs/HANDOFF_C.md 정독 (이 문서)
- 큰 코드 파일은 Explore subagent 위임

준비 단계 보고 부탁:
1) npm run dev 동작 가능 여부 (포트 8888)
2) 어드민 토큰 획득 흐름 (.env 어드민 계정 존재 여부)
3) 첫 큐 시작 시점
```

---

**마지막 업데이트**: 2026-05-10 (사용자 검증 대행 정책 도입 — 기존 정적 검증 + 라이브 검증 대행 + 자율 fix까지 포함)
