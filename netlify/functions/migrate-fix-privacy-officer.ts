// netlify/functions/migrate-fix-privacy-officer.ts
// ★ 2026-08-20 1회용 — 개인정보처리방침의 "개인정보 보호책임자" 표를 실제 담당자로 맞춘다.
//
// 왜 필요한가
//   앞선 정정(migrate-fix-org-placeholders)에서 예시값을 협회 대표 연락처로 일괄 교체했는데,
//   개인정보 보호책임자는 협회 대표번호가 아니라 **담당자 본인 연락처**를 적어야 한다
//   (「개인정보 보호법」 제31조 — 성명·직책·연락처를 공개해야 하는 법정 필수 기재사항).
//
//   확정된 담당자: 김광일 / 정책국장 / 010-7151-6883 / endy0718@naver.com
//
// 어디만 바꾸나
//   본문 전체가 아니라 "개인정보 보호책임자를 지정하고 있습니다" 안내문 바로 뒤에 오는 **표 한 개**만
//   손댄다. 같은 전화번호·이메일이 문서 다른 곳(권리 행사 창구 등)에도 나오는데 그쪽은
//   협회 대표 연락처가 맞으므로 건드리면 안 된다.
//
// 사용법 (어드민 로그인 상태에서 주소창)
//   진단  : https://tbfa.co.kr/api/migrate-fix-privacy-officer          (인증 불필요·바꾸지 않음)
//   실행  : https://tbfa.co.kr/api/migrate-fix-privacy-officer?run=1    (어드민 인증 후 실제 변경)
//
// 호출 성공 후 이 파일은 삭제한다 (1회용 보안 원칙).

import { db } from "../../db";
import { sitePages } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-fix-privacy-officer" };

/* 확정된 개인정보 보호책임자 */
const OFFICER = {
  name: "김광일",
  role: "정책국장",
  phone: "010-7151-6883",
  email: "endy0718@naver.com",
};

/* 표를 찾는 기준 — 이 안내문 뒤에 오는 첫 번째 표 하나만 손댄다 */
const ANCHOR = "개인정보 보호책임자를 지정하고 있습니다";

/** 항목 이름(성명·직책 등)에 해당하는 칸의 값을 바꾼다 */
function setRow(tableHtml: string, label: string, value: string): { out: string; changed: boolean } {
  /* <th>성명</th> <td>…</td> 형태 — 사이에 공백·줄바꿈이 있어도 찾는다 */
  const re = new RegExp(`(<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>)([\\s\\S]*?)(</td>)`, "i");
  const m = tableHtml.match(re);
  if (!m) return { out: tableHtml, changed: false };
  if (m[2].trim() === value) return { out: tableHtml, changed: false };
  return { out: tableHtml.replace(re, `$1${value}$3`), changed: true };
}

/** 이메일 칸은 링크가 들어 있어 주소와 보이는 글자를 함께 바꾼다 */
function setEmailRow(tableHtml: string, value: string): { out: string; changed: boolean } {
  const re = /(<th[^>]*>\s*이메일\s*<\/th>\s*<td[^>]*>)([\s\S]*?)(<\/td>)/i;
  const m = tableHtml.match(re);
  if (!m) return { out: tableHtml, changed: false };
  const cell = `<a href="mailto:${value}" style="color:var(--brand)">${value}</a>`;
  if (m[2].trim() === cell) return { out: tableHtml, changed: false };
  return { out: tableHtml.replace(re, `$1${cell}$3`), changed: true };
}

function fixOfficerTable(html: string): { out: string; hits: string[]; found: boolean } {
  const anchorIdx = html.indexOf(ANCHOR);
  if (anchorIdx === -1) return { out: html, hits: [], found: false };

  const tableStart = html.indexOf("<table", anchorIdx);
  if (tableStart === -1) return { out: html, hits: [], found: false };
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd === -1) return { out: html, hits: [], found: false };

  let table = html.slice(tableStart, tableEnd + "</table>".length);
  const hits: string[] = [];

  let r = setRow(table, "성명", OFFICER.name);
  if (r.changed) hits.push("성명");
  table = r.out;

  r = setRow(table, "직책", OFFICER.role);
  if (r.changed) hits.push("직책");
  table = r.out;

  r = setRow(table, "연락처", OFFICER.phone);
  if (r.changed) hits.push("연락처");
  table = r.out;

  r = setEmailRow(table, OFFICER.email);
  if (r.changed) hits.push("이메일");
  table = r.out;

  return {
    out: html.slice(0, tableStart) + table + html.slice(tableEnd + "</table>".length),
    hits,
    found: true,
  };
}

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "개인정보 보호책임자 정정 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (run) {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  }

  let rows: any[] = [];
  try {
    const { eq } = await import("drizzle-orm");
    rows = await db
      .select({
        id: sitePages.id,
        slug: sitePages.slug,
        contentHtml: sitePages.contentHtml,
        draftContentHtml: sitePages.draftContentHtml,
      })
      .from(sitePages)
      .where(eq(sitePages.slug, "privacy"));
  } catch (err) {
    return jsonError("select_privacy", err);
  }

  if (rows.length === 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: "개인정보처리방침 페이지(privacy)를 찾지 못했습니다",
    }, null, 2), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const row = rows[0];
  const published = fixOfficerTable(String(row.contentHtml || ""));
  const draft = row.draftContentHtml
    ? fixOfficerTable(String(row.draftContentHtml))
    : { out: null as any, hits: [] as string[], found: false };

  const pubChanged = published.found && published.hits.length > 0;
  const draftChanged = draft.found && draft.hits.length > 0;

  if (run && (pubChanged || draftChanged)) {
    try {
      const { eq } = await import("drizzle-orm");
      const patch: any = { updatedAt: new Date() };
      if (pubChanged) patch.contentHtml = published.out;
      if (draftChanged) patch.draftContentHtml = draft.out;
      await db.update(sitePages).set(patch).where(eq(sitePages.id, row.id));
    } catch (err) {
      return jsonError("update_privacy", err);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    mode: run ? "실행" : "진단(바꾸지 않음)",
    보호책임자_표_찾음: published.found,
    바뀐_항목: published.hits,
    임시저장본_바뀐_항목: draft.hits,
    적용될_값: OFFICER,
    안내: !published.found
      ? "보호책임자 표를 찾지 못했습니다 — 어드민 페이지 편집에서 직접 수정해 주세요."
      : run
        ? "정정 완료. /p/privacy 를 새로고침해 확인한 뒤 이 함수 파일을 삭제하세요."
        : "?run=1 을 붙여 어드민 로그인 상태로 호출하면 실제로 바꿉니다.",
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
