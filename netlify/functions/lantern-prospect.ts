// netlify/functions/lantern-prospect.ts
// POST /api/lantern-prospect — «숭고한 등불» 랜딩(AutoMarketing)에서 등불을 켠 사람을 잠재 후원자 명단에 넣는다
//   (서버-서버 · 쿠키 0 · 개인정보 파일 주고받기 대신 — 사장님 결정 2026-11-12)
//
// 헤더: x-am-secret = SIREN_AM_POSTBACK_SECRET (lantern-member 와 같은 길·checkAmSecret)
// body: {
//   marketingConsent: boolean(필수) — 소식·회원 안내 수신 선택 동의 여부
//   consentAt?: ISO 8601(시간대 포함) · consentText?: 1000자 이내 — marketingConsent=true 면 둘 다 필수
//   privacyConsentText?: 1000자 이내(필수 동의 문구 스냅샷) · note?: 한 줄 마음(줄바꿈 제거·60자)
//   name?: 50자(닉네임 가능) · phone? · email?
//   source?: { slug?: 80자, lanternId?: string|number 64자 } · idempotencyKey?: 120자 · ip? · ua?(있으면 증빙에 남김)
// }
// → 200 { ok:true, prospectId, status:"new"|"existing" } | 200 { ok:true, status:"skipped", reason:"no_contact" }
//   4xx { ok:false, error, step } · 500 { ok:false, error, step, detail }
//
// 규칙
//  - 전원을 잠재 후원자(potential_donors) «숭고한 등불» 참여자로 쌓는다. 유입 경로 = «숭고한 등불 랜딩».
//  - 같은 사람 = 같은 이벤트 안에서 휴대폰(숫자만) 또는 이메일(소문자)이 같은 행. 같은 등불(lanternId)·같은 요청(idempotencyKey)도 같은 행.
//    있으면 새 행 없이 빈 칸만 채우고 «existing», 없으면 새로 넣고 «new». 동시에 들어와도 한 행(확인키별 트랜잭션 잠금).
//  - 수신 동의: true 가 false 를 이긴다. 전에 true 였던 사람이 false 로 다시 와도 철회하지 않는다(철회는 기존 수신거부 경로로만).
//    false 였던 사람이 true 로 오면 동의로 바꾸고 시각(메모)·문구(감사 로그)를 갱신한다.
//  - ★ 수신 비동의(false) 행에는 휴대폰·이메일 칸을 비워 둔다. 잠재 후원자 표에는 수신 동의·거부 칸이 없고,
//    발송 쪽은 «잠재 행에 연락처가 있으면 동의한 사람»으로 보고 문자·카톡·메일 동의를 켠 리드 회원을 만든다
//    (너처링 잠재 동기화 syncPotentialLeads · 이벤트 수신자 그룹 ensureLeadMembersForEvents · 운영자 단계 이동).
//    그래서 연락처는 칸에 넣지 않고, 같은 사람 판정용 확인키(서버 비밀값 HMAC — 되돌릴 수 없음)만 메모 끝줄에 남긴다.
//    나중에 true 로 다시 오면 그때 연락처 칸을 채운다.
//  - 휴대폰·이메일이 둘 다 없으면 idempotencyKey 또는 source.lanternId 를 확인키로 삼아 한 행만 저장한다.
//    그마저 없으면 같은 사람을 가릴 방법이 없어 저장하지 않는다(200 skipped · no_contact).
//  - 기존 회원과 자동으로 짝짓지 않는다(관리자 등록 경로 admin-potential-donor-crud 에도 없음).
//  - 동의 증빙: audit_logs(action prospect_consent · target PD-<id>) — 문구 스냅샷·시각·등불·슬러그·멱등키·ip·ua.
//  - 공개 입력(이름·한 줄 마음)은 관리자 화면에 그대로 그려지므로 따옴표·꺾쇠·제어문자를 걷어 낸다
//    (통합 CMS 잠재 표가 이름을 onclick 속 JS 문자열에 넣는다 — 따옴표가 남으면 관리자 화면에서 스크립트 실행 위험).

import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { checkAmSecret } from "../../lib/lantern";
import { normalizePhone, isValidEmail } from "../../lib/sponsor-member";
import { logAudit } from "../../lib/audit";
import { dateKST, hhmmKST } from "../../lib/kst";

export const config = { path: "/api/lantern-prospect" };

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

const EVENT_NAME = "숭고한 등불";
const ENTRY_PATH = "숭고한 등불 랜딩";
const FALLBACK_NAME = "등불 참여자";            // potential_donors.name 은 NOT NULL — 이름 없이 온 사람
const TAG = "[숭고한 등불]";                     // 메모의 관리 줄 머리
const NOTE_PREFIX = `${TAG} 한 줄 마음: `;
const KEY_TAG = "[등불 확인키·지우지 마세요]";    // 같은 사람 판정용 확인키 줄(메모 끝)
const TOKEN_RE = /\{[peil]:[0-9a-f]{16}\}/g;

/* ───────── 입력 정리 ───────── */
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁩﻿]/g;   // 폭 없는 문자·방향 바꾸기 문자
const HAS_CONTROL_RE = /[\u0000-\u001F\u007F]/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** 문자 수(코드 포인트) — DB varchar(n)·«n자 이내»와 같은 기준 */
function charLen(s: string): number {
  return Array.from(s).length;
}
function cutChars(s: string, n: number): string {
  return Array.from(s).slice(0, n).join("");
}

/** 이름·닉네임 — 관리자 화면 JS 문자열·CSV 수식에 안전하게 */
function cleanName(v: string): string | null {
  const s = v.replace(CONTROL_RE, " ").replace(INVISIBLE_RE, "").replace(/[<>"'`\\]/g, "")
    .replace(/\s+/g, " ").trim().replace(/^[=+\-@]+/, "").trim();
  const out = cutChars(s, 50).trim();
  return out || null;
}

/** 한 줄 마음 — 줄바꿈 제거·60자 */
function cleanNote(v: string): string | null {
  const s = v.replace(/[\r\n\t]+/g, " ").replace(CONTROL_RE, " ").replace(INVISIBLE_RE, "").replace(/[<>]/g, "")
    .replace(/\s+/g, " ").trim();
  const out = cutChars(s, 60).trim();
  return out || null;
}

/** 동의 문구 스냅샷 — 줄바꿈·탭은 살리고 보이지 않는 제어문자만 뺀다 */
function cleanConsentText(v: string): string {
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

interface ProspectInput {
  marketingConsent: boolean;
  name: string | null;
  phone: string | null;        // 010-1234-5678 (normalizePhone)
  phoneDigits: string;         // 01012345678 (없으면 "")
  email: string | null;        // 소문자
  consentAt: Date | null;
  consentAtRaw: string | null;
  consentText: string | null;
  privacyConsentText: string | null;
  note: string | null;
  slug: string | null;
  lanternId: string | null;
  idempotencyKey: string | null;
  ip: string | null;
  ua: string | null;
}

type Parsed = { ok: true; input: ProspectInput } | { ok: false; error: string };

/** 선택 문자열 칸 — 없음(undefined·null)이면 "", 문자열이 아니면 오류 */
function optString(body: any, key: string): string | { error: string } {
  const v = body?.[key];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return { error: `${key}는 문자열이어야 합니다` };
  return v;
}

function parseProspectInput(body: any): Parsed {
  if (typeof body.marketingConsent !== "boolean") {
    return { ok: false, error: "marketingConsent(소식·회원 안내 수신 동의 여부)는 true 또는 false로 보내 주세요" };
  }
  const marketingConsent = body.marketingConsent === true;

  const raw: Record<string, string> = {};
  for (const key of ["name", "phone", "email", "consentAt", "consentText", "privacyConsentText", "note", "idempotencyKey", "ip", "ua"]) {
    const v = optString(body, key);
    if (typeof v !== "string") return { ok: false, error: v.error };
    raw[key] = v;
  }

  /* 연락처 — 하나라도 보냈다면 하나 이상은 형식이 맞아야 한다(맞지 않는 다른 하나는 버림). 둘 다 없으면 연락처 없는 참여자 */
  const phoneRaw = raw.phone.trim();
  const emailRaw = raw.email.trim().toLowerCase();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const email = emailRaw && isValidEmail(emailRaw) && emailRaw.length <= 100 ? emailRaw : null;
  if ((phoneRaw || emailRaw) && !phone && !email) {
    return { ok: false, error: "휴대폰 번호(예: 010-1234-5678) 또는 이메일 형식이 올바르지 않습니다" };
  }

  /* 수신 동의 시각 — 보냈다면 ISO 8601(시간대 포함)·말이 되는 시각이어야 한다 */
  const consentAtRaw = raw.consentAt.trim();
  let consentAt: Date | null = null;
  if (consentAtRaw) {
    const t = ISO_RE.test(consentAtRaw) ? Date.parse(consentAtRaw) : NaN;
    if (!Number.isFinite(t) || t < Date.UTC(2020, 0, 1) || t > Date.now() + 24 * 3_600_000) {
      return { ok: false, error: "consentAt은 시간대가 붙은 ISO 8601 시각이어야 합니다 (예: 2026-11-12T03:00:00.000Z)" };
    }
    consentAt = new Date(t);
  }

  const consentText = cleanConsentText(raw.consentText);
  if (charLen(consentText) > 1000) return { ok: false, error: "consentText는 1000자 이내여야 합니다" };
  const privacyConsentText = cleanConsentText(raw.privacyConsentText);
  if (charLen(privacyConsentText) > 1000) return { ok: false, error: "privacyConsentText는 1000자 이내여야 합니다" };

  if (marketingConsent && (!consentAt || !consentText.trim())) {
    return { ok: false, error: "수신 동의(marketingConsent=true)에는 consentAt(동의 시각)과 consentText(동의 문구)가 필요합니다" };
  }

  /* source — { slug?, lanternId? } */
  const source = body.source;
  if (source !== undefined && source !== null && (typeof source !== "object" || Array.isArray(source))) {
    return { ok: false, error: "source는 { slug, lanternId } 형태여야 합니다" };
  }
  let slug: string | null = null;
  if (source?.slug !== undefined && source?.slug !== null) {
    if (typeof source.slug !== "string") return { ok: false, error: "source.slug는 문자열이어야 합니다" };
    const s = source.slug.trim();
    if (charLen(s) > 80 || HAS_CONTROL_RE.test(s)) return { ok: false, error: "source.slug는 80자 이내여야 합니다" };
    slug = s || null;
  }
  let lanternId: string | null = null;
  if (source?.lanternId !== undefined && source?.lanternId !== null) {
    const v = source.lanternId;
    if (!(typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))) {
      return { ok: false, error: "source.lanternId는 문자열 또는 숫자여야 합니다" };
    }
    const s = String(v).trim();
    if (charLen(s) > 64 || HAS_CONTROL_RE.test(s) || /\s/.test(s)) {
      return { ok: false, error: "source.lanternId는 공백 없는 64자 이내여야 합니다" };
    }
    lanternId = s || null;
  }

  const idem = raw.idempotencyKey.trim();
  if (charLen(idem) > 120 || HAS_CONTROL_RE.test(idem)) return { ok: false, error: "idempotencyKey는 120자 이내여야 합니다" };

  const ip = raw.ip.trim();
  const ua = raw.ua.replace(CONTROL_RE, " ").trim();

  return {
    ok: true,
    input: {
      marketingConsent,
      name: raw.name ? cleanName(raw.name) : null,
      phone,
      phoneDigits: phone ? phone.replace(/[^0-9]/g, "") : "",
      email,
      consentAt,
      consentAtRaw: consentAtRaw || null,
      consentText: consentText.trim() ? consentText : null,
      privacyConsentText: privacyConsentText.trim() ? privacyConsentText : null,
      note: raw.note ? cleanNote(raw.note) : null,
      slug,
      lanternId,
      idempotencyKey: idem || null,
      ip: /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null,      // 형식이 이상하면 증빙에서만 뺀다
      ua: ua ? ua.slice(0, 500) : null,
    },
  };
}

/* ───────── 같은 사람 확인키 ─────────
   {p:…} 휴대폰 숫자 · {e:…} 이메일 · {i:…} 멱등키 · {l:…} 등불 번호 — 서버 비밀값 HMAC 앞 16자리(되돌릴 수 없음).
   비밀값이 바뀌면 그 뒤로는 옛 확인키와 맞지 않는다(그때는 연락처 칸으로만 판정). */
function tokenSecret(): string {
  return process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "tbfa-lantern-prospect";
}
function keyToken(kind: "p" | "e" | "i" | "l", value: string): string {
  const h = crypto.createHmac("sha256", tokenSecret()).update(`lantern-prospect:${kind}:${value}`).digest("hex").slice(0, 16);
  return `{${kind}:${h}}`;
}
function buildTokens(input: ProspectInput): string[] {
  const out: string[] = [];
  if (input.phoneDigits) out.push(keyToken("p", input.phoneDigits));
  if (input.email) out.push(keyToken("e", input.email));
  if (input.idempotencyKey) out.push(keyToken("i", input.idempotencyKey));
  if (input.lanternId) out.push(keyToken("l", input.lanternId));
  return out;
}
/** 확인키 → advisory lock 번호(부호 있는 64비트). 정렬해서 잡으면 교착이 없다 */
function lockIdOf(token: string): bigint {
  const hex = token.slice(3, 19);
  return BigInt.asIntN(64, BigInt("0x" + hex));
}

/* ───────── 메모(관리 줄) ─────────
   [숭고한 등불] 등불 #<lanternId> · 수신 동의 2026-11-12 12:00        ← 동의(시각은 KST)
   [숭고한 등불] 등불 #<lanternId> · 수신 동의 안 함 — 연락 금지      ← 비동의
   [숭고한 등불] 한 줄 마음: …
   [등불 확인키·지우지 마세요] {p:…} {e:…} {i:…} {l:…}
   운영자가 적은 다른 줄은 그대로 둔다. */
function lanternLabel(lanternId: string | null): string {
  return lanternId ? `등불 #${lanternId.replace(/[<>"'`\\]/g, "")} · ` : "";
}
function statusLineOf(consented: boolean, input: ProspectInput): string {
  if (consented && input.consentAt) {
    return `${TAG} ${lanternLabel(input.lanternId)}수신 동의 ${dateKST(input.consentAt)} ${hhmmKST(input.consentAt)}`;
  }
  return `${TAG} ${lanternLabel(input.lanternId)}수신 동의 안 함 — 연락 금지`;
}
function isStatusLine(line: string): boolean {
  return line.startsWith(TAG) && !line.startsWith(NOTE_PREFIX) && line.includes("수신 동의");
}
/** 메모에 남은 수신 동의 상태 — 관리 줄이 없으면 unknown(다른 경로로 들어온 행) */
function memoConsentState(memo: string | null): "yes" | "no" | "unknown" {
  const line = String(memo || "").split(/\r?\n/).find(isStatusLine);
  if (!line) return "unknown";
  return line.includes("수신 동의 안 함") ? "no" : "yes";
}
function buildMemo(prev: string | null, upd: { status?: string | null; note?: string | null; tokens: string[] }): string {
  const prevText = String(prev || "");
  const tokens = new Set<string>(prevText.match(TOKEN_RE) || []);
  for (const t of upd.tokens) tokens.add(t);
  const lines = prevText ? prevText.split(/\r?\n/).filter((l) => !l.startsWith(KEY_TAG)) : [];
  if (upd.status) {
    const i = lines.findIndex(isStatusLine);
    if (i >= 0) lines[i] = upd.status;
    else lines.unshift(upd.status);
  }
  if (upd.note) {
    const noteLine = NOTE_PREFIX + upd.note;
    if (!lines.includes(noteLine)) lines.push(noteLine);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (tokens.size) lines.push(`${KEY_TAG} ${[...tokens].join(" ")}`);
  return lines.join("\n");
}

/* ───────── 저장(트랜잭션) ───────── */
interface SaveResult {
  id: number;
  status: "new" | "existing";
  audit: boolean;                          // 같은 멱등키 재전송이면 증빙을 다시 남기지 않는다
  prevConsent: "yes" | "no" | "unknown" | null;
  consentAfter: "yes" | "no" | "unknown";
}

async function saveProspect(input: ProspectInput, tokens: string[], setStep: (s: string) => void): Promise<SaveResult> {
  /* DB 연결이 1개(max:1)라 트랜잭션 안에서는 반드시 tx 로만 조회한다(전역 db 를 부르면 서로 기다리다 멈춘다) */
  return db.transaction(async (tx) => {
    setStep("lock");
    const lockIds = [...new Set(tokens.map(lockIdOf).map(String))]
      .map((s) => BigInt(s))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    await tx.execute(sql`SELECT ${sql.join(lockIds.map((id) => sql`pg_advisory_xact_lock(${id.toString()}::bigint)`), sql`, `)}`);

    setStep("select_existing");
    const tokenMatch = sql.join(tokens.map((t) => sql`strpos(COALESCE(memo, ''), ${t}) > 0`), sql` OR `);
    const found = rowsOf(await tx.execute(sql`
      SELECT id, name, phone, email, memo
        FROM potential_donors
       WHERE event_name = ${EVENT_NAME}
         AND (
           (${input.phoneDigits}::text <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${input.phoneDigits})
           OR (${input.email || ""}::text <> '' AND LOWER(TRIM(COALESCE(email, ''))) = ${input.email || ""})
           OR (${tokenMatch})
         )
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE`))[0];

    const participatedIso = (input.consentAt || new Date()).toISOString();

    if (found) {
      const id = Number(found.id);
      const prevMemo: string | null = found.memo ?? null;
      const prevConsent = memoConsentState(prevMemo);

      /* 같은 멱등키 재전송 — 이미 반영됨. 아무것도 바꾸지 않는다 */
      const idemToken = input.idempotencyKey ? keyToken("i", input.idempotencyKey) : "";
      if (idemToken && String(prevMemo || "").includes(idemToken)) {
        return { id, status: "existing", audit: false, prevConsent, consentAfter: prevConsent };
      }

      setStep("update");
      /* true 가 false 를 이긴다 — true 면 동의 줄을 새 시각으로, false 면 동의 상태는 건드리지 않는다.
         관리 줄이 없는 행(다른 경로로 들어온 행)에 false 가 와도 «연락 금지»를 덧붙이지 않는다(철회는 수신거부 경로로만). */
      const status = input.marketingConsent ? statusLineOf(true, input) : null;
      const memo = buildMemo(prevMemo, { status, note: input.note, tokens });
      /* 연락처 칸은 수신 동의(true)일 때만, 비어 있을 때만 채운다 */
      const fillPhone = input.marketingConsent ? input.phone : null;
      const fillEmail = input.marketingConsent ? input.email : null;
      await tx.execute(sql`
        UPDATE potential_donors SET
          name = CASE WHEN ${input.name}::text IS NOT NULL AND (COALESCE(TRIM(name), '') = '' OR name = ${FALLBACK_NAME})
                      THEN ${input.name} ELSE name END,
          phone = CASE WHEN ${fillPhone}::text IS NOT NULL AND COALESCE(TRIM(phone), '') = '' THEN ${fillPhone} ELSE phone END,
          email = CASE WHEN ${fillEmail}::text IS NOT NULL AND COALESCE(TRIM(email), '') = '' THEN ${fillEmail} ELSE email END,
          participated_at = COALESCE(participated_at, ${participatedIso}::timestamptz),
          entry_path = CASE WHEN COALESCE(TRIM(entry_path), '') = '' THEN ${ENTRY_PATH} ELSE entry_path END,
          memo = ${memo},
          updated_at = NOW()
        WHERE id = ${id}`);
      const consentAfter = input.marketingConsent ? "yes" : prevConsent;
      return { id, status: "existing", audit: true, prevConsent, consentAfter };
    }

    setStep("insert");
    const consented = input.marketingConsent;
    const memo = buildMemo(null, { status: statusLineOf(consented, input), note: input.note, tokens });
    const ins = rowsOf(await tx.execute(sql`
      INSERT INTO potential_donors (name, phone, email, event_name, participated_at, entry_path, memo, created_at, updated_at)
      VALUES (${input.name || FALLBACK_NAME},
              ${consented ? input.phone : null}, ${consented ? input.email : null},
              ${EVENT_NAME}, ${participatedIso}::timestamptz, ${ENTRY_PATH}, ${memo}, NOW(), NOW())
      RETURNING id`))[0];
    const id = Number(ins?.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("새 행 번호(RETURNING id)를 읽지 못했습니다");
    return { id, status: "new", audit: true, prevConsent: null, consentAfter: consented ? "yes" : "no" };
  });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-am-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json({ ok: false, error: "POST만 허용", step: "method" }, 405);
  if (!checkAmSecret(req)) return json({ ok: false, error: "인증 실패(x-am-secret)", step: "auth" }, 401);

  let body: any = null;
  try { body = await req.json(); } catch { /* noop */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "요청 본문이 비어있습니다", step: "parse" }, 400);

  const parsed = parseProspectInput(body);
  if (parsed.ok === false) return json({ ok: false, error: parsed.error, step: "validate" }, 400);
  const input = parsed.input;

  /* 휴대폰·이메일·멱등키·등불 번호가 모두 없으면 같은 등불이 두 번 와도 한 행으로 막을 방법이 없다 → 저장하지 않음 */
  const tokens = buildTokens(input);
  if (!tokens.length) {
    console.log("[lantern-prospect] skipped: 연락처·멱등키·등불 번호 없음");
    return json({ ok: true, status: "skipped", reason: "no_contact" });
  }

  let step = "transaction";
  try {
    const r = await saveProspect(input, tokens, (s) => { step = s; });

    step = "audit";
    if (r.audit) {
      /* 동의 증빙 — 연락처 값은 남기지 않는다(행 PD-<id>와 확인키로 잇는다). logAudit 은 실패해도 throw 하지 않는다 */
      await logAudit({
        userId: null,
        userType: "anonymous",
        userName: input.name,
        action: "prospect_consent",
        target: `PD-${r.id}`,
        detail: {
          source: "am_lantern_landing",
          event: EVENT_NAME,
          status: r.status,
          marketingConsent: input.marketingConsent,
          consentBefore: r.prevConsent,          // 이 요청 전 메모의 수신 동의 상태(새 행이면 null)
          consentAfter: r.consentAfter,          // true 가 false 를 이긴 결과
          consentAt: input.consentAtRaw,
          consentText: input.consentText,
          privacyConsentText: input.privacyConsentText,
          lanternId: input.lanternId,
          slug: input.slug,
          idempotencyKey: input.idempotencyKey,
          contact: { phone: !!input.phone, email: !!input.email },
          keys: tokens,
          receivedAt: new Date().toISOString(),
        },
        ipAddress: input.ip,
        userAgent: input.ua,
      });
    }

    console.log(`[lantern-prospect] PD-${r.id} ${r.status} (수신 동의 ${r.consentAfter})`);
    return json({ ok: true, prospectId: r.id, status: r.status });
  } catch (e: any) {
    const detail = String(e?.message || e).slice(0, 300);
    console.error(`[lantern-prospect] ${step} 실패: ${detail}`);
    return json({ ok: false, error: "잠재 후원자 등록 중 오류가 발생했습니다", step, detail }, 500);
  }
};
