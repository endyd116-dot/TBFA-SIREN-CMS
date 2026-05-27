// lib/voucher-number.ts
// Q4-024: 전표번호(YYYYMM-NNN) 발번 동시성 직렬화 헬퍼.
//
// 기존: 여러 함수가 각자 SELECT MAX(seq)+1 후 INSERT → 트랜잭션/락이 없어
//       동시 생성 시 같은 번호로 충돌(중복 번호 또는 INSERT 실패) 가능.
// 해결: pg_advisory_xact_lock(월 단위 키)으로 같은 달 발번을 직렬화.
//
// 사용 규칙: 반드시 db.transaction(tx) 안에서 호출하고, 같은 tx로 INSERT까지 끝내야
//            advisory xact 락이 커밋 시점까지 유지되어 효과가 있다.
import { sql } from "drizzle-orm";

export async function nextVoucherNumber(tx: any, yyyymm: string): Promise<string> {
  // 월 키로 트랜잭션 advisory lock — 동시 발번 직렬화(커밋 시 자동 해제)
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"voucher:" + yyyymm}))`);
  const r: any = await tx.execute(sql`
    SELECT COALESCE(MAX(CAST(SPLIT_PART(voucher_number, '-', 2) AS INTEGER)), 0) AS maxn
      FROM vouchers WHERE voucher_number LIKE ${`${yyyymm}-%`}
  `);
  const n = Number((r?.rows ?? r ?? [])[0]?.maxn ?? 0) + 1;
  return `${yyyymm}-${String(n).padStart(3, "0")}`;
}
