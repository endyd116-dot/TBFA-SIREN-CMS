// lib/client-ip.ts
// ★ 2026-08-28 — 접속 기기를 되돌릴 수 없게 섞은 값
//
// 누가 접속했는지 알아보려는 값이 아니다. '같은 기기가 방금 또 눌렀는지'만
// 판단하기 위한 것이고, 원래 주소로 되돌릴 수 없다.
// 헌화(memorial-offering)와 추모 한마디(memorial-messages)가 같은 방식을 써야
// 도배 판정이 어긋나지 않으므로 여기 한 곳에 둔다.

import { createHash } from "node:crypto";

export function clientIpHash(req: Request): string {
  const ip =
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  const salt = process.env.JWT_SECRET || "memorial-salt";
  return createHash("sha256").update(ip + "|" + salt).digest("hex").slice(0, 64);
}
