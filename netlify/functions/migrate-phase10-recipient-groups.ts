// netlify/functions/migrate-phase10-recipient-groups.ts
// Phase 10 R2 — recipient_groups 테이블 + 인덱스 + 시드 5종 (1회용)
//
// 실행: 어드민 로그인 후 주소창
//   https://tbfa-siren-cms.netlify.app/api/migrate-phase10-recipient-groups?run=1
// 진단: ?run=1 없이 접속 (인증 불필요) — 테이블 존재·시드 카운트·member_grades.code 분포
// 멱등: IF NOT EXISTS + ON CONFLICT DO NOTHING (이름 unique는 아니라 시드만 단순 INSERT)
//   → 중복 방지 위해 시드는 NOT EXISTS 조건으로 1회만 INSERT
// 호출 성공 후 즉시 파일 삭제 + schema 정의 활성화 (메인 채팅이 처리)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase10-recipient-groups" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 ── */
  if (!run) {
    try {
      const tableExistsRes: any = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'recipient_groups'
        ) AS exists
      `);
      const tableExists = ((tableExistsRes?.rows ?? tableExistsRes)[0] ?? {}).exists === true;

      let groupCount = 0;
      let groups: any[] = [];
      if (tableExists) {
        const cntRes: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM recipient_groups`);
        groupCount = ((cntRes?.rows ?? cntRes)[0] ?? {}).n ?? 0;

        const listRes: any = await db.execute(sql`
          SELECT id, name, is_active, created_at FROM recipient_groups ORDER BY id ASC LIMIT 20
        `);
        groups = listRes?.rows ?? listRes ?? [];
      }

      const gradeCodesRes: any = await db.execute(sql`
        SELECT code, name_ko FROM member_grades ORDER BY sort_order ASC LIMIT 20
      `);
      const gradeCodes = gradeCodesRes?.rows ?? gradeCodesRes ?? [];

      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnostic",
          recipient_groups_table_exists: tableExists,
          recipient_groups_count: groupCount,
          recipient_groups_sample: groups,
          member_grades_codes: gradeCodes,
          note: "?run=1 + 어드민 로그인으로 실제 실행. gradeCode 시드는 운영 DB 실제 code와 비교 후 자동 보정.",
        }, null, 2),
        { status: 200, headers: JSON_HEADER },
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          ok: false, error: "진단 실패",
          detail: String(err?.message || err).slice(0, 500),
          stack: String(err?.stack || "").slice(0, 1000),
        }),
        { status: 500, headers: JSON_HEADER },
      );
    }
  }

  /* ── 실행 모드 — 어드민 인증 ── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    /* 1) 테이블 + 인덱스 (멱등) */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipient_groups (
        id           BIGSERIAL PRIMARY KEY,
        name         VARCHAR(100) NOT NULL,
        description  TEXT,
        criteria     JSONB NOT NULL,
        is_active    BOOLEAN NOT NULL DEFAULT true,
        created_by   INTEGER REFERENCES members(id) ON DELETE SET NULL,
        updated_by   INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS recipient_groups_active_idx ON recipient_groups(is_active)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS recipient_groups_name_idx   ON recipient_groups(name)`);

    /* 2) member_grades.code 점검 — 시드 4번(gradeCode honor/lifetime) 보정 판정 */
    const gradeRes: any = await db.execute(sql`SELECT code FROM member_grades`);
    const existingCodes: string[] = (gradeRes?.rows ?? gradeRes ?? []).map((r: any) => r.code);
    const seedGradeCodes = ["honor", "lifetime"].filter((c) => existingCodes.includes(c));
    const skipGradeSeed = seedGradeCodes.length === 0;

    /* 3) 시드 — 같은 이름이 이미 있으면 스킵 (멱등) */
    const seeds: Array<{ name: string; description: string; criteria: any }> = [
      {
        name: "전체 활성 회원",
        description: "회원 상태가 활성인 모든 회원",
        criteria: { type: "filter", logic: "and", filters: [{ field: "status", op: "eq", value: "active" }] },
      },
      {
        name: "정기 후원자",
        description: "활성 정기 후원이 있는 회원",
        criteria: { type: "filter", logic: "and", filters: [{ field: "hasActiveRegularDonation", op: "eq", value: true }] },
      },
      {
        name: "일시 후원자 (최근 90일)",
        description: "최근 90일 안에 일시 후원 이력이 있는 회원",
        criteria: { type: "filter", logic: "and", filters: [{ field: "hadOneTimeDonationDays", op: "lte", value: 90 }] },
      },
    ];

    if (!skipGradeSeed) {
      seeds.push({
        name: "회원 등급 — 명예회원 이상",
        description: "회원 등급이 명예 이상",
        criteria: {
          type: "filter",
          logic: "and",
          filters: [{ field: "gradeCode", op: "in", values: seedGradeCodes }],
        },
      });
    }

    seeds.push({
      name: "운영자",
      description: "회원 유형이 admin",
      criteria: { type: "filter", logic: "and", filters: [{ field: "type", op: "in", values: ["admin"] }] },
    });

    let inserted = 0;
    let skipped = 0;
    for (const s of seeds) {
      const dupRes: any = await db.execute(sql`
        SELECT 1 FROM recipient_groups WHERE name = ${s.name} LIMIT 1
      `);
      const dupRows = dupRes?.rows ?? dupRes ?? [];
      if (Array.isArray(dupRows) && dupRows.length > 0) {
        skipped++;
        continue;
      }
      await db.execute(sql`
        INSERT INTO recipient_groups (name, description, criteria, created_by)
        VALUES (${s.name}, ${s.description}, ${JSON.stringify(s.criteria)}::jsonb, NULL)
      `);
      inserted++;
    }

    /* 4) 결과 */
    const finalRes: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM recipient_groups`);
    const finalCount = ((finalRes?.rows ?? finalRes)[0] ?? {}).n ?? 0;

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "executed",
        table_created: true,
        seeds_inserted: inserted,
        seeds_skipped: skipped,
        seed_grade_codes_used: seedGradeCodes,
        seed_grade_codes_skipped: skipGradeSeed,
        recipient_groups_total: finalCount,
        note: "schema.ts 정의 활성화 + 본 마이그레이션 파일 삭제 후 푸시 필요 (메인 채팅 처리)",
      }, null, 2),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
