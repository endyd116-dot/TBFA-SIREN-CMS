/**
 * POST /api/support/create
 * 유가족 지원 신청 — 로그인 + 유가족/일반 회원 모두 가능 (단, family는 우선순위)
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

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 인증 */
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    /* 2. 회원 상태 확인 */
    const [user] = await db
      .select({
        id: members.id,
        name: members.name,
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
    if (!v.ok) return badRequest("입력값을 확인해주세요", v.errors);

    const { category, title, content, attachments } = v.data;

    /* 4. 신청번호 생성 */
    const requestNo = generateRequestNo("S");

    /* 5. DB 저장 */
    const [record] = await db
      .insert(supportRequests)
      .values({
        requestNo,
        memberId: user.id,
        category,
        title,
        content,
        attachments: attachments && attachments.length > 0
          ? JSON.stringify(attachments)
          : null,
        status: "submitted",
      })
      .returning({
        id: supportRequests.id,
        requestNo: supportRequests.requestNo,
        category: supportRequests.category,
        title: supportRequests.title,
        status: supportRequests.status,
        createdAt: supportRequests.createdAt,
      });

    /* 6. 감사 로그 */
    await logUserAction(req, user.id, user.name, "support_create", {
      target: requestNo,
      detail: { category, memberType: user.type },
    });

    return created(
      { request: record },
      "지원 신청이 접수되었습니다. 영업일 기준 3일 이내 안내드립니다."
    );
  } catch (err) {
    console.error("[support-create]", err);
    return serverError("신청 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/support/create" };