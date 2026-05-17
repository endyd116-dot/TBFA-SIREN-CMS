import { db } from "../db";
import { rolePermissions } from "../db/schema";

/* 권한 캐시 (5분 TTL — Netlify Function 재시작 시 자동 초기화) */
let _cache: Map<string, { adminAllowed: boolean; operatorAllowed: boolean }> | null = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getPermissionMap() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  try {
    const rows = await db.select().from(rolePermissions);
    _cache = new Map(rows.map(r => [
      r.featureKey,
      { adminAllowed: r.adminAllowed, operatorAllowed: r.operatorAllowed },
    ]));
    _cacheAt = Date.now();
  } catch {
    _cache = _cache || new Map();
  }
  return _cache;
}

/**
 * 해당 역할이 기능을 사용할 수 있는지 확인.
 * super_admin은 항상 허용.
 * DB에 featureKey가 없으면 admin 허용 / operator 불가 (기본값).
 */
export async function canAccess(role: string, featureKey: string): Promise<boolean> {
  if (role === "super_admin") return true;
  const map = await getPermissionMap();
  const perm = map.get(featureKey);
  if (!perm) return role === "admin"; // 미등록 기능: admin 허용, operator 불가
  if (role === "admin") return perm.adminAllowed;
  if (role === "operator") return perm.operatorAllowed;
  return false;
}

/** 캐시 강제 초기화 (권한 정책 저장 후 호출) */
export function invalidatePermissionCache() {
  _cache = null;
}
