/**
 * lib/milestone-roles.ts — 역할 카탈로그 (milestone_roles) 헬퍼
 *
 * R39 Stage 2: 백엔드 검증·라벨 매핑이 코드 상수 → DB 동적 전환.
 *
 * - loadActiveRoles(): 활성 역할 일람 (간단 in-memory 캐시·30초 TTL)
 * - loadRoleLabelMap(): code → name 매핑 (CSV·표시용)
 * - isValidRoleCode(code): 코드 유효성 (활성만)
 * - invalidateRoleCache(): 변경 직후 캐시 무효화
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export interface RoleRow {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

const CACHE_TTL_MS = 30_000; // 30초 — 라벨·검증 둘 다 매 요청 SELECT 비용 회피
let _cacheAt = 0;
let _cacheRows: RoleRow[] | null = null;

export function invalidateRoleCache(): void {
  _cacheAt = 0;
  _cacheRows = null;
}

async function loadFromDb(includeInactive: boolean): Promise<RoleRow[]> {
  const res = includeInactive
    ? await db.execute(sql`
        SELECT code, name, description, sort_order, is_active
        FROM milestone_roles
        ORDER BY sort_order, id
      `)
    : await db.execute(sql`
        SELECT code, name, description, sort_order, is_active
        FROM milestone_roles
        WHERE is_active = TRUE
        ORDER BY sort_order, id
      `);
  const rows = ((res as any).rows ?? res) as any[];
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    isActive: Boolean(r.is_active),
  }));
}

/** 활성 역할 일람 — 캐시 적용 (호출자가 includeInactive=true 주면 캐시 우회) */
export async function loadActiveRoles(): Promise<RoleRow[]> {
  const now = Date.now();
  if (_cacheRows && now - _cacheAt < CACHE_TTL_MS) return _cacheRows;
  const rows = await loadFromDb(false);
  _cacheRows = rows;
  _cacheAt = now;
  return rows;
}

/** 모든 역할(비활성 포함) 직접 DB 조회 — 관리 화면용·캐시 미적용 */
export async function loadAllRoles(): Promise<RoleRow[]> {
  return loadFromDb(true);
}

/** code → name 매핑 (활성만) */
export async function loadRoleLabelMap(): Promise<Record<string, string>> {
  const rows = await loadActiveRoles();
  const m: Record<string, string> = {};
  for (const r of rows) m[r.code] = r.name;
  return m;
}

/** 코드 유효성 — 활성 역할 코드 또는 null/빈값 허용 */
export async function isValidRoleCode(code: unknown): Promise<boolean> {
  if (code === null || code === undefined || code === "") return true;
  if (typeof code !== "string") return false;
  const rows = await loadActiveRoles();
  return rows.some((r) => r.code === code);
}

/** 역할 코드 형식 검증 — 영문 대문자 2~10자 */
export function isValidRoleCodeFormat(code: string): boolean {
  return /^[A-Z]{2,10}$/.test(code);
}
