# BUG-003 (High) — AI 도구 권한 시드 이름과 실제 도구 이름 불일치 → super_admin 우회

> **발견**: 2026-05-14, C 검증 라운드
> **심각도**: High (운영 권한 우회 — admin이 매출 승인 가능)
> **영향 범위**: AI 비서 경유 매출 승인·환불·수정·생성·목록·카테고리 조회 모두 권한 분기 미작동

---

## 1. 현상

`admin` 권한 사용자가 AI 비서에 "매출 1번 승인해줘" 입력 → `revenue_approve` 도구 호출 → **승인 실행 통과** (기대: 403 거절).

`other_revenues` 테이블의 status가 admin 권한으로 `approved`로 변경됨.

## 2. 원인

`lib/ai-agent-config.ts`의 권한 가드 (line 220-275):

```typescript
const map = new Map<string, ToolPermission>();
const r: any = await db.execute(sql`
  SELECT tool_name, enabled, required_role, ...
    FROM ai_tool_permissions
`);
...
const p = map.get(toolName);
if (!p) return { ok: true };               // ← 엔트리 없으면 통과 (open)
if (p.requiredRole && !isRoleAllowed(adminRole, p.requiredRole)) {
  return { ok: false, reason: "role_required", ... };
}
```

→ 권한 entry가 없으면 `requiredRole` 체크를 건너뛰고 통과.

### 시드된 도구명 (삭제된 `migrate-phase22a-revenue.ts` Step 4, git show 9604207 확인)

```sql
INSERT INTO ai_tool_permissions VALUES
  ('revenue_categories_list', ...NULL...),
  ('other_revenues_list',     ...NULL...),
  ('other_revenue_create',    ...NULL...),
  ('other_revenue_approve',   ...'super_admin'...),
  ('other_revenue_refund',    ...NULL...),
  ('pl_summary',              ...NULL...);
```

### 실제 도구 이름 (`lib/ai-agent-tools.ts` line 485-537 + executeTool case)

```
revenue_categories_list  ✓ 일치
revenue_create           ❌ 시드는 other_revenue_create
revenue_list             ❌ 시드는 other_revenues_list
revenue_update           ❌ 시드 자체 없음 (신설 도구)
revenue_approve          ❌ 시드는 other_revenue_approve (super_admin 표시도 여기에만)
revenue_refund           ❌ 시드는 other_revenue_refund
pl_summary               ✓ 일치
```

7개 중 5개 도구가 권한 entry 없음 → admin이 호출해도 분기 안 됨.

## 3. 검증

C는 라이브 호출 불가 (admin 세션 없음). 다음 근거로 정적 추론:

1. `git show 9604207 -- netlify/functions/migrate-phase22a-revenue.ts | grep INSERT` → `other_revenue_*` 이름 확인
2. `Grep "revenue_create|revenue_list|revenue_approve|revenue_refund" lib/ai-agent-tools.ts` → 5개 도구는 `revenue_*` (단수) 이름
3. `lib/ai-agent-config.ts` 가드 로직은 map miss 시 통과

→ Swain 라이브 검증으로 확정 권장:
   - 검증용 admin 계정으로 AI 비서에서 "매출 N번 승인해줘" 실행 → 거절 미발생 시 확정

## 4. 권한 시드 의도 (설계서 §10.1) vs 실제 코드 권한

| 도구명 (설계서) | 설계서 권한 | 시드 권한 | 실제 도구명 | 실제 분기 |
|---|---|---|---|---|
| `revenue_categories_list` | admin | NULL | 동일 | 정상 |
| `other_revenues_list` | admin | NULL | `revenue_list` | 시드 없음 → 분기 없음(admin OK이므로 무해) |
| `other_revenue_create` | admin | NULL | `revenue_create` | 동일 |
| `other_revenue_approve` | **super_admin** | **super_admin** | `revenue_approve` | **시드 없음 → admin 통과** ❌ |
| `other_revenue_refund` | admin | NULL | `revenue_refund` | 시드 없음. 단 API 자체는 super_admin 요구(BUG-006 별건) |
| (신설) `revenue_update` | admin (등록자/super) | **없음** | `revenue_update` | 시드 없음 → admin 누구나 통과 |
| `pl_summary` | admin | NULL | 동일 | 정상 |

## 5. 제안 fix

### Option A — 시드 데이터 정정 (권장)

신규 1회용 마이그 `migrate-phase22a-ai-perms-rename.ts`:

```sql
-- 1) 기존 잘못된 이름 삭제
DELETE FROM ai_tool_permissions WHERE tool_name IN (
  'other_revenues_list','other_revenue_create','other_revenue_approve','other_revenue_refund'
);

-- 2) 정확한 도구명으로 재시드 7건
INSERT INTO ai_tool_permissions (tool_name, enabled, required_role, description, is_mutation, category) VALUES
  ('revenue_categories_list', true, NULL,          '매출 카테고리 목록',     false, 'finance'),
  ('revenue_list',            true, NULL,          '후원 외 매출 목록',      false, 'finance'),
  ('revenue_create',          true, NULL,          '후원 외 매출 작성',      true,  'finance'),
  ('revenue_update',          true, NULL,          '매출 수정 (draft)',      true,  'finance'),
  ('revenue_approve',         true, 'super_admin', '매출 승인/반려',         true,  'finance'),
  ('revenue_refund',          true, 'super_admin', '매출 환불 등록',         true,  'finance'),
  ('pl_summary',              true, NULL,          '통합 손익계산서',        false, 'finance')
ON CONFLICT (tool_name) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  required_role = EXCLUDED.required_role,
  description = EXCLUDED.description,
  is_mutation = EXCLUDED.is_mutation,
  category = EXCLUDED.category;
```

`revenue_refund`는 BUG-006 결정에 따라 admin 또는 super_admin. 본 시드는 API의 현재 분기(super_admin)에 맞춰 안전한 super_admin로 일단 시드.

### Option B — 도구 이름을 시드에 맞춰 변경

`revenue_*` → `other_revenue_*` 7개 case·핸들러 이름 일괄 변경. 단 설계서 매핑·시스템 프롬프트 §136-141도 동시 갱신. 변경 폭이 큼.

## 6. 회귀 영향

fix 후 admin이 AI 비서로 매출 승인 시도 → "super_admin 권한 필요" 거절 정상 동작. revenue_update 도구도 등록자/super 분기 필요 시 핸들러 자체 권한 코드 추가 검토.
