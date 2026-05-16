/**
 * 1회용 마이그레이션 — 효성 후원자 사이트 가입 흐름 A안 D1
 *
 * 새 테이블 phone_verifications — 회원가입·로그인 시 전화번호 SMS 인증 코드 저장.
 *
 * 흐름:
 *   POST /api/auth/phone-verify-send → 6자리 code 생성 + SMS 발송 + INSERT
 *   POST /api/auth/phone-verify-check → code 확인 → verifyToken 발급 + matchedMemberId 결정
 *   POST /api/auth/signup (verifyToken 포함) → matchedMemberId 있으면 UPDATE / 없으면 INSERT
 *
 * GET           : 진단
 * GET ?run=1    : 어드민 인증 후 실행 (멱등 — IF NOT EXISTS)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phone-verifications" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      will_create_table: "phone_verifications",
      columns: [
        "id (bigserial PK)",
        "phone (varchar 20, 순숫자 저장)",
        "code (varchar 10, 6자리 SMS 인증 코드)",
        "verify_token (varchar 64, 코드 검증 후 발급 UUID)",
        "matched_member_id (integer FK, 매칭된 기존 회원 — 효성 후원자 등)",
        "verified (boolean, 코드 확인 완료 여부)",
        "attempts (integer, 코드 입력 시도 횟수 — 5회 초과 시 차단)",
        "expires_at (timestamp, 코드 만료 — 5분)",
        "token_expires_at (timestamp, verifyToken 만료 — 10분)",
        "ip (varchar 45, 발송 IP — rate limit 추적)",
        "created_at (timestamp)",
      ],
      indexes: ["phone (rate limit 조회)", "verify_token (토큰 검증)", "expires_at (cleanup)"],
      note: "GET ?run=1 로 어드민 인증 후 실제 적용",
    }, null, 2), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, fn: () => Promise<void>) {
    try {
      await fn();
      results.push({ step, result: "ok" });
    } catch (e: any) {
      results.push({ step, result: `error: ${String(e?.message || e).slice(0, 300)}` });
    }
  }

  await run("create_table", async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS phone_verifications (
        id                BIGSERIAL PRIMARY KEY,
        phone             VARCHAR(20)  NOT NULL,
        code              VARCHAR(10)  NOT NULL,
        verify_token      VARCHAR(64),
        matched_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        verified          BOOLEAN      NOT NULL DEFAULT FALSE,
        attempts          INTEGER      NOT NULL DEFAULT 0,
        expires_at        TIMESTAMP    NOT NULL,
        token_expires_at  TIMESTAMP,
        ip                VARCHAR(45),
        created_at        TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
  });

  await run("idx_phone", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS phone_verifs_phone_idx ON phone_verifications (phone, created_at DESC)`);
  });
  await run("idx_token", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS phone_verifs_token_idx ON phone_verifications (verify_token) WHERE verify_token IS NOT NULL`);
  });
  await run("idx_expires", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS phone_verifs_expires_idx ON phone_verifications (expires_at)`);
  });

  const ok = results.every(r => r.result === "ok");
  return new Response(JSON.stringify({
    ok, applied: results,
    next_steps: ok ? [
      "1) 본 마이그레이션 호출 결과를 메인 채팅에 알려주세요",
      "2) 메인이 schema.ts에 phoneVerifications 정의 활성화 + 인증 API 2개·signup 분기·프론트 작성",
      "3) 마이그레이션 파일은 다음 push에 삭제됨",
    ] : ["오류 항목 메인 채팅에 보고"],
  }, null, 2), { status: ok ? 200 : 500, headers: JSON_HEADER });
};
