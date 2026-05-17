# 라운드 1 — SIREN 영역 정독 진단 4건 fix 설계서

> **생성**: 2026-05-17 / 메인 채팅
> **베이스**: main @ `511d65e`
> **트리거 출처**: `docs/HANDOFF.md` §4.1 (SIREN Critical 2 + Important 2 = 4건)
> **분배**: 메인(구조·스키마·마이그) + A(프론트) + B(백) + C(검증) — Swain 2026-05-17 결정
> **추정**: 1.5~3일

---

## §0. 요구사항 확정 (Swain 2026-05-17 결정)

| # | 이슈 | 결정 |
|---|---|---|
| 1 | 🔴 회원 탈퇴 시 빌링키 자동 비활성화 | `auth-withdraw.ts`에 `billingKeys.isActive=false` UPDATE 1줄 추가 (자명) |
| 2 | 🔴 신고 status `responded` | **B안 — 응답 등록 endpoint 신설**: 어드민이 답변 작성 시 자동 `status='responded'` 전환. 사용자 마이페이지에 답변 노출 |
| 3 | 🟡 자격 변경 되돌리기 / 강제 변경 | **A안 — 어드민 회원 상세 모달 + 사유 5자 이상 필수**: `admin-eligibility-force-change` 신설. 감사 로그 + 회원 알림 |
| 4 | 🟡 익명 신고 보고자 정보 일관성 | **B안 — 어드민에 실명 노출 + "익명 원함" 배지**: 3종 신고 어드민 목록·상세 일관 표시 |

**DB 마이그**: 불필요 — schema 변경 0건. `adminResponse·respondedBy·respondedAt·isAnonymous` 컬럼 모두 이미 존재.

---

## §1. DB 설계 — 변경 0건

3종 신고 테이블(`incident_reports·harassment_reports·legal_consultations`) 모두 다음 컬럼 이미 보유:
- `adminResponse text` — 어드민 답변 본문
- `respondedBy integer` — 답변 작성 어드민
- `respondedAt timestamp` — 답변 시각
- `isAnonymous boolean` — 익명 신고 여부

`billing_keys.isActive boolean` — 이미 존재.

`eligibility_change_requests` 테이블도 변경 불필요 (강제 변경은 별도 endpoint).

→ **마이그레이션 함수 작성·호출 불필요**.

---

## §2. API 명세 (B 작업 영역)

### 2.1 [수정] `netlify/functions/auth-withdraw.ts` — 빌링키 비활성화

기존 §10 채팅 블랙리스트 해제 블록 옆에 다음 1블록 추가:

```typescript
/* 10.5. 빌링키 자동 비활성화 (탈퇴자는 더 이상 자동결제 불가) */
await db
  .update(billingKeys)
  .set({
    isActive: false,
    deactivatedAt: new Date(),
    deactivationReason: "회원 탈퇴",
  } as any)
  .where(
    and(
      eq(billingKeys.memberId, user.id),
      eq(billingKeys.isActive, true),
    ),
  );
```

import에 `billingKeys` 추가. `billing_keys` 컬럼명 확인 후 `deactivatedAt·deactivationReason` 컬럼 존재 여부 검증 — 없으면 `isActive=false`만 set.

### 2.2 [수정] 3종 신고 답변 등록 자동 status 전환

대상 파일: `admin-incident-report-detail.ts·admin-harassment-report-detail.ts·admin-legal-consultation-detail.ts`

기존 PATCH 핸들러는 `body.adminResponse + body.status` 둘 다 명시해야 status 변경. **body.status 미지정 + adminResponse 있을 때 자동 status='responded'** 추가:

```typescript
// 기존
if (status) updateData.status = status;
if (adminResponse !== undefined) {
  updateData.adminResponse = adminResponse || null;
  if (adminResponse) {
    updateData.respondedBy = (admin as any).uid;
    updateData.respondedAt = new Date();
  }
}

// 신규 (다음 1블록 추가)
if (!status && adminResponse) {
  updateData.status = "responded"; // 답변 작성 시 자동 처리완료 전환
}
```

응답 키 변경 없음 — 기존 `ok({ id, reportNo, emailSent }, message)` 유지.

### 2.3 [수정] `user-my-reports.ts` — 답변 필드 응답 추가

3개 SELECT 모두에 `adminResponse·respondedAt`을 추가, 법률은 `assignedLawyerName`까지:

```typescript
// incident SELECT 확장
rows = await db.select({
  id: incidentReports.id,
  reportNo: incidentReports.reportNo,
  title: incidentReports.title,
  status: incidentReports.status,
  isAnonymous: incidentReports.isAnonymous,
  adminResponse: incidentReports.adminResponse,     // ★ 신규
  respondedAt: incidentReports.respondedAt,         // ★ 신규
  createdAt: incidentReports.createdAt,
  updatedAt: incidentReports.updatedAt,
})
  .from(incidentReports)
  .where(eq(incidentReports.memberId, memberId))
  .orderBy(desc(incidentReports.createdAt))
  .limit(limit).offset(offset);
```

harassment·legal도 동일 패턴. legal은 `assignedLawyerName: legalConsultations.assignedLawyerName` 추가.

응답 최상위 키는 그대로 **`items`**.

### 2.4 [신규] `admin-eligibility-force-change.ts` — 자격 강제 변경

```typescript
// netlify/functions/admin-eligibility-force-change.ts
import type { Context } from "@netlify/functions";
import { db, members, notifications } from "../../db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, notFound, methodNotAllowed, serverError, parseJson } from "../../lib/response";
import { logAudit } from "../../lib/audit";

export const config = { path: "/api/admin-eligibility-force-change" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return methodNotAllowed();
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member as any;
  const adminId = adminMember.id as number;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("body 필수");

    const memberId = Number(body.memberId);
    const newType = String(body.newEligibilityType || "").trim();
    const reason = String(body.reason || "").trim();

    if (!memberId) return badRequest("memberId 필수");
    if (!newType) return badRequest("newEligibilityType 필수");
    if (reason.length < 5) return badRequest("강제 변경 사유 5자 이상 필수");

    /* 대상 회원 조회 */
    const [target]: any = await db.select({
      id: members.id, name: members.name, eligibilityType: members.eligibilityType,
      type: members.type, memberSubtype: members.memberSubtype,
    }).from(members).where(eq(members.id, memberId)).limit(1);
    if (!target) return notFound("회원을 찾을 수 없습니다");

    const beforeType = target.eligibilityType;
    const expertTypes = ["lawyer", "counselor"];
    const isExpert = expertTypes.includes(newType);

    /* 자격 강제 변경 */
    if (isExpert) {
      await db.execute(sql`
        UPDATE members
           SET eligibility_type = ${newType},
               type = 'volunteer',
               member_subtype = ${newType},
               secondary_verified = true,
               secondary_verified_at = now(),
               updated_at = now()
         WHERE id = ${memberId}
      `);
    } else {
      await db.execute(sql`
        UPDATE members
           SET eligibility_type = ${newType},
               updated_at = now()
         WHERE id = ${memberId}
      `);
    }

    /* 회원 알림 */
    try {
      await db.insert(notifications).values({
        recipientId: memberId,
        recipientType: "user",
        category: "eligibility",
        severity: "info",
        title: `회원 자격이 변경되었습니다: ${newType}`,
        message: `사유: ${reason}`.slice(0, 500),
        link: "/mypage.html#eligibility",
        refTable: "members",
        refId: memberId,
      } as any);
    } catch (notifyErr: any) {
      console.warn("[admin-eligibility-force-change] 알림 실패:", notifyErr?.message);
    }

    /* 감사 로그 */
    await logAudit({
      userId: adminId, userType: "admin", userName: adminMember.name,
      action: "eligibility.force_change",
      target: `member:${memberId}`,
      detail: { memberName: target.name, beforeType, afterType: newType, reason },
      req,
    });

    return ok(
      { memberId, beforeType, afterType: newType },
      "회원 자격이 강제 변경되었습니다"
    );
  } catch (err: any) {
    console.error("[admin-eligibility-force-change]", err);
    return serverError("자격 강제 변경 중 오류", err);
  }
};
```

**B push 전 체크**: schema에서 `eligibilityType·memberSubtype·secondaryVerified` 정의 존재 확인, `logAudit` import 경로 검증.

---

## §3. 화면 설계 (A 작업 영역)

### 3.1 [수정] `public/js/my-reports.js`

```diff
- ${report.adminComment ? `
+ ${report.adminResponse ? `
    <div style="background:#fffaf5;border:1px solid #f5dcc8;border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.7">
      <strong style="color:var(--brand)">📝 담당자 답변</strong><br>
-     ${escapeHtml(report.adminComment)}
-     ${report.adminCommentAt ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px">${fmtDate(report.adminCommentAt)}</div>` : ''}
+     ${escapeHtml(report.adminResponse)}
+     ${report.respondedAt ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px">${fmtDate(report.respondedAt)}</div>` : ''}
    </div>
  ` : ''}
```

`STAGE_FLOW.incident`에 `'responded'` 추가:
```diff
- incident: ['submitted', 'ai_analyzed', 'reviewing', 'in_progress', 'completed', 'closed'],
+ incident: ['submitted', 'ai_analyzed', 'reviewing', 'in_progress', 'responded', 'closed'],
```

응답 키 처리:
```diff
- const rows = json.data?.rows || json.data?.list || json.data || [];
+ const rows = json.items || json.data?.rows || json.data?.list || json.data || [];
```

캐시버스터 `?v=N` 갱신.

### 3.2 [수정] 어드민 SIREN 신고 상세 화면 (`public/js/admin-siren.js`)

기존 신고 상세 모달에 **답변 등록 영역**이 있다면 그대로 사용. 없거나 status='in_progress'까지만 보내고 있다면, "답변 등록" 버튼이 PATCH 시 `body: { id, adminResponse, sendEmail, sendNotify }` (status 생략) 전송하도록 수정 — 백엔드가 자동 `status='responded'` 처리.

3종 신고 모두 동일 패턴:
- POST endpoint 그대로: `/api/admin/incident-report-detail` (PATCH), `/api/admin/harassment-report-detail` (PATCH), `/api/admin/legal-consultation-detail` (PATCH)
- body: `{ id, adminResponse, sendEmail: true, sendNotify: true }`
- 응답 후 목록 새로고침

### 3.3 [수정] 어드민 SIREN 신고 목록·상세 — 익명 배지

3종 어드민 신고 화면(`admin-siren.js` 추정 — list·detail 모두):

```javascript
// 보고자 이름 표시 (실명 + 익명 배지)
function reporterCell(row) {
  const name = row.memberName || row.reporterName || '(미상)';
  const badge = row.isAnonymous
    ? '<span class="anon-badge" style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px;margin-left:6px">익명 원함</span>'
    : '';
  return `${escapeHtml(name)}${badge}`;
}
```

상세 모달 헤더에도 동일 패턴 적용.

### 3.4 [수정] 어드민 회원 상세 모달 — 자격 강제 변경 버튼

대상 화면: 어드민 회원 관리 페이지(`admin-members.html` 또는 `cms-tbfa-iframe` 내). 회원 상세 모달의 자격 표시 옆에 **"직접 변경"** 버튼 추가:

```html
<!-- 회원 상세 모달 자격 영역 -->
<div class="field-row">
  <label>회원 자격</label>
  <div>
    <span id="eligibilityTypeText">${eligibilityType}</span>
    <button type="button" id="btnForceChangeEligibility" class="btn btn-xs btn-outline">
      직접 변경
    </button>
  </div>
</div>

<!-- 강제 변경 모달 -->
<div id="forceChangeModal" class="modal hidden">
  <h3>회원 자격 강제 변경</h3>
  <p>현재 자격: <span id="currentEligibility"></span></p>
  <label>새 자격
    <select id="newEligibilityType">
      <option value="member">일반 회원</option>
      <option value="bereaved">유가족</option>
      <option value="teacher">교원</option>
      <option value="lawyer">변호사 (전문가 풀 자동 등록)</option>
      <option value="counselor">심리상담사 (전문가 풀 자동 등록)</option>
    </select>
  </label>
  <label>변경 사유 (5자 이상)
    <textarea id="changeReason" maxlength="500" required></textarea>
  </label>
  <button id="btnConfirmForceChange">변경 확정</button>
</div>
```

JavaScript:
```javascript
async function forceChangeEligibility(memberId) {
  const newType = document.getElementById('newEligibilityType').value;
  const reason = document.getElementById('changeReason').value.trim();
  if (reason.length < 5) return SIREN.toast('사유는 5자 이상 입력');

  const res = await api('/api/admin-eligibility-force-change', {
    method: 'POST',
    body: { memberId, newEligibilityType: newType, reason },
  });
  if (!res.ok) return SIREN.toast(res.data?.error || '변경 실패');
  SIREN.toast('자격 변경 완료');
  reloadMemberDetail(memberId);
}
```

---

## §4. 검증 시나리오 (C 작업 영역)

| # | 시나리오 | 확인 |
|---|---|---|
| Q1 | 자동 결제 등록한 회원이 탈퇴 → DB billing_keys 해당 회원 `is_active=false` 자동 전환 | sql 직접 조회 |
| Q2 | 어드민이 사건 신고 상세에서 답변 작성 + 저장 → 신고 status `responded` 자동, 사용자 알림 1건 INSERT | DB + 알림 벨 |
| Q3 | Q2와 동일 — 괴롭힘 신고 | DB |
| Q4 | Q2와 동일 — 법률 상담 | DB |
| Q5 | 답변 등록 후 사용자가 마이페이지 /my-reports.html 접속 → 카드에 "📝 담당자 답변" 영역 + 답변 본문·일시 표시 | UI |
| Q6 | 사건 신고 타임라인에 'responded' 단계가 보이고, 답변 등록 후 활성 표시 | UI |
| Q7 | 어드민 회원 상세 모달 → 자격 "직접 변경" 버튼 → 사유 5자 미만 시 거절, 5자 이상 시 변경 성공 | UI + DB |
| Q8 | Q7 변경 시 회원 `members.eligibility_type` 갱신 + 알림 1건 + 감사 로그 1건 | DB |
| Q9 | 변호사·심리상담사로 강제 변경 시 `type='volunteer'`·`member_subtype`·`secondary_verified=true`도 함께 갱신 | DB |
| Q10 | 익명 체크 신고 → 어드민 목록·상세 헤더에 실명 + "익명 원함" 배지 노란색 표시 | UI |
| Q11 | 일반(익명 X) 신고 → 어드민 화면에 실명만, 배지 없음 | UI |
| Q12 | 회귀: 기존 자격 변경 신청(`admin-eligibility-review`) 승인/반려 정상 작동 | 시나리오 |

---

## §5. mock 데이터 (A가 B 머지 전 사용)

### 5.1 user-my-reports 응답 (`/api/user-my-reports?type=incident`)

```javascript
const MOCK_MY_REPORTS = {
  ok: true,
  page: 1,
  items: [
    {
      id: 101, reportNo: "IR-2026-0101", reportType: "incident",
      title: "학교 폭력 신고", status: "responded",
      isAnonymous: false,
      adminResponse: "신고 내용 확인 후 학교에 공식 협조 요청을 보냈습니다. 추가 진행 시 안내드리겠습니다.",
      respondedAt: "2026-05-17T03:00:00Z",
      createdAt: "2026-05-15T10:00:00Z", updatedAt: "2026-05-17T03:00:00Z",
    },
  ],
};
```

### 5.2 admin-eligibility-force-change 응답

```javascript
const MOCK_FORCE_CHANGE = {
  ok: true,
  data: { memberId: 42, beforeType: "member", afterType: "lawyer" },
  message: "회원 자격이 강제 변경되었습니다",
};
```

### 5.3 admin-incident-reports 목록 (익명 배지 검증용)

```javascript
const MOCK_REPORT_LIST = {
  ok: true,
  data: {
    rows: [
      { id: 1, reportNo: "IR-2026-0001", memberName: "김교사", isAnonymous: false, status: "submitted" },
      { id: 2, reportNo: "IR-2026-0002", memberName: "이학부모", isAnonymous: true, status: "reviewing" },
    ],
  },
};
```

---

## §6. 4채팅 시작 프롬프트

### §6.1 B 트리거 (백 구현)

```
[영역: 백엔드(netlify/functions, lib, db)]
[브랜치: feature/round1-siren-back — 새로 생성]

라운드 1 SIREN 4건 fix — 백엔드 작업.
설계서: docs/milestones/2026-05-17-round1-siren.md §2 정독.

━━━ 작업 체크박스 ━━━
□ [#1] netlify/functions/auth-withdraw.ts
   - billingKeys import 추가
   - 채팅 블랙리스트 해제 블록 옆에 빌링키 자동 비활성화 블록 추가
   - billing_keys 컬럼명 확인: isActive, deactivatedAt, deactivationReason 존재 시 모두 set / 없으면 isActive만

□ [#2-a] netlify/functions/admin-incident-report-detail.ts PATCH 핸들러
   - "if (!status && adminResponse) updateData.status = 'responded';" 한 블록 추가

□ [#2-b] netlify/functions/admin-harassment-report-detail.ts PATCH 동일 블록 추가

□ [#2-c] netlify/functions/admin-legal-consultation-detail.ts PATCH 동일 블록 추가

□ [#2-d] netlify/functions/user-my-reports.ts
   - 3개 SELECT 모두에 adminResponse·respondedAt 추가
   - legal SELECT에 assignedLawyerName 추가
   - 응답 키는 그대로 items (변경 X)

□ [#3] netlify/functions/admin-eligibility-force-change.ts 신규 생성
   - 설계서 §2.4 코드 그대로 + import 검증
   - export const config = { path: "/api/admin-eligibility-force-change" }

□ npx tsc --noEmit 통과 확인

□ git push origin feature/round1-siren-back

━━━ 응답 구조 (A mock이 이 구조로 작성됨 — 키명 임의 변경 금지) ━━━
- /api/user-my-reports: { ok, page, items: [{ id, reportNo, reportType, title, status, isAnonymous, adminResponse, respondedAt, createdAt, updatedAt, assignedLawyerName? }] }
- /api/admin-eligibility-force-change: { ok, data: { memberId, beforeType, afterType }, message }
- /api/admin/{incident|harassment|legal}-*-detail PATCH: { ok, data: { id, reportNo|consultationNo, emailSent }, message } (변경 X)

━━━ push 전 체크 (이것만 틀려도 머지 불가) ━━━
□ 브랜치명: feature/round1-siren-back (새로 생성했는가?)
□ 응답 최상위 키 변경 없음 (items 그대로)
□ export const config = { path } 신규 1개
□ requireAdmin 반환 auth.res 패턴
□ schema 변경 0건 (마이그 X)
□ npx tsc --noEmit 통과

━━━ 자율주행 정책 ━━━
push와 애매한 로직만 묻기. 나머지 자율 진행. memory feedback_subchat_autonomy 참조.

━━━ 진행률 보고 의무 ━━━
큰 체크박스 완료마다 "📊 진행률 X% (N/6 완료) — 다음: ..." 한 줄 보고.
```

### §6.2 A 트리거 (프론트 구현)

```
[영역: 프론트엔드(public/)]
[브랜치: feature/round1-siren-front — 새로 생성]

라운드 1 SIREN 4건 fix — 프론트 작업.
설계서: docs/milestones/2026-05-17-round1-siren.md §3 정독.

━━━ 작업 체크박스 ━━━
□ [#2-사용자] public/js/my-reports.js
   - adminComment → adminResponse, adminCommentAt → respondedAt 필드명 정정
   - STAGE_FLOW.incident에 'responded' 단계 추가
   - 응답 키: json.items 우선 (json.data?.rows fallback 뒤로)
   - <script src> 캐시버스터 ?v=N 갱신 (my-reports.html에서도 갱신)

□ [#2-어드민] public/js/admin-siren.js (3종 신고 상세 모달)
   - "답변 작성" 영역이 PATCH로 /api/admin/{incident|harassment|legal}-*-detail 호출
   - body: { id, adminResponse, sendEmail: true, sendNotify: true } (status 생략)
   - 백엔드가 자동 status='responded' 처리
   - 응답 후 목록 새로고침

□ [#4] public/js/admin-siren.js — 익명 배지 일관 표시
   - 신고 목록 보고자 셀: 실명 + isAnonymous true 시 "익명 원함" 배지 (노란색)
   - 상세 모달 헤더에도 동일 패턴

□ [#3-UI] 어드민 회원 상세 모달 (admin-members.html / admin-cms-members.js 또는 cms-tbfa-iframe 회원 상세 위치 파악 후 수정)
   - 자격 필드 옆 "직접 변경" 버튼
   - 강제 변경 모달: 새 자격 드롭다운(member/bereaved/teacher/lawyer/counselor) + 사유(5자+) 입력
   - 확정 시 POST /api/admin-eligibility-force-change
   - 캐시버스터 갱신

□ git push origin feature/round1-siren-front

━━━ mock 데이터 (B 머지 전 사용) ━━━
설계서 §5 참조. 핵심 키:
- user-my-reports: { ok, page, items: [{ id, reportNo, status, isAnonymous, adminResponse, respondedAt, ... }] }
- admin-eligibility-force-change: { ok, data: { memberId, beforeType, afterType }, message }
- admin-incident-reports 목록: rows에 memberName + isAnonymous

━━━ push 전 체크 ━━━
□ 브랜치명: feature/round1-siren-front (새로 생성했는가?)
□ mock 키명: adminResponse·respondedAt·isAnonymous — B 응답과 동일
□ <script> 캐시버스터 ?v=N 갱신 (수정한 JS 모든 참조 페이지)
□ <a href> SPA 외부 이동은 onclick 우회 (CLAUDE.md §6.6)

━━━ 자율주행 정책 ━━━
push와 애매한 로직만 묻기. 나머지 자율 진행.

━━━ 진행률 보고 의무 ━━━
큰 체크박스 완료마다 "📊 진행률 X% (N/4 완료) — 다음: ..." 한 줄 보고.
```

### §6.3 C 트리거 (라이브 검증)

```
[영역: 라이브 검증]
[브랜치: 작업 없음 — 검증만, fix 필요 시 fix/round1-siren-* 신규 생성]

라운드 1 SIREN 4건 fix — 라이브 검증.
설계서: docs/milestones/2026-05-17-round1-siren.md §4 정독.
선행 조건: B·A 머지 완료 + 메인 통보 후 진입.

━━━ 검증 체크박스 (Q1~Q12) ━━━
□ Q1 자동결제 회원 탈퇴 → billing_keys.is_active=false 자동
□ Q2 사건 신고 답변 등록 → status=responded 자동, 알림 1건
□ Q3 괴롭힘 신고 답변 등록 → status=responded 자동
□ Q4 법률 상담 답변 등록 → status=responded 자동
□ Q5 사용자 my-reports.html → 담당자 답변 영역 노출
□ Q6 사건 신고 타임라인 'responded' 단계 활성 표시
□ Q7 어드민 회원 강제 변경 사유 5자 검증 + 변경 성공
□ Q8 강제 변경 시 members.eligibility_type + 알림 + 감사 로그
□ Q9 변호사·심리상담사 강제 변경 시 type='volunteer'·subtype·secondary_verified 동기
□ Q10 익명 신고 어드민 화면 → 실명 + "익명 원함" 배지
□ Q11 일반 신고 → 배지 없음
□ Q12 회귀: 기존 admin-eligibility-review 정상 작동

━━━ 검증 절차 ━━━
- 라이브 URL: https://tbfa.co.kr
- DB 직접 조회: Neon SQL Editor (읽기 전용)
- 감사 로그·알림 1건 INSERT 확인
- BUG 발견 시 fix/round1-siren-{이슈} 브랜치 신규 생성 후 fix push
- 검증 보고서: docs/verify/2026-05-17-round1-siren.md

━━━ 자율주행 정책 ━━━
push와 애매한 로직만 묻기. fix 코드는 자율 진행.

━━━ 진행률 보고 의무 ━━━
"📊 진행률 X% (N/12 완료) — 다음: ..." 한 줄 보고.
```

---

## §7. 라운드 마감 체크리스트 (메인)

- [ ] B push 완료 + 응답 키 1:1 대조 (mock vs 실 응답)
- [ ] B 머지 → main
- [ ] A push 완료 + 캐시버스터 검증
- [ ] A 머지 → main
- [ ] C 검증 진입 + Q1~Q12 PASS
- [ ] BUG 발견 시 fix 머지
- [ ] 검증 보고서 archive (docs/verify-archive.md)
- [ ] PROJECT_STATE.md §2 갱신
- [ ] HANDOFF.md §4.1 라운드 1 ✅ 표시 + §4.2 라운드 2 다음 차례 명시
- [ ] 다음 라운드(워크스페이스 R2) 준비 안내
