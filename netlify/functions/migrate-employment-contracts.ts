/**
 * GET /api/migrate-employment-contracts        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-employment-contracts?run=1   — 실행 (슈퍼어드민 인증)
 *
 * 직원 전자 근로계약 시스템 초기화:
 *   테이블 5개 생성(사업자·양식·계약본체·서명증적·부속서류) +
 *   프리셋 사업자 3사 시드(교유협·함께워크 ON·함께워크 SI) +
 *   박두용 도장 R2 자동 업로드(ON·SI 연결) +
 *   ON 초안 근로계약서 양식을 3사에 시드({{치환}} 형식) +
 *   role_permissions에 contract_manage 시드.
 *
 * 멱등: 모든 CREATE는 IF NOT EXISTS, 시드는 존재 검사 후 삽입. 재실행 안전.
 * 설계서: docs/active/2026-07-27-employment-contract-design.md
 * 호출 성공 후 즉시 파일 삭제 + commit (§6.8).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { uploadToR2 } from "../../lib/r2-server";

export const config = { path: "/api/migrate-employment-contracts" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

/* ON 초안(assets/근로계약서_함께워크ON_V1.0.docx) → {{치환}} 양식. 3사 공통 시드(사업자 정보는 치환).
   교유협은 NPO라 5인미만·경업금지 등 사업장 특화 조항을 슈퍼어드민이 CRUD로 다듬는다. */
const CONTRACT_BODY = `근  로  계  약  서

{{회사상호}}(이하 "회사"라 한다)과 아래 근로자(이하 "근로자"라 한다)는 다음과 같이 근로계약을 체결한다.

[사업자]
상호 : {{회사상호}}
대표자 : {{회사대표자}}
사업자등록번호 : {{회사사업자번호}}
소재지 : {{회사주소}}

[근로자]
성명 : {{성명}}   (생년월일 : {{생년월일}})
주소 : {{주소}}
연락처 : {{연락처}}

제 1 조 [근로계약기간 및 수습기간]
① 근로계약기간은 {{계약시작일}}부터 정함이 없는 것으로 한다(정규직).
② 입사일로부터 {{수습개월}}개월간은 수습기간으로 하며, 수습기간도 계속 근로기간에 포함된다.
③ 수습기간 중 임금은 본 계약 임금의 90%를 지급한다. 다만 최저임금에 미달하지 아니한다.
④ 수습기간 중 회사는 근로자의 업무 수행 능력, 근무 태도, 성실성, 회사 문화 적합성 등을 종합 평가하여 부적격하다고 판단되는 경우 30일 전 예고(또는 30일분의 통상임금 지급) 없이 즉시 본 계약을 해지할 수 있다.

제 2 조 [근무장소 및 업무내용]
① 근무장소 : {{근무장소}}.
② 담당업무 : {{담당업무}}.
③ 회사는 업무상 필요에 따라 근로자의 근무장소·담당업무를 변경할 수 있으며, 근로자는 정당한 사유가 없는 한 이에 따른다.

제 3 조 [근로시간 및 휴게시간]
① 소정근로시간 : 1일 8시간, 1주 40시간(월~금).
② 근무시간은 {{근무시작시각}} ~ {{근무종료시각}} (휴게시간 12:00 ~ 13:00, 1시간)으로 한다.
③ 업무상 필요한 경우 회사와 근로자의 합의로 근무시간·시업·종업시각을 변경할 수 있다.
④ 연장·야간·휴일근로가 발생하는 경우 그 대가는 본 계약 제5조의 포괄임금에 이미 포함된 것으로 한다.

제 4 조 [휴일]
① 유급 주휴일은 매주 일요일로 한다(1주 소정근로일 개근 시 부여).
② 토요일은 무급휴무일로 한다.
③ 「관공서의 공휴일에 관한 규정」에 따른 공휴일 및 대체공휴일은 무급휴무일로 한다.
④ 근로자의 날(5월 1일)은 「근로자의 날 제정에 관한 법률」에 따라 유급휴일로 한다.

제 5 조 [임금]
① 임금은 다음과 같이 정한다.
  · 연봉(총액) : {{연봉}} (세전)
  · 월 지급액 : {{월지급액}}
  · 임금 구성 : 연봉 총액은 기본급, 제 수당(직책수당·직무수당 등), 연장·야간·휴일근로에 따른 제 수당을 모두 포함한 포괄임금이다.
  · 지급일 : 매월 {{지급일}}
  · 지급 방법 : 근로자 명의 예금계좌 이체 (원천징수 후 지급)
  · 지급 형태 : 통화(원화)
② 본 계약의 임금은 포괄임금제로서, 연장근로·야간근로·휴일근로에 대한 제 수당을 포함한다. 다만 회사가 사전 승인한 특별한 프로젝트성 초과근무에 한하여 별도 협의할 수 있다.
③ 지각·조퇴·결근 등 근로 미제공 시간에 대하여는 그 시간(또는 일수)에 상당하는 임금(일급제·시간급제 계산)을 공제한다. 일급은 월 지급액을 그 달의 소정근로일수로 나누어 산정한다.
④ 연봉의 인상·조정은 회사의 경영 사정, 근로자의 업무 성과·근무 태도 등을 종합적으로 고려하여 회사가 결정한다. 매년 자동 인상되는 것은 아니다.
⑤ 상여금, 성과급, 인센티브 등 본 계약에 명시되지 아니한 금품은 회사의 재량에 따라 지급 여부·금액·시기를 결정한다.

제 6 조 [유급휴가]
① 회사는 근로자의 사기 진작을 위하여 해당 월(1일~말일)의 소정근로일을 전부 개근(만근)하고 지각·조퇴·무단이석·무단결근·중징계 사유가 없는 경우에 한하여 익월에 유급휴가 1일을 부여한다.
② 부여된 유급휴가는 부여받은 날로부터 12개월 이내에 사용하여야 하며, 미사용 시 소멸된다.
③ 유급휴가 사용은 최소 7일 전에 사전 승인을 얻어야 하며, 업무상 지장이 있는 경우 회사는 시기변경권을 행사할 수 있다.

제 7 조 [결근·지각·조퇴 처리]
① 근로자가 결근·지각·조퇴·무단이석하는 경우 회사는 해당 시간(일수)에 상당하는 임금 공제, 해당 월 유급휴가 부여 대상 제외, 반복 시 경고·감봉·정직·해고 등 징계 조치를 취할 수 있다.
② 3회 이상 무단결근하거나 정당한 사유 없이 5일 이상 연속 결근한 경우 회사는 이를 근로계약의 중대한 위반으로 보고 즉시 계약을 해지할 수 있다.

제 8 조 [4대 사회보험 및 세금]
① 회사는 관련 법령에 따라 국민연금·건강보험·고용보험·산재보험에 가입한다.
② 근로자 부담분 보험료 및 근로소득세·주민세 등 제세공과금은 임금에서 원천공제한다.

제 9 조 [퇴직급여]
① 근로자가 1년 이상 계속 근로 후 퇴직하는 경우 「근로자퇴직급여 보장법」에 따라 퇴직금을 지급한다.
② 회사는 퇴직연금(DC형 또는 DB형)에 가입할 수 있으며, 그 경우 본 조는 해당 법령에 따라 대체된다.
③ 수습기간 종료 전 퇴사·해고 시 및 계속 근로기간이 1년 미만인 경우 퇴직금은 발생하지 아니한다.

제 10 조 [겸직 금지 및 성실 근무 의무]
① 근로자는 재직 중 회사의 사전 서면 승인 없이 다른 회사에 취업하거나 자영업·프리랜서 활동 등 겸직·겸업을 할 수 없다.
② 근로자는 회사의 제반 규정과 업무 지시를 준수하고, 성실히 근로를 제공하여야 한다.

제 11 조 [기밀유지 및 개인정보 보호]
① 근로자는 재직 중 및 퇴직 후에도 회사의 영업비밀·회원정보·매출자료·거래처 정보·요금정책·마케팅 전략·시스템 계정·비밀번호 등 일체의 기밀사항을 제3자에게 누설하거나 사적으로 이용하여서는 아니 된다.
② 본 의무는 퇴직 후 3년간 유효하다.
③ 근로자는 「개인정보보호법」에 따라 업무상 취득한 개인정보를 목적 외로 이용·제공하여서는 아니 되며, 위반 시 관련 법령상의 책임을 진다.

제 12 조 [회사 재산 및 손해배상]
① 근로자는 회사로부터 지급받은 업무용 장비(노트북·휴대폰·출입카드·문서·데이터 등) 일체를 선량한 관리자의 주의로 관리하여야 하며, 퇴직 시 지체 없이 원상태로 반환하여야 한다.
② 근로자의 고의·중과실로 회사에 손해가 발생한 경우 근로자는 그 손해를 배상할 책임을 진다.

제 13 조 [계약의 해지]
① 근로자는 퇴사하고자 하는 경우 최소 30일 전에 회사에 서면으로 통보하고, 인수인계를 완료하여야 한다.
② 근로자가 인수인계 없이 무단 퇴사하거나 인수인계 기간을 준수하지 아니하여 회사에 손해가 발생한 경우 근로자는 그 손해를 배상하여야 한다.
③ 이력서·경력 허위 기재, 정당한 업무 지시의 반복 거부·위반, 회사 명예 훼손, 영업비밀·회원정보·자산의 무단 반출·유출, 무단결근 3일 이상, 형사상 유죄 판결 등에 해당하는 경우 회사는 본 계약을 즉시 해지할 수 있다.

제 14 조 [취업규칙 및 회사 지침 준수]
본 계약에 정하지 아니한 사항은 회사의 취업규칙, 인사관리 규정, 정보보안 규정 및 관련 법령에 따른다. 회사는 필요에 따라 위 규정을 제·개정할 수 있으며, 근로자는 이를 준수한다.

제 15 조 [준거법 및 관할]
① 본 계약과 관련된 분쟁의 준거법은 대한민국 법령으로 한다.
② 본 계약과 관련하여 소송이 제기되는 경우 회사 본점 소재지를 관할하는 법원을 제1심의 전속 관할 법원으로 한다.

위 근로계약의 성실한 이행을 위하여 계약서를 작성하여 회사와 근로자가 각각 보관한다.

{{계약체결일}}`;

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const chk: any = await db.execute(sql.raw(`
      SELECT to_regclass('public.employment_contracts') AS ct,
             to_regclass('public.contract_business_entities') AS ent,
             to_regclass('public.contract_attachments') AS att
    `));
    const cur = (chk?.rows ?? chk ?? [])[0] || {};
    const tablesExist = !!cur.ct;

    let entCount = 0;
    if (cur.ent) {
      const c: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM contract_business_entities`));
      entCount = (c?.rows ?? c ?? [])[0]?.n ?? 0;
    }

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose",
        tables_exist: { employment_contracts: !!cur.ct, business_entities: !!cur.ent, attachments: !!cur.att },
        entity_count: entCount,
        hint: tablesExist
          ? "이미 초기화됨. 재실행해도 안전(멱등)."
          : "?run=1 로 실행하면 테이블 5개 생성 + 프리셋 3사 + 도장 업로드 + 양식 시드.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    const role = (auth as any).ctx?.member?.role;
    if (role !== "super_admin") {
      return new Response(jsonKST({ ok: false, error: "슈퍼어드민만 실행할 수 있습니다", role }), { status: 403, headers: JSON_HEADER });
    }

    /* ── 1) 테이블 5개 ── */
    step = "create_entities";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS contract_business_entities (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        entity_type   VARCHAR(20) NOT NULL DEFAULT 'individual',
        representative TEXT,
        biz_no        VARCHAR(30),
        address       TEXT,
        phone         VARCHAR(30),
        seal_r2_key   TEXT,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));

    step = "create_templates";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS contract_templates (
        id          SERIAL PRIMARY KEY,
        entity_id   INTEGER NOT NULL REFERENCES contract_business_entities(id),
        title       TEXT NOT NULL DEFAULT '근로계약서',
        kind        VARCHAR(30) NOT NULL DEFAULT 'employment',
        body        TEXT NOT NULL,
        version     INTEGER NOT NULL DEFAULT 1,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS contract_templates_entity_idx ON contract_templates(entity_id)`));

    step = "create_contracts";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS employment_contracts (
        id              SERIAL PRIMARY KEY,
        entity_id       INTEGER NOT NULL REFERENCES contract_business_entities(id),
        template_id     INTEGER REFERENCES contract_templates(id),
        member_id       INTEGER NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'draft',
        title           TEXT NOT NULL DEFAULT '근로계약서',
        fields          JSONB NOT NULL DEFAULT '{}'::jsonb,
        body_snapshot   TEXT,
        resident_no_enc  TEXT,
        resident_no_mask VARCHAR(20),
        company_seal_r2_key TEXT,
        company_signed_at   TIMESTAMPTZ,
        company_signed_by   INTEGER,
        employee_sig_r2_key TEXT,
        employee_sig_type   VARCHAR(10),
        employee_signed_name TEXT,
        employee_signed_at   TIMESTAMPTZ,
        employee_sign_ip     VARCHAR(64),
        employee_sign_device TEXT,
        rejected_reason  TEXT,
        rejected_at      TIMESTAMPTZ,
        document_r2_key  TEXT,
        document_sha256  TEXT,
        document_version INTEGER NOT NULL DEFAULT 1,
        voided_at        TIMESTAMPTZ,
        voided_reason    TEXT,
        voided_by        INTEGER,
        created_by       INTEGER,
        sent_at          TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS employment_contracts_member_idx ON employment_contracts(member_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS employment_contracts_status_idx ON employment_contracts(status)`));

    step = "create_sig_events";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS contract_signature_events (
        id           SERIAL PRIMARY KEY,
        contract_id  INTEGER NOT NULL REFERENCES employment_contracts(id),
        actor        VARCHAR(20) NOT NULL,
        action       VARCHAR(20) NOT NULL,
        signature_type VARCHAR(10),
        signed_name  TEXT,
        document_sha256 TEXT,
        ip           VARCHAR(64),
        user_agent   TEXT,
        meta         JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS contract_sig_events_contract_idx ON contract_signature_events(contract_id)`));

    step = "create_attachments";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS contract_attachments (
        id           SERIAL PRIMARY KEY,
        contract_id  INTEGER NOT NULL REFERENCES employment_contracts(id),
        kind         VARCHAR(30) NOT NULL DEFAULT 'etc',
        label        TEXT,
        blob_id      INTEGER,
        blob_key     TEXT,
        file_name    TEXT,
        mime_type    VARCHAR(100),
        size_bytes   INTEGER,
        uploaded_by  INTEGER,
        uploaded_role VARCHAR(20),
        deleted_at   TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS contract_attachments_contract_idx ON contract_attachments(contract_id)`));

    /* ── 2) 박두용 도장 R2 업로드 (멱등: 이미 올린 것 재사용) ── */
    step = "upload_seal";
    let sealKey: string | null = null;
    const sealWarn: string[] = [];
    try {
      const existingSeal: any = await db.execute(sql.raw(`
        SELECT seal_r2_key FROM contract_business_entities
         WHERE seal_r2_key IS NOT NULL LIMIT 1
      `));
      const prev = (existingSeal?.rows ?? existingSeal ?? [])[0]?.seal_r2_key;
      if (prev) {
        sealKey = prev;
      } else {
        const buf = readFileSync(join(process.cwd(), "assets", "seals", "seal-park-duyong.png"));
        const up = await uploadToR2({
          buffer: buf,
          originalName: "seal-park-duyong.png",
          mimeType: "image/png",
          context: "contract-seal",
          isPublic: false,
          expiresInDays: null,
        });
        if (up.ok && up.blobKey) sealKey = up.blobKey;
        else sealWarn.push("도장 R2 업로드 실패: " + (up.error || "unknown"));
      }
    } catch (e: any) {
      sealWarn.push("도장 파일 로드 실패: " + String(e?.message || e).slice(0, 150));
    }

    /* ── 3) 프리셋 사업자 3사 시드 (이름 중복 검사) ── */
    step = "seed_entities";
    const PRESETS = [
      { name: "(사)교사유가족협의회", entity_type: "corporation", representative: "박두용", biz_no: "1188271215", address: process.env.ORG_ADDRESS || "", phone: process.env.ORG_PHONE || "", seal: null,    sort: 1 },
      { name: "함께워크 ON",         entity_type: "individual",  representative: "박두용", biz_no: "744-35-01509", address: "서울특별시 강서구 공항대로 426, VIP오피스텔 6층 618·619호", phone: "", seal: sealKey, sort: 2 },
      { name: "함께워크 SI",         entity_type: "individual",  representative: "박두용", biz_no: "",             address: "", phone: "", seal: sealKey, sort: 3 },
    ];
    const seededEntities: { id: number; name: string }[] = [];
    for (const p of PRESETS) {
      const ex: any = await db.execute(sql`SELECT id FROM contract_business_entities WHERE name = ${p.name} LIMIT 1`);
      let id = (ex?.rows ?? ex ?? [])[0]?.id;
      if (!id) {
        const ins: any = await db.execute(sql`
          INSERT INTO contract_business_entities (name, entity_type, representative, biz_no, address, phone, seal_r2_key, sort_order)
          VALUES (${p.name}, ${p.entity_type}, ${p.representative}, ${p.biz_no}, ${p.address}, ${p.phone}, ${p.seal}, ${p.sort})
          RETURNING id
        `);
        id = (ins?.rows ?? ins ?? [])[0]?.id;
      } else if (p.seal) {
        /* 이미 있고 도장이 비어 있으면 채운다 (멱등 보강) */
        await db.execute(sql`UPDATE contract_business_entities SET seal_r2_key = COALESCE(seal_r2_key, ${p.seal}) WHERE id = ${id}`);
      }
      if (id) seededEntities.push({ id: Number(id), name: p.name });
    }

    /* ── 4) 각 사업자에 ON 초안 양식 시드 (양식 없을 때만) ── */
    step = "seed_templates";
    let templatesSeeded = 0;
    for (const e of seededEntities) {
      const ex: any = await db.execute(sql`SELECT id FROM contract_templates WHERE entity_id = ${e.id} LIMIT 1`);
      if ((ex?.rows ?? ex ?? []).length === 0) {
        await db.execute(sql`
          INSERT INTO contract_templates (entity_id, title, kind, body, version, is_active)
          VALUES (${e.id}, ${"정규직 근로계약서"}, ${"employment"}, ${CONTRACT_BODY}, 1, TRUE)
        `);
        templatesSeeded++;
      }
    }

    /* ── 5) 권한 시드 ── */
    step = "seed_permission";
    await db.execute(sql.raw(`
      INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed)
      VALUES ('contract_manage', '근로계약 관리(전자계약·사업자·양식)', 'ops', false, false)
      ON CONFLICT (feature_key) DO NOTHING
    `));

    return new Response(jsonKST({
      ok: true, mode: "executed",
      tables: ["contract_business_entities", "contract_templates", "employment_contracts", "contract_signature_events", "contract_attachments"],
      entities_seeded: seededEntities,
      templates_seeded: templatesSeeded,
      seal_uploaded: !!sealKey,
      seal_warnings: sealWarn,
      hint: "성공 확인 후 알려주세요. schema.ts 정의 추가 + 백엔드/프론트 진행 + 이 파일 삭제.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
