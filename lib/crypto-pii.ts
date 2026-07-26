// lib/crypto-pii.ts
// 민감 개인정보(주민등록번호 등) 대칭 암호화 — 근로계약 시스템용.
//
// 방식: AES-256-GCM (기밀성 + 무결성 태그). 저장 형식 "iv:tag:ciphertext"(각 base64).
// 키: env CONTRACT_PII_KEY (32바이트를 base64 또는 hex로. 길이가 안 맞으면 sha256으로 파생).
// 미설정(fail-closed): 암호화가 null을 반환 → 호출부가 주민번호 입력만 막고 계약 자체는 진행한다.
//
// 원칙:
//  - 복호화된 평문은 PDF 생성·재발행 시 서버 메모리에서만 쓰고 로그·API 응답에 절대 노출 금지.
//  - 화면·목록·조회 API에는 maskResidentNo()의 마스킹 값만 내보낸다.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function getKey(): Buffer | null {
  const raw = process.env.CONTRACT_PII_KEY;
  if (!raw) return null;
  try {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");        // hex 64자 = 32바이트
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;                                            // base64 32바이트
    return createHash("sha256").update(raw).digest();                        // 그 외 문자열 → 32바이트 파생
  } catch {
    return null;
  }
}

/** env 키가 설정돼 있어 암호화가 가능한지 */
export function piiKeyAvailable(): boolean {
  return !!getKey();
}

/** 평문 → "iv:tag:ciphertext"(base64). 키 없거나 빈 문자열이면 null. */
export function encryptPII(plain: string): string | null {
  const key = getKey();
  if (!key || !plain) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/** "iv:tag:ciphertext" → 평문. 키 없거나 변조·형식오류면 null. */
export function decryptPII(payload: string | null | undefined): string | null {
  const key = getKey();
  if (!key || !payload) return null;
  try {
    const [ivB, tagB, encB] = String(payload).split(":");
    if (!ivB || !tagB || !encB) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** 주민등록번호 마스킹 — 앞 6자리(생년월일) + 성별코드 1자리만 노출, 나머지 6자리 마스킹. 예: 900101-1****** */
export function maskResidentNo(rrn: string | null | undefined): string {
  const digits = String(rrn || "").replace(/[^0-9]/g, "");
  if (digits.length < 7) return digits ? "*".repeat(digits.length) : "";
  return digits.slice(0, 6) + "-" + digits.slice(6, 7) + "******";
}
