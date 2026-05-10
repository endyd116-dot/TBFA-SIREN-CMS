# 어드민 UI/UX 전면 리뉴얼 — 사전 인벤토리 + 정리 초안

> **작성**: 2026-05-11 / A 채팅 (Sonnet 4.6)
> **목적**: Phase 20 어드민 UI/UX 전면 리뉴얼 설계서 작성 전, 현재 어드민 화면을 전수 정리해 Swain·메인이 "묶을 것/뺄 것/2뎁스로 내릴 것"을 결정할 수 있게 자료 제공
> **다음 단계**: Swain이 §6 결정 항목에 답변 → 메인이 최종 마일스톤 설계서 작성 → 4채팅 트리거 분배
> **표현 규칙**: 함수명·변수명 없이 사용자 동작·기능 위주

---

## 1. Swain이 짚은 4가지 문제

| # | 문제 | 본 인벤토리에서 다루는 절 |
|---|---|---|
| 1 | 버튼이 너무 많이 즐비 | §2 사이드바 평면 30개 나열 / §3 SPA 화면 안 버튼 분포 |
| 2 | 1뎁스·2뎁스 분리 안 됨 | §5 1·2뎁스 IA 초안 (A 입장) |
| 3 | 사용 안 하는 / mock 수준 기능 정리 필요 | §4 mock·미사용 의심 후보 / §6 결정 질문 |
| 4 | 세련되고 깔끔한 UI | §6 디자인 방향 결정 항목 |

---

## 2. 현재 사이드바 메뉴 전수표

> 출처: `public/admin.html` 2676~2856 라인. 모든 메뉴 항목을 그대로 옮김.

### 2.1 1뎁스 그룹 구조 (현재)

| # | 그룹 라벨 | 메뉴 개수 | 비고 |
|---|---|---:|---|
| ① | 🛠 워크스페이스 | 5 | 토글(접힘 기본) — 외부 페이지 5개로 이동 |
| ② | 📊 운영 (라벨만) | 4 | 대시보드·회원·후원금·유가족 지원 |
| ③ | 🚨 사이렌 관리 (교원 전용) | 9 | 익명 식별·익명 감사·사건·악성민원·법률·게시판·통계·외부 기관·인계 |
| ④ | (라벨 없음) | 13 | 운영자·문의·AI·메인편집·콘텐츠·영수증·효성·캠페인·AI 활동·감사·보안 감사·시스템·자격·1:1 매칭·전문가·CSV·주간 보고·통합 분석 |
| ⑤ | 재정 관리 | 4 | 수입·예산·재무 보고·알림 발송 로그 |
| ⑥ | (이어서) | 5 | 발송 템플릿·수신자 그룹·발송 작업·AI 자동 발송·발송 분석 |

**합계**: 1뎁스에 약 **40개 메뉴** 평면 나열 (워크스페이스 토글 5개 포함). 실제 사용자 어드민이 보는 메뉴는 약 **35개**.

### 2.2 메뉴 평면 리스트 (그룹 ②~⑥ 모두 펼친 상태)

| # | 메뉴명 | 종류 | 연결 위치 |
|---:|---|---|---|
| 1 | 📈 대시보드 | SPA | adm-dashboard |
| 2 | 👥 회원 관리 | SPA | adm-members |
| 3 | 💰 후원금 관리 | SPA | adm-donations |
| 4 | 🤝 유가족 지원 관리 | SPA | adm-support |
| 5 | 🕵️ 익명 신원 식별 | 외부 페이지 | admin-anon-reveal.html |
| 6 | 📋 익명 감사 로그 | 외부 페이지 | admin-anon-audit.html |
| 7 | 🔍 사건 제보 관리 | SPA | adm-siren-incidents |
| 8 | ⚠️ 악성민원 관리 | SPA | adm-siren-harassment |
| 9 | ⚖️ 법률지원 관리 | SPA | adm-siren-legal |
| 10 | 💬 자유게시판 관리 | SPA | adm-siren-board |
| 11 | 📊 신고 통계 | SPA | adm-siren-stats |
| 12 | 🏛️ 외부 기관 관리 | SPA | adm-agency-mgmt |
| 13 | 📤 인계 이력 | SPA | adm-referral-history |
| 14 | 👨‍💼 운영자 관리 | SPA | adm-operators |
| 15 | 💬 문의 관리 (채팅) | SPA | adm-chat |
| 16 | 🤖 AI 추천 센터 | SPA | adm-ai |
| 17 | 🎨 메인 화면 편집 | 외부 페이지 | admin-site-builder.html |
| 18 | 📝 콘텐츠 관리 | SPA | adm-content |
| 19 | 📄 영수증 설정 | SPA | adm-receipt-settings |
| 20 | 🏦 효성 CMS+ 관리 | SPA | adm-hyosung |
| 21 | 📢 캠페인 관리 | SPA | adm-campaigns |
| 22 | 📊 AI 활동보고서 | SPA | adm-activity-report |
| 23 | 🔍 감사 로그 (super) | SPA | adm-audit |
| 24 | 🔒 보안·감사 로그 | SPA | adm-security-audit |
| 25 | ⚙️ 시스템 설정 | SPA | adm-settings |
| 26 | 🎓 자격 변경 심사 | SPA | adm-eligibility |
| 27 | ⚖️ 1:1 매칭 관리 | SPA | adm-expert-match |
| 28 | 👤 전문가 프로필 관리 | SPA | adm-expert-profiles |
| 29 | 📥 CSV 자동 매핑 | 외부 페이지 | cms-tbfa.html#csv-import |
| 30 | 📊 주간 보고서 | SPA | adm-report |
| 31 | 📈 통합 분석 대시보드 | SPA | adm-unified-dashboard |
| 32 | 💵 수입 현황 | SPA | adm-finance-income |
| 33 | 📋 예산·지출 관리 | SPA | adm-finance-budget |
| 34 | 🗂 재무 보고서 | SPA | adm-finance-report |
| 35 | 📨 알림 발송 로그 | SPA | adm-notification-logs |
| 36 | 📝 발송 템플릿 | 외부 페이지 | admin-templates.html |
| 37 | 👥 수신자 그룹 | 외부 페이지 | admin-recipient-groups.html |
| 38 | 📤 발송 작업 | 외부 페이지 | admin-send-jobs.html |
| 39 | 🤖 AI 자동 발송 | 외부 페이지 | admin-auto-triggers.html |
| 40 | 📊 발송 분석 | 외부 페이지 | admin-send-analytics.html |

**관찰**:
- SPA 페이지 31개 + 외부 페이지 9개 → **혼재**. SPA 안 화면과 외부 페이지가 사이드바에 섞여 있어 "어디로 이동하는지" 일관성 X
- 라벨 없는 그룹 ④에 13개가 한꺼번에 나열 — Swain이 지적한 "버튼 즐비"의 핵심
- "📊" 이모지가 5번·"💬"이 2번·"⚖️"이 2번 중복 사용 → 빠른 시각 식별 어려움

---

## 3. SPA 페이지 섹션 인벤토리 (31개)

> 출처: Explore subagent 분석. 빈 div + JS 동적 렌더 화면이 11개

| 섹션 ID | 화면 이름 | 버튼 액션(대략) | 화면 안 탭 | 주력 위젯 | 자연 묶음 후보 |
|---|---|:---:|:---:|---|---|
| adm-dashboard | 대시보드 | 0 | 없음 | 차트 | unified-dashboard와 중복 의심 |
| adm-members | 회원 관리 | 2 | 3개 | 표 | operators·eligibility |
| adm-donations | 후원금 관리 | 2 | 없음 | 표 | hyosung·finance-income·receipt-settings |
| adm-support | 유가족 지원 관리 | 0 | 없음 | 표 | siren-legal·expert-match |
| adm-siren-incidents | 사건 제보 관리 | 0 | 2개 | 표 | siren-harassment·siren-legal·siren-board (사이렌 4종) |
| adm-siren-harassment | 악성민원 관리 | 0 | 없음 | 표 | (위와 같음) |
| adm-siren-legal | 법률지원 관리 | 0 | 없음 | 표 | (위와 같음) |
| adm-siren-board | 자유게시판 관리 | 0 | 없음 | 표 | (위와 같음) |
| adm-siren-stats | 신고 통계 | — | — | — | siren 4종과 한 묶음 |
| adm-agency-mgmt | 외부 기관 관리 | — | — | — | referral-history·expert-profiles |
| adm-referral-history | 인계 이력 | — | — | — | (위와 같음) |
| adm-chat | 문의 관리 | 3 | 없음 | 채팅 | operators·support |
| adm-operators | 운영자 관리 | 1 | 없음 | 표 | members·eligibility |
| adm-ai | AI 추천 센터 | 1 | 없음 | 차트 | unified-dashboard와 중복 의심 |
| adm-content | 콘텐츠 관리 | 7+ | 7개 | 표 | campaigns |
| adm-receipt-settings | 기부금 영수증 설정 | 2 | 없음 | 폼 | donations·hyosung |
| adm-audit | 활동 로그 검색 | 0 | 없음 | 표 | security-audit와 중복 의심 |
| adm-hyosung | 효성 CMS+ 관리 | 2 | 없음 | 표 | donations·finance-income |
| adm-campaigns | 캠페인 관리 | 2 | 없음 | 표 | content |
| adm-activity-report | AI 활동보고서 | — | — | — | report·unified-dashboard |
| adm-security-audit | 보안·감사 로그 | — | — | — | audit와 중복 의심 |
| adm-settings | 시스템 설정 | 1+ | 없음 | 폼 | (단독) |
| adm-eligibility | 자격 변경 심사 | — | — | — | members·operators |
| adm-expert-match | 1:1 매칭 관리 | — | — | — | expert-profiles·support |
| adm-expert-profiles | 전문가 프로필 관리 | — | — | — | expert-match·agency-mgmt |
| adm-report | 주간 보고서 | — | — | — | activity-report·unified-dashboard |
| adm-unified-dashboard | 통합 분석 대시보드 | — | — | — | dashboard·ai와 중복 의심 |
| adm-finance-income | 수입 현황 | 13 | 없음 | 차트 | finance-budget·finance-report·donations |
| adm-finance-budget | 예산·지출 관리 | — | — | — | (위와 같음) |
| adm-finance-report | 재무 보고서 | — | — | — | (위와 같음) |
| adm-notification-logs | 알림 발송 로그 | — | — | — | 발송 5개 외부 페이지와 묶기 |

**관찰**:
- 31개 SPA 화면 중 **중복 의심 페어 4쌍**: dashboard↔unified-dashboard / audit↔security-audit / ai↔unified-dashboard / activity-report↔report
- **사이렌 4종**(incidents·harassment·legal·board)은 거의 동일 구조 — 1페이지 + 4탭으로 통합 강력 후보
- **재정 3종**(income·budget·report) + **후원 3종**(donations·hyosung·receipt-settings)도 통합 후보
- **회원 도메인 3종**(members·operators·eligibility)도 1페이지 + 탭 통합 후보
- **발송 6종**(템플릿·그룹·작업·AI 자동·분석·알림 로그) — 외부 페이지 5개 + SPA 1개 혼재. SPA 통합 또는 별도 모듈로 분리 결정 필요

---

## 4. mock·미사용 의심 후보

> 출처: Explore subagent grep 결과 (admin*.js 48개)

### 4.1 mock 의심: **0건**

`MOCK`·`DEMO`·`샘플 데이터`·`더미` 등 패턴 검색 결과 0건. Phase 17까지 진행되며 모두 실 API 연결 완료 상태. **이 부분은 좋은 신호**.

### 4.2 하드코딩 데이터: 2건 (모두 placeholder 라벨, 실 데이터 없음)

| 파일 | 라인 | 컨텍스트 |
|---|---|---|
| `admin-agency-mgmt.js` | 87 | `placeholder="홍길동"` (입력 안내용) |
| `admin-template-edit.js` | 53 | `placeholder="예) 홍길동"` (입력 안내용) |

→ 정상. 삭제 대상 아님.

### 4.3 TODO 주석: 2건

| 파일 | 라인 | 컨텍스트 |
|---|---|---|
| `admin-idle-guard.js` | 44 | "자동 로그아웃 예정" — Phase 17에서 구현됨, 주석만 남은 듯 |
| `admin-site-builder.js` | 510 | "점진적으로 추가될 예정입니다" — 메인 화면 편집기 |

→ 사소함. 정리 단계에서 함께 제거 가능.

### 4.4 API 호출 적은 파일 (재검토 필요)

> ⚠️ **주의**: subagent가 `await fetch(`·`await api(` 패턴만 검색해서 0~2건으로 잡혔으나, 다른 헬퍼 패턴(`api(...).then`, `fetchJSON` 등) 사용 시 잘못 잡힐 수 있음. **단순 통계, 미사용 단정 X — 메인이 직접 검증 후 결정**.

| 파일 | 총 줄 | 잡힌 호출 수 | 메모 |
|---|---:|---:|---|
| `admin-agency-mgmt.js` | 377 | 0 | Phase 14 신규 — 다른 헬퍼 사용 가능성 매우 높음 |
| `admin-finance-income.js` | 190 | 0 | Phase 5~7 운영 중 — 위와 같음 |
| `admin-referral.js` | 579 | 0 | Phase 14 신규 — 위와 같음 |
| `admin-idle-guard.js` | 138 | 1 | 비활성 감지(Phase 17) — API 거의 안 씀이 정상 |
| `admin-finance-report.js` | 176 | 1 | Phase 5~7 운영 중 |
| `admin-notification-logs.js` | 225 | 1 | Phase 8 운영 중 |
| `admin-send-analytics.js` | 189 | 1 | Phase 10 R4 운영 중 |
| `admin-siren-stats.js` | 487 | 2 | Phase 13 운영 중 |
| `admin-security-audit.js` | 363 | 2 | Phase 17 운영 중 |
| `admin-send-jobs.js` | 206 | 2 | Phase 10 R3 운영 중 |

→ 위 10개 모두 최근 Phase에서 만든 화면. **삭제 대상 아닌 것이 거의 확실**. 다만 메인 설계 시 1회 재확인 권장.

### 4.5 운영자가 직접 판단해야 할 후보 (코드만으로는 식별 불가)

다음은 **Swain만 답할 수 있는** 영역:

| 메뉴 | 의심 사유 | Swain 결정 필요 |
|---|---|---|
| 자유게시판 관리 (siren-board) | 사이렌 신고가 본체인데 자유게시판이 운영 동선에 자주 쓰이는지? | 빈도 낮으면 통계만 노출, 관리는 사이렌 신고 페이지 내 탭으로 흡수 |
| 익명 신원 식별 / 익명 감사 로그 | 별도 외부 페이지 2개로 분리 — SPA 안 사이렌 그룹과 별개 동선 | SPA 안 사이렌 그룹으로 흡수해도 되는지? |
| AI 추천 센터 (ai) | 통합 분석 대시보드와 데이터 영역 겹침 의심 | 둘 다 유지? 통합? 한쪽 폐기? |
| 통합 분석 대시보드 (unified-dashboard) | 기본 대시보드와의 차이가 운영자에게 명확한지? | 둘 다 필요? 하나로 통합? |
| 감사 로그 (audit) vs 보안·감사 로그 (security-audit) | 둘 다 감사 로그 — 청사진상 super_admin 전용 vs 일반 어드민 | 한 화면 + 권한 탭으로 통합 가능? |
| 주간 보고서 (report) vs AI 활동보고서 (activity-report) | 둘 다 보고서 — 자동 생성 vs 수동 보고 | 한 화면 + 탭으로 통합 가능? |
| CSV 자동 매핑 (cms-tbfa.html#csv-import 외부 이동) | 후원금 관리 안에 흡수 가능성 | 후원금 관리 페이지 내 탭으로 옮기는 것 어떤지? |
| 메인 화면 편집 (admin-site-builder.html 외부) | 콘텐츠 관리와 영역 겹침 의심 | 콘텐츠 관리 안 1탭으로? 별도 유지? |

---

## 5. 1·2뎁스 IA 초안 (A 입장 — 최종 결정은 메인·Swain)

> 평면 35개 → **1뎁스 8그룹 + 각 그룹 2~5개 2뎁스 / 화면 안 탭 통합**

### 5.1 제안 구조

```
🏠 대시보드 (단일)
   └ 통합 분석 대시보드 흡수 또는 탭 분리

👥 회원·운영자
   ├ 회원 관리 (회원 + 자격 변경 심사 + 가입 승인 탭)
   ├ 운영자 관리
   └ 1:1 매칭 / 전문가 프로필 / 외부 기관 / 인계 이력
       ※ "전문가·기관 관리" 1페이지 + 4탭으로 통합

💰 후원·재정
   ├ 후원금 관리 (후원금 + 효성 CMS+ + CSV 자동 매핑 + 영수증 설정 탭)
   ├ 수입·예산·재무 보고서 1페이지 3탭
   └ 캠페인 관리

🚨 사이렌 신고
   ├ 신고 처리 (사건·악성민원·법률·자유게시판 4탭 통합)
   ├ 신고 통계 (siren-stats)
   └ 익명 신원 식별 / 익명 감사 로그 2탭 (super_admin 전용 노출)

🤝 유가족 지원·문의
   ├ 유가족 지원 관리
   └ 문의 관리 (채팅)

📨 알림·발송
   ├ 발송 작업 (즉시·예약)
   ├ 발송 템플릿
   ├ 수신자 그룹
   ├ AI 자동 발송
   └ 발송 분석 + 알림 로그 2탭

📝 콘텐츠·보고서
   ├ 메인 화면 편집 (site-builder)
   ├ 콘텐츠 관리
   ├ 주간 보고서 + AI 활동보고서 2탭
   └ AI 추천 센터 (유지 시)

⚙️ 시스템·보안
   ├ 시스템 설정
   ├ 감사 로그 + 보안·감사 로그 2탭
   └ (필요 시 추가)

🛠 워크스페이스 (현재 그대로 토글)
```

### 5.2 압축 효과

| 지표 | 현재 | 제안 후 |
|---|---:|---:|
| 1뎁스 메뉴 (사이드바 클릭 항목) | 35 | **8** |
| 평균 1뎁스→2뎁스 클릭 깊이 | 1 | 2 |
| 같은 화면 안 평균 탭 수 | 0~1 | 2~3 (관련 기능 통합) |
| 사이드바 아이콘 중복 (📊·💬·⚖️) | 9건 | 0건 (1뎁스만 아이콘 부여) |

### 5.3 화면 안 "버튼 즐비" 해소 패턴

| 패턴 | 적용 대상 |
|---|---|
| **상단 액션 바**: 자주 쓰는 액션 1~2개만 노출 (예: [+ 등록]) | 모든 목록 화면 |
| **행별 드롭다운**: 행 액션 4개+이면 [⋯] 메뉴로 묶기 (편집·삭제·복제·이력) | members·donations·content·campaigns |
| **세부 화면 = 모달 → 우측 슬라이드 패널**: 좁은 모달 대신 넓은 패널로 가독성 ↑ | 모든 상세·편집 |
| **필터 = 한 줄 + 고급 필터 접기**: 기본 필터 2~3개 + "고급" 토글 | 모든 목록 |
| **상태 = 색깔 칩**: 텍스트 대신 칩으로 빠른 스캔 | siren·donations·referral·매칭 상태 |

---

## 6. Swain·메인 결정 필요 항목 (질문지)

> 메인 채팅이 Swain께 모아서 한 번에 질문 추천. 답변 받은 후 메인이 마일스톤 설계서 작성.

### 6.1 폐기·통합 결정 (Swain 운영 판단)

| Q# | 질문 | 선택지 |
|---|---|---|
| Q1 | 자유게시판 관리(siren-board)는 운영 동선에 자주 쓰이나? | 자주 / 가끔 / 거의 안 씀 (안 씀이면 통계만 노출 + 사이렌 처리 안 흡수) |
| Q2 | 대시보드(dashboard)와 통합 분석 대시보드(unified-dashboard) 둘 다 필요? | 둘 다 / 통합 / 통합 분석만 남김 |
| Q3 | AI 추천 센터(ai)는 실제로 사용 중? | 자주 / 가끔 / 안 씀 (통합 분석 안으로 흡수 후보) |
| Q4 | 감사 로그(audit) vs 보안·감사 로그(security-audit) 통합 가능? | 1페이지 2탭 통합 / 별도 유지 |
| Q5 | 주간 보고서(report) vs AI 활동보고서(activity-report) 통합 가능? | 1페이지 2탭 통합 / 별도 유지 |
| Q6 | 익명 신원 식별·익명 감사 로그 외부 페이지 2개 → SPA 안으로 흡수? | 흡수 / 외부 유지 (super_admin 전용 격리 목적) |
| Q7 | 메인 화면 편집(site-builder)은 콘텐츠 관리 안으로? | 흡수 / 별도 유지 (큰 도구라 별도가 나음) |
| Q8 | "사용 안 하는 메뉴"로 추가 제거 후보? | 자유 응답 (Swain만 아는 영역) |

### 6.2 IA·디자인 방향 결정

| Q# | 질문 | 선택지 |
|---|---|---|
| Q9 | §5.1 1뎁스 8그룹 초안 동의? | 동의 / 일부 수정 (구체 의견) / 전면 재설계 |
| Q10 | 디자인 톤 | 미니멀 라이트 (현재) / 다크 모드 옵션 추가 / 강조 컬러 변경 / 기존 톤 유지하되 정돈만 |
| Q11 | 사이드바 너비·접기 동작 | 고정 너비 / 토글 가능 / 호버 시 펼침 |
| Q12 | 모바일 반응형 우선순위 | 데스크톱 전용 (현재) / 태블릿까지 / 모바일까지 |
| Q13 | 부가 기능 우선순위 | 빠른 검색(Cmd+K) / 즐겨찾기 / 최근 본 메뉴 / 부가 기능 없음 |

### 6.3 작업 진행 방식

| Q# | 질문 | 선택지 |
|---|---|---|
| Q14 | 마일스톤 진행 방식 | 한 번에 전체 리뉴얼 (3~4주) / 영역별 단계 리뉴얼 (1주씩 8주) / 핵심 그룹 우선 + 나머지 점진 |
| Q15 | 진행 중 라운드(Phase 16 검증·Phase 17 마이그) 처리 | 먼저 마감 후 시작 / 병행 진행 / 메인 판단 |
| Q16 | 디자인 시스템 도입 범위 | 토큰만(컬러·여백·폰트) / 컴포넌트 일부(버튼·입력·표) / 전체 컴포넌트 라이브러리 |

---

## 7. A 입장 추천 (참고용, 최종 판단은 Swain)

| 추천 | 이유 |
|---|---|
| **§5.1 IA 8그룹 초안 채택** | 평면 35개 → 8그룹 + 같은 영역 화면 탭 통합으로 "버튼 즐비" 핵심 해소. 추가 검토 시간 절감 |
| **사이렌 4종(incidents·harassment·legal·board) 1페이지 4탭 통합** | 거의 동일 구조라 코드·UX 양쪽 큰 효과 |
| **재정 3종·후원 3종·전문가 4종 탭 통합** | 운영 동선상 함께 보는 정보. 페이지 이동 횟수 ↓ |
| **중복 의심 4쌍은 Swain 판단 후 통합** | dashboard·audit·report 페어 — 합치면 사이드바 -3건 |
| **디자인은 "미니멀 라이트 + 토큰 정돈" 추천** | 기존 톤 큰 변경 없이 일관성·여백·타이포만 잡으면 회귀 위험 최소 |
| **마일스톤 진행은 영역별 단계 리뉴얼 추천** | 한 번에 전체 = 회귀 위험 매우 큼. 사이렌 4종 통합 → 회원·후원 → 발송 → ... 단계 권장 |

---

## 8. 다음 단계

1. 본 문서 push 완료 → 메인 채팅에 보고
2. 메인이 §6 질문지를 Swain께 모아서 한 번에 질문
3. Swain 답변 → 메인이 Phase 20 최종 마일스톤 설계서 작성 (단계 분할 포함)
4. 4채팅 트리거 분배 (각 단계마다 B 또는 A 또는 둘 다)

---

## 9. 변경 이력

| 일시 | 작성 | 내용 |
|---|---|---|
| 2026-05-11 | A 채팅 | 신설 — 사이드바 35메뉴 전수표 + SPA 31섹션 인벤토리 + mock 식별 + 1·2뎁스 IA 초안 + Swain 결정 질문 16개 |
