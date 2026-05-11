/**
 * GET /api/migrate-phase21-r2r3
 *
 * Phase 21 R2+R3 통합 마이그레이션:
 *   - 신규 테이블 3개 (workspace_task_transfers / workspace_task_watchers / service_rnr)
 *   - members 부재 컬럼 4개
 *   - workspace_notifications.category 1개
 *   - 4종 서비스 담당자·카드 연결 컬럼 (incident/harassment/legal/support)
 *   - incident_reports.category (R&R 매핑용)
 *   - service_rnr Fallback 시드 1건
 *
 * GET ?run=1 : requireAdmin 후 실행
 * GET (기본) : 진단 모드 (인증 불필요)
 *
 * 호출 성공 후 즉시 파일 삭제 (1회용 보안 원칙)
 *
 * ※ 현실 적응: 본 프로젝트는 별도 admin_users 테이블 없이 members가 운영자 역할을 겸함.
 *    설계서의 adminUsers 참조는 모두 members 참조로 변환.
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase21-r2r3" };

function json(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function checkTable(name: string): Promise<boolean> {
  const res: any = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = ${name}
    ) AS exists
  `);
  const row = Array.isArray(res) ? res[0] : (res as any).rows?.[0];
  return Boolean(row?.exists);
}

async function checkColumn(tableName: string, columnName: string): Promise<boolean> {
  const res: any = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${tableName} AND column_name = ${columnName}
    ) AS exists
  `);
  const row = Array.isArray(res) ? res[0] : (res as any).rows?.[0];
  return Boolean(row?.exists);
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ─────────── 진단 모드 ─────────── */
  if (!run) {
    try {
      const diag = {
        tables: {
          workspace_task_transfers: await checkTable("workspace_task_transfers"),
          workspace_task_watchers:  await checkTable("workspace_task_watchers"),
          service_rnr:              await checkTable("service_rnr"),
        },
        members_columns: {
          out_of_office:       await checkColumn("members", "out_of_office"),
          out_of_office_start: await checkColumn("members", "out_of_office_start"),
          out_of_office_end:   await checkColumn("members", "out_of_office_end"),
          out_of_office_note:  await checkColumn("members", "out_of_office_note"),
        },
        workspace_notifications_columns: {
          category: await checkColumn("workspace_notifications", "category"),
        },
        incident_reports_columns: {
          assigned_to:       await checkColumn("incident_reports", "assigned_to"),
          workspace_task_id: await checkColumn("incident_reports", "workspace_task_id"),
          category:          await checkColumn("incident_reports", "category"),
        },
        harassment_reports_columns: {
          assigned_to:       await checkColumn("harassment_reports", "assigned_to"),
          workspace_task_id: await checkColumn("harassment_reports", "workspace_task_id"),
        },
        legal_consultations_columns: {
          assigned_to:       await checkColumn("legal_consultations", "assigned_to"),
          workspace_task_id: await checkColumn("legal_consultations", "workspace_task_id"),
        },
        support_requests_columns: {
          assigned_admin_id: await checkColumn("support_requests", "assigned_admin_id"),
          workspace_task_id: await checkColumn("support_requests", "workspace_task_id"),
        },
      };
      const allReady =
        Object.values(diag.tables).every(Boolean) &&
        Object.values(diag.members_columns).every(Boolean) &&
        Object.values(diag.workspace_notifications_columns).every(Boolean) &&
        Object.values(diag.incident_reports_columns).every(Boolean) &&
        Object.values(diag.harassment_reports_columns).every(Boolean) &&
        Object.values(diag.legal_consultations_columns).every(Boolean) &&
        Object.values(diag.support_requests_columns).every(Boolean);
      return json({
        ok: true,
        mode: "diagnosis",
        ready: allReady,
        message: allReady
          ? "모든 신규 객체 이미 존재 — 마이그레이션 불필요"
          : "일부 객체 미존재 — ?run=1 로 실행하세요 (관리자 로그인 필요)",
        detail: diag,
      });
    } catch (err: any) {
      return json({
        ok: false,
        step: "diagnosis",
        error: "진단 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }, 500);
    }
  }

  /* ─────────── 실행 모드 — 관리자 인증 ─────────── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  let step = "init";
  try {
    /* 1) workspace_task_transfers */
    step = "create_workspace_task_transfers";
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_task_transfers (
        id             BIGSERIAL PRIMARY KEY,
        task_id        INTEGER NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
        from_uid       INTEGER REFERENCES members(id) ON DELETE SET NULL,
        to_uid         INTEGER REFERENCES members(id) ON DELETE SET NULL,
        reason         TEXT,
        transferred_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        transferred_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_task_transfers_task_idx ON workspace_task_transfers(task_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_task_transfers_from_idx ON workspace_task_transfers(from_uid)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_task_transfers_to_idx   ON workspace_task_transfers(to_uid)`);

    /* 2) workspace_task_watchers */
    step = "create_workspace_task_watchers";
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_task_watchers (
        id          BIGSERIAL PRIMARY KEY,
        task_id     INTEGER NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
        watcher_uid INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        added_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS ws_task_watchers_uniq        ON workspace_task_watchers(task_id, watcher_uid)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_task_watchers_task_idx           ON workspace_task_watchers(task_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_task_watchers_watcher_idx        ON workspace_task_watchers(watcher_uid)`);

    /* 3) service_rnr */
    step = "create_service_rnr";
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS service_rnr (
        id               BIGSERIAL PRIMARY KEY,
        service_kind     VARCHAR(20) NOT NULL,
        service_category VARCHAR(50),
        primary_uid      INTEGER REFERENCES members(id) ON DELETE SET NULL,
        backup_uid       INTEGER REFERENCES members(id) ON DELETE SET NULL,
        is_fallback      BOOLEAN NOT NULL DEFAULT FALSE,
        updated_by       INTEGER REFERENCES members(id) ON DELETE SET NULL,
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    /* UNIQUE(service_kind, service_category) — NULL 인 service_category 도 동일 키로 취급되려면 별도 처리 필요하나
       service_kind="_global" + service_category="_fallback" 형태로 항상 값 보장 → 일반 UNIQUE 로 충분 */
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS service_rnr_uniq        ON service_rnr(service_kind, service_category)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS service_rnr_kind_idx           ON service_rnr(service_kind)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS service_rnr_fallback_idx       ON service_rnr(is_fallback)`);

    /* 4) members 부재 컬럼 */
    step = "alter_members_outofoffice";
    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS out_of_office       BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS out_of_office_start DATE`);
    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS out_of_office_end   DATE`);
    await db.execute(sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS out_of_office_note  TEXT`);

    /* 5) workspace_notifications.category */
    step = "alter_workspace_notifications";
    await db.execute(sql`ALTER TABLE workspace_notifications ADD COLUMN IF NOT EXISTS category VARCHAR(20)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_notifs_category_idx ON workspace_notifications(category)`);

    /* 6) 4종 서비스 컬럼 */
    step = "alter_incident_reports";
    await db.execute(sql`ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS assigned_to       INTEGER REFERENCES members(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS category          VARCHAR(30)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS incident_reports_assigned_idx ON incident_reports(assigned_to)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS incident_reports_workspace_task_idx ON incident_reports(workspace_task_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS incident_reports_category_idx ON incident_reports(category)`);

    step = "alter_harassment_reports";
    await db.execute(sql`ALTER TABLE harassment_reports ADD COLUMN IF NOT EXISTS assigned_to       INTEGER REFERENCES members(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE harassment_reports ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS harassment_reports_assigned_idx ON harassment_reports(assigned_to)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS harassment_reports_workspace_task_idx ON harassment_reports(workspace_task_id)`);

    step = "alter_legal_consultations";
    await db.execute(sql`ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS assigned_to       INTEGER REFERENCES members(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS legal_consultations_assigned_idx ON legal_consultations(assigned_to)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS legal_consultations_workspace_task_idx ON legal_consultations(workspace_task_id)`);

    step = "alter_support_requests";
    await db.execute(sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS assigned_admin_id INTEGER REFERENCES members(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS workspace_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS support_requests_assigned_admin_idx ON support_requests(assigned_admin_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS support_requests_workspace_task_idx ON support_requests(workspace_task_id)`);

    /* 7) Fallback 슬롯 시드 (UID 없이) */
    step = "seed_service_rnr_fallback";
    await db.execute(sql`
      INSERT INTO service_rnr (service_kind, service_category, is_fallback, updated_at)
      VALUES ('_global', '_fallback', TRUE, NOW())
      ON CONFLICT DO NOTHING
    `);

    return json({
      ok: true,
      message: "Phase 21 R2+R3 마이그레이션 완료",
      applied: {
        tables: ["workspace_task_transfers", "workspace_task_watchers", "service_rnr"],
        members_columns: ["out_of_office", "out_of_office_start", "out_of_office_end", "out_of_office_note"],
        workspace_notifications_columns: ["category"],
        incident_reports_columns: ["assigned_to", "workspace_task_id", "category"],
        harassment_reports_columns: ["assigned_to", "workspace_task_id"],
        legal_consultations_columns: ["assigned_to", "workspace_task_id"],
        support_requests_columns: ["assigned_admin_id", "workspace_task_id"],
        seeded: ["service_rnr Fallback row (uid 미지정)"],
      },
      next: "어드민이 운영자 관리 R&R 탭에서 Fallback 담당자 + 카테고리별 1차/백업 매핑 지정 필요",
    });
  } catch (err: any) {
    return json({
      ok: false,
      error: "마이그레이션 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, 500);
  }
};
