/**
 * SIREN — 민감정보 마스킹 헬퍼
 */

/** 전화번호 마스킹: 010-1234-5678 → 010-****-5678 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/(\d{3}-?)(\d{3,4})(-?\d{4})/, "$1****$3");
}

/** 주민등록번호 마스킹: 전체 → 앞 6자리만 표시 */
export function maskRrn(rrn: string | null | undefined): string {
  if (!rrn) return "";
  return rrn.replace(/(\d{6})-?(\d{7})/, "$1-*******");
}

/** 이메일 마스킹: user@example.com → us**@example.com */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  const masked = "*".repeat(Math.max(local.length - 2, 2));
  return `${visible}${masked}@${domain}`;
}
