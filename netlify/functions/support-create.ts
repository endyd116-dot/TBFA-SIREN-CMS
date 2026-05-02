/**
 * POST /api/support/create
 * 유가족 지원 신청 — 로그인 필수
 *  + 관리자/담당자 다중 메일 발송 (STEP F-3)
 *  + AI 우선순위 자동 분석 (STEP E-4a)
 *  + 긴급 신청은 모든 운영자에게 강제 발송
 *  + 신청자에게 접수 확인 메일 발송 (★ STEP H-4)
 */
import { eq, and } from "drizzle-orm";
import { db, supportRequests, members, generateRequestNo } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { supportRequestSchema, safeValidate } from "../../lib/validation";
import {
  created, badRequest, unauthorized, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";
import { sendEmail, tplSupportReceivedAdmin, tplSupportReceiptUser } from "../../lib/email";
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

    /* 5. AI 우선순위 분석 */
    let priority = "normal";
    let priorityReason = "AI 미실행";
    try {
      const analysis = await analyzePriority({ category, title, content });
      priority = analysis.priority;
      priorityReason = analysis.reason;
      console.log(`[support-create] AI 우선순위: ${priority} (${analysis.confidence}) - ${analysis.reason}`);
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

    /* 7. ★ 메일 수신자 결정 (STEP F-3) */
    const recipientEmails = new Set<string>();

    /* 7-1. 환경변수 ADMIN_NOTIFY_EMAIL은 항상 폴백으로 추가 */
    if (ADMIN_NOTIFY_EMAIL) {
      recipientEmails.add(ADMIN_NOTIFY_EMAIL);
    }

    /* 7-2. 긴급(urgent)은 모든 활성 운영자에게 강제 발송 */
    if (priority === "urgent") {
      try {
        const allOperators = await db
          .select({ email: members.email })
          .from(members)
          .where(
            and(
              eq(members.type, "admin"),
              eq(members.operatorActive, true)
            )
          );
        for (const op of allOperators) {
          if (op.email) recipientEmails.add(op.email);
        }
        console.log(`[support-create] 🔴 긴급 — 모든 운영자에게 발송: ${recipientEmails.size}명`);
      } catch (opErr) {
        console.error("[support-create] 긴급 운영자 조회 실패:", opErr);
      }
    } else {
      /* 7-3. 일반 신청 — notifyOnSupport=true인 운영자에게만 발송 */
      try {
        const notifyOps = await db
          .select({ email: members.email })
          .from(members)
          .where(
            and(
              eq(members.type, "admin"),
              eq(members.operatorActive, true),
              eq(members.notifyOnSupport, true)
            )
          );
        for (const op of notifyOps) {
          if (op.email) recipientEmails.add(op.email);
        }
        console.log(`[support-create] 일반 — 알림 수신 운영자: ${recipientEmails.size}명`);
      } catch (opErr) {
        console.error("[support-create] 알림 운영자 조회 실패:", opErr);
      }
    }

    /* 8. 관리자/운영자 메일 발송 (실패해도 신청은 정상 처리) */
    if (recipientEmails.size > 0) {
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

      /* 각 수신자에게 개별 발송 (실패 시 다음 사람으로) */
      for (const email of recipientEmails) {
        try {
          await sendEmail({
            to: email,
            subject: tpl.subject,
            html: tpl.html,
          });
        } catch (emailErr) {
          console.error(`[support-create] ${email} 메일 발송 실패:`, emailErr);
        }
      }
    } else {
      console.warn("[support-create] 메일 수신자 없음 — ADMIN_NOTIFY_EMAIL 또는 운영자 알림 설정 필요");
    }

    /* ★ STEP H-4: 신청자에게 접수 확인 메일 발송
       - 결정 Q3-A안: 긴급 신청자에게만 1:1 채팅 안내 추가
       - try-catch로 격리 → 메일 실패해도 신청 처리 응답은 정상 반환 */
    if (user.email) {
      try {
        const userTpl = tplSupportReceiptUser({
          applicantName: user.name,
          requestNo,
          category,
          title,
          priority,
          createdAt: new Date((record as any).createdAt || Date.now()),
        });
        await sendEmail({
          to: user.email,
          subject: userTpl.subject,
          html: userTpl.html,
        });
      } catch (userMailErr) {
        /* 사용자 메일 발송 실패는 응답에 영향 주지 않음 — 로그만 남김 */
        console.error("[support-create] 신청자 접수 확인 메일 발송 실패:", userMailErr);
      }
    }

    /* 9. 감사 로그 */
    await logUserAction(req, user.id as any, user.name as any, "support_create", {
      target: requestNo,
      detail: { category, memberType: user.type, priority, recipientCount: recipientEmails.size },
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