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

/* ═══════════════════════════════════════════════════════
   템플릿 3. 유저에게 — 후원 완료 감사 메일 (★ STEP H-3)
   ═══════════════════════════════════════════════════════ */
export function tplDonationThanks(opts: {
  donorName: string;
  amount: number;
  donationType: string;        // regular / onetime
  payMethod: string;           // card / bank / cms
  donationId: number;          // donations.id (원본 숫자)
  donationDate: Date;
  isMember: boolean;           // memberId 존재 여부
}) {
  const { donorName, amount, donationType, payMethod, donationId, donationDate, isMember } = opts;

  /* 한글 라벨 */
  const typeKr = donationType === "regular" ? "정기 후원" : "일시 후원";
  const payKr =
    payMethod === "card" ? "신용카드" :
    payMethod === "bank" ? "계좌이체" :
    payMethod === "cms"  ? "자동이체(CMS)" : payMethod;

  /* 날짜/시간 포맷팅 */
  const yyyy = donationDate.getFullYear();
  const mm = String(donationDate.getMonth() + 1).padStart(2, "0");
  const dd = String(donationDate.getDate()).padStart(2, "0");
  const hh = String(donationDate.getHours()).padStart(2, "0");
  const min = String(donationDate.getMinutes()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd} ${hh}:${min}`;

  const donationNo = `D-${String(donationId).padStart(7, "0")}`;

  /* 영수증 영역 — 회원/비회원 분기 (결정 1-A안) */
  const receiptBlockHtml = isMember
    ? `
    <div style="margin:24px 0 0;padding:18px 20px;background:#fef9f5;border:1px solid #f0e0d4;
                border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#0f0f0f;margin-bottom:10px;">
        📄 기부금 영수증 발급 안내
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.7;margin-bottom:14px;">
        후원해 주신 금액에 대한 <strong>기부금 영수증</strong>은 마이페이지에서 즉시 PDF로 발급받으실 수 있습니다.<br />
        연말정산 시 소득공제 자료로 활용해 주세요.
      </div>
      <a href="${SITE_URL}/mypage.html#donations" target="_blank"
         style="display:inline-block;padding:10px 18px;background:#0f0f0f;color:#ffffff;
                text-decoration:none;border-radius:5px;font-size:13px;font-weight:600;">
        영수증 발급하러 가기 →
      </a>
    </div>`
    : `
    <div style="margin:24px 0 0;padding:18px 20px;background:#fef9f5;border:1px solid #f0e0d4;
                border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#0f0f0f;margin-bottom:10px;">
        📄 기부금 영수증 발급 안내
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.7;">
        기부금 영수증은 <strong>회원가입 후</strong> 마이페이지에서 발급받으실 수 있습니다.<br />
        가입 시 본 후원 내역이 자동으로 연결되어 PDF로 즉시 발급됩니다.
      </div>
      <div style="margin-top:14px;">
        <a href="${SITE_URL}/index.html" target="_blank"
           style="display:inline-block;padding:10px 18px;background:#0f0f0f;color:#ffffff;
                  text-decoration:none;border-radius:5px;font-size:13px;font-weight:600;">
          회원가입 →
        </a>
      </div>
    </div>`;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(donorName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      ${esc(donorName)} 님께서 보내주신 따뜻한 마음 <strong style="color:#7a1f2b;">₩${amount.toLocaleString()}</strong>을<br />
      감사한 마음으로 받았습니다. 🎗
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:13px;font-weight:700;color:#0f0f0f;margin-bottom:10px;">
            📋 후원 내역
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:5px 0;color:#8a8a8a;">후원번호</td>
              <td style="padding:5px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(donationNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">일시</td>
              <td style="padding:5px 0;color:#0f0f0f;">${esc(dateStr)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">금액</td>
              <td style="padding:5px 0;color:#0f0f0f;font-weight:700;">
                ₩${amount.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">유형</td>
              <td style="padding:5px 0;color:#0f0f0f;">
                <span style="display:inline-block;padding:2px 9px;background:${donationType === "regular" ? "#fff4e0" : "#e6f0ff"};
                             color:${donationType === "regular" ? "#c47a00" : "#1a5ec4"};border-radius:3px;
                             font-size:12px;font-weight:600;">
                  ${esc(typeKr)}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">결제 수단</td>
              <td style="padding:5px 0;color:#0f0f0f;">${esc(payKr)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${receiptBlockHtml}

    <div style="margin:28px 0 0;padding:18px 20px;background:#ffffff;border:1px solid #e8e6e3;
                border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#0f0f0f;margin-bottom:10px;
                  font-family:'Noto Serif KR',serif;">
        ✨ 후원금은 이렇게 사용됩니다
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.85;">
        • 유가족 심리 상담 지원<br />
        • 법률 자문 및 행정 지원 서비스<br />
        • 자녀 교육·장학 사업 운영<br />
        • 추모 사업 및 사회 인식 개선 캠페인
      </div>
      <div style="margin-top:12px;font-size:12.5px;color:#8a8a8a;line-height:1.6;">
        모든 후원금의 사용 내역은 <strong>매년 투명하게 공개</strong>되며,<br />
        협회 홈페이지의 "재정 보고"에서 확인하실 수 있습니다.
      </div>
    </div>

    <p style="margin:24px 0 0;color:#525252;font-size:13.5px;line-height:1.7;">
      ${esc(donorName)} 님의 따뜻한 마음이 유가족분들께<br />
      큰 위로와 힘이 되어 전해질 수 있도록 정성을 다하겠습니다.<br /><br />
      다시 한 번 깊이 감사드립니다. 🙏
    </p>
  `;

  return {
    subject: `[SIREN] ${donorName}님, 따뜻한 후원에 감사드립니다 🎗`,
    html: baseLayout({
      title: "따뜻한 후원에 감사드립니다",
      bodyHtml,
      ctaText: isMember ? "마이페이지에서 후원 내역 확인" : "협회 홈페이지 바로가기",
      ctaUrl: isMember ? `${SITE_URL}/mypage.html#donations` : `${SITE_URL}/index.html`,
    }),
  };
}