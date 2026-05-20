/**
 * /api/admin-oci-config-set — OCI 자동 재부팅 설정을 Netlify Blobs에 저장 (1회용·super_admin 전용)
 *   GET            현재 설정 소스 진단 (env|blobs|none, 비밀값 노출 없음)
 *   GET ?verify=1  실제 OCI 인증·서명·권한 검증 (읽기 전용 GetInstance — 프록시 안 건드림)
 *   POST           body { tenancy, user, fingerprint, region, instanceId, privateKey, passphrase? } → Blobs 저장
 *   DELETE         Blobs 설정 삭제
 *
 * AWS Lambda 환경변수 4KB 한도 때문에 OCI private key를 환경변수 대신 Blobs에 둔다.
 * 등록·검증 완료 후 본 함수 + public/oci-setup.html 삭제 (1회용 보안 원칙).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import {
  saveOciConfigToBlobs, getInstanceState, ociConfigSource,
  OCI_BLOB_STORE, OCI_BLOB_KEY,
} from "../../lib/oci-client";
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/admin-oci-config-set" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return json({ ok: false, error: "슈퍼어드민 전용" }, 403);
  }

  const url = new URL(req.url);

  // GET — 진단 / 검증
  if (req.method === "GET") {
    if (url.searchParams.get("verify") === "1") {
      const r = await getInstanceState();   // 읽기 전용 — 프록시 재부팅 안 함
      return json({ ok: r.ok, source: await ociConfigSource(), verify: r });
    }
    return json({ ok: true, source: await ociConfigSource() });
  }

  // POST — Blobs 저장
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return json({ ok: false, error: "JSON 본문 필수" }, 400); }
    const required = ["tenancy", "user", "fingerprint", "region", "instanceId", "privateKey"];
    for (const f of required) {
      if (!body?.[f] || typeof body[f] !== "string" || !body[f].trim()) {
        return json({ ok: false, error: `${f} 필수` }, 400);
      }
    }
    if (!String(body.privateKey).includes("PRIVATE KEY")) {
      return json({ ok: false, error: "privateKey가 PEM 형식이 아닙니다 (-----BEGIN PRIVATE KEY----- 포함 전체)" }, 400);
    }
    try {
      await saveOciConfigToBlobs({
        tenancy: String(body.tenancy).trim(),
        user: String(body.user).trim(),
        fingerprint: String(body.fingerprint).trim(),
        region: String(body.region).trim(),
        instanceId: String(body.instanceId).trim(),
        privateKey: String(body.privateKey),
        passphrase: body.passphrase ? String(body.passphrase) : undefined,
      });
      // 저장 직후 읽기 전용 검증
      const verify = await getInstanceState();
      return json({ ok: true, saved: true, verify });
    } catch (err: any) {
      return json({ ok: false, error: "저장 실패", detail: String(err?.message || err).slice(0, 300) }, 500);
    }
  }

  // DELETE — 설정 삭제
  if (req.method === "DELETE") {
    try {
      const store = getStore(OCI_BLOB_STORE);
      await store.delete(OCI_BLOB_KEY);
      return json({ ok: true, deleted: true });
    } catch (err: any) {
      return json({ ok: false, error: "삭제 실패", detail: String(err?.message || err).slice(0, 300) }, 500);
    }
  }

  return json({ ok: false, error: "지원하지 않는 메서드" }, 405);
}
