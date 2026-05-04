// lib/member-tier.ts
// ★ Phase M-19-4: 회원 등급 자동 산정 + 알림
// - 누적 후원액(tier_score) 기준으로 5단계 등급 매핑
// - 등급 변경 감지 + 상승 시 in-app 알림 + 축하 메일
// - 후원 완료 시점 즉시 호출 + 매주 일요일 cron 전체 재산정

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { members } from "../db/schema";
import { createNotification } from "./notify";
import { sendEmail } from "./email";

/* ───────── 등급 정의 ───────── */
export type MemberTier = "seed" | "sprout" | "tree" | "forest" | "land";

export interface TierInfo {
  tier: MemberTier;
  rank: number;           // 1(seed) ~ 5(land)
  emoji: string;
  label: string;          // "씨앗", "새싹" 등
  englishName: string;    // "Seed", "Sprout" 등
  minScore: number;       // 진입 점수 (이상)
  maxScore: number | null;// 다음 등급 직전 점수 (미만)
  description: string;
  benefits: string[];
}

export const TIER_DEFINITIONS: Record<MemberTier, TierInfo> = {
  seed: {
    tier: "seed",
    rank: 1,
    emoji: "🌱",
    label: "씨앗",
    englishName: "Seed",
    minScore: 0,
    maxScore: 99999,
    description: "함께해 주신 첫 마음, 작은 씨앗에서 시작합니다",
    benefits: ["회원 전용 콘텐츠 열람", "기부금 영수증 발급"],
  },
  sprout: {
    tier: "sprout",
    rank: 2,
    emoji: "🌿",
    label: "새싹",
    englishName: "Sprout",
    minScore: 100000,
    maxScore: 499999,
    description: "따뜻한 마음이 새싹을 틔우고 있습니다",
    benefits: ["새싹 등급 뱃지", "분기 활동보고서 우선 발송"],
  },
  tree: {
    tier: "tree",
    rank: 3,
    emoji: "🌳",
    label: "나무",
    englishName: "Tree",
    minScore: 500000,
    maxScore: 1999999,
    description: "굳건한 나무처럼 함께해 주시는 동행자",
    benefits: ["나무 등급 뱃지", "연간 감사 카드 발송", "행사 우선 안내"],
  },
  forest: {
    tier: "forest",
    rank: 4,
    emoji: "🌲",
    label: "숲",
    englishName: "Forest",
    minScore: 2000000,
    maxScore: 4999999,
    description: "여러분의 마음이 모여 풍성한 숲을 이루었습니다",
    benefits: ["숲 등급 뱃지", "연 1회 협회 활동 직접 참관 초대", "VIP 전용 채널"],
  },
  land: {
    tier: "land",
    rank: 5,
    emoji: "🏞",
    label: "대지",
    englishName: "Land",
    minScore: 5000000,
    maxScore: null,
    description: "유가족과 교사 공동체의 회복을 받쳐주는 대지와 같은 분",
    benefits: ["대지 등급 뱃지", "협회 운영위원 초청권", "특별 추모 행사 초대", "1:1 감사 인사"],
  },
};

/* ───────── 점수 → 등급 매핑 ───────── */
export function calculateTierFromScore(score: number): MemberTier {
  const s = Math.max(0, Math.floor(Number(score) || 0));
  if (s >= TIER_DEFINITIONS.land.minScore) return "land";
  if (s >= TIER_DEFINITIONS.forest.minScore) return "forest";
  if (s >= TIER_DEFINITIONS.tree.minScore) return "tree";
  if (s >= TIER_DEFINITIONS.sprout.minScore) return "sprout";
  return "seed";
}

/* ───────── 등급 비교 (상승/하락/유지) ───────── */
export function compareTiers(prev: MemberTier | null, next: MemberTier): "up" | "down" | "same" | "new" {
  if (!prev) return "new";
  const prevRank = TIER_DEFINITIONS[prev].rank;
  const nextRank = TIER_DEFINITIONS[next].rank;
  if (nextRank > prevRank) return "up";
  if (nextRank < prevRank) return "down";
  return "same";
}

/* ───────── 다음 등급까지 남은 금액 ───────── */
export function distanceToNextTier(currentScore: number, currentTier: MemberTier): {
  nextTier: MemberTier | null;
  remaining: number | null;
  progressPercent: number | null;
} {
  const def = TIER_DEFINITIONS[currentTier];
  if (!def.maxScore) {
    /* 최고 등급 */
    return { nextTier: null, remaining: null, progressPercent: 100 };
  }
  const tierKeys: MemberTier[] = ["seed", "sprout", "tree", "forest", "land"];
  const currentIdx = tierKeys.indexOf(currentTier);
  const nextTier = tierKeys[currentIdx + 1] || null;

  if (!nextTier) {
    return { nextTier: null, remaining: null, progressPercent: 100 };
  }

  const nextDef = TIER_DEFINITIONS[nextTier];
  const remaining = Math.max(0, nextDef.minScore - currentScore);
  const range = nextDef.minScore - def.minScore;
  const progress = range > 0
    ? Math.min(100, Math.round(((currentScore - def.minScore) / range) * 100 * 10) / 10)
    : 0;

  return { nextTier, remaining, progressPercent: progress };
}

/* ───────── 단일 회원 재산정 ───────── */
export interface RecalcResult {
  memberId: number;
  memberName: string | null;
  prevTier: MemberTier | null;
  newTier: MemberTier;
  oldScore: number;
  newScore: number;
  change: "up" | "down" | "same" | "new";
}

/**
 * 단일 회원의 등급 재산정 + DB 갱신
 * 변경된 경우 알림/메일 발송 (옵션)
 */
export async function recalcMemberTier(
  memberId: number,
  options: {
    sendNotification?: boolean;  // 등급 상승 시 알림 (기본 true)
    sendEmail?: boolean;          // 등급 상승 시 메일 (기본 true)
  } = {}
): Promise<RecalcResult | null> {
  const sendNotif = options.sendNotification !== false;
  const sendMail = options.sendEmail !== false;

  /* 회원 조회 */
  const [m] = await db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      tier: members.tier,
      tierScore: members.tierScore,
      totalDonationAmount: members.totalDonationAmount,
      status: members.status,
      agreeEmail: members.agreeEmail,
    })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!m) return null;
  if (m.status === "withdrawn") return null;

  const oldScore = Number(m.tierScore || 0);
  const newScore = Number(m.totalDonationAmount || 0);
  const prevTier = (m.tier || null) as MemberTier | null;
  const newTier = calculateTierFromScore(newScore);
  const change = compareTiers(prevTier, newTier);

  /* DB 갱신 */
  await db.update(members).set({
    tier: newTier,
    tierScore: newScore,
    previousTier: prevTier !== newTier ? prevTier : (m as any).previousTier,
    tierUpdatedAt: new Date(),
  } as any).where(eq(members.id, memberId));

  /* 등급 상승 시 알림 + 메일 */
  if (change === "up" && prevTier) {
    const newDef = TIER_DEFINITIONS[newTier];
    const prevDef = TIER_DEFINITIONS[prevTier];

    /* in-app 알림 */
    if (sendNotif) {
      try {
        await createNotification({
          recipientId: memberId,
          recipientType: "user",
          category: "member",
          severity: "info",
          title: `${newDef.emoji} ${newDef.label} 등급으로 승급되셨습니다!`,
          message: `${prevDef.emoji} ${prevDef.label} → ${newDef.emoji} ${newDef.label}\n${newDef.description}`,
          link: "/mypage.html#tier",
          refTable: "members",
          refId: memberId,
        });
      } catch (e) {
        console.warn(`[member-tier] 알림 실패 m-${memberId}:`, e);
      }
    }

    /* 축하 메일 (agreeEmail=true 회원만) */
    if (sendMail && m.email && m.agreeEmail !== false) {
      try {
        const tpl = buildTierUpEmail({
          memberName: m.name || "회원",
          prevTier,
          newTier,
          totalAmount: newScore,
        });
        await sendEmail({
          to: m.email,
          subject: tpl.subject,
          html: tpl.html,
        });
      } catch (e) {
        console.warn(`[member-tier] 메일 실패 m-${memberId}:`, e);
      }
    }
  }

  return {
    memberId,
    memberName: m.name,
    prevTier,
    newTier,
    oldScore,
    newScore,
    change,
  };
}

/* ───────── 일괄 재산정 (cron용) ───────── */
export async function bulkRecalcTiers(options: {
  sendNotifications?: boolean;
  batchSize?: number;
} = {}): Promise<{
  total: number;
  changed: number;
  upgraded: number;
  downgraded: number;
  errors: number;
  upgradedList: RecalcResult[];
}> {
  const sendNotif = options.sendNotifications !== false;
  const batchSize = options.batchSize || 100;

  const allMembers = await db
    .select({ id: members.id })
    .from(members)
    .where(sql`${members.status} != 'withdrawn'`);

  const result = {
    total: allMembers.length,
    changed: 0,
    upgraded: 0,
    downgraded: 0,
    errors: 0,
    upgradedList: [] as RecalcResult[],
  };

  /* 배치 단위 처리 (DB/메일 부하 분산) */
  for (let i = 0; i < allMembers.length; i += batchSize) {
    const batch = allMembers.slice(i, i + batchSize);
    const promises = batch.map((m) =>
      recalcMemberTier(m.id, {
        sendNotification: sendNotif,
        sendEmail: sendNotif,
      }).catch((e) => {
        console.error(`[bulkRecalc] m-${m.id}:`, e);
        result.errors++;
        return null;
      })
    );
    const settled = await Promise.all(promises);

    for (const r of settled) {
      if (!r) continue;
      if (r.change === "up") {
        result.upgraded++;
        result.changed++;
        result.upgradedList.push(r);
      } else if (r.change === "down") {
        result.downgraded++;
        result.changed++;
      }
    }

    /* 메일 발송 부하 분산용 짧은 딜레이 */
    if (i + batchSize < allMembers.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return result;
}

/* ───────── 등급 조회 헬퍼 (UI용) ───────── */
export async function getMemberTierStatus(memberId: number): Promise<{
  current: TierInfo;
  score: number;
  next: { tier: TierInfo; remaining: number; progressPercent: number } | null;
} | null> {
  const [m] = await db
    .select({
      id: members.id,
      tier: members.tier,
      tierScore: members.tierScore,
      totalDonationAmount: members.totalDonationAmount,
    })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!m) return null;

  const score = Number(m.tierScore || 0);
  const currentTier = (m.tier || "seed") as MemberTier;
  const currentDef = TIER_DEFINITIONS[currentTier];
  const dist = distanceToNextTier(score, currentTier);

  return {
    current: currentDef,
    score,
    next: dist.nextTier ? {
      tier: TIER_DEFINITIONS[dist.nextTier],
      remaining: dist.remaining || 0,
      progressPercent: dist.progressPercent || 0,
    } : null,
  };
}

/* ───────── 등급 분포 통계 (어드민용) ───────── */
export async function getTierDistribution(): Promise<{
  total: number;
  byTier: Record<MemberTier, { count: number; totalScore: number }>;
}> {
  const r: any = await db.execute(sql`
    SELECT
      tier,
      COUNT(*)::int AS "count",
      COALESCE(SUM(tier_score), 0)::bigint AS "totalScore"
    FROM members
    WHERE status != 'withdrawn'
    GROUP BY tier
  `);
  const rows = r.rows || r || [];

  const byTier: any = {
    seed: { count: 0, totalScore: 0 },
    sprout: { count: 0, totalScore: 0 },
    tree: { count: 0, totalScore: 0 },
    forest: { count: 0, totalScore: 0 },
    land: { count: 0, totalScore: 0 },
  };

  let total = 0;
  for (const row of rows) {
    const tier = row.tier as MemberTier;
    if (byTier[tier]) {
      byTier[tier] = {
        count: Number(row.count || 0),
        totalScore: Number(row.totalScore || 0),
      };
      total += byTier[tier].count;
    }
  }

  return { total, byTier };
}

/* ───────── 등급 상승 메일 템플릿 ───────── */
function buildTierUpEmail(opts: {
  memberName: string;
  prevTier: MemberTier;
  newTier: MemberTier;
  totalAmount: number;
}): { subject: string; html: string } {
  const prev = TIER_DEFINITIONS[opts.prevTier];
  const next = TIER_DEFINITIONS[opts.newTier];

  const benefitsHtml = next.benefits
    .map((b) => `<li style="margin-bottom:6px">${b}</li>`)
    .join("");

  const subject = `${next.emoji} ${opts.memberName}님, ${next.label} 등급으로 승급되셨습니다`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f5f4f2;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:40px 20px">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
          <tr>
            <td style="padding:50px 40px 30px;text-align:center;background:linear-gradient(135deg,#7a1f2b,#3a0d14);color:#fff">
              <div style="font-size:64px;margin-bottom:12px;line-height:1">${next.emoji}</div>
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;font-family:'Noto Serif KR',serif">${next.label} 등급 승급을 축하드립니다</h1>
              <p style="margin:0;font-size:14px;opacity:0.9">${opts.memberName}님의 따뜻한 마음에 진심으로 감사드립니다</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px">
              <div style="text-align:center;padding:24px;background:#fafaf8;border-radius:12px;margin-bottom:24px">
                <div style="display:inline-flex;align-items:center;gap:16px;font-size:18px">
                  <div>
                    <div style="font-size:36px;line-height:1;margin-bottom:4px">${prev.emoji}</div>
                    <div style="font-size:13px;color:#888">${prev.label}</div>
                  </div>
                  <div style="font-size:24px;color:#c47a00">→</div>
                  <div>
                    <div style="font-size:48px;line-height:1;margin-bottom:4px">${next.emoji}</div>
                    <div style="font-size:14px;font-weight:700;color:#7a1f2b">${next.label}</div>
                  </div>
                </div>
              </div>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:#2a2a2a">
                ${opts.memberName}님,
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.85;color:#2a2a2a">
                여러분의 변함없는 동행 덕분에<br />
                <strong style="color:#7a1f2b">${next.emoji} ${next.label} 등급</strong>으로 승급하시게 되었습니다.<br /><br />
                <em style="color:#888;font-size:13px">"${next.description}"</em>
              </p>

              <div style="background:#fef9f5;border-left:3px solid #7a1f2b;padding:14px 18px;border-radius:6px;margin-bottom:24px">
                <div style="font-size:12.5px;color:#888;margin-bottom:4px">현재 누적 후원</div>
                <div style="font-size:22px;font-weight:700;color:#7a1f2b;font-family:'Inter',monospace">₩${opts.totalAmount.toLocaleString()}</div>
              </div>

              <h3 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#3a0d14">${next.label} 등급 혜택</h3>
              <ul style="margin:0 0 24px;padding-left:20px;font-size:13.5px;line-height:1.8;color:#2a2a2a">
                ${benefitsHtml}
              </ul>

              <div style="text-align:center;margin-top:30px">
                <a href="https://tbfa-siren-cms.netlify.app/mypage.html#tier" style="display:inline-block;padding:13px 32px;background:#7a1f2b;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
                  내 등급 확인하기 →
                </a>
              </div>

              <p style="margin:30px 0 0;font-size:13px;line-height:1.8;color:#888;text-align:center">
                여러분의 마음이 모여 교사 유가족과 동료 교사들의<br />
                일상 회복을 만들어 가고 있습니다.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;background:#fafaf8;text-align:center;font-size:11.5px;color:#999;line-height:1.7">
              본 메일은 발신 전용입니다.<br />
              (사)교사유가족협의회 · 문의: support@siren-org.kr
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

/* ───────── 후원 완료 시 호출용 헬퍼 (try-catch 격리) ───────── */
/**
 * 후원 완료 후 totalDonationAmount가 갱신된 다음 호출
 * 실패해도 후원 처리에는 영향 없음
 */
export async function refreshTierAfterDonation(memberId: number): Promise<void> {
  if (!memberId) return;
  try {
    await recalcMemberTier(memberId, {
      sendNotification: true,
      sendEmail: true,
    });
  } catch (e) {
    console.error(`[refreshTierAfterDonation] m-${memberId}:`, e);
  }
}