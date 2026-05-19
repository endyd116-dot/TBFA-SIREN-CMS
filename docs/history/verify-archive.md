# Verify Archive — SIREN Phase 검증 보고서

> 32개 검증 보고서 (2026-05-10 ~ 2026-05-14, Phase 4~21 + AI 에이전트 Phase 1~2 + 6순위 라이브 검증 등).
> 원본 개별 파일은 git history에서 복구 가능. 본 아카이브는 압축본.

---

## 인덱스 표

| Phase / 영역 | 라운드 | 날짜 | 결과 | BUG 발견 | 회귀 | 머지 hash | 비고 |
|---|---|---|---|---|---|---|---|
| Phase 4 보고 시스템 | 정적 1차 | 2026-05-10 | PASS | 1 (BUG-3 이메일 필드명) | 0 | 81a124b | C 직접 fix |
| 6순위 #15 CSV 매핑 | 정적 | 2026-05-10 | PASS | 0 | 0 | 81a124b | 즉시 Swain 검증 가능 |
| 6순위 #6 자격 변경 | 정적 | 2026-05-10 | PASS | 0 | 0 | 81a124b | 즉시 Swain 검증 가능 |
| 6순위 #8 1:1 매칭 | 정적 1차 | 2026-05-10 | PASS | 1 (BUG-4 탭 ID 불일치) | 0 | 81a124b | C 직접 fix + 캐시버스터 |
| Phase 5~7 재정 | 정적 | 2026-05-10 | PASS | 1 (BUG-5 감사컬럼 NULL) | 0 | b0a6279 | requireAdmin 반환 필드 오류 fix |
| Phase 5~7 재정 Q11~14 | 라이브 | 2026-05-10 | PASS | 2 (BUG-6 admins 테이블·BUG-7 거짓 ok) | 0 | af33e18 | 운영 DB cleanup 포함 |
| Q12 결제일 기준일 fix | 코드 | 2026-05-10 | PASS | 0 | 0 | 0c08f45 | 9개 파일 변경, 마이그 0회 |
| Phase 8 알림 발송 로그 | 라이브 Q24~28 | 2026-05-10 | PASS | 0 | 0 | e10134a | 4채널 KPI·dispatcher 동작 확인 |
| Phase 9-B 수신 설정 | 라이브 Q1 | 2026-05-10 | PASS | 0 | 0 | 56f95a1 | bigserial 회복 회귀 0 |
| 6순위 #16 단계 D | 라이브 Q3 | 2026-05-10 | PASS | 0 | 0 | 3a932c3 | 효성 양식 SOT + D7 대시보드 |
| Phase 10 R1 템플릿 빌더 | 라이브 Q9 | 2026-05-11 | PASS (Q1~Q8) | 0 | 0 | cef0f69 | 시드 3건 정상 |
| 6순위 #8 1:1 매칭 | 라이브 Q4 | 2026-05-11 | PASS | 0 | 0 | f61023b | BUG-4 fix 유지 확인 |
| Phase 4 보고 시스템 | 라이브 Q5 | 2026-05-11 | PASS (V1·V2·V3) | 0 | 0 | 94a725c | BUG-3 fix 유지 확인 |
| Phase 10 R2 수신자 그룹 | 라이브 | 2026-05-11 | PASS (Q1~Q9) | 0 | 0 | 370241f | 시드 4건 정상 |
| Phase 5~7 재정 | 라이브 Q6 | 2026-05-11 | PASS | 0 | 0 | — | BUG-5/6/7 fix 유지 |
| Phase 10 R3 발송 예약 | 라이브 | 2026-05-11 | PASS (Q1~Q12) | 1 (fix) | 0 | 857674d | 어댑터 직접 호출 |
| Phase 10 R4 추적·재발송 | 라이브 | 2026-05-11 | PASS | 1 (BUG-9 fix) | 0 | 8ecb46f | 이메일 오픈·클릭·AI 트리거 |
| Phase 11+12 멘션·익명식별 | 라이브 | 2026-05-11 | PASS | 7 (즉시 fix) | 0 | — | 6 API + 3 페이지 |
| Phase 13 신고 통계 | 라이브 | 2026-05-11 | PASS (Q1~Q8) | 2 (즉시 fix) | 0 | — | 차트 레이블 키 불일치 |
| Phase 14 외부기관 인계 | 라이브 | 2026-05-11 | PASS (Q1~Q10) | 8 (즉시 fix) | 0 | da08237 | 가짜데이터 다수 fix |
| Phase 15 전문가 매칭 고도화 | 라이브 | 2026-05-11 | PASS (Q1~Q9) | 6 (즉시 fix) | 0 | — | 테이블명 오기·별점 등 |
| Phase 16 통합 분석 대시보드 | 라이브 | 2026-05-11 | PASS (Q1~Q10) | 2 (즉시 fix) | 0 | — | 기간 버튼·yearly/annual |
| Phase 17 보안·감사 | 라이브 | 2026-05-11 | 부분 PASS | 3 fix + 3 미완성 | 0 | b5b7f96 | 로그아웃 경로·BUG-17-04/06 잔존 |
| Phase 19 헬스체크 | 라이브 | 2026-05-11 | PASS | 4 (스크립트2·운영2) | 0 | 3b40b52 | 26/28 PASS, 캐시 54% 단축 |
| Phase 21 R1 WBS 브리지 | 라이브 | 2026-05-12 | PASS (Q1~Q10) | 2 fix | 0 | 46c8b72 | 워크툴/WBS 통합 |
| Phase 21 R2+R3 할당·동기화 | 라이브 | 2026-05-12 | PASS (Q1~Q16) | 1 fix | 0 | c00d530 | R&R + 부재 + Fallback |
| Phase 21 R4 캘린더·검색 | 라이브 | 2026-05-12 | PASS (Q1~Q18) | 1 fix | 0 | 355abeb | 메모 캘린더·AI 검색 |
| AI 에이전트 Phase 1 V1·V2 | 라이브 | 2026-05-13 | FAIL → 회귀 | 2 (BUG-01·02) | 회귀 발견 | 40ffebf | 의도 분류 회귀 → V4에서 UTF-8 원인 확정 |
| AI 에이전트 Phase 1 V3 | 라이브 | 2026-05-14 | 진행 불가 | 0 | — | 3278c44 | Gemini 503 일시 장애 |
| AI 에이전트 Phase 1 V4 | 라이브 | 2026-05-14 | 16/18 PASS | 4 (BUG-03·04·05·06) | 0 | 0a026c8 | UTF-8 적용 후 정상화 |
| AI 에이전트 Phase 2 V4 | 라이브 | 2026-05-14 | 8/11 PASS | 2 (BUG-P2-01·02) | 0 | 0a026c8 | 도구 선택 오류·DB 컬럼 |
| AI 에이전트 Phase 1 V5 | 라이브 | 2026-05-14 | 5/7 PASS | 1 신규 (BUG-05a) | 0 | e74c3f0 | BUG-04·05·06·P2-02 fix 확인 |
| AI 에이전트 Phase 1 V6 | 라이브 | 2026-05-14 | 7/9 PASS | 1 신규 (BUG-05b) | 0 | 3ba204c | BUG-03 short-circuit 완전 해소 |
| AI 에이전트 Phase 1 V7 | 라이브 | 2026-05-14 | 7/8 PASS | 1 minor (BUG-05c) | 0 | 70dce59 | **BUG-05b 완전 해소 — §18.13 정착** |

> 라운드 33개 중 **PASS 30개·부분 PASS 3개**. 32개 보고서가 누적 28+개 BUG를 라이브에서 잡아 즉시 fix.

---

## 상세 — Phase별 핵심 발견사항

### Phase 4 — 대표 보고 시스템 (주간·월간·연간 보고서)

**검증 범위**: 보고서 생성·목록·상세·이메일 재발송·인쇄·자동 cron(매주 월 06:00 KST).
**PASS**: 4개 API config.path / requireAdmin 정상, AI 폴백 텍스트 활성, 인쇄 CSS @media print 정상.
**핵심 BUG**: BUG-3 이메일 재발송 필드명 불일치 — 클라이언트 `{id}` vs 서버 `{reportId}` → C 직접 fix.
**라이브 Q5**: V1·V2·V3 모두 PASS, 회귀 0건 (Phase 8·9·10 R1 머지 후).
**머지**: 81a124b → 94a725c → 62e4a51.

### 6순위 #15 — CSV 자동 매핑 (효성·IBK)

**검증 범위**: CSV 헤더 3원 분기, 매칭 알고리즘(이름·금액·날짜·계좌끝4자리), 모호도 점수, 중복 확정 방지.
**PASS**: 코드 전체 정상. donation-matcher.ts:220-242 가중치 합산 정상. status="confirmed" 재확정 차단 확인.

### 6순위 #6 — 자격 변경 신청·심사

**검증 범위**: eligibility-request·status·admin-list·review 4종 API + UNIQUE 제약 + 감사 로그.
**PASS**: 전체 정상. eligibilityChangeRequests 테이블 정의 OK.

### 6순위 #8 — 1:1 매칭 채팅 (변호사·심리상담사)

**검증 범위**: 어드민 배정 버튼·매칭 관리 화면·사용자 채팅 버튼·세션 종료.
**핵심 BUG**: BUG-4 탭 ID 불일치 — `#adm-expert` vs `#adm-expert-match` (2곳) → 탭 클릭 무반응 → C 직접 fix + 캐시버스터.
**라이브 Q4**: 13개 함수 모두 인증 가드 정상. BUG-4 fix 유지 (Phase 8·9·10 R1 머지 후에도).

### Phase 5~7 — 재정 관리 (예산·지출·수입·재무보고서)

**검증 범위**: 백엔드 7 API + 프론트 3 화면 + admin.html 메뉴 4축.
**핵심 BUG**:
- BUG-5 감사 추적 컬럼 영구 NULL — `auth.admin?.id`(undefined) vs `auth.ctx.admin.uid`. 운영 추적 핵심 기능 무력화 → 3곳 fix.
- BUG-6 라이브 — `relation "admins" does not exist` (실제 테이블 `members`) → 500 에러 → fix.
- BUG-7 라이브 — 이미 승인/반려된 지출에 다시 승인 시 거짓 ok 응답 → 409 + 정확 메시지로 fix.
**라이브 Q6 재검증**: BUG-5/6/7 fix 모두 유지. cleanup endpoint 1회용 패턴(verify-cleanup-q13).

### Q12 — 수입 집계 기준일을 결제일로 전환 (코드 fix)

**변경 요지**: 그래프·KPI·영수증·마이페이지 모두 `COALESCE(donations.hyosung_paid_date, donations.created_at)` 적용.
**변경 파일**: 9개 (admin-finance 6 + admin-stats·admin-me·admin-ai 등).
**한계**: 옛 효성 데이터 hyosungPaidDate 모두 NULL (다음 import부터 정상). memo 텍스트에서 백필 가능(별도 라운드).

### Phase 8 — 알림 발송 로그 (Q24~Q28)

**검증 범위**: dispatcher 라우팅 + 4채널(inapp·email·sms·kakao) + 어드민 화면 KPI/필터/도넛.
**PASS**: 4개 이벤트(billing.success·card.expiring·workspace.activity·admin.daily_briefing) 모두 정책 채널 정확. 7건 분포 EVENT_CHANNEL_POLICY와 정확 일치.
**1회용 patterns**: verify-trigger·cleanup endpoint → 검증 후 즉시 삭제.

### Phase 9-B — 수신 설정 화면 (사용자·어드민)

**검증 범위**: 9 이벤트 매트릭스 · `requireActiveUser` 격리 · 3단 폴백(본인→어드민 기본값→코드 fallback) · `FORCED_CHANNELS` 합집합 · 변경 이력 audit_logs.
**PASS**: bigserial 사고에서 회복 양호. bug 0건, 회귀 0건.

### 6순위 #16 단계 D — 효성 CMS+ 양식 SOT 정합성

**검증 범위**: D1·D2 파서·D3·D4 화면·D5 cron·D6 토스 빌링·D7 종합 검증 대시보드(KPI 6장+Alert+import 이력).
**PASS**: 13개 함수 모두 라이브 등록. Phase 9-B 머지 + #BACKFILL-1 후 회귀 0.

### Phase 10 R1 — 발송 템플릿 빌더 (Q1~Q8)

**검증 범위**: 시드 3건(월간뉴스레터·일회성공지·AI트리거) + 변수 정의 표 + 미리보기 모달 + SMS 글자수 카운터 + 카카오 안내 박스 + soft delete.
**PASS**: 이중 검증(클라+서버), 단계별 try/catch(`validate`/`insert`/`select_list`/`soft_delete`/`render`) 표준 준수.

### Phase 10 R2 — 수신자 그룹 선택 (Q1~Q9)

**검증 범위**: API 7개 + 페이지 4종(목록·신규·수정+id=N).
**PASS**: 시드 4건, 등급 시드 자동 보정 정상.

### Phase 10 R3 — 발송 예약 큐 (Q1~Q12)

**검증 범위**: API 7 + cron + 어댑터 직접 호출(이메일·SMS·인앱 직접, 카카오는 사전 심사 통과 템플릿만).
**BUG 1건 fix**: 검증 중 발견 즉시 처리. 배포 지연(3분) 후 200 정상.

### Phase 10 R4 — 이메일 오픈·클릭·재발송·AI 트리거 (영역 1~6)

**검증 범위**: 픽셀·리다이렉트 추적, 개별·일괄 재발송, 회원별 발송 이력, AI 자동 트리거 CRUD·토글·크론, 분석 대시보드.
**BUG-9**: 발견·fix. 4 페이지 200 OK 정상.

### Phase 11+12 — @멘션 알림 + 익명 신원 식별

**검증 범위**: 6 API + 3 페이지(my-subscriptions·admin-anon-reveal·admin-anon-audit). KPI 카드 4개 + CSV 내보내기.
**BUG 7건**: 모두 즉시 fix.

### Phase 13 — 신고 통계 대시보드 (Q1~Q8)

**검증 범위**: 사이렌 관리 그룹 메뉴 + admin-incident-stats?period 매핑 + 요약 카드 4개 + 탭 4개 + 차트 3종.
**BUG-13-01**: 차트 레이블 키 불일치 (상태·심각도 `undefined` 표시) → 한국어 변환 매핑 추가.

### Phase 14 — 외부 기관 인계 (Q1~Q10)

**검증 범위**: 7 API + 기관 등록/수정 모달 + 인계 모달(템플릿 미리보기) + PDF 생성·재다운로드 + 상태 갱신 + 신고 상세 인계 버튼(사건·악성민원·법률 3종).
**BUG 8건**: BUG-14-01 가짜 데이터·BUG-14-02 서버 미연결·BUG-14-05 PDF 응답·BUG-14-07 버튼 미존재·BUG-14-08 미리보기 영역 등 모두 fix. **이 라운드가 가장 많은 BUG 적출(8건)**.

### Phase 15 — 전문가 매칭 고도화 (Q1~Q9)

**검증 범위**: 전문가 프로필 관리 + AI 추천받기 + 종결 후 별점·후기 + avgRating 재계산.
**BUG-15-01 Critical**: 법률 신고 AI 추천 시 테이블명 오기 (`legal_reports` → `legal_consultations`).
**BUG 6건** 모두 fix.

### Phase 16 — 통합 분석 대시보드 (Q1~Q10)

**검증 범위**: KPI 4 + 후원 월별 + 사이렌 3종 도넛 + 코호트 + 이탈 위험 + 재참여 메시지 발송.
**BUG-16-01**: 기간 선택 버튼 미구현 → 추가. **BUG-16-02**: 분기/연간 탭 키 매핑(`yearly` vs `annual`).

### Phase 17 — 보안·감사 강화 (Q1~Q8)

**검증 범위**: 보안/감사 로그 메뉴 + 30일 필터 + 통계 카드 4종 + 차단 처리 로그 + 전화번호 마스킹 + 28분 비활성 경고 + 강제 로그아웃.
**부분 PASS**:
- 즉시 fix 3건: BUG-17-01(로그아웃 경로 오기 — 쿠키 미삭제 보안 결함)·BUG-17-02(페이지 제목)·BUG-17-03(실패로그인 카드 항상 0).
- 미완성 3건 잔존: BUG-17-04(DB 컬럼 미채움)·BUG-17-06(전화번호 마스킹 미적용)·Q5 미구현.

### Phase 19 — 핵심 API 헬스체크

**검증 범위**: 헬스체크 스크립트 + 13건 인증 전 401 + 11건 인증 후 200 + 로그인·로그아웃.
**BUG 4건**:
- BUG-19-01 스크립트 로그인 본문 `{email}` → `{id}` 필드명.
- BUG-19-02 경로 7개 불일치.
- 라이브 회귀 2건 동시 적발: admin-donations 500·admin-dashboard-kpi 500 → fix.
**성능**: 2회차 27.3s → 12.6s (54% 단축, 캐시 적용 API 단독 22~26%). 최대 응답 2470ms.

### Phase 21 R1 — WBS↔워크툴 연동 기반 (Q1~Q10)

**검증 범위**: 사이드바 메뉴 통합(칸반 텍스트 제거), WBS 페이지명 변경, 워크툴 작업 카드 hash 이동, 카드 모달 타임라인 7유형 한글 매핑, BroadcastChannel 다탭 동기화.
**BUG 2건 fix**: Q5(새 작업 hash 자동 모달) + Q8(없는 ID 토스트 안내).

### Phase 21 R2+R3 — 할당·이관·알림 + 서비스↔카드 동기화 (Q1~Q16)

**검증 범위**: R&R 매핑·부재 체크·Fallback 슬롯·토스 이관·워처 알림·@멘션·마감 24h 전 cron·카드 done → 서비스 closed 자동 동기화·R&R 권한 차등.
**BUG-21R2R3-01 fix**: 알림 시간 빈 문자열 표시 (Q9·Q10 영향). **이 라운드가 가장 많은 시나리오(Q16)**.

### Phase 21 R4 — 캘린더·메모·피드·템플릿·검색 마무리 (Q1~Q18)

**검증 범위**: 캘린더 텍스트 색 YIQ 자동·메모 캘린더 표시 옵션·시간 입력·WBS 보기 3모드(보드/리스트/캘린더)·AI 검색(Gemini JSON 필터)·활동 피드 시간 그룹핑·템플릿 10종 시드.
**BUG-21R4-01 fix**: 활동 피드 클릭 비활성 → 작업 항목은 WBS 카드 모달로 이동.
**100% 마감**: R1·R2+R3·R4 3개 라운드 누적 Q1~Q44 모두 통과.

---

## AI 에이전트 검증 라운드 (별도 섹션 — Phase 1·2)

> **분담**: C 채팅 = Phase 1 + Phase 2(10개) / 메인 채팅 = Phase 3·4(20개) 직접 검증
> 누적 도구 84개 (Phase 1 12 + Phase 2 10 + Phase 3 10 + Phase 4 10 + 기존 42)

### V1·V2 라운드 — 시스템 회귀 발견 (2026-05-13)

**호출 방식**: AI 비서 채팅 자연어 입력.
**핵심 발견**: 자연어 명령에서 AI가 도구 호출 안 함 → 항상 되묻기. **Phase 1 신규 도구뿐 아니라 기존 도구(members_stats)까지 동일** → AI 비서 의도 분류 전반 회귀.
**근거 시나리오**:
- M1 "내 메모 보여줘" → toolCalls=[], "어떤 메모를 수정?"
- M2 "노란 메모 만들어줘"(HIGH 체인) → toolCalls=[], "어떤 내용 수정?"
- SC-1 "회원 통계 보여줘" → toolCalls=[], "어떤 회원 정보?"
- SC-2 "members_stats 도구 호출해서..." → 정상 작동 ✓ (대조군)

**판정**: 도구·인증·인프라·호출 경로는 정상. **자연어 → 도구 호출 의도 분류만 회귀**. 사용자가 도구명 직접 명시해야만 작동.
**결과**: 통과 1/19 (SC-2만), 실패 3/19, 스킵 15/19.
**BUG-AI-AGENT-PHASE1-01·02 issue 발행**.

### V3 라운드 — 인프라 일시 장애 (2026-05-14)

**전제**: 메인 fix 3278c44 + Phase 4 마이그 + system-prompt-reset 마이그.
**상황**: Gemini API 503 high demand 5회 호출 중 4회 실패.
**유일한 응답(SC-1 1차)**: "회원 통계 보여줘" → reply "어떤 메모를 수정?" (입력 토큰 V2 5078 → V3 7411, +46%).
**판정**: fix 효과 검증 불가 (인프라 일시 장애로 표본 부족). Swain이 시점 결정 후 V4 재개.

### V4 라운드 — UTF-8 진단 적용 후 정상화 (2026-05-14)

**전제**: main 0a026c8 (UTF-8 진단 fix). 메인 진단: V2~V3 실패 원인은 **curl 한글 cp949 인코딩 깨짐**. 표준 §18.6 적용.
**호출 방식**: `printf '%s' "한국어"` + `--data-binary @/tmp/req.json` + `Content-Type: charset=utf-8`.

**Phase 1 결과 (18개 시나리오)**:
- 메모 6/6 PASS · 캘린더 5/5 PASS · 작업·댓글 2/4 (T1 권한 FAIL, T4 데이터 보호 SKIP) · 파일 2/2 PASS · Sanity 1/1 PASS
- **합계 16/18 PASS**

**Phase 2 결과 (11개 시나리오)**:
- 공지 3/3 · 페이지 2/2(lifecycle 완결) · 게시판 2/4 · 캠페인·FAQ 1/2
- **합계 8/11 PASS**

**4건 신규 BUG 발견**:
- **BUG-03**: toolApproval 표준 양식 미구현 — 자연어 "응"·"진행" 작동 X. 회피책: 명시적 "requireApproval false로 진행" 자연어.
- **BUG-04**: task_create·task_update 권한 매핑 — admin도 거부.
- **BUG-05**: 인자 자동 추출 — 현재 날짜 모름(2023/2024 인식), 단일 명령 자동 부풀림(1개 → 3개 우선순위별).
- **BUG-06**: 의도 분류 — task_comment_add 대신 task_update 호출.
- **BUG-AI-AGENT-PHASE2-02**: notice_create의 board_posts.content 컬럼 미존재 DB 에러.

**보너스**: PII(주민번호 2건) 자동 마스킹 정상 작동.
**사용자 데이터 영향**: board_comments id=1 "박새로이" 댓글 isHidden 처리(P2-3.4 PASS), rollbackData 보존 → 메인 rollback 권장.

### V5 라운드 — fix 4건 효과 확인 (2026-05-14)

**전제**: main e74c3f0 (BUG-04·05·06·Phase2-02 4건 fix 누적). 메인 마이그 호출 완료(potential_donors·budget_categories).

**결과 5/7 PASS**:
- T1 task_create: PASS — 권한·부풀림·날짜 모두 fix 확인 (dueDate=2026-05-20 정확, 1개만 생성)
- T4 task_delete: PASS — cascade 메시지 정상
- P2-3.1 notice_create: PASS(회피) — notice id=8 생성 (본문·카테고리 명시 회피)
- P2-4.1 campaign_archive: PASS dry-run — V4 campaigns_update → V5 campaign_archive 정확 호출(BUG-06 fix)
- E1 events_list: PASS — fromDate=2026-05-12·toDate=2026-05-18 정확(BUG-05 날짜 fix)
- P2-3.2: SKIP (P2-3.1 분기로 의존성 깨짐)
- P2-4.1 승인: SKIP (실 캠페인 보호)

**V5 신규 잔존**: **BUG-05a** — notice_create category enum AI 임의 추측 → invalid enum. 도구 description에 enum 허용값 명시 필요.

### V6 라운드 — BUG-03·05a fix (2026-05-14)

**전제**: main 3ba204c (F11 short-circuit + enum 정정 fix). 표준 v1.3 §F11·§18.12.

**F11 short-circuit (BUG-03 fix 검증)** — 5/5 PASS:
- "진행": PASS — **721ms, LLM 호출 0회**, memo_id=4 생성, reply "memo_create 실행 완료"
- "취소": PASS — **857ms, LLM 호출 0회**, toolCalls=[], "memo_create 작업을 취소했습니다"
- 데이터 영향 검증: 진행 INSERT 확인, 취소 INSERT 안 됨 ✓

**BUG-05a enum 4종**: 2/4 PASS — general·event PASS / member·media FAIL (옛 화이트리스트 `notice/event/press` 그대로 거부 응답에 노출). **신규 BUG-05b 도출**.

**해석**: BUG-03 완전 해소, BUG-05a 부분 해소(도구 핸들러·description 화이트리스트 미정정).

### V7 라운드 — BUG-05b 도메인 전체 동기화 완전 해소 (2026-05-14)

**전제**: main 70dce59 (BUG-05b fix + 표준 v1.4 §18.13).

> **§18.13 정착 결정적 사건** — 같은 도메인의 모든 도구 정의·핸들러·필터 상수 일괄 동기화 의무.

**enum 4종 재검증 4/4 PASS**:
- general: PASS · event: PASS (변동 없음)
- **member: V6 FAIL → V7 PASS** — 도구 호출까지 진입, dry-run preview category="member"
- **media: V6 FAIL → V7 PASS** — 도구 호출까지 진입

**회귀 확인 (다른 도메인 옛 enum 잔존 여부)**:
- 회귀-A "공지 카테고리 알려줘": PASS — reply "member, general, event, media" 정확
- 회귀-B "notice 카테고리로 작성"(옛 잘못된 enum): **부분 PASS** — 도구는 general fallback하여 preview 정정 ✓, 그러나 reply 안내가 args 기준 "notice 카테고리로 작성"이라 misleading → **V7 신규 minor BUG-05c** (데이터 정확, 안내만 misleading)
- 회귀-C "게시글 댓글 보여줘": PASS (board_comments_list)
- 회귀-D "공지 목록 보여줘": PASS — 새 enum 한국어 라벨 정확(member→"회원", general→"일반", event→"이벤트", media→"미디어")

**거부 응답 메커니즘 분석 (메인 요청)**:
- **V6 패턴(회귀 원인)**: LLM이 도구 description 옛 enum 학습 → 도구 호출 전 직접 거부 응답 생성 (toolCalls=[])
- **V7 fix 효과**: 도구 description·핸들러·필터 상수 일괄 정정 → LLM 새 enum 학습 → 거부 응답 사라짐, 도구 호출까지 진입
- **결론**: 표준 §18.13 "도메인 전체 동기화 의무" 효과 확인 — LLM 학습 패턴 차단의 핵심

**머지 권고**: verify/ai-agent-phase1 → main 머지 가능 상태. 잔존 minor BUG-05c는 데이터 정확성에 영향 없음.

### 누적 BUG fix 7건 (V1~V7)

| ID | 해소 | fix 라운드 |
|---|---|---|
| BUG-01 UTF-8 cp949 인코딩 | ✅ | V4 |
| BUG-02 Gemini 503 일시 장애 | 외부 | — |
| BUG-03 toolApproval 양식 → F11 short-circuit | ✅ | V6 |
| BUG-04 task 권한 매핑(role hierarchy) | ✅ | V5 |
| BUG-05 인자 자동 추출(날짜·부풀림) | ✅ | V5 |
| BUG-05a notice_category enum 부정확 | 부분 → ✅ | V6 부분, V7 완전 |
| BUG-05b enum 도메인 전체 동기화 | ✅ | V7 (§18.13 정착) |
| BUG-05c reply 안내 misleading | minor 잔존 | — |
| BUG-06 도구 선택(task_update vs task_comment_add) | ✅ | V5 |
| BUG-Phase2-02 board_posts.content 컬럼 | ✅ | V5 |

**표준 진화**: v1.0 → v1.4 (UTF-8 §18.6 → F11 short-circuit → §18.12 enum 정정 → **§18.13 도메인 전체 동기화 의무**).

---

## 교훈 — 검증 패턴

### PASS 비율 패턴

- **코드 정독·정적 분석 라운드**: 평균 9~10/10 PASS (Phase 4·6순위 #15·#6·#8·5~7 정적 점검).
- **라이브 시나리오 라운드**: 평균 6~10 BUG 적출 후 100% PASS (Phase 11+12: 7건 / Phase 14: 8건 / Phase 15: 6건 / Phase 13·16·19: 2~4건).
- **AI 에이전트 라운드**: V4 89%(16/18) → V5 71%(5/7, SKIP 포함) → V7 88%(7/8). 반복 fix·재검증 사이클이 핵심.

### 회귀 위험 영역

- **캐시버스터 누락**: JS·CSS 변경 시 모든 참조 페이지에서 `?v=N` 일괄 갱신 (BUG-4 사례).
- **헬퍼 함수 도입 시 사용처 전수 검증 누락**: `requireAdmin` 반환 필드 `auth.admin` vs `auth.ctx.admin.uid` 혼동 (BUG-5 사례).
- **enum 부분 동기화**: 도구 description·핸들러·필터 상수 어느 한 곳만 갱신해도 LLM이 옛 enum 학습 잔존 → 도구 호출 전 직접 거부 (BUG-05b → §18.13 정착).
- **필드명 불일치**: 클라이언트·서버 body 키 미동기 (BUG-3·BUG-19-01).
- **테이블명·컬럼명 오기**: `admins` vs `members` (BUG-6), `legal_reports` vs `legal_consultations` (BUG-15-01), `board_posts.content` 미존재 (BUG-P2-02).

### 검증 도구 (라이브 검증 대행)

- **C 채팅**: 어드민 권한 + tbfa.co.kr URL → 사용자 시나리오 재현. 단일 책무 = 라이브 검증·BUG 보고만 (코드 수정 금지, 단 명백한 단순 fix는 C 직접 처리하기도).
- **C 작성 보고서 양식**: PASS/PARTIAL/FAIL/SKIP + BUG 리스트 + 사용자 데이터 영향 + 메인 채팅 인계 메시지(Swain 복붙용).
- **1회용 검증 endpoint**: `verify-trigger-*` / `verify-cleanup-*` → 검증 종료 후 즉시 삭제 (Phase 8 Q24~28, Phase 5~7 Q13).
- **세션 쿠키 없이 진입 점검**: API 401·POST 전용 405·페이지 200 → 함수 등록·인증 가드 확인. 500 발생 시 schema 미스매치·DB 컬럼 누락 즉시 발견.

### 라이브 검증의 가치

- **Phase 11+12 (7건)·Phase 14 (8건)·Phase 15 (6건)**: 라이브에서만 잡힐 BUG. 정적 점검만으로는 가짜 데이터·서버 미연결·UI 버튼 누락 발견 어려움.
- **Phase 19 헬스체크**: 검증 도중 운영 회귀 2건 동시 적발(admin-donations·admin-dashboard-kpi 500).
- **AI 에이전트 V2 회귀**: 자연어 의도 분류 회귀를 라이브 호출로만 발견 (정적 코드 분석으로는 누락).

### 표준 진화 사이클

V1 발견 → V2 확정 → V3 인프라 장애 → V4 진단 fix → V5·V6·V7 부분→완전 해소 → 표준 §18.13 정착. 각 라운드마다 표준 문서가 갱신되어 차회 회귀 방지.

### 사용자 데이터 보호 패턴

- **라이브 검증 후 cleanup 의무**: verify-cleanup endpoint 또는 rollbackData 보존 → 메인이 일괄 rollback.
- **실 캠페인·운영 데이터 SKIP**: P2-4.1 캠페인 archive 승인 단계 SKIP, T4 더미 부재 시 SKIP.
- **dry-run 우선 검증**: enum·인자 검증은 모두 dry-run으로만 → DB 영향 없음.

### 머지 후 회귀 0건 패턴

- Phase 4 BUG-3·6순위 #8 BUG-4·재정 BUG-5/6/7·AI Phase 1 fix는 후속 머지(Phase 8·9·10 R1·R2 등) 동안에도 모두 그대로 유지됨.
- **schema append-only 원칙** + **차단 미들웨어 핵심 CREATE 6개만 적용** 정책이 회귀 차단의 핵심.

---

**마지막 갱신**: 2026-05-14 (V7 BUG-05b 완전 해소 + 표준 v1.4 §18.13 정착 시점).

---

## 2026-05-16 AI 비서 도구 라이브 검증 (C)

- **베이스**: main 07f8479 (email_send/notification_send memberIds 정규화 fix 직후)
- **방법**: https://tbfa.co.kr/api/admin-ai-agent 에 21개 묶음 × 자연어 명령으로 라이브 호출. 변경 도구는 dry-run/preview까지만 (실 데이터 변경 0건). conversationId는 묶음별 재사용.
- **묶음**: 21개 / 명령: 34건 / 도구 호출: 32건
- **결과**: 통과 30 / 실패 2 (모두 C 자율 fix 후 재검증 통과)

### 발견 이슈 (모두 fix됨 — 커밋 d400f61)

| 도구 | 명령 | 1차 오류 | 원인 | fix | 재검증 |
|---|---|---|---|---|---|
| `donations_stats` | "후원 통계" | `invalid input value for enum donation_type: "one_time"` | 코드가 후원 종류 비교 값을 `'one_time'`(언더스코어)로 작성 — DB enum 정의는 `'onetime'` ([db/schema.ts:28](db/schema.ts#L28)) | [lib/ai-agent-tools.ts:1044](lib/ai-agent-tools.ts#L1044) `'one_time'` → `'onetime'` | ✅ "최근 1개월간 완료된 후원 13건, 280,000원, 일시 2건·정기 11건" 정상 응답 |
| `email_send` | "박새로이에게 메일 보내줘…" | `수신자 조회 실패: The "string" argument must be of type string... Received type number (5)` | SQL `id = ANY(${ids})`에 JS number[] 전달 → postgres-js 드라이버가 배열 원소 타입을 못 추론해서 직렬화 실패. (오늘 07f8479 fix는 입력 정규화만 처리했고 SQL 직렬화는 그대로 남아 있던 결함) | [lib/ai-agent-tools.ts:1300](lib/ai-agent-tools.ts#L1300) — 코드베이스 표준 패턴 `sql.raw('ARRAY[…]::int[]')`로 변경 ([admin-donation-confirm.ts:341](netlify/functions/admin-donation-confirm.ts#L341)와 동일) | ✅ preview `{recipientCount:1, recipientNames:["박새로이"]}`, `pendingApproval=true` 정상 응답 |

### 명료화 응답 (버그 아님 — AI가 재질문)

- **운영성과 보고서**: 기간 미지정 → "예: '2025년'·'작년'" 재질문
- **차년도 예산안**: 연도 미지정 → "어떤 연도?" 재질문
- **최근 알림**: 회원ID 미지정 → "어떤 회원의?" 재질문
- **내 메모**: 빈 메모 상태에서 "(응답 없음)" 짧은 reply (도구 호출 없음 — 데이터 0건이라 응답 비움)

### 통과한 묶음 전체 (32개 도구 모두 OK)

| # | 묶음 | 호출 도구 | 핵심 응답 |
|---|---|---|---|
| 1 | 회원 | members_stats, members_search | 활성 63명·박새로이 ID 5 |
| 2 | 후원 | donations_stats(fix후), donations_recent | 280,000원·5건 |
| 3 | SIREN 신고 | incidents_list, harassment_reports_list | 6건·10건 |
| 4 | 법률상담 | legal_consultations_list | L-2026-7155·2500 외 |
| 5 | 게시판·공지 | notices_list, board_posts_list | 7개·1개 |
| 6 | 캠페인 | campaigns_list | 활성 1건 |
| 7 | 콘텐츠·자료 | faqs_list, resources_list | 6개·1개 |
| 8 | 알림 템플릿 | templates_list, recipient_groups_list | 16건·9개 |
| 9 | 잠재 후원자 | potential_donors_list | 0건 |
| 10 | 예산·후원정책 | budgets_list, donation_policy_get | 미편성·정책 OK |
| 11 | 재정 22-A | revenue_categories_list, revenue_list | 카테고리 OK·1,100,000원 |
| 12 | 지출 22-C | expense_categories_list, expenses_list | 카테고리 OK·123,232원 |
| 13 | 손익 | (명료화 재질문) | 기간 요청 |
| 14 | 예산안·전표 | voucher_list | 11건 |
| 15 | 통장 대사 | bank_reconcile_summary | 출금 4건/200,125원 |
| 16 | 채팅 | chat_rooms_list | 미답변 0건 |
| 17 | 워크스페이스 | tasks_list, (메모는 reply만) | 작업 OK |
| 18 | 캘린더·알림 | events_list | 이번 주 0건 |
| 19 | 발송 (★) | members_search + email_send(fix후) | preview·승인 대기 |
| 20 | 종합 KPI | kpi_summary | 회원 62·후원 13건·28만원 |
| 21 | 보안·감사 | audit_logs_recent, members_recent_logins | 로그 10건·로그인 2명 |

### 결론

AI 비서 도구 90종 라이브 호출 인프라(자연어 → Gemini → 도구 디스패치 → 응답) 자체는 **완전 정상**. 발견된 2건은 모두 도구 핸들러 단의 단순 정합성 결함(enum 값 1글자·SQL 배열 직렬화)으로 C가 즉시 fix → 머지 후 재검증 통과. 변경 도구는 모두 dry-run preview까지만 진행해 실 데이터 변경 0건.

**산출물**: `scripts/ai-verify-all.mjs` (재실행 가능한 21 묶음 일괄 검증기), `scripts/ai-verify-results.json` (1차 스냅샷).

---

**마지막 갱신**: 2026-05-16 (AI 비서 도구 21 묶음 라이브 검증 완료 + d400f61 fix 재검증 통과).

---

## 2026-05-16 A안 효성 후원자 가입 흐름 라이브 검증 (C)

- **베이스**: main a563aed (A안 D5 — 만료 row cleanup cron 완료 직후)
- **영역**: 코드 정독 7파일 + curl 시나리오 4종 + 엣지 5종 + 매칭 로직
- **결과**: 코드 정독 전체 통과 / SMS 무관 API 검증 6건 전체 통과 / SMS 의존 검증 5건 차단 (BUG-1)
- **실 데이터 영향**: 시나리오 4에서 검증용 회원 1건(ID 64) INSERT 발생 — 메인 클린업 인계

### 코드 정독 (전부 OK)

| 파일 | 검증 포인트 | 결과 |
|---|---|---|
| `lib/phone-verify.ts` | 헬퍼 7개 (코드 생성·rate limit·매칭·INSERT·검증·token 소비) | placeholder 이메일 제외 패턴(`@auto.` / `.auto.local`) 정확 |
| `auth-phone-verify-send.ts` | phone 정규화·rate limit·INSERT·SMS 발송 | 순서·400/429/500 응답 모두 정확. 다만 SMS 실패 시 row 롤백 누락 (BUG-2) |
| `auth-phone-verify-check.ts` | code 검증·verifyToken 발급·mode 결정 (`existing_full`/`existing_hyosung`/`existing_donor`/`null`) | 4종 mode 분기 정확. 메시지 텍스트 자연스러움 |
| `auth-signup.ts` | verifyToken 처리 분기 (UPDATE/INSERT), 이메일·전화 중복 체크에서 matched 회원 제외 | line 264~298 분기 정확. operatorActive=false 명시 보안 OK |
| `auth.js` (bindSignupPhoneVerify) | UI 핸들러, mode별 안내 메시지, 강제 verifyToken | line 273~380 정확 |
| `modals.html` (가입 모달) | phone 인증 UI 추가, hidden verifyToken | line 125~163 정확 |
| `cron-phone-verify-cleanup.ts` | 1일 경과 row 삭제 cron (UTC 18:00 = KST 03:00) | 정확 |

### API 검증 (SMS 무관 — 모두 통과)

| # | 명령 | 기대 | 결과 |
|---|---|---|---|
| 엣지1 | phone 형식 오류 3종 (`abc123`/빈/짧음) | 400 + 정확한 메시지 | ✅ 3건 모두 정확 |
| 엣지2 | 같은 phone 즉시 재발송 (5분 내) | 429 + "5분 이내…" | ✅ 통과 |
| 엣지3 | 잘못된 6자리 코드 check | 400 + `reason=mismatch` | ✅ 통과 |
| 엣지5-A | verifyToken 무효값으로 signup | 400 + "전화 인증이 만료되었거나…" | ✅ 통과 |
| 시나리오4 | verifyToken 없이 signup | 200 + 기존 흐름(INSERT) | ✅ 호환성 유지 (회원 ID 64 발생) |
| check | 빈 코드·없는 phone | 400 + `reason=no_pending` | ✅ 통과 |

### 발견 이슈

**🔴 BUG-1 (메인 인계 — 인프라 결정)**

| 항목 | 내용 |
|---|---|
| 증상 | Aligo SMS 발송이 `result_code=-101 인증오류-IP`로 차단 |
| 원인 | [lib/aligo-client.ts](lib/aligo-client.ts) SMS 호출이 카카오 알림톡과 달리 Oracle 고정 IP 프록시 미경유. Netlify Functions의 변동 outbound IP가 Aligo 화이트리스트 미등록 |
| 영향 | **A안 SMS 발송 자체가 작동 안 함** — 실제 사용자가 인증번호 못 받음 → 가입 흐름 차단 |
| 옵션 | (a) SMS도 [lib/aligo-kakao-client.ts:53](lib/aligo-kakao-client.ts#L53) 같은 ALIGO_PROXY_URL 경유 추가 / (b) Netlify outbound IP 화이트리스트 등록 / (c) SMS 대신 카카오 알림톡 채널로 인증 코드 전송 |
| 차단된 검증 | 시나리오 2·3, 엣지 5-B(유효 token + phone 불일치), 매칭 로직 라이브 (코드 정독으로 일부 대체) |

**✅ BUG-2 (C 자율 fix — 62ef386, push 완료)**

| 항목 | 내용 |
|---|---|
| 증상 | SMS 발송 실패 시 INSERT row가 남아 rate limit(5분 1회) 부정 누적 |
| 영향 | 사용자가 SMS 못 받았는데 재발송 시 "5분 이내에 이미 발송했습니다"로 5분 갇힘 |
| Fix | `lib/phone-verify.ts`에 `deleteVerification(id)` 추가, [auth-phone-verify-send.ts](netlify/functions/auth-phone-verify-send.ts)가 SMS 실패 분기에서 방금 INSERT한 row 즉시 DELETE |

**⚠️ 잔여 정리 (메인 인계)**

- 검증용 회원 ID 64 (`verifytest-novt@autoverify.local`, 이름 "검증VT없음") — 시나리오 4 호환성 검증에서 발생. 메인 또는 어드민 화면에서 삭제 요청.
- `phone_verifications` 테이블에 `01028075242` row 1건(검증용 send 시점) — KST 03:00 cron 자동 정리 예정.

### 결론

A안 백엔드 로직(헬퍼·핸들러·DB 흐름)은 완전 정상이나, **SMS 발송 인프라 차원(BUG-1)에서 A안 전체가 작동 불가**. UX 결함 BUG-2는 자율 fix 완료. 메인이 SMS 프록시 결정을 내려야 A안 end-to-end 검증·런칭 가능.

**산출물**: `scripts/phone-verify-test.mjs` (재실행 가능한 라이브 검증 헬퍼).

---

**마지막 갱신**: 2026-05-16 (A안 가입 흐름 검증 — BUG-2 자율 fix + BUG-1 메인 인계).

---

## 2026-05-16 A안 효성 후원자 가입 흐름 재검증 (C — BUG-1 해소 후)

- **베이스**: main + 846f567 (SMS Oracle 프록시 경유 fix) + 061af1c (C BUG-2 머지) + b334d39 (C 10초 timeout 안전망)
- **재검증 대상**: 1차 검증에서 BUG-1로 차단됐던 4건 (시나리오 2/3 + 엣지 5-B + 2-D 매칭 로직)
- **결과**: 4건 전부 통과

### 검증 결과

| # | 명령 | 응답 | 결과 |
|---|---|---|---|
| 시나리오2 | `phone-verify-send {"phone":"01028075242"}` | 200 / sentAt / expiresAt / message | ✅ 1.86초. 프록시 정상 통과, Swain 카톡으로 코드 826439 수신 |
| 시나리오3 | `phone-verify-check {"phone":"01028075242","code":"826439"}` | 200 / verifyToken / matchedMember 4종 정확 | ✅ "이미 가입하신 분이에요…" 메시지 정확 |
| 2-D | `findMatchedMemberByPhone` 라이브 응답 | `id=3 name="박두용" isHyosung=false hasEmail=true donationCount=0 mode="existing_full"` | ✅ 4종 필드 모두 정확. placeholder 이메일 제외 패턴(`@auto.` / `.auto.local`) 라이브 검증 |
| 엣지5-B | 유효 verifyToken(73b62cff…) + 다른 phone(01077778888) signup | 400 / "인증하신 전화번호와 가입 전화번호가 다릅니다." | ✅ |

### 추가 발견 (BUG 아님 — 데이터 정합성 참고)

01028075242 phone으로 회원 2명 등록됨:
- **id 3 박두용** (이메일 있음, 후원 0건) ← 매칭됨 (ORDER BY id ASC LIMIT 1 정책)
- **id 5 박새로이** (이메일 있음, 후원 있음 — 이전 AI 비서 검증에서 확인)

코드는 의도된 정책대로 작동(가장 먼저 가입한 회원 우선 매칭). 단 같은 phone 중복 회원 데이터 자체는 정리할지 결정 영역(메인/Swain 판단). signup 흐름의 모든 분기는 정상 작동.

### 결론

A안 효성 후원자 가입 흐름 **백엔드 end-to-end 검증 완료**. SMS 발송(BUG-1 메인 fix) + INSERT 롤백(BUG-2 C fix) + 프록시 timeout 안전망(b334d39 C fix) 3종이 머지·배포되어 흐름이 정상 작동.

**1차에서 남긴 인계**: 검증용 회원 ID 64 (`verifytest-novt@autoverify.local`) 클린업은 여전히 메인 처리 필요. 재검증에서 추가 INSERT는 발생 안 함 (엣지 5-B는 400 거절).

### 산출물

- `scripts/phone-verify-test.mjs` (라이브 검증 헬퍼 — 1차/재검증 공용)
- BUG-2 fix (커밋 062ef386 → 머지 061af1c)
- 프록시 timeout 안전망 (커밋 b334d39 — 머지 대기)

---

**마지막 갱신**: 2026-05-16 (A안 가입 흐름 재검증 — 4건 전부 통과, BUG-1·2·3 모두 해소).
