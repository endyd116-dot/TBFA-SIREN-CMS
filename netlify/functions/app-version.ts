// netlify/functions/app-version.ts
// [업데이트 소식 A안] 배포 버전 조회 — 열린 탭의 '새 버전 새로고침 안내' 감지용
// 인증 불필요(버전 문자열 외 정보 없음). DB 미접근(비용 0).
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { APP_VERSION } from "../../lib/release-drafts";

export const config = { path: "/api/app-version" };

export default async (_req: Request, _ctx: Context) => {
  return new Response(jsonKST({ ok: true, version: APP_VERSION }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
