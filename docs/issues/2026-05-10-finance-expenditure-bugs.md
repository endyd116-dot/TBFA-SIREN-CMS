# BUG-6·BUG-7: 지출 목록 마비 + 승인/반려 상태 전이 검증 무력화

| 항목 | 내용 |
|---|---|
| 발견 | 2026-05-10 (C 채팅 verify/live-comprehensive — Q13 라이브 검증) |
| 상태 | ✅ 해결 (이번 세션) |

---

## BUG-6 🔴 Critical: 지출 목록 조회 시 존재하지 않는 `admins` 테이블 참조

### 현상
어드민 → 재정 관리 → 예산·지출 메뉴 진입 시 지출 목록이 한 건도 표시되지 않음. API 직접 호출하면 500 에러:

```
{"ok":false,"error":"지출 목록 조회 실패","step":"query",
 "detail":"relation \"admins\" does not exist"}
```

→ Phase 6 지출 워크플로우(등록·승인·반려·집행 추적) 자체가 화면에서 사용 불가.

### 원인
`admin-finance-expenditure-list.ts:39-40`이 존재하지 않는 `admins` 테이블을 JOIN. 본 프로젝트의 어드민은 `members` 테이블에 `type='admin'`으로 저장됨 (`admin-login.ts:47-51` 참조). schema.ts에 `admins` 테이블 정의 없음 — 코드 작성 시 가정 오류.

### 수정
```diff
- LEFT JOIN admins creator ON creator.id = e.created_by
- LEFT JOIN admins approver ON approver.id = e.approved_by
+ LEFT JOIN members creator ON creator.id = e.created_by
+ LEFT JOIN members approver ON approver.id = e.approved_by
```

`expenditures.created_by`/`approved_by` 컬럼은 BUG-5 fix 이후 `members.id`(어드민 uid) 값을 저장하므로 members 테이블로 JOIN하면 created_by_name·approved_by_name 정상 표시.

### 라이브 검증 결과
fix 후 expenditure-list 호출 → 200 ok, items 표시 정상. created_by_name·approved_by_name 모두 "총괄 관리자"로 채워짐 — BUG-5 fix(uid 정정)도 라이브에서 동시 검증 통과.

---

## BUG-7 🟠 High: 이미 승인/반려된 지출에 재처리 호출 시 거짓 성공 응답

### 현상
지출 #1을 한 번 승인한 뒤 다시 승인 호출:
```
PATCH /api/admin-finance-expenditure-approve  body: {"id":1,"action":"approve"}
→ {"ok":true,"message":"승인 완료"}
```
실제 DB에서는 변화 없음(이미 approved 상태). 어드민에게는 "성공"이라고 거짓 피드백 → 감사 로그(`audit_logs` 추후 연동 시)에도 가짜 성공 기록 남길 수 있음.

반려된 행에 승인을 시도해도 동일하게 거짓 ok 응답.

### 원인
`admin-finance-expenditure-approve.ts:35`에서:
```sql
UPDATE expenditures SET ... WHERE id = ${id} AND status = 'draft'
```
WHERE 절이 status='draft'만 매칭하므로 영향받은 행 수는 0. 그러나 `db.execute(sql\`...\`)`이 0행 UPDATE를 에러로 처리하지 않고, 기존 코드는 행 수 검증 없이 무조건 `ok:true`를 반환했음.

### 수정
`RETURNING id`로 영향 행 수를 확인 → 0이면 409 응답.

```diff
-     await db.execute(sql`
+     const result: any = await db.execute(sql`
        UPDATE expenditures
        SET status = ${newStatus},
            approved_by = ${auth.ctx.admin.uid},
            approved_at = NOW(),
            note = COALESCE(${note || null}, note)
        WHERE id = ${id} AND status = 'draft'
+       RETURNING id
      `);
+     const updatedRows = result?.rows ?? result;
+     if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
+       return new Response(
+         JSON.stringify({ ok: false, error: "대기 상태가 아니거나 존재하지 않는 지출입니다" }),
+         { status: 409, headers: { "Content-Type": "application/json" } }
+       );
+     }
```

### 라이브 검증 결과
fix 후 새 지출 #3 1차 승인 → ok:true / 2차 승인 → 409 + "대기 상태가 아니거나 존재하지 않는 지출입니다" ✅.
반려·승인 모두 동일 가드. status 전이 무결성 회복.

---

## 재발 방지

두 버그 모두 **정적 검증으로 잡기 어려웠음** — schema.ts에 admins 테이블이 없는 사실을 정적 분석에서 캐치하려면 SQL 문자열 안의 테이블명을 schema와 교차 검증하는 별도 스텝 필요. 또한 BUG-7은 의미상 무결성 검증이라 라이브 호출 + 시퀀스 검증으로만 발견 가능. → C 채팅의 "사용자 검증 대행" 정책(라이브 시퀀스 검증)이 정적만으로는 잡히지 않는 클래스의 버그를 발견한 첫 사례.

장기 권고:
- 모든 raw SQL 함수에 대해 schema.ts 기준 테이블명 grep 검증 스크립트 도입 검토
- UPDATE/DELETE는 RETURNING + 행 수 검증 패턴 표준화 (CLAUDE.md §6.2 추가 검토)
