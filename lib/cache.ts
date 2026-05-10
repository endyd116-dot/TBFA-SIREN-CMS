import { getStore } from "@netlify/blobs";

const STORE_NAME = "siren-cache";

function getStoreInstance() {
  return getStore(STORE_NAME);
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number; // Unix ms
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const store = getStoreInstance();
    const raw = await store.get(key, { type: "text" });
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() > entry.expiresAt) {
      await store.delete(key).catch(() => {});
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache(key: string, data: unknown, ttlSeconds: number): Promise<void> {
  try {
    const store = getStoreInstance();
    const entry: CacheEntry<unknown> = {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    await store.set(key, JSON.stringify(entry));
  } catch {
    // 캐시 저장 실패는 무시 (fire-and-forget)
  }
}

export async function deleteCache(key: string): Promise<void> {
  try {
    const store = getStoreInstance();
    await store.delete(key);
  } catch {
    // 삭제 실패 무시
  }
}
