/**
 * POST /api/admin-expert-profile-upsert
 * 전문가 프로필 등록·수정 (member_id UNIQUE 기준 upsert)
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-expert-profile-upsert" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  let step = "parse";
  try {
    const body = await parseJson(req);

    step = "validate";
    const memberId = Number(body?.memberId);
    if (!memberId || !Number.isFinite(memberId)) return badRequest("memberId가 필요합니다");

    step = "check_member";
    const [member] = await db
      .select({ id: members.id, type: members.type })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!member) return badRequest("존재하지 않는 회원입니다");
    if (member.type !== "volunteer") return badRequest("전문가(volunteer) 유형 회원만 프로필 등록이 가능합니다");

    // specialties, languages 배열 → JSON 문자열 변환
    const specialties = body.specialties != null
      ? JSON.stringify(Array.isArray(body.specialties) ? body.specialties : [body.specialties])
      : null;
    const languages = body.languages != null
      ? JSON.stringify(Array.isArray(body.languages) ? body.languages : [body.languages])
      : null;

    step = "upsert";
    // ON CONFLICT upsert (member_id UNIQUE)
    await db.execute(sql`
      INSERT INTO expert_profiles
        (member_id, specialties, languages, available_days, available_hours, region_coverage, bio, is_accepting_case, updated_at)
      VALUES
        (${memberId},
         ${specialties},
         ${languages},
         ${body.availableDays ?? null},
         ${body.availableHours ?? null},
         ${body.regionCoverage ?? null},
         ${body.bio ?? null},
         ${body.isAcceptingCase !== false},
         NOW())
      ON CONFLICT (member_id) DO UPDATE SET
        specialties    = EXCLUDED.specialties,
        languages      = EXCLUDED.languages,
        available_days = EXCLUDED.available_days,
        available_hours = EXCLUDED.available_hours,
        region_coverage = EXCLUDED.region_coverage,
        bio            = EXCLUDED.bio,
        is_accepting_case = EXCLUDED.is_accepting_case,
        updated_at     = NOW()
    `);

    return ok({}, "프로필이 저장되었습니다");
  } catch (err: any) {
    return serverError(`프로필 저장 실패 [${step}]`, err);
  }
};
