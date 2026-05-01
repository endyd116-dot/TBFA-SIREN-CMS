/**
 * POST /api/support/create
 * 유가족 지원 신청 — 로그인 필수
 *  + 관리자에게 알림 메일 발송
 *  + AI 우선순위 자동 분석 후 DB 저장 (STEP E-4a)
 */
import { eq } from "drizzle-orm";
import { db, supportRequests, members, generateRequestNo } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { supportRequestSchema, safeValidate } from "../../lib/validation";
import {
  created, badRequest, unauthorized, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";
import { sendEmail, tplSupportReceivedAdmin } from "../../lib/email";
import { analyzePriority } from "../../lib/ai-priority";

const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 인증 */
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    /* 2. 회원 상태 */
    const [user] = await db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        type: members.type,
        status: members.status,
      })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) return unauthorized("회원 정보를 찾을 수 없습니다");
    if (user.status === "pending") {
      return forbidden("회원 승인 대기 중입니다. 승인 후 신청 가능합니다.");
    }
    if (user.status !== "active") {
      return forbidden("이용할 수 없는 계정입니다");
    }

    /* 3. 입력 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v = safeValidate(supportRequestSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해주세요", (v as any).errors);

    const { category, title, content, attachments } = (v as any).data;

    /* 4. 신청번호 */
    const requestNo = generateRequestNo("S");

    /* 5. ★ AI 우선순위 분석 (실패해도 신청은 진행) */
    let priority = "normal";
    let priorityReason = "AI 미실행";
    try {
      const analysis = await analyzePriority({ category, title, content });
      priority = analysis.priority;
      priorityReason = analysis.reason;
      console.log(`[support-create] AI 우선순위 분석: ${priority} (${analysis.confidence}) - ${analysis.reason}`);
    } catch (aiErr) {
      console.error("[support-create] AI 분석 실패:", aiErr);
    }

    /* 6. DB 저장 */
    const insertData: any = {
      requestNo,
      memberId: user.id,
      category,
      title,
      content,
      attachments: attachments && attachments.length > 0
        ? JSON.stringify(attachments)
        : null,
      status: "submitted",
      priority,
      priorityReason,
    };

    const [record] = await db
      .insert(supportRequests)
      .values(insertData)
      .returning({
        id: supportRequests.id,
        requestNo: supportRequests.requestNo,
        category: supportRequests.category,
        title: supportRequests.title,
        status: supportRequests.status,
        priority: supportRequests.priority,
        createdAt: supportRequests.createdAt,
      });

    /* 7. 관리자 알림 메일 (긴급 표시 포함) */
    if (ADMIN_NOTIFY_EMAIL) {
      try {
        const contentPreview = (content || "").trim().slice(0, 80);
        const subjectPrefix = priority === "urgent" ? "🔴 긴급 - " : "";
        const tpl = tplSupportReceivedAdmin({
          requestNo,
          applicantName: user.name,
          applicantEmail: user.email,
          category,
          title: subjectPrefix + title,
          contentPreview: priority === "urgent"
            ? `[AI 긴급 판단: ${priorityReason}]\n\n${contentPreview}`
            : contentPreview,
        });
        await sendEmail({
          to: ADMIN_NOTIFY_EMAIL,
          subject: tpl.subject,
          html: tpl.html,
        });
      } catch (emailErr) {
        console.error("[support-create] 관리자 메일 발송 실패:", emailErr);
      }
    }

    /* 8. 감사 로그 */
    await logUserAction(req, user.id as any, user.name as any, "support_create", {
      target: requestNo,
      detail: { category, memberType: user.type, priority },
    });

    return created(
      { request: record },
      "지원 신청이 성공적으로 완료되었습니다."
    );
  } catch (err) {
    console.error("[support-create]", err);
    return serverError("신청 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/support/create" };