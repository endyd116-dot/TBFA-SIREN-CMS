/**
 * DEPRECATED (Q3-001 fix) — 소유자 검증이 전혀 없던 무검증 파일 공유 엔드포인트.
 * 누구나 남의 파일/폴더를 임의 멤버에게 공유·해제·열람할 수 있는 IDOR였다.
 * 모든 클라이언트는 소유자/super_admin 검증이 있는 `/api/admin-workspace-file-share`로 일원화됨
 * (public/js/workspace-files.js). 이 경로는 더 이상 어떤 쓰기도 수행하지 않고 410을 반환한다.
 */
import type { Context } from "@netlify/functions";

export default async (_req: Request, _ctx: Context) => {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "이 엔드포인트는 폐기되었습니다. /api/admin-workspace-file-share 를 사용하세요.",
      step: "deprecated",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/api/workspace-file-share" };
