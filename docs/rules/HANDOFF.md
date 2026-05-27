# SIREN — 작업 인수인계 (HANDOFF)

> **단일 최신 파일**. "지금 어디까지 왔는지" 한 화면에 들어오게 유지.
> 새 메인 채팅 시작 시 정독.
> 이전 시점 스냅샷은 [`docs/history/handover/v20.md`](../history/handover/v20.md) 영구 archive (자발적 안 읽음).
>
> **마지막 갱신**: 2026-05-27 / **🏁 딥릴리프 P1~P4 전체 종결·SSO 완료·배포 8→5분**. 다음 = (선택) 데이터 축적·발간 풍부화.
> 새 메인 진입 시 본 문서 §0 → CLAUDE.md(자동로드) → PROJECT_STATE.md §2 → 병렬규칙(PARALLEL_GUIDE/TEMPLATE) → 메모리(MEMORY.md + project_hamkke_on_sso·project_next_survivor_support 등) 순서로 정독. 딥릴리프 설계 master = `docs/history/milestones/2026-05-27-deeprelief-p3-p4.md`(archive)
> **▶ 딥릴리프는 종결. 다음 작업은 §0 잔여(Swain 발간 권한 마이그 호출 1건) + 후속(선택·데이터 축적).**

---

## 0. ★ 지금 시점 (2026-05-27 최신 — 🏁 딥릴리프 P1~P4 전체 종결·SSO 완료)

**딥릴리프(순직 인정 지원) = 통합 CMS 1뎁스 "🕊️ 딥릴리프". P1~P4 전체 종결.** 설계 master는 milestone [`docs/history/milestones/2026-05-27-deeprelief-p3-p4.md`](../history/milestones/2026-05-27-deeprelief-p3-p4.md)(P3·P4·archive) + `2026-05-26-deeprelief-p1-p2.md`(P1·P2). `docs/active/`에서 이동 완료.

### ✅ 이번 세션(2026-05-27) 완료
- **P1·P2**: 출시·검증·종결 정리 완료(이전 세션·milestone).
- **P3 서면 생성** — 출시·C 코드+라이브(실서버 E2E) 검증 PASS·**종결**. 유족급여신청서 목차 제안→섹션별 생성·편집·재생성·PDF/Word/zip 내보내기·전문가 검토 배정·승인·인과관계 논리맵·종결 자동학습. 마이그 `migrate-martyrdom-p3` 호출·삭제·schema 활성화 완료. 신규 테이블 `martyrdom_draft_sections`·`martyrdom_reviews` + outputType `'draft'`. **신규 의존성 `docx`**. 검증 `docs/history/verify/2026-05-27-martyrdom-p3.md`·`-p3-live.md`.
- **P4 마감** — AI 비서 순직 읽기 도구 3개(`martyrdom_case_list`·`case_status`·`deadlines_upcoming`·운영자+·격리 불변) + 유족 전달용 쉬운 요약 + 인정률 통계(G5) + 연구 발간지(자체+AI 블렌드·비율 운영자 설정·비식별화). 마이그 `migrate-martyrdom-p4` 호출·삭제·schema 활성화 완료. 신규 테이블 `martyrdom_publications` + outputType `'family_summary'` + `ai_tool_permissions` 시드. 검증 `docs/history/verify/2026-05-27-martyrdom-p4.md`.
- **SSO** — 허브(tbfa-mis)=IdP `/api/sso-on`(requireAdmin→60s HS256·`SIREN_SSO_SECRET`) → 함께워크 ON(별도 사이트·별도 메인) SP 단일 로그인. E2E 14/14 PASS·라이브. 메모리 `project_hamkke_on_sso`.
- **배포 시간 단축** — `netlify.toml` external_node_modules 7→20(drizzle-orm·exceljs·mammoth·pdf-parse·docx·DB클라·jwt 등) → **8분→5분**. 로그인·함수 정상 검증됨. 추가(skip_processing) 보류.

### ✅ P4 종결 정리 완료 (2026-05-27)
1. **R2 발간 본문 재확인 — Swain 라이브 PASS.** push 9(`b378765`) [object Object] fix(`callGemini` `.text` 추출)·비율 표기 제거 정상 확인. R1 유족요약·R3 AI 도구도 확인 완료.
2. **AI 비서 정식 정착** — `FALLBACK_SYSTEM_PROMPT`(`lib/ai-agent-config.ts`)에 딥릴리프 도메인+순직 읽기 도구 3개+명령 매핑 정착(라이브 DB 프롬프트는 Swain UI 추가분이 이미 작동·코드 폴백 동일화). 도구 3개는 카탈로그·핸들러 기존 존재.
3. **발간 권한 정책 연동** — 발간 쓰기를 `role_permissions.martyrdom_publication`(cms 탭)과 실제 연동(`canAccess`)+화면 버튼 정책 반영(`canWrite`·기본 admin ON/operator OFF로 현행 보존·미시드도 동일). 마이그 `migrate-martyrdom-pub-perm`(시드 1행) 작성.
4. **메뉴얼·AI 학습자료** — manual-admin·`ai-assistant-knowledge.md`·`ai-training-cms-2.jsonl`에 P3 서면+P4 안내(RAG는 기존 완비라 생략).
5. **설계서 milestone 이동·종결 선언** — `docs/active/2026-05-26-survivor-support.md` → `docs/history/milestones/2026-05-27-deeprelief-p3-p4.md`.
- **✅ Swain 발간 권한 마이그 호출 완료** — `migrate-martyrdom-pub-perm?run=1` 응답 `ok:true`·시드 1행(`martyrdom_publication`·admin 허용/operator 불가). 1회용 파일 삭제 완료. 권한 정책 관리 📦 통합 CMS 탭에 "딥릴리프 연구 발간" 항목 등록. **딥릴리프 잔여 액션 0 — 완전 종결.**
6. **종결 후 자료 추출 개선(Swain 마지막 요청)** — ⑴ **m4a** 전사 mime 폴백(`audio/mp4`→`audio/aac`) ⑵ 음성·영상 **전사 전문 열람**(자료 [보기] 요약 1줄→추출/전사 전문·on-demand `admin-martyrdom-doc-text`·복사) ⑶ 구형 **.doc** 본문 추출(`word-extractor`·신규 dep) ⑷ **.hwp** 본문 전체 추출 강화(BodyText 레코드 파싱·실패 시 PrvText 폴백). tsc 0. **Swain 라이브 검증 권장**: m4a 업로드 전사·.doc/.hwp 본문 추출·전사 전문 [보기].
- **(후속·선택) 데이터 축적**: 사건 더 등록 + 과거 인정/불인정 사례·법령 RAG 색인(G2 일괄 이관) → 발간·통계 풍부화. (현재 사건 2건뿐 → 통계·발간 자체조사 빈약·설계상 데이터 의존.)

### 🔧 R&R·환경·git (새 메인 필독)
- **함께워크 ON = 별도 사이트(hamkkework-on.netlify.app→won.tbfa.co.kr)·별도 메인 채팅.** 두 메인 Swain 중계 메시지 조율. **MIS(tbfa-mis) repo 변경은 MIS 메인 단독** — 함께워크 ON 연동(SSO 등)은 트리거로 받아 처리(2026-05-27 cms-on 혼입 사고·memory `project_hamkke_on_sso`).
- **push 정책(불변)**: 워크트리 공유 → 로컬 `main` 분기·베이스 push 0. push=배포=과금(~5분), 라이브 검증 필수 단위만. (CLAUDE §9.3·PARALLEL_GUIDE §4.1·memory `feedback_parallel_base`)
- git: **종결 정리 push 1회(`878ca88`·프롬프트·발간권한·메뉴얼·종결 docs·마이그) + 자료 추출 개선 push 1회(전사 열람·m4a·.doc/.hwp·마이그 삭제)**. 워크트리 A·B·C = P3·P4 브랜치 머지 완료(다음 라운드 재사용).

### 💡 교훈(이번 세션·새 메인 참고)
- **`callGemini`는 `{ok, text}` 반환** — `.text` 추출(전체 `String()`은 "[object Object]" 버그). 발간 본문 무내용의 진짜 원인이었음.
- **라이브 검증이 코드 검증 못 잡는 결함 다수 적발**(P4 차단 3건·발간 본문). C 라이브 검증(admin 계정 curl) 가치 재확인.
- **A 디스패치 중 메인이 같은 fix 중복 금지** — P4 프론트(`88cd2f9`↔A `1e25955`) 겹침·reconcile(선택 체크아웃). 둘 다 `detectRole`이 `data.admin.role` 중첩 미언래핑(isSuperAdmin/isAdmin 영구 false→발간 탭/폼 숨김) 공통 버그였음.

---

## 1. 프로젝트 (요약)

**SIREN(싸이렌)** = (사)교사유가족협의회 통합 NPO 플랫폼.

- 라이브: <https://tbfa.co.kr> (공식 메인) / <https://tbfa-siren-cms.netlify.app> (Netlify 기본)
- 베이스 브랜치: `main`
- 상세 스택·환경·구조: [`CLAUDE.md`](../../CLAUDE.md) §1~5

운영 완성도 (2026-05-20 기준 — 명세 정합 시리즈 종결):
- 🟢 **근태관리 시스템**: 정합도 93.4% (5축 가중 평균) — 즉시 운영 가능
- 🟢 **성과관리 시스템**: 정합도 96.7% — 즉시 운영 가능
- 🟢 **급여 통합 (R37)**: 자동 집계·PDF 명세서·이메일 일괄 발송·CSV 22컬럼 회계 export 완비
- 🟢 교유협 자체 운영: 약 95%+ (실제 운영 단계)

---

## 2. 새 메인 채팅이 시작 시 해야 할 일

```
1) 본 HANDOFF.md §0(현재 시점) 정독
2) CLAUDE.md (자동 로드 — 작업규칙·자율성·푸시 §9.3) — 다시 Read 금지
3) PROJECT_STATE.md §2 정독
4) 작업규칙·병렬평행규칙 정독 (필수):
   - docs/rules/PARALLEL_GUIDE.md §4.1(베이스 정합·워크트리 공유 push 0)·§3·§7
   - docs/rules/PARALLEL_TEMPLATE.md §6.0(워크트리 셋업)
5) memory/MEMORY.md 인덱스 + 본문 정독 (필수):
   - workflow_standards(설계 8섹션·트리거)·operational_standards(자율주행·검증)·code_standards(함정 #55~61)
   - feedback_parallel_base(★ 2026-05-26 재정의 — 워크트리 공유 로컬 main 분기·push 0)
   - project_next_survivor_support(딥릴리프 결정)
6) 딥릴리프 작업이면: docs/active/2026-05-26-survivor-support.md (단일 설계서·§P2.6 트리거 양식)
7) Swain과 다음 작업 확정 후 진행
```

---

## 3. 2026-05-20 명세 정합 시리즈 종결 (R29 ~ R37 — 7라운드)

### 3.1 7라운드 누적 성과

| 라운드 | 내용 | 종결 시점 |
|---|---|---|
| R29 | 근태·성과 1차 갭 fix (P1·P2) | 2026-05-19 |
| R30 | KST 표시 통일 | 2026-05-19 |
| R31 | 근태·성과 2차 갭 분석 | 2026-05-19 |
| R32 | sql.raw 파라미터 미바인딩 BUG fix (7개 함수) | 2026-05-19 |
| R33 | sql.raw 잔존 3건 + HYBRID 키 변환 | 2026-05-19 |
| R34 | 인증 모델 통일 (operator-guard 토큰 fallback) + amend 통합 | 2026-05-19 |
| R35 | Light B base_salary UI + Final P1·P2 (H 5 + M·🟡 16) | 2026-05-20 |
| R36 | 근태 부가 5건 (역방향 신청·외근지 선택·연속 재택 알림·3회 지각·WBS 자동 카드) | 2026-05-20 |
| R37 | 급여 통합 (자동 집계·PDF·이메일·CSV·마이페이지·6~7일 단일 라운드) | 2026-05-20 |

### 3.2 정합도 v1 → v2

| 시스템 | R35 종결 | R37 종결 | 상승 |
|---|---|---|---|
| 근태관리 | 87.9% | **93.4%** | +5.5p |
| 성과관리 | 96.0% | **96.7%** | +0.7p |
| 평균 | 92.0% | **95.1%** | +3.1p |

### 3.3 검증 합산
- E2E 12 시나리오 ALL PASS
- R37 Q1~Q10 ALL PASS + R36 회귀 8/8
- R35 P1 7/7 + P2 16/16 = 23/23 ALL PASS
- R29~R34 누적 fix 회귀 ALL PASS
- BUG 0건

### 3.4 거시 결함 모두 해소
1. drizzle sql.raw 파라미터 미바인딩 (14개 함수)
2. 인증 모델 분리 (R34-P1-A user/admin JWT fallback)
3. HYBRID 키 변환 (R32-P0 → R33-P0)
4. UPSERT 출근 데이터 무결성 (R35 H-G2)
5. 사일런트 권한 토글 (R35 H2 UI 안내)
6. AI 자동 매칭 알림 누락 (R35 H3)
7. 워크스페이스 6페이지 인증 통일 (R35 H-G1)
8. work_mode·거점·정책·wbsCards UX 격차 (R35 M-G1~G7)
9. 결산 사유 가시성·cron 임계점 누락·throw 500 (R35 M1·M4·M5)
10. AI 임계 환경변수화·SI 정렬 명시 (R35 🟡A·🟡B)
11. §9 급여 자동 집계 미연결 (R37로 해소)
12. §14 CSV·base_salary·PDF·이메일 (R37로 해소)

---

## 4. 🟢 운영 시작 공식 선언 (2026-05-20)

**근태관리 + 성과관리 + 급여 통합 시스템 — 즉시 운영 시작 가능**

### Swain 운영 시작 권장 액션
1. **회원별 base_salary 입력** 선행 (어드민 → 회원 상세 모달 → 기본연봉 입력)
2. **분기 결산 PAID 처리** 후 익월 1일 cron-payroll-monthly 자동 흐름 진입
3. R36/R37 사용 패턴 1~2분기 관찰 → 잔여 영역 중 가치 있는 항목 선별 보강

### 운영 닫힘 흐름 (R37 종결 후)
```
근태(att_records) → working_mins·overtime_mins·휴가 집계
      ↓
성과(quarterly_settlements PAID) → totalBonus 월 안분
      ↓
members.baseSalary → base_salary_month
      ↓
cron-payroll-monthly (매월 1일 02:00) → payroll_slips UPSERT
      ↓
어드민 검토·승인 → PDF 생성 → 이메일 일괄 발송 (Resend batch)
      ↓
직원 마이페이지 → 본인 명세서 PDF 다운로드
      ↓
CSV export → 외부 회계 시스템 (세금·4대보험 처리)
```

---

## 5. 잔여 영역 (운영 학습 단계·선택적)

### 근태 6.6% (§6.2 부가 8건)
- 외근지 즐겨찾기·재택 사진·셀카·체크리스트·위젯·비교 뷰·다국어·IP 패턴
- 운영 후 사용 패턴 관찰하며 선별 도입

### 성과 3.3% (옵션·후속)
- rolePermissions milestone:* 실 미연결 (UI 안내 차단됨·옵션 B 후속)
- AI 증빙 검토 보조 (Gemini Vision 페이즈)
- 팀 보너스 옵션 (명세 §13.2 "가능")

### Phase 23 재정 v3.0
- 최소 2026-08-20 이후 (3개월 뒤) 별도 합의 후 진행

---

## 6. 문서 4영역 구조 (2026-05-20 정착)

`docs/README.md` 참조. 핵심 진입:
- **rules/**: HANDOFF·REMAINING_WORK·PARALLEL·PAGES·CONTEXT·policies·standards
- **specs/**: 명세 마스터 7개 (근태·성과·재정 + phase24·26·27·28)
- **active/**: 진행 중 라운드 (현재 비어있음)
- **history/**: 완료 히스토리 (milestones·verify·gap·analysis·통합 archive)

---

## 7. R39 정식 종결 (2026-05-20) — 완료 기록

- **Stage 1~8 전부 머지 + 라이브 검증(메인 직접) 15/15 PASS**
- 라이브 검증 BUG 2건 즉시 fix:
  - BUG-R39V-01: operator-guard tsc narrowing 사전 5건 (런타임 0·`operatorGuardFailed` 헬퍼 적용)
  - BUG-R39V-02: att-checkin/checkout deviceType 미수신·미저장 (att_records.device_type NULL 방지)
- 메뉴얼 2종 + AI 학습 자료 300문항 통합 (`public/manual*.html`·`docs/manual/`)
- 설계서 → `docs/history/milestones/2026-05-20-r39-roles-and-ux.md` archive
- 라운드 종결 체크리스트 15가지 메모리 등록 (`memory/release_checklist.md`)

### Swain 브라우저 라이브 확인 권장 (잔여)
- 워크툴 상단 출퇴근 버튼 위치 (상태 메시지 옆 시각 확인)
- 어드민 → 운영 관리 → 비매출 검토 4가지 액션
- 워크스페이스 진입 속도 체감

## 7.5 SMS·알림톡 프록시 인시던트 + 안정화 (2026-05-20)

**인시던트**: 회원가입 휴대폰 인증이 "발송중 10초 후 실패 + 15분 뒤 문자 도착"으로 막힘.
- 원인: SMS·카카오 알림톡은 **Oracle Cloud 무료 VM 프록시**(고정 IP `168.107.37.197:8080`) 경유 발송. 무료 VM(RAM 약 500MB) 메모리 부족으로 **hang** → 발송 응답이 함수 한도(Pro 26초) 초과 → `ERR_HTTP2_PROTOCOL_ERROR`로 함수 죽음. 게다가 timeout을 발송 실패로 보고 인증 row를 롤백 → 늦게 온 문자가 무효.
- 복구: Swain Oracle 콘솔 재부팅 (SSH는 hang으로 불가). 프록시 systemd `Restart=always`라 프로세스 크래시는 자동복구되나 VM 레벨 hang은 콘솔 재부팅 필요.

**적용한 fix (모두 main 머지)**:
- SMS UX fix: 프록시 abort 10→8초(함수 한도 전 응답)·timeout이면 row 유지+입력칸 표시(`pending`)·인증 유효시간 5→10분·친절 안내
- 안정화 1: `cron-warmup`이 프록시 `/health` 5분마다 ping → warm 유지 + 다운 감지 시 슈퍼어드민 인앱 알림 + `ADMIN_NOTIFY_EMAIL` 이메일 (30분 쿨다운)
- 안정화 2: 명시적 발송 실패 시 사용자 친절 안내 (기술 사유는 로그·detail로만)

### ✅ 안정화 3 — 프록시 자동 재부팅 (OCI 연동) 완료 (2026-05-21)
프록시 다운 시 `cron-warmup`이 OCI 인스턴스를 자동 RESET → 사람 개입 없이 5분 내 복구.
- `lib/oci-client.ts` — OCI Signature v1(RSA-SHA256) 직접 서명(외부 SDK 0) + InstanceAction **RESET**(hard·hang 복구) + 읽기전용 `getInstanceState` 검증.
- `cron-warmup` — proxyDown 감지 시 `resetProxyInstance()` 호출 + **60분 쿨다운**(무한 재부팅 방지) + 시도/실패 슈퍼어드민 알림.
- **OCI 설정 6개는 Netlify Blobs(`siren-oci`/`config`)에 저장** — ⚠️ AWS Lambda **환경변수 4KB 한도** 때문에 env 금지(private key 1.7KB가 한도 초과 → 505 함수 배포 실패 사고). Blobs는 4KB 무관.
- 등록·검증 도구(`public/oci-setup.html`·`admin-oci-config-set.ts`)는 1회용으로 **삭제됨**(커밋 history에 보존). 키 교체·재검증 필요 시 git에서 복원해 재사용.
- 검증: 2026-05-21 `getInstanceState` → `RUNNING` 200 OK (서명·인증·권한 정상 확인). 실제 RESET은 다음 자연 다운 때 작동·알림으로 확인 예정.

**중기 검토**: VM 실측 RAM 498MB·swap 498MB(shape 표기 1GB지만 실측 498)가 hang 근본 원인. 자동 재부팅으로 복구는 해결됐으나, 영구 해결은 ① ARM A1.Flex(무료 2~24GB) 이전(단 IP 변경→알리고 화이트리스트 재등록 동반) 또는 ② IP 제한 없는 SMS 업체(쿨SMS·NHN) 교체로 프록시 제거. R40 KICC 전환과 함께 검토.

### ✅ 안정화 4 — 프록시 실패 시 알리고 직접 발송 폴백 (2026-05-21·`6e5541b`)
프록시 VM이 반복적으로 hang(자동 재부팅해도 또 hang·알림 도배)하는 문제 → **프록시는 알리고 IP 제한 회피용일 뿐**이라, 코드를 다음과 같이 개선:
- `lib/aligo-client.ts`(SMS)·`lib/aligo-kakao-client.ts`(알림톡): **프록시 호출 실패(다운·timeout) 시 알리고에 직접 호출(폴백)** → 프록시가 죽어도 발송 자가복구. (단 직접 호출이 통하려면 **알리고 IP 제한 해제** 필요 — 안 하면 직접도 -101.)
- `cron-warmup`: 프록시 다운 알림 쿨다운 30분→6시간·문구 순화(직접 폴백 안내).
- **영구 해결안 (Swain 미결정 — IP 제한 해제는 원치 않음)**: 핵심 제약 = "알리고가 고정 화이트리스트 IP 요구". IP 해제 외 대안:
  - **① Oracle ARM A1.Flex 무료(24GB)로 프록시 이전 ⭐추천** — 메모리 충분→hang 소멸·무료·IP제한 유지(보안). 1회: 새 인스턴스+프록시 재배포+새 IP 알리고 재등록(예약IP 쓰면 재등록 1회). OCI 설정(Blobs)·`ALIGO_SMS_PROXY_URL` IP 갱신 필요.
  - **② 유료 VPS 고정IP**(Lightsail/fly.io 월 $3~5) / **③ 정적IP 아웃바운드 프록시 서비스 경유**(QuotaGuard/Fixie류·코드가 알리고 호출을 그 IP로 라우팅·VM 불필요) / **④ 예방 야간 자동 재부팅**(band-aid·무료·코드로 즉시 구현 가능·미적용).
  - ※ 앞서 배포한 "직접 발송 폴백"(`6e5541b`)은 **알리고 IP 제한이 켜져 있으면 작동 안 함**(직접도 -101) → IP 유지 시 ①~④로 "고정 IP 안정화"가 본질. Swain 결정 대기.

### 🔎 2026-05-22 노트북 세션 — 라이브 hang 포착 + "스왑 우선" 결정 (작업 일시중단·출장)
- **라이브 hang 포착**: 노트북에서 `/health` 직접 점검 중 약 1분 창에서 **정상(48~96ms) → 6회 연속 무응답(약 80초 먹통) → 다시 정상** 관찰. 간헐 hang의 발생 빈도가 높음을 실증. ⚠️ 안정화3 자동재부팅은 `cron-warmup` **5분 주기**라 이런 **<5분 짧은 hang은 감지조차 못 함** → 그 80초 사이 휴대폰 인증·알림톡·SMS는 실패.
- **Swain 결정(2026-05-22)**: 영구해결 ①~④ 중 → **"스왑(가상 메모리) 먼저 무료로 늘려보고, 그래도 멈추면 ① ARM 이전"**. 스왑은 무료·**IP 불변(알리고 재등록 불필요)**·5분이라 비용/수고 적은 쪽 우선.
- ⚠️ **규격 모순 발견 (적용 전 확정 필요)**: `proxy-server/SETUP.md`는 **ARM A1.Flex·6GB**라 적혀 있으나, 본 §7.5 인시던트 실측은 **RAM 498MB·shape 표기 1GB** → 실제 VM은 **AMD 1GB Micro로 추정**(오라클 ARM "용량 없음"으로 AMD 대체 생성 흔함). 스왑 적용 시 `uname -m`(x86_64=AMD/aarch64=ARM)·`free -h`로 **반드시 실측 확정** 후 진행. 만약 진짜 6GB면 메모리 부족이 아니라 누수 등 다른 진단 필요.
- **블로커 = 작업 일시중단 사유**: 스왑 적용·`free -h`는 VM **SSH 셸 접속** 필요 → **개인키(`ssh-key-*.key`) 필요**. 이번 세션은 **노트북**이라 키 없음(키는 데스크톱에 보관). Swain **출장 중** → **복귀 후 재개**.
- **재개 절차 (복귀 후·메인이 직접)**: ① 키 있는 데스크톱에서 진행하거나 키를 노트북에 복사 → ② `ssh -i <키> ubuntu@168.107.37.197` → ③ `uname -m; nproc; free -h; swapon --show; df -h /`로 실측 확정 → ④ 498MB 확인 시 2GB 스왑파일 추가(`dd`로 생성→`mkswap`→`swapon`→`/etc/fstab` 영구등록)→`free -h` 재확인 → ⑤ 며칠 관찰해 hang 소멸 여부 판단, 부족하면 ① ARM 이전. (스왑 절차는 `proxy-server/SETUP.md`에 정식 추가 검토)

## 7.6 성과관리 화면 통합 — ✅ 완료·종결 (2026-05-21)

통합 CMS 운영 관리의 **성과관리 설정** + **비매출 검토** 2메뉴 → 단일 "성과관리" **6탭**으로 통합 완료. 중복 정의 API(`admin-milestone-definitions`)·옛 설정 화면(`admin-milestone-settings.html`/`.js`) 완전 제거. 정의는 단일 API(`milestone-definitions`)·소프트삭제로 결산 참조 보존. DB/마이그 변경 0.

- Stage1 `76aff40`(알림 이식+역할 저장 broaden) → Stage2 `18df0be`(6탭)+`2dcbcfb`(탭 줄바꿈) → Stage3 `4816e03`(메뉴 2→1·옛 화면 제거) → 후속 `11105ad`(메뉴명)·`e715fb0`(감사 갭 fix).
- "직원 역할 배정" 무한로딩 버그: 옛 화면 제거로 소멸.
- 종결 문서: **`docs/history/milestones/2026-05-20-milestone-screen-unify.md`** (PART 3 종결 요약).

## 7.7 배포 비용 — Push 배치 정책 (2026-05-21·Swain 지시)

Netlify 크레딧 과금 인시던트: 한 달 **1,426 production 배포**로 크레딧 79% 소모 → $10 auto-recharge 반복(거의 매일). `push`=배포=과금이라 **push 횟수 최소화 워크플로우로 전환**(상한은 정상 push 차단 위험이라 미사용).
- **A·B·C push 금지** → commit 후 메인에 머지 요청 → **메인이 검증 단위로 묶어 1회 push.**
- 중간 진행·문서·env 변경 단독 push 금지(동봉). 즉시 push는 운영 장애 핫픽스만.
- 정책 본문: **CLAUDE.md §9.3·§6.17·§6.9**, PARALLEL_GUIDE §12, PARALLEL_TEMPLATE 상단, 메모리 operational_standards §2·§2-1.

## 8. 다음 메인 채팅이 할 일 (즉시 진행)

### 🎯 [다음 라운드 — Swain 확정·설계 대기] 순직 인정 지원 시스템 (NEXT)
**Swain이 다음 메인 세션에서 착수 예정으로 명시 지정한 신규 프로젝트(2026-05-26).** 교유협이 14년간 쌓은 도메인 지식 + 법률지식을 활용해 **교사 순직 인정을 AI가 지원**하는 시스템.
- **비전(사용자 시나리오)**: 새 사망 사건 발생 → 협회가 유족 방문·시스템 연결 → ① 골든타임 자료 확보 제언(온라인=휘발성 우선/오프라인) → ② 자료 수집·입력 → ③ 순직 인정 전략 분석(부족 자료 안내) → ④ 청구서·의견서 **초안** 생성(법률+협회 노하우).
- **★ 데이터 입력 방식(Swain 확정 2026-05-26)**: 사례 카드를 **수동으로 만들지 않는다.** Swain(운영자)이 **순직 신청보고서를 비롯한 여러 자료를 사건별로 업로드**하면, 시스템이 그 사건 자료를 바탕으로 순직 인정 지원을 제공. 즉 "사건별 자료 업로드 → AI가 자료에서 사례 구조 자동 추출 → 지원". (수동 사례 카드 작성 X)
- **기술 토대**: 이번에 완성한 **RAG 인프라가 1단계 토대**(pgvector·임베딩·의미 검색). 과거 인정/불인정 사례·법령·판례를 색인해 유사 사례 검색·근거 제시. 신규 개발은 ① 사건별 자료 업로드·파싱(한글/워드/PDF — 스캔본은 OCR 필요) ② 자료에서 사건 구조 자동 추출 ③ 골든타임 제언 엔진 ④ 전략·서면 초안 생성.
- **불변 원칙**: ① 데이터 품질=시스템 품질(협회 사례·법령이 성능 결정) ② AI 출력은 **항상 "전문가 검토용 초안"**(변호사·노무사 검토 필수·법적 책임 경계) ③ RAG 기반이라 근거 추적 가능(환각 방지) ④ 인정+불인정 사례 둘 다 색인(대비 학습 가치).
- **시작점**: 작게 증명 — 사건 3~5건 자료 업로드 → 가상 신규 사건으로 제언 테스트 → 되면 확장. **상세 설계는 다음 메인 세션에서 Swain과 착수.**
- 관련 메모리: `project_next_survivor_support`.

### 🏁 [종결·운영 정상] 2026-05-26 RAG 검색 인프라 (AI 비서 의미 검색)
AI 비서가 질문 시 협회 Q&A(328문항)+메뉴얼 본문(총 535문서)을 의미 검색해 답변 근거로 자동 주입. pgvector + `gemini-embedding-001`(768차원)·featureKey `ai_rag_search` 토글(OFF 시 기존 동작·안전망). **운영(tbfa.co.kr) PASS**: 재색인 535문서 성공·검색 테스트 정상.
- **결함 5건 fix**(설계 Sonnet·fix 메인 Opus): AI 토글 UPSERT 전환(`c109e21`)·재색인 await fetch(`5313ce8`)·데이터 파일 번들 included_files(`b54a43c`)·폴링 0건 진단 가시화(`1a37d6e`)·임베딩 모델 `text-embedding-004`→`gemini-embedding-001` 교체+환경변수화(`9639e2e`).
- **신규 운영 env 2개**: `GEMINI_EMBED_MODEL=gemini-embedding-001`·`GEMINI_EMBED_OUTPUT_DIM=768`.
- **C 2회 검증 PASS·미해결 0**: `docs/history/verify/2026-05-26-rag-search.md`·`-r2.md`. 설계서 → `docs/history/milestones/2026-05-26-rag-search.md`.
- **잔여(다음 메뉴얼 동기화 라운드)**: knowledge.md·메뉴얼에 "RAG 검색" 운영 안내 추가(release_checklist #3·#4).

### ✅ [완료·라이브] 2026-05-24 영업 제안서 2종 전면 리뉴얼 (`public/1.html` 범용 SI/AX · `public/2.html` NPO 전용)
수주 제안서 기법 전면 적용 + 어투 정비(과장·AI 클리셰 제거→신뢰감 있는 공적 문체) + **전체 PPT/PDF 내보내기·페이지번호**. 라이브 `tbfa.co.kr/1.html`(42장)·`/2.html`(45장). 커밋 `2b9df44`~`6171084`(6커밋, 전부 push 완료).
- **1.html(범용·업종 무관)**: Exec요약·As-Is→To-Be·ROI/TCO·고객성과·POC+SLA·데이터이관·FAQ 추가. **NPO 전용 소재(추모관 등) 배제** — 두 덱 용도 분리가 핵심.
- **2.html(NPO 전용)**: As-Is→To-Be·보안/개인정보·ROI·실사용후기·팀구성·FAQ + 스포트라이트(성과·근태 `s-hr`·추모관 `s-memorial`) + **NPO특화06 메시지 다채널(문자·카톡·인앱·이메일)**·**07 방송/여론 분석**. 싸이렌 특수기능은 "NPO 특성별 맞춤 개발 예시"로 프레이밍.
- **수치 두 덱 통일·상향(실규모 반영)**: DB 테이블 150+·서버리스 API 200+·화면 90+·AI 도구 120+.
- 내보내기 구현: html2canvas+jsPDF+PptxGenJS **지연 로드**(클릭 시 CDN), 슬라이드를 이미지로 캡처해 디자인 보존 + 페이지번호 스탬프.
- 제작 방식: 메인 설계·교차검증 / **A=1.html·B=2.html 병렬**(Agent subagent, Sonnet).
- **남은 선택(Swain·급하지 않음)**: ① 고객 후기 실명·실제 멘트 교체(현재 익명·업종 표기 / 교유협 자체 초안 — **실존 기업 명의 가짜 인용은 넣지 않음**) ② 근태·성과를 각각 독립 슬라이드로 분리할지 ③ 브라우저에서 표·FAQ·목업 슬라이드 세로 넘침 눈 확인.

### 🟢 [라이브·운영 잔여 4건] 2026-05-24 온라인 추모관 (R1 유가족이야기 + R2 본체)
추모관 GNB(DB 메뉴)·유가족이야기 갤러리/상세·통합/개별 헌화(촛불·국화)·방명록·기억의 편지·BGM·운영도구 전부 main 배포·C검증 PASS. 교사 8분 추모 시드(공개 보도). 릴리스 동기화(메뉴얼·AI 프롬프트·도구3·권한시드·학습자료) 완료. 상세 PROJECT_STATE §2.
- **Swain 운영 액션(코드 무관·필수)**: ① `/api/migrate-memorial-aitools?run=1`(AI 도구 권한 시드) ② 통합 CMS > AI 에이전트 > 설정에 갱신된 `docs/manual/ai-assistant-knowledge.md` 재붙여넣기(라이브 프롬프트=DB) ③ 추모관 관리에서 영정 사진 업로드 ④ BGM 음원(`/assets/audio`) 배치 + 설정 등록.
- **핵심 교훈**: 상단 메뉴는 DB(`nav_menu_items` + `/api/public/nav-menus`) 렌더·정적 header는 폴백 → 메뉴 추가는 DB. 메모리 `reference_nav_db_driven`.
- **2차 보류**: 자료실·공유카드(PNG)·추모일 구독 알림·다국어.

### ✅ [전체 종결] 2026-05-24 성과 v4 전환 + 교유협 뉴스·여론 분석
하루 대형 묶음 — 전부 main 배포·검증·기록정리 완료. 설계서 5종 → `docs/history/milestones/2026-05-24-*`.
- **③ 마일스톤 매트릭스 AI 매핑**: 분기 기준표 텍스트 붙여넣기→AI 추출·충돌 판정→일괄 적용. featureKey `milestone_matrix_mapping`. C검증 PASS 8/8.
- **성과 v4 전환(1·2단계+폴리시)**: 정의 **71개 전면 교체**(`migrate-milestone-v4` 호출됨·삭제)·역할 3개(PM/SM/SI 재사용) / 매출·비매출 **5:5 영역 캡**(역할 카탈로그서 편집·`migrate-milestone-role-caps` 호출됨·삭제) / 비매출 **5카테고리·분기7·카테고리당2** / 매트릭스 누락 경고. 명세 v4 배너 반영.
- **④ 뉴스·여론 분석**: 네이버 수집+Gemini(요약·워드클라우드·여론·추천·변경점·**사건사고**)+CMS '📰 여론·뉴스 분석'+매일09:00 cron+히스토리. featureKey `org_news_analysis`. 2테이블(`migrate-org-news`·`migrate-org-news-incidents` 호출·삭제). C검증 PASS·BUG 0.
- **거친 길**: 베이스 어긋남 1회(PARALLEL §4.1 신설로 해결·이후 전 라운드 베이스 정합 OK) / text[] 배열 바인딩·여론% 표시·마이그 컬럼 드리프트 fix(전부 국소).
- **남은 Swain 브라우저 확인(선택)**: 매트릭스 분석·정의 71개·뉴스 재조사·역할 캡 편집·직원 비매출 7개 선택.

### ✅ [마감] 2026-05-24 배포 8건 배치 검증
연차정책·카드만료입력·휴가부여폼+잔여조회버그fix·실시간이름클릭·퇴근위치검증·직원정보편집·급여빈집계+AI·출퇴근재출근. **C `verify/2026-05-24-batch` 코드검증 PASS 7/7 + BUG-1(P1) fix → 메인 cherry-pick `5ec8d04`·1회 push로 마감.** 리포트 `docs/history/verify/2026-05-24-batch.md`.

### ✅ [종결] 운영 전 전수 검수 + 수정 라운드 (2026-05-23)
오픈 전 4영역(메인/A/B/C) 5축 전수 검수 → 마스터 우선순위표 → **P0 2 + P1 18 수정·배포 완료**(tsc 0). 산출물·정정 모두 `docs/history/2026-05-23-prelaunch-audit/`(master.md = 최종 우선순위표·교차검증).
- **🔴 오픈 전 Swain env 게이트(코드 무관·필수)**: ① `INTERNAL_TRIGGER_SECRET`(미설정 시 AI 자동요약 멈춤) ② 이메일 `RESEND_TEST_RECIPIENT` 제거+도메인검증+`EMAIL_FROM` ③ KICC env 4 ④ 솔라피 알림톡 env ⑤ DB 시드(payroll_settings·근태 정책/거점/휴가종류). 상세 = master.md §4.
- **WONTFIX**: 카드 만료 사전알림 = KICC 만료월 미제공(PG 제약).

### 🟡 [구현 완료·라이브 검증 대기] 연차 산정 정책 기능 + 카드 만료 유효기간 입력 (2026-05-24)
운영 전 검수 P1-14 파생. 슈퍼어드민이 연차 산정 방식을 선택·CRUD. **메인 자율 진행(Swain 수면)·마이그 적용 완료(appliedCount 7)·tsc 0·1회 push.**
- **★ 설계서+구현 결과(단일 출처) = [`docs/active/2026-05-24-leave-policy-design.md`](../active/2026-05-24-leave-policy-design.md)** "구현 결과" 섹션.
- **데이터모델(Swain 확정)**: `att_policies` 확장(연차 6컬럼) + `members.hire_date`(NULL이면 가입일 폴백). 신규 테이블 대신 기존 근무 정책 행 재활용.
- **모드 A (5인 이하·현재 협회)**: 월 만근 → +`perfect_bonus_per_month`일. **모드 B (5인 이상)**: 입사 N주년 → `base+floor((근속-1)/incYears)*incDays`(상한 cap). 1주년12/3주년13/5주년14.
- **변경**: `admin-att-leave-policy`(신규·super_admin·UPSERT 시드) / `cron-att-leave-auto`(모드 분기 재작성·`SERVICE_BASED_ANNUAL_ENABLED` 가드 제거) / 근무 정책 탭에 연차 섹션(`?v=17-leavepol`).
- **카드 만료(방식②)**: `billing-card-expiry-set`(신규) + billing-success 유효기간 입력. `billing_keys.card_expiry_month`는 DB엔 존재·schema 정의엔 없음 → **raw SQL UPDATE로만 접근**(SELECT 회귀 0).
- **Swain 라이브 검증**: ① 근무 정책 탭 연차 섹션·모드 토글·저장 ② billing-success 유효기간 입력. 통과 시 설계서 history 이동.
- **TODO(모드 B 실사용 전)**: 회원 상세 입사일 입력 칸 추가(현재 가입일 폴백·Swain 확정).

### 🟢 2026-05-23 발송 업체 전환: 알리고+Oracle프록시 → 솔라피(SOLAPI) — 코드 완료·외부 승인 대기
프록시 VM 메모리 hang으로 휴대폰 인증/알림톡이 간헐 실패 → IP 화이트리스트 불필요한 솔라피로 전면 전환.
- ✅ **SMS(휴대폰 인증) 솔라피 전환·라이브 검증 완료** + 인증 유효 3분+3:00 타이머. SMS는 시스템·AI·수동 전부 솔라피.
- ✅ **알림톡 6종** 솔라피 등록+카카오 검수요청(INSPECTING). 어댑터·발송 트리거·발송템플릿DB 코드 전부 완료·배포(env 미설정이라 placeholder).
- ⏳ **대기 1 = 카카오 알림톡 승인(1~3일)** → 승인되면 Netlify env 7개 설정(pfId+templateId) → 라이브 테스트 → MMS 솔라피 교체 + 프록시·OCI 폐기(Oracle VM 삭제).
- **★ 새 세션 단일 인수인계 = `docs/active/2026-05-23-solapi-migration.md` "재개 절차"** (env 값·templateId·완료/대기 전부 기록). 메모리 `reference_sms_kakao_proxy.md`도 갱신됨.
- ⚠️ 프록시·OCI 폐기 push는 **승인 후 솔라피 알림톡 작동 검증 뒤**(현재 유일 폴백이라).

### 진행 중 트랙 (2026-05-21)
- ✅ **급여 고도화** — 종결. 문서: `docs/history/milestones/2026-05-20-payroll-enhance.md`.
- ✅ **근태 연동 갭 수정(G1·G2·G3·G4)** — 머지 `a189fe9`·Swain 라이브 검증 4/4 ✅ → 종결. 문서: `docs/history/milestones/2026-05-20-att-gap-fix.md`.
- ✅ **성과관리 화면 통합** — 종결(§7.6).
- ✅ **SMS 프록시 OCI 자동 재부팅** — 완료(§7.5).
- ✅ **메뉴얼 R39 갱신**·**Push 배치 정책**(§7.7) — 완료.

### ✅ 근태 메뉴 재배치 — 종결 (2026-05-23 Swain 라이브 검증 완료)
cms "근태관리 설정" 1메뉴 → **"🟢 근태 현황"(조회 8탭)·"⚙️ 근태 설정"(설정 4탭)** 2메뉴. 재택보고서·근무형태 관리 탭을 워크스페이스 관리 화면으로 흡수(12탭 통합) + `?group=ops|config` 필터 + "← 근태 현황으로" 버튼. 옛 `admin-attendance-settings.html`은 리다이렉트, `.js` 삭제.
- **변경 6파일·코드 검증 통과**(JS 문법·id 충돌 0·서버 가드 super_admin 확인). 설계+결과: `docs/active/2026-05-21-att-menu-reorg.md` §6·§7.
- **남은 것**: Swain 라이브 검증 4항목(2메뉴 노출·8탭/4탭·흡수 탭 동작·기존 회귀 0) → 통과 시 설계서 history archive 이동.
- 분류: 조회=records·leaves·monthrecords·balances·workmodeChanges·remotereports·schedule·workmodes / 설정=policy·holidays·leavetypes·workplaces. (경계는 `data-group` 1개로 조정 가능)

### 🟡 R40 PG 전환 (토스→KICC) — 진행 중·코드 완료·결제 라이브 검증 단계 (2026-05-21)
오픈 전 전면 전환(효성 유지·카드 PG만 KICC). A·B·C 전부 Opus·main직결·KICC_MODE=test.
- **코드 완료·배포**(`7d5acb4`): 토스 함수 10개 삭제·KICC 8개 신규·schema pg_*·cron 통합·마이그 적용·요청형식 명세 전수 정합(메인·B 교차검증)·결제복귀 5페이지 auth.js fix.
- **실거래**: 거래등록→결제창→승인 통과. KICC `일반승인 불가 가맹점` = MID 권한 미설정(코드 아님).
- **★ 새 세션 단일 인수인계 = `docs/active/2026-05-21-r40-kicc.md` §10**(현재위치·Swain KICC액션·미결정2건·다음단계) + §9(KICC 실측 스펙). 메모리는 PC-로컬이라 노트북엔 없음 → 본 설계서가 출처.
- **미결정 2건(Swain)**: ① 일시 결제수단 범위(카드+간편 / 전체+가상계좌 / 카드만) ② 정기 효성 유지 vs 제거(KICC 정기는 카드 빌키 전용·계좌 자동이체는 효성 CMS+만). 결정 시 B 정정 트리거.

### ✅ 안정화 3 (OCI 자동 재부팅) — 완료 (§7.5 참조)

### 우선 1. R40 PG 전환 (토스 → KICC) — Swain 옵션 결정 후 시작
- `docs/kicc.md` 정독 완료·**옵션 A(듀얼 PG 점진 전환) 추천**
- 기존 토스 빌링키는 KICC 마이그 불가(체계 완전 다름) → 신규만 KICC·기존은 토스 cron 자연 종료
- Swain 결정 대기: ① 기존 토스 정기 후원 회원 규모 ② 옵션 A/B/C 확정
- KICC 추가 문서 필요(빌키 발급·자동 결제·해지·조회 — 현재 kicc.md엔 일시 결제·웹훅 위주)

### 우선 2. 메뉴얼 R39 기능 본문 갱신
- 메뉴얼에 R39 기능 '예정' 표기 → 실제 안내로 갱신
- `docs/manual/ai-training-cms-2.jsonl` R39 표시 문항도 본 기능 안내로

### R40 후속 예약
- **PG 전환 (토스 → KICC)** — `docs/kicc.md` 정독 완료·옵션 A(듀얼 PG 점진 전환) 추천
  - 기존 토스 빌링키 회원은 KICC로 마이그 불가(체계 완전 다름·KICC cardNo vs 토스 customerKey)
  - 신규 회원만 KICC·기존 회원은 토스 cron 자연 종료까지 유지
  - KICC 추가 문서 필요(빌키 발급·자동 결제·해지·조회 — 현재 kicc.md엔 일시 결제·웹훅 위주)
  - Swain 결정 필요: 기존 토스 정기 후원 회원 규모 + 옵션 A/B/C 확정
- Netlify 배포 시간 단축 (netlify-plugin-cache·dead code 정리)
- ~~RAG 인프라 구축~~ — ✅ 종결(2026-05-26·본 §8 최상단)
- 운영 사용 패턴 관찰 후 §6.2 부가 8건 선별
- Phase 23 재정 v3.0 (2026-08-20 이후 별도 합의)

---

## 9. 갱신 정책

- 새 라운드 종결 후 §3·§4·§5·§8 갱신
- 단일 최신 유지 (이전 시점 보존 시 `docs/history/handover/vN.md`로 archive)
- §2 진입 흐름은 정독 순서 변경 시만 갱신
