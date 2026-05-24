import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-family-stories" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);

  // 진단 모드 (인증 불필요)
  if (!url.searchParams.has("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      message: "마이그레이션 준비됨. ?run=1 로 실행 (어드민 인증 필요)",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  try {
    // 1) 테이블 생성 (멱등)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS family_stories (
        id            SERIAL PRIMARY KEY,
        youtube_id    VARCHAR(20),
        youtube_url   TEXT,
        title         VARCHAR(200) NOT NULL,
        subtitle      VARCHAR(300),
        thumbnail_url TEXT,
        summary       VARCHAR(500),
        detail_html   TEXT,
        admin_notes   TEXT,
        duration      VARCHAR(12),
        category      VARCHAR(30)  NOT NULL DEFAULT 'voice',
        status        VARCHAR(12)  NOT NULL DEFAULT 'draft',
        sort_order    INTEGER      NOT NULL DEFAULT 0,
        view_count    INTEGER      NOT NULL DEFAULT 0,
        published_at  TIMESTAMP,
        created_by    INTEGER,
        created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);

    // 2) 인덱스 생성 (멱등)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS family_stories_status_sort_idx
        ON family_stories (status, sort_order)
    `);

    // 3) 시드 4행 INSERT (youtube_id 기준 중복 방지 · status=published)
    const seeds = [
      {
        youtubeId: "xJLia-INHvI",
        youtubeUrl: "https://www.youtube.com/watch?v=xJLia-INHvI",
        title: "서이초 사건 그 이후... 교사유가족협의회란?",
        subtitle: "왜 우리가 모였는가",
        thumbnailUrl: "https://i.ytimg.com/vi/xJLia-INHvI/hqdefault.jpg",
        summary: "한 선생님의 죽음 이후, 유가족이 직접 만든 협의회의 시작과 약속.",
        category: "intro",
        duration: "5:38",
        sortOrder: 1,
        detailHtml: `<p>한 선생님이 우리 곁을 떠났습니다. 그 비통한 사건은 전국의 교사와 시민의 마음을 움직였고, 거리에는 추모의 촛불이 켜졌습니다.</p>
<p>(사)교사유가족협의회는 그렇게 남겨진 유가족들이 직접 손을 맞잡고 만든 단체입니다. 같은 아픔을 겪은 이들이 서로의 곁을 지키고, 다시는 같은 일이 반복되지 않도록 진상규명과 제도 개선을 요구하기 위해 모였습니다.</p>
<h3>우리가 하는 일</h3>
<p>유가족 심리상담과 법률 지원, 순직(공무상 재해) 인정 지원, 추모와 장학 사업, 그리고 교권 보호를 위한 연대 — 협의회는 슬픔을 딛고 행동으로 기억합니다.</p>
<p>이 영상은 협의회가 어떻게 시작되었고 무엇을 향해 나아가는지를 5분 남짓한 시간에 담았습니다. 함께해 주시는 한 분 한 분이 우리의 힘입니다.</p>`,
      },
      {
        youtubeId: "6DhgPY_c0Gw",
        youtubeUrl: "https://www.youtube.com/watch?v=6DhgPY_c0Gw",
        title: "[1분 인터뷰] 유가족의 목소리... 함께 들어주세요",
        subtitle: "짧지만 깊은, 남겨진 이들의 한마디",
        thumbnailUrl: "https://i.ytimg.com/vi/6DhgPY_c0Gw/hqdefault.jpg",
        summary: "1분 남짓한 시간에 담긴 유가족의 진심. 가장 먼저 들어주세요.",
        category: "voice",
        duration: "1:22",
        sortOrder: 2,
        detailHtml: `<p>채 1분이 되지 않는 짧은 시간입니다. 그러나 이 한마디를 꺼내기까지, 남겨진 이들은 수없이 많은 밤을 건너왔습니다.</p>
<p>화려한 말도, 거창한 호소도 없습니다. 다만 "우리를 잊지 말아 달라"는, 가장 단순하고 가장 절박한 부탁이 담겨 있을 뿐입니다.</p>
<h3>지금, 들어주세요</h3>
<p>듣는 일에는 자격이 필요하지 않습니다. 잠시 하던 일을 멈추고 이 목소리에 귀를 기울이는 것 — 그것만으로도 유가족에게는 큰 위로가 됩니다. 함께 들어주셔서 고맙습니다.</p>`,
      },
      {
        youtubeId: "XY8cwu1wfZQ",
        youtubeUrl: "https://www.youtube.com/watch?v=XY8cwu1wfZQ",
        title: "[유가족의 목소리] 교사 유가족의 인터뷰",
        subtitle: "긴 호흡으로 듣는 이야기",
        thumbnailUrl: "https://i.ytimg.com/vi/XY8cwu1wfZQ/hqdefault.jpg",
        summary: "16분, 유가족이 직접 들려주는 그날 이후의 삶과 바람.",
        category: "interview",
        duration: "16:51",
        sortOrder: 3,
        detailHtml: `<p>16분, 결코 짧지 않은 시간 동안 유가족이 직접 들려주는 이야기입니다. 그날 이후 달라진 일상, 견뎌낸 시간, 그리고 여전히 품고 있는 바람까지 — 꾸밈없이 담았습니다.</p>
<p>인터뷰 속 한마디 한마디에는 한 가정이 감당해야 했던 무게가 실려 있습니다. 동시에, 같은 아픔을 겪을지 모를 누군가를 위해 용기 내어 카메라 앞에 선 마음도 함께 담겨 있습니다.</p>
<h3>끝까지 들어주세요</h3>
<p>긴 이야기이지만, 끝까지 함께해 주시길 부탁드립니다. 한 사람의 진심을 온전히 듣는 일은, 그 자체로 가장 따뜻한 연대입니다.</p>`,
      },
      {
        youtubeId: "l97eBPM_d9E",
        youtubeUrl: "https://www.youtube.com/watch?v=l97eBPM_d9E",
        title: "[유가족의 목소리] 교육공동체 헌정 영상",
        subtitle: "기억을 모아 만든 헌정",
        thumbnailUrl: "https://i.ytimg.com/vi/l97eBPM_d9E/hqdefault.jpg",
        summary: "먼저 떠난 선생님들과 교육공동체에 바치는 짧은 헌정 영상.",
        category: "tribute",
        duration: "2:34",
        sortOrder: 4,
        detailHtml: `<p>먼저 떠난 선생님들, 그리고 지금도 교단을 지키는 모든 선생님께 바치는 짧은 헌정입니다.</p>
<p>한 사람의 교사는 수백 명의 아이를 길러냅니다. 그 헌신과 사랑은 쉽게 보이지 않지만, 우리 사회 어디에나 남아 있습니다. 이 영상은 그 보이지 않던 마음을 한 자리에 모았습니다.</p>
<h3>기억이 곧 연대입니다</h3>
<p>잊지 않는 것, 함께 기억하는 것 — 그것이 남겨진 이들이 가장 바라는 일입니다. 2분 30초의 시간 동안, 우리 곁을 스쳐 간 소중한 이름들을 함께 떠올려 주세요.</p>`,
      },
    ];

    let inserted = 0;
    for (const seed of seeds) {
      const result = await db.execute(sql`
        INSERT INTO family_stories (
          youtube_id, youtube_url, title, subtitle, thumbnail_url,
          summary, category, duration, sort_order, detail_html,
          status, published_at, created_at, updated_at
        )
        SELECT
          ${seed.youtubeId}::varchar(20),
          ${seed.youtubeUrl}::text,
          ${seed.title}::varchar(200),
          ${seed.subtitle}::varchar(300),
          ${seed.thumbnailUrl}::text,
          ${seed.summary}::varchar(500),
          ${seed.category}::varchar(30),
          ${seed.duration}::varchar(12),
          ${seed.sortOrder}::integer,
          ${seed.detailHtml}::text,
          'published'::varchar(12),
          NOW(),
          NOW(),
          NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM family_stories WHERE youtube_id = ${seed.youtubeId}
        )
      `);
      if ((result as any).rowCount > 0) inserted++;
    }

    return new Response(JSON.stringify({
      ok: true,
      message: `마이그레이션 완료. 시드 ${inserted}행 INSERT (중복 제외)`,
      inserted,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "마이그레이션 실패",
      step: "create_or_seed",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
