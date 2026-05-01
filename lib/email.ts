import { Resend } from "resend";

/* 환경변수에서만 로드 — 하드코딩 절대 금지 (Netlify Secrets Scanning 차단) */
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.EMAIL_FROM || "SIREN <onboarding@resend.dev>";

/* 사이트 기본 URL — 메일 내 링크에 사용 */
const SITE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";

/* ───────────────────── 공용 발송 함수 ───────────────────── */
export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  if (!RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY가 등록되지 않아 메일 발송을 스킵합니다.");
    return { ok: false, error: "No API Key" };
  }

  try {
    const client = new Resend(RESEND_API_KEY);
    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });

    if (error) {
      console.error("[Email] 발송 실패:", error);
      return { ok: false, error };
    }
    console.log("[Email] 발송 성공:", data?.id, "→", opts.to);
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("[Email] 예외 발생:", err);
    return { ok: false, error: err };
  }
}

/* ───────────────────── 공용 레이아웃 ───────────────────── */
function baseLayout(opts: { title: string; bodyHtml: string; ctaText?: string; ctaUrl?: string }) {
  const { title, bodyHtml, ctaText, ctaUrl } = opts;
  const ctaBlock = ctaText && ctaUrl
    ? `<tr><td align="center" style="padding:8px 0 28px;">
         <a href="${ctaUrl}" target="_blank"
            style="display:inline-block;padding:14px 28px;background:#7a1f2b;color:#ffffff;
                   text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;
                   letter-spacing:0.3px;">
           ${ctaText}
         </a>
       </td></tr>`
    : "";

  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f4f2;font-family:'Noto Sans KR',Arial,sans-serif;color:#0f0f0f;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f4f2;padding:32px 12px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden;
                      box-shadow:0 2px 12px rgba(0,0,0,0.06);max-width:600px;width:100%;">
          
          <!-- 헤더 -->
          <tr>
            <td style="background:#0f0f0f;padding:20px 32px;border-bottom:3px solid #b8935a;">
              <div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1px;
                          font-family:'Noto Serif KR',serif;">SIREN</div>
              <div style="color:#b8935a;font-size:12px;margin-top:2px;letter-spacing:2px;">
                존엄한 기억, 투명한 동행
              </div>
            </td>
          </tr>

          <!-- 제목 -->
          <tr>
            <td style="padding:32px 32px 12px;">
              <h1 style="margin:0;font-size:20px;color:#0f0f0f;font-weight:700;
                         font-family:'Noto Serif KR',serif;line-height:1.4;">${title}</h1>
            </td>
          </tr>

          <!-- 본문 -->
          <tr>
            <td style="padding:8px 32px 24px;font-size:14px;line-height:1.7;color:#333333;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- CTA -->
          ${ctaBlock}

          <!-- 푸터 -->
          <tr>
            <td style="background:#fafaf8;padding:20px 32px;border-top:1px solid #e8e6e3;
                       font-size:12px;color:#8a8a8a;line-height:1.6;">
              <div>이 메일은 자동 발송된 알림 메일입니다.</div>
              <div style="margin-top:6px;">
                © SIREN 교사유가족협의회 ·
                <a href="${SITE_URL}" style="color:#7a1f2b;text-decoration:none;">siren-org.kr</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

/* HTML 이스케이프 (XSS 방지) */
function esc(s: string): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* 카테고리 한글화 */
const CATEGORY_KR: Record<string, string> = {
  counseling: "심리 상담",
  legal: "법률 자문",
  scholarship: "장학 지원",
  other: "기타",
};

/* 상태 한글화 */
const STATUS_KR: Record<string, string> = {
  submitted: "접수됨",
  reviewing: "검토 중",
  supplement: "보완 요청",
  matched: "매칭 완료",
  in_progress: "진행 중",
  completed: "완료",
  rejected: "반려",
};

/* ═══════════════════════════════════════════════════════
   템플릿 1. 관리자에게 — 신규 지원 신청 접수 알림
   ═══════════════════════════════════════════════════════ */
export function tplSupportReceivedAdmin(opts: {
  requestNo: string;
  applicantName: string;
  applicantEmail?: string | null;
  category: string;
  title: string;
  contentPreview: string;   // 80자 이내 미리보기
}) {
  const { requestNo, applicantName, applicantEmail, category, title, contentPreview } = opts;
  const categoryKr = CATEGORY_KR[category] || category;

  const bodyHtml = `
    <p style="margin:0 0 16px;color:#525252;">
      새로운 유가족 지원 신청이 접수되었습니다.<br />
      아래 내용을 확인하신 후 관리자 페이지에서 답변을 등록해 주세요.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:6px 0;color:#8a8a8a;">신청번호</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(requestNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;">신청자</td>
              <td style="padding:6px 0;color:#0f0f0f;">
                ${esc(applicantName)}${applicantEmail ? ` <span style="color:#8a8a8a;">(${esc(applicantEmail)})</span>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;">카테고리</td>
              <td style="padding:6px 0;color:#0f0f0f;">${esc(categoryKr)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;vertical-align:top;">제목</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;">${esc(title)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="margin:16px 0 8px;font-size:13px;color:#8a8a8a;">신청 내용 미리보기</div>
    <div style="padding:14px 16px;background:#ffffff;border-left:3px solid #7a1f2b;
                font-size:13px;color:#333333;line-height:1.6;">
      ${esc(contentPreview)}${contentPreview.length >= 80 ? " ..." : ""}
    </div>

    <p style="margin:20px 0 0;font-size:13px;color:#8a8a8a;">
      ※ 답변은 관리자 페이지에서만 등록할 수 있습니다.
    </p>
  `;

  return {
    subject: `[SIREN] 새 유가족 지원 신청 접수 (${requestNo})`,
    html: baseLayout({
      title: "새 유가족 지원 신청 알림",
      bodyHtml,
      ctaText: "관리자 페이지 바로가기",
      ctaUrl: `${SITE_URL}/admin.html`,
    }),
  };
}

/* ═══════════════════════════════════════════════════════
   템플릿 2. 유저에게 — 답변 등록 알림 (본문에 답변 미노출)
   ═══════════════════════════════════════════════════════ */
export function tplSupportAnsweredUser(opts: {
  applicantName: string;
  requestNo: string;
  title: string;
  newStatus: string;
}) {
  const { applicantName, requestNo, title, newStatus } = opts;
  const statusKr = STATUS_KR[newStatus] || newStatus;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(applicantName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      요청하신 유가족 지원 신청에 대한 <strong style="color:#7a1f2b;">관리자 답변이 등록</strong>되었습니다.<br />
      자세한 답변 내용은 마이페이지에서 확인해 주세요.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:6px 0;color:#8a8a8a;">신청번호</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(requestNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;vertical-align:top;">제목</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;">${esc(title)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;">진행 상태</td>
              <td style="padding:6px 0;">
                <span style="display:inline-block;padding:3px 10px;background:#7a1f2b;
                             color:#ffffff;border-radius:3px;font-size:12px;font-weight:600;">
                  ${esc(statusKr)}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="margin:24px 0 0;padding:14px 16px;background:#fff8ec;border:1px solid #f0e3c4;
                border-radius:6px;font-size:12px;color:#8a6a00;line-height:1.6;">
      🔒 <strong>보안 안내</strong> · 답변 내용은 본인 확인을 위해 마이페이지 로그인 후에만
      열람하실 수 있습니다.
    </div>
  `;

  return {
    subject: `[SIREN] 유가족 지원 신청에 답변이 등록되었습니다`,
    html: baseLayout({
      title: "답변이 등록되었습니다",
      bodyHtml,
      ctaText: "마이페이지에서 답변 확인",
      ctaUrl: `${SITE_URL}/mypage.html#support`,
    }),
  };
}