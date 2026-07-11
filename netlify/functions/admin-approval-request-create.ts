import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { notifyMany } from "../../lib/notify";

export const config = { path: "/api/admin-approval-request-create" };

/* =========================================================
   지출 결재 기안(요청) 생성 API — POST
   - 금액→결재라인 자동 매칭 → steps 스냅샷 → 요청/단계 생성
   - 첫 단계 결재 대상에게 인앱 알림(배치1 AI 말풍선 픽업)
   ========================================================= */

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "지출 결재 기안 생성 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

function jsonBad(step: string, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message, step }),
    { status: 400, headers: { "Content-Type": "application/json" } });
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const drafterId = auth.ctx.admin.uid;
  const drafterName = auth.ctx.member.name || "";

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  /* ===== 1) 검증 ===== */
  const title = String(body?.title || "").trim();
  const amount = Number(body?.amount);
  const budgetAccountId = Number(body?.budgetAccountId);
  const description = body?.description != null ? String(body.description) : null;
  const occurredAt = body?.occurredAt ? String(body.occurredAt) : null;
  const payeeName = body?.payeeName != null ? String(body.payeeName).slice(0, 200) : null;
  const evidenceUrl = body?.evidenceUrl != null ? String(body.evidenceUrl).slice(0, 500) : null;

  if (!title) return jsonBad("validate", "title(제목)은 필수입니다");
  if (!Number.isFinite(amount) || amount <= 0) return jsonBad("validate", "amount(금액)는 0보다 큰 숫자여야 합니다");
  if (!Number.isFinite(budgetAccountId)) return jsonBad("validate", "budgetAccountId(예산 목)는 필수입니다");

  let fiscalYear = Number(body?.fiscalYear);
  if (!Number.isFinite(fiscalYear) || fiscalYear <= 0) {
    if (occurredAt && /^\d{4}/.test(occurredAt)) fiscalYear = Number(occurredAt.slice(0, 4));
    else fiscalYear = new Date().getFullYear();
  }

  /* ===== 2) budgetAccountId가 목(目) 레벨인지 확인 ===== */
  try {
    const res: any = await db.execute(sql`
      SELECT level FROM budget_accounts WHERE id = ${budgetAccountId} LIMIT 1
    `);
    const row = rowsOf(res)[0];
    if (!row) return jsonBad("validate", "예산 과목(목)을 찾을 수 없습니다");
    if (String(row.level) !== "목") return jsonBad("validate", "지출 결재는 예산 과목의 목(目) 단위에서만 올릴 수 있습니다");
  } catch (err: any) { return jsonError("select_account", err); }

  /* ===== 3) 금액 → 결재라인 매칭 ===== */
  let line: any;
  try {
    const res: any = await db.execute(sql`
      SELECT id, name, steps, board_required
      FROM approval_lines
      WHERE is_active = TRUE
        AND min_amount <= ${amount}
        AND (max_amount IS NULL OR ${amount} <= max_amount)
      ORDER BY sort_order ASC, min_amount ASC
      LIMIT 1
    `);
    line = rowsOf(res)[0];
    if (!line) return jsonBad("no_line", "이 금액에 적용할 결재라인이 없습니다. 결재라인 설정을 확인하세요.");
  } catch (err: any) { return jsonError("match_line", err); }

  /* ===== 4) steps 스냅샷 + board_required ===== */
  const steps: string[] = Array.isArray(line.steps) ? line.steps.map((s: any) => String(s)) : [];
  if (steps.length === 0) return jsonBad("no_steps", "매칭된 결재라인에 결재 단계(steps)가 없습니다.");
  const boardRequired = line.board_required === true || line.board_required === "t";
  const approvalLineId = Number(line.id);

  /* ===== 5) request_no 생성 + 6) 요청 INSERT (UNIQUE 충돌 시 1회 재시도) ===== */
  const pad4 = (n: number) => String(n).padStart(4, "0");
  const stepsJson = JSON.stringify(steps);

  const insertRequest = async (requestNo: string): Promise<number> => {
    const res: any = await db.execute(sql`
      INSERT INTO approval_requests
        (request_no, title, amount, description, budget_account_id, fiscal_year,
         occurred_at, payee_name, evidence_url, drafter_id, drafter_name,
         approval_line_id, board_required, steps, current_step, status, created_at, updated_at)
      VALUES
        (${requestNo}, ${title}, ${amount}, ${description}, ${budgetAccountId}, ${fiscalYear},
         ${occurredAt}, ${payeeName}, ${evidenceUrl}, ${drafterId}, ${drafterName},
         ${approvalLineId}, ${boardRequired}, ${stepsJson}::jsonb, 0, 'pending', NOW(), NOW())
      RETURNING id
    `);
    return Number(rowsOf(res)[0].id);
  };

  const genRequestNo = async (): Promise<string> => {
    const cntRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM approval_requests WHERE fiscal_year = ${fiscalYear}
    `);
    const seq = (Number(rowsOf(cntRes)[0]?.c) || 0) + 1;
    return `REQ-${fiscalYear}-${pad4(seq)}`;
  };

  let newId: number;
  let requestNo: string;
  try {
    requestNo = await genRequestNo();
    try {
      newId = await insertRequest(requestNo);
    } catch (dupErr: any) {
      // UNIQUE 충돌 추정 → 개수 재조회 후 1회 재시도
      requestNo = await genRequestNo();
      newId = await insertRequest(requestNo);
    }
  } catch (err: any) { return jsonError("insert_request", err); }

  /* ===== 7) 단계별 approval_request_steps INSERT ===== */
  try {
    for (let i = 0; i < steps.length; i++) {
      await db.execute(sql`
        INSERT INTO approval_request_steps (request_id, step_index, role, decision)
        VALUES (${newId}, ${i}, ${steps[i]}, 'pending')
        ON CONFLICT (request_id, step_index) DO NOTHING
      `);
    }
  } catch (err: any) { return jsonError("insert_steps", err); }

  /* ===== 8) 첫 단계 결재 대상 인앱 알림 (격리) ===== */
  try {
    const firstRole = steps[0];
    const targetRes: any = await db.execute(sql`
      SELECT id FROM members
      WHERE type = 'admin'
        AND operator_active = TRUE
        AND role IN (${firstRole}, 'super_admin')
    `);
    const recipientIds = rowsOf(targetRes).map((r: any) => Number(r.id)).filter((n) => Number.isFinite(n));
    if (recipientIds.length > 0) {
      await notifyMany(recipientIds, {
        recipientType: "operator",
        category: "system",
        severity: "warning",
        title: "새 지출 결재 요청",
        message: `${drafterName}님이 ${amount.toLocaleString()}원 지출 결재를 올렸어요. "${title}" — 결재가 필요해요.`,
        link: "/cms-tbfa.html#approval-inbox",
        refTable: "approval_requests",
        refId: newId,
      });
    }
  } catch (notifyErr: any) {
    console.warn("[admin-approval-request-create] 알림 발송 실패(무시):", notifyErr?.message);
  }

  /* ===== 9) 응답 ===== */
  return new Response(JSON.stringify({
    ok: true,
    data: {
      id: newId,
      requestNo,
      matchedLine: { id: approvalLineId, name: String(line.name || "") },
      boardRequired,
      steps,
    },
  }), { status: 201, headers: { "Content-Type": "application/json" } });
}
