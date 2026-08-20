// netlify/functions/migrate-fix-phone.ts
// ★ 2026-08-20 1회용 — 협회 대표 연락처를 실제 번호로 통일한다.
//
// 왜 필요한가
//   앞선 정정에서 예시 번호(02-0000-0000)를 0507-1394-5242 로 바꿨는데, 협회에는 유선 번호가 없다.
//   실제로 쓰는 번호는 아래 두 개뿐이다.
//     · 대표          : 010-2807-5242
//     · 정책국장      : 010-7151-6883  (개인정보 보호책임자 — 이미 반영됨, 여기서는 건드리지 않는다)
//
// 어디를 바꾸나
//   ① 단체 정보란 설정 (site_settings scope='footer' 의 org.phone) — 발행값·임시저장본 모두
//   ② 운영자 페이지 본문 (site_pages) 안에 남아 있는 0507-1394-5242
//   ※ 010-7151-6883(정책국장)은 대상이 아니다. 바꾸는 건 0507-1394-5242 뿐이다.
//
// 사용법 (어드민 로그인 상태에서 주소창)
//   진단  : https://tbfa.co.kr/api/migrate-fix-phone          (인증 불필요·바꾸지 않음)
//   실행  : https://tbfa.co.kr/api/migrate-fix-phone?run=1    (어드민 인증 후 실제 변경)
//
// 호출 성공 후 이 파일은 삭제한다 (1회용 보안 원칙).

import { db } from "../../db";
import { sitePages, siteSettings } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-fix-phone" };

const OLD_PHONE = "0507-1394-5242";
const NEW_PHONE = "010-2807-5242";

function replaceAll(text: string): { out: string; count: number } {
  if (!text) return { out: text, count: 0 };
  const parts = text.split(OLD_PHONE);
  return { out: parts.join(NEW_PHONE), count: parts.length - 1 };
}

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "대표 연락처 통일 실패",
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

  const { eq, and } = await import("drizzle-orm");
  const 단체정보란: any[] = [];
  const 페이지본문: any[] = [];

  /* ---------- ① 단체 정보란 설정 ---------- */
  try {
    const rows = await db
      .select({
        id: siteSettings.id,
        key: siteSettings.key,
        valueText: siteSettings.valueText,
        draftValueText: siteSettings.draftValueText,
      })
      .from(siteSettings)
      .where(and(eq(siteSettings.scope, "footer"), eq(siteSettings.key, "org.phone")));

    for (const row of rows) {
      const pub = replaceAll(String(row.valueText || ""));
      const draft = replaceAll(String(row.draftValueText || ""));
      if (pub.count === 0 && draft.count === 0) continue;

      단체정보란.push({ 항목: row.key, 발행값: pub.count, 임시저장본: draft.count });

      if (run) {
        const patch: any = { updatedAt: new Date() };
        if (pub.count > 0) patch.valueText = pub.out;
        if (draft.count > 0) patch.draftValueText = draft.out;
        await db.update(siteSettings).set(patch).where(eq(siteSettings.id, row.id));
      }
    }
  } catch (err) {
    return jsonError("footer_setting", err);
  }

  /* ---------- ② 운영자 페이지 본문 ---------- */
  try {
    const rows = await db
      .select({
        id: sitePages.id,
        slug: sitePages.slug,
        contentHtml: sitePages.contentHtml,
        draftContentHtml: sitePages.draftContentHtml,
      })
      .from(sitePages);

    for (const row of rows) {
      const pub = replaceAll(String(row.contentHtml || ""));
      const draft = replaceAll(String(row.draftContentHtml || ""));
      if (pub.count === 0 && draft.count === 0) continue;

      페이지본문.push({ 주소: `/p/${row.slug}`, 발행본: pub.count, 임시저장본: draft.count });

      if (run) {
        const patch: any = { updatedAt: new Date() };
        if (pub.count > 0) patch.contentHtml = pub.out;
        if (draft.count > 0) patch.draftContentHtml = draft.out;
        await db.update(sitePages).set(patch).where(eq(sitePages.id, row.id));
      }
    }
  } catch (err) {
    return jsonError("site_pages", err);
  }

  return new Response(JSON.stringify({
    ok: true,
    mode: run ? "실행" : "진단(바꾸지 않음)",
    바꾸는_내용: `${OLD_PHONE} → ${NEW_PHONE} (대표)`,
    건드리지_않는_번호: "010-7151-6883 (정책국장·개인정보 보호책임자)",
    단체정보란: 단체정보란.length ? 단체정보란 : "고칠 것 없음",
    페이지본문: 페이지본문.length ? 페이지본문 : "고칠 것 없음",
    안내: run
      ? "정정 완료. 화면을 새로고침해 확인한 뒤 이 함수 파일을 삭제하세요. (전송망 보관 때문에 최대 5분 늦게 보일 수 있습니다)"
      : "?run=1 을 붙여 어드민 로그인 상태로 호출하면 실제로 바꿉니다.",
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
