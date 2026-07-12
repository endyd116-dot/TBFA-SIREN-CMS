/**
 * GET /api/admin-referral-pdf?referralId=N
 * 인계 PDF 다운로드
 *
 * 1순위: R2에 저장된 원본 반환
 * 2순위: 이력 데이터로 PDF 재생성 (폴백)
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { downloadFromR2 } from "../../lib/r2-server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const config = { path: "/api/admin-referral-pdf" };

let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const buf = readFileSync(join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf"));
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array((_fontCache as ArrayBuffer).slice(0));
}

async function buildFallbackPDF(log: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);
  const font = await pdfDoc.embedFont(loadKoreanFont(), { subset: false });
  const page = pdfDoc.addPage([595, 842]);
  const { height } = page.getSize();
  const margin = 60;

  page.drawText("외부 기관 인계 문서 (재생성)", {
    x: margin, y: height - margin, size: 16, font, color: rgb(0.1, 0.1, 0.1),
  });
  page.drawLine({
    start: { x: margin, y: height - margin - 10 },
    end: { x: 535, y: height - margin - 10 },
    thickness: 1, color: rgb(0.4, 0.4, 0.4),
  });

  const lines = [
    `기관명: ${log.agency_name ?? "-"}`,
    `신고 유형: ${log.source_type ?? "-"}`,
    `신고번호: ${log.source_no ?? "-"}`,
    `인계일시: ${log.referred_at ? new Date(log.referred_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}`,
    `상태: ${log.status ?? "-"}`,
    `메모: ${log.status_memo ?? "-"}`,
  ];

  let y = height - margin - 40;
  for (const line of lines) {
    page.drawText(line, { x: margin, y, size: 11, font, color: rgb(0, 0, 0) });
    y -= 22;
  }

  page.drawText("(원본 PDF 파일이 없어 이력 데이터로 재생성되었습니다)", {
    x: margin, y: margin - 20, size: 9, font, color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}

function jsonError(step: string, err: any) {
  return new Response(
    jsonKST({
      ok: false,
      error: "PDF 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const adminId: number = auth.ctx.admin.uid;
  const adminName: string = auth.ctx.member?.name ?? "어드민";

  const url = new URL(req.url);
  const referralId = Number(url.searchParams.get("referralId") || "0");
  if (!referralId) {
    return new Response(
      jsonKST({ ok: false, error: "referralId는 필수입니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  /* 이력 조회 */
  let log: any;
  try {
    const result = await db.execute(sql`
      SELECT id, agency_name, source_type, source_no, referred_at,
             pdf_storage_key, status, status_memo
      FROM referral_logs
      WHERE id = ${referralId}
      LIMIT 1
    `);
    const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
    log = rows[0];
  } catch (err: any) {
    return jsonError("select_log", err);
  }

  if (!log) {
    return new Response(
      jsonKST({ ok: false, error: "인계 이력을 찾을 수 없습니다" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  /* Q2-018: 인계 의뢰서 PDF(사건 PII) 다운로드 감사 로그 — 반환 직전 기록.
     R2 원본·재생성 폴백 어느 경로로 내려가든 동일하게 남도록 응답 생성 전에 1회 기록. */
  await logAdminAction(req, adminId, adminName, "referral_pdf_download", {
    target: String(referralId),
    detail: {
      sourceType: log.source_type ?? null,
      sourceNo: log.source_no ?? null,
      agencyName: log.agency_name ?? null,
    },
  });

  const fileName = `referral_${log.source_type}_${log.source_no || referralId}.pdf`;
  const encoded = encodeURIComponent(fileName);
  const dispHeader = `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`;

  /* R2 원본 반환 */
  if (log.pdf_storage_key) {
    try {
      const bytes = await downloadFromR2(String(log.pdf_storage_key));
      if (bytes && bytes.length > 0) {
        return new Response(Buffer.from(bytes) as any, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": dispHeader,
            "Content-Length": String(bytes.length),
          },
        });
      }
    } catch (err) {
      console.warn("[admin-referral-pdf] R2 다운로드 실패, 재생성으로 폴백:", err);
    }
  }

  /* 폴백: 재생성 */
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildFallbackPDF(log);
  } catch (err: any) {
    return jsonError("generate_fallback_pdf", err);
  }

  return new Response(Buffer.from(pdfBytes) as any, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": dispHeader,
      "Content-Length": String(pdfBytes.length),
    },
  });
};
