import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const body = await req.json();
  const store = getStore("contacts");
  const id = `C-${Date.now()}`;
  await store.setJSON(id, { id, ...body, createdAt: new Date().toISOString() });
  return Response.json({ ok: true, id });
};

export const config = { path: "/api/contact" };