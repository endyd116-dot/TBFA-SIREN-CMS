// lib/recipient-resolve.ts
// Phase 10 R2 — 수신자 그룹 criteria → 회원 ID/정보 변환 헬퍼
//
// 두 가지 criteria 타입:
//   - filter: 동적 WHERE 조립 (eq·ne·in·notIn·lte·gte)
//   - manual: memberIds 배열 IN 절
//
// 화이트리스트(§2.4):
//   type, status, gradeId, gradeCode, hasActiveRegularDonation,
//   hadOneTimeDonationDays, campaignId, donationStatus, blacklisted

import { sql } from "drizzle-orm";
import { db } from "../db";

/* =========================================================
   타입
   ========================================================= */

export type FilterField =
  | "type"
  | "status"
  | "gradeCode"
  | "gradeId"
  | "hasActiveRegularDonation"
  | "hadOneTimeDonationDays"
  | "campaignId"
  | "donationStatus"
  | "blacklisted";

export type FilterOp = "eq" | "ne" | "in" | "notIn" | "lte" | "gte";

export interface FilterClause {
  field: FilterField;
  op: FilterOp;
  value?: any;
  values?: any[];
}

export interface FilterCriteria {
  type: "filter";
  logic: "and" | "or";
  filters: FilterClause[];
}

export interface ManualCriteria {
  type: "manual";
  memberIds: number[];
}

export type RecipientCriteria = FilterCriteria | ManualCriteria;

export interface ResolveOptions {
  limit?: number;
  offset?: number;
  countOnly?: boolean;
}

export interface ResolvedMember {
  id: number;
  name: string;
  email: string;
  type: string;
  status: string;
}

export interface ResolveResult {
  count: number;
  memberIds?: number[];
  members?: ResolvedMember[];
}

/* =========================================================
   화이트리스트 (field → 허용 op + 값 형식)
   ========================================================= */

const VALID_MEMBER_TYPES = ["regular", "family", "volunteer", "admin"];
const VALID_MEMBER_STATUSES = ["pending", "active", "suspended", "withdrawn"];
const VALID_DONATION_STATUSES = [
  "pending",
  "completed",
  "failed",
  "cancelled",
  "refunded",
  "pending_hyosung",
  "pending_bank",
];

interface FieldSpec {
  ops: FilterOp[];
  valueType: "string" | "stringEnum" | "int" | "intArray" | "boolean" | "stringArray";
  enumValues?: string[];
}

const FIELD_SPECS: Record<FilterField, FieldSpec> = {
  type:                       { ops: ["eq", "in"],            valueType: "stringEnum", enumValues: VALID_MEMBER_TYPES },
  status:                     { ops: ["eq", "in"],            valueType: "stringEnum", enumValues: VALID_MEMBER_STATUSES },
  gradeId:                    { ops: ["eq", "in"],            valueType: "int" },
  gradeCode:                  { ops: ["eq", "in"],            valueType: "string" },
  hasActiveRegularDonation:   { ops: ["eq"],                  valueType: "boolean" },
  hadOneTimeDonationDays:     { ops: ["lte", "gte"],          valueType: "int" },
  campaignId:                 { ops: ["eq", "in"],            valueType: "int" },
  donationStatus:             { ops: ["eq", "in"],            valueType: "stringEnum", enumValues: VALID_DONATION_STATUSES },
  blacklisted:                { ops: ["eq"],                  valueType: "boolean" },
};

/* =========================================================
   validateCriteria
   ========================================================= */

export function validateCriteria(
  criteria: any,
): { ok: true } | { ok: false; error: string; missingMemberIds?: number[] } {
  if (!criteria || typeof criteria !== "object") {
    return { ok: false, error: "criteria 객체가 필요합니다." };
  }
  if (criteria.type !== "filter" && criteria.type !== "manual") {
    return { ok: false, error: "criteria.type은 'filter' 또는 'manual'이어야 합니다." };
  }

  if (criteria.type === "manual") {
    if (!Array.isArray(criteria.memberIds) || criteria.memberIds.length === 0) {
      return { ok: false, error: "memberIds는 1개 이상의 정수 배열이어야 합니다." };
    }
    if (criteria.memberIds.length > 1000) {
      return { ok: false, error: "수동 명단은 최대 1000명까지 가능합니다." };
    }
    for (const id of criteria.memberIds) {
      if (!Number.isInteger(id) || id <= 0) {
        return { ok: false, error: "memberIds 항목은 양의 정수여야 합니다." };
      }
    }
    return { ok: true };
  }

  /* filter 분기 */
  if (criteria.logic !== "and" && criteria.logic !== "or") {
    return { ok: false, error: "logic은 'and' 또는 'or'이어야 합니다." };
  }
  if (!Array.isArray(criteria.filters) || criteria.filters.length === 0) {
    return { ok: false, error: "최소 1개 이상의 조건을 추가해 주세요." };
  }

  for (const f of criteria.filters) {
    if (!f || typeof f !== "object") {
      return { ok: false, error: "필터 항목이 올바르지 않습니다." };
    }
    const spec = FIELD_SPECS[f.field as FilterField];
    if (!spec) {
      return { ok: false, error: `허용되지 않은 field: ${f.field}` };
    }
    if (!spec.ops.includes(f.op)) {
      return { ok: false, error: `field=${f.field}에 허용되지 않은 op: ${f.op}` };
    }

    /* 값 형식 검증 */
    const isMulti = f.op === "in" || f.op === "notIn";
    if (isMulti) {
      if (!Array.isArray(f.values) || f.values.length === 0) {
        return { ok: false, error: `field=${f.field} op=${f.op}는 values 배열이 필요합니다.` };
      }
      for (const v of f.values) {
        const ok = checkValueShape(v, spec);
        if (!ok) return { ok: false, error: `field=${f.field} 값이 올바르지 않습니다.` };
      }
    } else {
      if (f.value === undefined || f.value === null) {
        return { ok: false, error: `field=${f.field} op=${f.op}는 value가 필요합니다.` };
      }
      const ok = checkValueShape(f.value, spec);
      if (!ok) return { ok: false, error: `field=${f.field} 값이 올바르지 않습니다.` };
    }
  }

  return { ok: true };
}

function checkValueShape(v: any, spec: FieldSpec): boolean {
  switch (spec.valueType) {
    case "string":
      return typeof v === "string" && v.length > 0;
    case "stringEnum":
      return typeof v === "string" && (spec.enumValues || []).includes(v);
    case "int":
      return Number.isInteger(v);
    case "intArray":
      return Array.isArray(v) && v.every((x) => Number.isInteger(x));
    case "boolean":
      return typeof v === "boolean";
    case "stringArray":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    default:
      return false;
  }
}

/* =========================================================
   summarizeCriteria
   ========================================================= */

const FIELD_LABEL: Record<FilterField, string> = {
  type: "회원 유형",
  status: "회원 상태",
  gradeId: "등급 ID",
  gradeCode: "등급 코드",
  hasActiveRegularDonation: "활성 정기 후원",
  hadOneTimeDonationDays: "최근 일시 후원 일수",
  campaignId: "캠페인",
  donationStatus: "후원 상태",
  blacklisted: "블랙 처리 여부",
};

const OP_LABEL: Record<FilterOp, string> = {
  eq: "=",
  ne: "≠",
  in: "∈",
  notIn: "∉",
  lte: "≤",
  gte: "≥",
};

export function summarizeCriteria(criteria: RecipientCriteria): string {
  if (!criteria) return "(조건 없음)";

  if (criteria.type === "manual") {
    const n = Array.isArray(criteria.memberIds) ? criteria.memberIds.length : 0;
    return `수동 명단 ${n}명`;
  }

  if (criteria.type === "filter") {
    const parts = (criteria.filters || []).map((f) => {
      const label = FIELD_LABEL[f.field] || f.field;
      const op = OP_LABEL[f.op] || f.op;
      const val =
        f.op === "in" || f.op === "notIn"
          ? `[${(f.values || []).join(", ")}]`
          : String(f.value);
      return `${label}${op}${val}`;
    });
    const sep = criteria.logic === "or" ? " OR " : " AND ";
    return `필터: ${parts.join(sep)}`;
  }

  return "(알 수 없는 조건)";
}

/* =========================================================
   resolveRecipients
   ========================================================= */

export async function resolveRecipients(
  criteria: RecipientCriteria,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const { limit, offset = 0, countOnly = false } = opts;

  /* manual 분기 */
  if (criteria.type === "manual") {
    const ids = Array.isArray(criteria.memberIds) ? criteria.memberIds.filter((x) => Number.isInteger(x) && x > 0) : [];
    if (ids.length === 0) return { count: 0, memberIds: [], members: [] };

    /* 실재 회원만 필터 */
    const countRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM members
      WHERE id = ANY(${ids}::int[])
    `);
    const count = ((countRes?.rows ?? countRes)[0] ?? {}).n ?? 0;

    if (countOnly) return { count };

    const lim = limit && limit > 0 ? limit : null;
    const rowsRes: any = await db.execute(sql`
      SELECT id, name, email, type, status
      FROM members
      WHERE id = ANY(${ids}::int[])
      ORDER BY id ASC
      ${lim != null ? sql`LIMIT ${lim} OFFSET ${offset}` : sql``}
    `);
    const rows = rowsRes?.rows ?? rowsRes ?? [];

    return {
      count,
      memberIds: rows.map((r: any) => r.id as number),
      members: rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        type: r.type,
        status: r.status,
      })),
    };
  }

  /* filter 분기 */
  const fragments: ReturnType<typeof sql>[] = [];
  for (const f of criteria.filters || []) {
    const frag = filterClauseToSql(f);
    if (frag) fragments.push(frag);
  }

  let whereFragment = sql``;
  if (fragments.length > 0) {
    const joiner = criteria.logic === "or" ? sql` OR ` : sql` AND `;
    const joined = fragments.reduce((a, b, idx) =>
      idx === 0 ? b : sql`${a}${joiner}${b}`,
    sql``);
    whereFragment = sql`WHERE ${joined}`;
  }

  const countRes: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM members ${whereFragment}
  `);
  const count = ((countRes?.rows ?? countRes)[0] ?? {}).n ?? 0;

  if (countOnly) return { count };

  const lim = limit && limit > 0 ? limit : null;
  const rowsRes: any = await db.execute(sql`
    SELECT id, name, email, type, status
    FROM members
    ${whereFragment}
    ORDER BY id ASC
    ${lim != null ? sql`LIMIT ${lim} OFFSET ${offset}` : sql``}
  `);
  const rows = rowsRes?.rows ?? rowsRes ?? [];

  return {
    count,
    memberIds: rows.map((r: any) => r.id as number),
    members: rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      type: r.type,
      status: r.status,
    })),
  };
}

/* =========================================================
   filter clause → SQL fragment
   ========================================================= */

function filterClauseToSql(f: FilterClause): ReturnType<typeof sql> | null {
  switch (f.field) {
    case "type":
      return simpleColumnClause(sql`type::text`, f);
    case "status":
      return simpleColumnClause(sql`status::text`, f);
    case "gradeId":
      return simpleColumnClause(sql`grade_id`, f);
    case "gradeCode": {
      /* member_grades.code 조인 */
      if (f.op === "eq") {
        return sql`grade_id IN (SELECT id FROM member_grades WHERE code = ${f.value})`;
      }
      if (f.op === "in") {
        return sql`grade_id IN (SELECT id FROM member_grades WHERE code = ANY(${f.values}::text[]))`;
      }
      return null;
    }
    case "hasActiveRegularDonation": {
      const want = f.value === true;
      const exists = sql`EXISTS (
        SELECT 1 FROM donations d
        WHERE d.member_id = members.id
          AND d.type = 'regular'
          AND d.status = 'completed'
      )`;
      return want ? exists : sql`NOT ${exists}`;
    }
    case "hadOneTimeDonationDays": {
      const days = Number(f.value);
      if (!Number.isFinite(days) || days < 0) return null;
      if (f.op === "lte") {
        return sql`EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = members.id
            AND d.type = 'onetime'
            AND d.status = 'completed'
            AND d.created_at >= NOW() - (${days}::int || ' days')::interval
        )`;
      }
      if (f.op === "gte") {
        return sql`EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = members.id
            AND d.type = 'onetime'
            AND d.status = 'completed'
            AND d.created_at <= NOW() - (${days}::int || ' days')::interval
        )`;
      }
      return null;
    }
    case "campaignId": {
      if (f.op === "eq") {
        return sql`EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = members.id
            AND d.campaign_id = ${f.value}
        )`;
      }
      if (f.op === "in") {
        return sql`EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = members.id
            AND d.campaign_id = ANY(${f.values}::int[])
        )`;
      }
      return null;
    }
    case "donationStatus": {
      if (f.op === "eq") {
        return sql`EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = members.id
            AND d.status::text = ${f.value}
        )`;
      }
      if (f.op === "in") {
        return sql`EXISTS (
          SELECT 1 FROM donations d
          WHERE d.member_id = members.id
            AND d.status::text = ANY(${f.values}::text[])
        )`;
      }
      return null;
    }
    case "blacklisted": {
      const want = f.value === true;
      return want
        ? sql`(status = 'suspended' AND blacklist_reason IS NOT NULL)`
        : sql`(status <> 'suspended' OR blacklist_reason IS NULL)`;
    }
    default:
      return null;
  }
}

function simpleColumnClause(
  colExpr: ReturnType<typeof sql>,
  f: FilterClause,
): ReturnType<typeof sql> | null {
  switch (f.op) {
    case "eq":
      return sql`${colExpr} = ${f.value}`;
    case "ne":
      return sql`${colExpr} <> ${f.value}`;
    case "in":
      return sql`${colExpr} = ANY(${asArrayLiteral(f.values)})`;
    case "notIn":
      return sql`${colExpr} <> ALL(${asArrayLiteral(f.values)})`;
    case "lte":
      return sql`${colExpr} <= ${f.value}`;
    case "gte":
      return sql`${colExpr} >= ${f.value}`;
    default:
      return null;
  }
}

function asArrayLiteral(values: any[] | undefined): any {
  if (!Array.isArray(values)) return [];
  return values;
}
