import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial" };

/* 추모관 R2 — 온라인 추모관 본체 (1회용·호출 성공 후 삭제)
   - 6테이블 CREATE IF NOT EXISTS + 인덱스
   - memorial_settings 시드 1행 (히어로 영상·헌사 카피·BGM 빈 목록)
   - 선생님 8분 시드 (설계서 §5.2 — name+school_region 중복방지·멱등)
   GET            : 진단(인증 불필요)
   GET ?run=1     : requireAdmin 후 실행 */

/* 선생님 8분 시드 — 설계서 §5.2 (공개 보도 기반).
   death_date 불확실(월·연만 확인)은 null. photo_blob_id=null(실루엣)·is_public=true. */
interface TeacherSeed {
  sort: number;
  name: string;
  region: string;
  death: string | null;   // YYYY-MM-DD 또는 null
  tribute: string;
  bio: string;
  timeline: any[];
}

const TEACHERS: TeacherSeed[] = [
  {
    sort: 1,
    name: "故 서이초 선생님",
    region: "서울 서초구 서이초등학교",
    death: "2023-07-18",
    tribute: "아이들 곁에서 빛났던, 우리가 끝내 지키지 못한 선생님",
    bio: `<p>2023년 7월, 서울 서이초등학교의 젊은 선생님이 학교 안에서 세상을 떠났습니다. 교권 침해와 과중한 부담에 대한 사회적 논의에 불을 지핀 이 죽음 앞에서, 검은 옷을 입은 수만 명의 교사와 시민이 거리로 나와 "교사가 살아야 교육이 산다"고 외쳤습니다.</p><p>49재였던 9월 4일에는 전국에서 10만 명이 넘는 교사가 추모에 함께했습니다. 2024년 2월, 선생님의 죽음은 순직(공무상 재해)으로 인정되었습니다. 우리는 이 죽음이 한 사람의 비극이 아니라 우리 모두의 책임임을 기억합니다.</p>`,
    timeline: [
      { date: "2023-07-18", title: "별세", desc: "학교에서 세상을 떠나심" },
      { date: "2023-07-22", title: "첫 추모 집회", desc: "전국 교사 거리로" },
      { date: "2023-09-04", title: "49재·공교육 멈춤의 날", desc: "10만+ 추모" },
      { date: "2024-02-27", title: "순직 인정", desc: "공무상 재해 인정" },
    ],
  },
  {
    sort: 2,
    name: "故 이영승 선생님",
    region: "경기 의정부 호원초등학교",
    death: null,   // 2021-12 (불확실)
    tribute: "첫 발령지에서 아이들을 만났던 새내기 선생님",
    bio: `<p>2021년, 의정부 호원초등학교의 새내기 선생님이 학부모들의 악성 민원에 시달리다 세상을 떠났습니다. 학교는 한때 단순 추락사로 보고했지만, 유가족의 끈질긴 진상규명 끝에 진실이 드러났습니다.</p><p>2023년 10월, 선생님의 죽음은 순직으로 인정되었습니다. 그 인정은 같은 해 같은 학교에서 떠난 동료, 그리고 전국의 교사들이 함께 싸워 얻어낸 결과였습니다.</p>`,
    timeline: [
      { date: "2021-12", title: "별세" },
      { date: "2023-10-18", title: "순직 인정", desc: "인사혁신처 공무상 재해 인정" },
    ],
  },
  {
    sort: 3,
    name: "故 김은지 선생님",
    region: "경기 의정부 호원초등학교",
    death: null,   // 2021 (불확실)
    tribute: "같은 학교, 같은 아픔 — 함께 기억해야 할 선생님",
    bio: `<p>호원초등학교에서 6개월 간격으로 떠난 두 새내기 선생님 중 한 분입니다. 안타깝게도 선생님의 죽음은 "개인적 취약성"을 이유로 아직 순직으로 인정받지 못했습니다.</p><p>그러나 같은 학교에서 같은 고통을 겪은 동료의 순직이 인정된 만큼, 선생님의 명예 회복을 위한 노력도 멈추지 않습니다. 우리는 인정 여부와 상관없이 선생님을 똑같이 기억하고 함께합니다.</p>`,
    timeline: [
      { date: "2021", title: "별세" },
      { date: "", title: "순직 미인정", desc: "명예 회복 노력 지속" },
    ],
  },
  {
    sort: 4,
    name: "故 상명대부설초 선생님",
    region: "서울 종로구 상명대사대부속초",
    death: null,   // 2023-01 (불확실)
    tribute: "짧게 머물렀지만 깊이 사랑했던 기간제 선생님",
    bio: `<p>2022년 봄 상명대학교사범대학부속초등학교에 부임한 기간제 선생님이 학부모의 지속적인 갑질과 과중한 업무에 시달리다 그해 여름 우울증을 진단받고 사직했고, 2023년 1월 끝내 세상을 떠났습니다.</p><p>학교는 선생님의 어려움을 알면서도 도움을 주지 않았던 것으로 조사됐습니다. 기간제라는 이유로 더 외로웠을 선생님을, 우리는 차별 없이 기억합니다.</p>`,
    timeline: [
      { date: "2022-03", title: "부임" },
      { date: "2023-01", title: "별세" },
      { date: "2023-12-15", title: "교육청 조사결과 발표" },
    ],
  },
  {
    sort: 5,
    name: "故 신목초 선생님",
    region: "서울 양천구 신목초등학교",
    death: "2023-08-31",
    tribute: "끝까지 아이들을 놓지 않았던 6학년 담임 선생님",
    bio: `<p>2023년 8월, 서울 신목초등학교에서 6학년 담임을 맡았던 선생님이 학생 지도와 학부모 민원의 무게를 홀로 감당하다 세상을 떠났습니다. 어려운 학급을 끝까지 책임지려 애썼던 선생님이었습니다.</p><p>사건 직후 학교의 책임 회피와 함구 종용이 알려지며 교사 사회의 공분을 샀고, 동료들은 진상규명을 요구했습니다. 이후 인사혁신처는 선생님의 죽음과 업무 사이 인과관계를 인정해 순직으로 결정했습니다.</p>`,
    timeline: [
      { date: "2023-08-31", title: "별세" },
      { date: "2023-09-01", title: "교사노조 성명", desc: "진상규명 촉구" },
      { date: "", title: "순직 인정" },
    ],
  },
  {
    sort: 6,
    name: "故 무녀도초 선생님",
    region: "전북 군산 무녀도초등학교",
    death: "2023-08-31",
    tribute: "작은 섬 학교에서 아이들과 함께한 선생님",
    bio: `<p>2023년 8월, 전북 군산의 작은 섬 학교에서 6학년 담임을 맡았던 선생님이 세상을 떠났습니다. 교사가 단 세 명뿐인 초미니 학교에서 담임과 방과후·행정 업무까지 감당했고, 상급자의 사적인 일에 동원되는 등 과중한 격무와 부당한 처우에 시달린 정황이 전해졌습니다.</p><p>유가족과 동료들은 선생님의 순직 인정을 위해 재심을 청구하며 진상규명을 이어가고 있습니다.</p>`,
    timeline: [
      { date: "2023-08-31", title: "별세" },
      { date: "2024-04-17", title: "순직 재심 청구", desc: "전북교사노조" },
    ],
  },
  {
    sort: 7,
    name: "故 대전 선생님",
    region: "대전 관평초(2019~2022)·용산초(2023)",
    death: "2023-09-07",
    tribute: "24년간 교단을 지킨, 끝내 무너지지 않으려 했던 선생님",
    bio: `<p>24년차 베테랑 선생님이 4년에 걸친 학부모의 악성 민원과 무고성 아동학대 신고(이후 무혐의)로 깊은 상처를 안고 살아왔습니다. 2023년 서이초 사건을 계기로 자신의 교권 침해 경험을 동료들에게 알리며 변화를 호소하던 중, 그해 9월 끝내 세상을 떠났습니다.</p><p>2024년 4월, 선생님의 죽음은 순직으로 인정되었습니다. 정당한 교육 활동이 어떻게 한 교사를 벼랑으로 내몰 수 있는지를 우리에게 묻습니다.</p>`,
    timeline: [
      { date: "2023-09-05", title: "쓰러지심" },
      { date: "2023-09-07", title: "별세" },
      { date: "2024-04", title: "순직 인정" },
    ],
  },
  {
    sort: 8,
    name: "故 제주 선생님",
    region: "제주 모 중학교",
    death: "2025-05-22",
    tribute: "제주의 교단을 지킨 선생님",
    bio: `<p>2025년 5월, 제주의 한 중학교 선생님이 세상을 떠났습니다. 무단결석과 흡연을 한 학생을 생활지도한 뒤, 학생 가족으로부터 밤낮없이 하루 수차례의 항의 전화에 시달려 온 것으로 전해졌습니다.</p><p>서이초 이후에도 달라지지 않은 현실에 분노한 전국의 교사들이 2년 만에 다시 거리로 나와 선생님을 추모하고 교권 보호 대책을 촉구했습니다.</p>`,
    timeline: [
      { date: "2025-05-22", title: "별세" },
      { date: "2025-06", title: "전국 교원 추모집회" },
    ],
  },
];

async function createTables() {
  /* 1) memorial_settings */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS memorial_settings (
      id              SERIAL PRIMARY KEY,
      hero_youtube_id VARCHAR(20),
      hero_copy       VARCHAR(300),
      bgm_tracks      JSONB,
      updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`);

  /* 2) memorial_teachers */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS memorial_teachers (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(60) NOT NULL,
      photo_blob_id INTEGER,
      school_region VARCHAR(120),
      birth_date    DATE,
      death_date    DATE,
      tribute_line  VARCHAR(200),
      bio_html      TEXT,
      timeline      JSONB,
      is_public     BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_by    INTEGER,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS memorial_teachers_pub_sort_idx ON memorial_teachers (is_public, sort_order)`);

  /* 3) memorial_offerings */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS memorial_offerings (
      id            SERIAL PRIMARY KEY,
      teacher_id    INTEGER,
      member_id     INTEGER,
      nickname      VARCHAR(40),
      offering_type VARCHAR(10) NOT NULL,
      ip_hash       VARCHAR(64),
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS memorial_offerings_teacher_idx ON memorial_offerings (teacher_id)`);

  /* 4) memorial_messages */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS memorial_messages (
      id           SERIAL PRIMARY KEY,
      teacher_id   INTEGER,
      member_id    INTEGER,
      author_name  VARCHAR(50) NOT NULL,
      content      VARCHAR(1000) NOT NULL,
      is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      like_count   INTEGER NOT NULL DEFAULT 0,
      report_count INTEGER NOT NULL DEFAULT 0,
      is_hidden    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS memorial_messages_teacher_idx ON memorial_messages (teacher_id, is_hidden)`);

  /* 5) memorial_letters */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS memorial_letters (
      id           SERIAL PRIMARY KEY,
      teacher_id   INTEGER NOT NULL,
      member_id    INTEGER,
      author_name  VARCHAR(50) NOT NULL,
      title        VARCHAR(150),
      content      TEXT NOT NULL,
      is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      report_count INTEGER NOT NULL DEFAULT 0,
      is_hidden    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )`);

  /* 6) memorial_message_likes */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS memorial_message_likes (
      id         SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL,
      member_id  INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS memorial_msg_like_uniq ON memorial_message_likes (message_id, member_id)`);
}

async function seedSettings(): Promise<boolean> {
  const r: any = await db.execute(sql`
    INSERT INTO memorial_settings (hero_youtube_id, hero_copy, bgm_tracks)
    SELECT 'l97eBPM_d9E', '우리는 당신들을 기억합니다', '[]'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM memorial_settings)
    RETURNING id`);
  const rows = r?.rows ?? r ?? [];
  return rows.length > 0;
}

async function seedTeachers(): Promise<number> {
  let inserted = 0;
  for (const t of TEACHERS) {
    const r: any = await db.execute(sql`
      INSERT INTO memorial_teachers
        (name, school_region, death_date, tribute_line, bio_html, timeline, is_public, sort_order, photo_blob_id)
      SELECT ${t.name}, ${t.region}, ${t.death}, ${t.tribute}, ${t.bio}, ${JSON.stringify(t.timeline)}::jsonb, TRUE, ${t.sort}, NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM memorial_teachers WHERE name = ${t.name} AND school_region = ${t.region}
      )
      RETURNING id`);
    const rows = r?.rows ?? r ?? [];
    if (rows.length > 0) inserted++;
  }
  return inserted;
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 (인증 불필요) ── */
  if (!run) {
    try {
      const exists: any = await db.execute(sql`
        SELECT to_regclass('public.memorial_teachers') IS NOT NULL AS has_table`);
      const hasTable = (exists?.rows ?? exists ?? [])[0]?.has_table ?? false;
      let teacherCount = 0;
      if (hasTable) {
        const c: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM memorial_teachers`);
        teacherCount = (c?.rows ?? c ?? [])[0]?.n ?? 0;
      }
      return Response.json({
        ok: true,
        mode: "diagnostic",
        tablesExist: hasTable,
        teacherCount,
        willSeedTeachers: TEACHERS.length,
        hint: "어드민 로그인 후 ?run=1",
      });
    } catch (err: any) {
      return Response.json({ ok: false, error: String(err?.message || err).slice(0, 300) }, { status: 500 });
    }
  }

  /* ── 실행 모드 (requireAdmin) ── */
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const done: Record<string, any> = {};
  try {
    await createTables();
    done.tables = ["memorial_settings", "memorial_teachers", "memorial_offerings", "memorial_messages", "memorial_letters", "memorial_message_likes"];

    done.settingsSeeded = await seedSettings();
    done.teachersInserted = await seedTeachers();

    return Response.json({ ok: true, mode: "run", done });
  } catch (err: any) {
    return Response.json({
      ok: false,
      error: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 800),
      done,
    }, { status: 500 });
  }
}
