/**
 * lib/martyrdom-notify.ts — 순직 지원 운영자 알림 (notifications 재사용·신규 테이블 0)
 *
 * 담당 운영자 + super_admin(operator_active)에게 알림 INSERT.
 * 알림 실패는 메인 흐름에 영향 없도록 조용히 넘김(background fail-safe).
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function notifyMartyrdomAdmins(opts: {
  caseId?: number | null;
  assignedAdminId?: number | null;
  title: string;
  message: string;
  severity?: string;   // info | warning | critical
  link?: string;
}): Promise<void> {
  try {
    const targets: number[] = [];
    if (opts.assignedAdminId) targets.push(Number(opts.assignedAdminId));

    const saRes: any = await db.execute(sql.raw(`
      SELECT id FROM members WHERE role = 'super_admin' AND operator_active = true LIMIT 10
    `));
    for (const r of (saRes?.rows ?? saRes ?? [])) {
      const uid = Number(r.id);
      if (uid && !targets.includes(uid)) targets.push(uid);
    }
    if (targets.length === 0) return;

    const safeTitle = String(opts.title || "순직 지원").replace(/'/g, "''").slice(0, 200);
    const safeMsg = String(opts.message || "").replace(/'/g, "''").slice(0, 500);
    const sev = ["info", "warning", "critical"].includes(String(opts.severity)) ? String(opts.severity) : "info";
    const link = opts.link ? `'${String(opts.link).replace(/'/g, "''").slice(0, 500)}'` : "NULL";
    const refId = opts.caseId != null ? Number(opts.caseId) : "NULL";

    const values = targets.map(uid =>
      `(${uid}, 'admin', 'system', '${sev}', '${safeTitle}', '${safeMsg}', ${link}, 'martyrdom_cases', ${refId}, NOW())`
    ).join(",");

    await db.execute(sql.raw(`
      INSERT INTO notifications
        (recipient_id, recipient_type, category, severity, title, message, link, ref_table, ref_id, created_at)
      VALUES ${values}
    `));
  } catch (err) {
    console.warn("[martyrdom-notify]", (err as any)?.message);
  }
}
