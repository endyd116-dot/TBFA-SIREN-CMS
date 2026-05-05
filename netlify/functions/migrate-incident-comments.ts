import { db } from "../../db";
import { sql } from "drizzle-orm";

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-comments-2026") {
    return new Response(JSON.stringify({ ok: false, error: "invalid key" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const results: string[] = [];

    /* 1. incident_comments */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS incident_comments (
        id              SERIAL PRIMARY KEY,
        incident_id     INT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
        member_id       INT REFERENCES members(id) ON DELETE SET NULL,
        parent_id       INT REFERENCES incident_comments(id) ON DELETE CASCADE,
        author_name     VARCHAR(50) NOT NULL,
        content         VARCHAR(1000) NOT NULL,
        is_anonymous    BOOLEAN DEFAULT false,
        is_private      BOOLEAN DEFAULT false,
        like_count      INT DEFAULT 0,
        dislike_count   INT DEFAULT 0,
        is_hidden       BOOLEAN DEFAULT false,
        hidden_by       INT REFERENCES members(id) ON DELETE SET NULL,
        hidden_at       TIMESTAMP,
        created_at      TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    results.push("✓ incident_comments 테이블 생성");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ic_incident ON incident_comments(incident_id, created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ic_member ON incident_comments(member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ic_parent ON incident_comments(parent_id)`);
    results.push("✓ incident_comments 인덱스 생성");

    /* 2. comment_votes */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS comment_votes (
        id          SERIAL PRIMARY KEY,
        comment_id  INT NOT NULL REFERENCES incident_comments(id) ON DELETE CASCADE,
        member_id   INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        vote_type   VARCHAR(10) NOT NULL,
        created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(comment_id, member_id)
      )
    `);
    results.push("✓ comment_votes 테이블 생성");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cv_comment ON comment_votes(comment_id)`);
    results.push("✓ comment_votes 인덱스 생성");

    /* 3. comment_reports */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS comment_reports (
        id           SERIAL PRIMARY KEY,
        comment_id   INT REFERENCES incident_comments(id) ON DELETE CASCADE,
        incident_id  INT REFERENCES incidents(id) ON DELETE CASCADE,
        member_id    INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        report_type  VARCHAR(20) NOT NULL DEFAULT 'comment',
        reason       VARCHAR(500) NOT NULL,
        status       VARCHAR(20) DEFAULT 'pending',
        reviewed_by  INT REFERENCES members(id) ON DELETE SET NULL,
        reviewed_at  TIMESTAMP,
        created_at   TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    results.push("✓ comment_reports 테이블 생성");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cr_comment ON comment_reports(comment_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cr_incident ON comment_reports(incident_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cr_status ON comment_reports(status)`);
    results.push("✓ comment_reports 인덱스 생성");

    /* 4. 임시 사건 데이터 5건 (이미 있으면 스킵) */
    const existingCount: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM incidents`);
    const rows = Array.isArray(existingCount) ? existingCount : (existingCount?.rows || []);
    const cnt = Number(rows[0]?.cnt || 0);

    if (cnt < 5) {
      const seedIncidents = [
        { slug: "case-2023-seoul-elementary", title: "2023년 서울 초등학교 교사 사건", summary: "서울시 소재 초등학교 교사의 안타까운 사건. 학부모 민원과 관리자 무대응이 원인으로 지목됨.", category: "school", location: "서울특별시" },
        { slug: "case-2024-busan-middle", title: "2024년 부산 중학교 교사 사건", summary: "부산 소재 중학교에서 발생한 사건. 학생 폭력과 학교 측 부실 대응이 문제됨.", category: "school", location: "부산광역시" },
        { slug: "case-2024-daegu-high", title: "2024년 대구 고등학교 교사 사건", summary: "대구 소재 고등학교 교사의 극단적 선택. 악성민원과 업무 과중이 복합 작용.", category: "school", location: "대구광역시" },
        { slug: "case-2025-incheon-special", title: "2025년 인천 특수학교 교사 사건", summary: "인천 특수학교에서 발생한 사건. 특수교육 현장의 구조적 문제가 부각됨.", category: "school", location: "인천광역시" },
        { slug: "case-2025-gwangju-elementary", title: "2025년 광주 초등학교 교사 사건", summary: "광주 소재 초등학교의 사건. 교권 보호 제도의 한계가 드러난 사례.", category: "school", location: "광주광역시" },
      ];

      for (const s of seedIncidents) {
        await db.execute(sql`
          INSERT INTO incidents (slug, title, summary, category, location, status, sort_order, created_at, updated_at)
          VALUES (${s.slug}, ${s.title}, ${s.summary}, ${s.category}, ${s.location}, 'active', 0, NOW(), NOW())
          ON CONFLICT (slug) DO NOTHING
        `);
      }
      results.push("✓ 임시 사건 5건 시드 완료");
    } else {
      results.push("⏭ 사건 데이터 이미 " + cnt + "건 존재 — 시드 스킵");
    }

    /* 5. 임시 댓글 데이터 (각 사건당 10개) */
    const incidentIds: any = await db.execute(sql`SELECT id FROM incidents WHERE status = 'active' ORDER BY id LIMIT 5`);
    const incRows = Array.isArray(incidentIds) ? incidentIds : (incidentIds?.rows || []);

    const sampleComments = [
      "고인의 명복을 빕니다. 이런 일이 다시는 일어나지 않아야 합니다.",
      "교사들의 인권이 보장되어야 합니다. 더 이상 침묵하지 않겠습니다.",
      "유가족분들께 깊은 위로를 전합니다. 함께 목소리를 내겠습니다.",
      "학교 관리자들의 책임을 묻는 제도가 시급합니다.",
      "이 사건을 계기로 교권 보호법이 실질적으로 개선되길 바랍니다.",
      "현직 교사입니다. 동료의 아픔에 깊이 공감합니다.",
      "추모합니다. 남은 가족분들이 일상으로 돌아가실 수 있도록 지원하겠습니다.",
      "악성민원 문화가 바뀌어야 합니다. 사회 전체의 인식 변화가 필요합니다.",
      "이런 안타까운 사건이 반복되지 않도록 교육부가 나서야 합니다.",
      "작은 관심과 연대가 큰 힘이 됩니다. 함께하겠습니다.",
    ];
    const sampleAuthors = ["김교사", "이선생", "박동료", "최학부모", "정시민", "한지원", "윤기억", "서연대", "강교원", "임희망"];

    let commentCount = 0;
    for (const incRow of incRows as any[]) {
      const incId = incRow.id;
      /* 이미 댓글 있으면 스킵 */
      const existCmt: any = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM incident_comments WHERE incident_id = ${incId}`);
      const existCmtRows = Array.isArray(existCmt) ? existCmt : (existCmt?.rows || []);
      if (Number(existCmtRows[0]?.cnt || 0) > 0) continue;

      for (let i = 0; i < 10; i++) {
        const isAnon = i % 4 === 3;
        const isPriv = i % 7 === 6;
        await db.execute(sql`
          INSERT INTO incident_comments (incident_id, member_id, author_name, content, is_anonymous, is_private, like_count, dislike_count, created_at)
          VALUES (
            ${incId}, NULL, ${isAnon ? "익명" : sampleAuthors[i]},
            ${sampleComments[i]}, ${isAnon}, ${isPriv},
            ${Math.floor(Math.random() * 20)}, ${Math.floor(Math.random() * 3)},
            NOW() - INTERVAL '${String(10 - i)} days'
          )
        `);
        commentCount++;
      }
    }
    results.push("✓ 임시 댓글 " + commentCount + "건 시드 완료");

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};