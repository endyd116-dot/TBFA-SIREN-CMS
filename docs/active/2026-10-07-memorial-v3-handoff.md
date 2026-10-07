# 추모관 v3 — 정책국장 기획 반영 (2026-10-07) 인수인계

> 정책국장님이 구글 시트 「추모관 수정」 탭(22행)으로 요청한 수정을 전부 반영했다.
> 시트: https://docs.google.com/spreadsheets/d/17fYEFJNhkUqEgAAvBWW6-B2Rbvm6az984esHBIPNaVI/edit?gid=0
> 참고 원본(정책국장 버전): https://flo.fun/RCxhlRt/ (로컬 사본 `assets/추모관/RCxhlRt/`)
> 이전 라운드: [`2026-08-28-memorial-v2-handoff.md`](2026-08-28-memorial-v2-handoff.md)

---

## 0. 한 줄 요약

밤은 기획안의 첫 문장으로 돌아갔고, 선생님 화면은 **편지 하나**(«나만의 서신 작성하기» · 편지 30통이 모이면 책)로 모였으며,
아침관은 응원·들판을 걷어내고 **근황(사진·모달) + 온기의 징검다리(시간순 연혁) + 후원 + 영상(맨 아래)**로 정리됐다.

---

## 1. 지금 당장 할 일 (Swain)

1. ~~**마이그레이션 1회**~~ → **2026-10-07 Swain 호출 완료**(letters 3칸·timeline 표 생성 확인). 1회용 파일 삭제 커밋 완료.
   마이그 후 라이브 재검증(2026-10-07): 편지 보내기 → 출판 동의·질문·초대 경로·기기값 저장 확인 / 같은 기기 60초 안 두 번째 편지 429 / 징검다리 표 ready / 점검 자료 정리·별빛 수 원복.
2. **징검다리 첫 기록 등록** — 추모관 관리 › 온기의 징검다리 (0건이면 아침관에서 구간 자체가 안 보임).
3. **근황에 사진 붙이기** — 추모관 관리 › 유가족 근황 › 사진 (선택).
4. 눈으로 한 번 — 선생님 화면에서 편지 1통 보내보기(질문 카드·출판 동의) → 위 봉투에 바로 놓이고 진행바가 1 오르는지. (자동 점검으로는 통과했으나 운영자 눈 확인 권장)

---

## 2. 시트 22행 → 반영 내역

| 요청 | 반영 |
|---|---|
| 전환 버튼 문구 | «밤 · 꺼지지 않는 밤 / 아침 · 다시 뜨는 하루» |
| 밤 첫 화면 제목 | «사람은 두 번 떠난다고 합니다. 세상에서 한 번, 기억에서 한 번. 두 번 이별은 없도록 기억해주세요.» (부제 유지) |
| 선생님 화면 별빛/편지 두 갈래 삭제 | «나만의 서신 작성하기» 하나. 보낸 편지는 위 «기억의 편지»에 즉시 봉투로 |
| 편지 30통 목표 | 문구 + 진행바(모인 통수/목표). 목표·문구는 추모관 설정, 선생님별 목표는 선생님 수정 |
| 질문 카드 5~6개 | 기본 6개(어드민에서 교체 가능). 고른 질문이 편지의 제목(주제) |
| 한 문장이어도 충분합니다 + 예시 자리글 | 작성란 라벨·placeholder (어드민 수정 가능) |
| 출판 동의 체크 | 체크박스 → `memorial_letters.publish_consent` (마이그 후). 모더레이션 목록에 «출판 동의» 표시 |
| 먼저 도착한 짧은 편지 2~3통 + 유도 카드 | 작성란 아래. 짧은 편지부터 3통, 마지막은 «당신의 기억도 놓아주세요» |
| 고인별 초대 링크(QR) | 선생님 화면 + 어드민 선생님 수정. `?id=N&invite=1` 로 들어오면 환영 배너 + 편지 자리로 자동 이동. QR은 브라우저에서 생성(cdnjs qrcode-generator, 누를 때만 로드) |
| 음성·손편지 확장 여지 | `memorial_letters.meta jsonb` (topic·invited·attachments[]) |
| 아침 제목 | «그날 이후의 시간을, 유가족들이 함께 살아내고 있습니다» (부제 유지) |
| 유가족 근황 모달 + 사진 | 카드 → 모달(사진·전문). 어드민 사진 업로드 |
| 유가족의 목소리(영상) | 삭제 아님, 아침관 **맨 아래**로 |
| 응원 한마디 / 들판 숫자·내 꽃 찾기 / 함께 보낸 응원 | **삭제**. 배경의 꽃은 밤의 별빛 수만큼 장식으로 유지(Swain 결정) |
| 온기의 징검다리 | 심리상담·법률·장학 카드 3개 삭제 → 시간순 연혁(날짜·구분·제목·요약·상세·사진·링크). 표 `memorial_timeline` + 어드민 탭 |
| 하단 버튼 | «교사유가족협의회 후원하기» |

변경 없음: 기억하는 선생님들, 선생님 첫 화면·소개·생전 사진, 메인 별빛 밝히기·남겨주신 마음.
※ 시트의 «홈페이지 수정»·«AM 수정 사항» 탭은 별건 — 이번 라운드에서 손대지 않음.

---

## 3. Swain 결정 (2026-10-07 · 바꾸지 말 것)

| 결정 | 선택 |
|---|---|
| 아침 배경의 꽃 | **장식으로 유지** (응원 블록만 삭제) |
| 서신 로그인 | **로그인 없이 허용** + 안전장치 3종(비회원 엄격 AI 검토·못 봤으면 보류·60초 간격). 편지 1통 = 별빛 1개(헌화 자동 생성) |
| 저장소 | **마이그레이션 1회**로 정식 칸·표 (임시 JSON 저장 안 함) |
| QR | **브라우저 생성 소형 라이브러리** (외부 QR 서비스 X) |

---

## 4. 어드민에서 관리되는 것 (추가분)

| 어디서 | 무엇을 |
|---|---|
| 추모관 설정 › 아침 구간 | 근황 구간 제목·설명 / 징검다리 구간 제목·설명 (`hallCopy.morning.notesTitle…timelineSub`) |
| 추모관 설정 › ③ 서신 작성 구간 | 딱지·제목·설명 / 목표 통수·목표 문구·달성 문구·설명 / 질문 카드(줄마다 하나) / 작성란 예시·안내 / 초대장 문구 (`hallCopy.teacher.letter*`, `invite*`) |
| 추모관 설정 › 서신 작성 구간 표시 | 옛 «헌화 표시» 토글의 새 뜻 (끄면 편지 못 보냄) |
| 선생님 관리 › 수정 | 편지 목표 통수(`pageCopy.letterGoal`) · 초대 링크 복사·QR |
| 추모관 관리 › 유가족 근황 | 사진 업로드 (`photo_blob_id`) |
| 추모관 관리 › **온기의 징검다리** (신규 탭) | 날짜·날짜 표기·구분·제목·요약·자세한 이야기·사진·링크·정렬·공개 |
| 모더레이션 › 기억의 편지 | «출판 동의»·«비회원» 표시 |

---

## 5. 파일 지도 (이번 라운드)

```
public/
  memorial.html / js/memorial.js / css/memorial.css          아침관 재구성 · 근황 모달 · 징검다리
  memorial-teacher.html / js/memorial-teacher.js / css/memorial-teacher.css   서신 작성 구간 전면 교체
  admin-memorial.html / js/admin-memorial.js                 징검다리 탭 · 근황 사진 · 서신 설정 · 초대 링크

netlify/functions/
  memorial-letters.ts            비회원 허용 · 출판동의/meta · 60초 간격 · 헌화 자동 생성
  memorial-family-notes.ts       photoUrl
  admin-memorial-family-notes.ts photoBlobId
  memorial-timeline.ts           신설(공개)
  admin-memorial-timeline.ts     신설(관리)
  admin-memorial-moderation.ts   편지 출판동의·비회원 표시
  migrate-memorial-v3.ts         ★ 1회용 (호출 후 삭제)

lib/
  memorial-letter-extras.ts      편지 추가 칸 유무 확인·저장·도배 확인·동의 맵
  memorial-timeline.ts           징검다리 공용(표 유무·컬럼·모양)
  release-drafts.ts              APP_VERSION 2026-10-07.1 + 초안
```

### DB (마이그 1회 — `migrate-memorial-v3`)
```
memorial_letters.publish_consent boolean default false
memorial_letters.meta            jsonb   {topic, invited, anonymousWriter, source, attachments:[]}
memorial_letters.ip_hash         varchar(64)   (+ 부분 인덱스)
memorial_family_notes.photo_blob_id integer     (스키마엔 이미 있음 — 안전용 IF NOT EXISTS)
memorial_timeline                신규 표
```
모두 raw SQL + 유무 확인 패턴(schema.ts 미반영 — CLAUDE.md §9.1.1). 마이그 전 배포돼도 깨지지 않는다.

---

## 6. 검증 방법 (이번에 쓴 것)

- `node --check` 3개 JS · `npx tsc --noEmit` 통과.
- **로컬 가짜 서버 + 헤드리스 크롬**: scratchpad `mock-server.js`(public 정적 + /api 고정 응답 + 오류 수집·`?mockcss=`·`?mockjs=` 주입) → `chrome --headless=new --screenshot/--dump-dom`.
  메인(밤·아침)·선생님(`?invite=1`)·어드민 5탭 캡처, 콘솔 오류 0, 가로 넘침 0.
  ⚠️ 헤드리스 크롬은 창 최소 폭 500px — 430으로 찍으면 레이아웃은 500으로 잡히고 캡처만 잘린다(넘침 아님).
  ⚠️ `--screenshot`은 스크롤 위치를 무시한다 — 아래 구간은 `?mockcss=#hallNight{display:none}` 식으로 위를 감추고 찍을 것.

---

## 7. 남은 일 / 선택

- [ ] 마이그 호출 뒤 `migrate-memorial-v3.ts` 삭제 커밋
- [ ] 메뉴얼(`manual-admin`)·AI 비서 지식에 «온기의 징검다리»·«서신 작성(30통)» 반영 (release_checklist)
- [ ] 편지가 실제로 쌓이면 보류 비율 관찰 (비회원 엄격 검토가 과하면 프롬프트 조정)
- [ ] (선택) 책 엮기용 «출판 동의 편지만 내보내기»(CSV) — 지금은 모더레이션 표시까지만
- [ ] (선택) 음성·손편지 사진 업로드 채널 — `meta.attachments` 자리만 마련됨
