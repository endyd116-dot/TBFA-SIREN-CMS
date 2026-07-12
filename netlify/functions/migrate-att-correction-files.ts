/**
 * /api/migrate-att-correction-files?run=1   — 1회용 (호출 후 파일 삭제)
 *
 * 근태 수정 요청에 '증빙 자료(첨부 파일)'를 담을 칸을 만든다.
 *
 * 왜 필요한가:
 *   출퇴근 기록을 고쳐 달라는 요청은 사유만 글로 적게 되어 있었다.
 *   실제로는 회의 자료·출장 확인서·병원 서류처럼 증빙이 필요한 경우가 많은데,
 *   그걸 붙일 곳이 없어 결재자가 글만 보고 판단해야 했다.
 *   → 첨부 파일 목록을 요청에 함께 저장한다(파일 자체는 각자의 워크스페이스 파일함에 보관).
 *
 * 담기는 값: [{ fileId, name, sizeBytes, mimeType }]  — 파일함의 파일을 가리키는 목록
 * (기존 evidence_url 칸은 손대지 않는다 — 옛 데이터 보존)
 *
 * 안전: 컬럼 추가만. 멱등.
 *
 * GET (기본) : 진단 (인증 불필요)
 * GET ?run=1 : 어드민 인증 후 실행
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-att-correction-files" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADER });
}
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

async function inspect() {
  const r: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'att_corrections' AND column_name = 'evidence_files'
  `);
  return { 컬럼: rows(r).map((c: any) => c.column_name), done: rows(r).length === 1 };
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try {
      const s = await inspect();
      return json({
        ok: true, mode: "diagnose",
        message: s.done ? "이미 적용되어 있습니다" : "미적용 — 어드민 로그인 후 ?run=1 로 호출하세요",
        state: s,
      });
    } catch (err: any) {
      return json({ ok: false, step: "diagnose", detail: String(err?.message ?? err).slice(0, 500) }, 500);
    }
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    await db.execute(sql`
      ALTER TABLE att_corrections
        ADD COLUMN IF NOT EXISTS evidence_files jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  } catch (err: any) {
    return json({ ok: false, step: "alter", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  const after = await inspect().catch(() => null);
  return json({
    ok: true, mode: "run",
    message: "근태 수정요청 증빙 첨부 칸 추가 완료",
    after,
    안내: "근태 → 수정 요청 탭에서 사유와 함께 파일을 첨부할 수 있습니다 (20MB 이하 · 한글·워드·PDF 등 제한 없음)",
  });
}
