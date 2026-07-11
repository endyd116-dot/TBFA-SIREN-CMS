/**
 * POST /api/support-supplement
 * 유가족 지원 신청의 보완 자료 제출 (본인만)
 *
 * v11 묶음 B-11:
 *   - status='supplement' 상태에서만 호출 가능
 *   - 본문 텍스트 + 첨부 ID 배열 받음
 *   - 기존 content 끝에 "[보완 자료 추가 — YYYY.MM.DD HH:mm]" 헤더와 함께 누적
 *   - 기존 attachments JSON 배열에 신규 ID 추가
 *   - 상태를 'submitted'로 복귀
 *   - 운영자 알림 메일 발송 (실패해도 무시)
 *
 * Body: { id: number, supplementContent: string, attachmentIds?: (string|number)[] }
 */
import { eq } from "drizzle-orm";
import { db, supportRequests, members } from "../../db";
import { requireActiveUser } from "../../lib/auth";
import { logUserAction } from "../../lib/audit";
import { sendEmail } from "../../lib/email";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 인증 + 차단(블랙) 회원 진입 차단 (2026-06-27 FIX) */
    const _r = await requireActiveUser(req);
    if (!_r.ok) return (_r as { ok: false; res: Response }).res;
    const auth = _r.user;

    /* 2. 입력 파싱 */
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return badRequest("id가 올바르지 않습니다");
    }

    const supplementContent = String(body.supplementContent || "").trim();
    if (supplementContent.length < 5) {
      return badRequest("보완 내용은 5자 이상 작성해 주세요");
    }
    if (supplementContent.length > 5000) {
      return badRequest("보완 내용은 5000자 이내로 작성해 주세요");
    }

    /* R41 Q2-026: 첨부 키는 본인 업로드(support/{uid}/...)만 병합 허용 — 타인 키 끼워넣기 차단 */
    const ownPrefix = `support/${auth.uid}/`;
    const newAttachments: string[] = Array.isArray(body.attachmentIds)
      ? body.attachmentIds
          .map((v: any) => String(v).trim())
          .filter((v: string) => v.length > 0 && v.startsWith(ownPrefix))
      : [];

    /* 3. 신청 조회 */
    const rows: any = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, id))
      .limit(1);

    const row: any = Array.isArray(rows) ? rows[0] : null;
    if (!row) return notFound("신청을 찾을 수 없습니다");

    if (Number(row.memberId) !== Number(auth.uid)) {
      return forbidden("본인의 신청만 보완 제출할 수 있습니다");
    }

    if (row.status !== "supplement") {
      return badRequest(
        "보완 요청 상태인 신청만 보완 제출이 가능합니다 (현재 상태: " + row.status + ")",
      );
    }

    /* 4. 본문 누적 */
    const now = new Date();
    const ts =
      now.getFullYear() + "." +
      String(now.getMonth() + 1).padStart(2, "0") + "." +
      String(now.getDate()).padStart(2, "0") + " " +
      String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");

    const header =
      "\n\n========================================\n" +
      "[보완 자료 추가 — " + ts + "]\n" +
      "========================================\n";
    const newContent = String(row.content || "") + header + supplementContent;

    /* 5. 기존 attachments 파싱 + 신규 합치기 */
    let existingAttachments: string[] = [];
    if (row.attachments) {
      try {
        const parsed = JSON.parse(row.attachments);
        if (Array.isArray(parsed)) {
          existingAttachments = parsed.map((v: any) => String(v));
        }
      } catch { /* 무시 */ }
    }
    const mergedAttachments = [...existingAttachments, ...newAttachments];

    /* 6. 회원 정보 (메일/감사로그용) */
    const memberRows: any = await db
      .select({ name: members.name, email: members.email })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);
    const member: any = Array.isArray(memberRows) ? memberRows[0] : null;

    /* 7. 업데이트 */
    const updateData: any = {
      content: newContent,
      attachments: mergedAttachments.length > 0
        ? JSON.stringify(mergedAttachments)
        : null,
      status: "submitted",
      updatedAt: now,
    };

    const updatedRows: any = await db
      .update(supportRequests)
      .set(updateData)
      .where(eq(supportRequests.id, id))
      .returning({
        id: supportRequests.id,
        requestNo: supportRequests.requestNo,
        status: supportRequests.status,
      });

    const updated: any = Array.isArray(updatedRows) ? updatedRows[0] : null;
    if (!updated) return serverError("업데이트 실패");

    /* 8. 운영자 알림 메일 (실패해도 무시) */
    if (ADMIN_NOTIFY_EMAIL) {
      try {
        const escapeHtml = (s: string) =>
          String(s || "").replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
        const previewText = supplementContent.slice(0, 300);
        const html = `
          <div style="font-family:'Malgun Gothic',sans-serif;font-size:14px;line-height:1.7;max-width:600px">
            <h2 style="color:#7a1f2b;border-bottom:2px solid #7a1f2b;padding-bottom:8px">유가족 지원 신청 보완 자료 제출</h2>
            <p>회원이 보완 자료를 제출하였습니다. 어드민에서 다시 검토해 주세요.</p>
            <table style="width:100%;border-collapse:collapse;margin:14px 0">
              <tr><td style="padding:6px 10px;background:#f8f9fa;width:120px"><strong>신청번호</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(row.requestNo)}</td></tr>
              <tr><td style="padding:6px 10px;background:#f8f9fa"><strong>신청자</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(member?.name || "회원")} (${escapeHtml(member?.email || "")})</td></tr>
              <tr><td style="padding:6px 10px;background:#f8f9fa"><strong>제목</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(row.title)}</td></tr>
              <tr><td style="padding:6px 10px;background:#f8f9fa"><strong>새 첨부</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${newAttachments.length}개 추가</td></tr>
              <tr><td style="padding:6px 10px;background:#f8f9fa"><strong>변경 상태</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee">supplement → submitted (재검토 대기)</td></tr>
            </table>
            <h3 style="color:#7a1f2b;font-size:14px;margin-top:18px">보완 내용 미리보기</h3>
            <div style="background:#fff8ec;border:1px solid #f0e3c4;padding:12px 14px;border-radius:6px;white-space:pre-wrap">${escapeHtml(previewText)}${supplementContent.length > 300 ? "\n\n...(생략)" : ""}</div>
            <p style="margin-top:18px;color:#666;font-size:12px">관리자 페이지 → 유가족 지원 관리에서 신청번호 ${escapeHtml(row.requestNo)}의 상세를 확인해 주세요.</p>
          </div>
        `;
        await sendEmail({
          to: ADMIN_NOTIFY_EMAIL,
          subject: `[보완 제출] ${row.requestNo} - ${row.title}`,
          html,
        });
      } catch (emailErr) {
        console.error("[support-supplement] 운영자 메일 실패:", emailErr);
      }
    }

    /* 9. 감사 로그 */
    try {
      await logUserAction(req, auth.uid as any, member?.name as any, "support_supplement_submit", {
        target: row.requestNo,
        detail: {
          contentLength: supplementContent.length,
          newAttachments: newAttachments.length,
          totalAttachments: mergedAttachments.length,
        },
      });
    } catch { /* 감사로그 실패는 무시 */ }

    return ok(
      { request: updated },
      "보완 자료가 제출되었습니다. 운영자가 다시 검토합니다.",
    );
  } catch (err) {
    console.error("[support-supplement]", err);
    return serverError("보완 제출 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/support-supplement" };