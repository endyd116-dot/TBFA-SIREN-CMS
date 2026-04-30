import { getStore } from "@netlify/blobs";

export default async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { name, phone, amount, type, payMethod } = body;

    // 유효성 검증
    if (!name || !amount) {
      return Response.json({ ok: false, error: "필수값 누락" }, { status: 400 });
    }

    // Netlify Blobs에 저장 (KV 스토어)
    const store = getStore("donations");
    const id = `D-${Date.now()}`;
    const record = {
      id,
      name,
      phone,
      amount: Number(amount),
      type,
      payMethod,
      createdAt: new Date().toISOString(),
      status: "completed"
    };
    await store.setJSON(id, record);

    return Response.json({
      ok: true,
      message: "후원이 완료되었습니다. 감사합니다.",
      donationId: id
    });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
};

export const config = { path: "/api/donate" };