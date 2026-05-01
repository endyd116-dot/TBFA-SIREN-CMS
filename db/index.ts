import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/* =========================================================
   PostgreSQL 연결 (postgres-js — 서버리스 최적화)
   ========================================================= */
const databaseUrl =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

if (!databaseUrl) {
  console.error("[DB] NETLIFY_DATABASE_URL 환경변수가 없습니다");
}

/* 서버리스: connection pool은 1개로 제한, prepared statements 비활성화 */
const queryClient = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });

/* =========================================================
   유틸리티 export
   ========================================================= */
export * from "./schema";

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