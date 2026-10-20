// lib/potential-donor-events.ts — 잠재 후원자 이벤트별 집계 (2026-10-20)
// 잠재 표 «이벤트별 보기»·수신자 그룹 «잠재 이벤트 참여» 선택지·발송 준비 화면이 공유한다.
import { sql } from "drizzle-orm";
import { db } from "../db";

export interface PotentialEventStat { name: string | null; count: number; linked: number; converted: number; contactable: number }

export async function loadPotentialEvents(): Promise<PotentialEventStat[]> {
  const rs: any = await db.execute(sql`
    SELECT pd.event_name,
           COUNT(*)::int AS n,
           COUNT(pd.linked_member_id)::int AS linked,
           COUNT(*) FILTER (WHERE m.donor_type IN ('regular', 'prospect'))::int AS converted,
           COUNT(*) FILTER (WHERE COALESCE(pd.phone, '') <> '' OR COALESCE(pd.email, '') <> '')::int AS contactable
      FROM potential_donors pd
      LEFT JOIN members m ON m.id = pd.linked_member_id
     GROUP BY pd.event_name
     ORDER BY n DESC, pd.event_name ASC`);
  const rows = (rs?.rows ?? rs ?? []) as any[];
  return rows.map((r) => ({
    name: r.event_name || null, count: Number(r.n) || 0, linked: Number(r.linked) || 0,
    converted: Number(r.converted) || 0, contactable: Number(r.contactable) || 0,
  }));
}
