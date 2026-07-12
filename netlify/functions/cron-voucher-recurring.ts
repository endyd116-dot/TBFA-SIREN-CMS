/**
 * Phase 22-D-R3 §4.2 — 반복 전표 자동 생성 cron
 *
 * 매일 KST 새벽 04:30 (UTC 19:30) 실행
 *
 * 동작:
 *   1. 오늘(KST) 날짜 = recurring_day 인 템플릿 조회 (is_template=true, recurring_active=true)
 *      · recurring_day=0 → 말일 (오늘이 이번 달 말일이면 매칭)
 *   2. 각 템플릿 → 이번 달 draft 전표 자동 생성 (필드 복사, voucher_number 신규 발번)
 *   3. 중복 방지: 같은 템플릿·같은 월 이미 생성됐으면 스킵
 *      · 마커: description 끝에 '[auto:{templateId}:{YYYYMM}]'
 *   4. 조용히 draft만 생성 — 알림 없음 (Swain 결정 §0-4)
 *
 * fire-and-forget — throw 안 함, 실패해도 다음 템플릿 진행.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { nextVoucherNumber } from "../../lib/voucher-number";

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  console.info("[cron-voucher-recurring] 시작", new Date().toISOString());

  // KST 오늘 날짜
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kY = kstNow.getUTCFullYear();
  const kM = kstNow.getUTCMonth() + 1;          // 1~12
  const kD = kstNow.getUTCDate();               // 1~31
  const yyyymm = `${kY}${String(kM).padStart(2, "0")}`;
  // 이번 달 말일
  const lastDayOfMonth = new Date(Date.UTC(kY, kM, 0)).getUTCDate();
  const isLastDay = kD === lastDayOfMonth;

  let created = 0, skipped = 0, failed = 0;
  const results: Array<{ templateId: number; status: string; voucherNumber?: string; reason?: string }> = [];

  try {
    // 1. 오늘 도래 템플릿 조회 (recurring_day = 오늘  또는  recurring_day=0 이면서 오늘이 말일)
    const tplRows: any = await db.execute(sql`
      SELECT id, account_code, account_name, sub_account, description,
             payee_name, amount, evidence_type, budget_line_id,
             template_name, created_by, recurring_day
      FROM vouchers
      WHERE is_template = TRUE
        AND recurring_active = TRUE
        AND recurring_day IS NOT NULL
        AND (
          recurring_day = ${kD}
          OR (recurring_day = 0 AND ${isLastDay})
          -- Q4-009: 29~31일 등 그 달 말일보다 큰 지정일은 말일에 발화(짧은 달 누락 방지)
          OR (recurring_day > ${lastDayOfMonth} AND ${isLastDay})
        )
    `);
    const templates = (tplRows?.rows ?? tplRows ?? []) as any[];

    if (!templates.length) {
      console.info("[cron-voucher-recurring] 오늘 도래 템플릿 없음 — 종료");
      return new Response(
        jsonKST({ ok: true, created: 0, skipped: 0, message: "오늘 도래 템플릿 없음" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 전표 발번용 YYYYMM (이번 달 voucher_date 기준)
    const voucherDate = `${kY}-${String(kM).padStart(2, "0")}-${String(kD).padStart(2, "0")}`;

    for (const t of templates) {
      const templateId = Number(t.id);
      const marker = `[auto:${templateId}:${yyyymm}]`;
      try {
        // 2. 중복 체크 — 같은 템플릿·같은 월 마커가 description 에 이미 있으면 스킵
        const dupR: any = await db.execute(sql`
          SELECT id FROM vouchers
          WHERE is_template = FALSE AND description LIKE ${`%${marker}`}
          LIMIT 1
        `);
        if ((dupR?.rows ?? dupR ?? []).length > 0) {
          skipped++;
          results.push({ templateId, status: "skipped", reason: "이미 이번 달 생성됨" });
          continue;
        }

        // 3·4. 발번(YYYYMM-NNN) + draft 전표 INSERT를 한 트랜잭션 + advisory lock으로 묶음
        //       (Q4-024 동시 발번 충돌 방지). 템플릿 필드 복사 + 마커 포함 description.
        const newDesc = `${t.description} ${marker}`;
        const vn = await db.transaction(async (tx) => {
          const voucherNumber = await nextVoucherNumber(tx, yyyymm);
          const ins: any = await tx.execute(sql`
            INSERT INTO vouchers (
              voucher_number, voucher_date, fiscal_year,
              account_code, account_name, sub_account,
              description, payee_name, amount,
              evidence_type, budget_line_id,
              is_template, status, created_by, created_at, updated_at
            ) VALUES (
              ${voucherNumber}, ${voucherDate}, ${kY},
              ${t.account_code}, ${t.account_name}, ${t.sub_account || null},
              ${newDesc}, ${t.payee_name || null}, ${Number(t.amount)},
              ${t.evidence_type || "none"}, ${t.budget_line_id ? Number(t.budget_line_id) : null},
              FALSE, 'draft', ${t.created_by}, NOW(), NOW()
            ) RETURNING voucher_number
          `);
          return (ins?.rows ?? ins ?? [])[0]?.voucher_number;
        });
        created++;
        results.push({ templateId, status: "created", voucherNumber: vn });
      } catch (err: any) {
        failed++;
        results.push({ templateId, status: "failed", reason: String(err?.message || err).slice(0, 200) });
        console.warn(`[cron-voucher-recurring] 템플릿 ${templateId} 처리 실패:`, err?.message);
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-voucher-recurring] 완료 — 생성 ${created} / 스킵 ${skipped} / 실패 ${failed} (${durationMs}ms)`);

    return new Response(
      jsonKST({
        ok: true,
        date: voucherDate,
        templatesFound: templates.length,
        created, skipped, failed,
        durationMs,
        results: results.slice(0, 20),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    // fire-and-forget — fatal 도 200 으로 (cron 재시도 폭주 방지)
    console.error("[cron-voucher-recurring] fatal:", err);
    return new Response(
      jsonKST({ ok: false, error: String(err?.message || err).slice(0, 300), created, skipped, failed }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  schedule: "30 19 * * *", // UTC 19:30 = KST 04:30
};
