// lib/oci-client.ts
// OCI Compute 인스턴스 재부팅 클라이언트 — SMS 프록시(aligo-proxy) VM 자동 복구용.
// 안정화 3 (2026-05-21): cron-warmup이 프록시 다운 감지 시 호출 → VM hang을 사람 개입 없이 자동 재부팅.
//
// 외부 SDK 없이 Node 내장 crypto로 OCI REST Signature v1(RSA-SHA256) 직접 구현.
// (oci-sdk npm은 패키지가 크고 콜드스타트 부담 → Netlify Functions에 부적합)
//
// 필요 환경변수 6개 (없으면 자동 skip — 키 미등록 시 기존 알림만 동작):
//   OCI_TENANCY_OCID · OCI_USER_OCID · OCI_FINGERPRINT · OCI_REGION(예: ap-chuncheon-1)
//   OCI_INSTANCE_OCID(aligo-proxy) · OCI_PRIVATE_KEY(.pem 전체)
//   (선택) OCI_PASSPHRASE — private key에 암호가 걸린 경우만
//
// 참고: OCI InstanceAction — POST /20160918/instances/{id}?action=RESET (hard reset = 콘솔 Force reboot 등가).
//   메모리 hang 복구가 목적이므로 graceful SOFTRESET 대신 RESET 사용(hang 시 graceful shutdown 불가).

import { createSign, createHash } from "node:crypto";

export interface OciResetResult {
  ok: boolean;
  status: number;
  detail: string;
  skipped?: boolean;   // 환경변수 미설정으로 건너뜀
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

/** 환경변수 6개 로드 — 하나라도 없으면 null (자동 skip). */
function loadOciConfig(): OciConfig | null {
  const tenancy = process.env.OCI_TENANCY_OCID;
  const user = process.env.OCI_USER_OCID;
  const fingerprint = process.env.OCI_FINGERPRINT;
  const region = process.env.OCI_REGION;
  const instanceId = process.env.OCI_INSTANCE_OCID;
  let privateKey = process.env.OCI_PRIVATE_KEY;
  if (!tenancy || !user || !fingerprint || !region || !instanceId || !privateKey) return null;
  // Netlify 환경변수에 PEM을 한 줄(\n 이스케이프)로 넣은 경우 실제 개행으로 복원
  if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
  return {
    tenancy, user, fingerprint, region, instanceId, privateKey,
    passphrase: process.env.OCI_PASSPHRASE || undefined,
  };
}

/**
 * OCI Compute 인스턴스를 재부팅한다.
 * @param action RESET(hard·기본) | SOFTRESET(graceful)
 */
export async function resetProxyInstance(action: "RESET" | "SOFTRESET" = "RESET"): Promise<OciResetResult> {
  const cfg = loadOciConfig();
  if (!cfg) return { ok: false, status: 0, detail: "OCI 환경변수 미설정 — 자동 재부팅 skip", skipped: true };

  const host = `iaas.${cfg.region}.oraclecloud.com`;
  const path = `/20160918/instances/${cfg.instanceId}?action=${action}`;
  const method = "post";
  const body = "";   // InstanceAction은 action을 query로 받고 body 없음
  const bodySha = createHash("sha256").update(body).digest("base64");
  const contentLength = String(Buffer.byteLength(body));
  const date = new Date().toUTCString();
  const keyId = `${cfg.tenancy}/${cfg.user}/${cfg.fingerprint}`;

  // OCI Signature v1 — POST/PUT은 body 헤더(x-content-sha256·content-type·content-length)까지 서명
  const headerNames = ["(request-target)", "date", "host", "x-content-sha256", "content-type", "content-length"];
  const signingString = [
    `(request-target): ${method} ${path}`,
    `date: ${date}`,
    `host: ${host}`,
    `x-content-sha256: ${bodySha}`,
    `content-type: application/json`,
    `content-length: ${contentLength}`,
  ].join("\n");

  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingString);
    signer.end();
    const keyInput: any = cfg.passphrase
      ? { key: cfg.privateKey, passphrase: cfg.passphrase }
      : cfg.privateKey;
    signature = signer.sign(keyInput, "base64");
  } catch (err: any) {
    return { ok: false, status: 0, detail: `서명 실패(키 형식 확인): ${String(err?.message || err).slice(0, 200)}` };
  }

  const authorization =
    `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",` +
    `headers="${headerNames.join(" ")}",signature="${signature}"`;

  try {
    const res = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers: {
        date,
        "x-content-sha256": bodySha,
        "content-type": "application/json",
        "content-length": contentLength,
        authorization,
      },
      body,
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

/** OCI 자동 재부팅 사용 가능 여부(환경변수 6개 설정됨). */
export function ociConfigured(): boolean {
  return loadOciConfig() !== null;
}
