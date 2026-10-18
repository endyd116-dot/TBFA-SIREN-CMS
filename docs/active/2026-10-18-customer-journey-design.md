# 고객 여정 패널 + 잠재 후원자 자동 전환 — 설계·구현 기록 (2026-10-18)

> 단독 세션(메인) 구현. Swain 요청(2026-10-18): 「잠재 표의 수동 회원연결은 의미 없다 — 잠재가 정기·예비(일시)로 전환되면 이름·연락처 일치로 자동 전환. 잠재·예비·정기 어디서든 고객을 누르면 AM 리드관리처럼 화면 옆에서 여정(시작 경로·후원 금액/시기/대상·효성 계좌·카드·입금 내역 등 전부)이 보이고 관리자가 메모할 수 있게.」

## §0. 요구사항 확정 (결정 테이블)

| # | 결정 | 내용 | 근거 |
|---|---|---|---|
| D1 | 자동 연결 기준 | **전화(숫자만) 일치 또는 이메일(대소문자 무시) 일치**. 이름은 비교하지 않음(오타·개명 흡수, 다른 이름은 잠재 메모에 이미 보존). placeholder 메일(`@noemail.*`, `@lantern.invalid`)은 비교 제외 | 너처링 엔진·일시후원 예비 생성이 이미 같은 기준(`syncPotentialLeads`·`prospect-from-donation`) |
| D2 | 연결 시점 | ① 회원 생성 순간(홈 가입·관리자 등록·일괄 등록·등불 가입·효성 자동 생성) ② 후원 상태 재평가 순간(`reevaluateDonorType` 끝 — 일시후원·효성 수납·빌링 승인/해지 전부 통과) ③ 운영자 「자동 매칭 실행」 버튼(일괄) ④ 기존 너처링 일일 동기화(KST 08:00·리드 회원 생성 포함)는 그대로 | 훅 2곳으로 모든 전환 경로를 덮음 |
| D3 | 잠재 표 열 | «정식 회원 연결» → **«전환 상태»**: 잠재(미연결) / 리드(연결·미후원) / 회원(미후원) / 예비·일시 / 예비·해지 / 정기. 수동 「회원연결」·「연결해제」 버튼은 표에서 제거(연결 해제는 여정 패널 안에서만·같은 전화면 다음 매칭 때 다시 연결됨을 안내) | Swain: 수동 연결 무의미 |
| D4 | 여정 패널 | 오른쪽 슬라이드 패널(AM 리드관리 형태). 잠재·예비·정기 표의 이름 클릭으로 열림. 탭: 요약 / 후원·결제 / 여정(타임라인) / 발송 / 메모 | 요청 그대로 |
| D5 | 효성 계좌·카드 정보 | 효성에서 받은 그대로 표시(`hyosung_contracts.payment_info`·`account_holder`·`payment_tool`, 토스/KICC는 `card_number_masked`). 마스킹 추가 안 함 — 운영자 내부 화면 | Swain: 계좌·카드·입금 내역 다 보여야 |
| D6 | 메모 | 새 표 **`customer_notes`**(회원 또는 잠재에 매달림·작성자·시각·고정). 마이그 1회 `migrate-customer-notes`(어드민 URL). 표 준비 전엔 패널이 «메모 저장소 준비 전» 안내 | 시각·작성자 있는 메모 로그는 별도 표가 유일한 정석 |
| D7 | 제외 정보 | SIREN 신고(사건·괴롭힘·법률)·외부기관 의뢰는 여정에 넣지 않음. 유족 지원 신청은 건수·제목·상태만 | 후원 관리 권한자에게 신고 내용 노출 부적절 |
| D9 | 단계 수동 이동 | 패널의 «단계 이동»(잠재 / 예비·일시 / 예비·해지 / 정기 + 사유). 잠재만 있고 회원이 없으면 리드 회원을 만들어 연결 후 적용. '잠재'로 옮기면 잠재 행 보장. 모든 이동은 `donor_stage_events`(이력)+감사로그 | Swain 2026-10-18 «수동으로도 이동 + 기록» |
| D10 | 수동 지정 우선권 | 자동 판정과 다른 단계로 옮기면 «수동 지정»으로 표시되고, 지정 당시의 자동 판정(auto_baseline)이 바뀔 때까지 유지. 실제 약정·해지·후원이 생겨 자동 판정이 달라지면 해제하고 자동을 따름(이력에 사유) | 수동 지정이 다음 재평가에 조용히 덮이면 운영 신뢰 0 |
| D11 | 자동 역방향 | 정기→예비(해지)는 기존대로. **정기/예비→잠재 자동**: 해지됐는데 한 번도 낸 적 없거나 마지막 납부가 24개월(LAPSE_MONTHS) 넘게 지난 경우. 잠재로 내려가면 잠재 행을 자동 생성해 잠재 화면에 보임 | Swain «반대도 자동» |
| D8 | 권한 | 기존 잠재·예비·정기 API와 같은 `requireAdmin`(별도 권한키 없음). 메모 삭제는 작성자 본인 또는 super_admin | 기존 후원 화면과 동일 경계 |

## §1. DB

- 신규 2표 (마이그 `netlify/functions/migrate-customer-journey.ts`, 멱등):
- `donor_stage_events`: `id · member_id FK(cascade) · potential_donor_id FK(set null) · from_stage · to_stage · source(manual|auto|system) · reason · auto_baseline · is_override · released_at · release_reason · changed_by · changed_by_name · created_at` + 인덱스 2개.
- `customer_notes`:
  `id serial PK · member_id int FK members(cascade) · potential_donor_id int FK potential_donors(cascade) · body text · pinned bool · created_by int FK members(set null) · created_by_name varchar(50) · created_at · updated_at` + 인덱스 3개.
- 기존 표 변경 없음. `potential_donors.linked_by NULL` = 자동 연결, 값 있음 = (과거) 수동 연결.
- schema.ts: 파일 끝 `/* === 2026-10-18 고객 여정 메모 === */` 섹션에 `customerNotes` 정의(append-only).

## §2. API

| 함수 | 경로 | 역할 |
|---|---|---|
| `admin-customer-journey.ts` | `GET /api/admin/customer-journey?member=N` 또는 `?potential=N` | 여정 집계(아래 구조). 블록마다 try/catch·실패 블록은 비우고 `meta.warnings`에 기록 |
| `admin-customer-notes.ts` | `GET ?member=N|?potential=N` / `POST {memberId|potentialId, body, pinned}` / `PATCH {id, pinned|body}` / `DELETE {id}` | 메모 CRUD. 표 없으면 `ready:false` |
| `admin-potential-donor-automatch.ts` | `POST /api/admin/potential-donor-automatch` | 미연결 잠재 일괄 자동 연결 → `{scanned, linked, details[]}` |
| `admin-potential-donor-list.ts` (수정) | 기존 | 행에 `linkedDonorType·linkedProspectSubtype·linkedIsLead·linkedBy·stage·stageLabel` 추가, 필터 `linked=all|no|yes|converted|lead`, kpi에 `converted·lead·regular·prospectOnetime·prospectCancelled` 추가(기존 키 유지) |
| `admin-donor-stage-move.ts` (신규) | `POST /api/admin/donor-stage-move {memberId|potentialId, toStage, reason}` | 수동 단계 이동(D9·D10) |
| `lib/donor-stage.ts` (신규) | — | 단계 어휘·자동 판정 SQL(단건·일괄 공용)·수동 지정 조회/해제·이력 기록·잠재 행 보장 |
| `lib/donor-status.ts` (개정) | — | 단건·일괄 재평가가 donor-stage 규칙 + 수동 지정 우선권 + 이력 + 잠재 행 보장을 따름(표 없으면 자동 판정만) |
| `lib/potential-donor-link.ts` (신규) | — | `linkPotentialDonorsForMember(memberId, hint)` · `safeLinkPotentialDonors()` · `autoLinkAllPotentialDonors()` |
| 훅 | `lib/donor-status.ts`(재평가 끝) · `auth-signup.ts` · `admin-members.ts` · `admin-members-bulk.ts` · `lib/sponsor-member.ts` · `lib/member-classifier.ts` | 생성/전환 순간 즉시 연결(실패 무시) |

여정 응답 `data` 구조(최상위 키 고정):
```
subject{kind, memberId, potentialId}
profile{id,name,phone,email,type,status,memberCategory,memberSubtype,createdAt,lastLoginAt,withdrawnAt,blacklistedAt,blacklistReason,schoolName,memo,
        isLeadShell, donorType,prospectSubtype,donorChannels,donorEvaluatedAt,prospectEventName,prospectEntryPath,
        signupSource{code,label}, grade{code,nameKo,icon,color,assignedAt,locked}, consents{email,sms,mail,phoneVerifiedAt,kakaoConsentAt},
        churn{score,level,evaluatedAt}, stage, stageLabel} | null
potential[{id,name,phone,email,eventName,entryPath,participatedAt,memo,linkedAt,linkedBy,createdAt}]
donations{summary{completedAmount,completedCount,firstPaidAt,lastPaidAt,avgAmount,regularCount,onetimeCount,pendingCount,failedCount,
                  byYear[{year,amount,count}],byCampaign[{label,amount,count}],byMethod[{method,amount,count}]}, list[...]}
regular{isActive,channels,monthlyAmount,nextBillingDate,billingDay,regularMonthsCount,totalDonationAmount,
        hyosung{memberNo,contractStatus,paymentMethod,paymentTool,bankInfo,promiseDay,syncedAt},
        contracts[...], billingKeys[...], hyosungBillings{count,receivedSum,unpaidSum,lastPaymentDate,list[...]}, billingLogs[...], bankMatches[...]}
comms{nurture{enrollments[...],sends[...]}, sends[...], notifications[...]}
support{total,inProgress,list[...]}
notes{ready,list[...]}
activity[...]
timeline[{at,kind,title,detail,amount,status,refId}]   // 최신순, kind: potential|signup|stage|donation|hyosung|billing|card|contract|receipt|bank|nurture|send|notification|support|note|admin
meta{generatedAt,warnings[]}
```

## §3. 화면

- 신규 `public/js/cms-customer-journey.js`(순수 JS·IIFE·`window.openCustomerJourney({memberId}|{potentialId})`) + `public/css/cms-customer-journey.css`. 패널 마크업은 첫 호출 때 JS가 body에 생성.
- `cms-tbfa.html`: 두 파일 포함(캐시버스터) · 잠재 표 머리 «전환 상태» · KPI 라벨(총수/전환됨/미전환) · 필터 선택지 · 툴바 「자동 매칭 실행」.
- `cms-tbfa.js`: 잠재 행(이름 클릭·전환 배지·관리 버튼 정리·자동 매칭 버튼) · 정기/예비 행 이름 클릭 → 패널.

```
┌──────────────────────────────── 화면 ────────────────────────────────┐┌──── 고객 여정 ────┐
│ 잠재 후원자 관리 표 …                                                  ││ 이준서  [잠재]      │
│  이름(클릭) 연락처 … 전환 상태 …                                        ││ 010-9139-4194     │
│                                                                      ││ 요약|후원·결제|여정|발송|메모 │
│                                                                      ││ 시작: 제주 후원폼 2026-05-21 │
│                                                                      ││ 후원 합계 ₩0 (0건)  │
│                                                                      ││ 타임라인 …          │
│                                                                      ││ [메모 입력] [저장]  │
└──────────────────────────────────────────────────────────────────────┘└───────────────────┘
```

## §4. 검증 시나리오

| Q | 시나리오 | 기대 |
|---|---|---|
| Q1 | 잠재 표에서 이름 클릭 | 오른쪽 패널 열림·요약 탭에 «제주 후원폼 참여 2026-xx-xx»·후원 0건 |
| Q2 | 정기 후원자 표에서 이름 클릭 | 효성 약정(계좌·예금주·출금일)·수납 내역·카드(있으면)·후원 합계·타임라인 |
| Q3 | 메모 입력·저장 | 목록 맨 위에 작성자·시각과 함께 표시, 새로고침 후에도 유지(마이그 후) |
| Q4 | 잠재와 같은 전화로 회원 가입(또는 「자동 매칭 실행」) | 잠재 행 전환 상태가 «리드/회원» 또는 «예비·일시/정기»로, 미연결 수 감소 |
| Q5 | 마이그 전 메모 탭 | «메모 저장소 준비 전» 안내만, 다른 탭 정상 |
| Q6 | 응답 블록 1개 실패(예: 효성 표 없음) | 패널은 열리고 해당 블록만 비며 `meta.warnings` 기록 |

## §7. 라운드 마감 체크리스트

- [x] 권한: 기존 requireAdmin 경계 그대로(D8)
- [x] iframe 4곳 등록: 해당 없음(기존 탭 안의 패널)
- [x] 캐시버스터: cms-tbfa.js·cms-tbfa.html 신규 2파일
- [x] 업데이트 소식 초안 + APP_VERSION
- [x] PROJECT_STATE·메모리
- [x] 마이그 `migrate-customer-journey?run=1` Swain 실행(2026-10-18) → 표 2개 생성 → 파일 삭제(00dfec3b)
- [ ] AI 비서 도구(고객 여정 요약)·메뉴얼 보강 — 후속(선택)
