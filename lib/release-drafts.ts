// lib/release-drafts.ts
// [업데이트 소식 A안] 배포 버전 + 자동 초안 시드 (단일 출처)
//
// 운영 방식:
//  - 메인(Claude)이 기능 배포 push 때마다 이 파일의 APP_VERSION을 올리고 PENDING_DRAFTS에 초안을 추가한다.
//  - 운영자가 통합 CMS '업데이트 소식'에서 [초안 가져오기] → 검토 → 발행. (발행 전에는 직원에게 안 보임)
//  - key는 중복 가져오기 방지용(이미 DB에 있으면 스킵).
//  - APP_VERSION은 열린 탭의 '새 버전 새로고침 안내' 감지에 사용(/api/app-version).

export const APP_VERSION = "2026-07-20.1";

export interface ReleaseDraftSeed {
  key: string;                                  // 고유 키 (중복 방지)
  title: string;
  items: { text: string; link?: string }[];
}

export const PENDING_DRAFTS: ReleaseDraftSeed[] = [
  {
    key: "2026-07-20-receipt-attachment-fix",
    title: "[관리자] 첨부한 증빙이 안 열리던 문제",
    items: [
      { text: "지출 결재·지출 관리에 올린 증빙 파일을 눌러도 빈 화면만 뜨던 문제를 고쳤습니다 — 파일은 정상적으로 올라가 있었고 열람만 막혀 있었습니다", link: "/cms-tbfa.html#approval-inbox" },
      { text: "이미 안 열리는 상태로 굳어 있던 기존 증빙 4건도 복구했습니다 — 다시 올리지 않아도 그대로 열립니다", link: "/cms-tbfa.html#expenses" },
    ],
  },
  {
    key: "2026-07-20-resolution-pdf-format",
    title: "[관리자] 지출결의서 서식 정리 — 결재란·표 넘침",
    items: [
      { text: "기안자가 결재선의 직책을 겸하는 경우 자기 자신이 결재하는 칸은 표시하지 않습니다 — 그 칸에 이사장 이름이 대신 찍히던 것도 함께 해소되었습니다", link: "/cms-tbfa.html#approval-resolutions" },
      { text: "본문 표의 숫자·공백이 넓게 벌어져 칸 밖으로 넘치고 잘리던 문제를 고쳤습니다", link: "/cms-tbfa.html#approval-resolutions" },
      { text: "기안일이 결의서에 표기됩니다" },
      { text: "[이사장] 이미 발행된 결의서에 '재발행' 버튼이 생겼습니다 — 내용은 그대로 두고 서식만 새 규칙으로 다시 만듭니다", link: "/cms-tbfa.html#approval-resolutions" },
    ],
  },
  {
    key: "2026-07-16-approval-resubmit-remind",
    title: "[관리자] 반려건 재상신 · 결재 지연 자동 알림",
    items: [
      { text: "반려된 지출 결재를 처음부터 다시 쓰지 않고 내용을 고쳐 다시 올릴 수 있습니다", link: "/cms-tbfa.html#approval-inbox" },
      { text: "결재가 오래 멈춰 있으면 결재자에게 자동으로 알림이 갑니다 — 결재 대기건이 잊혀 묵히는 일을 줄입니다", link: "/cms-tbfa.html#approval-inbox" },
    ],
  },
  {
    key: "2026-07-16-resolution-manage",
    title: "[관리자] 지출결의서 관리 기능 확장",
    items: [
      { text: "올린 결재를 취소하거나 기안을 삭제할 수 있습니다", link: "/cms-tbfa.html#approval-resolutions" },
      { text: "발행된 결의서를 한 번에 모아 내려받을 수 있습니다", link: "/cms-tbfa.html#approval-resolutions" },
      { text: "결의서 검색과 CSV 내려받기가 추가되었습니다 — 회계 정리·감사 자료 준비에 사용하세요", link: "/cms-tbfa.html#approval-resolutions" },
    ],
  },
  {
    key: "2026-07-16-approval-evidence-lines",
    title: "[관리자] 지출 결재에 증빙 첨부 · 결재라인 직접 설정",
    items: [
      { text: "지출 결재를 올릴 때 영수증·계약서 등 증빙 파일을 함께 붙일 수 있습니다", link: "/cms-tbfa.html#approval-inbox" },
      { text: "[이사장] 누가 어떤 순서로 결재하는지를 화면에서 직접 만들고 고칠 수 있습니다 — 결재선이 바뀔 때마다 개발자를 부르지 않아도 됩니다", link: "/cms-tbfa.html#approval-lines" },
    ],
  },
  {
    key: "2026-07-16-budget-accounts-fix",
    title: "[관리자] 예산과목(관·항·목) 버튼이 눌리지 않던 문제",
    items: [
      { text: "예산과목 체계 화면에서 추가·수정·삭제 버튼이 전부 반응하지 않던 문제를 고쳤습니다", link: "/cms-tbfa.html#budget-accounts" },
    ],
  },
  {
    key: "2026-07-16-footer-speed",
    title: "홈페이지 하단 협회 정보가 늦게 뜨던 문제",
    items: [
      { text: "페이지 맨 아래 협회 정보(주소·연락처 등)가 상단 메뉴를 다 불러올 때까지 기다렸다 뜨던 지연을 없앴습니다" },
    ],
  },
  {
    key: "2026-07-13-kst-io-edges",
    title: "날짜·시각 정확성 마무리 — 엑셀 날짜·시각 입력",
    items: [
      { text: "[관리자] 급여·성과결산 엑셀의 지급일 등 날짜가 월말·월초 새벽 경계에서 하루 밀려 찍히던 문제를 고쳤습니다" },
      { text: "출퇴근 시각·일정·마감일을 입력할 때, 컴퓨터 시간대가 한국이 아니어도 항상 한국 시각으로 저장되도록 했습니다 (해외 접속·시간대 오설정 대비)" },
    ],
  },
  {
    key: "2026-07-12-broken-apis",
    title: "휴가 신청 내역·전표 목록이 안 열리던 오류",
    items: [
      { text: "휴가 탭에서 내 신청 내역이 아예 안 뜨던 문제를 고쳤습니다 (조회가 통째로 실패하고 있었습니다)", link: "/workspace-attendance.html" },
      { text: "[관리자] 전표 목록이 안 열리던 문제를 고쳤습니다", link: "/cms-tbfa.html#vouchers" },
      { text: "[관리자] 전표 목록의 기본 조회 기간이 월초 새벽에 지난달로 잡히던 문제도 함께 고쳤습니다" },
      { text: "[관리자] 신고 게시판이 안 열리던 문제를 고쳤습니다 (사건·괴롭힘·법률 신고 집계가 실패하고 있었습니다)", link: "/cms-tbfa.html#reports" },
    ],
  },
  {
    key: "2026-07-12-tz-in-api",
    title: "[중요] 화면에 뜨는 시각이 9시간 이르게 표시되던 문제",
    items: [
      { text: "급여 증빙의 교부일이 오후 3시 발송인데 오전 6시로 보이는 등, 일부 화면의 시각이 9시간 이르게 표시되고 있었습니다 — 데이터는 정상이었고 표시만 잘못됐습니다", link: "/cms-tbfa.html#payroll" },
      { text: "원인: 서버가 시각을 보낼 때 '어느 시간대인지' 표시를 빠뜨려서, 브라우저가 그 값을 한국시각으로 오해했습니다. 124곳을 모두 바로잡았습니다" },
      { text: "결재 일시·이의제기 일시·파일 업로드 일시·예산 제출일시 등 여러 화면이 함께 정확해집니다" },
    ],
  },
  {
    key: "2026-07-12-kst-server",
    title: "[중요] 정기결제·영수증·감사기록의 날짜·시각 오류 수정",
    items: [
      { text: "정기후원 가입 시 약정일이 하루 전으로 잡히던 문제를 고쳤습니다 — 새벽에 가입하면 8월 1일 가입인데 약정일이 31일로 기록됐습니다", link: "/cms-tbfa.html#donors" },
      { text: "정기결제 자동청구가 어제 날짜로 대상을 찾던 문제를 고쳤습니다 — 그날 약정일인 후원자가 청구에서 빠질 수 있었습니다" },
      { text: "기부금 영수증의 발급일이 새벽 발급 시 어제 날짜로 찍히던 문제를 고쳤습니다 (세무 서류)" },
      { text: "감사 로그 CSV의 시각이 9시간 이르게 표시되던 문제를 고쳤습니다 — 언제 누가 무엇을 했는지가 이제 한국 시각으로 정확히 남습니다", link: "/cms-tbfa.html#audit" },
      { text: "근태 통계·캘린더가 월초 새벽에 지난달을 보여주던 문제, 기념일·연차·카드만료 알림이 하루 어긋나던 문제도 함께 고쳤습니다" },
      { text: "효성 CMS 출금 파일의 생성 일시가 한국 시각으로 찍힙니다" },
    ],
  },
  {
    key: "2026-07-12-kst-everywhere",
    title: "모든 날짜·시각이 한국 시간(KST)으로 통일되었습니다",
    items: [
      { text: "화면에 보이는 모든 시각이 한국 시간으로 표시됩니다 — 노트북 시간대가 어긋나 있거나 해외에서 접속해도 근태·급여·결재 시각이 똑같이 보입니다" },
      { text: "[중요] 밤 12시~아침 9시 사이에 등록하면 날짜가 '어제'로 기록되던 문제를 고쳤습니다 — 지출·수입·전표 등록일, 근태 조회 날짜, 캘린더의 '오늘', 성과 달성일이 모두 해당됐습니다", link: "/cms-tbfa.html#expenses" },
      { text: "새벽에 근태 화면을 열면 어제 날짜가 조회되던 문제도 함께 해결되었습니다", link: "/cms-tbfa.html#att-ops" },
      { text: "마감 알림·분기 판정·D-day 계산도 한국 날짜 기준으로 동작합니다" },
    ],
  },
  {
    key: "2026-07-12-payroll-simplified",
    title: "[관리자] 간이지급명세서 — 홈택스 업로드용 엑셀 자동 생성",
    items: [
      { text: "급여관리 → 신고·법정 서류에 '간이지급명세서(근로소득)'가 생겼습니다 — 국세청 일괄등록 양식을 그대로 채워 내려받습니다", link: "/cms-tbfa.html#payroll" },
      { text: "홈택스에서 [변환파일 제출] 탭에 그 파일을 올리고 [검증하기] → [과세자료 작성완료] 하면 제출이 끝납니다" },
      { text: "직원별 월 지급액은 지급 확정([지급])한 명세서에서 자동으로 채워지고, 시스템 도입 전에 지급한 급여는 화면에서 직접 입력할 수 있습니다", link: "/cms-tbfa.html#payroll" },
      { text: "주민등록번호는 저장되지 않습니다 — 엑셀 파일은 브라우저 안에서 만들어져 서버로 전송되지 않고, 창을 닫으면 사라집니다" },
      { text: "제출 기한을 자동으로 판단합니다 — 상반기분은 7월 31일, 하반기분은 다음해 1월 31일" },
    ],
  },
  {
    key: "2026-07-12-payroll-statutory",
    title: "[관리자] 급여 신고·법정 서류 자동 생성",
    items: [
      { text: "급여관리에 '신고·법정 서류' 항목이 생겼습니다 — 세무서(홈택스)·위택스·4대보험에 옮겨 적을 숫자를 자동으로 뽑아줍니다", link: "/cms-tbfa.html#payroll" },
      { text: "원천징수이행상황신고 자료 — 그 달에 실제로 지급한 급여의 인원·총지급액·소득세를 한 화면에. 신고 기한(지급한 달의 다음 달 10일)도 함께 표시됩니다", link: "/cms-tbfa.html#payroll" },
      { text: "임금대장 — 근로기준법 제48조 법정 서류(3년 보존). 근로일수·근로시간·임금 항목별 금액·공제 항목별 금액을 한 장으로. PDF·엑셀 내려받기", link: "/cms-tbfa.html#payroll" },
      { text: "연간 급여·공제 집계 — 다음해 3월 지급명세서·연말정산에 그대로 옮겨 적는 직원별 1년치 숫자", link: "/cms-tbfa.html#payroll" },
      { text: "4대보험 보수총액 — 매년 3월 건강보험·국민연금 정산 신고용 직원별 연간 과세 보수총액", link: "/cms-tbfa.html#payroll" },
      { text: "[지급]을 누를 때 실제 계좌이체일을 입력합니다 — 원천징수 신고가 '돈이 나간 날' 기준이라 이 날짜로 집계됩니다", link: "/cms-tbfa.html#payroll" },
      { text: "신고 숫자마다 [복사] 버튼이 있습니다 — 홈택스·위택스 입력칸에 붙여넣기만 하면 되니 자릿수를 틀릴 일이 없습니다", link: "/cms-tbfa.html#payroll" },
      { text: "주민등록번호는 저장하지 않습니다 — 신고서에 옮겨 적을 숫자만 만들고, 주민번호는 홈택스에서 직접 입력합니다" },
    ],
  },
  {
    key: "2026-07-12-workspace-me-fix",
    title: "워크스페이스에 내 이름·역할이 제대로 표시됩니다",
    items: [
      { text: "근태·캘린더·파일함·WBS·로드맵·템플릿·성과관리에서 내 이름이 빈칸으로 나오던 문제를 고쳤습니다 ('님의 근태 현황' → '김광일님의 근태 현황')", link: "/workspace-attendance.html" },
      { text: "관리자인데 '직원'으로 표시되던 역할 표기를 바로잡았습니다" },
    ],
  },
  {
    key: "2026-07-12-att-correction-evidence",
    title: "근태 수정 요청에 증빙 서류를 붙일 수 있습니다",
    items: [
      { text: "출퇴근 기록 수정 요청 시 사유와 함께 증빙 파일을 첨부할 수 있습니다 — 한글·워드·PDF·이미지 등 종류 제한 없이 파일당 20MB까지", link: "/workspace-attendance.html" },
      { text: "파일을 끌어다 놓거나 [파일 선택]으로 올리면 됩니다. 업로드 진행률이 표시됩니다", link: "/workspace-attendance.html" },
      { text: "[내 파일함에서 고르기]로 전에 올려둔 서류를 다시 붙일 수 있습니다 — 같은 확인서를 매번 다시 올리지 않아도 됩니다", link: "/workspace-attendance.html" },
      { text: "올린 파일은 내 파일함의 '근태 증빙' 폴더에 보관되어, 파일함에서 직접 이름을 바꾸거나 지울 수 있습니다", link: "/workspace-files.html" },
      { text: "[결재자] 정정 검토 화면의 사유 아래에 첨부 서류가 표시되고, 눌러서 내려받을 수 있습니다 — 그 요청에 첨부된 파일만 열리며 직원의 다른 파일은 보이지 않습니다", link: "/cms-tbfa.html#att-ops" },
    ],
  },
  {
    /* 급여·근태 정책이 실제로 바뀝니다 — 전 직원이 알아야 하므로 가장 먼저 발행하세요 */
    key: "2026-07-12-payroll-policy",
    title: "[중요] 급여·근태 정책 변경 안내",
    items: [
      { text: "급여는 이제 '실제 근무시간'으로 그날 지급일수를 정합니다 — 8시간 이상 1일치 / 6~8시간 0.75일치 / 4~6시간 0.5일치 (반차·반반차)", link: "/workspace-attendance.html" },
      { text: "휴가를 신청하지 않고 일찍 퇴근해도 일한 만큼만 지급됩니다. 소정근로에 못 미친 날은 그날 저녁에 '반차·조퇴 처리가 필요합니다' 알림이 갑니다", link: "/workspace-attendance.html" },
      { text: "구간 경계에는 10분 유예가 있습니다 — 몇 분 차이로 지급일수가 깎이지 않습니다" },
      { text: "휴게시간이 법정 기준으로 바뀌었습니다 — 4시간 이하 근무는 휴게를 빼지 않고, 4~8시간은 30분, 8시간 이상은 1시간 (반차 4시간이 3시간으로 기록되던 문제 해결)" },
      { text: "토·일·공휴일에 찍힌 출근은 급여 지급일수에서 제외됩니다. 실제 휴일근무 보상은 명세서에 별도 항목으로 지급됩니다" },
      { text: "2026년 7월부터, 재택근무일에 일일 보고서를 내지 않으면 그 날은 근무로 인정되지 않습니다 (재택일 +3일 자정 마감). 재택보고서 탭에서 아직 안 낸 날과 남은 기한을 확인하세요", link: "/workspace-attendance.html" },
      { text: "명세서에 '왜 이 금액인지'가 표시됩니다 — 소정근로 미달·휴일 출근·재택보고서 미제출·퇴근 미기록이 각각 몇 일인지 알 수 있습니다", link: "/workspace-attendance.html" },
      { text: "소득세·지방소득세가 명세서에 실제로 공제됩니다 — 국세청 근로소득 간이세액표(2026년 개정) 기준으로, 비과세 항목을 뺀 과세 대상액과 공제대상 가족 수에 따라 자동 산출됩니다", link: "/workspace-payroll.html" },
      { text: "명세서에 직책이 표시됩니다 (예: 정책국장·사무국장)" },
    ],
  },
  {
    key: "2026-07-12-icons-and-workspace",
    title: "화면 아이콘 새 단장 · 워크스페이스 대규모 개선",
    items: [
      { text: "전 페이지의 이모지가 깔끔한 선형 아이콘으로 교체되었습니다" },
      { text: "휴지통에서 삭제한 폴더를 복원할 수 있습니다", link: "/workspace-files.html" },
      { text: "작업 카드에 첨부된 파일을 카드에서 바로 다운로드할 수 있습니다", link: "/workspace-kanban.html" },
      { text: "캘린더가 모든 운영자의 일정을 함께 표시합니다 (공유 캘린더)", link: "/workspace-calendar.html" },
      { text: "캘린더에 공휴일이 표시됩니다", link: "/workspace-calendar.html" },
      { text: "알림을 클릭하면 해당 작업 카드로 바로 이동합니다" },
      { text: "관리자 로그인만으로도 워크스페이스 모든 페이지에 들어갈 수 있습니다" },
      { text: "파일함에 '내 파일'·'공유받음' 탭과 검색, 100개 초과 목록의 '더 보기'가 동작합니다", link: "/workspace-files.html" },
      { text: "구글 캘린더 동기화를 여러 번 눌러도 일정이 중복 생성되지 않습니다" },
      { text: "AI 비서로 작업을 지시·완료하면 담당자 알림과 원본 신고 종결이 정상 처리됩니다" },
    ],
  },
  {
    key: "2026-07-12-payroll-esign",
    title: "급여명세서 — 계산근거 열람 · 전자서명 수령확인 · 증빙 보관",
    items: [
      { text: "급여명세서를 누르면 서류 모양 창이 열리고, 금액마다 '어떻게 나온 숫자인지' 계산근거가 함께 표시됩니다", link: "/workspace-attendance.html" },
      { text: "명세서를 확인한 뒤 손글씨 또는 성명 입력으로 수령 확인(이의 없음 동의) 전자서명을 할 수 있습니다", link: "/workspace-attendance.html" },
      { text: "내용이 사실과 다르면 이의를 제기할 수 있고, 담당자 회신까지 화면에서 확인됩니다", link: "/workspace-attendance.html" },
      { text: "연말정산·대출 서류용 '연간 급여내역서'를 1년치 한 장으로 내려받을 수 있습니다", link: "/workspace-attendance.html" },
      { text: "[관리자] 교부 시점의 명세서 PDF가 저장소에 고정 보관됩니다 — 나중에 급여 기준이 바뀌어도 과거 명세서가 변하지 않습니다", link: "/cms-tbfa.html#payroll" },
      { text: "[관리자] 직원별 문서함에서 서명 증적(서명 이미지·일시·기기)과 증빙 문서를 언제든 확인·일괄 다운로드할 수 있습니다", link: "/cms-tbfa.html#payroll" },
      { text: "[관리자] 미서명 직원에게 독촉 알림을 보낼 수 있고, 3일 간격으로 자동 재안내도 나갑니다", link: "/cms-tbfa.html#payroll" },
      { text: "[관리자] 명세서를 바로잡아야 하면 '정정 재발행'으로 새 차수를 교부하고 재서명을 받을 수 있습니다 (기존 서명 기록은 보존)", link: "/cms-tbfa.html#payroll" },
      { text: "[관리자] 잘못 만들어진 명세서를 [삭제]할 수 있습니다 — 아직 교부하지 않은 명세서만 가능하며, 이미 교부한 문서는 법정 보존·서명 증적 때문에 삭제되지 않습니다", link: "/cms-tbfa.html#payroll" },
      { text: "[관리자] 직원이 수령확인 서명을 하면 [지급] 버튼이 초록으로 바뀝니다 — 서명을 보고 급여를 집행할 수 있습니다. 발송 전·서명 전·이의제기 중에 지급을 누르면 무엇을 건너뛰는지 알려줍니다", link: "/cms-tbfa.html#payroll" },
    ],
  },
  {
    key: "2026-07-12-payroll-attendance-sync",
    title: "근태를 바로잡으면 급여 재집계에 반영됩니다",
    items: [
      { text: "보류 중인 급여 명세서가 재집계에서 조용히 빠지던 문제를 고쳤습니다 — 근태를 고친 뒤 재집계하면 금액이 갱신됩니다 (보류 표시는 그대로 유지)", link: "/cms-tbfa.html#payroll" },
      { text: "직원별 [재집계] 버튼이 생겼습니다 — 승인·발송이 끝난 달에도 한 명만 골라 최신 근태로 다시 계산할 수 있습니다 (다른 직원 명세서는 그대로)", link: "/cms-tbfa.html#payroll" },
      { text: "재집계가 건너뛴 명세서가 있으면 누구를·왜 건너뛰었는지 알려줍니다", link: "/cms-tbfa.html#payroll" },
      { text: "관리자가 출퇴근 시각을 직접 고치면 지각·정상 판정도 함께 다시 계산됩니다 (급여의 출근일·지각횟수·만근에 반영)", link: "/cms-tbfa.html#att-ops" },
    ],
  },
  {
    key: "2026-07-12-e2e-critical-fixes",
    title: "작업 카드 열기·서브태스크 개수 등 오류 수정",
    items: [
      { text: "알림이나 링크로 작업 카드를 열면 오류가 나던 문제를 고쳤습니다", link: "/workspace-kanban.html" },
      { text: "칸반 카드의 하위 작업 개수가 항상 0으로 보이던 문제를 고쳤습니다", link: "/workspace-kanban.html" },
      { text: "캘린더에서 다른 운영자의 일정에 이름이 안 보이던 문제를 고쳤습니다", link: "/workspace-calendar.html" },
      { text: "자료실 목록이 열리지 않던 오류를 고쳤습니다", link: "/resources.html" },
      { text: "알림 벨 숫자가 두 값 사이에서 깜빡이던 문제를 고쳤습니다" },
      { text: "AI 작업 검색·근태 알림 등에서 이름이 비어 보이던 문제를 고쳤습니다" },
    ],
  },
];
