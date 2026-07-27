# 인수인계 — 직원 전자 근로계약 시스템 구축 (2026-07-27)

> 집 데스크톱 → **사무실 노트북** 인수인계. 이 세션에서 한 일 전체 + 미결.
> ⚠️ **메모리(`~/.claude/.../memory/`)는 PC별 로컬** → 사무실 노트북엔 이 세션 메모리가 없다. **이 문서가 유일한 다리.**
> **마지막 배포**: `d107ccc8` / APP_VERSION `2026-07-27.1` / 작업 트리 깨끗(전부 커밋·푸시).

---

## 0. 한 줄 요약
**직원 전자 근로계약 시스템을 새로 구축**(작성→발송→직원 서명→R2 박제→양측 다운로드)하고 배포·E2E까지 끝냈다. 세션 초반엔 캘린더 흰색·근태 거점 주소검색·지출결재 문서정리도 처리.

---

## 1. 근로계약 시스템 — 무엇을 만들었나

**워크플로우**: 이사장(super_admin) 계약 작성(사업자·근무조건만) → 발송(회사 도장 자동 날인) → 직원이 워크스페이스에서 **인적사항 입력 + 서명** → 완료·R2 박제(sha256) → 양측 PDF 다운로드. 상태: `draft → sent → completed`(또는 `rejected`/`voided`).

**DB 테이블 5개** (마이그 `migrate-employment-contracts` 호출 완료·삭제됨, schema.ts 정의 활성화됨):
- `contract_business_entities` — 계약 주체(사업자)·도장. 프리셋 3사 시드(교유협·함께워크 ON·함께워크 AX(=구 SI)). 박두용 도장 R2 자동 업로드(ON·AX 연결·교유협은 비움).
- `contract_templates` — 사업자별 계약서 양식(`{{치환}}`·버전).
- `employment_contracts` — 계약 본체(fields 스냅샷·body_snapshot·주민번호 암호화·회사날인·직원서명·문서 R2키).
- `contract_signature_events` — 증적 append-only(CREATED/SENT/VIEWED/SIGNED/REJECTED/VOIDED/REISSUED/ATTACH).
- `contract_attachments` — 부속서류(신분증·통장 사본·blob-presign 3단계).

**lib**:
- `lib/contract-pdf.ts` — 계약서 PDF(급여 PDF 노하우 복제: subset:false·drawRun 글자별 배치·2열 서명란·도장/서명 embedPng). **미치환 `{{}}`는 밑줄(`____`)로 렌더**.
- `lib/contract-document.ts` — 박제(sha256·uploadToR2·멱등·bumpVersion)·fetch(고정본 우선·미완료는 워터마크)·`fillTemplate`·서명정화(sharp).
- `lib/crypto-pii.ts` — 주민번호 AES-256-GCM 암호화(env `CONTRACT_PII_KEY`·미설정 fail-soft)·마스킹(앞6+성별1자리).

**API**(전부 배포·E2E 통과):
- 관리자(super 전용): `admin-contracts`(목록·상세·create·**update**·**delete**·send·reissue·void·?members=1) · `admin-contract-entities`(사업자 CRUD+도장) · `admin-contract-templates`(양식 CRUD) · `admin-contract-seal`(도장 미리보기) · `admin-contract-pdf` · `admin-contract-attachments`.
- 직원(requireOperator): `contract-my`(내 계약) · `contract-my-sign`(서명/반려+인적사항) · `contract-my-pdf` · `contract-my-attach`.

**프론트**: `public/admin-contract.html`+`js`(3영역: 계약·사업자·양식) → 통합 CMS iframe 4곳 등록(`data-tab="contract"`·운영관리 그룹·super 전용·MENU_PERM `contract_manage`). `public/workspace-contract.html`+`js`(직원 "내 근로계약"·서명 캔버스·인적사항 입력). 근태 네비에 진입점.

**netlify.toml**: `contract-my-sign`·`admin-contract-pdf`·`contract-my-pdf`에 `assets/fonts/**` 등록(PDF 생성).

---

## 2. Swain 확정 결정 (지키기)
1. **주민번호**: 암호화 저장(DB). 화면엔 마스킹만. **직원이 서명할 때 본인이 입력**(이사장 아님).
2. **인적사항 전체(생년월일·주소·연락처·주민번호)**: 이사장이 모르는 정보 → **직원이 서명 시 입력** → 계약서 본문 재치환. 이사장 작성 폼엔 사업자·근무조건만.
3. **양식**: 사업자별 CRUD. `{{치환}}`. 양식 고쳐도 서명된 계약은 불변(body_snapshot).
4. **서명 순서**: 작성 시 회사 도장 자동 → 직원 서명 → 완료.
5. **직원 반려**: 서명 또는 반려(사유).
6. **수습 지급률(%)**: 계약 작성 시 선택(기본 90). **김주안은 100%**.
7. **계약서 내용**: 3사 모두 **5인 미만** 사업장. 회사 유리 조항 유지 + 무효 위험 4개(포괄임금·일급산정·경업금지·손해배상예정) 합법 다듬음. **실서명 전 노무사 1회 검토 권장.**

---

## 3. 검증 (E2E 라이브 통과)
관리자 로그인 → 계약 생성 → 발송(회사날인) → 서명(손글씨+주민번호) → completed·주민번호 마스킹(`900101-1******`)·문서생성·증적 4단계·양측 PDF 3.2MB → void 정리. **전 단계 통과**(주민번호 암호화·CONTRACT_PII_KEY 실작동 확인). 단 인적사항 직원작성 흐름은 코드 배포만 됨(Swain이 직접 검증 중).

---

## 4. ★ 미결 — 다음 메인 할 일 (우선순위)

### ① 업데이트 소식 상세 보기 (Swain 신규 요청·미착수)
직원이 보는 업데이트 소식이 지금은 **좌하단 "새 소식" 칩 → 모달에 짧은 한 줄 항목**만. **클릭 시 자세한 내용·소개를 읽을 곳이 없음.** 만들 것:
- 소식에 **상세 본문 필드** 추가(기능 소개·사용법·이미지) → `org_news` 재사용 구조라 컬럼 추가 마이그 필요할 수 있음(먼저 `netlify/functions/release-notes.ts`·`admin-org-news-*`·`db/schema` org_news 구조 확인).
- **전용 "업데이트 소식" 페이지**(지난 소식 목록+상세)·칩 모달에 "자세히 보기" 연결.
- 운영자가 통합 CMS에서 상세 본문 작성.
- 관련: `public/js/release-notes-widget.js`(칩·모달), `lib/release-drafts.ts`(초안 시드).

### ② 근로계약 종결 마무리 (기능은 됐고 마감만)
- **알림**: 발송/서명/반려 시 인앱 알림 미구현(현재 화면으로만). `lib/workspace-logger.ts sendWorkspaceNotification`·`lib/notify.ts notifyAllSuperAdmins` 사용. `NotifSourceType`에 `'contract'` 추가 필요(그 파일 수정 시 다른 알림 영향 점검).
- **메뉴얼·AI 학습**: `docs/manual/`·`ai-assistant-knowledge.md`에 근로계약 안내.
- **release_checklist 15항목**(메모리 `release_checklist`) 점검.

### 기타
- **김주안 계약**: Swain이 직접 생성 중(수습 100%·사업자 선택·연봉·시작일·담당업무 입력, 인적사항은 김주안이 서명 때).
- **테스트 계약 #1**: voided로 목록에 남음(초안·반려만 delete 되게 함). Swain이 원하면 DB 정리.

---

## 5. 환경·자격 (사무실 노트북 주의)
- **netlify CLI**: 집 데스크톱은 이미 로그인(Park DU/tbfa-siren-cms). **사무실 노트북은 로그인 필요** — 토큰은 데스크톱 메모리 `reference_infra_tokens`에 있으나 **사무실엔 없으니 Swain이 재제공**하거나 `netlify login`. (env·배포·DB 검증에 필요.)
- **CONTRACT_PII_KEY**: Netlify에 **이미 등록 완료**(주민번호 암호화 작동). 값은 데스크톱 메모리 `reference_contract_pii_key`에만(사무실 재현 시 Netlify env에서 확보 불가하니, 복호화 디버깅 필요하면 Swain에게).
- **admin 로그인**(E2E용): id `admin` / pw `admin12345` (Swain 제공). ⚠️ 비번 변경 예정.
- **라이브 E2E 방식**: `node` 스크립트로 `/api/admin/login`(`{id,password}`) → 쿠키 → API 호출. 시스템 시크릿 추출은 자동 차단됨(정상)·우회 금지.

---

## 6. 함정·교훈 (재발 주의)
1. **캐시버스터**: JS 수정 시 **참조 `?v=` 반드시 갱신**. 안 하면 SW 자산 캐시(stale-while-revalidate)가 옛 JS 서빙 → 이번에 근로계약 탭 흰 화면 사고(cms-tbfa.js). §6.1.4.
2. **PDF 폰트 subset:false 고정**·drawRun 글자별 배치(급여·계약 공통). 눈으로 렌더 확인 필수.
3. **미치환 `{{}}` 노출**: fillTemplate은 미매칭 키를 원형 유지 → PDF/화면 렌더 직전 `{{...}}`→밑줄 처리해야 함(이미 반영).
4. **인적사항 흐름**: body_snapshot은 작성 시 회사·조건만 치환(인적사항 원형 유지) → 직원 서명 시 fillTemplate 재치환. 이 2단계 깨지 말 것.
5. **push 배치**(§9.3): commit 자유·push는 라이브 검증 단위만. 문서만 push는 HEAD에 `[skip netlify]`.

---

## 7. 정독 순서 (사무실 메인)
1. 이 문서(§0~§6)
2. `CLAUDE.md`(자동로드)
3. `PROJECT_STATE.md` §2
4. 근로계약 세부 필요 시: `docs/active/2026-07-27-employment-contract-design.md`(설계서) + `lib/contract-pdf.ts`·`lib/contract-document.ts` 상단 주석
5. 다음 작업이 소식 상세면: `public/js/release-notes-widget.js`·`netlify/functions/release-notes.ts` 먼저 파악
