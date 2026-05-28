// netlify/functions/migrate-seo-init.ts
// R42 SEO 1회용 마이그레이션 — 멱등.
//
// 1) role_permissions에 'seo_edit' featureKey INSERT (멱등)
// 2) site_settings(scope='seo')에 org:* / default:* 기본값 시드 (멱등)
//
// 사용:
//   GET  /api/migrate-seo-init           — 진단(인증 불필요)
//   GET  /api/migrate-seo-init?run=1     — 실행(어드민 세션 필요)
//
// 호출 성공 후 즉시 파일 삭제 + 커밋.

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-seo-init" };

function jsonOk(body: any) {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonError(status: number, error: string, detail?: any) {
  return new Response(JSON.stringify({ ok: false, error, detail }, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return jsonOk({
      ok: true,
      mode: "diagnostic",
      hint: "실행하려면 ?run=1 을 붙이세요 (어드민 세션 필요).",
      will_do: [
        "role_permissions: featureKey='seo_edit' INSERT (멱등)",
        "site_settings(seo): org:name/legal_name/registration_no/representative/address/phone/email/url, default:site_name/locale/title_suffix 시드 (멱등)",
      ],
    });
  }

  const g = await requireAdmin(req);
  if (guardFailed(g)) return g.res;

  const summary: any = { rolePermission: null, seeded: {}, warnings: [] };

  /* 1) role_permissions: seo_edit */
  try {
    await db.execute(sql`
      INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed)
      VALUES ('seo_edit', 'SEO 메타·구조화 데이터 편집', 'content', true, false)
      ON CONFLICT (feature_key) DO NOTHING
    `);
    summary.rolePermission = "ensured (seo_edit)";
  } catch (e: any) {
    summary.warnings.push(`role_permissions seed 실패: ${e?.message || e}`);
  }

  /* 2) site_settings(scope='seo') 기본값 시드 */
  const seeds: Array<{ key: string; value: string; description: string }> = [
    { key: "org:name",            value: process.env.ORG_NAME || "교사유가족협의회",
      description: "단체명 (구조화 데이터)" },
    { key: "org:legal_name",      value: process.env.ORG_NAME || "(사)교사유가족협의회",
      description: "단체 법인명" },
    { key: "org:registration_no", value: process.env.ORG_REGISTRATION_NO || "1188271215",
      description: "사업자등록번호" },
    { key: "org:representative",  value: process.env.ORG_REPRESENTATIVE || "",
      description: "대표자명" },
    { key: "org:address",         value: process.env.ORG_ADDRESS || "",
      description: "단체 주소" },
    { key: "org:phone",           value: process.env.ORG_PHONE || "",
      description: "단체 대표 연락처" },
    { key: "org:email",           value: process.env.EMAIL_FROM || "",
      description: "단체 이메일" },
    { key: "org:url",             value: process.env.SITE_URL || "https://tbfa.co.kr",
      description: "단체 공식 URL" },
    { key: "default:site_name",   value: "SIREN | 교사유가족협의회",
      description: "사이트 이름 (og:site_name)" },
    { key: "default:locale",      value: "ko_KR",
      description: "사이트 로케일 (og:locale)" },
    { key: "default:title_suffix", value: " | SIREN",
      description: "제목 접미사 (페이지 제목 끝에 자동 추가)" },
  ];

  for (const s of seeds) {
    try {
      const res: any = await db.execute(sql`
        INSERT INTO site_settings
          (scope, key, value_type, value_text, description, is_active, updated_at)
        VALUES
          ('seo', ${s.key}, 'text', ${s.value}, ${s.description}, true, NOW())
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      const rows = Array.isArray(res) ? res : (res?.rows || []);
      summary.seeded[s.key] = rows.length > 0 ? "inserted" : "exists";
    } catch (e: any) {
      // unique constraint 명시적으로 없으면 위 ON CONFLICT DO NOTHING이 실패할 수 있음.
      // (scope,key) UNIQUE가 없을 가능성 → 존재 체크 후 INSERT로 fallback.
      try {
        const existing: any = await db.execute(sql`
          SELECT id FROM site_settings WHERE scope='seo' AND key=${s.key} LIMIT 1
        `);
        const erows = Array.isArray(existing) ? existing : (existing?.rows || []);
        if (erows.length > 0) {
          summary.seeded[s.key] = "exists";
        } else {
          await db.execute(sql`
            INSERT INTO site_settings (scope, key, value_type, value_text, description, is_active, updated_at)
            VALUES ('seo', ${s.key}, 'text', ${s.value}, ${s.description}, true, NOW())
          `);
          summary.seeded[s.key] = "inserted(fallback)";
        }
      } catch (e2: any) {
        summary.warnings.push(`seed ${s.key} 실패: ${e2?.message || e2}`);
        summary.seeded[s.key] = "error";
      }
    }
  }

  return jsonOk({ ok: true, mode: "executed", summary });
};
