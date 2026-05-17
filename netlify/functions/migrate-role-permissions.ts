import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, serverError } from "../../lib/response";

export const config = { path: "/api/migrate-role-permissions" };

const SEED = [
  /* ── SIREN 영역 ── */
  { featureKey: "siren_incident",            featureLabel: "사건 신고 관리",    category: "siren", adminAllowed: true,  operatorAllowed: true  },
  { featureKey: "siren_harassment",          featureLabel: "괴롭힘 신고 관리",  category: "siren", adminAllowed: true,  operatorAllowed: true  },
  { featureKey: "siren_legal_consult",       featureLabel: "법률 상담 관리",    category: "siren", adminAllowed: true,  operatorAllowed: false },
  { featureKey: "siren_support_psych",       featureLabel: "심리상담 지원",     category: "siren", adminAllowed: true,  operatorAllowed: false },
  { featureKey: "siren_support_legal",       featureLabel: "법률 지원",         category: "siren", adminAllowed: true,  operatorAllowed: false },
  { featureKey: "siren_support_scholarship", featureLabel: "장학 지원",         category: "siren", adminAllowed: true,  operatorAllowed: false },
  { featureKey: "siren_member",              featureLabel: "회원 관리",         category: "siren", adminAllowed: true,  operatorAllowed: false },
  { featureKey: "siren_donation",            featureLabel: "후원 관리",         category: "siren", adminAllowed: true,  operatorAllowed: false },
  { featureKey: "siren_chat",                featureLabel: "채팅 관리",         category: "siren", adminAllowed: true,  operatorAllowed: true  },
  /* ── 통합 CMS 영역 ── */
  { featureKey: "cms_workspace",             featureLabel: "워크스페이스",      category: "cms",   adminAllowed: true,  operatorAllowed: true  },
  { featureKey: "cms_campaign",              featureLabel: "캠페인",            category: "cms",   adminAllowed: true,  operatorAllowed: true  },
  { featureKey: "cms_board",                 featureLabel: "게시판",            category: "cms",   adminAllowed: true,  operatorAllowed: true  },
  { featureKey: "cms_forms",                 featureLabel: "응답폼·신청폼",     category: "cms",   adminAllowed: true,  operatorAllowed: false },
  { featureKey: "cms_popup",                 featureLabel: "사이트 팝업",       category: "cms",   adminAllowed: true,  operatorAllowed: false },
  { featureKey: "cms_curations",             featureLabel: "큐레이션",          category: "cms",   adminAllowed: true,  operatorAllowed: false },
  { featureKey: "cms_gamification",          featureLabel: "게이미피케이션",    category: "cms",   adminAllowed: true,  operatorAllowed: false },
  { featureKey: "cms_announcements",         featureLabel: "공지사항",          category: "cms",   adminAllowed: true,  operatorAllowed: true  },
  { featureKey: "cms_ai",                    featureLabel: "AI 비서",           category: "cms",   adminAllowed: true,  operatorAllowed: false },
  { featureKey: "cms_role_policy",           featureLabel: "권한 정책",         category: "cms",   adminAllowed: false, operatorAllowed: false },
  { featureKey: "cms_audit_log",             featureLabel: "감사 로그",         category: "cms",   adminAllowed: true,  operatorAllowed: false },
];

export default async (req: Request) => {
  const url = new URL(req.url);

  /* 진단 모드 — 인증 불필요 */
  if (!url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      message: "?run=1 을 추가하면 마이그레이션이 실행됩니다 (어드민 로그인 필요)",
      creates: "role_permissions 테이블 + site_popups.layout_config 컬럼",
      featuresCount: SEED.length,
    }), { headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id               SERIAL PRIMARY KEY,
        feature_key      VARCHAR(60)  NOT NULL UNIQUE,
        feature_label    VARCHAR(100) NOT NULL,
        category         VARCHAR(20)  NOT NULL DEFAULT 'siren',
        admin_allowed    BOOLEAN      NOT NULL DEFAULT true,
        operator_allowed BOOLEAN      NOT NULL DEFAULT false,
        updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);

    /* 팝업 레이아웃 설정 컬럼 추가 (site_popups 테이블) */
    await db.execute(sql`
      ALTER TABLE site_popups ADD COLUMN IF NOT EXISTS layout_config JSONB DEFAULT NULL
    `);

    let inserted = 0;
    for (const f of SEED) {
      const res = await db.execute(sql`
        INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed)
        VALUES (${f.featureKey}, ${f.featureLabel}, ${f.category}, ${f.adminAllowed}, ${f.operatorAllowed})
        ON CONFLICT (feature_key) DO NOTHING
      `);
      inserted += (res as any).rowCount ?? 0;
    }

    return ok({ success: true, total: SEED.length, inserted, popupLayoutColumn: true });
  } catch (err: any) {
    console.error("[migrate-role-permissions]", err);
    return serverError("마이그레이션 실패", err);
  }
};
