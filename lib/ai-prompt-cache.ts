/**
 * Gemini Context Caching — Phase 4
 *
 * 목적: 시스템 프롬프트 + tool declarations를 Gemini의 cachedContents API로
 *       1시간 캐싱 → 매 호출마다 재전송 비용 75% 절감.
 *
 * 제약 (Google 공식 — 2026-05 기준):
 *   - 최소 32,768 토큰 (모델별로 다를 수 있음)
 *   - 우리 시스템 프롬프트는 ~5k 토큰 수준이라 현재는 캐시 거부될 가능성 높음
 *   - 거부 시 폴백으로 일반 호출 (이 모듈은 안전망 구조)
 *
 * 캐시 ID는 ai_prompt_cache 테이블에 (cache_key, cache_name, model, expires_at) 보관
 * → 함수 인스턴스 콜드 스타트에서도 재사용
 *
 * 사용:
 *   const cacheName = await ensurePromptCache({ model, systemPrompt, tools });
 *   if (cacheName) { body.cachedContent = cacheName; body.systemInstruction = undefined; body.tools = undefined; }
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const CACHE_API_URL  = "https://generativelanguage.googleapis.com/v1beta/cachedContents";
const TTL_SECONDS    = 3600;          // 1시간 (Gemini 기본)
const MIN_TOKENS     = 32_768;        // 안전 하한 (Gemini 정책)

/* 메모리 캐시 — 같은 인스턴스 내 빠른 접근 */
const memCache = new Map<string, { name: string; expiresAtMs: number }>();

interface EnsureArgs {
  model: string;
  systemPrompt: string;
  tools: any;        // [{ functionDeclarations: [...] }]
}

/**
 * 캐시 키 = SHA-256-like 해시(model + systemPrompt + tools 직렬화) 앞 16자.
 * 시스템 프롬프트/도구가 바뀌면 자동으로 새 키 → 옛 캐시는 만료되도록 둠.
 */
function buildCacheKey(args: EnsureArgs): string {
  const payload = JSON.stringify({
    model: args.model,
    sys: args.systemPrompt,
    tools: args.tools,
  });
  /* 가벼운 해시 — crypto 의존성 회피 */
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return `${args.model.slice(0, 8)}-${h1.toString(36)}${h2.toString(36)}`.slice(0, 32);
}

/** 토큰 수 추정 — 영어/한글 혼합 1 토큰 ≈ 3.5자 */
function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 3.5);
}

function estimatePayloadTokens(args: EnsureArgs): number {
  const sysTokens = estimateTokens(args.systemPrompt);
  let toolTokens = 0;
  try {
    const t = JSON.stringify(args.tools || []);
    toolTokens = estimateTokens(t);
  } catch { toolTokens = 0; }
  return sysTokens + toolTokens;
}

/**
 * 캐시 ID 확보. 없거나 만료됐으면 새로 생성.
 * 생성 실패(32k 미달·모델 미지원 등) 시 null 반환 → 호출자가 일반 호출로 폴백.
 */
export async function ensurePromptCache(args: EnsureArgs): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  /* 1) 토큰 수 사전 확인 — 32k 미달이면 API 호출 자체 생략 (Google에 거부당하기 전에) */
  const estimated = estimatePayloadTokens(args);
  if (estimated < MIN_TOKENS) {
    /* 한 번만 콘솔에 안내 — flood 방지 */
    if (!hasWarnedMinTokens) {
      console.info(`[prompt-cache] 토큰 ${estimated} < ${MIN_TOKENS} — Context Caching 스킵 (일반 호출)`);
      hasWarnedMinTokens = true;
    }
    return null;
  }

  const key = buildCacheKey(args);
  const now = Date.now();

  /* 2) 메모리 hit */
  const mem = memCache.get(key);
  if (mem && mem.expiresAtMs > now) return mem.name;

  /* 3) DB hit (콜드 스타트 후 재사용) */
  try {
    const r: any = await db.execute(sql`
      SELECT cache_name, EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_ms
        FROM ai_prompt_cache
       WHERE cache_key = ${key}
         AND expires_at > NOW()
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row?.cache_name) {
      memCache.set(key, { name: String(row.cache_name), expiresAtMs: Number(row.expires_ms) });
      return String(row.cache_name);
    }
  } catch { /* 테이블 없거나 조회 실패 — 다음 단계로 진행 */ }

  /* 4) Gemini Context Caching API로 신규 생성 시도 */
  const created = await createCacheOnGemini(args);
  if (!created) return null;

  const expiresAtMs = now + TTL_SECONDS * 1000;
  memCache.set(key, { name: created, expiresAtMs });

  /* DB에 저장 — fire-and-forget (실패해도 메모리 캐시는 유지) */
  try {
    await db.execute(sql`
      INSERT INTO ai_prompt_cache (cache_key, cache_name, model, expires_at)
      VALUES (${key}, ${created}, ${args.model}, to_timestamp(${expiresAtMs / 1000}))
      ON CONFLICT (cache_key) DO UPDATE SET
        cache_name = EXCLUDED.cache_name,
        model = EXCLUDED.model,
        expires_at = EXCLUDED.expires_at
    `);
  } catch (e) {
    console.warn("[prompt-cache] DB 저장 실패", (e as any)?.message);
  }

  return created;
}

let hasWarnedMinTokens = false;

async function createCacheOnGemini(args: EnsureArgs): Promise<string | null> {
  const body: any = {
    model: `models/${args.model}`,
    contents: [],  // 새 대화는 generateContent 시점에 추가됨
    systemInstruction: { parts: [{ text: args.systemPrompt }] },
    tools: args.tools,
    ttl: `${TTL_SECONDS}s`,
  };

  try {
    const r = await fetch(`${CACHE_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.warn(`[prompt-cache] 생성 실패 ${r.status}: ${errText.slice(0, 200)}`);
      return null;
    }
    const data: any = await r.json();
    const name = data?.name;
    if (typeof name === "string" && name.startsWith("cachedContents/")) {
      console.info(`[prompt-cache] 생성 성공: ${name} (TTL ${TTL_SECONDS}s)`);
      return name;
    }
    return null;
  } catch (e) {
    console.warn("[prompt-cache] 네트워크 오류", (e as any)?.message);
    return null;
  }
}

/** 어드민·진단용 — 현재 메모리 캐시 상태 */
export function getPromptCacheStats() {
  const now = Date.now();
  const valid = Array.from(memCache.values()).filter(v => v.expiresAtMs > now).length;
  return { memSize: memCache.size, valid, ttlSeconds: TTL_SECONDS, minTokens: MIN_TOKENS };
}

/** 강제 무효화 — 시스템 프롬프트 변경 직후 호출하면 즉시 새 캐시 생성 */
export async function invalidatePromptCache(): Promise<void> {
  memCache.clear();
  try {
    await db.execute(sql`DELETE FROM ai_prompt_cache WHERE expires_at < NOW() + INTERVAL '1 hour'`);
  } catch { /* noop */ }
}
