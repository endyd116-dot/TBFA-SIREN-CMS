import type { Context } from "@netlify/functions";
import { createHash } from "crypto";
import { db } from "../../db";
import { memorialOfferings } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { sql } from "drizzle-orm";

export const config = { path: "/api/memorial-offering" };

const THROTTLE_SECONDS = 10;  // 같은 디바이스·대상 중복 무시 창

function clientIpHash(req: Request): string {
  const ip =
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  const salt = process.env.JWT_SECRET || "memorial-salt";
  return createHash("sha256").update(ip + "|" + salt).digest("hex").slice(0, 64);
}

/* 대상 범위(teacherId 또는 통합)별 촛불·국화 카운트 */
async function scopedCounts(teacherId: number | null): Promise<{ candles: number; flowers: number; total: number }> {
  const out = { candles: 0, flowers: 0, total: 0 };
  try {
    const q = teacherId
      ? sql`SELECT offering_type, COUNT(*)::int AS n FROM memorial_offerings WHERE teacher_id = ${teacherId} GROUP BY offering_type`
      : sql`SELECT offering_type, COUNT(*)::int AS n FROM memorial_offerings WHERE teacher_id IS NULL GROUP BY offering_type`;
    const r: any = await db.execute(q);
    for (const row of (r?.rows ?? r ?? [])) {
      const n = Number(row.n);
      if (row.offering_type === "candle") out.candles = n;
      else if (row.offering_type === "flower") out.flowers = n;
    }
    out.total = out.candles + out.flowers;
  } catch (err) {
    console.warn("[memorial-offering] 카운트 실패", err);
  }
  return out;
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method.toUpperCase() !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드입니다" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const teacherId: number | null = body.teacherId ? Number(body.teacherId) : null;
  const type = body.type === "flower" ? "flower" : "candle";
  const nickname = (body.nickname || "").toString().trim().slice(0, 40) || null;

  /* 로그인 회원이면 memberId 부착 (비회원도 허용) */
  const user = authenticateUser(req);
  const memberId = user?.uid ?? null;
  const ipHash = clientIpHash(req);

  try {
    /* 과도 방지 — 같은 디바이스·대상 최근 N초 내 중복은 카운트만 반환 */
    let throttled = false;
    try {
      /* R41 Q2-015: 로그인 회원은 (memberId,대상) 기준, 비회원만 IP 기준으로 중복 판정.
         — 공유망(학교·회사)에서 서로 다른 회원의 헌화가 같은 IP로 과차단되던 문제 해소 */
      const idCond = memberId != null
        ? sql`member_id = ${memberId}`
        : sql`member_id IS NULL AND ip_hash = ${ipHash}`;
      const scopeCond = teacherId ? sql`teacher_id = ${teacherId}` : sql`teacher_id IS NULL`;
      const dup: any = await db.execute(
        sql`SELECT 1 FROM memorial_offerings
             WHERE ${idCond} AND ${scopeCond}
               AND created_at > NOW() - (${THROTTLE_SECONDS} * INTERVAL '1 second') LIMIT 1`
      );
      throttled = (dup?.rows ?? dup ?? []).length > 0;
    } catch (err) {
      console.warn("[memorial-offering] 과도방지 조회 실패", err);
    }

    if (!throttled) {
      const insertData: any = {
        teacherId: teacherId ?? undefined,
        memberId: memberId ?? undefined,
        nickname: nickname ?? undefined,
        offeringType: type,
        ipHash,
      };
      await db.insert(memorialOfferings).values(insertData);
    }

    const counts = await scopedCounts(teacherId);
    return new Response(JSON.stringify({ ok: true, data: counts }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "헌화 처리 실패",
      step: "insert_offering",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
