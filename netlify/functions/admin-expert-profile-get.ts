/**
 * GET /api/admin-expert-profile-get
 * 전문가 프로필 조회
 *
 * ?all=true  : 모든 전문가(volunteer) 목록 + 프로필 정보
 * ?memberId=N : 특정 회원 프로필
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-expert-profile-get" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const allMode = url.searchParams.get("all") === "true";
  const memberIdParam = url.searchParams.get("memberId");

  let step = "query";
  try {
    if (allMode) {
      // 전문가(volunteer) 전체 목록 + expert_profiles JOIN
      step = "select_all";
      const rows = await db.execute(sql`
        SELECT
          m.id       AS "memberId",
          m.name,
          m.member_subtype AS "memberSubtype",
          m.status,
          ep.id      AS "profileId",
          ep.specialties,
          ep.languages,
          ep.available_days  AS "availableDays",
          ep.available_hours AS "availableHours",
          ep.region_coverage AS "regionCoverage",
          ep.bio,
          ep.avg_rating      AS "avgRating",
          ep.rating_count    AS "ratingCount",
          ep.is_accepting_case AS "isAcceptingCase"
        FROM members m
        LEFT JOIN expert_profiles ep ON ep.member_id = m.id
        WHERE m.type = 'volunteer'
        ORDER BY m.name
      `);

      const profiles = ((rows as any).rows || rows as any[]).map((r: any) => ({
        memberId:       r.memberId,
        name:           r.name,
        memberSubtype:  r.memberSubtype,
        status:         r.status,
        profileId:      r.profileId ?? null,
        specialties:    safeParseJson(r.specialties),
        languages:      safeParseJson(r.languages),
        availableDays:  r.availableDays ?? null,
        availableHours: r.availableHours ?? null,
        regionCoverage: r.regionCoverage ?? null,
        bio:            r.bio ?? null,
        avgRating:      r.avgRating != null ? Number(r.avgRating) : 0,
        ratingCount:    r.ratingCount ?? 0,
        isAcceptingCase: r.isAcceptingCase ?? true,
      }));

      return ok({ profiles });
    }

    if (memberIdParam) {
      const memberId = Number(memberIdParam);
      if (!Number.isFinite(memberId)) return badRequest("유효하지 않은 memberId");

      step = "select_one";
      const rows = await db.execute(sql`
        SELECT
          m.id       AS "memberId",
          m.name,
          m.member_subtype AS "memberSubtype",
          ep.specialties,
          ep.languages,
          ep.available_days  AS "availableDays",
          ep.available_hours AS "availableHours",
          ep.region_coverage AS "regionCoverage",
          ep.bio,
          ep.avg_rating      AS "avgRating",
          ep.rating_count    AS "ratingCount",
          ep.is_accepting_case AS "isAcceptingCase"
        FROM members m
        LEFT JOIN expert_profiles ep ON ep.member_id = m.id
        WHERE m.id = ${memberId} AND m.type = 'volunteer'
        LIMIT 1
      `);

      const r = ((rows as any).rows || rows as any[])[0];
      if (!r) return badRequest("해당 전문가를 찾을 수 없습니다");

      return ok({
        profile: {
          memberId:       r.memberId,
          name:           r.name,
          memberSubtype:  r.memberSubtype,
          specialties:    safeParseJson(r.specialties),
          languages:      safeParseJson(r.languages),
          availableDays:  r.availableDays ?? null,
          availableHours: r.availableHours ?? null,
          regionCoverage: r.regionCoverage ?? null,
          bio:            r.bio ?? null,
          avgRating:      r.avgRating != null ? Number(r.avgRating) : 0,
          ratingCount:    r.ratingCount ?? 0,
          isAcceptingCase: r.isAcceptingCase ?? true,
        },
      });
    }

    return badRequest("all=true 또는 memberId 파라미터가 필요합니다");
  } catch (err: any) {
    return serverError(`전문가 프로필 조회 실패 [${step}]`, err);
  }
};

function safeParseJson(val: any): any[] {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}
