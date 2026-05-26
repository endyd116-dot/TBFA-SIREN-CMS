/**
 * admin-martyrdom-criteria-generate — 법령 시드 AI 파싱 → 인정요건 후보 제안 (§P2.0 #3)
 *
 * POST {}
 *   docs/law/martyrdom/*.md 를 AI로 파싱해 인정요건 후보를 제안(검토용).
 *   ⚠️ 자동 저장 안 함 — 운영자가 검토 후 admin-martyrdom-criteria POST로 채택.
 *   기존 code와 겹치면 exists:true 표기(중복 채택 방지).
 *
 * 권한: super_admin (요건 기준 변경 책임)
 * netlify.toml included_files 에 docs/law/martyrdom/** 포함 필요(번들에서 파일 읽기).
 *
 * 응답: { ok, candidates:[{ code,category,title,description,evidenceHint,lawRef,weight,exists }] }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import { callGeminiJSON } from "../../lib/ai-gemini";
import { logAdminAction } from "../../lib/audit";
import * as fs from "fs";
import * as path from "path";

export const config = { path: "/api/admin-martyrdom-criteria-generate" };

const LAW_FILES = [
  "docs/law/martyrdom/01-public-service-disaster-act.md",
  "docs/law/martyrdom/02-martyrdom-recognition-standards.md",
];

function readFileSafe(relPath: string): string {
  try { return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8"); } catch { return ""; }
}
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;
  if (!requireRole(member, "super_admin")) return roleForbidden("super_admin");

  try {
    const lawText = LAW_FILES.map(f => readFileSafe(f)).filter(Boolean).join("\n\n=====\n\n");
    if (!lawText) {
      return new Response(JSON.stringify({ ok: false, error: "법령 문서를 읽을 수 없습니다(번들 included_files 확인)" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `당신은 공무원 재해보상·교사 순직 인정 법령 분석 전문가입니다.
아래 법령·인정 기준 문서를 읽고, 순직 인정 심사에서 입증해야 할 "인정 요건"을 추출해 후보로 제안합니다.
각 요건:
- code: 영문 소문자·언더스코어 식별자(예: duty_performance)
- category: 대분류(공무수행성·인과관계·직무부담·과실/기여·객관입증·절차 등)
- title: 요건 한 줄 제목(한국어)
- description: 무엇을 입증해야 하는지 1~2문장
- evidenceHint: 충족시키는 자료 유형(8대분류 코드: application·work_record·duty_stress·medical·investigation·statement·death_scene·other 중)
- lawRef: 근거 법령·조문 또는 문서 출처
- weight: 1~3 (중요도)
한국어. JSON만.

응답 형식:
{ "candidates": [{ "code":"", "category":"", "title":"", "description":"", "evidenceHint":"", "lawRef":"", "weight": 2 }] }`;

    const res = await callGeminiJSON<{ candidates: any[] }>(
      `${systemPrompt}\n\n[법령 문서]\n${lawText.slice(0, 16000)}\n\nJSON만 응답하세요.`,
      { mode: "pro", featureKey: "martyrdom_ai", maxOutputTokens: 4096, timeoutMs: 90000, internalBulk: true }
    );

    if (!res.ok || !res.data || !Array.isArray(res.data.candidates)) {
      return new Response(JSON.stringify({ ok: false, error: "법령 파싱 실패 — 다시 시도해주세요", detail: res.error || "" }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    /* 기존 code 조회 (중복 표기) */
    const existing = new Set<string>();
    try {
      const r: any = await db.execute(sql.raw(`SELECT code FROM martyrdom_criteria`));
      for (const row of (r?.rows ?? r ?? [])) existing.add(String(row.code));
    } catch { /* 테이블 없으면 빈 셋 */ }

    const candidates = res.data.candidates.slice(0, 30).map((c: any) => {
      const code = String(c.code || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 50);
      return {
        code,
        category: String(c.category || "").slice(0, 60),
        title: String(c.title || "").slice(0, 200),
        description: String(c.description || "").slice(0, 2000),
        evidenceHint: String(c.evidenceHint || "").slice(0, 2000),
        lawRef: String(c.lawRef || "").slice(0, 300),
        weight: Math.min(3, Math.max(1, Number(c.weight) || 1)),
        exists: existing.has(code),
      };
    }).filter(c => c.code && c.title);

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_criteria_generate", {
      detail: { count: candidates.length },
    });

    return new Response(JSON.stringify({ ok: true, candidates }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return jsonError("criteria_generate", err);
  }
};
