import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-budget-accounts" };

/* =========================================================
   관-항-목(款-項-目) 3계층 예산 계정 트리 관리·조회 API
   - GET  : 중첩 트리 반환 (fiscalYear 주어지면 편성/집행 롤업)
   - POST : action 분기 (create·update·delete·mapCode·unmapCode)
   ========================================================= */

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "예산 계정 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

function jsonBad(step: string, message: string, extra?: any) {
  return new Response(JSON.stringify({
    ok: false, error: message, step, ...(extra || {}),
  }), { status: 400, headers: { "Content-Type": "application/json" } });
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

type AccountNode = {
  id: number;
  level: string;
  code: string;
  name: string;
  parentId: number | null;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  mappedCodes?: string[];
  planned?: number;
  executed?: number;
  rate?: number | null;
  children: AccountNode[];
};

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") return handleGet(req);
  if (req.method === "POST") return handlePost(req);

  return new Response(JSON.stringify({ ok: false, error: "허용되지 않은 메서드입니다" }),
    { status: 405, headers: { "Content-Type": "application/json" } });
}

/* =========================================================
   GET — 중첩 트리 (+ fiscalYear 롤업)
   ========================================================= */
async function handleGet(req: Request) {
  let fiscalYear: number | null = null;
  try {
    const url = new URL(req.url);
    const fy = url.searchParams.get("fiscalYear");
    if (fy != null && fy !== "") {
      const n = Number(fy);
      if (Number.isFinite(n)) fiscalYear = n;
    }
  } catch { /* URL 파싱 실패 시 fiscalYear 없이 진행 */ }

  // 1) 전체 계정 조회
  let accountRows: any[];
  try {
    const res: any = await db.execute(sql`
      SELECT id, level, parent_id, code, name, sort_order, is_active, is_system
      FROM budget_accounts
      ORDER BY sort_order ASC, id ASC
    `);
    accountRows = rowsOf(res);
  } catch (err: any) { return jsonError("select_accounts", err); }

  // 2) 코드 매핑 (목별) — 실패해도 빈 매핑으로 진행
  const codeMapByAccount = new Map<number, string[]>();
  try {
    const res: any = await db.execute(sql`
      SELECT budget_account_id, account_code
      FROM budget_account_code_map
      ORDER BY account_code ASC
    `);
    for (const r of rowsOf(res)) {
      const baId = Number(r.budget_account_id);
      const arr = codeMapByAccount.get(baId) || [];
      arr.push(String(r.account_code));
      codeMapByAccount.set(baId, arr);
    }
  } catch (err: any) { console.warn("[admin-budget-accounts] code map skip:", err?.message); }

  // 3) fiscalYear 있으면 편성/집행 목별 집계
  const plannedByAccount = new Map<number, number>();
  const executedByAccount = new Map<number, number>();
  if (fiscalYear != null) {
    // 편성: budget_lines.planned_amount, 해당 연도 budget_plans에 속한 라인만
    try {
      const res: any = await db.execute(sql`
        SELECT bl.budget_account_id AS ba_id, SUM(bl.planned_amount)::bigint AS planned
        FROM budget_lines bl
        JOIN budget_plans bp ON bp.id = bl.plan_id
        WHERE bl.budget_account_id IS NOT NULL
          AND bp.fiscal_year = ${fiscalYear}
        GROUP BY bl.budget_account_id
      `);
      for (const r of rowsOf(res)) {
        plannedByAccount.set(Number(r.ba_id), Number(r.planned) || 0);
      }
    } catch (err: any) { return jsonError("select_planned", err); }

    // 집행: expenses.amount - refund_amount, approved 상태 + 해당 연도
    try {
      const res: any = await db.execute(sql`
        SELECT budget_account_id AS ba_id,
               SUM(amount - refund_amount)::bigint AS executed
        FROM expenses
        WHERE budget_account_id IS NOT NULL
          AND fiscal_year = ${fiscalYear}
          AND status = 'approved'
        GROUP BY budget_account_id
      `);
      for (const r of rowsOf(res)) {
        executedByAccount.set(Number(r.ba_id), Number(r.executed) || 0);
      }
    } catch (err: any) { return jsonError("select_executed", err); }
  }

  // 4) 노드 조립
  try {
    const nodeById = new Map<number, AccountNode>();
    for (const r of accountRows) {
      const id = Number(r.id);
      const node: AccountNode = {
        id,
        level: String(r.level),
        code: String(r.code),
        name: String(r.name),
        parentId: r.parent_id == null ? null : Number(r.parent_id),
        sortOrder: Number(r.sort_order) || 0,
        isActive: r.is_active === true || r.is_active === "t" || r.is_active === 1,
        isSystem: r.is_system === true || r.is_system === "t" || r.is_system === 1,
        children: [],
      };
      if (node.level === "목") {
        node.mappedCodes = codeMapByAccount.get(id) || [];
      }
      nodeById.set(id, node);
    }

    // 트리 링크
    const roots: AccountNode[] = [];
    for (const node of nodeById.values()) {
      if (node.parentId != null && nodeById.has(node.parentId)) {
        nodeById.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // 정렬 (sortOrder → id)
    const sortNodes = (arr: AccountNode[]) => {
      arr.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
      for (const n of arr) sortNodes(n.children);
    };
    sortNodes(roots);

    // 롤업: 목의 planned/executed를 세팅하고 상향 합산 (post-order)
    if (fiscalYear != null) {
      const rollup = (node: AccountNode): { planned: number; executed: number } => {
        if (node.level === "목") {
          const planned = plannedByAccount.get(node.id) || 0;
          const executed = executedByAccount.get(node.id) || 0;
          node.planned = planned;
          node.executed = executed;
          node.rate = planned > 0 ? executed / planned : null;
          return { planned, executed };
        }
        let planned = 0, executed = 0;
        for (const c of node.children) {
          const sub = rollup(c);
          planned += sub.planned;
          executed += sub.executed;
        }
        node.planned = planned;
        node.executed = executed;
        node.rate = planned > 0 ? executed / planned : null;
        return { planned, executed };
      };
      for (const r of roots) rollup(r);
    }

    return new Response(
      JSON.stringify({ ok: true, data: { tree: roots, fiscalYear } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) { return jsonError("build_tree", err); }
}

/* =========================================================
   POST — action 분기
   ========================================================= */
async function handlePost(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch (err: any) { return jsonBad("parse_body", "요청 본문(JSON) 파싱 실패"); }

  const action = String(body?.action || "");
  switch (action) {
    case "create":    return actionCreate(body);
    case "update":    return actionUpdate(body);
    case "delete":    return actionDelete(body);
    case "mapCode":   return actionMapCode(body);
    case "unmapCode": return actionUnmapCode(body);
    default:          return jsonBad("action", `알 수 없는 action: ${action || "(없음)"}`);
  }
}

/* 부모 레벨 → 자식 레벨 규칙 */
const LEVEL_PARENT: Record<string, string | null> = { "관": null, "항": "관", "목": "항" };

async function actionCreate(body: any) {
  const level = String(body?.level || "");
  const name = String(body?.name || "").trim();
  const parentIdRaw = body?.parentId;

  if (!["관", "항", "목"].includes(level)) return jsonBad("validate", "level은 관/항/목 중 하나여야 합니다");
  if (!name) return jsonBad("validate", "name은 필수입니다");

  const needParent = LEVEL_PARENT[level] !== null;
  let parentId: number | null = null;
  let parentCode: string | null = null;

  try {
    if (needParent) {
      if (parentIdRaw == null) return jsonBad("validate", `${level}은(는) parentId가 필수입니다`);
      parentId = Number(parentIdRaw);
      const res: any = await db.execute(sql`
        SELECT id, level, code FROM budget_accounts WHERE id = ${parentId} LIMIT 1
      `);
      const prow = rowsOf(res)[0];
      if (!prow) return jsonBad("validate", "부모 계정을 찾을 수 없습니다");
      if (String(prow.level) !== LEVEL_PARENT[level]) {
        return jsonBad("validate", `${level}의 부모는 ${LEVEL_PARENT[level]} 레벨이어야 합니다 (부모 level=${prow.level})`);
      }
      parentCode = String(prow.code);
    } else {
      // 관: parentId 무시
      if (parentIdRaw != null) return jsonBad("validate", "관은 parentId가 없어야 합니다");
    }
  } catch (err: any) { return jsonError("select_parent", err); }

  // code 자동 생성 + sortOrder 계산
  let code: string;
  let sortOrder: number;
  try {
    if (level === "관") {
      // 기존 관 code(정수) max + 1
      const res: any = await db.execute(sql`
        SELECT code FROM budget_accounts WHERE level = '관'
      `);
      let maxInt = 0;
      for (const r of rowsOf(res)) {
        const n = parseInt(String(r.code), 10);
        if (Number.isFinite(n) && n > maxInt) maxInt = n;
      }
      code = String(maxInt + 1);
      sortOrder = await nextSortOrder(null);
    } else if (level === "항") {
      // `${부모관code}-${순번}`
      const res: any = await db.execute(sql`
        SELECT code FROM budget_accounts WHERE level = '항' AND parent_id = ${parentId}
      `);
      let maxSeq = 0;
      for (const r of rowsOf(res)) {
        const parts = String(r.code).split("-");
        const seq = parseInt(parts[parts.length - 1], 10);
        if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
      }
      code = `${parentCode}-${maxSeq + 1}`;
      code = await ensureUniqueCode(code, () => {
        maxSeq += 1;
        return `${parentCode}-${maxSeq + 1}`;
      });
      sortOrder = await nextSortOrder(parentId);
    } else {
      // 목: `${부모항code}-${순번 2자리}`
      const res: any = await db.execute(sql`
        SELECT code FROM budget_accounts WHERE level = '목' AND parent_id = ${parentId}
      `);
      let maxSeq = 0;
      for (const r of rowsOf(res)) {
        const parts = String(r.code).split("-");
        const seq = parseInt(parts[parts.length - 1], 10);
        if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
      }
      const pad = (n: number) => String(n).padStart(2, "0");
      code = `${parentCode}-${pad(maxSeq + 1)}`;
      code = await ensureUniqueCode(code, () => {
        maxSeq += 1;
        return `${parentCode}-${pad(maxSeq + 1)}`;
      });
      sortOrder = await nextSortOrder(parentId);
    }
  } catch (err: any) { return jsonError("gen_code", err); }

  // 삽입
  try {
    const res: any = await db.execute(sql`
      INSERT INTO budget_accounts (level, parent_id, code, name, sort_order, is_active, is_system)
      VALUES (${level}, ${parentId}, ${code}, ${name}, ${sortOrder}, true, false)
      RETURNING id, level, parent_id, code, name, sort_order, is_active, is_system
    `);
    const r = rowsOf(res)[0];
    return new Response(JSON.stringify({
      ok: true,
      data: {
        node: {
          id: Number(r.id),
          level: String(r.level),
          parentId: r.parent_id == null ? null : Number(r.parent_id),
          code: String(r.code),
          name: String(r.name),
          sortOrder: Number(r.sort_order) || 0,
          isActive: r.is_active === true || r.is_active === "t",
          isSystem: r.is_system === true || r.is_system === "t",
          mappedCodes: level === "목" ? [] : undefined,
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("insert", err); }
}

/* 형제 max(sort_order) + 1 */
async function nextSortOrder(parentId: number | null): Promise<number> {
  const res: any = parentId == null
    ? await db.execute(sql`SELECT COALESCE(MAX(sort_order), 0) AS m FROM budget_accounts WHERE parent_id IS NULL`)
    : await db.execute(sql`SELECT COALESCE(MAX(sort_order), 0) AS m FROM budget_accounts WHERE parent_id = ${parentId}`);
  const r = rowsOf(res)[0];
  return (Number(r?.m) || 0) + 1;
}

/* code 충돌 시 next()로 순번 증가하며 빈 code 확보 (최대 200회) */
async function ensureUniqueCode(candidate: string, next: () => string): Promise<string> {
  let code = candidate;
  for (let i = 0; i < 200; i++) {
    const res: any = await db.execute(sql`SELECT 1 FROM budget_accounts WHERE code = ${code} LIMIT 1`);
    if (rowsOf(res).length === 0) return code;
    code = next();
  }
  throw new Error("code 자동 생성 충돌 상한 초과");
}

async function actionUpdate(body: any) {
  const id = Number(body?.id);
  if (!Number.isFinite(id)) return jsonBad("validate", "id는 필수입니다");

  // 대상 존재 확인
  let target: any;
  try {
    const res: any = await db.execute(sql`
      SELECT id, level, is_system FROM budget_accounts WHERE id = ${id} LIMIT 1
    `);
    target = rowsOf(res)[0];
    if (!target) return jsonBad("validate", "대상 계정을 찾을 수 없습니다");
  } catch (err: any) { return jsonError("select_target", err); }

  const sets: any[] = [];
  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonBad("validate", "name은 빈 값일 수 없습니다");
    sets.push(sql`name = ${name}`);   // isSystem이어도 name 변경 허용, code는 불변
  }
  if (body?.sortOrder !== undefined) {
    const so = Number(body.sortOrder);
    if (!Number.isFinite(so)) return jsonBad("validate", "sortOrder는 숫자여야 합니다");
    sets.push(sql`sort_order = ${so}`);
  }
  if (body?.isActive !== undefined) {
    sets.push(sql`is_active = ${!!body.isActive}`);
  }

  if (sets.length === 0) return jsonBad("validate", "변경할 필드가 없습니다");
  sets.push(sql`updated_at = now()`);

  try {
    const res: any = await db.execute(sql`
      UPDATE budget_accounts
      SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id}
      RETURNING id, level, parent_id, code, name, sort_order, is_active, is_system
    `);
    const r = rowsOf(res)[0];
    return new Response(JSON.stringify({
      ok: true,
      data: {
        node: {
          id: Number(r.id),
          level: String(r.level),
          parentId: r.parent_id == null ? null : Number(r.parent_id),
          code: String(r.code),
          name: String(r.name),
          sortOrder: Number(r.sort_order) || 0,
          isActive: r.is_active === true || r.is_active === "t",
          isSystem: r.is_system === true || r.is_system === "t",
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("update", err); }
}

async function actionDelete(body: any) {
  const id = Number(body?.id);
  if (!Number.isFinite(id)) return jsonBad("validate", "id는 필수입니다");

  // 존재 확인
  try {
    const res: any = await db.execute(sql`SELECT id FROM budget_accounts WHERE id = ${id} LIMIT 1`);
    if (rowsOf(res).length === 0) return jsonBad("validate", "대상 계정을 찾을 수 없습니다");
  } catch (err: any) { return jsonError("select_target", err); }

  // 자식 존재 → 거부
  try {
    const res: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM budget_accounts WHERE parent_id = ${id}`);
    const childCount = Number(rowsOf(res)[0]?.c) || 0;
    if (childCount > 0) {
      return jsonBad("has_children", `하위 계정이 ${childCount}개 있어 삭제할 수 없습니다. 하위 계정을 먼저 삭제하세요.`);
    }
  } catch (err: any) { return jsonError("check_children", err); }

  // 참조 존재 여부 (budget_lines / expenses)
  let referenced = false;
  try {
    const blRes: any = await db.execute(sql`SELECT 1 FROM budget_lines WHERE budget_account_id = ${id} LIMIT 1`);
    const exRes: any = await db.execute(sql`SELECT 1 FROM expenses WHERE budget_account_id = ${id} LIMIT 1`);
    referenced = rowsOf(blRes).length > 0 || rowsOf(exRes).length > 0;
  } catch (err: any) { return jsonError("check_refs", err); }

  if (referenced) {
    // 소프트 삭제 (isActive=false)
    try {
      await db.execute(sql`
        UPDATE budget_accounts SET is_active = false, updated_at = now() WHERE id = ${id}
      `);
      return new Response(JSON.stringify({
        ok: true,
        data: { id, deleted: false, softDeleted: true },
        message: "편성·집행 데이터가 참조 중이어서 하드삭제 대신 비활성(소프트삭제) 처리했습니다.",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) { return jsonError("soft_delete", err); }
  }

  // 하드 삭제 (코드 매핑도 함께 정리)
  try {
    await db.execute(sql`DELETE FROM budget_account_code_map WHERE budget_account_id = ${id}`);
    await db.execute(sql`DELETE FROM budget_accounts WHERE id = ${id}`);
    return new Response(JSON.stringify({
      ok: true,
      data: { id, deleted: true, softDeleted: false },
      message: "삭제되었습니다.",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("hard_delete", err); }
}

async function actionMapCode(body: any) {
  const budgetAccountId = Number(body?.budgetAccountId);
  const accountCode = String(body?.accountCode || "").trim();
  if (!Number.isFinite(budgetAccountId)) return jsonBad("validate", "budgetAccountId는 필수입니다");
  if (!accountCode) return jsonBad("validate", "accountCode는 필수입니다");

  // 목 레벨만 허용
  try {
    const res: any = await db.execute(sql`SELECT level FROM budget_accounts WHERE id = ${budgetAccountId} LIMIT 1`);
    const row = rowsOf(res)[0];
    if (!row) return jsonBad("validate", "대상 계정을 찾을 수 없습니다");
    if (String(row.level) !== "목") return jsonBad("validate", "코드 매핑은 목(leaf) 레벨에만 허용됩니다");
  } catch (err: any) { return jsonError("select_target", err); }

  try {
    await db.execute(sql`
      INSERT INTO budget_account_code_map (budget_account_id, account_code)
      VALUES (${budgetAccountId}, ${accountCode})
      ON CONFLICT (budget_account_id, account_code) DO NOTHING
    `);
    return new Response(JSON.stringify({
      ok: true, data: { budgetAccountId, accountCode },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("insert_map", err); }
}

async function actionUnmapCode(body: any) {
  const budgetAccountId = Number(body?.budgetAccountId);
  const accountCode = String(body?.accountCode || "").trim();
  if (!Number.isFinite(budgetAccountId)) return jsonBad("validate", "budgetAccountId는 필수입니다");
  if (!accountCode) return jsonBad("validate", "accountCode는 필수입니다");

  try {
    await db.execute(sql`
      DELETE FROM budget_account_code_map
      WHERE budget_account_id = ${budgetAccountId} AND account_code = ${accountCode}
    `);
    return new Response(JSON.stringify({
      ok: true, data: { budgetAccountId, accountCode },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("delete_map", err); }
}
