// lib/release-drafts.ts
// [업데이트 소식 A안] 배포 버전 + 자동 초안 시드 (단일 출처)
//
// 운영 방식:
//  - 메인(Claude)이 기능 배포 push 때마다 이 파일의 APP_VERSION을 올리고 PENDING_DRAFTS에 초안을 추가한다.
//  - 운영자가 통합 CMS '업데이트 소식'에서 [초안 가져오기] → 검토 → 발행. (발행 전에는 직원에게 안 보임)
//  - key는 중복 가져오기 방지용(이미 DB에 있으면 스킵).
//  - APP_VERSION은 열린 탭의 '새 버전 새로고침 안내' 감지에 사용(/api/app-version).

export const APP_VERSION = "2026-07-12.1";

export interface ReleaseDraftSeed {
  key: string;                                  // 고유 키 (중복 방지)
  title: string;
  items: { text: string; link?: string }[];
}

export const PENDING_DRAFTS: ReleaseDraftSeed[] = [
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
];
