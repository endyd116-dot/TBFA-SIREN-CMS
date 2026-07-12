// lib/release-drafts.ts
// [업데이트 소식 A안] 배포 버전 + 자동 초안 시드 (단일 출처)
//
// 운영 방식:
//  - 메인(Claude)이 기능 배포 push 때마다 이 파일의 APP_VERSION을 올리고 PENDING_DRAFTS에 초안을 추가한다.
//  - 운영자가 통합 CMS '업데이트 소식'에서 [초안 가져오기] → 검토 → 발행. (발행 전에는 직원에게 안 보임)
//  - key는 중복 가져오기 방지용(이미 DB에 있으면 스킵).
//  - APP_VERSION은 열린 탭의 '새 버전 새로고침 안내' 감지에 사용(/api/app-version).

export const APP_VERSION = "2026-07-12.12";

export interface ReleaseDraftSeed {
  key: string;                                  // 고유 키 (중복 방지)
  title: string;
  items: { text: string; link?: string }[];
}

export const PENDING_DRAFTS: ReleaseDraftSeed[] = [
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
