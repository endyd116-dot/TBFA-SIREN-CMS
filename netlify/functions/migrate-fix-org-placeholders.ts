// netlify/functions/migrate-fix-org-placeholders.ts
// ★ 2026-08-20 1회용 — 어드민에 저장된 정책 페이지 본문의 예시(가짜) 단체 정보를 실제 값으로 바꾼다.
//
// 왜 필요한가
//   개인정보처리방침(/p/privacy)·윤리경영(/p/ethics)·이메일무단수집거부(/p/email-reject) 본문이
//   저장소에 들어 있고, 그 안에 "김◯◯ · 02-0000-0000 · contact@siren-org.kr · 종로구 세종대로 OO길"
//   같은 예시값이 그대로 남아 있다. 구글 광고그랜트 심사에서 "실존 비영리단체인지 확인 불가"로
//   판단될 수 있고, 개인정보 보호책임자는 법정 필수 기재사항이라 예시값이면 그 자체로 문제다.
//
// 사용법 (어드민 로그인 상태에서 주소창)
//   진단  : https://tbfa.co.kr/api/migrate-fix-org-placeholders          (인증 불필요·바꾸지 않음)
//   실행  : https://tbfa.co.kr/api/migrate-fix-org-placeholders?run=1    (어드민 인증 후 실제 변경)
//
// 호출 성공 후 이 파일은 삭제한다 (1회용 보안 원칙).

import { db } from "../../db";
import { sitePages } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-fix-org-placeholders" };

/* 바꿀 내용 — 왼쪽(예시값) → 오른쪽(실제값) */
const REPLACEMENTS: Array<[string, string]> = [
  ["contact@siren-org.kr", "info@tbfa.co.kr"],
  ["02-0000-0000", "0507-1394-5242"],
  ["김◯◯", "김광일"],
  ["123-45-67890", "118-82-71215"],
  ["서울특별시 종로구 세종대로 OO길 OO, O층 (우 03000)", "서울특별시 강서구 공항대로 426 VIP빌딩 6층 618호"],
  ["서울특별시 종로구 세종대로 OO길 OO, O층", "서울특별시 강서구 공항대로 426 VIP빌딩 6층 618호"],
  ["종로구 세종대로 OO길 OO, O층", "강서구 공항대로 426 VIP빌딩 6층 618호"],
  ["평일 09:30 ~ 18:00 (점심 12:30~13:30)", "평일 08:00 ~ 18:00"],
  ["평일 09:30 ~ 18:00", "평일 08:00 ~ 18:00"],
];

function replaceAll(text: string): { out: string; hits: Record<string, number> } {
  let out = text;
  const hits: Record<string, number> = {};
  for (const [from, to] of REPLACEMENTS) {
    let count = 0;
    let idx = out.indexOf(from);
    while (idx !== -1) {
      count++;
      out = out.slice(0, idx) + to + out.slice(idx + from.length);
      idx = out.indexOf(from, idx + to.length);
    }
    if (count > 0) hits[from] = count;
  }
  return { out, hits };
}

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "정책 페이지 단체 정보 정정 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 실제로 바꿀 때만 어드민 확인 (진단은 누구나) */
  if (run) {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  }

  let rows: any[] = [];
  try {
    rows = await db
      .select({
        id: sitePages.id,
        slug: sitePages.slug,
        contentHtml: sitePages.contentHtml,
        draftContentHtml: sitePages.draftContentHtml,
      })
      .from(sitePages);
  } catch (err) {
    return jsonError("select_pages", err);
  }

  const report: any[] = [];
  let changed = 0;

  for (const row of rows) {
    const published = replaceAll(String(row.contentHtml || ""));
    const draft = replaceAll(String(row.draftContentHtml || ""));

    const pubChanged = published.out !== String(row.contentHtml || "");
    const draftChanged = draft.out !== String(row.draftContentHtml || "");
    if (!pubChanged && !draftChanged) continue;

    report.push({
      slug: row.slug,
      발행본_바뀐항목: published.hits,
      임시저장본_바뀐항목: draft.hits,
    });

    if (run) {
      try {
        const patch: any = { updatedAt: new Date() };
        if (pubChanged) patch.contentHtml = published.out;
        if (draftChanged) patch.draftContentHtml = draft.out;
        const { eq } = await import("drizzle-orm");
        await db.update(sitePages).set(patch).where(eq(sitePages.id, row.id));
        changed++;
      } catch (err) {
        return jsonError(`update_${row.slug}`, err);
      }
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    mode: run ? "실행" : "진단(바꾸지 않음)",
    검사한_페이지수: rows.length,
    고칠_페이지: report,
    실제_수정건수: run ? changed : 0,
    안내: run
      ? "정정 완료. 페이지를 새로고침해 확인한 뒤 이 함수 파일을 삭제하세요."
      : "?run=1 을 붙여 어드민 로그인 상태로 호출하면 실제로 바꿉니다.",
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
