/**
 * /api/admin/session — 관리자 세션 만료시각 조회 + 연장(재발급)
 *
 * GET  : 현재 세션 만료시각 반환 { ok, expiresAt(ISO), expiresInSec }
 *        (httpOnly 쿠키라 클라이언트가 직접 못 읽으므로 서버가 토큰 exp를 알려줌 — 우상단 타이머용)
 * POST : 동일 사용자로 새 토큰 재발급(만료시각 갱신) + 쿠키 갱신 → { ok, expiresAt, expiresInSec }
 *        (5분 전 연장 팝업 / 타이머 클릭 시 호출. 횟수 제한 없음·세션 쿠키라 브라우저 종료 시 종료 유지)
 */
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { signAdminToken, verifyAdminToken, buildCookie } from "../../lib/auth";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin/session" };

function expFields(token: string) {
  const payload: any = verifyAdminToken(token);
  const expSec = Number(payload?.exp) || 0;          // JWT exp(초)
  const expiresAt = expSec ? new Date(expSec * 1000).toISOString() : null;
  const expiresInSec = expSec ? Math.max(0, expSec - Math.floor(Date.now() / 1000)) : 0;
  return { expiresAt, expiresInSec };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  try {
    const remember = (admin as any)?.remember === true;

    /* GET — 현재 만료시각만 반환(연장 안 함). remember 여부도 전달(클라 타이머가 무활동 해제 판단) */
    if (req.method === "GET") {
      const expSec = Number((admin as any)?.exp) || 0;
      const expiresAt = expSec ? new Date(expSec * 1000).toISOString() : null;
      const expiresInSec = expSec ? Math.max(0, expSec - Math.floor(Date.now() / 1000)) : 0;
      return ok({ expiresAt, expiresInSec, remember });
    }

    /* POST — 세션 연장(동일 사용자로 새 토큰 재발급)
       · remember: 로그인 후 24시간 '상한'을 유지 → 남은 시간만큼만 재발급(무한 슬라이딩 방지) + 영속 쿠키
       · 미remember: 기존대로 2시간 재발급 + 세션 쿠키 */
    let expiresIn: string | undefined = "6h"; // 미remember 기본 6시간(2026-07-09 Swain — 2h→6h)
    let cookieMaxAge: number | null = null;
    if (remember) {
      const expSec = Number((admin as any)?.exp) || 0;
      const remainSec = Math.max(60, expSec - Math.floor(Date.now() / 1000)); // 최소 60초
      expiresIn = `${remainSec}s`;
      cookieMaxAge = remainSec;
    }
    const token = signAdminToken({
      uid: (admin as any).uid ?? member.id,
      email: member.email,
      role: member.role ?? (admin as any).role ?? "operator",
      name: member.name,
      remember,
    }, expiresIn);
    const cookie = buildCookie("siren_admin_token", token, { maxAge: cookieMaxAge });
    const res = ok({ ...expFields(token), extended: true, remember }, "세션이 연장되었습니다.");
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err) {
    console.error("[admin-session]", err);
    return serverError("세션 처리 중 오류", err);
  }
};
