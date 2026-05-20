// lib/oci-client.ts
// OCI Compute 인스턴스 재부팅 클라이언트 — SMS 프록시(aligo-proxy) VM 자동 복구용.
// 안정화 3 (2026-05-21): cron-warmup이 프록시 다운 감지 시 호출 → VM hang을 사람 개입 없이 자동 재부팅.
//
// 외부 SDK 없이 Node 내장 crypto로 OCI REST Signature v1(RSA-SHA256) 직접 구현.
//
// ── 설정 로드 우선순위 ──
//  1) 환경변수 6개 (OCI_TENANCY_OCID·OCI_USER_OCID·OCI_FINGERPRINT·OCI_REGION·OCI_INSTANCE_OCID·OCI_PRIVATE_KEY)
//  2) Netlify Blobs("siren-oci" / "config" JSON) — 환경변수 미설정 시
//
// ※ private key(~1.7KB)는 AWS Lambda 환경변수 4KB 한도를 압박하므로 Blobs 저장을 권장(4KB와 무관).
//   admin-oci-config-set 함수로 1회 등록. JSON: { tenancy, user, fingerprint, region, instanceId, privateKey, passphrase? }
//
// 참고: OCI InstanceAction — POST /20160918/instances/{id}?action=RESET (hard reset = 콘솔 Force reboot 등가).
//   메모리 hang 복구가 목적이므로 graceful SOFTRESET 대신 RESET 사용.

import { createSign, createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const OCI_BLOB_STORE = "siren-oci";
export const OCI_BLOB_KEY = "config";

export interface OciResult {
  ok: boolean;
  status: number;
  detail: string;
  skipped?: boolean;
}

interface OciConfig {
  tenancy: string;
  user: string;
  fingerprint: string;
  region: string;
  instanceId: string;
  privateKey: string;
  passphrase?: string;
}

function normalizeKey(pk: string): string {
  // PEM을 한 줄(\n 이스케이프)로 넣은 경우 실제 개행 복원
  return pk.includes("\\n") ? pk.replace(/\\n/g, "\n") : pk;
}

/** 환경변수 6개 — 하나라도 없으면 null. */
function loadFromEnv(): OciConfig | null {
  const tenancy = process.env.OCI_TENANCY_OCID;
  const user = process.env.OCI_USER_OCID;
  const fingerprint = process.env.OCI_FINGERPRINT;
  const region = process.env.OCI_REGION;
  const instanceId = process.env.OCI_INSTANCE_OCID;
  const privateKey = process.env.OCI_PRIVATE_KEY;
  if (!tenancy || !user || !fingerprint || !region || !instanceId || !privateKey) return null;
  return {
    tenancy, user, fingerprint, region, instanceId,
    privateKey: normalizeKey(privateKey),
    passphrase: process.env.OCI_PASSPHRASE || undefined,
  };
}

/** Netlify Blobs("siren-oci"/"config") JSON — 없거나 불완전하면 null. */
async function loadFromBlobs(): Promise<OciConfig | null> {
  try {
    const store = getStore(OCI_BLOB_STORE);
    const raw = await store.get(OCI_BLOB_KEY, { type: "text" });
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j?.tenancy || !j?.user || !j?.fingerprint || !j?.region || !j?.instanceId || !j?.privateKey) return null;
    return {
      tenancy: String(j.tenancy),
      user: String(j.user),
      fingerprint: String(j.fingerprint),
      region: String(j.region),
      instanceId: String(j.instanceId),
      privateKey: normalizeKey(String(j.privateKey)),
      passphrase: j.passphrase ? String(j.passphrase) : undefined,
    };
  } catch {
    return null;
  }
}

/** 환경변수 우선, 없으면 Blobs. */
async function loadOciConfig(): Promise<OciConfig | null> {
  return loadFromEnv() ?? (await loadFromBlobs());
}

/** OCI Signature v1 헤더 생성 (GET은 기본 3개·POST/PUT/PATCH는 body 헤더까지 서명). 빈 body 전제. */
function signedHeaders(cfg: OciConfig, method: string, path: string, host: string): Record<string, string> {
  const lower = method.toLowerCase();
  const date = new Date().toUTCString();
  const keyId = `${cfg.tenancy}/${cfg.user}/${cfg.fingerprint}`;
  const headers: Record<string, string> = { date };
  const parts = [`(request-target): ${lower} ${path}`, `date: ${date}`, `host: ${host}`];
  const names = ["(request-target)", "date", "host"];

  if (lower === "post" || lower === "put" || lower === "patch") {
    const bodySha = createHash("sha256").update("").digest("base64");
    parts.push(`x-content-sha256: ${bodySha}`, `content-type: application/json`, `content-length: 0`);
    names.push("x-content-sha256", "content-type", "content-length");
    headers["x-content-sha256"] = bodySha;
    headers["content-type"] = "application/json";
    headers["content-length"] = "0";
  }

  const signer = createSign("RSA-SHA256");
  signer.update(parts.join("\n"));
  signer.end();
  const keyInput: any = cfg.passphrase ? { key: cfg.privateKey, passphrase: cfg.passphrase } : cfg.privateKey;
  const signature = signer.sign(keyInput, "base64");
  headers["authorization"] =
    `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${names.join(" ")}",signature="${signature}"`;
  return headers;
}

/**
 * OCI Compute 인스턴스를 재부팅한다.
 * @param action RESET(hard·기본) | SOFTRESET(graceful)
 */
export async function resetProxyInstance(action: "RESET" | "SOFTRESET" = "RESET"): Promise<OciResult> {
  const cfg = await loadOciConfig();
  if (!cfg) return { ok: false, status: 0, detail: "OCI 설정 미등록(env·Blobs 모두 없음) — 자동 재부팅 skip", skipped: true };

  const host = `iaas.${cfg.region}.oraclecloud.com`;
  const path = `/20160918/instances/${cfg.instanceId}?action=${action}`;

  let headers: Record<string, string>;
  try {
    headers = signedHeaders(cfg, "POST", path, host);
  } catch (err: any) {
    return { ok: false, status: 0, detail: `서명 실패(키 형식 확인): ${String(err?.message || err).slice(0, 200)}` };
  }

  try {
    const res = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers,
      body: "",
      signal: AbortSignal.timeout(12000),
    });
    let detail = `${action} 요청 → HTTP ${res.status}`;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      detail += ` ${txt.slice(0, 300)}`;
    }
    return { ok: res.ok, status: res.status, detail };
  } catch (err: any) {
    return { ok: false, status: 0, detail: `OCI 호출 실패: ${String(err?.message || err).slice(0, 200)}` };
  }
}

/**
 * 인스턴스 상태 조회 (GET·읽기 전용) — 자동 재부팅을 건드리지 않고 OCI 인증·서명·권한을 검증할 때 사용.
 * 성공 시 detail에 lifecycleState(RUNNING 등) 포함.
 */
export async function getInstanceState(): Promise<OciResult> {
  const cfg = await loadOciConfig();
  if (!cfg) return { ok: false, status: 0, detail: "OCI 설정 미등록(env·Blobs 모두 없음)", skipped: true };

  const host = `iaas.${cfg.region}.oraclecloud.com`;
  const path = `/20160918/instances/${cfg.instanceId}`;

  let headers: Record<string, string>;
  try {
    headers = signedHeaders(cfg, "GET", path, host);
  } catch (err: any) {
    return { ok: false, status: 0, detail: `서명 실패(키 형식 확인): ${String(err?.message || err).slice(0, 200)}` };
  }

  try {
    const res = await fetch(`https://${host}${path}`, { method: "GET", headers, signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, status: res.status, detail: `HTTP ${res.status} ${txt.slice(0, 300)}` };
    }
    const j: any = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, detail: `OK · 인스턴스 상태=${j?.lifecycleState || "?"}` };
  } catch (err: any) {
    return { ok: false, status: 0, detail: `OCI 호출 실패: ${String(err?.message || err).slice(0, 200)}` };
  }
}

/** OCI 자동 재부팅 사용 가능 여부(설정이 env 또는 Blobs에 존재). */
export async function ociConfigured(): Promise<boolean> {
  return (await loadOciConfig()) !== null;
}

/** 진단용 — 어느 소스에서 설정을 읽는지(비밀값 노출 없음). */
export async function ociConfigSource(): Promise<"env" | "blobs" | "none"> {
  if (loadFromEnv()) return "env";
  if (await loadFromBlobs()) return "blobs";
  return "none";
}

/** Blobs에 OCI 설정 저장 (admin-oci-config-set 전용). */
export async function saveOciConfigToBlobs(cfg: {
  tenancy: string; user: string; fingerprint: string; region: string; instanceId: string; privateKey: string; passphrase?: string;
}): Promise<void> {
  const store = getStore(OCI_BLOB_STORE);
  await store.setJSON(OCI_BLOB_KEY, cfg);
}
