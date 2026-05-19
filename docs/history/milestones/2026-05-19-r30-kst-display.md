# R30 — KST 표시 영역 통일

> 작성: 2026-05-19 / 메인
> 발사: **R29-GAP-P1·P2 머지·검증 완료 후**
> 범위: UI/toast/로그 등 사용자가 보는 시각 표시만 KST로 통일. DB 저장(UTC)·cron(KST 환산 이미 적용)은 변경 없음.

---

## §0 목표

브라우저 로컬타임에 의존해 일본·미국 사용자에게 다르게 보이거나, UTC 그대로 노출되어 9시간 어긋나는 모든 표시 시각을 **한국 표준시(Asia/Seoul) 단일 기준**으로 통일.

---

## §1 범위·비범위

### 범위 (변경 대상)
- 프론트 JS의 `new Date(x).toLocaleString()`·`toLocaleDateString()`·`toLocaleTimeString()` 사용처 전수
- 토스트·알림 본문 시각
- 작업 created/updated, 출퇴근 시각, 결산 submittedAt 등 화면 표시
- 이메일 본문 발송 시각 (서버에서 KST로 변환 후 전달)
- 로그 표시 (audit 로그 화면)

### 비범위 (유지)
- DB timestamp 컬럼 저장 (UTC 유지)
- cron 함수 — `lib/datetime.ts`로 이미 KST 환산
- toss/효성 결제 PG 콜백 시각 (외부 시스템 표준 유지)

---

## §2 헬퍼 신설

### 프론트: `public/js/lib-kst.js`
```js
window.fmtKST = function(date, opt) {
  if (!date) return '-';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '-';
  const fmt = opt || { dateStyle:'medium', timeStyle:'short' };
  return d.toLocaleString('ko-KR', Object.assign({ timeZone:'Asia/Seoul' }, fmt));
};
window.fmtKSTDate = (date) => window.fmtKST(date, { dateStyle:'medium' });
window.fmtKSTDateTime = (date) => window.fmtKST(date, { dateStyle:'medium', timeStyle:'short' });
window.fmtKSTLong = (date) => window.fmtKST(date, { dateStyle:'long', timeStyle:'medium' });
```

### 백엔드: `lib/datetime.ts` (이미 존재 — KST 헬퍼 확장)
- `fmtKSTForEmail(date): string` — "2026년 5월 19일 오후 3시 25분" 형식
- `toKstIso(date): string` — "2026-05-19T15:25:00+09:00"

---

## §3 인벤토리 (A·B 발사 시 grep으로 수집)

### 후보 grep 패턴
- `toLocaleString\\(\\)` (옵션 없는 호출 — 가장 위험)
- `toLocaleDateString\\(\\)`
- `toLocaleTimeString\\(\\)`
- `new Date\\([^)]+\\).toString`
- `\\.toISOString\\(\\)` (UI 표시용 한정 — DB 저장은 유지)

예상 영향 파일:
- `public/js/workspace-*.js` (다수)
- `public/js/admin-*.js` (다수)
- `public/js/incident.js`, `harassment.js`, `legal.js`
- `public/js/chat-*.js`
- 일부 백엔드 함수의 이메일 템플릿

---

## §4 라운드 분할 (예정)

| Phase | 영역 | 담당 | 비고 |
|---|---|---|---|
| R30-P1 | 프론트 헬퍼·핵심 5페이지 (workspace·attendance·milestones·incident·chat) | A | 헬퍼 + 핵심 사용처 50건 내외 |
| R30-P2 | 어드민 화면·이메일 템플릿 | B | 어드민 30~50건 + 이메일 본문 |

(상세 체크리스트는 발사 시점에 P1·P2 트리거 본문에 박음.)

---

## §5 검증 시나리오 (C, 발사 후)

- Q1. 출퇴근 시각 KST 표시 (UTC 09:00 저장 → "오후 6:00" 표시)
- Q2. 결산 submittedAt KST 표시
- Q3. 알림 시각 KST 표시
- Q4. 작업 카드 created/updated KST 표시
- Q5. 이메일 본문 발송 시각 KST 표기

---

## §6 운영 영향

- 사용자 브라우저 시간대(일본·미국 등) 무관하게 한국 시간 일관
- 기존 데이터 변환 없음 (저장은 UTC 유지)
- 표시 함수만 교체 → 회귀 위험 낮음
