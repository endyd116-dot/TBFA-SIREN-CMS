// netlify/functions/cron-kakao-template-status.ts
// 카카오 알림톡 템플릿 검수 상태 자동 추적 (매시간)
// - kakao_alimtalk_templates 중 검수 진행 상태(registered·inspecting·pending)를 솔라피에서 조회
// - APPROVED → 'approved'(approved_at·사유 초기화) / REJECTED → 'rejected'(반려사유 저장) / INSPECTING → 'inspecting'
// - 운영자가 CMS에서 등록·검수요청한 템플릿이 승인되면 사람 개입 없이 '사용가능'으로 전환.

import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { solapiGetTemplate } from "../../lib/solapi-client";

export const config: Config = {
  schedule: "0 * * * *", // 매시 정각
};

/* 솔라피 템플릿 status → 내부 status */
function mapStatus(solapiStatus: string): string {
  const s = String(solapiStatus || "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (s === "INSPECTING") return "inspecting";
  if (s === "PENDING") return "registered";
  return "registered";
}

/* comments 배열 등에서 반려/심사 사유 추출 */
function extractReason(data: any): string {
  const comments = data?.comments;
  if (Array.isArray(comments) && comments.length) {
    const last = comments[comments.length - 1];
    return String(last?.content || last?.comment || last?.message || "").slice(0, 500);
  }
  return String(data?.comment || data?.reason || "").slice(0, 500);
}

export default async () => {
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT id, solapi_template_id AS "tid", status
        FROM kakao_alimtalk_templates
       WHERE solapi_template_id IS NOT NULL
         AND status IN ('registered','inspecting','pending')
       ORDER BY id ASC
       LIMIT 100
    `)).catch(() => null);
    const rows = r ? (r?.rows ?? r ?? []) : [];

    let checked = 0, updated = 0;
    for (const row of rows) {
      checked++;
      const res = await solapiGetTemplate(String(row.tid));
      if (!res.ok) {
        console.warn(`[kakao-tpl-status] 조회 실패 id=${row.id} tid=${row.tid}: ${res.error}`);
        continue;
      }
      const solapiStatus = String(res.data?.status || "");
      const next = mapStatus(solapiStatus);
      if (next === row.status) continue;

      const reason = next === "rejected" ? extractReason(res.data) : "";
      await db.execute(sql`
        UPDATE kakao_alimtalk_templates
           SET status = ${next},
               solapi_status = ${solapiStatus},
               reject_reason = ${next === "rejected" ? reason : null},
               approved_at = ${next === "approved" ? sql`NOW()` : sql`approved_at`},
               updated_at = NOW()
         WHERE id = ${Number(row.id)}
      `);
      updated++;
      console.log(`[kakao-tpl-status] id=${row.id} ${row.status} → ${next} (solapi=${solapiStatus})`);
    }

    return new Response(JSON.stringify({ ok: true, checked, updated }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[kakao-tpl-status] 오류", err?.message);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err).slice(0, 300) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
