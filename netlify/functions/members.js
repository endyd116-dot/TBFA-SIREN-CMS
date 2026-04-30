import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("donations");
  const { blobs } = await store.list();
  
  const list = await Promise.all(
    blobs.map(async (b) => await store.get(b.key, { type: "json" }))
  );

  return Response.json({ ok: true, count: list.length, list });
};

export const config = { path: "/api/members" };