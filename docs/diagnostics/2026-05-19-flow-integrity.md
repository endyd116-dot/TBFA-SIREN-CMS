# 근태·성과 4영역 워크플로우·로직 무결성 진단 (2026-05-19)

> 조사: 메인 채팅 (Opus 4.7) — Explore agent 4개 병렬 정독 후 통합
> 시각: R29-GAP P1·P2·BUG fix·R30·OP-1·OP-2 머지 완료 후
> 시각 차이: A·B의 R31 갭 분석은 **명세 vs 코드** / 본 진단은 **코드 자체 무결성**
> 대상: 근태관리(직원) · 성과관리(사용자) · 근태관리 설정(어드민) · 성과관리 설정(어드민)
> 검증 후 false positive 4건 제외

---

## §1. 종합 진단

**현 상태**: R29 시리즈 직후 핵심 워크플로우는 대체로 동작하나, **흐름 끊김 4건·로직 결함 6건·일관성 격차 8건**이 남아 있음. 신규 라인업(거점 추가·역할 배정·분기 추가)에서 데이터 연쇄 누락이 큰 영향을 주는 패턴이 다수.

**4영역 무결성 점수** (참고치): 근태 직원 78 / 성과 사용자 70 / 근태 설정 72 / 성과 설정 70 / 100

---

## §2. 🔴 H 우선순위 (핵심 흐름 단절·즉시 운영 영향)

| # | 영역 | 문제 | 위치 | 재현 | 권장 fix |
|---|---|---|---|---|---|
| H1 | 근태 설정 | 직원 스케줄 저장 백엔드 부재 | 프론트 `/api/admin-att-member-schedule` POST/GET 호출 / 백엔드 함수 0건 | 직원 스케줄 탭 → 저장 → 404 | 백엔드 함수 신설 또는 프론트가 기존 admin-att-schedules로 정합 |
| H2 | 성과 설정 | 분기 추가 시 결산 row 자동 생성 부재 | 분기 INSERT 후 quarterly_settlements DRAFT 자동 생성 없음 | 신규 분기 등록 → 결산 검토 화면에 행 없음 | 분기 POST 성공 후 milestone_role 보유 회원 전수 DRAFT INSERT 트리거 추가 |
| H3 | 성과 설정 | 역할 변경 시 진행 중 entry 소유권 미처리 | admin-milestone-role-assign PUT — milestone_role 변경 후 기존 revenue_entries 소유권 그대로 | 운영자 역할 SM→PM 변경 → 임계점 알림 그룹에서 누락 | 역할 변경 시 진행 중 entry 목록 노출 + 재할당 확인 모달 |
| H4 | 근태 설정 | 휴가종류 비활성 시 신규 신청 차단 UI 미실행 | 직원 휴가신청 화면이 isActive=true만 필터링하는지 불명 | 옛 휴가종류 비활성 → 직원이 여전히 드롭다운에서 선택 가능 | workspace-attendance 휴가종류 fetch에 ?active=1 보장 |

---

## §3. 🟡 M 우선순위 (로직 결함·운영 효율)

| # | 영역 | 문제 | 위치·재현 | 권장 fix |
|---|---|---|---|---|
| M1 | 성과 사용자 | 사용자 결산 재제출에서 HOLD 상태 차단 | milestone-settlement.ts POST /submit이 DRAFT·REJECTED만 허용·HOLD 누락 | 허용 상태에 HOLD 추가 |
| M2 | 성과 사용자 | 비매출 2개 선택 동시성 race | 기존 선택 초기화 → 새 선택 UPDATE 분리 실행 → 동시 호출 시 3개 이상 가능 | CTE 단일 트랜잭션 또는 SELECT FOR UPDATE |
| M3 | 성과 사용자 | milestone-dashboard 응답 키 매핑 미정의 | workspace-milestones.js가 estimatedIncentive/revenueProgress 가정 / 백엔드 formatDashboard 부재 | formatDashboard() 헬퍼 추가로 응답 구조 표준화 |
| M4 | 근태 설정 | 거점 삭제 시 스케줄 FK 검증 없음 | admin-att-workplaces DELETE — att_schedules.workplaceId 참조 행 dangling | DELETE 전 사용 중 스케줄 COUNT 체크 또는 FK ON DELETE RESTRICT |
| M5 | 근태 설정 | 정책 변경 시 진행 중 기록 재판정 없음 | admin-att-policy PUT만 — att_records.status 재계산 안 함 | 옵션 플래그 또는 별도 재산정 cron |
| M6 | 근태 설정 | 동시 결재 트랜잭션 부재 | admin-att-leave-review APPROVED 시 잔여 차감 + att_records UPSERT 분리 실행 → 중간 실패 시 불일치 | db.transaction 래퍼 적용 |
| M7 | 성과 설정 | 역할 배정 API 이원화 | admin-milestone-role-assign vs milestone-members PATCH /:id/role — 두 endpoint·키 불일치 | 단일 endpoint 통합 + 다른 쪽 deprecated |
| M8 | 성과 설정 | 정의 API 응답 키 snake/camel 혼용 | admin-milestone-definitions snake_case·milestone-definitions camelCase | 양쪽 응답 camelCase 통일 + 클라이언트 fallback 유지 |
| M9 | 성과 설정 | 분기 상태 전이 race | cron-milestone-quarter UPCOMING→ACTIVE 자동 vs 어드민 수동 동시 실행 | SELECT FOR UPDATE 또는 status 검증 후 CAS UPDATE |
| M10 | 성과 설정 | EVENT_RANGE 단위 불명확 | bonusFormula.minAmount/maxAmount 단위 명시 부재 — 클라이언트 만원·서버 원 가능성 | bonusFormula 스키마 문서화 + 정규화 (원 단위 통일) |
| M11 | 성과 설정 | milestone_definitions is_active 편집 UI 부재 | admin-milestone-settings.html에 active 토글 없음 | 정의 모달에 active 토글 + PUT 동시 적용 |
| M12 | 근태 직원 | 캘린더 API 응답 필드 불일치 | att-my-calendar의 records vs UI rows 기대·att-leave-balance.leaveTypeId vs UI typeName | 응답 키 정합 또는 UI fallback |

---

## §4. 🟢 L 우선순위 (안전성·일관성·로깅)

| # | 영역 | 문제 | 권장 |
|---|---|---|---|
| L1 | 성과 설정 | HOLD 복귀 시 reviewed_at NOW() 초기화로 1차 검토 시점 손실 | resume 분기에서 reviewed_at UPDATE 제외 또는 hold_resumed_at 컬럼 추가 |
| L2 | 근태 직원 | 거점 조회 실패 catch{} 묵시적 폴백 (로깅 없음) | console.warn 추가 |
| L3 | 성과 사용자 | calcSettlement effective_from만 검증·effective_to 누락 | end_date 비교 추가 |
| L4 | 성과 사용자 | workspace-milestone-pending 분류 보류 카드 → 비매출 자동 달성 미구현 | POST 핸들러 신설 또는 정책 결정으로 미구현 명문화 |
| L5 | 성과 설정 | CSV export 급여 Math.round로 소수점 손실 | Math.floor 또는 toFixed(2) |
| L6 | 근태 직원 | 반차 att_records.status에 PARTIAL_LEAVE enum 미정의 (현재 LEAVE 그대로) | 정책 결정 후 enum 추가 또는 LEAVE 유지 |
| L7 | 근태 직원 | 캘린더 배경색 착색 dayCellDidMount 타이밍 이슈 가능성 | datesSet 완료 후 수동 적용 또는 eventBackgroundColor |
| L8 | 근태 직원 | 재택보고서 미제출 deadline 미구현 (다음날 출근 가능) | 옵션 정책 결정·deadline 강제 또는 안내만 |

---

## §5. 검증 후 False Positive 4건 (보고에서 제외)

- ~~휴가 승인 후 att_records 반영 누락~~ → `admin-att-leave-review.ts:184` LEAVE UPSERT 정상 동작
- ~~수정요청 승인 후 att_records 반영 누락~~ → `admin-att-correction-review.ts:70~` UPSERT 정상 동작
- ~~임계점 알림 그룹화 미구현~~ → R29-P2-B에서 추가됨 (`cron-milestone-quarter.ts:146`)
- ~~비매출 sql.raw 파라미터 미바인딩~~ → R29-P2-C BUG fix에서 정정됨 (`milestone-nonrevenue.ts:27` 주석)

---

## §6. 핵심 워크플로우 평가 (4영역 통합)

| 워크플로우 | 상태 | 비고 |
|---|---|---|
| 출퇴근 → 기록·판정·UI | ✅ | KST 통일·정책 적용 정상 |
| 휴가 신청 → 결재 → 잔여 차감·LEAVE UPSERT | ✅ | R29-P1 H2 fix 완료 |
| 수정요청 → 결재 → att_records 반영 | ✅ | R29-P1 H1 fix 완료 |
| 매출 입력 → 자동 분류 → 임계점 그룹 알림 | ✅ | R29-P2-B fix 완료 |
| 비매출 → 2개 선택 잠금 → 결산 자동계산 | 🟡 | 동시성 race·HOLD 재제출 차단 |
| 결산 SUBMITTED→APPROVED→PAID·HOLD 전이 | 🟡 | HOLD reviewed_at 초기화·dashboard 응답 키 부재 |
| 거점/정책/휴가종류 CRUD → 연쇄 영향 | 🟡 | FK 검증·재판정·is_active 필터 부재 |
| 분기 추가 → 결산 row 생성 → cron 전이 | 🔴 | 결산 row 자동 생성 없음·race 가능 |
| 직원 스케줄 저장 | 🔴 | 백엔드 함수 부재 (404) |
| 역할 변경 → 진행 중 entry 소유권 | 🔴 | 미처리 |

---

## §7. R32-FLOW-FIX 라운드 권장 분할 (메인 의견)

**P1 (H 4건 + Critical M 4건)** — 즉시 운영 영향
- A 채팅: H1 직원 스케줄 API + H4 휴가종류 비활성 필터 + M4 거점 FK 검증 + M5 정책 재판정 + M6 결재 트랜잭션 (근태 설정 5건)
- B 채팅: H2 분기 결산 자동 생성 + H3 역할 변경 entry 소유권 + M1 HOLD 재제출 + M2 비매출 동시성 + M3 dashboard 응답 키 (성과 5건)

**P2 (M 7~12 + L 일부)** — 일관성·표준화
- A: M12 API 응답 필드 + L7 캘린더 배경 + L8 재택 deadline + L2 거점 로깅 (근태 4건)
- B: M7 역할 API 통합 + M8 키 표준화 + M9 분기 race + M10 EVENT_RANGE 단위 + M11 active 편집 + L1 HOLD reviewed_at + L3 effective_to + L5 CSV Math (성과 8건)

**L 단독 처리** — L4·L6 (정책 결정 필요·메인이 Swain 의견 확인 후 fix 또는 정책 명문화)

---

## §8. 권장 다음 단계

1. **메인이 본 진단 결과를 Swain에게 보고** ← 현재
2. Swain 우선순위 결정 (P1 즉시 / 또는 R31 갭 분석 결과 도착 후 통합)
3. R31 갭 분석 결과(A·B) + 본 진단 통합 → R32 라운드 설계
4. R32-P1·P2 트리거 발사
