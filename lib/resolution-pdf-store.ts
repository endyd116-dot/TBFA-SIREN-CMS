/**
 * 지출결의서 PDF 생성 + R2 박제 공용 헬퍼
 * - 최종 승인 직후(admin-approval-decide) · 재발행(admin-approval-resolution-regenerate) 공용.
 * - 기안자가 결재선의 직책(예: 국장)을 겸하면 그 직책 결재칸은 자기결재라 결재란에서 제외한다.
 *   (그 칸에 super_admin 이 대신 승인해 이름이 잘못 찍히던 문제도 함께 해소)
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { isoUTC } from "./kst";
import { generateResolutionPDF } from "./pdf-resolution";
import { uploadToR2 } from "./r2-server";

async function rowsOf(q: any): Promise<any[]> { return q?.rows ?? q ?? []; }

const RL: Record<string, string> = { operator: "담당자", admin: "국장", super_admin: "이사장" };

export async function buildAndStoreResolutionPdf(
  requestId: number,
  approverId: number,
): Promise<{ url: string | null; resolutionNo: string | null }> {
  const reqRows = await rowsOf(await db.execute(sql`
    SELECT id, title, amount, budget_account_id, fiscal_year, occurred_at,
           payee_name, description, drafter_id, drafter_name, created_at, resolution_no
      FROM approval_requests WHERE id = ${requestId} LIMIT 1
  `));
  const r = reqRows[0];
  if (!r) throw new Error("결재 요청을 찾을 수 없습니다");
  if (!r.resolution_no) throw new Error("아직 지출결의서 번호가 발행되지 않았습니다(최종 승인 전)");

  const stepHist = await rowsOf(await db.execute(sql`
    SELECT role, decided_by_name, decided_at FROM approval_request_steps
     WHERE request_id = ${requestId} ORDER BY step_index
  `));

  let budgetPath = "";
  if (r.budget_account_id) {
    const bp = await rowsOf(await db.execute(sql`
      SELECT gwan.name AS g, hang.name AS h, mok.name AS m
        FROM budget_accounts mok
        LEFT JOIN budget_accounts hang ON hang.id = mok.parent_id
        LEFT JOIN budget_accounts gwan ON gwan.id = hang.parent_id
       WHERE mok.id = ${r.budget_account_id} LIMIT 1
    `));
    if (bp[0]) budgetPath = [bp[0].g, bp[0].h, bp[0].m].filter(Boolean).join(" > ");
  }

  let drafterRole: string | null = null;
  if (r.drafter_id) {
    try {
      const dr = await rowsOf(await db.execute(sql`SELECT role FROM members WHERE id = ${r.drafter_id} LIMIT 1`));
      drafterRole = dr[0]?.role || null;
    } catch { /* 실패해도 결의서는 계속 생성 */ }
  }

  const pdfSteps = [{ roleLabel: "기안", name: r.drafter_name || "", date: isoUTC(r.created_at) || "" }].concat(
    (stepHist as any[])
      .filter((s) => !(drafterRole && s.role === drafterRole))
      .map((s) => ({ roleLabel: RL[s.role] || s.role, name: s.decided_by_name || "", date: s.decided_at || "" })),
  );

  const pdfBytes = await generateResolutionPDF({
    resolutionNo: r.resolution_no, title: r.title, amount: Number(r.amount), budgetPath,
    payeeName: r.payee_name, occurredAt: isoUTC(r.occurred_at), description: r.description,
    drafterName: r.drafter_name, createdAt: isoUTC(r.created_at), steps: pdfSteps,
  });

  const up = await uploadToR2({
    buffer: pdfBytes, originalName: `resolution_${r.resolution_no}.pdf`,
    mimeType: "application/pdf", context: "approval_resolution",
    uploadedByAdmin: approverId, isPublic: false,
  });

  let url: string | null = null;
  if (up.ok && up.url) {
    url = up.url;
    await db.execute(sql`UPDATE approval_requests SET resolution_pdf_url = ${url} WHERE id = ${requestId}`);
  }
  return { url, resolutionNo: r.resolution_no };
}
