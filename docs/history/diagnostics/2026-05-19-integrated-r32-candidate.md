# R32 후보 — 3진단 통합 BUG·갭 카탈로그 (2026-05-19)

> **출처**:
> - 메인 진단 [docs/diagnostics/2026-05-19-flow-integrity.md](2026-05-19-flow-integrity.md) (코드 무결성 시각)
> - A 갭 [docs/gap/2026-05-19-round2-att.md](../gap/2026-05-19-round2-att.md) (Phase 26·27 명세 vs 코드)
> - B 갭 [docs/gap/2026-05-19-round2-ms.md](../gap/2026-05-19-round2-ms.md) (Phase 24·28 명세 vs 코드)
>
> **시점**: main @ 9663c9a (R29·R30 + R31 갭 보고서 안착 직후)
> **신규 발견 Critical 6건** — R29-P2-C에서 누락된 sql.raw 패턴 동일 BUG 3건 + 데이터/계약 결함 3건

---

## §1. 🔴 Critical (즉시 운영 영향 — R32-P1 강력 권장)

| # | 영역 | 문제 | 위치 | 재현 | 권장 fix | 출처 |
|---|---|---|---|---|---|---|
| **C1** | 성과 사용자 | **비매출 2개 선택 시 VERIFIED 검증 깨짐** — sql.raw 파라미터 미바인딩 (R29-P2-C와 동일 BUG 패턴) | `milestone-nonrevenue.ts:117-120` | 어드민이 비매출 2개 선택 → 500 또는 검증 우회 (PENDING/REJECTED도 선택 가능) | sql 템플릿 + inArray 사용 | B H4 |
| **C2** | 성과 설정 | **분기 상태 수동 전환 깨짐** — UPCOMING→ACTIVE·ENDED 수동 호출 불능 | `milestone-quarters.ts:70` 동일 sql.raw 패턴 | admin-milestones.js의 activateQuarter·endQuarter 클릭 → 500 또는 placeholder 미치환 | sql 템플릿 합성 | B H3 |
| **C3** | 성과 설정 | **마일스톤 정의 PATCH 깨짐** — 정의 수정 호출 시 동작 안 됨 | `milestone-definitions.ts:104` 동일 sql.raw 패턴 | 어드민이 정의 모달 수정·저장 → 500 또는 변경 미적용 | sql 템플릿 합성 또는 drizzle update().set() | B H2 |
| **C4** | 성과 설정 | **CSV 급여 export 500 에러** — DB에 `members.base_salary` 컬럼 자체 없음 | `admin-milestone-settlement-export.ts:36` SELECT m.base_salary | 슈퍼어드민 [📥 급여 내보내기] 클릭 → `column m.base_salary does not exist` 500 | 옵션 A: 컬럼 마이그 추가 / B: SELECT 제거 + "기본연봉"=0 | B H1 |
| **C5** | 근태 설정 | **직원 스케줄 저장·조회 404** — `/api/admin-att-member-schedule` 백엔드 함수 부재 + body 키 명세 불일치 | `admin-workspace-management.js:250,265` | 스케줄 탭 → 저장 → 404 | 경로 → `/api/admin-att-schedules` + body 키 정합 | A H1·메인 H1 |
| **C6** | 근태 설정 | **근무 정책 변경 무효** — JS body 키와 서버 키 완전 불일치로 변경 사항 실제 적용 0 | `admin-workspace-management.js:474-514` ↔ `admin-att-policy.ts` | 정책 모달 값 변경·저장 → 모든 키 undefined → 서버 fallback으로 기존값 유지 | JS body 키를 명세 §1.2 컬럼명으로 정정 + 누락 폼 항목 추가 | A H2 |

---

## §2. 🟠 High (운영 영향 큼 — R32-P1 또는 P2)

| # | 영역 | 문제 | 출처 |
|---|---|---|---|
| **H7** | 성과 설정 | 분기 추가 시 결산 row 자동 생성 부재 (신규 분기 운영 불가) | 메인 H2 |
| **H8** | 성과 설정 | 역할 변경 시 진행 중 entry 소유권 미처리 (임계점 알림 누락) | 메인 H3 |
| **H9** | 근태 직원 | 직원 그룹 API 8개 가드 명세 위반 (`att-my-calendar`·`att-my-stats`·`att-remote-report`·`att-ai-draft`·`att-leave-balance`·`att-leave-history`·`att-leave-types`·`att-checkin-today`) | A H4 |
| **H10** | 근태 직원 | 수정 요청 옛 amend API 의존 — `workspace-attendance.js:556,579`가 여전히 `att-amend-*` 호출 (correction 마이그 안 됨) | A H3 |
| **H11** | 성과 사용자 | EVENT_RANGE 단위 일관성 부재 (UI "만원" vs DB·서버 단위 불명확 — 시드 데이터에 따라 자릿수 폭증 또는 50만원이 50원으로 결산) | B H5·메인 M10 |

---

## §3. 🟡 Medium (로직 결함·일관성)

| # | 영역 | 문제 | 출처 |
|---|---|---|---|
| M1 | 성과 사용자 | HOLD 상태 사용자 재제출 차단 | 메인 |
| M2 | 성과 사용자 | 비매출 2개 선택 동시성 race | 메인 |
| M3 | 성과 사용자 | milestone-dashboard 응답 키 매핑 미정의 | 메인 |
| M4 | 근태 설정 | 거점 삭제 시 스케줄 FK dangling | 메인 |
| M5 | 근태 설정 | 정책 변경 시 진행 중 기록 재판정 없음 | 메인 |
| M6 | 근태 설정 | 동시 결재 트랜잭션 부재 | 메인 |
| M7 | 성과 설정 | 역할 배정 API 이원화 (admin-milestone-role-assign vs milestone-members) | 메인·B |
| M8 | 성과 설정 | 정의 API 응답 키 snake/camel 혼용 | 메인·B |
| M9 | 성과 설정 | 분기 상태 전이 cron vs 수동 race | 메인 |
| M10 | 성과 설정 | active 편집 UI 부재 (정의 모달) | 메인 |
| M11 | 근태 직원 | 캘린더 API records vs rows·leaveTypeId vs typeName | 메인·A |
| M12 | 근태 어드민 | createdBy NULL 저장 (`member.uid` 미존재 컬럼 참조) | A M1 |
| M13 | 근태 어드민 | 근태 현황 work_mode별 집계 부재 (외근·출장 표시 불가) | A M2 |
| M14 | 근태 어드민 | 휴가 종류 UI에 명세 미존재 `carryover` 필드 | A M4 |
| M15 | 근태 어드민 | 직원 스케줄 폼 — FIELD·BUSINESS_TRIP 옵션 누락·요일 5일만·workplace_id 미표시 | A M5 |
| M16 | 근태 어드민 | 스케줄 표 `[object Object]` 표시 | A M7 |
| M17 | 근태 어드민 | 근무형태 편집 시 기존 설정 prefill 안 됨 | A M8 |
| M18 | 근태 직원 | att-export 다른 직원 데이터 권한 격리 부재 | A M9 |
| M19 | 근태 어드민 | 알림 actionUrl 분기 부재 (미퇴근·52h 알림이 재택 페이지로) | A M10 |
| M20 | 성과 어드민 | CSV roleLabel lowercase 키 미스매치 (직책 라벨 누락) | B M1 |
| M21 | 성과 어드민 | AI 함수 이원화 (`ai-milestone-classify`/`insight` vs `ms-ai-classify`/`coaching`) | B M2·메인 |
| M22 | 성과 설정 | EVENT_RANGE 결정 UI 위치 — admin-milestone-settings에 없고 workspace에 있음 | B M3 |
| M23 | 성과 권한 | milestone:* 권한 시드 8개 등록 안 됨 | B M4 |
| M24 | 성과 설정 | settlementDate 자동 계산 종료+30일 (명세 안내 10~14일) | B M5 |
| M25 | 성과 사용자 | quarterApplicable 검증 부재 (Q1 한정 마일스톤을 Q2에 사용 가능) | B M6 |
| M26 | 성과 설정 | admin-milestone-settlement HOLD 분기 setClauses sql.raw 패턴 (SQL injection 표면) | B M7 |

---

## §4. 🟢 Low (안전성·로깅)

L1~L8 (메인 진단 §4) + 부분 구현(A 5건·B 3건) 묶음 처리.

---

## §5. R32 라운드 분할 추천

### R32-P0 즉시 핫픽스 (Critical 6건 — 1~2일)
A·B 동시 발사·반나절 분량씩.

**A 채팅 (근태 핫픽스 2건)**:
- C5 직원 스케줄 API 경로·body 키 정합 (`admin-workspace-management.js`)
- C6 근무 정책 키 정합 (`admin-workspace-management.js` + HTML 폼 + admin-att-policy.ts 응답 키)

**B 채팅 (성과 핫픽스 4건)**:
- C1 milestone-nonrevenue/select sql 템플릿 정정
- C2 milestone-quarters PATCH sql 템플릿 정정
- C3 milestone-definitions PATCH sql 템플릿 정정
- C4 base_salary 마이그 또는 SELECT 제거 (Swain 결정: 컬럼 추가 vs 컬럼 제거)

### R32-P1 High 5건 + Medium 핵심 (1~2일)
- 분기 결산 row 자동 생성·역할 변경 entry 소유권·직원 API 가드·amend 마이그·EVENT_RANGE 단위

### R32-P2 Medium 묶음 + Low (정리 라운드)
- M1~M26 분류·우선순위 재정렬 후 일괄

---

## §6. 메인 의견

1. **C4 base_salary는 Swain 결정 필요** — 컬럼 추가(운영 가치 있음·기본연봉 운영 시작 의도)? vs SELECT 제거(아직 운영 미적용)?
2. **C1·C2·C3은 즉시 fix 가능** — R29-P2-C에서 7개 함수 fix할 때 3개 누락된 동일 패턴. 같은 fix를 다시 적용
3. **R31 갭 분석은 R29 이후 명세 vs 코드 격차를 매우 잘 잡아냄** — 라운드 가치 입증. 다음에도 반복 권장
4. **메인 진단(코드 무결성)은 명세 비교 안 하는 시각이라 발견 패턴이 다름** — 두 시각 통합이 효과적
5. R32-P0 즉시 발사하면 1일 내 Critical 6건 마감 가능. 그 후 P1·P2는 일정·우선순위 합의 후
