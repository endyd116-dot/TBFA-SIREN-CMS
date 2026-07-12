/**
 * POST /api/admin-referral-create
 * 외부 기관 인계 실행 — PDF 생성 + R2 업로드 + 이력 저장
 *
 * Body: { agencyId, sourceType: "incident"|"harassment"|"legal", sourceId }
 * 응답: { ok, logId } — PDF는 admin-referral-pdf?referralId=N 으로 별도 다운로드
 *
 * 변수 치환 지원:
 *   {{기관명}} {{신고번호}} {{피해자명}} {{발생일시}} {{사건내용}} {{AI요약}} {{AI심각도}} {{인계일시}} {{인계담당자}}
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { uploadToR2 } from "../../lib/r2-server";

export const config = { path: "/api/admin-referral-create" };

/* ── 폰트 캐시 ── */
let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const buf = readFileSync(join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf"));
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array((_fontCache as ArrayBuffer).slice(0));
}

function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

function formatKST(date: Date): string {
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function formatDateKST(date: Date | null | undefined): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }
  return result;
}

async function buildReferralPDF(templateBody: string, vars: Record<string, string>): Promise<Uint8Array> {
  const text = applyTemplate(templateBody, vars);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);

  const font = await pdfDoc.embedFont(loadKoreanFont(), { subset: false });
  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const margin = 60;
  const lineHeight = 18;
  const fontSize = 11;

  page.drawText("외부 기관 인계 문서", {
    x: margin, y: height - margin, size: 16, font, color: rgb(0.1, 0.1, 0.1),
  });
  page.drawLine({
    start: { x: margin, y: height - margin - 10 },
    end: { x: width - margin, y: height - margin - 10 },
    thickness: 1, color: rgb(0.4, 0.4, 0.4),
  });

  const lines = text.split("\n");
  let y = height - margin - 40;
  for (const line of lines) {
    if (y < margin + lineHeight) {
      const newPage = pdfDoc.addPage([595, 842]);
      y = newPage.getSize().height - margin;
      newPage.drawText(line || " ", { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
    } else {
      page.drawText(line || " ", { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
    }
    y -= lineHeight;
  }

  const lastPage = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
  lastPage.drawText(`생성일시: ${formatKST(new Date())}`, {
    x: margin, y: margin - 20, size: 9, font, color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}

function jsonError(step: string, err: any) {
  return new Response(
    jsonKST({
      ok: false,
      error: "인계 처리 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST only" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const adminId: number = auth.ctx.admin.uid;
  const adminName: string = auth.ctx.member.name ?? "어드민";

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const { agencyId, sourceType, sourceId } = body;
  if (!agencyId || !sourceType || !sourceId) {
    return new Response(
      jsonKST({ ok: false, error: "agencyId, sourceType, sourceId는 필수입니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!["incident", "harassment", "legal"].includes(sourceType)) {
    return new Response(
      jsonKST({ ok: false, error: "sourceType은 incident|harassment|legal 중 하나여야 합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  /* 기관 조회 */
  let agency: any;
  try {
    const result = await db.execute(sql`
      SELECT id, name, agency_type, template_body
      FROM external_agencies
      WHERE id = ${Number(agencyId)} AND is_active = TRUE
      LIMIT 1
    `);
    const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
    agency = rows[0];
  } catch (err: any) {
    return jsonError("select_agency", err);
  }

  if (!agency) {
    return new Response(
      jsonKST({ ok: false, error: "기관을 찾을 수 없습니다" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  /* 신고 원본 조회 */
  let source: any;
  let sourceNo = "";
  try {
    if (sourceType === "incident") {
      const r = await db.execute(sql`
        SELECT report_no, title, content_html, is_anonymous, reporter_name, occurred_at,
               ai_summary, ai_severity
        FROM incident_reports WHERE id = ${Number(sourceId)} LIMIT 1
      `);
      const rows = Array.isArray(r) ? r : ((r as any)?.rows ?? []);
      source = rows[0];
      sourceNo = source?.report_no ?? "";
    } else if (sourceType === "harassment") {
      const r = await db.execute(sql`
        SELECT report_no, title, content_html, is_anonymous, reporter_name, occurred_at,
               ai_summary, ai_severity
        FROM harassment_reports WHERE id = ${Number(sourceId)} LIMIT 1
      `);
      const rows = Array.isArray(r) ? r : ((r as any)?.rows ?? []);
      source = rows[0];
      sourceNo = source?.report_no ?? "";
    } else {
      const r = await db.execute(sql`
        SELECT consultation_no AS report_no, title, content_html, is_anonymous, reporter_name,
               occurred_at, ai_summary, ai_urgency AS ai_severity
        FROM legal_consultations WHERE id = ${Number(sourceId)} LIMIT 1
      `);
      const rows = Array.isArray(r) ? r : ((r as any)?.rows ?? []);
      source = rows[0];
      sourceNo = source?.report_no ?? "";
    }
  } catch (err: any) {
    return jsonError("select_source", err);
  }

  if (!source) {
    return new Response(
      jsonKST({ ok: false, error: "신고 원본을 찾을 수 없습니다" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  /* Q2-030: 동일 인계 중복 방지 — 같은 (신고유형, 신고원본, 기관)으로 이미 인계 이력이
     있으면 차단(중복 인계로 동일 PDF가 재생성·재업로드되는 것을 방지).
     PDF 생성·R2 업로드 전에 검사해 불필요한 작업을 피함. */
  try {
    const dup = await db.execute(sql`
      SELECT id FROM referral_logs
      WHERE source_type = ${sourceType}
        AND source_id = ${Number(sourceId)}
        AND agency_id = ${Number(agencyId)}
      LIMIT 1
    `);
    const dupRows = Array.isArray(dup) ? dup : ((dup as any)?.rows ?? []);
    if (dupRows.length > 0) {
      return new Response(
        jsonKST({
          ok: false,
          error: "이미 동일 기관으로 인계된 신고입니다 (중복 인계 방지)",
          duplicateLogId: dupRows[0].id,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    return jsonError("check_duplicate", err);
  }

  /* 변수 치환 */
  const victimName = source.is_anonymous ? "익명" : (source.reporter_name || "미기재");
  const vars: Record<string, string> = {
    "기관명":    String(agency.name),
    "신고번호":  String(sourceNo),
    "피해자명":  victimName,
    "발생일시":  source.occurred_at ? formatDateKST(new Date(source.occurred_at)) : "-",
    "사건내용":  stripHtml(String(source.content_html || "")),
    "AI요약":    String(source.ai_summary || "(AI 분석 없음)"),
    "AI심각도":  String(source.ai_severity || "-"),
    "인계일시":  formatKST(new Date()),
    "인계담당자": adminName,
  };

  const templateBody = String(agency.template_body ||
    `수신: {{기관명}}\n발신: (사)교사유가족협의회\n제목: 사건 인계 요청\n\n사건번호: {{신고번호}}\n피해자: {{피해자명}}\n발생일시: {{발생일시}}\n\n사건 내용:\n{{사건내용}}\n\nAI 요약: {{AI요약}}\nAI 심각도: {{AI심각도}}\n\n인계일시: {{인계일시}}\n인계담당자: {{인계담당자}}\n\n위 사건을 귀 기관에 인계하오니 검토 부탁드립니다.`);

  /* PDF 생성 */
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildReferralPDF(templateBody, vars);
  } catch (err: any) {
    return jsonError("generate_pdf", err);
  }

  /* R2 업로드 (실패해도 이력은 저장) */
  const pdfFileName = `referral_${sourceType}_${sourceId}_${Date.now()}.pdf`;
  let pdfStorageKey: string | null = null;
  try {
    const uploadResult = await uploadToR2({
      buffer: pdfBytes,
      originalName: pdfFileName,
      mimeType: "application/pdf",
      context: "referral",
      uploadedByAdmin: adminId,
      isPublic: false,
    });
    if (uploadResult.ok) pdfStorageKey = uploadResult.blobKey ?? null;
  } catch (err) {
    console.warn("[admin-referral-create] R2 업로드 실패, 이력만 저장:", err);
  }

  /* 이력 저장 */
  let logId: number;
  try {
    const result = await db.execute(sql`
      INSERT INTO referral_logs
        (agency_id, agency_name, source_type, source_id, source_no, referred_by,
         referred_at, pdf_storage_key, status, created_at, updated_at)
      VALUES
        (${Number(agencyId)}, ${String(agency.name)}, ${sourceType}, ${Number(sourceId)},
         ${sourceNo}, ${adminId}, NOW(), ${pdfStorageKey}, 'sent', NOW(), NOW())
      RETURNING id
    `);
    const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
    logId = rows[0]?.id;
  } catch (err: any) {
    return jsonError("insert_log", err);
  }

  return new Response(
    jsonKST({ ok: true, logId, pdfAvailable: !!pdfStorageKey }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
