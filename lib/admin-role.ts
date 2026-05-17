const ROLE_RANK: Record<string, number> = {
  super_admin: 3,
  admin: 2,
  operator: 1,
};

export type AdminRole = "super_admin" | "admin" | "operator";

export function requireRole(
  member: { role?: string | null },
  minRole: AdminRole
): boolean {
  const rank = ROLE_RANK[member.role ?? ""] ?? 0;
  return rank >= ROLE_RANK[minRole];
}

export function roleForbidden(requiredRole: AdminRole): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: `${requiredRole} 권한이 필요합니다`,
      step: "role_check",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}
