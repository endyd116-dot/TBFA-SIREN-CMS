/**
 * SIREN — 공용 API 응답 헬퍼
 * 모든 Netlify Function이 이 헬퍼를 통해 표준화된 JSON 응답을 반환합니다.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  ...CORS_HEADERS,
};

/* =========================================================
   성공 응답
   ========================================================= */
export function ok(data: any = null, message?: string) {
  return new Response(
    JSON.stringify({ ok: true, message: message ?? null, data }),
    { status: 200, headers: JSON_HEADERS }
  );
}

export function created(data: any = null, message?: string) {
  return new Response(
    JSON.stringify({ ok: true, message: message ?? "생성되었습니다", data }),
    { status: 201, headers: JSON_HEADERS }
  );
}

/* =========================================================
   에러 응답
   ========================================================= */
export function badRequest(message = "잘못된 요청입니다", detail?: any) {
  return new Response(
    JSON.stringify({ ok: false, error: message, detail }),
    { status: 400, headers: JSON_HEADERS }
  );
}

export function unauthorized(message = "인증이 필요합니다") {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status: 401, headers: JSON_HEADERS }
  );
}

export function forbidden(message = "권한이 없습니다") {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status: 403, headers: JSON_HEADERS }
  );
}

export function notFound(message = "찾을 수 없습니다") {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status: 404, headers: JSON_HEADERS }
  );
}

export function methodNotAllowed(message = "허용되지 않은 메서드입니다") {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status: 405, headers: JSON_HEADERS }
  );
}

export function tooManyRequests(message = "요청이 너무 많습니다", retryAfter?: number) {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status: 429, headers }
  );
}

export function serverError(message = "서버 오류가 발생했습니다", err?: any) {
  console.error("[ServerError]", err);
  return new Response(
    JSON.stringify({
      ok: false,
      error: message,
      detail: process.env.NODE_ENV === "development" ? String(err) : undefined,
    }),
    { status: 500, headers: JSON_HEADERS }
  );
}

/* =========================================================
   CORS Preflight (OPTIONS)
   ========================================================= */
export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/* =========================================================
   요청 파싱 헬퍼
   ========================================================= */
export async function parseJson<T = any>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export function getUserAgent(req: Request): string {
  return req.headers.get("user-agent")?.slice(0, 500) || "unknown";
}