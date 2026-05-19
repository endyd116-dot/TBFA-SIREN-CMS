# 라운드 5 — 발송 센터 UX 완성 설계서

> **생성**: 2026-05-17 / 메인 채팅
> **베이스**: main @ `a4b0fa8`
> **분배**: A(프론트 전담) — 백엔드 신규 없음

---

## §0. 요구사항 확정

| 결정 | 내용 |
|---|---|
| 채널별 미리보기 탭 | 이메일·SMS·카카오·인앱 각자 독립 탭. 선택 채널만 활성화 |
| SMS 미리보기 | 본문 HTML 태그 제거 + 변수 치환 + 90자(한글 45자) 카운트 표시 |
| 카카오 미리보기 | 말풍선 스타일 (제목 볼드, 본문, 버튼 표시) |
| 인앱 미리보기 | 앱 알림 카드 스타일 (아이콘 + 제목 + 1줄 본문) |
| 이메일 미리보기 | 현재 방식 유지 (HTML 렌더링 + wrap 적용) |
| 파일함 재사용 | "파일함에서 선택" 버튼 → 워크스페이스 파일 선택 모달 → blob id 재사용 |
| 백엔드 | 없음 — 기존 `/api/admin-workspace-files` + `attachmentBlobIds` 재사용 |

---

## §1. 채널별 미리보기 탭

### 1.1 현재 상태

```
#sendPreviewCard (display:none, 이메일·인앱 선택 시만 표시)
  └─ #sendPreviewBox — 단일 박스 (HTML 렌더링)
```

`refreshSendPreview()` (JS 272줄) — 채널 구분 없이 HTML 렌더링만.

### 1.2 변경 후 구조

```
#sendPreviewCard (채널 1개 이상 선택 시 표시)
  ├─ #previewTabBar — 탭 버튼 4개
  │    [📧 이메일]  [📱 SMS]  [💬 카카오]  [🔔 앱 알림]
  │    (선택 채널 탭 = 활성, 미선택 = 흐리게 + "미선택")
  └─ #previewTabContent
       ├─ #preview-email  — HTML 렌더링 (wrap 적용)
       ├─ #preview-sms    — 텍스트 + 90자 카운터
       ├─ #preview-kakao  — 말풍선 박스
       └─ #preview-inapp  — 앱 알림 카드
```

### 1.3 탭별 렌더링 명세

| 탭 | 콘텐츠 | 특이사항 |
|---|---|---|
| 이메일 | 현재 `#sendPreviewBox` 방식 그대로 | wrapEmail 체크 시 헤더·푸터 wrap 적용 |
| SMS | 본문에서 HTML 태그 제거 (`<[^>]+>` 치환) + 변수 치환 | 90자 초과 시 🔴 경고 표시 |
| 카카오 | 연회색 말풍선 배경, 제목 볼드 상단 + 본문 + 버튼 행 | 버튼 없으면 버튼 행 숨김 |
| 인앱 | 흰 카드 + 좌측 🔔 아이콘 + 제목 + 본문 1줄(말줄임) | 단순 알림 스타일 |

### 1.4 표시 조건 변경

| 조건 | AS-IS | TO-BE |
|---|---|---|
| `#sendPreviewCard` 표시 | 이메일 또는 인앱 선택 시 | 채널 1개 이상 선택 시 |
| 탭 활성화 | — | 선택된 채널 탭만 클릭 가능, 나머지 dim |
| 기본 활성 탭 | — | 선택된 채널 중 첫 번째 |

### 1.5 수정 파일

```
public/admin-send-job-create.html
  - #sendPreviewCard 내부: #sendPreviewBox → 탭 바 + 4개 콘텐츠 div
  - 탭 스타일 (인라인 또는 admin-send-job-create.css 확장)

public/js/admin-send-job-create.js
  - refreshSendPreview() 채널별 분기 추가
  - bindChannelGrid() 에서 #sendPreviewCard 표시 조건 수정
  - 탭 전환 이벤트 바인딩
```

---

## §2. 파일함 재사용 첨부

### 2.1 현재 상태

```
#emailOptionsRow
  └─ input#fAttachments (type="file" multiple)   ← 신규 업로드만 가능
```

백엔드 `admin-send-job-create.ts`는 `attachmentBlobIds: number[]` 이미 수용.

### 2.2 변경 후 구조

```
#emailOptionsRow
  ├─ input#fAttachments (type="file" multiple)   ← 신규 업로드 (그대로)
  ├─ button#btnPickFromFiles "📂 파일함에서 선택"   ← 신규
  └─ div#fAttachmentList                          ← 선택 파일 목록 (기존 + 파일함 선택 통합)
```

**파일함 선택 모달 (`#filePickerModal`):**
```
┌────────────────────────────────────────┐
│ 📂 워크스페이스 파일함에서 선택          │
│ [검색창                      🔍]        │
│ ─────────────────────────────────────  │
│ 📄 보고서_2026.pdf   1.2MB  2026-05-10 │
│ 🖼️ 행사사진.jpg      320KB  2026-05-12 │
│ 📄 양식_A.docx       88KB   2026-05-15 │
│ ─────────────────────────────────────  │
│                    [취소] [선택 완료]   │
└────────────────────────────────────────┘
```

### 2.3 API 흐름

```
1. [파일함에서 선택] 클릭
2. GET /api/admin-workspace-files?limit=50 (또는 search=xxx)
3. 목록 표시 → 파일 클릭 (단일 선택)
4. 선택된 파일의 blob_uploads.id를 attachmentBlobIds 배열에 추가
5. #fAttachmentList에 "파일명 (파일함)" 항목으로 표시
6. 발송 등록 시 기존 업로드 ID + 파일함 선택 ID 통합 전송
```

**신규 업로드와 구분**: 파일함 선택 항목은 `[파일함]` 배지 표시.

### 2.4 수정 파일

```
public/admin-send-job-create.html
  - #emailOptionsRow 에 #btnPickFromFiles 버튼 추가
  - #filePickerModal 모달 추가 (body 하단)

public/js/admin-send-job-create.js
  - #btnPickFromFiles 클릭 → 모달 열기 + 파일 목록 fetch
  - 파일 선택 시 attachmentBlobIds 배열 관리
  - validateForm() 에서 attachmentBlobIds 포함해서 body 전송 (이미 처리됨 확인)
```

---

## §3. 캐시버스터

`admin-send-job-create.html`이 참조하는 JS·CSS 모든 `?v=N` 갱신.

---

## §4. 검증 시나리오 (C 작업)

| # | 시나리오 | 확인 |
|---|---|---|
| Q1 | 이메일만 선택 → 이메일 탭만 활성, 나머지 탭 dim | UI |
| Q2 | SMS 선택 → SMS 탭 활성, 본문 HTML 제거된 텍스트 표시 | UI |
| Q3 | SMS 본문 90자 초과 → 🔴 경고 표시 | UI |
| Q4 | 카카오 선택 → 말풍선 스타일 미리보기 표시 | UI |
| Q5 | 인앱 선택 → 앱 알림 카드 스타일 표시 | UI |
| Q6 | 이메일+SMS 복수 선택 → 두 탭 모두 활성 | UI |
| Q7 | [파일함에서 선택] 클릭 → 워크스페이스 파일 목록 모달 | UI |
| Q8 | 파일 선택 → #fAttachmentList에 "[파일함]" 배지 항목 추가 | UI |
| Q9 | 파일함 선택 + 신규 업로드 혼용 → 발송 등록 시 둘 다 포함 | API |
| Q10 | 회귀: 기존 발송 등록 흐름 (템플릿→수신자→등록) 정상 | 시나리오 |

---

## §5. 4채팅 시작 프롬프트

### §5.1 A 트리거 (프론트 전담)

```
[영역: 프론트엔드(public/)]
[브랜치: feature/round5-send-ux — 새로 생성]

라운드 5 발송 센터 UX 완성 — 프론트 전담 작업.
설계서: docs/milestones/2026-05-17-round5-send-ux.md §1·§2 정독.
베이스: main @ a4b0fa8 (git fetch + rebase 후 시작)

수정 대상:
  public/admin-send-job-create.html
  public/js/admin-send-job-create.js

━━━ 작업 체크박스 ━━━

□ [채널 미리보기 탭] admin-send-job-create.html
   #sendPreviewCard 내부 구조 교체:
   기존: #sendPreviewBox (단일 박스)
   신규: #previewTabBar (탭 4개) + #previewTabContent (콘텐츠 4개 div)
     탭: 이메일·SMS·카카오·인앱
     콘텐츠 div: #preview-email / #preview-sms / #preview-kakao / #preview-inapp
   #filePickerModal 모달 추가 (body 하단)
   #btnPickFromFiles 버튼 추가 (#fAttachments 옆)

□ [채널 미리보기 탭] admin-send-job-create.js
   refreshSendPreview() → 채널별 렌더링 분기:
     이메일: 기존 HTML 렌더링 (wrap 적용) → #preview-email
     SMS: HTML 태그 제거 + 변수 치환 + 90자 카운트 → #preview-sms
     카카오: 말풍선 스타일 → #preview-kakao
     인앱: 앱 알림 카드 → #preview-inapp
   bindChannelGrid() 에서 #sendPreviewCard 표시 조건:
     AS-IS: 이메일 또는 인앱 선택 시
     TO-BE: 채널 1개 이상 선택 시
   탭 전환 이벤트 바인딩 (선택 채널 탭만 활성, 나머지 dim)

□ [파일함 재사용] admin-send-job-create.js
   #btnPickFromFiles 클릭 → #filePickerModal 열기
   GET /api/admin-workspace-files?limit=50 파일 목록 fetch
   검색 입력 → ?search=xxx 재fetch
   파일 클릭 → 선택 상태 표시
   [선택 완료] → #fAttachmentList에 "[파일함] 파일명" 항목 추가
   attachmentBlobIds 배열에 선택 파일의 id 추가
   validateForm() body 전송 시 attachmentBlobIds 포함 확인

□ 캐시버스터 ?v=N 갱신 (admin-send-job-create.html 내 JS·CSS 참조)
□ git push origin feature/round5-send-ux

━━━ 렌더링 스타일 참고 ━━━
SMS 박스:
  배경 #f8fafc, 폰트 고정폭, 90자 초과 시 빨간색 "XX/90자" 카운터

카카오 말풍선:
  배경 #FEE500(카카오 옐로우) 박스 or 회색 말풍선
  제목 font-weight:700, 본문 아래
  버튼 있으면 회색 배경 버튼 행 표시

인앱 알림 카드:
  흰 배경, 그림자, 좌측 🔔, 제목 볼드, 본문 1줄(overflow:hidden)

파일함 모달:
  기존 admin.html 모달 스타일 그대로
  파일 목록: 아이콘(타입별) + 이름 + 크기 + 날짜
  선택 시 체크 표시

━━━ 확인 필요 사항 ━━━
현재 validateForm()에서 attachmentBlobIds가 body에 포함되는지 확인 후 진행.
없으면 추가 (body.attachmentBlobIds = [...ids]).

━━━ 자율주행 / 진행률 ━━━
push와 로직 결정만 묻기. 큰 체크박스 완료마다 📊 진행률 보고.
```

### §5.2 C 트리거 (A 머지 후)

```
[영역: 라이브 검증]
라운드 5 발송 센터 UX 완성 — 라이브 검증.
설계서: docs/milestones/2026-05-17-round5-send-ux.md §4 정독.
선행 조건: A 머지 완료 후 진입.

━━━ 검증 체크박스 (Q1~Q10) ━━━
□ Q1  이메일만 선택 → 이메일 탭 활성, 나머지 dim
□ Q2  SMS 선택 → 텍스트 미리보기 표시
□ Q3  SMS 90자 초과 → 경고 표시
□ Q4  카카오 선택 → 말풍선 미리보기
□ Q5  인앱 선택 → 앱 알림 카드
□ Q6  복수 채널 → 해당 탭 모두 활성
□ Q7  파일함에서 선택 → 파일 목록 모달
□ Q8  파일 선택 → [파일함] 배지 목록 추가
□ Q9  파일함 + 신규 업로드 혼용 발송 등록 성공
□ Q10 회귀: 기존 발송 등록 흐름 정상

━━━ 자율주행 / 진행률 ━━━
fix 발견 시 fix/round5-send-ux-{키워드} 신규 브랜치.
검증 보고서: docs/verify/2026-05-17-round5-send-ux.md
```

---

## §6. 라운드 마감 체크리스트 (메인)

- [ ] A 트리거 발사
- [ ] A push → 머지
- [ ] C 트리거 발사 (Q1~Q10)
- [ ] C 검증 PASS
- [ ] PROJECT_STATE.md·HANDOFF.md 갱신 push
