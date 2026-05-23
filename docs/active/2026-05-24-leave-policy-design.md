# 연차 산정 정책 기능 — 설계서 (다음 라운드)
> 2026-05-23 설계 / 운영 전 검수 P1-14에서 파생 / Swain 요구 확정
> 구현은 새 세션에서. 본 문서가 단일 설계 출처.

## §1 배경·목표
운영 전 검수에서 1주년 연차 일괄부여가 만근 보너스를 덮어쓰는 버그(P1-14) 발견 → 임시로 데이터손실만 막고(`cron-att-leave-auto` 모드A 가드) 정식 정책 기능을 분리. **슈퍼어드민이 연차 산정 방식을 선택·설정(CRUD)** 할 수 있게 한다.

## §2 요구사항 (Swain 확정 2026-05-23)
- **연차 산정 방식 = 택일(모드 A/B), 슈퍼어드민이 선택·편집**
- **모드 A (5인 이하)**: 월 만근 시 +1 유급휴가 (현재 협회 = 5인 이하 → **기본 모드 A**)
- **모드 B (5인 이상)**: 근속 기반 연차 — **기본 1주년 12일, 2년마다 +1일** (기준일수·증가일수·증가주기·상한을 CRUD)
- 두 모드는 동시 운영 아님(택일). 모드 B 파라미터는 편집 가능.

## §3 데이터 모델 (제안 — 구현 시 schema 정독 후 확정)
`att_policies`(기본 정책 단일행)에 연차정책 컬럼 추가 또는 신규 `att_leave_policy`(단일행 id=1):
```
leave_accrual_mode        varchar(1)  default 'A'   -- 'A'(만근) | 'B'(근속)
annual_base_days          numeric     default 12    -- 모드B: 1주년 기준 일수
annual_increment_days     numeric     default 1     -- 모드B: 증가 일수
annual_increment_years    integer     default 2     -- 모드B: 증가 주기(년)
annual_cap_days           numeric     default 25    -- 모드B: 상한
perfect_bonus_per_month   numeric     default 1     -- 모드A: 월 만근 보너스 일수
```
- ⚠️ 마이그레이션 = Swain 호출(§9.1.1 schema-DB 동기). 컬럼 추가 후 schema 정의 활성화.
- hire_date: 현재 `createdAt`(가입일) 대용 → 모드B 정확도 위해 `members.hire_date` 추가 검토(같은 마이그에 포함 가능).

## §4 백엔드
- **설정 API** `admin-att-leave-policy`(GET/PUT, super_admin 전용·`ctx.member.role` 판정) — 위 필드 CRUD. payroll-settings 패턴 참고(UPSERT·id=1 시드 보장 — P1-17 교훈).
- **cron-att-leave-auto 재작성**: 정책 로드 → 모드 분기.
  - 모드 A: 현재 Section 1(월 만근 +1) 유지, Section 2(1주년 일괄부여) 미실행.
  - 모드 B: Section 2를 `annual_base_days + floor(근속년수/increment_years)*increment_days`(상한 cap)로 계산해 부여, Section 1(만근) 미실행.
  - 현재 임시 가드 `SERVICE_BASED_ANNUAL_ENABLED=false`를 정책값으로 대체.

## §5 어드민 UI (근태 설정 화면)
- 모드 라디오(A/B) + 모드 B 선택 시 파라미터 입력(기준/증가/주기/상한) 노출.
- 위치: `admin-workspace-management.html`(근태 설정 그룹) 또는 cms 근태 설정 탭. 캐시버스터 갱신.
- 저장 시 `admin-att-leave-policy` PUT.

## §6 마이페이지·표시 정합
- 직원 마이페이지 잔여 표시가 모드와 무관하게 `att_leave_balances` 합계 기준이라 영향 적음. 모드 B 도입 시 "근속 N년차 연차 X일" 안내 문구 정합 점검.

## §7 마이그레이션 흐름 (Swain 액션)
1. AI: schema 정의 + migrate 함수 작성 → push
2. Swain: `https://tbfa.co.kr/api/migrate-att-leave-policy?run=1`
3. AI: 적용 확인 → schema 활성화 + migrate 파일 삭제

## §8 단계·검증
- Stage1 스키마+마이그 → Stage2 설정 API+cron 분기 → Stage3 어드민 UI → 검증(모드A 만근/모드B 근속 시나리오·경계).
- 검증: 모드A에서 만근 누적 정상 / 모드B에서 1주년 12일·3년차 13일 등 / 모드 전환 시 기존 잔여 보존.

---

## 부록: 카드 만료 사전알림 — 유효기간 입력 방식 (Swain 채택)
별개 후속(결제 도메인). 검수 P1-3 = KICC가 만료월 미제공 → **카드번호는 KICC 보안창, 유효기간(MM/YY)만 우리 화면에서 입력**받아 저장.
- **핵심 난제 = KICC 리다이렉트 왕복 중 유효기간 보존**: billing-register(등록 화면 입력) → KICC 결제창 → billing-approve(빌키 INSERT). 유효기간을 register→approve로 전달해야 함.
- 제안: ① billing-register가 받은 expiry를 pending donation 행(또는 임시 저장)에 보관 → billing-approve가 billing_keys.card_expiry_month에 기록. (donations에 임시 컬럼 또는 별도 보관 필요 — 구현 시 결정) 또는 ② billing-success 페이지에서 한 번 더 입력받아 신규 엔드포인트로 billing_keys 갱신(왕복 보존 불필요·사용자 1스텝 추가).
- card_expiry_month 컬럼은 이미 존재(cron-billing-card-expiry가 읽음) → 저장만 되면 사전알림 작동. 추천 = 방식 ②(왕복 보존 불필요·단순).
