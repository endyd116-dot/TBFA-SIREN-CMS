// netlify/functions/notify-test-seed.ts
// ★ M-3 검증용 임시 — 본인에게 알림 1개 생성. 검증 후 삭제할 것.

import type { Context } from "@netlify/functions";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import { createNotification } from "../../lib/notify";
import {
  ok, badRequest, unauthorized, serverError,
  corsPreflight, methodNotAllowed, parseJson
} from "../../lib/response";

export const config = { path: "/api/notify-test-seed" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const admin = authenticateAdmin(req);
  const user = !admin ? authenticateUser(req) : null;
  if (!admin && !user) return unauthorized("로그인이 필요합니다");

  const recipientId = (admin as any)?.uid || (user as any)?.uid;
  const recipientType = admin ? "admin" : "user";

  const body = await parseJson<any>(req);
  const severity = body?.severity || "info";
  const title = body?.title || "테스트 알림";
  const message = body?.message || "본문 메시지";

  try {
    const id = await createNotification({
      recipientId,
      recipientType: recipientType as any,
      category: "system",
      severity,
      title,
      message,
      link: "/test-notify.html",
    });
    return ok({ id, recipientId, severity }, "알림 생성됨");
  } catch (e: any) {
    return serverError("생성 실패", e);
  }
};