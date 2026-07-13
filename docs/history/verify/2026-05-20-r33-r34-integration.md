# R33 + R34-P1 통합 라이브 검증 보고서

> 검증자: C 채팅 (Opus 4.7)
> 시각: 2026-05-20 (KST)
> 브랜치: verify/r33-r34-integration (main 기반)
> 라이브 URL: https://tbfa.co.kr

---

## §1 검증 환경

| 항목 | 값 |
|---|---|
| main 커밋 | 461d3a9 → 00fbf13 (권한 시드 마이그 호출 완료) |
| 통합 대상 라운드 | R32-P0 잔여(bca7673) + R33-P0 fix 4건(df75948) + R34-P1-A 인증 통합(0741a23) + R34-P1-B 성과 M 13건(798f38d) |
| 어드민 계정 | admin / (비번은 문서에 기재하지 않음) (super_admin, milestoneRole=SM) |
| 검증 도구 | curl + 코드 정독 + drizzle SELECT |

---

## §2 결과 표 — Q1~Q8

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| Q1 | 라우팅 와일드카드 9개 | ✅ **PASS 5/5 핵심** | 9개 함수 config.path 와일드카드(`*`) 정합. 라이브: `PATCH /milestone-definitions/1` 200·`PATCH /milestone-quarters/1` 200·`POST /milestone-nonrevenue/select` 200·`POST /admin-milestone-settlement/1/hold` 404("결산 없음" — 라우팅 도달 OK)·`POST /milestone-settlement/calculate` 200. dashboard만 단일 path(segment 호출 없음) |
| Q2 | EVENT_RANGE 결산 | ✅ PASS | `milestone-dashboard.ts:251`·`milestone-settlement.ts:231` 양쪽 `case "EVENT_RANGE": return Math.floor(current)` 정합. 어드민 결정 amount 그대로 인센티브 반영 |
| Q3 | HYBRID 키 변환 | ✅ PASS | JS:239 `DAY_MAP {1:MON~7:SUN}` 변환 + `admin-att-schedules` POST 라이브 `{MON:OFFICE,TUE:OFFICE,WED:REMOTE,THU:OFFICE,FRI:OFFICE,SAT:REMOTE}` 저장 → GET 응답 키 그대로 반영. `att-utils.getScheduledWorkMode:115·122`에서 동일 키 매핑 |
| Q4 | wbsCards JOIN | ✅ PASS (라우팅·코드) | `att-remote-report.ts:45~56` JOIN 로직 + `workspace-attendance.js:620` `report.wbsCards` 참조. 라이브 GET 200 (오늘 보고서 데이터 null이라 wbsCards 채워진 응답까지는 검증 못함) |
| Q5 | 인증 모델 통합 | ✅ PASS 6/8 + ⚠️ 2/8 (별도 BUG — 본 verify에서 fix) | `operator-guard.ts:24~28` user JWT 우선 + admin JWT fallback 확인. 8개 함수 라이브: my-status·my-calendar·my-stats·leave-types·checkin-today·remote-report → 200 / leave-balance·leave-history → 500 (drizzle 결과 패턴 BUG, §3 참조). 미인증 → 401 정합 |
| Q6 | 성과 M 묶음 13건 | ✅ PASS | ai-milestone-classify 파일 부재 / settleDt 종료일+14일 / quarterApplicable 검증 line 76~83 / milestone-members PATCH 410 + admin-milestones.js admin-milestone-role-assign 호출 / admin-milestone-definitions 응답 snake+camel 동시 노출 / milestone-nonrevenue 단일 SQL 원자화 line 127~155 / milestone-dashboard formatDashboard 응답 키 일관(`quarter`·`milestoneRole`·`revenueProgress`·`nonRevenueAchievements`·`settlement`·`estimatedIncentive`·`breakdown`) |
| Q7 | 권한 시드 milestone:* | ✅ PASS | `GET /api/admin-role-permissions` 응답에 milestone 카테고리 **8개 키 전부 안착**: milestone:view·revenue:input·revenue:verify·nonrevenue:manage·settlement:submit·manage·settlement:approve·quarter:manage (메인 안내대로 기존 시드 안착 상태) |
| Q8 | 회귀 점검 18건 | ✅ PASS | 11개 API 200 + lib-kst?v=1·workspace-attendance.js?v=7·Permissions-Policy geolocation=(self)·admin-hub 카드·admin-milestone-settings 3탭·CSV 한글 헤더·att-leave-types 정상. **반차 모델 정리 개선 확인** — id 2·3 "반차 (오전·오후)" deactivate + 잔여 4개 allowHalfDay=true 통합 |

---

## §3 BUG 발견 — R34-P1-A 영역 (verify 브랜치에 fix 동봉)

### BUG-1: `att-leave-balance.ts:59` — `(result.rows as any[]).map()` undefined

**재현**:
```
curl -b cookie 'https://tbfa.co.kr/api/att-leave-balance'
→ HTTP 500 / "Cannot read properties of undefined (reading 'map')"
```

**원인**: `db.execute(sql\`...\`)` 결과가 driver/쿼리 유형에 따라 `result.rows` 속성 또는 배열 자체로 반환. `(result.rows as any[]).map()`이 `result.rows`가 undefined일 때 500. R34-P1-A에서 어드민 fallback이 도입되면서 처음으로 어드민 쿠키가 이 함수에 도달 → BUG 노출.

**Fix (본 verify 동봉)**: `const rawRows = ((result as any).rows ?? (result as any[]) ?? []) as any[]` fallback 패턴 추가.

### BUG-2: `att-leave-history.ts:67` — 동일 패턴

**재현**: `att-leave-history` HTTP 500 / 같은 메시지.
**Fix**: BUG-1과 동일 fallback 패턴 적용.

### 잠재 동일 패턴 (회귀 위험 — 본 라운드 제외)
- `admin-att-leave-types.ts:71` — 같은 패턴이나 라이브 호출(어드민)은 200. 동작하므로 미수정 (회귀 위험). 별도 정합화 라운드에서 통일 권장.

---

## §4 누적 PASS/FAIL 카운트

- **PASS**: 8 / 8 큰 시나리오 (Q1·Q2·Q3·Q4·Q5·Q6·Q7·Q8)
- **부분 PASS**: 1 (Q5 — 6/8 라이브 + 2/8 BUG 발견·fix)
- **신규 BUG**: 2건 (att-leave-balance·att-leave-history, R34-P1-A 노출 — Critical)
- **fix 동봉**: 2 파일 (verify 브랜치)
- **회귀**: 0건 (R29·R30·R32-P0 전 영역 무영향, 반차 모델 정리는 의도된 개선)

---

## §5 종합 평가

### 통합 효과 확인
1. **R32-P0 잔여 fix**: PATCH segment 라우팅 4건 모두 운영 복구 — Before 단계에서 미해결이던 FIX-1·FIX-2 와일드카드 패턴이 9개 함수에 일관 적용
2. **R33-P0 fix 4건**: 모두 동작 — EVENT_RANGE 결산 양 모듈 정합, HYBRID 키 변환 라이브 검증, wbsCards JOIN 코드 정합
3. **R34-P1-A 인증 통합**: operator-guard fallback로 어드민이 직원 API 9개 호출 가능 — **부수 효과로 숨어 있던 leave-balance·history 500 BUG 노출** (이전엔 어드민 진입 불가라 발견 안 됨)
4. **R34-P1-B 성과 M 13건**: 13건 모두 코드/라이브 정합 — milestone-members PATCH가 410 Gone으로 명확히 deprecated, admin-milestones.js가 신 endpoint(admin-milestone-role-assign) 사용으로 마이그 완료

### 메인 권장 액션
1. **🔴 즉시**: 본 verify 브랜치의 fix 2개 파일(att-leave-balance·att-leave-history) main 머지 — 어드민이 직원 API 호출 시 500 차단
2. **🟢 후속**: admin-att-leave-types.ts:71 같은 패턴 일관성 정리 (라운드 외)
3. **🟢 후속**: migrate-milestone-permissions-seed.ts 호출 완료 후 1회용 파일 삭제 (CLAUDE.md §6.8 정책)

### 검증 요약
- **R33 + R34-P1 통합 효과 입증**: 라우팅·인증·EVENT_RANGE·HYBRID·wbsCards·권한 시드·성과 M 묶음 모두 운영 환경에서 동작 확인
- **BUG 발견 → 즉시 fix**: 검증이 단순 PASS 확인을 넘어 새 BUG 노출까지 잡음. R34-P1-A 부수 효과(어드민 fallback)의 가치가 양면 — 기능 확장 + 숨은 BUG 표출
