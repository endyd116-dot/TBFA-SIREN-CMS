// netlify/functions/diag-outbound-ip.ts
// 진단 — Netlify Functions에서 외부로 나가는 송신 IP 확인.
// 알리고 카카오 콘솔 '발송 서버 IP' 화이트리스트에 등록할 IP 파악용.
//
// 호출: https://tbfa.co.kr/api/diag-outbound-ip
//
// 주의: AWS Lambda 컨테이너 재사용 정책에 따라 호출마다 IP가 달라질 수 있음.
// 3~5회 호출해 IP 변동 범위 확인 권장 → 알리고 IP 대역 등록(공란 옵션) 시 활용.

export const config = { path: "/api/diag-outbound-ip" };

export default async function handler(_req: Request) {
  const sources = [
    "https://api.ipify.org?format=json",
    "https://ifconfig.me/all.json",
    "https://ipinfo.io/json",
  ];
  const results: any[] = [];
  for (const url of sources) {
    try {
      const t0 = Date.now();
      const res = await fetch(url, { headers: { "User-Agent": "siren-diag/1.0" } });
      const text = await res.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
      results.push({
        source: url,
        status: res.status,
        ms: Date.now() - t0,
        ip: parsed.ip || parsed.ip_addr || parsed.query || null,
        full: parsed,
      });
    } catch (err: any) {
      results.push({
        source: url,
        error: String(err?.message || err).slice(0, 200),
      });
    }
  }
  const firstIp = results.find(r => r.ip)?.ip || null;
  return new Response(
    JSON.stringify({
      ok: true,
      outboundIp: firstIp,
      hint: "이 IP를 알리고 콘솔 → 발송 서버 IP에 등록. AWS Lambda는 호출마다 IP가 변동될 수 있으므로 3~5회 새로고침해 변동 범위 확인 후 IP 대역 등록(마지막 옥텟 공란) 권장.",
      sources: results,
    }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
