/**
 * /api/att-correction-files — 근태 수정 요청의 증빙 자료 (직원 본인용)
 *
 *   GET  ?mine=1              내 파일함의 파일 목록 (첨부로 고를 수 있는 것들)
 *   GET  ?download=<fileId>   내 파일 내려받기 (본인 파일만)
 *   POST ?action=presign      새 파일 업로드 자리 만들기 → { fileId, uploadUrl }
 *   POST ?action=confirm      업로드 끝났음을 알림 (파일함에 정식 등록)
 *
 * 올린 파일은 본인 소유 '근태 증빙' 폴더에 모인다 — 파일함에서 다시 꺼내 쓸 수 있다.
 * 파일 종류 제한 없음 (한글·워드·PDF·이미지 등) · 용량 20MB.
 * 권한: 로그인한 직원 본인 (requireOperator — 관리자 토큰도 통과)
 */
import { jsonKST } from "../../lib/kst";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db/index";
import { workspaceFiles } from "../../db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { getR2Client, R2_BUCKET, generateBlobKey } from "../../lib/r2-client";
import {
  EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES,
  ensureEvidenceFolder, evidenceDownloadUrl,
} from "../../lib/att-evidence";

export const config = { path: "/api/att-correction-files" };

function jsonOk(data: unknown, status = 200) {
  return new Response(jsonKST({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "증빙 자료 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBadRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  const meId = Number((auth as any).ctx.member.id);
  const url = new URL(req.url);

  /* ── GET ── */
  if (req.method === "GET") {
    /* 내려받기 — 본인 파일만 (남의 파일 번호를 넣어도 소유자 조건에서 걸린다) */
    const dl = url.searchParams.get("download");
    if (dl) {
      try {
        const [f] = await db.select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(and(
            eq(workspaceFiles.id, Number(dl)),
            eq(workspaceFiles.ownerId, meId),
            isNull(workspaceFiles.deletedAt),
          ))
          .limit(1);
        if (!f) return jsonBadRequest("파일을 찾을 수 없습니다");

        const signed = await evidenceDownloadUrl(f.id);
        if (!signed) return jsonBadRequest("파일을 찾을 수 없습니다");
        return jsonOk(signed);
      } catch (err) { return jsonError("presign_download", err); }
    }

    /* 내 파일함 목록 — 첨부로 고를 수 있는 파일 (업로드가 끝난 것만) */
    try {
      const files = await db.select({
        id: workspaceFiles.id,
        name: workspaceFiles.name,
        sizeBytes: workspaceFiles.sizeBytes,
        mimeType: workspaceFiles.mimeType,
        ext: workspaceFiles.ext,
        createdAt: workspaceFiles.createdAt,
      })
        .from(workspaceFiles)
        .where(and(
          eq(workspaceFiles.ownerId, meId),
          eq(workspaceFiles.uploadStatus, "ready"),
          isNull(workspaceFiles.deletedAt),
        ))
        .orderBy(desc(workspaceFiles.createdAt))
        .limit(200);
      return jsonOk({ files, maxBytes: EVIDENCE_MAX_BYTES, maxFiles: EVIDENCE_MAX_FILES });
    } catch (err) { return jsonError("select_my_files", err); }
  }

  /* ── POST ── */
  if (req.method === "POST") {
    const action = url.searchParams.get("action") || "";
    let body: any = {};
    try { body = await req.json(); } catch { /* 본문 없으면 아래 검증에서 걸린다 */ }

    /* 업로드 자리 만들기 — 파일은 브라우저가 저장소로 직접 올린다(서버 본문 한도 우회) */
    if (action === "presign") {
      const name = String(body.name || "").trim().slice(0, 300);
      const sizeBytes = Number(body.sizeBytes || 0);
      const mimeType = String(body.mimeType || "application/octet-stream").slice(0, 100);

      if (!name) return jsonBadRequest("파일 이름이 없습니다");
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return jsonBadRequest("빈 파일은 올릴 수 없습니다");
      if (sizeBytes > EVIDENCE_MAX_BYTES) {
        return jsonBadRequest(
          `파일은 ${EVIDENCE_MAX_BYTES / 1024 / 1024}MB 이하만 올릴 수 있습니다 ` +
          `(선택한 파일: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB)`
        );
      }

      try {
        const folderId = await ensureEvidenceFolder(meId);
        const ext = (name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
        const r2Key = generateBlobKey("workspace-files", meId, name);

        const [file] = await db.insert(workspaceFiles).values({
          folderId,
          ownerId: meId,
          name,
          r2Key,
          sizeBytes,
          mimeType,
          ext,
          uploadStatus: "pending",
          downloadCount: 0,
          description: "근태 수정 요청 증빙",
          tags: ["근태증빙"] as any,
          isShared: false,
        } as any).returning();

        const uploadUrl = await getSignedUrl(
          getR2Client(),
          new PutObjectCommand({ Bucket: R2_BUCKET, Key: r2Key, ContentType: mimeType }),
          { expiresIn: 900 },
        );

        return jsonOk({ fileId: file.id, uploadUrl, name, sizeBytes, mimeType });
      } catch (err) { return jsonError("presign_upload", err); }
    }

    /* 업로드 완료 — 이제부터 파일함에 정식으로 보인다 */
    if (action === "confirm") {
      const fileId = Number(body.fileId);
      if (!Number.isFinite(fileId)) return jsonBadRequest("fileId 필수");
      try {
        const [updated] = await db.update(workspaceFiles)
          .set({ uploadStatus: "ready", updatedAt: new Date() } as any)
          .where(and(
            eq(workspaceFiles.id, fileId),
            eq(workspaceFiles.ownerId, meId),      // 남의 파일을 확정 처리할 수 없다
          ))
          .returning({
            id: workspaceFiles.id, name: workspaceFiles.name,
            sizeBytes: workspaceFiles.sizeBytes, mimeType: workspaceFiles.mimeType,
          });
        if (!updated) return jsonBadRequest("파일을 찾을 수 없습니다");
        return jsonOk({ file: updated });
      } catch (err) { return jsonError("confirm_upload", err); }
    }

    return jsonBadRequest("action은 presign 또는 confirm 이어야 합니다");
  }

  return new Response("Method Not Allowed", { status: 405 });
}
