import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/* =========================================================
   Neon Postgres 연결 (HTTP fetch 기반 — 서버리스 최적)
   ========================================================= */
const databaseUrl =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

if (!databaseUrl) {
  console.error("[DB] NETLIFY_DATABASE_URL 환경변수가 없습니다");
}

const sql = neon(databaseUrl);
export const db = drizzle(sql, { schema });

/* =========================================================
   유틸리티 export
   ========================================================= */
export * from "./schema";
export { sql };

/* =========================================================
   ID 생성 유틸
   ========================================================= */
export function generateRequestNo(prefix: string = "S"): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${year}-${month}${rand}`;
}

export function generateTransactionId(): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `TX-${ts}-${rand}`;
}