/**
 * POST /api/admin/logout
 */
import { authenticateAdmin, clearCookie } from "../../lib/auth";
import { ok, corsPreflight, methodNotAllowed } from "../../lib/response";
import { logAudit } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const admin = authenticateAdmin(req);
  if (admin) {
    await logAudit({
      req, userId: admin.uid, userType: "admin", userName: admin.name,
      action: "admin_logout",
    });
  }

  const res = ok(null, "로그아웃되었습니다");
  res.headers.set("Set-Cookie", clearCookie("siren_admin_token"));
  return res;
};

export const config = { path: "/api/admin/logout" };