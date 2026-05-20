# 근태관리 연동 갭 수정 — 설계 (C 감사 확정분)

> 작성: 2026-05-20 / 메인
> 출처: C 채팅 근태 연동 정밀 감사 → 메인 코드 교차검증(높음 3건 + 라벨 2건 모두 확정)
> 범위(Swain 결정): **G1 결재 단절 + G2 통계 + G3 캘린더 + G4/G15 라벨** (높음 4트랙). 중간·낮음 나머지는 별도 트랙.
> 수정 주체(Swain 결정): **C 채팅에 트리거 위임**. 메인은 설계·머지·검증.

## §1 확정 갭 (메인 grep 교차검증 완료)

| 갭 | 증상(사용자 체감) | 원인 | 위치 |
|---|---|---|---|
| **G2** | 직원 통계(근무일·근무시간·지각·재택일) 전부 '—' | 서버는 `data.monthly.work_days`(snake·중첩) 반환, 화면은 `stats.workDays`(camel·최상위)로 읽음 | `att-my-stats.ts:79` ↔ `workspace-attendance.js:451-457` |
| **G3** | 캘린더 탭 항상 빈 화면 | 서버 `{year,month,records}` 래퍼인데 화면이 응답 전체를 배열로 기대 → `Array.isArray` 실패로 조기 종료 | `att-my-calendar.ts:52` ↔ `workspace-attendance.js:422-426` |
| **G4/G15** | 조퇴·공휴일 상태가 빈칸/영문 노출 | 라벨맵 키 누락 | `workspace-attendance.js:49-55`(MODE_LABEL HOLIDAY 없음)·`380-397`(EARLY_LEAVE 없음)·`admin-workspace-management.js:60`(EARLY_LEAVE 없음) |
| **G1** | 직원 근무형태 변경신청이 영구 '대기'에 멈춤 | 결재 API(목록 GET·결재 POST) 완성돼 있으나 **호출하는 어드민 화면 0건** | API `admin-att-workmode-change-review.ts`(존재) ↔ 어드민 화면 미연결 |

## §2 결재 API 계약 (이미 구현됨 — 프론트만 연결)

`/api/admin-att-workmode-change-review` (super_admin 전용)
- **GET** `?status=PENDING|APPROVED|REJECTED` → `{ ok, data: { requests: [{id, memberUid, memberName, memberEmail, targetMode, targetDate, reason, status, reviewedBy, reviewNote, submittedAt}] } }`
- **POST** body `{ requestId, action: "APPROVED"|"REJECTED", note? }` → 승인 시 `att_schedule_overrides`에 단발 재정의 UPSERT(자동). 반려는 상태만 변경.
- 신규 API 불필요. **휴가결재(`leaves`) 탭 패턴 그대로 복제**.

## §3 수정안 (모두 프론트 — 서버 무변경)

### G2 — 통계 매핑 (`workspace-attendance.js`)
- 서버 응답 실제 구조: `data.monthly = { work_days, total_working_mins, total_overtime_mins, late_count, early_leave_count, remote_days, field_days, business_trip_days }` + `data.weekly[]`.
- 화면 통계 4종을 `stats.monthly.*` snake_case로 매핑. 근무시간은 `total_working_mins/60` 계산. 근무형태 분포 차트도 `monthly`의 remote/field/business_trip/work 일수로 구성.

### G3 — 캘린더 (`workspace-attendance.js:422-426`)
- `res.data?.data?.records`(배열)를 꺼내 forEach. 상태 색상맵 정비(근무형태 키 REMOTE/FIELD는 상태가 아니므로 정리, 실제 상태 NORMAL/LATE/EARLY_LEAVE/ABSENT/LEAVE/HOLIDAY 기준).

### G4/G15 — 라벨 (`workspace-attendance.js` + `admin-workspace-management.js`)
- MODE_LABEL에 `HOLIDAY` 추가. 상태 라벨/색상맵에 `EARLY_LEAVE`(조퇴) 추가(양쪽 화면). 주말·공휴일 근무형태 배지 '미정' → 'HOLIDAY' 표기.

### G1 — 근무모드변경 결재 탭 신설 (`admin-workspace-management.html` + `.js`)
- HTML: 탭 버튼 `data-tab="workmodeChanges"` + 패널 `id="awmPanelWorkmodeChanges"`(대기 건수 배지 + 테이블). 휴가결재 패널 마크업 복제.
- JS: `initWorkmodeChangesTab()`(lazy `_awmWmcInit`) → `loadPendingWorkmodeChanges()`(GET status=PENDING → `res.data?.data?.requests` 렌더) → `awmApproveWorkmodeChange(id)`/`awmRejectWorkmodeChange(id)`(POST {requestId, action, note?} → 재로드). 탭 전환 분기에 등록.
- 목록 표시 필드: 신청자(이름·이메일)·희망일(targetDate)·요청 근무형태(targetMode 태그)·사유(reason)·신청일시(submittedAt) + 승인/반려 버튼.

### 캐시버스터
- `workspace-attendance.html`의 `workspace-attendance.js?v=` 및 `admin-workspace-management.html`의 `admin-workspace-management.js?v=`(현재 `13-r39s7`) 갱신.

## §4 제외(별도 트랙)
G5(어드민 직접 기록수정)·G6(반차 PARTIAL_LEAVE)·G7(캘린더 공휴일 합성)·G8(단발 재정의 직접등록 UI)·G9(CSV·AI 버튼)·G16(휴가 반려 잔여 복구)·G10~G14·G17.

## §5 검증 시나리오 (기능 위주)
- 직원 통계 탭: 출근 기록 있으면 근무일·근무시간·지각·재택일 숫자가 실제로 표시 + 근무형태 도넛이 그려짐.
- 직원 캘린더 탭: 그 달 근태가 날짜별 색상으로 보임. 조퇴·공휴일도 라벨/색 정상.
- 어드민: 직원이 근무형태 변경을 신청 → 어드민 결재 탭에 대기로 뜸 → 승인 시 해당 날짜 근무형태가 바뀌고(단발 재정의) 직원 화면에 반영, 반려 시 사유 기록.
- 어드민 기록·결재 목록에서 조퇴가 'EARLY_LEAVE' 영문이 아닌 한글로 표시.

## §6 갱신 이력
| 시각 | 변경 |
|---|---|
| 2026-05-20 | C 감사 수령·메인 교차검증·설계 작성·C 트리거 발행 |
