// netlify/functions/auth-signup.ts
// ★ Phase M-19-11 V2: 직업군별 회원가입 통합 처리
//
// POST /api/auth/signup
// body: {
//   email, password, name, phone,
//   memberType: 'regular' | 'family' | 'teacher' | 'lawyer' | 'counselor',
//   certificateBlobId?: number,  // family/teacher/lawyer/counselor 필수
//   agreeTerms: boolean,
//   agreePrivacy: boolean,
//   agreeEmail?: boolean,
//   agreeSms?: boolean,
//   memo?: string,
// }
//
// 보안:
// - 이메일 중복 검증
// - bcrypt 해싱 (10 rounds)
// - 증빙 파일 MIME 타입 검증
// - 필수 약관 동의 검증
// - 즉시 활성화 회원만 로그인 쿠키 발급

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../../db";
import { members, blobUploads } from "../../db/schema";
import { signUserToken, buildCookie } from "../../lib/auth";
import { notifyAllSuperAdmins } from "../../lib/notify";
import { logAudit } from "../../lib/audit";
import { sendEmail } from "../../lib/email";
import {
  ok, badRequest, conflict, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;
const SITE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
const ORG_NAME = process.env.ORG_NAME || "(사)교사유가족협의회";

/* ───────── 직업군별 설정 ───────── */
const MEMBER_TYPE_CONFIG = {
  regular: {
    requiresCertificate: false,
    requiresApproval: false,
    requiresSecondaryVerification: false,
    initialStatus: "active" as const,
    subtype: null as string | null,
    memberCategory: "sponsor" as string,
    displayName: "일반 후원자",
    icon: "💝",
    mappedType: "regular" as const,
  },
  family: {
    requiresCertificate: true,
    requiresApproval: true,
    requiresSecondaryVerification: false,
    initialStatus: "pending" as const,
    subtype: "family" as string | null,
    memberCategory: "family" as string,
    displayName: "유가족",
    icon: "🎗",
    mappedType: "family" as const,
  },
  teacher: {
    requiresCertificate: true,
    requiresApproval: true,
    requiresSecondaryVerification: true, // 2단계 검증
    initialStatus: "pending" as const,
    subtype: "teacher" as string | null,
    memberCategory: "regular" as string,
    displayName: "교원",
    icon: "👨‍🏫",
    mappedType: "volunteer" as const,
  },
  lawyer: {
    requiresCertificate: true,
    requiresApproval: true,
    requiresSecondaryVerification: false,
    initialStatus: "pending" as const,
    subtype: "lawyer" as string | null,
    memberCategory: "etc" as string,
    displayName: "변호사",
    icon: "⚖️",
    mappedType: "volunteer" as const,
  },
  counselor: {
    requiresCertificate: true,
    requiresApproval: true,
    requiresSecondaryVerification: false,
    initialStatus: "pending" as const,
    subtype: "counselor" as string | null,
    memberCategory: "etc" as string,
    displayName: "심리상담사",
    icon: "💗",
    mappedType: "volunteer" as const,
  },
};

type MemberTypeKey = keyof typeof MEMBER_TYPE_CONFIG;

function isValidMemberType(type: string): type is MemberTypeKey {
  return type in MEMBER_TYPE_CONFIG;
}

/* ───────── 증빙 파일 검증 ───────── */
async function validateCertificateFile(blobId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const [blob] = await db
      .select({
        id: blobUploads.id,
        mimeType: blobUploads.mimeType,
        sizeBytes: blobUploads.sizeBytes,
        uploadStatus: blobUploads.uploadStatus,
      })
      .from(blobUploads)
      .where(eq(blobUploads.id, blobId))
      .limit(1);

    if (!blob) {
      return { ok: false, error: "증빙 파일을 찾을 수 없습니다" };
    }

    /* 업로드 완료 상태 확인 */
    if (blob.uploadStatus !== "completed") {
      return { ok: false, error: "증빙 파일 업로드가 완료되지 않았습니다" };
    }

    /* MIME 타입 검증 */
    const allowedMime = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];
    if (!allowedMime.includes(blob.mimeType)) {
      return { ok: false, error: "증빙 파일은 PDF/JPG/PNG/WebP만 허용됩니다" };
    }

    /* 크기 검증 (10MB) */
    if (blob.sizeBytes > 10 * 1024 * 1024) {
      return { ok: false, error: "증빙 파일은 10MB 이하여야 합니다" };
    }

    return { ok: true };
  } catch (e) {
    console.error("[validateCertificateFile]", e);
    return { ok: false, error: "파일 검증 실패" };
  }
}

/* ───────── 이메일 형식 검증 ───────── */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ───────── 전화번호 정규화 ───────── */
function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s-]/g, "");
  if (!/^\d{10,11}$/.test(cleaned)) return null;

  /* 010-1234-5678 형식으로 변환 */
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  } else if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return null;
}

/* ───────── 비밀번호 강도 검증 ───────── */
function validatePasswordStrength(password: string): { ok: boolean; error?: string } {
  if (password.length < 8) {
    return { ok: false, error: "비밀번호는 8자 이상이어야 합니다" };
  }
  if (password.length > 72) {
    /* bcrypt 최대 길이 */
    return { ok: false, error: "비밀번호는 72자 이하여야 합니다" };
  }
  /* 영문 + 숫자 조합 권장 */
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (!hasLetter || !hasNumber) {
    return { ok: false, error: "비밀번호는 영문과 숫자를 모두 포함해야 합니다" };
  }
  return { ok: true };
}

/* ───────── 메인 핸들러 ───────── */
export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 파싱 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    /* 2. 기본 필드 검증 */
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const phoneInput = String(body.phone || "").trim();
    const memberTypeInput = String(body.memberType || "regular").trim();

    /* 이메일 검증 */
    if (!email) return badRequest("이메일을 입력해주세요");
    if (!isValidEmail(email)) return badRequest("올바른 이메일 형식이 아닙니다");
    if (email.length > 100) return badRequest("이메일은 100자 이하여야 합니다");

    /* 비밀번호 검증 */
    const pwCheck = validatePasswordStrength(password);
    if (!pwCheck.ok) return badRequest(pwCheck.error!);

    /* 이름 검증 */
    if (!name) return badRequest("이름을 입력해주세요");
    if (name.length < 2) return badRequest("이름은 2자 이상이어야 합니다");
    if (name.length > 50) return badRequest("이름은 50자 이하여야 합니다");

    /* 전화번호 검증 (선택) */
    let phone: string | null = null;
    if (phoneInput) {
      phone = normalizePhone(phoneInput);
      if (!phone) return badRequest("올바른 전화번호 형식이 아닙니다 (예: 010-1234-5678)");
    }

    /* 3. 약관 동의 검증 */
    const agreeTerms = body.agreeTerms === true;
    const agreePrivacy = body.agreePrivacy === true;

    if (!agreeTerms) return badRequest("이용약관에 동의해주세요");
    if (!agreePrivacy) return badRequest("개인정보처리방침에 동의해주세요");

    /* 4. 회원 유형 검증 */
    if (!isValidMemberType(memberTypeInput)) {
      return badRequest(`유효하지 않은 회원 유형: ${memberTypeInput}`);
    }
    const memberType = memberTypeInput as MemberTypeKey;
    const config = MEMBER_TYPE_CONFIG[memberType];

    /* 5. 증빙 파일 검증 (필요한 경우) */
    let certificateBlobId: number | null = null;
    if (config.requiresCertificate) {
      if (!body.certificateBlobId) {
        return badRequest(`${config.displayName} 회원은 증빙 파일이 필요합니다`);
      }
      const blobId = Number(body.certificateBlobId);
      if (!Number.isInteger(blobId) || blobId < 1) {
        return badRequest("유효하지 않은 증빙 파일 ID입니다");
      }
      const validation = await validateCertificateFile(blobId);
      if (!validation.ok) {
        return badRequest(validation.error || "파일 검증 실패");
      }
      certificateBlobId = blobId;
    }

    /* 6. 이메일 중복 확인 */
    const [existing] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.email, email))
      .limit(1);
    if (existing) {
      return conflict("이미 가입된 이메일입니다");
    }

    /* 7. 비밀번호 해시 */
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    /* 8. 회원 생성 */
    const now = new Date();
    const insertData: any = {
      email,
      passwordHash,
      name,
      phone,
      type: config.mappedType,
      status: config.initialStatus,
      memberCategory: config.memberCategory,
      memberSubtype: config.subtype,
      certificateBlobId,
      certificateUploadedAt: certificateBlobId ? now : null,
      agreeEmail: body.agreeEmail !== false,
      agreeSms: body.agreeSms !== false,
      agreeMail: body.agreeMail === true,
      memo: body.memo ? String(body.memo).slice(0, 500) : null,
      /* 유가족은 수동 승인 필요 */
      emailVerified: false,
    };

    const [created] = await db.insert(members).values(insertData).returning({
      id: members.id,
      email: members.email,
      name: members.name,
      status: members.status,
      type: members.type,
      memberCategory: members.memberCategory,
      memberSubtype: members.memberSubtype,
      createdAt: members.createdAt,
    });

    /* 9. blob_uploads에 reference 연결 */
    if (certificateBlobId) {
      try {
        await db.execute(
          `UPDATE blob_uploads 
           SET reference_table = 'members', 
               reference_id = ${created.id} 
           WHERE id = ${certificateBlobId}` as any
        );
      } catch (_) {}
    }

    /* 10. 관리자 알림 (승인 필요한 경우) */
    if (config.requiresApproval) {
      try {
        await notifyAllSuperAdmins({
          category: "member",
          severity: config.requiresSecondaryVerification ? "critical" : "warning",
          title: `🔔 ${config.icon} ${config.displayName} 회원 가입 신청`,
          message: `${created.name}님이 ${config.displayName} 회원으로 가입 신청했습니다.${
            config.requiresSecondaryVerification ? " ⚠️ 2단계 검증 필요!" : ""
          }`,
          link: "/admin.html#pending-approvals",
          refTable: "members",
          refId: created.id,
        });
      } catch (e) {
        console.warn("[auth-signup] 관리자 알림 실패:", e);
      }
    }

    /* 11. 감사 로그 */
    try {
      await logAudit({
        userId: created.id,
        userType: "user",
        userName: created.name,
        action: "signup_success",
        target: `M-${created.id}`,
        detail: {
          memberType,
          subtype: config.subtype,
          hasCertificate: !!certificateBlobId,
          requiresApproval: config.requiresApproval,
          requiresSecondary: config.requiresSecondaryVerification,
          agreeEmail: !!body.agreeEmail,
          agreeSms: !!body.agreeSms,
        },
      });
    } catch (_) {}

    /* 12. 가입 확인 메일 발송 */
    try {
      const approvalNote = config.requiresApproval
        ? `<div style="background:#fff8ec;padding:16px;border-radius:8px;margin:16px 0;border-left:4px solid #c47a00">
            <strong style="color:#8a6a00">⏳ 관리자 승인 대기 중</strong><br />
            <span style="font-size:13px;color:var(--text-2);line-height:1.6">
              ${config.displayName} 회원은 관리자 검토 후 승인됩니다.<br />
              영업일 기준 2~3일 내에 이메일로 승인 결과를 안내드립니다.
            </span>
          </div>`
        : `<div style="background:#e7f7ec;padding:16px;border-radius:8px;margin:16px 0;border-left:4px solid #1a8b46">
            <strong style="color:#1a5e2c">✅ 가입 즉시 활성화</strong><br />
            <span style="font-size:13px;color:var(--text-2)">
              지금 바로 로그인하여 서비스를 이용하실 수 있습니다.
            </span>
          </div>`;

      await sendEmail({
        to: email,
        subject: `[${ORG_NAME}] 회원 가입을 환영합니다`,
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8" /></head>
          <body style="margin:0;padding:0;background:#f5f4f2;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr><td align="center" style="padding:40px 20px">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
                  <tr><td style="padding:50px 40px 30px;text-align:center;background:linear-gradient(135deg,#7a1f2b,#3a0d14);color:#fff">
                    <div style="font-size:64px;margin-bottom:12px;line-height:1">${config.icon}</div>
                    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;font-family:'Noto Serif KR',serif">
                      ${config.displayName} 회원 가입을 환영합니다
                    </h1>
                    <p style="margin:0;font-size:14px;opacity:0.9">${ORG_NAME}</p>
                  </td></tr>
                  <tr><td style="padding:36px 40px">
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:#2a2a2a">
                      ${name}님, 안녕하세요!
                    </p>
                    <p style="margin:0 0 20px;font-size:14px;line-height:1.85;color:#2a2a2a">
                      ${ORG_NAME}의 <strong style="color:#7a1f2b">${config.displayName}</strong> 회원으로 가입해주셔서 진심으로 감사드립니다.<br /><br />
                      ${ORG_NAME}은 교사 유가족분들의 일상 회복을 돕고, 교원들의 권익을 지키기 위해 활동하고 있습니다.
                    </p>

                    ${approvalNote}

                    <div style="text-align:center;margin-top:30px">
                      <a href="${SITE_URL}/${config.requiresApproval ? "" : "login.html"}"
                         style="display:inline-block;padding:13px 32px;background:#7a1f2b;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
                        ${config.requiresApproval ? "사이트 둘러보기" : "로그인하기"}
                      </a>
                    </div>
                  </td></tr>
                  <tr><td style="padding:24px;background:#fafaf8;text-align:center;font-size:11.5px;color:#999;line-height:1.7">
                    본 메일은 발신 전용입니다.<br />
                    ${ORG_NAME} · 문의: support@siren-org.kr
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `,
      }).catch(() => {});
    } catch (_) {}

    /* 13. 즉시 활성화된 경우만 로그인 토큰 발급 */
    if (config.initialStatus === "active") {
      const token = signUserToken({
        uid: created.id,
        email: created.email,
        name: created.name,
      });
      const cookie = buildCookie("siren_token", token, {
        maxAge: 14 * 24 * 60 * 60, // 14일
      });

      const response = ok({
        member: {
          id: created.id,
          email: created.email,
          name: created.name,
          status: created.status,
          type: created.type,
          memberCategory: created.memberCategory,
          subtype: created.memberSubtype,
          requiresApproval: false,
          displayName: config.displayName,
        },
      }, "회원가입이 완료되었습니다 🎉");

      /* Set-Cookie 헤더 추가 */
      response.headers.set("Set-Cookie", cookie);
      return response;
    }

    /* 14. 승인 대기 응답 (로그인 토큰 없음) */
    return ok({
      member: {
        id: created.id,
        email: created.email,
        name: created.name,
        status: created.status,
        type: created.type,
        memberCategory: created.memberCategory,
        subtype: created.memberSubtype,
        requiresApproval: true,
        displayName: config.displayName,
        requiresSecondaryVerification: config.requiresSecondaryVerification,
      },
    }, `${config.displayName} 회원 가입 신청이 완료되었습니다. ${
      config.requiresSecondaryVerification
        ? "교원 회원은 2단계 검증 후 승인됩니다."
        : "관리자 승인 후 이용 가능합니다."
    }`);

  } catch (err: any) {
    console.error("[auth-signup]", err);
    return serverError("회원가입 처리 중 오류가 발생했습니다", err?.message);
  }
};

export const config = { path: "/api/auth/signup" };