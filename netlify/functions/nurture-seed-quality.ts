/**
 * nurture-seed-quality — 1회용: 검증된 365일 너처링 콘텐츠 전면 시드(4개 세그먼트).
 *
 * NPO 모범사례(환영시리즈→임팩트 투명공개→스토리텔링→점진적 전환/상향, 과빈도 금지) 기반.
 * 문자 1차(전 단계) + 핵심 단계는 보조 메일. 공손·마음 따뜻한 톤. 여정은 OFF 유지(운영자 검토 후 ON).
 *
 * GET ?secret=...&run=1 → 시크릿 인증 후 세그먼트별 기존 단계/영구 교체 + 신규 템플릿·단계 시드.
 * 호출 성공 후 이 파일 삭제(1회용).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/nurture-seed-quality" };
const H = { "Content-Type": "application/json; charset=utf-8" };
function out(o: object, s = 200) { return new Response(JSON.stringify(o, null, 2), { status: s, headers: H }); }
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }

/* 메일 HTML 래퍼 — 따뜻·정갈 */
function emailHtml(paras: string[]): string {
  return `<div style="max-width:560px;margin:0 auto;font-family:'Malgun Gothic',sans-serif;color:#3a3a3a;line-height:1.85">`
    + `<div style="background:#8B1A1A;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0"><strong style="font-size:17px">교사유가족협의회</strong></div>`
    + `<div style="padding:28px 24px;background:#fff;border:1px solid #eee;border-top:none">`
    + paras.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join("")
    + `<a href="https://tbfa.co.kr/mypage.html#notifications" style="display:inline-block;margin-top:6px;background:#8B1A1A;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600">소식 확인하기</a>`
    + `</div><div style="padding:14px 24px;background:#faf7f5;border-radius:0 0 12px 12px;font-size:12px;color:#9a9a9a">(사)교사유가족협의회 · 함께해 주셔서 감사합니다</div></div>`;
}

/* 콘텐츠 정의 — sms(필수)/email(선택). {{이름}} 치환. */
type Step = { d: number; label: string; sms: string; emailSubject?: string; emailParas?: string[] };
type Ever = { cadence: string; label: string; sms: string; emailSubject?: string; emailParas?: string[] };

const CONTENT: Record<string, { steps: Step[]; ever: Ever[] }> = {
  /* ── 잠재: 신뢰 형성 → 첫 후원 전환 ── */
  potential: {
    steps: [
      { d: 0, label: "잠재 D0 · 환영", sms: "{{이름}}님, 반갑습니다. 교사유가족협의회입니다. 먼저 저희에게 마음 내어주셔서 진심으로 감사드립니다. 우리는 곁을 떠난 선생님들을 기억하고, 남겨진 가족이 다시 일어설 수 있도록 함께하는 사람들입니다. 앞으로 따뜻한 소식으로 인사드릴게요.",
        emailSubject: "{{이름}}님, 교사유가족협의회입니다",
        emailParas: ["{{이름}}님, 반갑습니다. 교사유가족협의회입니다.", "먼저 저희에게 마음 내어주셔서 진심으로 감사드립니다.", "우리는 곁을 떠난 선생님들을 기억하고, 남겨진 가족이 다시 일어설 수 있도록 심리상담·법률·장학으로 함께하는 사람들입니다.", "앞으로 따뜻한 소식으로 종종 인사드리겠습니다. 함께해 주셔서 고맙습니다."] },
      { d: 4, label: "잠재 D4 · 현실 인식", sms: "{{이름}}님, 한 분의 선생님이 떠나면 그 가족의 삶은 송두리째 흔들립니다. 갑작스러운 상실 앞에 생계도 마음도 막막해지죠. 저희는 그 곁에서 심리상담·법률·장학으로 길을 함께 찾고 있습니다. 오늘은 그 이야기를 전하고 싶었어요." },
      { d: 10, label: "잠재 D10 · 임팩트 스토리", sms: "{{이름}}님, 한 유가족 아이는 ‘아빠 없이도 학교를 계속 다닐 수 있을까’ 걱정했습니다. 저희 장학과 상담으로 아이는 다시 꿈을 이야기하기 시작했어요. {{이름}}님 같은 분들의 관심이 이런 변화를 만듭니다. 고맙습니다." },
      { d: 18, label: "잠재 D18 · 투명성", sms: "{{이름}}님, 저희는 받은 후원이 어디에 어떻게 쓰이는지 투명하게 공개합니다. 모든 지원은 심사를 거쳐 유가족께 직접 닿습니다. 신뢰를 가장 소중히 여기겠습니다. 궁금한 점은 언제든 편히 문의해 주세요." },
      { d: 26, label: "잠재 D26 · 첫 초대", sms: "{{이름}}님, 혹시 작은 후원으로 이 동행에 함께해 주실 수 있을까요? 커피 한 잔의 나눔이 한 가족에게는 ‘혼자가 아니다’라는 위로가 됩니다. 부담 없으실 때 살펴봐 주세요. 마음 그 자체로도 큰 힘입니다.",
        emailSubject: "{{이름}}님, 작은 나눔이 큰 위로가 됩니다",
        emailParas: ["{{이름}}님, 그동안 저희 소식을 함께 들어주셔서 고맙습니다.", "혹시 작은 후원으로 이 동행에 함께해 주실 수 있을까요?", "커피 한 잔의 나눔이 한 가족에게는 ‘혼자가 아니다’라는 따뜻한 위로가 됩니다.", "부담 없으실 때 편히 살펴봐 주세요. {{이름}}님의 마음, 그 자체로도 큰 힘입니다."] },
    ],
    ever: [
      { cadence: "monthly", label: "잠재 · 월간 소식", sms: "{{이름}}님, 교사유가족협의회의 이달 소식을 전합니다. 함께 만들어가는 변화를 나눌 수 있어 감사합니다. 늘 건강하세요." },
    ],
  },

  /* ── 예비(일시): 감사 → 정기 전환 ── */
  prospect_onetime: {
    steps: [
      { d: 0, label: "일시 D0 · 감사", sms: "{{이름}}님, 따뜻한 후원에 진심으로 감사드립니다. {{이름}}님의 마음이 한 유가족에게 분명한 힘이 되었습니다. 그 손길이 어떤 변화를 만드는지 앞으로 정성껏 전해드릴게요.",
        emailSubject: "{{이름}}님, 따뜻한 후원에 감사드립니다",
        emailParas: ["{{이름}}님, 따뜻한 후원에 진심으로 감사드립니다.", "{{이름}}님의 마음이 한 유가족에게 분명한 힘이 되었습니다.", "보내주신 정성이 어떤 변화를 만드는지 앞으로 투명하게, 정성껏 전해드리겠습니다."] },
      { d: 2, label: "일시 D2 · 사용처", sms: "{{이름}}님, 보내주신 후원은 순직 교사 유가족의 심리상담·법률지원·장학에 쓰입니다. 한 분의 정성이 모여 가족들이 다시 일어설 힘이 됩니다. 투명하게 전하겠습니다." },
      { d: 7, label: "일시 D7 · 스토리", sms: "{{이름}}님, 지난달 한 유가족은 법률 지원으로 오랜 어려움을 풀었습니다. ‘처음으로 숨이 트였다’고 하셨어요. {{이름}}님의 후원이 이런 순간을 만듭니다. 고맙습니다." },
      { d: 14, label: "일시 D14 · 활동 소개", sms: "{{이름}}님, 저희는 상담·법률·장학뿐 아니라 유가족이 서로 기댈 수 있는 공동체도 함께 만들어갑니다. {{이름}}님도 그 따뜻한 울타리의 한 분이세요." },
      { d: 30, label: "일시 D30 · 정기전환 초대①", sms: "{{이름}}님의 마음이 한 가정에 큰 힘이 되었습니다. 혹시 매달 작은 정기후원으로 그 곁을 조금 더 오래 지켜주실 수 있을까요? 작은 정성이 꾸준할 때 가장 큰 위로가 됩니다. 부담 없으실 때 살펴봐 주세요.",
        emailSubject: "{{이름}}님, 그 곁을 조금 더 오래 지켜주실 수 있을까요",
        emailParas: ["{{이름}}님, 지난번 보내주신 마음이 한 가정에 큰 힘이 되었습니다.", "혹시 매달 작은 정기후원으로 그 곁을 조금 더 오래 지켜주실 수 있을까요?", "한 번의 나눔도 소중하지만, 작은 정성이 ‘꾸준히’ 이어질 때 유가족에게는 가장 큰 안심이 됩니다.", "부담 없으실 때 편히 살펴봐 주세요. 결정은 언제나 {{이름}}님의 몫입니다."] },
      { d: 60, label: "일시 D60 · 사회적 증거", sms: "{{이름}}님, 많은 분들이 매달 작은 정기후원으로 유가족 곁을 지키고 계십니다. ‘오래 함께한다’는 약속이 가족들에게는 가장 큰 안심이 됩니다. {{이름}}님도 함께해 주시면 더없이 든든하겠습니다." },
      { d: 90, label: "일시 D90 · 정기전환 초대②", sms: "{{이름}}님, 매달 1만 원의 정기후원은 한 아이의 한 학기 꿈을 지켜낼 수 있습니다. 꾸준한 동행으로 더 단단한 변화를 함께 만들어 주시겠어요? 언제든 편하게 결정해 주세요. 마음 깊이 감사드립니다." },
    ],
    ever: [
      { cadence: "quarterly", label: "일시 · 분기 소식", sms: "{{이름}}님, 교사유가족협의회의 분기 소식을 전합니다. 함께해 주시는 마음 덕분에 더 많은 가족이 힘을 얻었습니다. 늘 감사합니다." },
    ],
  },

  /* ── 예비(이탈): 윈백 ── */
  prospect_cancelled: {
    steps: [
      { d: 0, label: "이탈 D0 · 따뜻한 인사", sms: "{{이름}}님, 그동안 보내주신 따뜻한 마음에 진심으로 감사드렸습니다. 함께해 주신 시간 덕분에 많은 가족이 힘을 얻었어요. 언제든 다시 곁에 와주시면 반갑게 맞이하겠습니다. 늘 건강하시길 바랍니다.",
        emailSubject: "{{이름}}님, 그동안 진심으로 감사했습니다",
        emailParas: ["{{이름}}님, 그동안 보내주신 따뜻한 마음에 진심으로 감사드렸습니다.", "함께해 주신 시간 덕분에 많은 가족이 다시 일어설 힘을 얻었습니다.", "언제든 다시 곁에 와주시면 반갑게 맞이하겠습니다. 늘 건강하고 평안하시길 바랍니다."] },
      { d: 30, label: "이탈 D30 · 그간의 변화", sms: "{{이름}}님, 그동안 협의회에는 이런 변화가 있었어요. {{이름}}님이 함께해 주셨던 마음이 지금도 가족들에게 이어지고 있습니다. 문득 소식 전하고 싶었어요. 평안하시길 바랍니다." },
      { d: 60, label: "이탈 D60 · 부드러운 재초대", sms: "{{이름}}님, 혹시 다시 한 번 유가족의 곁을 함께 지켜주실 수 있을까요? 부담 없는 작은 나눔이라도 가족들에게는 큰 위로가 됩니다. 언제든 마음 내키실 때 함께해 주세요. 늘 감사합니다." },
    ],
    ever: [
      { cadence: "quarterly", label: "이탈 · 분기 소식", sms: "{{이름}}님, 교사유가족협의회의 분기 소식을 전합니다. 가끔이라도 저희를 기억해 주시면 큰 힘이 됩니다. 늘 평안하세요." },
    ],
  },

  /* ── 정기: 유지·심화·이탈방지 ── */
  regular: {
    steps: [
      { d: 0, label: "정기 D0 · 환영·감사", sms: "{{이름}}님, 정기후원으로 함께해 주셔서 진심으로 감사드립니다. {{이름}}님의 꾸준한 마음은 유가족에게 ‘혼자가 아니다’라는 가장 큰 위로가 됩니다. 그 동행이 만드는 변화를 투명하게 전해드릴게요.",
        emailSubject: "{{이름}}님, 정기후원으로 함께해 주셔서 감사합니다",
        emailParas: ["{{이름}}님, 정기후원으로 함께해 주셔서 진심으로 감사드립니다.", "{{이름}}님의 꾸준한 마음은 유가족에게 ‘혼자가 아니다’라는 가장 큰 위로가 됩니다.", "보내주시는 정성은 심리상담·법률지원·장학에 정성껏 쓰이며, 그 쓰임을 투명하게 전해드리겠습니다.", "오래도록 곁을 지키겠습니다. 함께 걸어주셔서 고맙습니다."] },
      { d: 3, label: "정기 D3 · 온보딩", sms: "{{이름}}님, 매달 보내주시는 후원은 심리상담·법률지원·장학에 정성껏 쓰입니다. 한 푼도 허투루 쓰지 않고, 그 쓰임을 투명하게 알려드리겠습니다. 믿고 함께해 주셔서 감사합니다." },
      { d: 7, label: "정기 D7 · 스토리", sms: "{{이름}}님, 한 유가족 어머니는 상담을 통해 다시 웃음을 찾으셨어요. ‘기댈 곳이 있다는 게 큰 힘이었다’고 하셨습니다. {{이름}}님의 꾸준한 후원이 이런 순간을 지켜줍니다." },
      { d: 30, label: "정기 D30 · 첫 달 감사", sms: "{{이름}}님, 함께한 첫 한 달, 진심으로 고맙습니다. {{이름}}님 덕분에 이번 달에도 가족들이 따뜻한 손길을 받았습니다. 앞으로도 그 변화를 꾸준히 전해드릴게요." },
      { d: 60, label: "정기 D60 · 소속감", sms: "{{이름}}님은 이제 교사유가족협의회의 소중한 한 분이세요. 선생님들을 기억하고 가족 곁을 지키는 이 길을, {{이름}}님과 함께 걷고 있다는 것이 큰 힘이 됩니다. 늘 감사합니다." },
      { d: 90, label: "정기 D90 · 분기 리포트", sms: "{{이름}}님, 지난 분기 동안 {{이름}}님의 후원으로 여러 가족이 상담·법률·장학의 도움을 받았습니다. 함께 만든 변화를 곧 자세한 소식으로도 전해드릴게요. 깊이 감사드립니다.",
        emailSubject: "{{이름}}님과 함께 만든 지난 분기의 변화",
        emailParas: ["{{이름}}님, 지난 분기 동안 {{이름}}님의 후원으로 여러 가족이 심리상담·법률·장학의 도움을 받았습니다.", "한 가정은 일상을 되찾았고, 한 아이는 학업을 이어갈 수 있었습니다.", "이 모든 변화에 {{이름}}님의 손길이 닿아 있습니다. 깊이 감사드립니다."] },
      { d: 180, label: "정기 D180 · 성찰", sms: "{{이름}}님, 반년을 함께해 주셨네요. {{이름}}님의 변함없는 마음이 모여 더 많은 가족이 다시 일어설 수 있었습니다. 그 동행이 얼마나 큰 의미인지 꼭 전하고 싶었어요. 진심으로 감사합니다." },
      { d: 270, label: "정기 D270 · 변화", sms: "{{이름}}님, 함께해 온 시간 동안 한 아이는 장학으로 학업을 이어갔고, 한 가정은 법률의 도움으로 일상을 되찾았습니다. 이 모든 변화에 {{이름}}님의 손길이 닿아 있습니다." },
      { d: 365, label: "정기 D365 · 1주년", sms: "{{이름}}님, 함께한 지 어느덧 1년입니다. 지난 1년 {{이름}}님 덕분에 더 많은 가족이 상담·법률·장학의 손길을 받았어요. 변함없는 동행에 깊이 머리 숙여 감사드립니다. 앞으로도 곁을 지키겠습니다.",
        emailSubject: "{{이름}}님, 함께한 1년에 감사드립니다",
        emailParas: ["{{이름}}님, 함께한 지 어느덧 1년입니다.", "지난 1년 {{이름}}님 덕분에 더 많은 가족이 상담·법률·장학의 따뜻한 손길을 받았습니다.", "변함없는 동행에 깊이 머리 숙여 감사드립니다.", "앞으로도 한결같이 곁을 지키겠습니다. 늘 건강하고 평안하시길 바랍니다."] },
    ],
    ever: [
      { cadence: "quarterly", label: "정기 · 분기 리포트", sms: "{{이름}}님, 이번 분기에도 {{이름}}님의 후원으로 유가족 곁을 지킬 수 있었습니다. 함께 만든 변화를 전해드립니다. 한결같은 마음에 감사드려요.",
        emailSubject: "{{이름}}님과 함께한 이번 분기 이야기",
        emailParas: ["{{이름}}님, 이번 분기에도 {{이름}}님의 후원으로 유가족 곁을 지킬 수 있었습니다.", "함께 만든 변화를 소식으로 전해드립니다.", "한결같은 마음에 진심으로 감사드립니다."] },
      { cadence: "yearend", label: "정기 · 연말 감사", sms: "{{이름}}님, 한 해 동안 함께해 주셔서 진심으로 감사합니다. {{이름}}님의 꾸준한 나눔이 올 한 해 많은 가족에게 힘이 되었어요. 기부금 영수증은 마이페이지에서 확인하실 수 있습니다. 따뜻한 연말 보내세요.",
        emailSubject: "{{이름}}님, 한 해 동안 함께해 주셔서 감사합니다",
        emailParas: ["{{이름}}님, 한 해 동안 함께해 주셔서 진심으로 감사합니다.", "{{이름}}님의 꾸준한 나눔이 올 한 해 많은 가족에게 든든한 힘이 되었습니다.", "기부금 영수증은 마이페이지에서 언제든 확인하실 수 있습니다.", "따뜻하고 평안한 연말 보내시길 바랍니다."] },
    ],
  },
};

const SMS_VARS = JSON.stringify([{ key: "이름", label: "회원이름", sample: "김후원" }]);

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (url.searchParams.get("run") !== "1") return out({ ok: true, mode: "diagnostic", segments: Object.keys(CONTENT), hint: "?secret=..&run=1" });
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || url.searchParams.get("secret") !== expected) return out({ ok: false, error: "시크릿 불일치" }, 403);

  const result: any = {};
  try {
    for (const [segment, def] of Object.entries(CONTENT)) {
      const j = rows(await db.execute(sql`SELECT id FROM nurture_journeys WHERE segment = ${segment} ORDER BY id LIMIT 1`))[0];
      if (!j) { result[segment] = "여정 없음"; continue; }
      const jid = Number(j.id);
      /* 기존 단계·영구 비활성(교체) */
      await db.execute(sql`DELETE FROM nurture_steps WHERE journey_id = ${jid}`);
      await db.execute(sql`DELETE FROM nurture_evergreen_rules WHERE journey_id = ${jid}`);

      const mkTemplate = async (name: string, channel: string, subject: string | null, body: string): Promise<number> => {
        const ex = rows(await db.execute(sql`SELECT id FROM communication_templates WHERE name = ${name} LIMIT 1`))[0];
        if (ex) {
          await db.execute(sql`UPDATE communication_templates SET channel=${channel}, category='nurture', subject=${subject}, body_template=${body}, variables=${SMS_VARS}::jsonb, is_active=true, updated_at=NOW() WHERE id=${ex.id}`);
          return Number(ex.id);
        }
        const r = rows(await db.execute(sql`INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active, created_at, updated_at) VALUES (${name}, ${channel}, 'nurture', ${subject}, ${body}, ${SMS_VARS}::jsonb, true, NOW(), NOW()) RETURNING id`))[0];
        return Number(r.id);
      };

      const steps: any[] = [];
      for (const st of def.steps) {
        const smsId = await mkTemplate(`[너처링·문자] ${st.label}`, "sms", null, st.sms);
        let emailId: number | null = null;
        if (st.emailParas && st.emailSubject) emailId = await mkTemplate(`[너처링·메일] ${st.label}`, "email", st.emailSubject, emailHtml(st.emailParas));
        await db.execute(sql`INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, email_template_id, label, is_active, conditions, sort_order)
          VALUES (${jid}, ${st.d}, 'sms', ${smsId}, ${emailId}, ${st.label}, true, '{}'::jsonb, ${st.d})`);
        steps.push({ d: st.d, smsId, emailId });
      }
      const evers: any[] = [];
      for (const ev of def.ever) {
        const smsId = await mkTemplate(`[너처링·문자] ${ev.label}`, "sms", null, ev.sms);
        let emailId: number | null = null;
        if (ev.emailParas && ev.emailSubject) emailId = await mkTemplate(`[너처링·메일] ${ev.label}`, "email", ev.emailSubject, emailHtml(ev.emailParas));
        await db.execute(sql`INSERT INTO nurture_evergreen_rules (journey_id, cadence, channel, template_id, email_template_id, label, is_active, created_at, updated_at)
          VALUES (${jid}, ${ev.cadence}, 'sms', ${smsId}, ${emailId}, ${ev.label}, true, NOW(), NOW())`);
        evers.push({ cadence: ev.cadence, smsId, emailId });
      }
      result[segment] = { journeyId: jid, steps: steps.length, evergreen: evers.length };
    }
    return out({ ok: true, seeded: result, note: "여정은 OFF 유지 — 운영자 검토 후 ON" });
  } catch (e: any) {
    return out({ ok: false, error: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 600), partial: result }, 500);
  }
};
