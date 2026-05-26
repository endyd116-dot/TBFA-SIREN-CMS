/**
 * migrate-martyrdom-setup — 순직 인정 지원 시스템 초기 DB 구성
 *
 * GET ?run=1  : super_admin 인증 후 실행 (멱등)
 * GET         : 진단 모드 (인증 불필요 — 테이블 존재 여부만)
 *
 * 수행:
 *  1) 4테이블 IF NOT EXISTS 생성 (martyrdom_cases·documents·ai_outputs·golden_items)
 *  2) ai_rag_documents.case_id 컬럼 + 인덱스 추가 (ALTER ... ADD COLUMN IF NOT EXISTS)
 *  3) martyrdom_golden_items 기본 시드 10건 (ON CONFLICT DO NOTHING)
 *  4) ai_feature_settings martyrdom_ai UPSERT (BUG-2 교훈 — UPSERT)
 *
 * 호출 후 즉시 schema.ts 4테이블 주석 해제 + 이 파일 삭제 + 커밋·푸시
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole } from "../../lib/admin-role";

export const config = { path: "/api/migrate-martyrdom-setup" };

function jsonOk(data: object) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "마이그레이션 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }), { status: 405 });
  }

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 (인증 불필요) ── */
  if (!run) {
    let diag: Record<string, boolean> = {};
    try {
      const r: any = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'martyrdom_cases','martyrdom_case_documents',
            'martyrdom_ai_outputs','martyrdom_golden_items'
          )
      `);
      const existing = new Set((r?.rows ?? r ?? []).map((row: any) => String(row.table_name)));
      diag = {
        martyrdom_cases: existing.has("martyrdom_cases"),
        martyrdom_case_documents: existing.has("martyrdom_case_documents"),
        martyrdom_ai_outputs: existing.has("martyrdom_ai_outputs"),
        martyrdom_golden_items: existing.has("martyrdom_golden_items"),
      };

      /* case_id 컬럼 존재 여부 */
      const col: any = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ai_rag_documents' AND column_name = 'case_id'
        LIMIT 1
      `);
      (diag as any).ai_rag_documents_case_id = ((col?.rows ?? col ?? []).length > 0);
    } catch (err: any) {
      return jsonError("diag", err);
    }
    const allDone = Object.values(diag).every(Boolean);
    return jsonOk({ mode: "diag", allDone, tables: diag });
  }

  /* ── 실행 모드 — super_admin 인증 ── */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if (!requireRole(auth.ctx.member, "super_admin")) {
    return new Response(JSON.stringify({ ok: false, error: "super_admin 권한 필요" }), { status: 403 });
  }

  const log: string[] = [];

  try {
    /* ─── 1. martyrdom_cases ─── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS martyrdom_cases (
        id                  SERIAL PRIMARY KEY,
        case_no             VARCHAR(30) UNIQUE NOT NULL,
        case_kind           VARCHAR(12) NOT NULL DEFAULT 'active',
        title               VARCHAR(200) NOT NULL,
        deceased_name       VARCHAR(50),
        school_name         VARCHAR(150),
        position            VARCHAR(50),
        deceased_at         DATE,
        occurred_summary    TEXT,
        status              VARCHAR(20) NOT NULL DEFAULT 'intake',
        outcome             VARCHAR(12),
        outcome_note        TEXT,
        procedure_stage     VARCHAR(20),
        next_deadline_at    DATE,
        next_deadline_label VARCHAR(100),
        extraction_json     JSONB,
        extracted_at        TIMESTAMP,
        assigned_admin_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
        workspace_task_id   INTEGER,
        created_by          INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_cases_case_no_idx ON martyrdom_cases(case_no)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_cases_kind_idx ON martyrdom_cases(case_kind)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_cases_status_idx ON martyrdom_cases(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_cases_outcome_idx ON martyrdom_cases(outcome)`);
    log.push("martyrdom_cases OK");

    /* ─── 2. martyrdom_case_documents ─── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS martyrdom_case_documents (
        id                    SERIAL PRIMARY KEY,
        case_id               INTEGER NOT NULL REFERENCES martyrdom_cases(id) ON DELETE CASCADE,
        blob_id               INTEGER,
        file_name             VARCHAR(500) NOT NULL,
        mime_type             VARCHAR(100),
        size_bytes            INTEGER DEFAULT 0,
        doc_type              VARCHAR(30),
        doc_type_auto         VARCHAR(30),
        doc_summary           TEXT,
        classify_confidence   INTEGER DEFAULT 0,
        extract_status        VARCHAR(20) NOT NULL DEFAULT 'pending',
        extract_method        VARCHAR(20),
        extracted_text        TEXT,
        extract_error         TEXT,
        indexed_to_rag        BOOLEAN DEFAULT FALSE,
        blob_key              VARCHAR(1000),
        created_by            INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_docs_case_idx ON martyrdom_case_documents(case_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_docs_status_idx ON martyrdom_case_documents(extract_status)`);
    log.push("martyrdom_case_documents OK");

    /* ─── 3. martyrdom_ai_outputs ─── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS martyrdom_ai_outputs (
        id           SERIAL PRIMARY KEY,
        case_id      INTEGER NOT NULL REFERENCES martyrdom_cases(id) ON DELETE CASCADE,
        output_type  VARCHAR(20) NOT NULL,
        version      INTEGER NOT NULL DEFAULT 1,
        content_text TEXT,
        content_json JSONB,
        rag_sources  JSONB,
        model_used   VARCHAR(40),
        status       VARCHAR(12) NOT NULL DEFAULT 'draft',
        reviewed_by  INTEGER REFERENCES members(id) ON DELETE SET NULL,
        reviewed_at  TIMESTAMP,
        review_note  TEXT,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_outputs_case_idx ON martyrdom_ai_outputs(case_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS martyrdom_outputs_type_idx ON martyrdom_ai_outputs(output_type)`);
    log.push("martyrdom_ai_outputs OK");

    /* ─── 4. martyrdom_golden_items ─── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS martyrdom_golden_items (
        id          SERIAL PRIMARY KEY,
        channel     VARCHAR(12) NOT NULL,
        label       VARCHAR(150) NOT NULL,
        guidance    TEXT,
        volatility  INTEGER DEFAULT 3,
        sort_order  INTEGER DEFAULT 0,
        active      BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    log.push("martyrdom_golden_items OK");

    /* ─── 5. ai_rag_documents.case_id 컬럼 추가 ─── */
    await db.execute(sql`
      ALTER TABLE ai_rag_documents ADD COLUMN IF NOT EXISTS case_id INTEGER
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_rag_docs_case_id_idx ON ai_rag_documents(case_id)
        WHERE case_id IS NOT NULL
    `);
    log.push("ai_rag_documents.case_id OK");

    /* ─── 6. golden_items 시드 (ON CONFLICT DO NOTHING — label UNIQUE 아니므로 EXISTS 체크) ─── */
    const existingGolden: any = await db.execute(sql`SELECT COUNT(*) AS cnt FROM martyrdom_golden_items`);
    const goldenCount = Number((existingGolden?.rows ?? existingGolden ?? [])[0]?.cnt ?? 0);
    if (goldenCount === 0) {
      const goldenItems = [
        /* online — 휘발성 높음 */
        { channel: "online", label: "메신저·SNS 대화 백업 (카카오톡·밴드·문자)", guidance: "캡처 또는 내보내기(.txt) — 악성 민원·업무 압박 대화 우선. 상대방 삭제 전 확보 필수", volatility: 5, sort_order: 1 },
        { channel: "online", label: "학교 업무용 메신저·이메일 보관", guidance: "관리자급 교사 메신저 계정(나이스·학교 내부 시스템) 업무 기록. 계정 회수 전 백업", volatility: 5, sort_order: 2 },
        { channel: "online", label: "SNS·커뮤니티 민원 게시글 캡처", guidance: "학부모 커뮤니티(맘카페 등) 고인 관련 게시글·댓글 캡처. 삭제·수정 전 확보", volatility: 5, sort_order: 3 },
        { channel: "online", label: "통화·녹음 파일 백업", guidance: "고인 또는 관계자의 통화 녹음 — 스마트폰 내부 저장소·클라우드 백업 확인", volatility: 4, sort_order: 4 },
        { channel: "online", label: "CCTV·블랙박스 영상 보전 요청", guidance: "학교·주변 CCTV 영상은 통상 30~60일 자동 삭제. 경찰·학교장에 서면 보전 요청 즉시", volatility: 5, sort_order: 5 },
        /* offline — 보존 용이 */
        { channel: "offline", label: "사망진단서·사체검안서 원본", guidance: "병원·의원 발급. 순직 신청 핵심 서류. 원본 1부 이상 확보", volatility: 1, sort_order: 6 },
        { channel: "offline", label: "재직증명서 (사망 당시)", guidance: "소속 학교 행정실 발급. 고용 관계·직급 입증", volatility: 1, sort_order: 7 },
        { channel: "offline", label: "의무기록 사본 전체 (외래·입원·응급)", guidance: "진료 받은 모든 병원에 사본 신청. 직무 스트레스→질병 인과 핵심 자료", volatility: 2, sort_order: 8 },
        { channel: "offline", label: "근무기록·초과근무 기록 (나이스·학교 전산)", guidance: "학교 행정실 또는 교육청 통해 출퇴근·수업·업무분장 기록 수집. 3년치 확보 권장", volatility: 2, sort_order: 9 },
        { channel: "offline", label: "심리상담 기록 (Wee클래스·외부 상담)", guidance: "학교 Wee클래스 또는 상담사 메모·일지. 심리적 위기 상태 시점 입증", volatility: 2, sort_order: 10 },
      ];

      for (const item of goldenItems) {
        await db.execute(sql`
          INSERT INTO martyrdom_golden_items (channel, label, guidance, volatility, sort_order, active)
          VALUES (${item.channel}, ${item.label}, ${item.guidance}, ${item.volatility}, ${item.sort_order}, TRUE)
        `);
      }
      log.push(`golden_items 시드 ${goldenItems.length}건 완료`);
    } else {
      log.push(`golden_items 이미 ${goldenCount}건 존재 — 시드 스킵`);
    }

    /* ─── 7. martyrdom_ai featureKey UPSERT (BUG-2 교훈 — INSERT ON CONFLICT UPDATE) ─── */
    await db.execute(sql`
      INSERT INTO ai_feature_settings
        (feature_key, feature_name, category, description, enabled, sort_order)
      VALUES
        ('martyrdom_ai', '순직 인정 지원 AI', 'agent_chat',
         '교사 순직 인정 지원 — 자료 분류·구조 추출·전략 분석·서면 초안 생성', TRUE, 430)
      ON CONFLICT (feature_key) DO UPDATE SET
        feature_name = EXCLUDED.feature_name,
        category     = EXCLUDED.category,
        description  = EXCLUDED.description,
        sort_order   = EXCLUDED.sort_order
    `);
    log.push("martyrdom_ai featureKey UPSERT OK");

  } catch (err: any) {
    return jsonError("create_tables", err);
  }

  return jsonOk({
    mode: "run",
    log,
    next: "schema.ts 4테이블 주석 해제 → 이 파일 삭제 → git push",
  });
};
