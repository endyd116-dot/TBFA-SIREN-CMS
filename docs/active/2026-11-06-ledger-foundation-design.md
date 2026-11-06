# 1단계 장부 뼈대 설계서 (2026-11-06)

상태: **Swain 승인(2026-11-06), 정관 반영본. 구현 중.**
범위: [로드맵](2026-11-06-approval-finance-roadmap.md) 1단계. 복식 전표, 계정과목표, 사업·기능·재원, 마감 잠금, 변경 이력.
검증 상태: 아래 표 구조와 안전장치는 로컬 임시 DB에서 36개 항목을 시험해 모두 통과했습니다. 라이브에는 아직 아무것도 적용하지 않았습니다.

## 한눈에 보기

### 무엇이 생기나

1. **전표가 진짜 장부가 됩니다.** 돈이 어디서 나와 어디로 갔는지 차변과 대변 두 칸으로 기록합니다.
2. **모든 비용에 세 가지 표시가 붙습니다.** 어떤 활동인지(사업수행·일반관리·모금), 어느 사업인지, 어떤 돈으로 썼는지(재원)입니다. 공익법인 공시 서식이 요구하는 구분입니다.
3. **계정별 장부와 합계표가 나옵니다.** 총계정원장과 시산표입니다. 시산표는 차변과 대변 합계가 맞는지 바로 보여 줍니다.
4. **월 마감이 생깁니다.** 마감한 달은 고칠 수 없습니다. 승인한 전표는 지우지 못하고 반대 전표로 취소합니다.
5. **변경 이력이 지워지지 않습니다.** 지금 감사 로그는 1년 뒤 자동 삭제되므로 장부 이력을 별도 표에 둡니다.

예시: 11월 사무실 월세 100만 원을 전용계좌에서 이체하고, 일반관리 60만 원과 유가족 지원 40만 원으로 나눕니다.

| | 계정과목 | 차변 | 대변 | 활동 | 사업 | 재원 |
|---|---|---:|---:|---|---|---|
| 1 | 임차료 | 600,000 | | 일반관리 | | 회비 |
| 2 | 임차료 | 400,000 | | 사업수행 | 유가족 지원 | 회비 |
| 3 | 보통예금(전용계좌) | | 1,000,000 | | | |

회계를 몰라도 쓸 수 있게 작성 창은 «지출 / 수입 / 대체» 세 가지로 나눕니다. 지출을 고르고 비용 종류, 활동, 사업, 재원, 지급 방법을 고르면 위 표가 자동으로 만들어집니다.

### 바뀌지 않는 것

손익 현황, 예산 집행률, 재무 보고서, 재정상태표의 숫자는 그대로입니다. 장부와 연결하는 일은 2단계와 3단계입니다. 후원·결재·급여에서 자동으로 전표가 만들어지는 것도 2단계입니다. 재무상태표·운영성과표·결산서도 3단계입니다.

### 함께 고치는 기존 문제

| 문제 | 영향 | 조치 |
|---|---|---|
| 전표 화면이 서버 응답을 잘못 읽음(서버는 `codes`, `vouchers`로 보내는데 화면은 `items`를 찾음) | 전표 목록과 계정 선택이 늘 비어 보임. 5월 작성중 전표 11건이 화면에 안 보였음 | 화면 수정 |
| 통장 거래가 연결된 초안 전표는 삭제 시 오류 | 초안을 지울 수 없음 | 삭제 때 통장 거래를 미분류로 되돌림 |
| 통장 자동 분류가 상위 계정(503 등)을 넣음 | 장부에 기표할 수 없는 계정 | 말단 계정만 고르게 수정 |
| 전표 저장 API에 서버 권한 확인이 없음(메뉴에서만 가림) | 직원 계정이 주소를 직접 부르면 저장 가능 | 서버 권한 등록 |
| AI 비서의 전표 승인이 별도 경로 | 장부 검사를 건너뜀 | 공용 승인 처리로 통일 |
| 전표 번호 발급 2곳(AI 도구, 통장 확인)이 동시 요청에 취약 | 번호 충돌 가능 | 공용 발급으로 통일 |
| 감사 로그 1년 자동 삭제 | 장부 이력 보존 불가 | 장부 전용 이력 표 |

### Swain이 할 일

구현 중 어드민 주소를 두 번 눌러 주시면 됩니다. 표 생성 1회, 시험 데이터 정리 1회입니다. 나머지는 제가 진행합니다.

## §0. 확정 사항

### 0.1 Swain 결정

| # | 결정 |
|---|---|
| 1 | 실제 장부가 없으므로 SIREN에 최초 구축한다 |
| 2 | 공익법인 신청 목표는 2027년 3월이다 |
| 3 | 2026년 장부는 숭고한 등불 캠페인 이후 거래부터 기록한다 |
| 4 | 세무 전문가가 없다. 회계 처리 기준은 Claude가 정한다 |
| 5 | 사업 목록은 먼저 만들고 어드민에서 고칠 수 있게 한다 |
| 6 | 사단법인 통장(우리은행 1005-404-940572)을 공익법인 전용계좌로 쓴다. 효성 CMS·카드 정산금도 이 통장으로 받는다 |
| 7 | 등불 시작일은 2026년 11월 25일이다. 2026년 장부는 이날부터다 |
| 8 | 설계대로 구현을 시작한다 |

### 0.2 회계 처리 결정

Swain 위임에 따라 Claude가 정했습니다. 근거는 §0.4의 공식 자료입니다.

| # | 항목 | 결정 | 근거 |
|---|---|---|---|
| 1 | 장부 방식 | 복식부기·발생주의 | 회계기준 제4조. 소규모 단식부기 특례(부칙 제5조)는 2018~2019년 회계연도 한시라 쓸 수 없음 |
| 2 | 재무제표 | 재무상태표, 운영성과표, 주석 | 제5조 |
| 3 | 사업 부문 | 전부 공익목적사업. 기타사업 칸은 구조만 유지 | 제10·23조. 고유번호증상 수익사업 없음 |
| 4 | 고유목적사업준비금 | 쓰지 않음 | 제19조②. 수익사업 소득이 없어 전입할 금액이 없음 |
| 5 | 계좌 입금 | 실제 입금일에 수익 | 제26조① |
| 6 | 카드·CMS | 결제 승인·출금 요청 시점에 «결제 정산 미수금»으로 수익 인식. 입금 때 수수료를 지급수수료로 분리 | 공시 부표 1 작성방법, 실무지침 사례 2-2, 제24조②(총액 표시) |
| 7 | 회비와 후원금 | 유가족회원·일반회원의 회비만 회비수익. **후원회원 후원금은 기부금수익(개인 4011, 단체 4015)** | 정관 제6조⑤ «회비 납부 의무를 지지 아니한다». 공시 표준서식 «개인기부자(후원회원을 포함합니다)», «회비수익란은 기부금이 아닌 회원의 의무에 의해 받은 회비». 실무지침 회비수익 해설 |
| 8 | 기본순자산 | 설립 출연 재산(정관 별지 1)은 기본재산(3011). 기부받은 돈은 총회의 운영재산 승인을 전제로 기부금수익. 승인이 없으면 기본순자산 증가로 처리해야 함 | 회계기준 제20조, 제26조④. 정관 제31조②2호 «기부에 의하거나 기타 무상으로 취득한 재산»은 기본재산, 단 총회 승인 예외 |
| 9 | 비용 분류 | 계정과목은 무엇에 썼나(성격), 활동은 왜 썼나(기능). 기존 사업비·관리운영비·모금비 구분은 활동의 기본값으로만 사용 | 제27조③⑤ |
| 10 | 분배비용 | 장학금·지원금은 사업수행에서만 허용하고 다른 활동은 입력 차단 | 공시 서식, 실무지침 |
| 11 | 공통비 | 여러 활동에 걸친 비용은 줄을 나눠 배분. 기준은 3단계 주석 작성 때 하나로 정해 일관 적용 | 제30조 |
| 12 | 가지급금·가수금 | 임시 계정. 월 마감 때 경고, 연말 결산 때 잔액이 있으면 마감 불가 | 실무지침 «재무상태표에 자산이나 부채로 표시되면 안 된다» |
| 13 | 부가세 | 매입세액을 비용에 포함, 별도 계정 없음 | 수익사업 없는 고유번호 단체의 일반 처리. 조문은 확인 못 함 |
| 14 | 유형자산 | 취득가 100만 원 초과이고 1년 넘게 쓰면 자산, 정액법 5년. 그 이하는 비용 | Claude 초안. 회계기준에 금액 기준 없음. 주석에 회계정책으로 기재(제41조) |
| 15 | 오류 수정 | 승인 전표는 반대 전표로 취소. 지난 회계연도 오류는 올해 전기오류수정손익 | 제7조⑧ |
| 16 | 회계연도 | 1월 1일~12월 31일 | 정관 제32조(정부 회계연도) |
| 17 | 보관 | 승인 전표와 이력은 자동 삭제하지 않음 | 공익법인 장부 보존 의무. 기간(10년으로 보도됨)은 조문 미확인 |

**한계:** 이 표는 공개 기준을 읽고 제가 정한 것입니다. 저는 세무사나 회계사가 아니며 세무확인이나 서명을 대신할 수 없습니다. 그래서 계정과목, 사업, 재원, 회계연도는 모두 어드민에서 고칠 수 있게 둡니다. 결산서를 외부에 내기 전 세무사 1회 검토를 권합니다.

### 0.3 아직 모르는 것

| 확인할 것 | 왜 필요한가 | 지금 처리 |
|---|---|---|
| 정관 별지 1(설립 기본재산) | 받은 정관 PDF 11쪽에 없음. 개시 전표에서 기본재산 금액 필요 | 금액을 받으면 개시 전표에 입력 |
| 11월 25일 통장 잔액 | 개시 전표 금액 | 시작일에 입력 |
| 후원금 운영재산 총회 승인 | 정관 제31조②2호상 기부받은 재산은 기본재산이 원칙. 승인 없이 사업에 쓰면 정관과 어긋남 | 2027년 2월 정기총회 안건에 포함 권고 |
| 정관 목적사업 변경 여부 | 제4조에 유가족 지원·순직 인정·장학·교권 보호가 없음. 공시 서식은 정관에 기재된 사업만 공익목적사업으로 봄 | 사업 마스터에 «정관 근거 없음» 표시. Swain 결정 대기 |
| 제6조①4호 | 유가족회원 «사업의 우선적 수혜». 공익법인 요건은 수입을 회원 이익이 아닌 공익에 쓰고 직접 수혜자가 불특정 다수일 것 | 신청 전 검토 대상으로 보고 |
| 회비·후원금 시행세칙 | 정관 제7조② 이사회 의결로 정함. 금액·시기·환급 기준 | 2단계 자동 전표 전에 확인 |
| 주무관청 | 정관은 주무관청·감독청으로만 표기 | 제33조 기준 진행 |

**2026년 범위의 영향:** 11월 25일 이전 돈은 개시 잔액 한 줄로 들어가므로 잔액은 맞지만 그 기간 수입·지출은 결산서에 나오지 않습니다. 정관 제33조의 결산은 해당 사업연도 전체가 대상이므로, 설립일부터의 결산이 필요하다고 확인되면 시작일을 앞당겨 그 기간 전표를 넣을 수 있게 둡니다.

**기부금품법과의 관계:** 장부에서 기부금수익으로 잡는 것은 회계 분류입니다. 기부금품법 적용 여부는 별개이며, 대법원(2023-02-02 선고, 기사 기준)은 정관상 회원 자격·권리·의무, 회비 납부와 관리를 내부 규정으로 종합 판단하라고 했습니다. 모든 입구의 후원회원 가입 절차는 이 판단에 유리하지만 법률 자문을 대신하지 않습니다.

### 0.4 근거 자료

| 자료 | 시점 | 비고 |
|---|---|---|
| 공익법인회계기준 전문 | 2018년 12월 실무지침서 부록 | 기획재정부. 이후 개정 여부 미확인 |
| 공익법인회계기준 실무지침서 | 2018년 12월 | [조세재정연구원 공개본](https://www.kipf.re.kr/thumbnail/pdf/CMS_201911120457276980.pdf) |
| 공시 표준서식(별지 제31호)·간편서식(제31호의2) | 2023-03-20 개정 | 법제처 공개 PDF |
| 교육부 소관 비영리법인 규칙 제7조 | 위키문헌 사본 | 정관 제33조와 내용이 같음 |
| 사단법인 교사유가족협의회 정관 | Swain 제공 PDF 11쪽 | 별지 1 없음 |

## §1. DB 설계

원칙: 기존 `vouchers`를 전표 머리표로 재활용하고 분개 줄 표를 더합니다. 라이브 전표는 2026년 5월 통장 파일에서 만들어진 작성중 11건뿐이고 승인 전표는 없습니다(2026-11-06 연도 기준 재확인. 앞선 «0건»은 목록 API의 이번 달 기본값을 잘못 읽은 것). 이 11건은 장부 시작일 이전이고 작성중이라 장부 숫자에 들어가지 않으며 옮기지 않습니다. 기존 전표 생성 경로 6곳도 그대로 동작합니다.

### 1.1 계정과목 `account_codes` 확장

| 컬럼 | 뜻 | 값 |
|---|---|---|
| `kind` | 구분 | asset, liability, net_asset, revenue, expense |
| `normal_side` | 잔액 방향 | debit, credit. 감가상각누계액은 자산이지만 credit |
| `statement_line` | 재무제표·공시 칸 | current_asset, suspense, business_expense, donation_individual 등 |
| `nature` | 비용 성격 | distribution(분배), personnel(인력), facility(시설), other(기타) |
| `default_function` | 활동 기본값 | service, admin, fundraising. 인건비는 비움 |
| `system_role` | 시스템이 찾는 계정 | cash_default, payable_default, receivable_default, settlement_receivable, withholding, opening_net_asset |

- 코드 번호를 프로그램에 박지 않고 `system_role`로 찾습니다.
- 상위 계정에는 기표할 수 없습니다. 하위 계정이 있는지로 판단하므로 별도 컬럼은 없습니다.
- `category`는 유지하고 asset, liability, net_asset, non_operating을 값에 추가합니다.
- 기존 37개 + 신규 56개 = 93개, 실제 기표 계정 74개입니다(부록 B). 코드는 바꾸지 않습니다. 이름은 2개만 바꿉니다(4011 기부금수익(개인), 5014 일용인건비).

### 1.2 전표 머리표 `vouchers` 확장

| 컬럼 | 뜻 |
|---|---|
| `voucher_type` | expense, income, transfer, opening, reversal |
| `source_type`, `source_id` | 자동 전표 출처. 같은 출처 중복 방지(2단계에서 사용) |
| `reversal_of_id`, `reversed_by_id` | 반대 전표 연결 |

`account_code`와 `amount`는 기존 화면을 위해 유지합니다. 첫 비용·수익 줄의 계정과 차변 합계를 저장합니다.

### 1.3 신규 표

| 표 | 역할 |
|---|---|
| `voucher_lines` | 분개 줄. 계정, 차변, 대변, 활동, 사업, 재원, 부문, 메모 |
| `ledger_programs` | 사업 마스터. 코드, 이름, 부문, 정관 근거, 공시 코드, 설명, 사용 여부 |
| `ledger_funds` | 재원 마스터. 코드, 이름, 사용 제한 여부, 시스템 행 여부 |
| `ledger_fiscal_years` | 회계연도. 시작일, 종료일, `closed_through`(이 날까지 마감), 상태 |
| `ledger_history` | 변경 이력. 대상, 동작, 작업자, 사유, 변경 전후. 수정·삭제 불가 |

**마감을 기준일 하나로 둔 이유:** 달마다 행을 만드는 대신 «이 날까지 마감» 날짜 하나만 관리합니다. 11월을 마감하면 2026-11-30을 저장합니다. 중간 달만 열리는 일이 생기지 않고 표가 단순합니다.

**연말 이월 전표를 만들지 않는 이유:** 자산·부채·순자산은 처음부터 누계로, 수익·비용은 해당 연도만 계산합니다. 전기 운영성과는 시산표에서 계산 행으로 표시합니다.

**활동은 고정값, 사업·재원은 CRUD:** 활동 3종은 회계기준이 정한 구분이라 코드 상수입니다. 사업과 재원은 어드민에서 추가·수정·숨김합니다. 사용된 항목은 삭제하지 않고 숨깁니다.

### 1.4 사업·재원 초기값

명세의 5개 사업은 쓰지 않습니다. 근거가 없고 정관과도 다릅니다. 공시 서식은 **정관에 기재된 사업**을 공익목적사업으로 보므로 정관 제4조의 4개를 먼저 두고, 실제로 하는 활동 4개를 «정관 근거 없음»으로 함께 둡니다. 비워 두면 직원이 지출을 잘못된 사업에 넣게 되기 때문입니다. 부문은 모두 공익목적사업으로 시작합니다. 기타사업으로 두면 장학금·지원금 입력이 막히고(분배비용은 공익목적사업의 사업수행에서만 가능), 정관 변경 여부가 아직 정해지지 않았기 때문입니다.

| 코드 | 사업 | 정관 근거 | 공시 코드(초안) |
|---|---|---|---|
| P01 | 교원 연수·세미나 | 제4조 1호 | 2300 기타교육 |
| P02 | 토크 콘서트·학술연구 | 제4조 2호 | 2400 학술연구 |
| P03 | 인식 개선 캠페인·소식지 | 제4조 3호 | 7100 시민 및 옹호단체 |
| P04 | 학교 안전사고 콘텐츠 연구 | 제4조 4호 | 2400 학술연구 |
| P05 | 유가족 지원 | 없음 | 4100 사회복지 |
| P06 | 순직 인정 지원 | 없음 | 7200 법률 및 법률서비스 |
| P07 | 추모·장학 | 없음 | 2500 장학 |
| P08 | 교권 보호·제도 개선 | 없음 | 7100 시민 및 옹호단체 |

일반관리와 모금은 사업이 아니라 활동으로 구분합니다. 등불 캠페인 비용도 활동 «모금»입니다. 사업은 활동이 사업수행일 때만 고릅니다. 공시 서식의 사업별 사업수행비용 칸과 그대로 맞습니다. 장부 화면에는 정관 근거가 없는 사업의 지출 합계와 비중을 표시합니다.

| 코드 | 재원 | 사용 제한 | 쓰는 곳 |
|---|---|---|---|
| F01 | 회비 | 없음 | 유가족회원·일반회원 회비 |
| F02 | 기부금 | 없음 | 후원회원 후원금과 일반 기부금 |
| F03 | 지정 기부금 | 있음 | 기부자가 용도를 정한 돈 |
| F04 | 보조금 | 있음 | 보조금수익 |
| F05 | 기타 수입 | 없음 | 이자 등 |

재원이 필요한 이유는 공시 부표 1·2입니다. 기부금 수입과 지출을 월별로 적어야 하므로 비용 쪽에도 어떤 돈으로 썼는지 표시가 있어야 합니다.

### 1.5 DB 안전장치

프로그램이 아니라 DB가 막습니다. 전표를 쓰는 경로가 AI 비서를 포함해 여러 곳이라 한 곳이 빠져도 장부가 깨지지 않게 하기 위해서입니다.

| 안전장치 | 막는 일 |
|---|---|
| 승인 시점 검사 | 분개 없음, 차변·대변 불일치, 전표 금액과 합계 불일치, 장부 기간 밖 날짜, 마감된 달, 결산 끝난 연도, 반복 틀 승인 |
| 승인 전표 보호 | 금액·날짜·상태·계정·적요 변경, 전표 삭제, 분개 수정·추가·삭제 |
| 이력 보호 | 이력 수정·삭제 |
| 줄 제약 | 음수, 0원, 한 줄에 차변·대변 동시 입력, 없는 계정, 없는 사업·재원 |
| 출처 유일 | 같은 후원·지출에서 자동 전표 2장 생성 |

허용되는 유일한 변경은 반대 전표가 생겼다는 표시(`reversed_by_id`)입니다.

### 1.6 마이그레이션

- 파일: `netlify/functions/migrate-ledger-foundation.ts` (`GET` 진단, `?run=1` 실행, `?cleanup=1` 시험 연도 정리)
- 전체 SQL과 초기값은 부록 A·B. 두 번 실행해도 안전합니다.
- 순서: 코드 push → Swain 클릭 → 적용 확인 → `db/schema.ts` 맨 끝에 `/* === 장부 뼈대 === */` 절 추가 → push.
- 새 코드는 raw SQL을 쓰므로 schema 정의 전에도 동작합니다. 기존 `accountCodes`, `vouchers` 정의에 컬럼을 넣는 일은 적용 확인 뒤에만 합니다.

## §2. API 명세

모든 함수는 단계별 try/catch와 `step·detail·stack` 응답을 지킵니다.

### 2.1 공용 모듈 `lib/ledger-post.ts`

| 함수 | 역할 |
|---|---|
| `validateLines(tx, voucher, lines, { strict })` | 초안은 느슨하게, 제출·승인은 엄격하게 검사. 누락 항목 목록 반환 |
| `buildDefaultLines(tx, voucher)` | 줄 없는 전표의 기본 2줄 생성 |
| `postVoucher(tx, id, actor)` | 전표 행 잠금, 검사, 승인, 이력 기록. 승인의 유일한 경로 |
| `reverseVoucher(tx, id, { date, reason }, actor)` | 반대 전표 생성·승인, 원전표 표시, 이력 기록 |
| `recordHistory(tx, entry)` | 이력 기록 |

연결 1개 환경이므로 트랜잭션 안에서는 `db`를 쓰지 않고 `tx`만 씁니다.

**엄격 검사 규칙**

1. 줄 2개 이상, 차변 합 = 대변 합 > 0
2. 계정은 사용 중인 말단 계정
3. 사업비용 줄은 활동과 재원 필수. 활동이 사업수행이면 사업 필수
4. 분배비용 계정은 사업수행만 허용
5. 수익 줄과 사업외비용 줄은 재원 필수
6. 날짜는 회계연도 안, 마감일 뒤
7. 기타사업 부문 사업을 고르면 줄의 부문도 기타사업으로 자동 지정

**기본 2줄 규칙**

| 계정 구분 | 통장 거래 연결 | 통장 연결 없음 |
|---|---|---|
| 비용 | 차변 계정 / 대변 보통예금 | 차변 계정 / 대변 미지급금 |
| 수익 | 차변 보통예금 / 대변 계정 | 차변 미수금 / 대변 계정 |
| 자산·부채·순자산 | 출금이면 차변 계정 / 대변 보통예금, 입금이면 반대 | 자동 생성 안 함, 작성 창에서 직접 입력 |

주의: `bank_transactions.txn_type`의 debit은 **출금**이고 장부 차변과 뜻이 반대입니다. 통장 금액은 `Math.abs`로 읽습니다.

### 2.2 신규 API

| 경로 | 방식 | 권한 | 역할 |
|---|---|---|---|
| `/api/admin-ledger-masters` | GET | finance_view | 계정, 사업, 재원, 활동, 회계연도 묶음 |
| `/api/admin-ledger-master-save` | POST | finance_ledger_manage | 사업·재원 추가·수정·숨김 |
| `/api/admin-ledger-gl` | GET | finance_view | 총계정원장 |
| `/api/admin-ledger-trial-balance` | GET | finance_view | 시산표 |
| `/api/admin-ledger-close` | POST | finance_ledger_manage, 해제는 이사장 | 월 마감·해제 |
| `/api/admin-ledger-fiscal-year` | GET, POST | 조회 finance_view, 변경은 이사장 | 회계연도·장부 시작일 |
| `/api/admin-ledger-history` | GET | finance_view | 변경 이력 |
| `/api/admin-voucher-reverse` | POST | 이사장 | 반대 전표 |

```json
// GET /api/admin-ledger-trial-balance?year=2026&month=11
{ "ok": true, "data": {
  "period": { "from": "2026-11-01", "to": "2026-11-30", "closedThrough": null },
  "rows": [
    { "code": "1012", "name": "보통예금(전용계좌)", "kind": "asset", "normalSide": "debit",
      "debitTotal": 5000000, "creditTotal": 1000000, "debitBalance": 4000000, "creditBalance": 0 }
  ],
  "carryForward": 0,
  "totals": { "debitTotal": 5000000, "creditTotal": 5000000, "debitBalance": 4000000, "creditBalance": 4000000 },
  "balanced": true
} }
```

```json
// GET /api/admin-ledger-gl?accountCode=1012&from=2026-11-01&to=2026-11-30&programId=&fundId=
{ "ok": true, "data": {
  "account": { "code": "1012", "name": "보통예금(전용계좌)", "normalSide": "debit" },
  "opening": 0,
  "rows": [
    { "date": "2026-11-20", "voucherId": 12, "voucherNumber": "202611-001", "description": "11월 임차료",
      "payeeName": "OO빌딩", "debit": 0, "credit": 1000000, "balance": -1000000,
      "functionCode": null, "programName": null, "fundName": null, "reversed": false }
  ],
  "closing": -1000000, "total": 1, "limit": 500
} }
```

```json
// POST /api/admin-ledger-close
{ "action": "close", "year": 2026, "month": 11 }
{ "action": "reopen", "year": 2026, "month": 11, "reason": "입금 누락 수정" }
// 응답
{ "ok": true, "data": { "closedThrough": "2026-11-30",
  "warnings": [ { "code": "suspense_balance", "message": "가수금 잔액 50,000원" } ] } }
// 차단 시 422
{ "ok": false, "error": "미결 전표가 있어 마감할 수 없습니다", "blockers": [ { "code": "open_vouchers", "count": 2 } ] }
```

마감 규칙: 첫 달부터 순서대로만 마감합니다. 장부 기간 안의 미결 전표(작성중·제출)와 시산표 불일치는 차단합니다. 장부 시작일 이전 전표는 보지 않습니다. 미확인 통장 거래와 가지급금·가수금 잔액은 경고만 합니다. 해제는 사유 필수이고 이력에 남습니다.

### 2.3 수정 API

| 경로 | 변경 |
|---|---|
| `admin-voucher-create`, `admin-voucher-update` | `voucherType`, `lines[]` 선택 입력. 없으면 기존처럼 저장. 분개 저장을 트랜잭션으로 묶음 |
| `admin-voucher-submit` | 줄이 없으면 기본 줄 생성, 엄격 검사. 실패하면 422 + `missing[]` |
| `admin-voucher-approve` | 승인을 공용 처리로 변경. 반려는 기존 유지 |
| `admin-voucher-detail` | `lines`, `reversalOfId`, `reversedById`, `history` 추가 |
| `admin-account-code-create`, `-update`, `admin-account-codes-list` | 새 컬럼 처리. 사용된 계정의 구분·잔액 방향 변경 금지 |
| `admin-voucher-delete` | 연결된 통장 거래를 미분류로 되돌린 뒤 삭제 |
| `admin-finance-anomaly` | 반대 전표와 취소된 전표 제외 |
| `cron-voucher-recurring` | 틀의 분개 줄 복사 |
| `lib/ai-agent-tools.ts` | 승인은 공용 처리로, 번호 발급은 공용으로, 작성 도구에 활동·사업·재원 추가 |
| `admin-bank-transaction-confirm` | 번호 발급을 공용으로 |
| `lib/bank-reconcile.ts` | AI 분류 후보를 비용 계정으로 제한 (`category IN ('personnel','program','admin_ops','fundraising')`) |

```json
// POST /api/admin-voucher-create (추가 입력)
{ "voucherDate": "2026-11-20", "voucherType": "expense", "description": "11월 임차료",
  "payeeName": "OO빌딩", "evidenceType": "transfer_confirm",
  "lines": [
    { "accountCode": "5031", "debit": 600000, "credit": 0, "functionCode": "admin", "fundId": 1 },
    { "accountCode": "5031", "debit": 400000, "credit": 0, "functionCode": "service", "programId": 1, "fundId": 1 },
    { "accountCode": "1012", "debit": 0, "credit": 1000000 }
  ] }
```

### 2.4 권한

| 동작 | 권한 | 기본 |
|---|---|---|
| 장부 조회 | `finance_view` | 관리자 허용, 직원 차단 |
| 전표 작성·수정·제출·삭제 | `finance_bookkeeping` | 관리자 허용, 직원 차단 |
| 승인·반려·반대 전표 | 이사장 고정 | 기존과 동일 |
| 월 마감, 사업·재원·계정과목 관리 | 신규 `finance_ledger_manage` | 관리자 허용, 직원 차단 |
| 마감 해제, 회계연도 변경 | 이사장 고정 | 신규 |

등록 위치는 `lib/permission-catalog.ts`, `lib/admin-guard.ts` PATH_FEATURE, `cms-tbfa.js` MENU_PERM 세 곳입니다. 기존 전표 API도 PATH_FEATURE에 넣어 서버에서 막습니다. 조회(목록·상세·틀 목록)는 `finance_view`, 쓰기(작성·수정·제출·삭제·틀 수정)는 `finance_bookkeeping`입니다.

## §3. 화면 설계

재정 관리 메뉴에 **장부**를 추가합니다. 등록 4곳: `cms-tbfa.html` 사이드바·section, `cms-tbfa.js` tabLabels·탭 분기. 신규 파일은 `public/js/admin-ledger.js` 하나입니다.

전표 탭은 지출 관리에서, 계정과목 관리는 지출 자동 추출 시스템에서 장부로 옮겨 한곳에 모읍니다. 지금까지 전표 탭은 목록과 계정 선택이 비어 보여 실사용이 없었으므로 옮겨도 불편이 없습니다.

```
재정 관리 › 장부
[전표] [총계정원장] [시산표] [월 마감] [기준 정보] [변경 이력]
```

### 전표 작성 창

```
구분  (•) 지출   ( ) 수입   ( ) 대체
날짜 [2026-11-20]   거래처 [OO빌딩]
적요 [11월 사무실 임차료                 ]

무엇에 썼나  [임차료 ▼]            금액 [1,000,000]
왜 썼나      [일반관리 ▼]  ← 계정 기본값, 바꿀 수 있음
어느 사업    [비활성]       ← 사업수행일 때만 선택
어떤 돈으로  [선택 ▼]       ← 필수
[+ 나누기: 활동·사업이 다른 금액 추가]

지급 방법    [전용계좌 ▼]   전용계좌 / 다른 계좌 / 현금 / 나중에 지급(미지급금)

── 장부에 기록될 내용 (자동) ─────────────────
차변 임차료            1,000,000
대변 보통예금(전용계좌)            1,000,000
합계 일치 ✓
──────────────────────────────────
증빙 [이체확인서 ▼]  증빙 번호 [      ]  예산 항목 [▼]
                       [취소] [저장(작성중)] [제출]
```

- 수입: 무슨 수입인지, 재원, 입금 계좌를 고릅니다.
- 대체: 계정과 차변·대변을 직접 입력합니다. 반복 전표 틀은 기존처럼 저장합니다.
- 개시 전표: 대체에서 «개시 잔액»을 고르면 대변이 잉여금으로 채워집니다. 잔액은 차변 보통예금(전용계좌)으로 넣습니다.
- 승인된 전표에는 수정 버튼 대신 이사장에게 «반대 전표로 취소» 버튼만 나옵니다.
- 인쇄 양식에 분개 줄과 활동·사업·재원을 넣습니다.

### 총계정원장

```
계정 [보통예금(전용계좌) ▼]  기간 [2026-11-01 ~ 2026-11-30]  사업 [전체 ▼]  재원 [전체 ▼]  [엑셀]
기초 잔액                                                   0
날짜   전표번호    적요        거래처    차변      대변      잔액
11/20  202611-001  11월 임차료  OO빌딩            1,000,000  -1,000,000
기말 잔액                                          -1,000,000
```

### 시산표

```
2026년 [11월 ▼]까지  합계 일치 ✓  [엑셀]
차변 잔액   차변 합계  계정과목             대변 합계  대변 잔액
```

### 월 마감

```
2026년 장부 기간 2026-11-01 ~ 2026-12-31
11월  미결 전표 0건  시산표 일치  미확인 통장 거래 1건(경고)  가수금 5만 원(경고)  [마감]
12월  이전 달 마감 후 가능
10월까지 마감됨  [해제 — 이사장·사유 필수]
```

### 기준 정보

계정과목표(구분별 묶음, 성격·활동 기본값 표시), 사업(추가·수정·숨김), 재원(추가·수정·숨김), 회계연도(시작일 변경)를 탭으로 둡니다. 운영자가 코드 없이 관리합니다.

## §4. 검증 시나리오

### 완료: 로컬 임시 DB 36개 통과

구조 두 번 실행 안전, 초기값 중복 없음(93개), 상위 없는 계정 없음, 사업비용 계정 성격 누락 없음, §1.5 안전장치 전 항목, 반대 전표 뒤 잔액 0, 마감·해제, 결산 연도 차단, 시험 연도만 지우는 정리 절차와 안전장치 복구.

### 구현 뒤 라이브 검증

시험 전표는 **2099 시험 연도**로만 만들고 끝나면 전부 지웁니다. 실제 2026·2027년 장부에는 남지 않습니다. 시험은 `scripts/e2e/ledger-verify.mjs`로 합니다.

| # | 시나리오 | 기대 |
|---|---|---|
| Q1 | 마이그 진단 후 실행, 재실행 | 표 생성, 계정 93개, 재실행 안전 |
| Q2 | 어드민 장부 메뉴 진입 | 6개 탭 표시, 직원 계정은 메뉴와 API 모두 차단 |
| Q3 | 지출 전표 작성 | 계정 목록 표시, 분개 미리보기 일치 |
| Q4 | 활동 빠뜨리고 제출 | 빠진 항목을 알려 주고 막음 |
| Q5 | 장학금을 일반관리로 입력 | 막음 |
| Q6 | 제출 후 승인 | 원장·시산표 반영, 합계 일치 |
| Q7 | 승인 전표 수정·삭제 시도 | 막음 |
| Q8 | 반대 전표 | 잔액 0, 원전표에 취소 표시, 이력 2건 |
| Q9 | 금액 나누기 전표 | 사업·재원 필터 합계가 분개와 일치 |
| Q10 | 수입 전표, 개시 전표 | 차변·대변 방향 정확 |
| Q11 | 2099 날짜 시험 통장 파일의 출금에서 만든 전표 | 제출 시 기본 2줄 생성, 활동·재원 입력 후 승인 |
| Q12 | AI 비서 승인 | 공용 처리 통과, 줄 없으면 거절 |
| Q13 | 월 마감 | 미결 있으면 차단, 마감 뒤 그 달 승인 차단, 해제 사유 기록 |
| Q14 | 동시 승인 3회 | 1회만 성공 |
| Q15 | 기존 화면 회귀 | 손익 현황·예산 집행률·재무 보고서 숫자가 시험 전후 같음 |
| Q16 | 사업·재원 추가·숨김 | 작성 창에 반영, 사용된 항목은 삭제 불가 |
| Q17 | 정리 절차 | 2099 데이터 0건, 안전장치 복구, 실제 데이터 불변 |

## §5. mock 데이터

단독 구현이라 작성하지 않습니다.

## §6. 구현 순서

| 단계 | 내용 | 담당 |
|---|---|---|
| 1 | 마이그, `lib/ledger-post.ts`, 시산표·원장 계산 | Claude |
| 2 | 신규 API 8개, 기존 API 수정 | Claude |
| 3 | 장부 화면, 전표·계정과목 이전, 권한 등록 | Claude |
| 4 | 타입 검사, 로컬 시험 후 push | Claude |
| 5 | 마이그 주소 클릭 | **Swain** |
| 6 | schema 정의 추가, 라이브 Q1~Q16 | Claude |
| 7 | 정리 주소 클릭(Q17) | **Swain** |
| 8 | 마이그 파일 삭제, 메뉴얼·AI 도구·문서 동기화, push | Claude |

배포는 3회 안으로 묶습니다. 정리 주소는 라이브 쓰기라 Swain 클릭으로 합니다.

## §7. 라운드 마감 체크리스트

| # | 항목 | 내용 |
|---|---|---|
| 1 | 권한 정책 | `finance_ledger_manage` 추가, 권한정책 화면 표시 확인 |
| 2 | AI 비서 | 시산표·원장 조회 도구 2개 추가, 작성 도구 인자 확장, 시스템 프롬프트 갱신 |
| 3 | 메뉴얼 | `manual-admin.html`에 장부 절 추가 |
| 4 | AI 학습 자료 | 장부 Q&A 추가 |
| 5 | 명세 | 재정 명세에 v3의 «공익법인 미지정» 전제 변경 표시 |
| 6 | 상태 문서 | PROJECT_STATE, HANDOFF, 로드맵 §6 |
| 8 | 내보내기 | 원장·시산표 엑셀, 전표 인쇄 양식 |
| 9 | iframe 4곳 | 장부 메뉴 등록 |
| 10 | 권한 4계층 | 신규 API 전부 게이트 확인 |
| 14 | schema | 적용 확인 뒤 append-only로 추가 |
| 기타 | 업데이트 소식 | `lib/release-drafts.ts` 버전과 초안 |

## §8. 다음 단계로 넘기는 것

| 단계 | 넘기는 내용 |
|---|---|
| 2단계 | 후원회원 후원금은 기부금수익, 유가족·일반회원 회비만 회비수익으로 분기. 카드·CMS 결제 정산 미수금 흐름. 통장 파일별 계정 연결(지금은 전용계좌 기본). 예산 목 ↔ 계정 연결표(`budget_account_code_map`) 재사용. 급여의 예수금 처리. AI 분류 후보 확장 |
| 3단계 | 재무상태표, 운영성과표, 주석, 수입·지출 결산서, 사업실적서에 **재산목록 추가**. 정관 제33조 기준 **회계연도 종료 후 2개월 안**에 이사회 의결과 총회 승인을 얻어 다음 해 사업계획·수지예산서와 함께 제출합니다. 감사의 회계감사(제34조)도 그 전에 끝나야 합니다. 2027 예산에 사업·활동·재원 추가. 공통비 배분 기준 확정. 시험 예산안 정리. 재정상태표를 장부 기준으로 교체 |
| 5단계 | 공시 칸 매핑(`statement_line`, 공시 코드), 기부금 수입·지출 명세, 수혜자 명세, 80% 지표. 정관 제35조② 기부금 모금액·활용실적 홈페이지 공개(매년 4월 안) |

## 부록 A. 구조 SQL (로컬 시험 통과본)

```sql
/* 1. 계정과목 확장 */
ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS kind VARCHAR(20);
ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS normal_side VARCHAR(6);
ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS statement_line VARCHAR(40);
ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS nature VARCHAR(20);
ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS default_function VARCHAR(20);
ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS system_role VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS account_codes_system_role_uq
  ON account_codes (system_role) WHERE system_role IS NOT NULL;
-- 초기값 입력 뒤: kind, normal_side, statement_line SET NOT NULL

/* 2. 사업·재원 */
CREATE TABLE IF NOT EXISTS ledger_programs (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  segment VARCHAR(10) NOT NULL DEFAULT 'public',
  charter_ref VARCHAR(30),
  disclosure_code VARCHAR(10),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_programs_segment_ck CHECK (segment IN ('public','other'))
);
CREATE TABLE IF NOT EXISTS ledger_funds (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  restricted BOOLEAN NOT NULL DEFAULT FALSE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* 3. 회계연도·마감 기준일 */
CREATE TABLE IF NOT EXISTS ledger_fiscal_years (
  year INTEGER PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  closed_through DATE,
  status VARCHAR(10) NOT NULL DEFAULT 'open',
  closed_by INTEGER,
  closed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_fiscal_years_status_ck CHECK (status IN ('open','closed')),
  CONSTRAINT ledger_fiscal_years_range_ck CHECK (start_date <= end_date)
);

/* 4. 전표 머리표 확장 */
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS voucher_type VARCHAR(20) NOT NULL DEFAULT 'expense';
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS source_type VARCHAR(30);
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS source_id VARCHAR(60);
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS reversal_of_id INTEGER REFERENCES vouchers(id);
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS reversed_by_id INTEGER REFERENCES vouchers(id);
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_source_uq
  ON vouchers (source_type, source_id)
  WHERE source_type IS NOT NULL AND reversed_by_id IS NULL;

/* 5. 분개 줄 */
CREATE TABLE IF NOT EXISTS voucher_lines (
  id SERIAL PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  account_code VARCHAR(20) NOT NULL REFERENCES account_codes(code),
  debit BIGINT NOT NULL DEFAULT 0,
  credit BIGINT NOT NULL DEFAULT 0,
  function_code VARCHAR(20),
  program_id INTEGER REFERENCES ledger_programs(id),
  fund_id INTEGER REFERENCES ledger_funds(id),
  segment VARCHAR(10) NOT NULL DEFAULT 'public',
  memo VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT voucher_lines_amount_ck CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0)),
  CONSTRAINT voucher_lines_function_ck CHECK (function_code IS NULL OR function_code IN ('service','admin','fundraising')),
  CONSTRAINT voucher_lines_segment_ck CHECK (segment IN ('public','other')),
  CONSTRAINT voucher_lines_no_uq UNIQUE (voucher_id, line_no)
);
CREATE INDEX IF NOT EXISTS voucher_lines_voucher_idx ON voucher_lines (voucher_id);
CREATE INDEX IF NOT EXISTS voucher_lines_account_idx ON voucher_lines (account_code);
CREATE INDEX IF NOT EXISTS voucher_lines_program_idx ON voucher_lines (program_id);
CREATE INDEX IF NOT EXISTS voucher_lines_fund_idx ON voucher_lines (fund_id);

/* 6. 변경 이력 */
CREATE TABLE IF NOT EXISTS ledger_history (
  id BIGSERIAL PRIMARY KEY,
  entity VARCHAR(30) NOT NULL,
  entity_id VARCHAR(40) NOT NULL,
  action VARCHAR(30) NOT NULL,
  actor_id INTEGER,
  actor_name VARCHAR(100),
  reason TEXT,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ledger_history_entity_idx ON ledger_history (entity, entity_id, created_at);

/* 7. 안전장치 */
CREATE OR REPLACE FUNCTION ledger_voucher_guard() RETURNS trigger AS $$
DECLARE
  dr BIGINT; cr BIGINT; cnt INTEGER; fy RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION '승인된 전표는 삭제할 수 없습니다. 반대 전표로 취소하세요.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.voucher_date IS DISTINCT FROM OLD.voucher_date
       OR NEW.fiscal_year IS DISTINCT FROM OLD.fiscal_year
       OR NEW.account_code IS DISTINCT FROM OLD.account_code
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.voucher_type IS DISTINCT FROM OLD.voucher_type
       OR NEW.is_template IS DISTINCT FROM OLD.is_template THEN
      RAISE EXCEPTION '승인된 전표의 내용은 바꿀 수 없습니다. 반대 전표로 취소하세요.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    IF NEW.is_template THEN
      RAISE EXCEPTION '반복 전표 틀은 승인할 수 없습니다.';
    END IF;
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
      INTO dr, cr, cnt FROM voucher_lines WHERE voucher_id = NEW.id;
    IF cnt < 2 OR dr = 0 OR dr <> cr THEN
      RAISE EXCEPTION '차변과 대변 합계가 맞지 않아 승인할 수 없습니다. (차변 %, 대변 %, 줄 %)', dr, cr, cnt;
    END IF;
    IF NEW.amount <> dr THEN
      RAISE EXCEPTION '전표 금액과 분개 합계가 다릅니다. (금액 %, 합계 %)', NEW.amount, dr;
    END IF;
    SELECT * INTO fy FROM ledger_fiscal_years WHERE NEW.voucher_date BETWEEN start_date AND end_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION '장부 기간 밖의 날짜입니다: %', NEW.voucher_date;
    END IF;
    IF fy.status <> 'open' THEN
      RAISE EXCEPTION '결산이 끝난 회계연도입니다: %', fy.year;
    END IF;
    IF fy.closed_through IS NOT NULL AND NEW.voucher_date <= fy.closed_through THEN
      RAISE EXCEPTION '마감된 기간입니다: %까지 마감', fy.closed_through;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_voucher_guard_trg ON vouchers;
CREATE TRIGGER ledger_voucher_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION ledger_voucher_guard();

CREATE OR REPLACE FUNCTION ledger_line_guard() RETURNS trigger AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM vouchers
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.voucher_id ELSE NEW.voucher_id END;
  IF st = 'approved' THEN
    RAISE EXCEPTION '승인된 전표의 분개는 바꿀 수 없습니다.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_line_guard_trg ON voucher_lines;
CREATE TRIGGER ledger_line_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON voucher_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_line_guard();

CREATE OR REPLACE FUNCTION ledger_history_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '장부 변경 이력은 고치거나 지울 수 없습니다.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_history_guard_trg ON ledger_history;
CREATE TRIGGER ledger_history_guard_trg
  BEFORE UPDATE OR DELETE ON ledger_history
  FOR EACH ROW EXECUTE FUNCTION ledger_history_guard();
```

시험 연도 정리(`?cleanup=1`, 한 트랜잭션):

```sql
ALTER TABLE vouchers DISABLE TRIGGER ledger_voucher_guard_trg;
ALTER TABLE voucher_lines DISABLE TRIGGER ledger_line_guard_trg;
ALTER TABLE ledger_history DISABLE TRIGGER ledger_history_guard_trg;
UPDATE vouchers SET reversed_by_id = NULL, reversal_of_id = NULL WHERE fiscal_year = 2099;
DELETE FROM bank_transactions WHERE txn_date >= '2099-01-01';
DELETE FROM bank_imports WHERE period_from >= '2099-01-01';
DELETE FROM ledger_history WHERE entity = 'voucher'
  AND entity_id IN (SELECT id::text FROM vouchers WHERE fiscal_year = 2099);
DELETE FROM vouchers WHERE fiscal_year = 2099;
DELETE FROM ledger_fiscal_years WHERE year = 2099;
ALTER TABLE vouchers ENABLE TRIGGER ledger_voucher_guard_trg;
ALTER TABLE voucher_lines ENABLE TRIGGER ledger_line_guard_trg;
ALTER TABLE ledger_history ENABLE TRIGGER ledger_history_guard_trg;
```

## 부록 B. 계정과목표 초기값

표시: ★ 신규, 굵게 표시한 줄은 상위 계정(기표 불가). 비용의 성격: 분배·인력·시설·기타. 활동: 사업수행·일반관리·모금, «직접»은 기본값 없음.

### 자산

| 코드 | 이름 | 재무제표 구분 | 비고 |
|---|---|---|---|
| **101** | **현금및현금성자산** ★ | 유동자산 | |
| 1011 | 현금 ★ | 유동자산 | |
| 1012 | 보통예금(전용계좌) ★ | 유동자산 | 기본 통장, 우리은행 사단법인 계좌 |
| 1013 | 보통예금(기타 계좌) ★ | 유동자산 | |
| **102** | **기타유동자산** ★ | 유동자산 | |
| 1021 | 단기금융상품 ★ | 유동자산 | |
| 1022 | 미수금 ★ | 유동자산 | 기본 미수 계정 |
| 1023 | 결제 정산 미수금 ★ | 유동자산 | 카드·CMS 정산 대기 |
| 1024 | 미수수익 ★ | 유동자산 | |
| 1025 | 선급금 ★ | 유동자산 | |
| 1026 | 선급비용 ★ | 유동자산 | |
| 1027 | 가지급금 ★ | 임시 | 결산 전 정리 필수 |
| **103** | **투자자산** ★ | 투자자산 | |
| 1031 | 장기성예적금 ★ | 투자자산 | |
| **104** | **유형자산** ★ | 유형자산 | |
| 1041 | 차량운반구 ★ | 유형자산 | |
| 1042 | 차량운반구 감가상각누계액 ★ | 유형자산 | 대변 잔액 |
| 1043 | 비품 ★ | 유형자산 | |
| 1044 | 비품 감가상각누계액 ★ | 유형자산 | 대변 잔액 |
| **105** | **무형자산** ★ | 무형자산 | |
| 1051 | 컴퓨터소프트웨어 ★ | 무형자산 | |
| **106** | **기타비유동자산** ★ | 기타비유동자산 | |
| 1061 | 임차보증금 ★ | 기타비유동자산 | |

### 부채

| 코드 | 이름 | 재무제표 구분 | 비고 |
|---|---|---|---|
| **201** | **유동부채** ★ | 유동부채 | |
| 2011 | 미지급금 ★ | 유동부채 | 기본 미지급 계정 |
| 2012 | 미지급비용 ★ | 유동부채 | |
| 2013 | 예수금 ★ | 유동부채 | 원천세, 4대보험 근로자분 |
| 2014 | 선수금 ★ | 유동부채 | |
| 2015 | 가수금 ★ | 임시 | 결산 전 정리 필수 |
| 2016 | 단기차입금 ★ | 유동부채 | |
| **202** | **비유동부채** ★ | 비유동부채 | |
| 2021 | 장기차입금 ★ | 비유동부채 | |
| 2022 | 퇴직급여충당부채 ★ | 비유동부채 | |

### 순자산

| 코드 | 이름 | 재무제표 구분 | 비고 |
|---|---|---|---|
| **301** | **기본순자산** ★ | 기본순자산 | |
| 3011 | 기본재산 ★ | 기본순자산 | 정관 별지 1 금액 |
| **302** | **보통순자산** ★ | 보통순자산 | |
| 3021 | 잉여금 ★ | 보통순자산 | 개시 잔액 상대 계정 |
| **303** | **순자산조정** ★ | 순자산조정 | |
| 3031 | 순자산조정 ★ | 순자산조정 | |

### 수익

| 코드 | 이름 | 재무제표·공시 칸 |
|---|---|---|
| **401** | **사업수익** | 사업수익 |
| 4011 | 기부금수익(개인) (이름 변경) | 개인기부금품 |
| 4012 | 보조금수익 | 보조금 |
| 4013 | 회비수익 | 회비수익 |
| 4014 | 사업수익(교육·용역) | 기타공익목적사업수익 |
| 4015 | 기부금수익(영리법인) ★ | 영리법인기부금품 |
| 4016 | 기부금수익(모금단체·재단) ★ | 모금단체·재단 지원금품 |
| 4017 | 기부금수익(기타) ★ | 기타기부금품 |
| **402** | **사업외수익** | 사업외수익 |
| 4021 | 이자수익 | 사업외수익 |
| 4022 | 잡수익 | 사업외수익 |
| 4023 | 자산처분이익 | 사업외수익 |
| 4024 | 전기오류수정이익 ★ | 사업외수익 |

### 비용

| 코드 | 이름 | 성격 | 활동 기본값 |
|---|---|---|---|
| **501** | **인건비** | | |
| 5011 | 급여 | 인력 | 직접 |
| 5012 | 퇴직급여 | 인력 | 직접 |
| 5013 | 복리후생비 | 인력 | 직접 |
| 5014 | 일용인건비 (이름 변경) | 인력 | 직접 |
| 5015 | 상여금 ★ | 인력 | 직접 |
| 5016 | 교육훈련비 ★ | 인력 | 직접 |
| **502** | **사업비** | | |
| 5021 | 교육·상담비 | 기타 | 사업수행 |
| 5022 | 캠페인·행사비 | 기타 | 사업수행 |
| 5023 | 장학금 | 분배 | 사업수행 |
| 5024 | 지원금 | 분배 | 사업수행 |
| 5025 | 사업도서인쇄비 | 기타 | 사업수행 |
| 5026 | 법률자문비 ★ | 기타 | 사업수행 |
| **503** | **관리운영비** | | |
| 5031 | 임차료 | 시설 | 일반관리 |
| 5032 | 통신비 | 기타 | 일반관리 |
| 5033 | 사무용품비 | 기타 | 일반관리 |
| 5034 | 공과금(광열수도) | 시설 | 일반관리 |
| 5035 | 차량유지비 | 시설 | 일반관리 |
| 5036 | 업무추진비 | 기타 | 일반관리 |
| 5037 | 여비교통비 | 기타 | 일반관리 |
| 5038 | 회의비 | 기타 | 일반관리 |
| 5039 | 지급수수료 | 기타 | 일반관리 |
| 5040 | 세금과공과 | 기타 | 일반관리 |
| 5043 | 보험료 | 시설 | 일반관리 |
| 5044 | 감가상각비 | 시설 | 일반관리 |
| 5045 | 잡비 | 기타 | 일반관리 |
| 5046 | 용역비 ★ | 기타 | 일반관리 |
| 5047 | 대손상각비 ★ | 기타 | 일반관리 |
| **504** | **모금비** | | |
| 5041 | 홍보비 | 기타 | 모금 |
| 5042 | 모금행사비 | 기타 | 모금 |
| **505** | **사업외비용** ★ | | |
| 5051 | 이자비용 ★ | 사업외 | |
| 5052 | 자산처분손실 ★ | 사업외 | |
| 5053 | 기타의 대손상각비 ★ | 사업외 | |
| 5054 | 전기오류수정손실 ★ | 사업외 | |
| 5055 | 잡손실 ★ | 사업외 | |
| **506** | **법인세비용** ★ | | |
| 5061 | 법인세비용 ★ | 법인세 | |

적립금 계정은 두지 않았습니다. 정관 제31조②4호상 적립금은 기본재산이 되어 쓰기 어려워지므로 필요할 때 어드민에서 추가합니다. 활동 기본값은 자동 선택일 뿐이고 전표마다 바꿀 수 있습니다. 예를 들어 사업 담당 직원의 급여는 사업수행으로, 사무실 임차료는 비율대로 나눕니다.
