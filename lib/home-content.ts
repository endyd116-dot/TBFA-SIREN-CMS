/**
 * lib/home-content.ts — 메인 화면 콘텐츠·활동 지표의 **단일 생성 지점**
 *
 * ★ 2026-10-07 — 왜 한 곳으로 모았나
 *   공개 API(/api/public/home-content · /api/public/stats)는 중첩 모양
 *   ({ hero:{slides}, quickMenu:{items} … })으로 내보내는데,
 *   홈을 서버에서 조립하는 page-shell은 저장소 평면 모양({ "home.hero.slides": … })을
 *   그대로 페이지에 심어 보냈다(8-20 서버 렌더 도입 때). 화면 스크립트는 심어 둔 값을
 *   먼저 쓰고 API는 다시 부르지 않으므로, 메인 화면 편집(히어로·퀵메뉴·지표)이 라이브에
 *   한 번도 반영되지 않았다. 두 곳이 **같은 함수**로 값을 만들면 다시 어긋날 수 없다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { publicGoalAmount } from "./campaign-extras";

export interface HomeKeyRow {
  key: string;
  value_text: string | null;
  value_json: any;
  value_blob_id: number | null;
  draft_value_text: string | null;
  draft_value_json: any;
  draft_value_blob_id: number | null;
  has_draft: boolean;
}

/* "home.hero.slides" + 값 → tree에 nested 할당 ("home." 접두어는 뗀다) */
function setNested(tree: any, dottedKey: string, value: any) {
  const parts = dottedKey.split(".");
  if (parts[0] === "home") parts.shift();
  let cur = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/* 저장 행 → 실제 값 (임시저장 우선 옵션). 글자 "true"/"false"/숫자는 자동 형변환 */
function pickValue(row: HomeKeyRow, useDraft: boolean): any {
  const jsonVal = useDraft && row.has_draft && row.draft_value_json !== null
    ? row.draft_value_json
    : row.value_json;
  if (jsonVal !== null && jsonVal !== undefined) return jsonVal;

  const blobId = useDraft && row.has_draft && row.draft_value_blob_id !== null
    ? row.draft_value_blob_id
    : row.value_blob_id;
  if (blobId) return { blobId, url: `/api/blob-image?id=${blobId}` };

  const textVal = useDraft && row.has_draft && row.draft_value_text !== null
    ? row.draft_value_text
    : row.value_text;
  if (textVal === null || textVal === undefined) return null;

  if (textVal === "true") return true;
  if (textVal === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(textVal)) return Number(textVal);
  return textVal;
}

/**
 * 메인 화면 콘텐츠 트리 — 공개 API 응답의 data 와 완전히 같은 모양.
 * useDraft=true 면 임시저장 값을 우선한다(어드민 미리보기).
 */
export async function buildHomeContent(useDraft: boolean): Promise<any> {
  const result: any = await db.execute(sql`
    SELECT
      key, value_text, value_json, value_blob_id,
      draft_value_text, draft_value_json, draft_value_blob_id, has_draft
    FROM site_settings
    WHERE key LIKE 'home.%'
    ORDER BY key
  `);
  const rows: HomeKeyRow[] = Array.isArray(result) ? result : (result?.rows || []);

  const tree: any = {};
  for (const row of rows) setNested(tree, row.key, pickValue(row, useDraft));

  /* 2026-10-31 후원 계좌 안내 배너 — 노출·문구는 home.bankBanner.* 설정(없으면 기본 켬),
     은행·계좌·예금주·입금 안내는 후원 정책(lib/donation-bank) 단일 출처 */
  try {
    const { getDonationBankInfo } = await import("./donation-bank");
    const bb = tree.bankBanner && typeof tree.bankBanner === "object" ? tree.bankBanner : {};
    const bank = await getDonationBankInfo();
    tree.bankBanner = {
      visible: bb.visible === undefined || bb.visible === null || bb.visible === "" ? true : bb.visible === true,
      title: bb.title || "회비 납부 계좌 안내",
      lead: bb.lead || "회원 가입 없이 계좌이체로 함께하실 수도 있습니다. 입금자명을 남겨 주시면 확인 후 안내드립니다.",
      bank,
    };
  } catch (e) {
    console.warn("[home-content] 계좌 안내 배너 구성 실패", e);
  }

  /* 특별 배너가 캠페인에 연결돼 있으면 캠페인의 제목·목표·모금액으로 덮어쓴다 */
  try {
    const linkedId = tree.specialBanner?.linkedCampaignId;
    if (linkedId && String(linkedId).trim() !== "") {
      const campRes: any = await db.execute(sql`
        SELECT id, title, goal_amount, raised_amount
        FROM campaigns
        WHERE id = ${Number(linkedId)}
        LIMIT 1
      `);
      const campRows = Array.isArray(campRes) ? campRes : (campRes?.rows || []);
      const camp = campRows[0];
      if (camp) {
        if (!tree.specialBanner) tree.specialBanner = {};
        tree.specialBanner.title = camp.title || tree.specialBanner.title;
        tree.specialBanner.goalAmount = publicGoalAmount(camp.goal_amount);   /* KG: 공개 화면 목표 표시 안 함 */
        tree.specialBanner.raisedAmount = Number(camp.raised_amount || 0);
        tree.specialBanner._linkedFrom = "campaign:" + camp.id;
      }
    }
  } catch (e) {
    console.warn("[home-content] linked campaign 조회 실패", e);
  }
  /* KG: 운영자가 배너에 목표를 직접 적었어도 공개 화면에는 목표·진행률을 내보내지 않는다 */
  if (tree.specialBanner && typeof tree.specialBanner === "object") {
    tree.specialBanner.goalAmount = publicGoalAmount(tree.specialBanner.goalAmount);
  }

  return {
    ...tree,
    _meta: {
      mode: useDraft ? "draft" : "published",
      totalKeys: rows.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 활동 지표 — 공개 API(/api/public/stats) 응답의 data 와 완전히 같은 모양.
 * @param stats getPublishedSettings("stats").stats 또는 getDraftSettings("stats").stats (평면 맵)
 */
export function buildPublicStats(stats: Record<string, any> | null | undefined, useDraft: boolean) {
  const s = stats || {};
  let monthlyTrend: any[] = [];
  try {
    const t = s["donations.monthlyTrend"];
    if (Array.isArray(t)) monthlyTrend = t;
  } catch (_) { /* 무시 */ }

  return {
    donations: {
      totalAmount: Number(s["donations.totalAmount"] || 0),
      monthlyTrend,
    },
    support: {
      totalCount: Number(s["support.totalCount"] || 0),
    },
    members: {
      regularDonors: Number(s["members.regularDonors"] || 0),
      volunteers: Number(s["members.volunteers"] || 0),
    },
    distribution: {
      directSupport: Number(s["distribution.directSupport"] || 0),
      memorial: Number(s["distribution.memorial"] || 0),
      scholarship: Number(s["distribution.scholarship"] || 0),
      operation: Number(s["distribution.operation"] || 0),
    },
    transparency: {
      grade: s["transparency.grade"] || "—",
    },
    _meta: useDraft ? { mode: "draft" } : { mode: "published" },
  };
}
