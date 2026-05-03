/**
 * GET /api/support/download?key=...&id=...
 *
 * 지원 신청 첨부파일 다운로드
 *
 * 권한:
 * - 관리자/운영자: 모든 신청의 첨부 다운로드 가능
 * - 일반 회원: 본인 신청의 첨부만 다운로드 가능
 *
 * 보안:
 * - key 파라미터를 attachments JSON에서 검증 (다른 신청 파일 우회 접근 방지)
 * - 권한 검증 + 첨부 소속 검증 이중 체크
 * - 한글 파일명 RFC 5987 인코딩 (Content-Disposition)
 * - 감사 로그 기록 (성공/실패 모두)
 */
import { eq } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { db, supportRequests, members } from "../../db";
import { authenticateUser } from "../../lib/auth";
import {
  badRequest, unauthorized, forbidden, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    /* 1. 로그인 검증 */
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    /* 2. 파라미터 파싱 */
    const url = new URL(req.url);
    const key = url.searchParams.get("key") || "";
    const idStr = url.searchParams.get("id") || "";

    if (!key || !idStr) {
      return badRequest("key와 id 파라미터가 필요합니다");
    }

    const requestId = Number(idStr);
    if (!Number.isFinite(requestId)) {
      return badRequest("유효하지 않은 신청 ID");
    }

    /* 3. 신청 정보 조회 */
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, requestId))
      .limit(1);

    if (!request) {
      return notFound("신청 내역을 찾을 수 없습니다");
    }

    /* 4. 회원 정보 조회 (권한 판단용) */
    const [user] = await db
      .select({
        id: members.id,
        name: members.name,
        type: members.type,
        role: members.role,
        operatorActive: members.operatorActive,
        status: members.status,
      })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) return unauthorized("회원 정보를 찾을 수 없습니다");

    if (user.status === "withdrawn" || user.status === "suspended") {
      return unauthorized("이용할 수 없는 계정입니다");
    }

    /* 5. 권한 검증 — 관리자/운영자 또는 본인 */
    const isAdmin =
      user.type === "admin" ||
      (user.role === "super_admin" && user.operatorActive !== false) ||
      (user.role === "operator" && user.operatorActive !== false);
    const isOwner = request.memberId === user.id;

    if (!isAdmin && !isOwner) {
      await logUserAction(req, user.id, user.name, "support_download_denied", {
        target: request.requestNo,
        detail: { reason: "not_authorized", key },
        success: false,
      });
      return forbidden("이 첨부파일을 다운로드할 권한이 없습니다");
    }

    /* 6. ★ key가 실제로 이 신청의 attachments에 포함되어 있는지 검증 (우회 방지)
       — 공격자가 다른 신청 ID를 알고 있어도, 그 신청에 속하지 않은 key는 차단 */
    let attachments: string[] = [];
    try {
      attachments = request.attachments ? JSON.parse(request.attachments) : [];
    } catch (e) {
      attachments = [];
    }

    if (!Array.isArray(attachments) || !attachments.includes(key)) {
      await logUserAction(req, user.id, user.name, "support_download_denied", {
        target: request.requestNo,
        detail: { reason: "key_not_in_attachments", key },
        success: false,
      });
      return forbidden("이 신청의 첨부파일이 아닙니다");
    }

    /* 7. Netlify Blobs에서 파일 가져오기 */
    const store = getStore({ name: "support-attachments", consistency: "strong" });
    const blob = await store.getWithMetadata(key, { type: "arrayBuffer" });

    if (!blob || !blob.data) {
      await logUserAction(req, user.id, user.name, "support_download_failed", {
        target: request.requestNo,
        detail: { reason: "blob_not_found", key },
        success: false,
      });
      return notFound("파일을 찾을 수 없습니다 (만료되었거나 삭제됨)");
    }

    /* 8. 메타데이터에서 원본 파일명 / MIME 복원 */
    const metadata: any = blob.metadata || {};
    const originalName = String(metadata.originalName || "attachment");
    const mimeType = String(metadata.mimeType || "application/octet-stream");
    const buffer = blob.data as ArrayBuffer;

    /* 9. 한글 파일명 RFC 5987 인코딩 (Content-Disposition)
       - filename: ASCII fallback (한글 → 언더스코어)
       - filename*: UTF-8 encoded (브라우저가 우선 사용) */
    const encodedName = encodeURIComponent(originalName);
    const fallbackName = originalName.replace(/[^\x20-\x7E]/g, "_");

    /* 10. 감사 로그 */
    await logUserAction(req, user.id, user.name, "support_download_success", {
      target: request.requestNo,
      detail: {
        key,
        originalName,
        size: buffer.byteLength,
        mimeType,
        accessor: isAdmin ? "admin" : "owner",
      },
    });

    /* 11. 응답 (스트리밍) */
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[support-download]", err);
    return serverError("파일 다운로드 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/support/download" };