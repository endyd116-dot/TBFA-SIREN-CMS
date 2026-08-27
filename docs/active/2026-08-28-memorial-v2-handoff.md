# 추모관 v2 「굿나잇, 굿모닝」 — 인수인계

> 2026-08-28 · 이전 세션 컨텍스트 한계로 분할. **이 문서만 읽으면 이어서 작업 가능.**

---

## 0. 한 줄 요약

추모관을 부수고 **밤(선생님 추모) · 아침(유가족 응원)** 두 마음으로 새로 지었다.
**핵심 장치**: 참여 하나가 밤에는 하늘의 **별**, 아침에는 들판의 **꽃**으로 두 번 나타난다.

**지금 상태: 선생님 개별 화면까지 코드 완성 · 커밋됨 · 아직 배포 안 함(1건 미푸시).**

---

## 1. 지금 당장 할 일

```bash
cd "c:/Users/Administrator/Desktop/작업/dev/tbfa-mis"
git log --oneline origin/main..HEAD    # 미배포 커밋 확인 (157d24b3)
git push origin main                    # ← 배포
```

배포 후 라이브 검증 (§6 참조). **Swain 지시: 배포는 모아서 한 번에.** 자잘한 push 금지.

---

## 2. 완료된 것 (배포됨)

| 항목 | 내용 |
|---|---|
| 메인 추모관 | `memorial.html` 전면 재작성 — 밤 → 여명 → 아침 한 흐름 |
| 별↔꽃 엔진 | `js/memorial-sky.js` 신설 |
| 스타일 | `css/memorial.css` 신설 |
| 익명 참여 | 로그인 없이 한마디·응원 가능 + 안전장치 3종 |
| 배경 전환 | 밤·아침 **구간 전체**가 하늘·들판 (상자 제거) |
| 유가족 근황 | 공개/관리 API + 어드민 탭 |
| 밤·아침 문구 | 어드민 '추모관 설정'에서 편집 |

## 3. 완료·미배포 (커밋 157d24b3)

**선생님 개별 화면 재설계**
- `memorial-teacher.html` 전면 재작성
- `js/memorial-teacher.js` 전면 재작성
- `css/memorial-teacher.css` 신설
- `api/admin-memorial-teacher-photos` 신설
- 어드민: 선생님 편집 열면 그 아래 '생전의 순간(사진)' 관리가 함께 열림

**화면 구성**: 첫 화면(배경 별+영정+숫자 3개) → 소개 → 순간들(사진 격자, 누르면 이야기) → 발자취(타임라인) → 마음(헌화+한마디) → 편지

---

## 4. 설계 결정 (Swain 확정 — 바꾸지 말 것)

| 결정 | 내용 |
|---|---|
| 참여 시각화 | **별↔꽃** — 같은 마음, 두 얼굴 |
| 전환 방식 | 스크롤로 이어짐 + 상단 전환 버튼 |
| 아침관 구성 | 유족 이야기 영상 · 응원 한마디 · 근황 소식 · 지원 프로그램 **4종 전부** |
| 익명 참여 | **허용** + 조건 3가지 (아래) |
| AI 검토 등급 | 비회원 글만 **HIGH**, 회원 글은 LOW |
| 사진 등록 주체 | **운영자만 (A안)** — 고인·유가족 사진이라 |
| 디자인 톤 | 세련·깔끔 + 존엄·따뜻. **추모 분위기에 짓눌리지 않게** |
| 배포 | **모아서 한 번에** |

### 익명 참여 안전장치 3종 (구현 완료)
1. 비회원 글은 HIGH 체인으로 검토 (`moderateMemorialText(text, {thorough:true})`)
2. **못 봤으면 보류** — 회원 글은 통과, 비회원 글은 `isHidden=true`
   예산 소진이면 운영자에게 별도 문구로 알림
3. 도배 방지 — 비회원 같은 기기 **60초 1회** (`ANON_COOLDOWN_SECONDS`)
4. (덤) 남긴 직후 가입 권유 — 로그인 벽 대체

---

## 5. 파일 지도

```
public/
  memorial.html              밤·여명·아침 (재작성)
  memorial-teacher.html      선생님 개별 (재작성)
  css/memorial.css           메인 스타일
  css/memorial-teacher.css   선생님 화면 스타일
  js/memorial-sky.js         별↔꽃 엔진 ★핵심
  js/memorial.js             메인 동작
  js/memorial-teacher.js     선생님 화면 동작
  admin-memorial.html        어드민 (탭 5개: 선생님·모더·이달·유가족근황·설정)
  js/admin-memorial.js       어드민 동작

netlify/functions/
  memorial-summary.ts              + hallCopy
  memorial-messages.ts             + kind, 익명, 도배방지, 보류규칙
  memorial-teacher.ts              + photos, pageCopy
  memorial-family-notes.ts         신설(공개)
  admin-memorial-family-notes.ts   신설(관리)
  admin-memorial-teacher-photos.ts 신설(관리)

lib/
  memorial-moderation.ts     + checked, skipReason, thorough
  client-ip.ts               신설 (헌화·방명록 공용)
  shell-lists.ts             선생님 카드 마크업이 mem2-* 로 바뀜 ★
```

### DB (마이그레이션 3회 모두 적용 완료)
```
memorial_messages.kind        tribute | support
memorial_messages.ip_hash     도배 방지
memorial_settings.hall_copy   밤·여명·아침 문구
memorial_teachers.page_copy   선생님별 문구
memorial_family_notes         유가족 근황 (신규 표)
memorial_teacher_photos       생전 사진 (신규 표)
```

---

## 6. 검증 방법 (중요 — 추측 금지)

이 라운드에서 **눈에 안 보이는 실패**를 두 번 겪었다. 반드시 브라우저 안에서 확인할 것.

```bash
SC="C:/Users/ADMINI~1/AppData/Local/Temp/claude/c--Users-Administrator-Desktop----dev-tbfa-mis/0db33884-963c-4091-a37c-1b5dbfaad185/scratchpad"
node "$SC/probe.js" "https://tbfa.co.kr/memorial.html" "<확인할 식>" 8000
```

`probe.js`는 크롬을 조종 모드로 띄워 화면 안에서 코드를 실행하고 **콘솔 오류까지** 받아온다.

**배포 후 확인할 것**
```js
// 선생님 화면
JSON.stringify({
  이름: (document.getElementById('mtName')||{}).textContent,
  사진수: document.querySelectorAll('.mt2-photo').length,
  숫자: (document.getElementById('mtCandle')||{}).textContent,
  히어로별: (function(){var c=document.getElementById('mtHeroSky');if(!c)return -1;
    var d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;var n=0;
    for(var i=3;i<d.length;i+=4){if(d[i]>10)n++;}return n})()
})
```
→ `/memorial-teacher.html?id=1` 로 확인. 히어로별 픽셀이 0이면 엔진이 죽은 것.

**이번에 겪은 실패 2건 (재발 주의)**
1. `this._tick.bind(this)` — 없는 함수를 묶어 엔진이 통째로 죽음. `mount()`가 예외를 잡아 `null`을 반환해 **화면은 조용히 빈 칸**으로 나갔다.
2. 헌화 수가 늦게 도착해 하늘이 몇 개만 그려짐 → `paintCounts()`에서 `refreshSky()` 호출로 해결.

---

## 7. 남은 일

### 반드시
- [ ] **미배포 커밋 1건 push** (157d24b3)
- [ ] 배포 후 선생님 화면 라이브 검증 (§6)
- [ ] 메인 추모관도 재확인 — 배경 전환 후 별·꽃이 실제로 보이는지

### Swain 요청 대기
- [ ] 점검용 글 삭제 — 어드민 > 모더레이션에서 `[점검용 16:14:21]` (보류 상태라 비공개)
- [ ] AI 검토 기능이 실제로 켜져 있는지 확인 (`memorial_moderation` 예산·토글)
      → 꺼져 있으면 **모든 비회원 글이 보류**되어 사실상 '운영자 승인제'로 돈다
- [ ] 유가족 근황 등록 (지금 0건 → 아침관 첫 구획이 빈 안내로 나감)

### 선택
- [ ] 선생님별 화면 문구(`pageCopy`) 편집 UI — 자리는 만들었으나 어드민 입력란 미구현
- [ ] `업데이트 소식` 초안에 선생님 화면 재설계 항목 추가 (`lib/release-drafts.ts`)

---

## 8. 주의사항

- **`shell-lists.ts`와 화면 마크업은 짝**이다. 선생님 카드 구조를 바꾸면 `renderMemorialCards`도 같이 고칠 것. 안 하면 서버가 옛 모양으로 조용히 채운다.
- **heredoc으로 JS/CSS를 쓰지 말 것.** 이 세션에서 두 번 깨졌다. Write 도구로 임시 파일에 쓴 뒤 python으로 붙이는 방식이 안전하다.
- 성능: 홈 91점을 지켜야 한다. 별은 도장(sprite) 방식이고 상한 1,400. 화면 밖·다른 탭이면 정지.
- `assets/추모관/RCxhlRt/` 는 참조 사이트 원본. 그대로 베끼지 말 것(Swain 지시).
