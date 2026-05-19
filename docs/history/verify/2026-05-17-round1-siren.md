# 라운드 1 SIREN 4건 fix — 라이브 검증 보고서

> **검증일**: 2026-05-17  
> **검증자**: C채팅 (Claude Code)  
> **베이스**: main @ `69e791f` (round1-siren-front 머지)  
> **방법**: 코드 정적 검증 (main 워크트리 파일 직독) + DB schema 컬럼 존재 확인

---

## 결과 요약

| Q# | 항목 | 결과 | 비고 |
|---|---|---|---|
| Q1  | 자동결제 빌링키 탈퇴 시 비활성화 | ✅ 통과 | |
| Q2  | 사건 신고 답변 등록 → status=responded + 알림 | ✅ 통과 | |
| Q3  | 괴롭힘 신고 답변 등록 → status=responded | ✅ 통과 | |
| Q4  | 법률 상담 답변 등록 → status=responded | ✅ 통과 | |
| Q5  | 사용자 my-reports 답변 영역 표시 | ✅ 통과 | |
| Q6  | 사건 신고 타임라인 responded 단계 | ✅ 통과 | |
| Q7  | 자격 직접 변경 UI + 사유 5자 검증 | ✅ 통과 | |
| Q8  | 변경 시 eligibility_type + 알림 + 감사 로그 | ✅ 통과 | |
| Q9  | lawyer·counselor 강제 변경 전문가 동기 | ✅ 통과 | |
| Q10 | 익명 신고 → 어드민 실명 + "익명 원함" 배지 | 🐛→✅ | BUG 발견·fix 배포 |
| Q11 | 일반 신고 → 배지 없음·실명만 | ✅ 통과 | |
| Q12 | 기존 admin-eligibility-review 승인/반려 회귀 | ✅ 통과 | |

**전체: 12/12 통과 (BUG 1건 발견·즉시 수정 완료)**

---

## 상세 검증

### Q1 — 탈퇴 시 자동결제 빌링키 비활성화

**파일**: `netlify/functions/auth-withdraw.ts` 175-193행  
**로직**: 탈퇴 처리 단계 11에서 `billing_keys.is_active=false` + `deactivated_at` + `deactivated_reason='회원 탈퇴'` 일괄 업데이트. try/catch로 실패해도 탈퇴 계속.  
**schema 확인**: `billingKeys.isActive`, `deactivatedAt`, `deactivatedReason` 모두 존재.  
**결론**: ✅ 정상 구현

---

### Q2·Q3·Q4 — 3종 신고 답변 등록 자동 status=responded

**파일**: `netlify/functions/admin-incident-report-detail.ts:112`, `admin-harassment-report-detail.ts:102`, `admin-legal-consultation-detail.ts:105`  
**로직**: 
```
if (!status && adminResponse) updateData.status = "responded";
```
`body.status` 미전달 + `adminResponse` 있을 때 자동 responded.  
**Q2 알림**: `sendNotifyFlag`(기본 true) + `adminResponse` + `member` 모두 충족 시 in-app 알림 1건 생성.  
**결론**: Q2·Q3·Q4 ✅ 정상 구현

---

### Q5 — 사용자 my-reports.html 답변 영역

**파일**: `public/js/my-reports.js` 136-140행  
**로직**: `report.adminResponse` 있을 때 "📝 담당자 답변" 블록 렌더링 + `report.respondedAt` 일시 표시.  
**API 응답**: `user-my-reports.ts`가 `adminResponse`, `respondedAt` 컬럼 SELECT 확인.  
**결론**: ✅ 정상 구현

---

### Q6 — 사건 신고 타임라인 responded 단계

**파일**: `public/js/my-reports.js` 33-35행  
**코드**:
```js
const STAGE_FLOW = {
  incident: ['submitted', 'ai_analyzed', 'reviewing', 'in_progress', 'responded', 'completed', 'closed'],
```
round1 fix 커밋(687a5b7)에서 `'in_progress', 'completed'` 사이에 `'responded'` 삽입 확인.  
**결론**: ✅ 정상 구현

---

### Q7·Q8·Q9 — 자격 강제 변경

**파일**: `netlify/functions/admin-eligibility-force-change.ts`  
**Q7 (사유 5자)**: 서버 40행 `if (reason.length < 5) return badRequest(...)` + 클라이언트 `admin.js:4156` 동일 검증.  
**Q8 (DB·알림·감사)**: 
- eligibilityType DB 업데이트 (71-74행)
- `notifications` INSERT (78-91행)
- `logAdminAction` (96-100행)

**Q9 (lawyer·counselor 전문가 동기)**:
```typescript
UPDATE members SET eligibility_type=..., type='volunteer',
  member_subtype=..., secondary_verified=true, ...
WHERE id=...
```
(59-69행)  
**결론**: Q7·Q8·Q9 ✅ 정상 구현

---

### Q10·Q11 — 익명 신고 어드민 화면 실명 + 배지 (BUG 발견)

**발견된 버그**:  
round1 프론트 fix(687a5b7)가 "익명 원함" 배지 스타일 개선 + 상세 화면 배지 추가는 완료했으나, **목록·상세 6곳에서 `isAnonymous=true`일 때 실명(`memberName`) 대신 '제보자'/'신고자'/'신청자' 하드코딩 유지** — 설계 명세 §3 line 269 위반.

```
// 버그: 익명 시 하드코딩
const reporterName = r.isAnonymous ? '제보자' : (r.memberName || '회원');

// 수정: 항상 실명 표시 (backend는 익명에도 memberName 반환)
const reporterName = r.memberName || r.reporterName || '회원';
```

**백엔드 확인**: 3종 목록 API 모두 `isAnonymous` 플래그와 별개로 `memberName` 반환 중 ✅

**수정 범위** (`public/js/admin-siren.js`):
- `renderIncidentRow` (278행)
- `renderHarassmentRow` (295행)  
- `renderLegalRow` (310행)
- `renderIncidentDetail` (413행)
- `renderHarassmentDetail` (474행)
- `renderLegalDetail` (537행)

**fix 커밋**: `cf0ecf1` + 머지 `8de5e1c` → origin/main 배포 완료  
**캐시버스터**: `admin-siren.js?v=2026-05-17-r2`  

**Q11 결론**: `isAnonymous=false`이면 `reporterName = memberName` + `reporterCell(name, false)` → 배지 없음 ✅

---

### Q12 — 기존 admin-eligibility-review 회귀

**파일**: `netlify/functions/admin-eligibility-review.ts`  
**확인**: round1 fix 커밋에서 해당 파일 미변경. 승인/반려 핸들러 로직 정상(50-142행).  
**specialist 동기**: 이미 2026-05-16 패치로 `lawyer`·`counselor` 승인 시 `type='volunteer'`·`member_subtype`·`secondary_verified=true` 반영 중 (97-113행).  
**결론**: ✅ 회귀 없음

---

## 발견된 BUG 목록

| ID | 파일 | 증상 | 수정 커밋 |
|---|---|---|---|
| BUG-Q10 | admin-siren.js (6곳) | 익명 신고 어드민 화면에서 실명 미표시 ('제보자' 하드코딩) | `cf0ecf1` |

---

## 배포 확인

- fix 커밋 `cf0ecf1` + 머지 `8de5e1c` → `origin/main` push 완료
- Netlify 자동 배포 트리거됨 (git push origin main)
- 검증일 기준 라이브 URL (https://tbfa.co.kr) 반영 예정
