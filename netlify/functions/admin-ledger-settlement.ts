/**
 * GET  /api/admin-ledger-settlement?year=2026[&live=1]   결산 현황, 서류 묶음, 점검표
 * POST /api/admin-ledger-settlement
 *   { action:'checklist', year, checklist }
 *   { action:'lock', year }                    확정: 연도 잠금 + 승인본 저장 (이사장)
 *   { action:'reopen', year, reason }          해제 (이사장, 사유 필수)
 *   { action:'audit', year, date, auditorName, opinion }
 *   { action:'board', year, date, note }
 *   { action:'assembly', year, date, note }
 *   { action:'submit', year, date, to, note }
 *
 * 순서: 작성 → 확정 → 감사 → 이사회 → 총회 → 제출 (정관 제33·34조).
 * 확정은 연도를 먼저 잠근 뒤 승인본을 만든다. 잠근 뒤에는 숫자가 바뀌지 않으므로
 * 승인본 저장이 실패해도 다시 만들 수 있다. 트랜잭션 안에서는 tx만 쓴다(연결 1개).
 */
import { jsonKST, yearKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerActor, ledgerErrorBody, recordHistory, ymd } from "../../lib/ledger-post";
import { buildPackage, MANUAL_CHECKS, settlementChecks, settlementOverview } from "../../lib/ledger-settlement";

export const config = { path: "/api/admin-ledger-settlement" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(jsonKST(body), { status, headers: JSON_HEADERS });
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const STEPS: Record<string, { from: string; to: string; label: string }> = {
  audit: { from: "locked", to: "audited", label: "감사" },
  board: { from: "audited", to: "board_approved", label: "이사회 의결" },
  assembly: { from: "board_approved", to: "assembly_approved", label: "총회 승인" },
  submit: { from: "assembly_approved", to: "submitted", label: "제출" },
};

async function ensureRow(tx: any, year: number) {
  await tx.execute(sql`INSERT INTO ledger_settlements (year) VALUES (${year}) ON CONFLICT (year) DO NOTHING`);
  return rowsOf(await tx.execute(sql`SELECT * FROM ledger_settlements WHERE year = ${year} FOR UPDATE`))[0];
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") {
    const url = new URL(req.url);
    const year = Number(url.searchParams.get("year")) || yearKST();
    try {
      const overview = await settlementOverview(year, { live: url.searchParams.get("live") === "1" });
      if (!overview) return json({ ok: false, error: `${year}년 회계연도가 없습니다` }, 404);
      const checks = await settlementChecks(year);
      return json({ ok: true, data: { ...overview, checks } });
    } catch (err: any) {
      return json({
        ok: false, error: "결산 현황 조회 실패", step: "select",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }, 500);
    }
  }
  if (req.method !== "POST") return json({ ok: false, error: "GET, POST만 허용" }, 405);

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body?.action ?? "");
  const year = Number(body?.year) || 0;
  if (!year) return json({ ok: false, error: "year 필수" }, 400);

  const role = String(auth.ctx.member.role ?? "");
  const actor = ledgerActor(auth);

  if (action === "checklist") {
    if (!(await canAccess(role, "finance_ledger_manage"))) {
      return json({ ok: false, error: "이 기능에 대한 접근 권한이 없습니다" }, 403);
    }
    const checklist: Record<string, boolean> = {};
    for (const m of MANUAL_CHECKS) checklist[m.key] = body?.checklist?.[m.key] === true;
    try {
      await db.transaction(async (tx) => {
        const row = await ensureRow(tx, year);
        if (row.status !== "draft") throw new LedgerError("확정된 결산은 점검표를 바꿀 수 없습니다.");
        await tx.execute(sql`
          UPDATE ledger_settlements SET checklist = ${JSON.stringify(checklist)}::jsonb, updated_at = NOW() WHERE year = ${year}`);
      });
      return json({ ok: true, data: { checklist } });
    } catch (err: any) {
      const { status, body: payload } = ledgerErrorBody("checklist", "점검표 저장 실패", err);
      return json(payload, status);
    }
  }

  if (role !== "super_admin") return json({ ok: false, error: "결산 확정과 승인 기록은 이사장만 할 수 있습니다" }, 403);

  try {
    if (action === "lock") {
      const checks = await settlementChecks(year);
      if (!checks) throw new LedgerError(`${year}년 회계연도가 없습니다`, 404);
      if (checks.blockers > 0) {
        const open = checks.items.filter((i) => i.state === "block");
        throw new LedgerError(`확정할 수 없습니다. 해결할 항목 ${open.length}개`, 422, open.map((i) => `${i.label}: ${i.detail}`));
      }
      await db.transaction(async (tx) => {
        const row = await ensureRow(tx, year);
        if (row.status !== "draft") throw new LedgerError("이미 확정된 결산입니다.");
        const fy = rowsOf(await tx.execute(sql`SELECT * FROM ledger_fiscal_years WHERE year = ${year} FOR UPDATE`))[0];
        if (!fy) throw new LedgerError(`${year}년 회계연도가 없습니다`, 404);
        if (!fy.closed_through || ymd(fy.closed_through) < ymd(fy.end_date)) throw new LedgerError("모든 달을 마감한 뒤 확정할 수 있습니다.");
        const open = Number(rowsOf(await tx.execute(sql`
          SELECT COUNT(*)::int AS n FROM vouchers
           WHERE is_template = FALSE AND status IN ('draft','submitted','rejected')
             AND voucher_date BETWEEN ${ymd(fy.start_date)} AND ${ymd(fy.end_date)}`))[0]?.n ?? 0);
        if (open) throw new LedgerError(`미결 전표 ${open}건이 있습니다.`);
        await tx.execute(sql`
          UPDATE ledger_fiscal_years SET status = 'closed', closed_by = ${actor.id}, closed_at = NOW(), updated_at = NOW() WHERE year = ${year}`);
        await tx.execute(sql`
          UPDATE ledger_settlements
             SET status = 'locked', locked_at = NOW(), locked_by = ${actor.id}, locked_by_name = ${actor.name}, updated_at = NOW()
           WHERE year = ${year}`);
        await recordHistory(tx, { entity: "settlement", entityId: year, action: "settlement_locked", actor, after: { status: "locked" } });
      });
      const pack = await buildPackage(year);
      await db.execute(sql`
        UPDATE ledger_settlements SET snapshot = ${JSON.stringify(pack)}::jsonb, updated_at = NOW() WHERE year = ${year}`);
      return json({ ok: true, data: { status: "locked" } });
    }

    if (action === "reopen") {
      const reason = String(body?.reason ?? "").trim().slice(0, 300);
      if (!reason) throw new LedgerError("해제 사유를 입력하세요", 400);
      await db.transaction(async (tx) => {
        const row = await ensureRow(tx, year);
        if (row.status === "draft") throw new LedgerError("확정되지 않은 결산입니다.");
        await tx.execute(sql`
          UPDATE ledger_fiscal_years SET status = 'open', closed_by = NULL, closed_at = NULL, updated_at = NOW() WHERE year = ${year}`);
        await tx.execute(sql`
          UPDATE ledger_settlements
             SET status = 'draft', snapshot = NULL, locked_at = NULL, locked_by = NULL, locked_by_name = NULL,
                 audited_on = NULL, auditor_name = NULL, audit_opinion = NULL,
                 board_on = NULL, board_note = NULL, assembly_on = NULL, assembly_note = NULL,
                 submitted_on = NULL, submitted_to = NULL, submitted_note = NULL, updated_at = NOW()
           WHERE year = ${year}`);
        await recordHistory(tx, {
          entity: "settlement", entityId: year, action: "settlement_reopened", actor, reason,
          before: {
            status: row.status, auditedOn: row.audited_on, boardOn: row.board_on,
            assemblyOn: row.assembly_on, submittedOn: row.submitted_on,
          },
          after: { status: "draft" },
        });
      });
      return json({ ok: true, data: { status: "draft" } });
    }

    const step = STEPS[action];
    if (!step) throw new LedgerError("알 수 없는 처리입니다", 400);
    if (!isDate(body?.date)) throw new LedgerError("날짜를 입력하세요", 400);
    const date = String(body.date);
    const note = String(body?.note ?? "").trim().slice(0, 1000) || null;
    await db.transaction(async (tx) => {
      const row = await ensureRow(tx, year);
      if (row.status !== step.from) throw new LedgerError(`${step.label} 기록은 앞 단계가 끝난 뒤에 할 수 있습니다.`);
      if (action === "audit") {
        const auditorName = String(body?.auditorName ?? "").trim().slice(0, 100);
        if (!auditorName) throw new LedgerError("감사 이름을 입력하세요", 400);
        await tx.execute(sql`
          UPDATE ledger_settlements
             SET status = 'audited', audited_on = ${date}, auditor_name = ${auditorName},
                 audit_opinion = ${String(body?.opinion ?? "").trim().slice(0, 2000) || null}, updated_at = NOW()
           WHERE year = ${year}`);
      } else if (action === "board") {
        await tx.execute(sql`
          UPDATE ledger_settlements SET status = 'board_approved', board_on = ${date}, board_note = ${note}, updated_at = NOW() WHERE year = ${year}`);
      } else if (action === "assembly") {
        await tx.execute(sql`
          UPDATE ledger_settlements SET status = 'assembly_approved', assembly_on = ${date}, assembly_note = ${note}, updated_at = NOW() WHERE year = ${year}`);
      } else {
        const to = String(body?.to ?? "").trim().slice(0, 120);
        if (!to) throw new LedgerError("제출처를 입력하세요", 400);
        await tx.execute(sql`
          UPDATE ledger_settlements
             SET status = 'submitted', submitted_on = ${date}, submitted_to = ${to}, submitted_note = ${note}, updated_at = NOW()
           WHERE year = ${year}`);
      }
      await recordHistory(tx, {
        entity: "settlement", entityId: year, action: `settlement_${action}`, actor,
        after: { status: step.to, date },
      });
    });
    return json({ ok: true, data: { status: step.to } });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("settlement", "결산 처리 실패", err);
    return json(payload, status);
  }
}
