import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@netlify/neon";
import * as schema from "./schema";

/* =========================================================
   Netlify Neon Postgres 연결
   - NETLIFY_DATABASE_URL 환경변수는 Netlify가 자동 주입
   ========================================================= */
const sql = neon();
export const db = drizzle(sql, { schema });

/* =========================================================
   유틸리티 export
   ========================================================= */
export * from "./schema";
export { sql };

/* =========================================================
   ID 생성 유틸 (지원신청번호 등)
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