// netlify/functions/blob-image.ts
// ★ Phase M-2.5: 저장소 분기 + Pre-signed GET URL 302 리다이렉트
// - storage_provider='netlify': 기존 Netlify Blobs에서 직접 서빙 (하위 호환)
// - storage_provider='r2': Pre-signed GET URL 생성 → 302 리다이렉트
//   (R2 egress 무료 + Netlify Function CPU 절약)

import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { eq } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import { getR2Client, R2_BUCKET } from "../../lib/r2-client";

export const config = { path: "/api/blob-image" };

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const download = url.searchParams.get("download") === "1";

    if (!id || !/^\d+$/.test(id)) {
      return new Response(JSON.stringify({ error: "id required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const [row] = await db
      .select()
      .from(blobUploads)
      .where(eq(blobUploads.id, Number(id)))
      .limit(1);

    if (!row) return new Response("Not Found", { status: 404 });

    /* 비공개 파일은 인증 필요 */
    if (!(row as any).isPublic) {
      const admin = authenticateAdmin(req);
      const user = !admin ? authenticateUser(req) : null;
      if (!admin && !user) return new Response("Unauthorized", { status: 401 });
    }

    /* 업로드 미완료 파일 */
    if ((row as any).uploadStatus === "pending") {
      return new Response("Upload not completed", { status: 425 });
    }
    if ((row as any).uploadStatus === "failed") {
      return new Response("Upload failed", { status: 410 });
    }

    const provider = (row as any).storageProvider || "netlify";
    const fileName = (row as any).originalName || `file-${id}`;
    const encoded = encodeURIComponent(fileName);
    const disposition = download
      ? `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`
      : "inline";

    /* ====================================================================
       R2 분기 — Pre-signed GET URL 생성 후 302 리다이렉트
       ==================================================================== */
    if (provider === "r2") {
      const client = getR2Client();
      const cmd = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: (row as any).blobKey,
        ResponseContentDisposition: disposition,
        ResponseContentType: (row as any).mimeType || undefined,
      });
      const signedUrl = await getSignedUrl(client, cmd, { expiresIn: 3600 });

      return new Response(null, {
        status: 302,
        headers: {
          location: signedUrl,
          "cache-control": (row as any).isPublic
            ? "public, max-age=300"
            : "private, max-age=60",
        },
      });
    }

    /* ====================================================================
       Netlify Blobs 분기 — 기존 직접 서빙 (하위 호환)
       ==================================================================== */
    const store = getStore("blob-uploads");
    const blob = await store.get((row as any).blobKey, { type: "arrayBuffer" });
    if (!blob) return new Response("File not found in storage", { status: 404 });

    const headers: Record<string, string> = {
      "content-type": (row as any).mimeType || "application/octet-stream",
      "cache-control": (row as any).isPublic
        ? "public, max-age=86400"
        : "private, max-age=3600",
      "content-disposition": disposition,
    };

    return new Response(blob as ArrayBuffer, { status: 200, headers });
  } catch (e: any) {
    console.error("[blob-image]", e);
    return new Response(
      JSON.stringify({ error: e?.message || "internal error" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};