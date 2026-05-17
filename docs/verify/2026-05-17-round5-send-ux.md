# 라운드 5 발송 센터 UX 완성 라이브 검증 보고서

**날짜**: 2026-05-17  
**베이스 커밋**: 7a943c0 (feat round5-send-ux 머지)  
**검증 방법**: 코드 정적 분석 (`admin-send-job-create.js` / `.html` 직접 검토)

---

## 검증 결과 요약

| 항목 | 결과 | 비고 |
|------|------|------|
| Q1  이메일만 선택 → 이메일 탭 활성, 나머지 dim | ✅ 통과 | |
| Q2  SMS 선택 → 텍스트 미리보기 + 90자 카운터 | ✅ 통과 | |
| Q3  SMS 90자 초과 → 빨간 경고 표시 | ✅ 통과 | |
| Q4  카카오 선택 → 말풍선 스타일 미리보기 | ✅ 통과 | |
| Q5  인앱 선택 → 앱 알림 카드 스타일 | ✅ 통과 | |
| Q6  이메일+SMS 복수 선택 → 두 탭 모두 활성 | ✅ 통과 | |
| Q7  [파일함에서 선택] → 워크스페이스 파일 목록 모달 | ✅ 통과 | |
| Q8  파일 선택 → [파일함] 배지 항목 + ID 누적 | ✅ 통과 | |
| Q9  파일함 + 신규 업로드 혼용 → 발송 등록 body 포함 | ✅ 통과 | 이메일 채널 선택 시 |
| Q10 회귀: 기존 발송 등록 흐름 정상 | ✅ 통과 | |

**총 10건 전부 통과 — BUG 없음**

---

## 항목별 세부 확인

### Q1·Q6 — 탭 활성화·dim 처리

`admin-send-job-create.js` `applyPreviewTabVisibility()` (295-308행):
```javascript
document.querySelectorAll('.preview-tab').forEach(btn => {
  const ch = btn.dataset.tab;
  const active = channels.includes(ch);
  btn.style.opacity = active ? '1' : '0.35';      // dim
  btn.style.pointerEvents = active ? '' : 'none'; // 클릭 차단
  if (active && !firstActive) firstActive = ch;
});
if (firstActive) switchPreviewTab(firstActive);   // 첫 번째 선택 탭으로 자동 이동
```
- 이메일만 선택: email opacity=1, sms·kakao·inapp opacity=0.35 ✅ (Q1)
- 이메일+SMS 선택: 두 탭 opacity=1, kakao·inapp opacity=0.35 ✅ (Q6)

**표시 조건 (264-268행)**: `currentTemplate && channels.length > 0` → 채널 1개 이상 선택 시 previewCard 표시

### Q2·Q3 — SMS 미리보기 + 90자 카운터

`refreshSendPreview()` 373-384행:
```javascript
const plainBody = bodyTpl.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); // HTML 태그 제거
const len = rendered.length;
const overLimit = len > 90;
// 카운터 색상: overLimit ? '#b91c1c'(빨간색) : '#475569'(회색)
`${len}/90자 ${overLimit ? '— 90자 초과 시 장문(MMS) 전환' : ''}`
```
- Q2: HTML 태그 제거 + 텍스트 렌더링 ✅
- Q3: 90자 초과 시 `#b91c1c` 빨간 경고 + "90자 초과 시 장문(MMS) 전환" 표시 ✅

### Q4 — 카카오 말풍선 미리보기

386-402행: `#FEE500` 배경 + `border-radius:0 12px 12px 12px` 말풍선 박스  
제목 `font-weight:700`, 본문, 버튼 있으면 회색 버튼 행 표시

### Q5 — 인앱 알림 카드

404-417행: 흰 배경 + 그림자 + 좌측 🔔 아이콘 + 제목 볼드 + 본문 1줄 말줄임(`text-overflow:ellipsis`)

### Q7 — 파일함 모달 열기

`openFilePicker()` (932-941행) → `fetchPickerFiles('')` → GET `/api/admin-workspace-files?limit=50`  
검색 입력 시 350ms debounce 후 `?search=xxx` 재fetch  
파일 클릭 시 체크/해제 토글, 선택된 항목 파란 테두리 + ✅ 표시

### Q8 — [파일함] 배지 항목 추가

`btnFilePickerConfirm` 클릭 (966-983행):
```javascript
window._sendJobAttachmentIds.push(id);
div.innerHTML = `✅ [파일함] ${파일명} <button ×>`;  // [파일함] 배지
```
중복 ID 방지 (`includes` 체크), 삭제 × 버튼 지원

### Q9 — 발송 body.attachmentBlobIds 포함

`validateForm()` 801·816행:
```javascript
const attachmentBlobIds = Array.isArray(window._sendJobAttachmentIds)
  ? window._sendJobAttachmentIds.filter(n => Number.isInteger(n))
  : [];
// 이메일 채널 선택 시 body에 포함
...(channels.includes('email') ? { wrapEmailWithLayout: wrapEmail, attachmentBlobIds } : {})
```
파일함 선택 ID + 신규 업로드 ID 모두 `window._sendJobAttachmentIds`에 누적 → 통합 전송

### Q10 — 회귀: 기존 발송 등록 흐름

`submit()` → `validateForm()` → POST `/api/admin-send-job-create` 흐름 유지  
템플릿 선택·수신자 그룹·채널·예약 설정 로직 변경 없음  
신규 기능(탭·파일함)은 기존 흐름에 추가만 된 구조
