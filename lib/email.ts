import { Resend } from "resend";

/* 환경변수에서만 로드 — 하드코딩 절대 금지 (Netlify Secrets Scanning 차단) */
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.EMAIL_FROM || "SIREN <onboarding@resend.dev>";

/* 사이트 기본 URL — 메일 내 링크에 사용 */
const SITE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";

/* ───────────────────── 공용 발송 함수 (디버그 강화) ───────────────────── */
/* ───────────────────── 공용 발송 함수 (★ 임시 redirect 모드) ─────────────────────
   - RESEND_TEST_RECIPIENT 환경변수가 설정되면 모든 메일을 그 주소로 redirect
   - 도메인 검증 완료 후 환경변수만 삭제하면 정상 모드로 자동 복귀
   - 코드 변경 없이 운영 모드 전환 가능
   ───────────────────────────────────────────────────────────── */
const TEST_MODE_RECIPIENT = (process.env.RESEND_TEST_RECIPIENT || "").trim();

export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  const apiKeyMasked = RESEND_API_KEY 
    ? RESEND_API_KEY.slice(0, 6) + "..." + RESEND_API_KEY.slice(-4)
    : "(비어있음)";

  /* ★ 임시 모드: 모든 메일을 본인 이메일로 redirect + 원래 수신자 표시 */
  let actualTo = opts.to;
  let actualSubject = opts.subject;
  let actualHtml = opts.html;
  const isTestMode = !!TEST_MODE_RECIPIENT;

  if (isTestMode) {
    actualTo = TEST_MODE_RECIPIENT;
    actualSubject = `[TEST → ${opts.to}] ${opts.subject}`;
    actualHtml = `
      <div style="background:#fff8ec;border:2px solid #f0e3c4;padding:16px 20px;margin-bottom:20px;font-family:'Noto Sans KR',Arial,sans-serif;border-radius:8px;">
        <div style="font-weight:700;color:#c47a00;margin-bottom:8px;font-size:14px;">⚠️ 도메인 검증 전 — 테스트 redirect 모드</div>
        <div style="font-size:13px;color:#525252;line-height:1.7;">
          이 메일은 Resend 도메인 검증 전 임시 모드로 발송되었습니다.<br />
          • 원래 수신자: <strong style="color:#0f0f0f;">${opts.to}</strong><br />
          • 현재 수신자: <strong style="color:#0f0f0f;">${TEST_MODE_RECIPIENT}</strong> (관리자 테스트용)<br />
          <span style="color:#8a8a8a;font-size:12px;">도메인 검증 완료 후 자동으로 정상 모드로 전환됩니다.</span>
        </div>
      </div>
      ${opts.html}
    `;
  }

  console.log("[Email] ====== 발송 시도 ======");
  console.log("[Email] Original To:", opts.to);
  console.log("[Email] Actual To:", actualTo);
  console.log("[Email] Test Mode:", isTestMode ? "ON (redirect)" : "OFF (정상)");
  console.log("[Email] Subject:", actualSubject.slice(0, 70));
  console.log("[Email] From:", FROM_EMAIL);
  console.log("[Email] API Key:", apiKeyMasked);

  if (!RESEND_API_KEY) {
    console.error("[Email] ❌ RESEND_API_KEY 환경변수 미설정");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const client = new Resend(RESEND_API_KEY);
    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: actualTo,
      subject: actualSubject,
      html: actualHtml,
    });

    if (error) {
      console.error("[Email] ❌ Resend 응답 에러:");
      console.error("[Email]", JSON.stringify(error, null, 2));
      return { ok: false, error };
    }

    console.log("[Email] ✅ 발송 성공:", data?.id, "→", actualTo);
    return { ok: true, id: data?.id };
  } catch (err: any) {
    console.error("[Email] ❌ 예외:", err?.message);
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

/* ═══════════════════════════════════════════════════════
   템플릿 4. 유저에게 — 지원 신청 접수 확인 (★ STEP H-4)
   결정 Q3-A: 긴급 신청자에게만 1:1 채팅 안내 추가
   ═══════════════════════════════════════════════════════ */
export function tplSupportReceiptUser(opts: {
  applicantName: string;
  requestNo: string;
  category: string;
  title: string;
  priority: string;          // 'urgent' | 'normal' | 'low'
  createdAt: Date;
}) {
  const { applicantName, requestNo, category, title, priority, createdAt } = opts;
  const categoryKr = CATEGORY_KR[category] || category;
  const isUrgent = priority === "urgent";

  /* 날짜/시간 포맷팅 */
  const yyyy = createdAt.getFullYear();
  const mm = String(createdAt.getMonth() + 1).padStart(2, "0");
  const dd = String(createdAt.getDate()).padStart(2, "0");
  const hh = String(createdAt.getHours()).padStart(2, "0");
  const min = String(createdAt.getMinutes()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd} ${hh}:${min}`;

  /* 우선순위별 안내 박스 (긴급/일반 분기) */
  const priorityNoticeHtml = isUrgent
    ? `
    <div style="margin:20px 0;padding:16px 20px;
                background:linear-gradient(135deg,#fdecec,#fff5f5);
                border:2px solid #c5293a;border-radius:8px;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <div style="font-size:24px;line-height:1;flex-shrink:0;">🔴</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#c5293a;margin-bottom:6px;">
            긴급 신청으로 분류되었습니다
          </div>
          <div style="font-size:13px;color:#a01e2c;line-height:1.6;">
            AI가 ${esc(applicantName)} 님의 신청을 <strong>최우선 처리 대상</strong>으로 분류했습니다.<br />
            담당자가 즉시 검토 중이며, 빠른 시일 내에 답변드리겠습니다.
          </div>
        </div>
      </div>
    </div>`
    : `
    <div style="margin:20px 0;padding:14px 18px;background:#f0f5fc;
                border:1px solid #cee0f2;border-radius:6px;
                font-size:13px;color:#1a5ec4;line-height:1.6;">
      💼 담당자가 신청 내용을 확인 후 <strong>영업일 기준 1~3일 이내</strong>에<br />
      마이페이지 및 이메일로 답변드리겠습니다.
    </div>`;

  /* ★ 결정 Q3-A: 긴급 신청자에게만 1:1 채팅 안내 추가 */
  const chatNoticeHtml = isUrgent
    ? `
    <div style="margin:20px 0 0;padding:18px 20px;
                background:#fff8ec;border:1px solid #f0e3c4;border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#8a6a00;margin-bottom:8px;">
        ⚡ 더 빠른 상담이 필요하신가요?
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.7;margin-bottom:12px;">
        긴급한 도움이 필요하시면 <strong>1:1 실시간 채팅 상담</strong>을 이용해 보세요.<br />
        담당자가 연결되는 즉시 직접 대화하며 도움을 드릴 수 있습니다.
      </div>
      <a href="${SITE_URL}/mypage.html#consult" target="_blank"
         style="display:inline-block;padding:10px 18px;background:#c5293a;color:#ffffff;
                text-decoration:none;border-radius:5px;font-size:13px;font-weight:600;">
        💬 1:1 채팅 상담 시작 →
      </a>
    </div>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(applicantName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      ${esc(applicantName)} 님의 <strong style="color:#7a1f2b;">${esc(categoryKr)}</strong> 지원 신청이<br />
      정상적으로 접수되었습니다. 🎗
    </p>

    ${priorityNoticeHtml}

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:13px;font-weight:700;color:#0f0f0f;margin-bottom:10px;">
            📋 접수 정보
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:5px 0;color:#8a8a8a;">접수번호</td>
              <td style="padding:5px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(requestNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">접수일시</td>
              <td style="padding:5px 0;color:#0f0f0f;">${esc(dateStr)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">지원 유형</td>
              <td style="padding:5px 0;color:#0f0f0f;">${esc(categoryKr)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;vertical-align:top;">제목</td>
              <td style="padding:5px 0;color:#0f0f0f;font-weight:600;">${esc(title)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">처리 상태</td>
              <td style="padding:5px 0;">
                <span style="display:inline-block;padding:3px 10px;
                             background:${isUrgent ? "#c5293a" : "#1a5ec4"};
                             color:#ffffff;border-radius:3px;font-size:12px;font-weight:600;">
                  ${isUrgent ? "🔴 긴급 처리 중" : "접수됨"}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${chatNoticeHtml}

    <div style="margin:24px 0 0;padding:18px 20px;background:#ffffff;border:1px solid #e8e6e3;
                border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#0f0f0f;margin-bottom:10px;
                  font-family:'Noto Serif KR',serif;">
        🤝 처리 절차 안내
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.85;">
        <div style="margin-bottom:6px;"><strong style="color:#0f0f0f;">1단계.</strong> 신청 내용 검토 (현재 단계)</div>
        <div style="margin-bottom:6px;"><strong style="color:#0f0f0f;">2단계.</strong> 담당 전문가 매칭</div>
        <div style="margin-bottom:6px;"><strong style="color:#0f0f0f;">3단계.</strong> 지원 진행 및 답변 등록</div>
        <div><strong style="color:#0f0f0f;">4단계.</strong> 완료 보고</div>
      </div>
      <div style="margin-top:12px;font-size:12.5px;color:#8a8a8a;line-height:1.6;">
        진행 상황은 마이페이지에서 실시간으로 확인하실 수 있으며,<br />
        답변이 등록되면 별도 알림 메일을 발송해 드립니다.
      </div>
    </div>

    <div style="margin:24px 0 0;padding:14px 16px;background:#fff8ec;border:1px solid #f0e3c4;
                border-radius:6px;font-size:12px;color:#8a6a00;line-height:1.6;">
      🔒 <strong>개인정보 보호</strong> · 신청 내용은 담당자만 열람할 수 있으며,<br />
      관련 법령에 따라 안전하게 관리됩니다.
    </div>
  `;

  const subjectPrefix = isUrgent ? "🔴 긴급 - " : "";
  return {
    subject: `[SIREN] ${subjectPrefix}${applicantName}님, 지원 신청이 접수되었습니다`,
    html: baseLayout({
      title: isUrgent ? "긴급 지원 신청이 접수되었습니다" : "지원 신청이 접수되었습니다",
      bodyHtml,
      ctaText: "마이페이지에서 진행 상황 확인",
      ctaUrl: `${SITE_URL}/mypage.html#support`,
    }),
  };
}

/* ═══════════════════════════════════════════════════════
   ★ K-1: 템플릿 5. 유저에게 — 비밀번호 재설정 링크
   ═══════════════════════════════════════════════════════ */
export function tplPasswordReset(opts: {
  userName: string;
  rawToken: string;
  ttlMinutes: number;
}) {
  const { userName, rawToken, ttlMinutes } = opts;
  const resetUrl = `${SITE_URL}/password-reset.html?token=${encodeURIComponent(rawToken)}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(userName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      비밀번호 재설정 요청을 받았습니다.<br />
      아래 버튼을 클릭하여 새 비밀번호를 설정해 주세요.
    </p>

    <div style="margin:24px 0;padding:16px 20px;background:#fff8ec;
                border:1px solid #f0e3c4;border-radius:8px;">
      <div style="font-size:13px;color:#8a6a00;line-height:1.7;">
        ⏰ <strong>이 링크는 ${ttlMinutes}분 동안만 유효합니다.</strong><br />
        보안을 위해 한 번 사용하면 자동으로 만료됩니다.
      </div>
    </div>

    <div style="margin:24px 0;padding:18px 20px;background:#ffffff;
                border:1px solid #e8e6e3;border-radius:8px;">
      <div style="font-size:13px;color:#525252;line-height:1.7;">
        <strong style="color:#0f0f0f;">⚠️ 본인이 요청하지 않으셨다면</strong><br />
        이 메일을 무시하셔도 됩니다. 비밀번호는 변경되지 않습니다.<br /><br />
        만약 본인이 아닌데 반복적으로 이 메일을 받으신다면,<br />
        계정 보안을 위해 즉시 협회에 알려 주세요.
      </div>
    </div>

    <div style="margin:24px 0 0;padding:14px 16px;background:#f5f4f2;
                border-radius:6px;font-size:12px;color:#8a8a8a;line-height:1.7;">
      🔒 <strong>보안 안내</strong><br />
      • 이 링크는 ${esc(userName)} 님 메일함을 통해서만 사용 가능합니다.<br />
      • 누구에게도 이 링크를 공유하지 마세요.<br />
      • 협회는 절대 비밀번호를 메일/전화로 묻지 않습니다.
    </div>

    <div style="margin:20px 0 0;font-size:11px;color:#aaaaaa;
                line-height:1.6;word-break:break-all;">
      버튼이 작동하지 않으면 아래 주소를 브라우저에 직접 붙여넣어 주세요:<br />
      <a href="${resetUrl}" style="color:#7a1f2b;text-decoration:underline;">${resetUrl}</a>
    </div>
  `;

  return {
    subject: `[SIREN] 비밀번호 재설정 요청 안내`,
    html: baseLayout({
      title: "비밀번호 재설정",
      bodyHtml,
      ctaText: "새 비밀번호 설정하기",
      ctaUrl: resetUrl,
    }),
  };
}

/* ═══════════════════════════════════════════════════════
   ★ K-2: 템플릿 6. 유저에게 — 이메일 인증 링크 (NEW)
   - 가입 직후 자동 발송 / 사용자 요청 시 재발송
   - 24시간 유효
   ═══════════════════════════════════════════════════════ */
export function tplEmailVerify(opts: {
  userName: string;
  rawToken: string;
  ttlHours: number;
}) {
  const { userName, rawToken, ttlHours } = opts;
  const verifyUrl = `${SITE_URL}/email-verify.html?token=${encodeURIComponent(rawToken)}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(userName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      교사유가족협의회 회원이 되어 주셔서 감사합니다.<br />
      아래 버튼을 클릭하여 이메일 인증을 완료해 주세요.
    </p>

    <div style="margin:24px 0;padding:18px 20px;
                background:linear-gradient(135deg,#fef9f5,#fff);
                border:1px solid #f0e0d4;border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#0f0f0f;margin-bottom:8px;
                  font-family:'Noto Serif KR',serif;">
        ✉️ 이메일 인증이 필요한 이유
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.7;">
        • 본인 명의의 이메일 주소를 확인하기 위해 필요합니다<br />
        • 비밀번호 분실 시 안전한 재설정을 위해 필요합니다<br />
        • 후원 영수증·지원 답변 등 중요 안내를 받기 위해 필요합니다
      </div>
    </div>

    <div style="margin:24px 0;padding:16px 20px;background:#fff8ec;
                border:1px solid #f0e3c4;border-radius:8px;">
      <div style="font-size:13px;color:#8a6a00;line-height:1.7;">
        ⏰ <strong>이 링크는 ${ttlHours}시간 동안 유효합니다.</strong><br />
        만료되면 마이페이지에서 다시 요청하실 수 있습니다.
      </div>
    </div>

    <div style="margin:24px 0;padding:18px 20px;background:#ffffff;
                border:1px solid #e8e6e3;border-radius:8px;">
      <div style="font-size:13px;color:#525252;line-height:1.7;">
        <strong style="color:#0f0f0f;">📌 인증을 완료하지 않아도 가입은 유효합니다</strong><br />
        하지만 일부 보안 기능(비밀번호 찾기 등)은 인증 후에만 정상 작동합니다.<br />
        가능한 빨리 인증을 완료해 주세요.
      </div>
    </div>

    <div style="margin:24px 0 0;padding:14px 16px;background:#f5f4f2;
                border-radius:6px;font-size:12px;color:#8a8a8a;line-height:1.7;">
      🔒 <strong>보안 안내</strong><br />
      • 회원가입을 하지 않으셨다면 이 메일을 무시하셔도 됩니다<br />
      • 다른 사람의 메일 주소가 잘못 입력된 경우일 수 있습니다<br />
      • 협회는 절대 비밀번호를 메일/전화로 묻지 않습니다
    </div>

    <div style="margin:20px 0 0;font-size:11px;color:#aaaaaa;
                line-height:1.6;word-break:break-all;">
      버튼이 작동하지 않으면 아래 주소를 브라우저에 직접 붙여넣어 주세요:<br />
      <a href="${verifyUrl}" style="color:#7a1f2b;text-decoration:underline;">${verifyUrl}</a>
    </div>
  `;

  return {
    subject: `[SIREN] 이메일 인증을 완료해 주세요 ✉️`,
    html: baseLayout({
      title: "이메일 인증",
      bodyHtml,
      ctaText: "이메일 인증 완료하기",
      ctaUrl: verifyUrl,
    }),
  };
}


/* ═══════════════════════════════════════════════════════
   ★ K-2: 템플릿 7. 유저에게 — 회원 탈퇴 확인 (NEW)
   - 탈퇴 처리 직후 발송
   - 30일 이내 복구 안내 (정책 결정 사항이므로 안내만 표시)
   ═══════════════════════════════════════════════════════ */
export function tplWithdrawConfirm(opts: {
  userName: string;
  email: string;
  withdrawnAt: Date;
}) {
  const { userName, email, withdrawnAt } = opts;

  const yyyy = withdrawnAt.getFullYear();
  const mm = String(withdrawnAt.getMonth() + 1).padStart(2, "0");
  const dd = String(withdrawnAt.getDate()).padStart(2, "0");
  const hh = String(withdrawnAt.getHours()).padStart(2, "0");
  const min = String(withdrawnAt.getMinutes()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd} ${hh}:${min}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(userName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      회원 탈퇴가 정상적으로 처리되었습니다.<br />
      그동안 교사유가족협의회와 함께해 주셔서 진심으로 감사드립니다. 🙏
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:13px;font-weight:700;color:#0f0f0f;margin-bottom:10px;">
            📋 탈퇴 정보
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:5px 0;color:#8a8a8a;">탈퇴 일시</td>
              <td style="padding:5px 0;color:#0f0f0f;">${esc(dateStr)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">탈퇴 계정</td>
              <td style="padding:5px 0;color:#0f0f0f;font-family:'Inter',monospace;">
                ${esc(email)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="margin:24px 0;padding:18px 20px;background:#ffffff;
                border:1px solid #e8e6e3;border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#0f0f0f;margin-bottom:10px;
                  font-family:'Noto Serif KR',serif;">
        🔒 개인정보 처리 안내
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.85;">
        • 회원 정보는 즉시 비활성화되며, 더 이상 로그인하실 수 없습니다<br />
        • 후원 내역은 <strong>관련 법령(국세청 기부금 영수증 보관)</strong>에 따라<br />
          &nbsp;&nbsp;5년간 보관 후 자동 삭제됩니다<br />
        • 그 외 개인정보는 <strong>30일 이내 완전 삭제</strong>됩니다<br />
        • 채팅 기록 및 지원 신청 내역은 익명 처리되어 보존됩니다
      </div>
    </div>

    <div style="margin:24px 0;padding:18px 20px;background:#fff8ec;
                border:1px solid #f0e3c4;border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#8a6a00;margin-bottom:8px;">
        💝 다시 함께해 주실 수 있다면
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.7;">
        ${esc(userName)} 님과 함께한 모든 순간이 협회에 큰 힘이 되었습니다.<br />
        언젠가 다시 동행해 주실 날을 기다리겠습니다.<br /><br />
        가족과 동료 교사들의 곁에서 든든한 버팀목이 될 수 있도록<br />
        앞으로도 정성을 다하겠습니다.
      </div>
    </div>

    <div style="margin:24px 0 0;padding:14px 16px;background:#f5f4f2;
                border-radius:6px;font-size:12px;color:#8a8a8a;line-height:1.7;">
      📞 <strong>문의 안내</strong><br />
      • 잘못 탈퇴하셨거나 복구를 원하시는 경우<br />
        &nbsp;&nbsp;<strong>contact@siren-org.kr</strong>로 문의해 주세요<br />
      • 보관 중인 개인정보 열람·정정·삭제 요청도 가능합니다
    </div>
  `;

  return {
    subject: `[SIREN] 회원 탈퇴가 완료되었습니다`,
    html: baseLayout({
      title: "회원 탈퇴 완료",
      bodyHtml,
      ctaText: "협회 홈페이지로",
      ctaUrl: `${SITE_URL}/index.html`,
    }),
  };
}
/* ═══════════════════════════════════════════════════════
   ★ Phase L-5: 템플릿 8. 정기 후원 결제 성공 알림 (NEW)
   - 매월 자동 결제 성공 시 발송
   ═══════════════════════════════════════════════════════ */
export function tplBillingChargeSuccess(opts: {
  donorName: string;
  amount: number;
  donationId: number;
  chargedAt: Date;
  nextChargeAt: Date;
  cardCompany: string;
  cardNumberMasked: string;
  isMember: boolean;
}) {
  const {
    donorName, amount, donationId, chargedAt, nextChargeAt,
    cardCompany, cardNumberMasked, isMember,
  } = opts;

  const yyyy = chargedAt.getFullYear();
  const mm = String(chargedAt.getMonth() + 1).padStart(2, "0");
  const dd = String(chargedAt.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const nextDateStr = `${nextChargeAt.getFullYear()}-${String(nextChargeAt.getMonth() + 1).padStart(2, "0")}-${String(nextChargeAt.getDate()).padStart(2, "0")}`;
  const donationNo = `D-${String(donationId).padStart(7, "0")}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(donorName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      ${esc(donorName)} 님의 정기 후원 <strong style="color:#7a1f2b;">₩${amount.toLocaleString()}</strong>이<br />
      정상적으로 결제되었습니다. 매월 보내주시는 따뜻한 마음에 깊이 감사드립니다. 🎗
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:13px;font-weight:700;color:#0f0f0f;margin-bottom:10px;">
            📋 결제 내역
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="100" style="padding:5px 0;color:#8a8a8a;">후원번호</td>
              <td style="padding:5px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(donationNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">결제일</td>
              <td style="padding:5px 0;color:#0f0f0f;">${esc(dateStr)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">결제 금액</td>
              <td style="padding:5px 0;color:#0f0f0f;font-weight:700;">
                ₩${amount.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">결제 카드</td>
              <td style="padding:5px 0;color:#0f0f0f;">
                ${esc(cardCompany)} ${esc(cardNumberMasked)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">다음 결제일</td>
              <td style="padding:5px 0;color:#0f0f0f;">${esc(nextDateStr)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="margin:20px 0;padding:16px 20px;background:#fef9f5;
                border:1px solid #f0e0d4;border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#0f0f0f;margin-bottom:8px;">
        📄 기부금 영수증
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.7;">
        ${isMember
          ? "마이페이지에서 영수증을 즉시 발급받으실 수 있습니다."
          : "회원가입 후 마이페이지에서 후원 내역과 영수증을 확인하실 수 있습니다."}
      </div>
    </div>

    <div style="margin:20px 0;padding:14px 16px;background:#f0f5fc;
                border:1px solid #cee0f2;border-radius:6px;
                font-size:12.5px;color:#1a5ec4;line-height:1.7;">
      💡 <strong>정기 후원 관리 안내</strong><br />
      • 결제 카드 변경/해지: 마이페이지 → 후원 내역에서 가능합니다<br />
      • 카드 만료 등으로 결제 실패 시 별도 안내 메일을 보내드립니다<br />
      • 매월 자동 결제일 약 5~10일 전에 결제 예정 안내를 보내드립니다
    </div>

    <p style="margin:24px 0 0;color:#525252;font-size:13.5px;line-height:1.7;">
      ${esc(donorName)} 님의 따뜻한 마음으로<br />
      유가족분들이 더 단단히 일어설 수 있습니다.<br /><br />
      늘 감사합니다. 🙏
    </p>
  `;

  return {
    subject: `[SIREN] 정기 후원 결제 완료 안내 (₩${amount.toLocaleString()})`,
    html: baseLayout({
      title: "정기 후원 결제 완료",
      bodyHtml,
      ctaText: isMember ? "마이페이지에서 영수증 발급" : "협회 홈페이지로",
      ctaUrl: isMember ? `${SITE_URL}/mypage.html#donations` : `${SITE_URL}/index.html`,
    }),
  };
}

/* ═══════════════════════════════════════════════════════
   ★ Phase L-5: 템플릿 9. 정기 후원 결제 실패 알림 (NEW)
   - 매월 자동 결제 실패 시 발송
   - 1회/2회/3회(자동해지)별로 다른 메시지
   ═══════════════════════════════════════════════════════ */
export function tplBillingChargeFailed(opts: {
  donorName: string;
  amount: number;
  failureReason: string;
  consecutiveFailCount: number;  // 1, 2, 3
  willRetryAt?: Date;             // 다음 재시도 일정
  isMember: boolean;
}) {
  const {
    donorName, amount, failureReason,
    consecutiveFailCount, willRetryAt, isMember,
  } = opts;

  const isFinal = consecutiveFailCount >= 3;
  const isWarning = consecutiveFailCount === 2;

  const retryStr = willRetryAt
    ? `${willRetryAt.getFullYear()}-${String(willRetryAt.getMonth() + 1).padStart(2, "0")}-${String(willRetryAt.getDate()).padStart(2, "0")}`
    : "";


    
  /* 상태별 안내 박스 */
  const noticeHtml = isFinal
    ? `
    <div style="margin:20px 0;padding:18px 20px;
                background:linear-gradient(135deg,#fdecec,#fff5f5);
                border:2px solid #c5293a;border-radius:8px;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <div style="font-size:24px;line-height:1;flex-shrink:0;">🛑</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#c5293a;margin-bottom:6px;">
            정기 후원이 자동 해지되었습니다
          </div>
          <div style="font-size:13px;color:#a01e2c;line-height:1.6;">
            연속 ${consecutiveFailCount}회 결제 실패로 정기 후원이 해지되었습니다.<br />
            다시 시작하시려면 마이페이지에서 새 카드로 등록해 주세요.
          </div>
        </div>
      </div>
    </div>`
    : isWarning
    ? `
    <div style="margin:20px 0;padding:16px 20px;
                background:#fff8ec;border:2px solid #f0e3c4;border-radius:8px;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <div style="font-size:24px;line-height:1;flex-shrink:0;">⚠️</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#8a6a00;margin-bottom:6px;">
            연속 2회 결제 실패 — 1회 더 실패 시 자동 해지
          </div>
          <div style="font-size:13px;color:#6a5400;line-height:1.6;">
            카드를 확인해 주시거나 마이페이지에서 새 카드로 등록해 주세요.
            ${retryStr ? `<br />다음 자동 재시도: <strong>${esc(retryStr)}</strong>` : ""}
          </div>
        </div>
      </div>
    </div>`
    : `
    <div style="margin:20px 0;padding:14px 18px;
                background:#fff8ec;border:1px solid #f0e3c4;border-radius:6px;
                font-size:13px;color:#8a6a00;line-height:1.6;">
      💡 결제 실패가 발생했습니다.${retryStr ? `<br />다음 자동 재시도: <strong>${esc(retryStr)}</strong>` : ""}
    </div>`;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(donorName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      정기 후원 결제 ₩${amount.toLocaleString()}이<br />
      <strong style="color:#c5293a;">정상적으로 처리되지 않았습니다.</strong>
    </p>

    ${noticeHtml}

    <div style="margin:20px 0;padding:14px 16px;background:#fafaf8;
                border:1px solid #e8e6e3;border-radius:6px;font-size:12.5px;
                color:#525252;line-height:1.7;">
      <strong style="color:#0f0f0f;">⚠️ 실패 사유</strong><br />
      ${esc(failureReason || "카드 결제가 거절되었습니다")}
    </div>

    <div style="margin:20px 0;padding:16px 20px;background:#f0f5fc;
                border:1px solid #cee0f2;border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#1a5ec4;margin-bottom:10px;">
        💡 해결 방법
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.85;">
        • 카드 한도 또는 잔액을 확인해 주세요<br />
        • 카드 유효기간이 만료되었는지 확인해 주세요<br />
        • 해외 결제 차단이 활성화되어 있다면 해제해 주세요<br />
        • 다른 카드로 변경하시려면 마이페이지에서 정기 후원을 해지 후 재등록해 주세요
      </div>
    </div>

    <p style="margin:20px 0 0;color:#8a8a8a;font-size:12px;line-height:1.7;">
      문의: contact@siren-org.kr / 02-0000-0000
    </p>
  `;

  const subjectPrefix = isFinal
    ? "🛑 [SIREN] 정기 후원 자동 해지 안내"
    : isWarning
    ? "⚠️ [SIREN] 정기 후원 결제 실패 (2회 연속)"
    : "[SIREN] 정기 후원 결제 실패 안내";

  return {
    subject: subjectPrefix,
    html: baseLayout({
      title: isFinal ? "정기 후원 자동 해지" : "정기 후원 결제 실패",
      bodyHtml,
      ctaText: isMember ? "마이페이지에서 확인" : "협회 홈페이지로",
      ctaUrl: isMember ? `${SITE_URL}/mypage.html#donations` : `${SITE_URL}/index.html`,
    }),
  };
}

/* ═══════════════════════════════════════════════════════
   ★ Phase M-10: 사이렌 관리 답변 알림 메일 4종
   ═══════════════════════════════════════════════════════ */

/* ───────────────────────────────────────────────────────
   M-10-1. 사건 제보 답변 등록 알림
   ─────────────────────────────────────────────────────── */
export function tplIncidentResponseUser(opts: {
  applicantName: string;
  reportNo: string;
  title: string;
  newStatus: string;
}) {
  const { applicantName, reportNo, title, newStatus } = opts;

  const statusKr: Record<string, string> = {
    submitted: "접수됨",
    ai_analyzed: "AI 분석 완료",
    reviewing: "검토 중",
    responded: "답변 등록 완료",
    closed: "종결",
    rejected: "반려",
  };

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(applicantName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      ${esc(applicantName)} 님의 사건 제보에 대한 <strong style="color:#7a1f2b;">관리자 답변이 등록</strong>되었습니다.<br />
      자세한 내용은 마이페이지에서 확인해 주세요.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:6px 0;color:#8a8a8a;">제보번호</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(reportNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;vertical-align:top;">제목</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;">${esc(title)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;">처리 상태</td>
              <td style="padding:6px 0;">
                <span style="display:inline-block;padding:3px 10px;background:#7a1f2b;
                             color:#ffffff;border-radius:3px;font-size:12px;font-weight:600;">
                  ${esc(statusKr[newStatus] || newStatus)}
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
    subject: `[SIREN] 사건 제보에 대한 답변이 등록되었습니다`,
    html: baseLayout({
      title: "사건 제보 답변 등록",
      bodyHtml,
      ctaText: "마이페이지에서 답변 확인",
      ctaUrl: `${SITE_URL}/mypage.html#support`,
    }),
  };
}

/* ───────────────────────────────────────────────────────
   M-10-2. 악성민원 신고 답변 등록 알림
   ─────────────────────────────────────────────────────── */
export function tplHarassmentResponseUser(opts: {
  applicantName: string;
  reportNo: string;
  title: string;
  newStatus: string;
}) {
  const { applicantName, reportNo, title, newStatus } = opts;

  const statusKr: Record<string, string> = {
    submitted: "접수됨",
    ai_analyzed: "AI 분석 완료",
    reviewing: "검토 중",
    responded: "답변 등록 완료",
    closed: "종결",
    rejected: "반려",
  };

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(applicantName)}</strong> 님.
    </p>
    <p style="margin:0 0 16px;color:#525252;">
      ${esc(applicantName)} 님의 악성민원 신고에 대한 <strong style="color:#7a1f2b;">사이렌 운영진의 검토 답변</strong>이 등록되었습니다.<br />
      마이페이지에서 자세히 확인해 주세요.
    </p>

    <div style="margin:18px 0;padding:14px 18px;background:#f0f5fc;
                border:1px solid #cee0f2;border-radius:6px;
                font-size:13px;color:#1a5ec4;line-height:1.6;">
      💗 혼자 견디지 마세요. 사이렌이 함께합니다.
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:6px 0;color:#8a8a8a;">신고번호</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(reportNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;vertical-align:top;">제목</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;">${esc(title)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;">처리 상태</td>
              <td style="padding:6px 0;">
                <span style="display:inline-block;padding:3px 10px;background:#7a1f2b;
                             color:#ffffff;border-radius:3px;font-size:12px;font-weight:600;">
                  ${esc(statusKr[newStatus] || newStatus)}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="margin:24px 0 0;padding:14px 16px;background:#fff8ec;border:1px solid #f0e3c4;
                border-radius:6px;font-size:12px;color:#8a6a00;line-height:1.6;">
      🔒 <strong>비밀 보장</strong> · 신고 내용과 답변은 본인 외에 열람할 수 없습니다.
    </div>
  `;

  return {
    subject: `[SIREN] 악성민원 신고에 대한 답변이 등록되었습니다`,
    html: baseLayout({
      title: "악성민원 신고 답변 등록",
      bodyHtml,
      ctaText: "마이페이지에서 답변 확인",
      ctaUrl: `${SITE_URL}/mypage.html#support`,
    }),
  };
}

/* ───────────────────────────────────────────────────────
   M-10-3. 법률지원 답변/변호사 매칭 알림
   ─────────────────────────────────────────────────────── */
export function tplLegalResponseUser(opts: {
  applicantName: string;
  consultationNo: string;
  title: string;
  newStatus: string;
  assignedLawyerName?: string | null;
}) {
  const { applicantName, consultationNo, title, newStatus, assignedLawyerName } = opts;

  const statusKr: Record<string, string> = {
    submitted: "접수됨",
    ai_analyzed: "AI 1차 분석 완료",
    matching: "변호사 매칭 중",
    matched: "변호사 매칭 완료",
    in_progress: "상담 진행 중",
    responded: "답변 등록 완료",
    closed: "종결",
    rejected: "반려",
  };

  const lawyerHtml = assignedLawyerName
    ? `
    <div style="margin:18px 0;padding:14px 18px;background:#f8f7fc;
                border:2px solid #5a4d8c;border-radius:6px;">
      <div style="font-size:13px;font-weight:700;color:#5a4d8c;margin-bottom:4px;">
        👨‍⚖️ 매칭된 변호사
      </div>
      <div style="font-size:14px;color:#0f0f0f;font-family:'Noto Serif KR',serif;font-weight:600;">
        ${esc(assignedLawyerName)}
      </div>
    </div>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(applicantName)}</strong> 님.
    </p>
    <p style="margin:0 0 16px;color:#525252;">
      ${esc(applicantName)} 님의 법률 상담 신청에 대한 <strong style="color:#5a4d8c;">사이렌 운영진의 답변</strong>이 등록되었습니다.
    </p>

    ${lawyerHtml}

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:6px 0;color:#8a8a8a;">접수번호</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(consultationNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;vertical-align:top;">제목</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;">${esc(title)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;">처리 상태</td>
              <td style="padding:6px 0;">
                <span style="display:inline-block;padding:3px 10px;background:#5a4d8c;
                             color:#ffffff;border-radius:3px;font-size:12px;font-weight:600;">
                  ${esc(statusKr[newStatus] || newStatus)}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="margin:24px 0 0;padding:14px 16px;background:#fff8ec;border:1px solid #f0e3c4;
                border-radius:6px;font-size:12px;color:#8a6a00;line-height:1.7;">
      ⚠️ <strong>면책 안내</strong> · 사이렌이 제공하는 답변은 1차 자문 안내이며 법률 자문이 아닙니다.<br />
      정확한 법적 판단은 매칭된 변호사와의 상담을 통해 받으시기 바랍니다.
    </div>
  `;

  return {
    subject: `[SIREN] 법률 상담에 대한 답변이 등록되었습니다`,
    html: baseLayout({
      title: "법률 상담 답변 등록",
      bodyHtml,
      ctaText: "마이페이지에서 답변 확인",
      ctaUrl: `${SITE_URL}/mypage.html#support`,
    }),
  };
}

/* ───────────────────────────────────────────────────────
   M-10-4. 자유게시판 관리자 답변 알림
   ─────────────────────────────────────────────────────── */
export function tplBoardResponseUser(opts: {
  applicantName: string;
  postNo: string;
  title: string;
  postId: number;
}) {
  const { applicantName, postNo, title, postId } = opts;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(applicantName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      자유게시판에 작성하신 게시글에 <strong style="color:#7a1f2b;">사이렌 관리자의 답변</strong>이 등록되었습니다.<br />
      자세한 내용은 게시글 페이지에서 확인해 주세요.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="90" style="padding:6px 0;color:#8a8a8a;">게시글 번호</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;font-family:'Inter',monospace;">
                ${esc(postNo)}
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#8a8a8a;vertical-align:top;">제목</td>
              <td style="padding:6px 0;color:#0f0f0f;font-weight:600;">${esc(title)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return {
    subject: `[SIREN] 자유게시판 게시글에 관리자 답변이 등록되었습니다`,
    html: baseLayout({
      title: "자유게시판 답변 등록",
      bodyHtml,
      ctaText: "게시글로 이동",
      ctaUrl: `${SITE_URL}/board-view.html?id=${postId}`,
    }),
    
  };
  
}
// lib/email.ts — 파일 맨 끝 tplBoardResponseUser 다음에 추가
/* ═══════════════════════════════════════════════════════
   ★ Phase M-19-1: 템플릿 14. 회원 등급 상승 축하 (NEW)
   - recalculateGrade() 에서 등급 상승 감지 시 자동 발송
   - members.agreeEmail=true 인 경우만 (정책 준수)
   ═══════════════════════════════════════════════════════ */
export function tplGradeUpgrade(opts: {
  userName: string;
  gradeName: string;
  gradeIcon: string;
  totalAmount: number;
  regularMonths: number;
}) {
  const { userName, gradeName, gradeIcon, totalAmount, regularMonths } = opts;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(userName)}</strong> 님.
    </p>
    <p style="margin:0 0 20px;color:#525252;">
      ${esc(userName)} 님의 따뜻한 동행에 진심으로 감사드립니다.<br />
      회원 등급이 <strong style="color:#7a1f2b;">${esc(gradeIcon)} ${esc(gradeName)}</strong> 등급으로 상승하였습니다. 🎉
    </p>

    <div style="margin:24px 0;padding:24px;
                background:linear-gradient(135deg,#fef9f5,#fff8ec);
                border:2px solid #f0e0d4;border-radius:12px;text-align:center;">
      <div style="font-size:48px;line-height:1;margin-bottom:10px;">${esc(gradeIcon)}</div>
      <div style="font-family:'Noto Serif KR',serif;font-size:22px;font-weight:700;
                  color:#0f0f0f;margin-bottom:6px;">
        ${esc(gradeName)}
      </div>
      <div style="font-size:13px;color:#8a6a00;letter-spacing:1px;">
        SIREN MEMBER GRADE
      </div>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fafaf8;border:1px solid #e8e6e3;border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:13px;font-weight:700;color:#0f0f0f;margin-bottom:10px;">
            📊 동행 기록
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
            <tr>
              <td width="120" style="padding:5px 0;color:#8a8a8a;">누적 후원 금액</td>
              <td style="padding:5px 0;color:#0f0f0f;font-weight:700;">
                ₩${totalAmount.toLocaleString()}
              </td>
            </tr>
            ${regularMonths > 0 ? `
            <tr>
              <td style="padding:5px 0;color:#8a8a8a;">정기 후원 기간</td>
              <td style="padding:5px 0;color:#0f0f0f;font-weight:700;">
                ${regularMonths}개월
              </td>
            </tr>` : ""}
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0;color:#525252;font-size:13.5px;line-height:1.7;">
      ${esc(userName)} 님과 같은 분들이 계시기에<br />
      유가족분들이 한 걸음씩 일상을 회복해 갈 수 있습니다.<br /><br />
      앞으로도 변함없는 따뜻한 동행 부탁드립니다. 🎗
    </p>
  `;

  return {
    subject: `[SIREN] 회원 등급이 상승했습니다 ${gradeIcon} ${gradeName}`,
    html: baseLayout({
      title: "회원 등급 상승 축하",
      bodyHtml,
      ctaText: "마이페이지에서 확인",
      ctaUrl: `${SITE_URL}/mypage.html`,
    }),
  };
}
// lib/email.ts — 파일 맨 끝 tplGradeUpgrade 함수 다음에 추가

/* ═══════════════════════════════════════════════════════
   ★ Phase M-19-1: 템플릿 15. 후원자 재참여 유도 메일 (NEW)
   - 어드민이 churn risk가 있는 회원에게 수동/AI로 발송
   - members.agreeEmail=true 인 회원만 (정책 준수)
   - 7일 내 중복 발송 방지 (admin-churn-reengage.ts에서 처리)
   ═══════════════════════════════════════════════════════ */
export function tplChurnReengage(opts: {
  memberName: string;
  messageBody: string;       // AI 생성 또는 운영자 작성 본문 (50~600자)
  totalDonationAmount: number;
}) {
  const { memberName, messageBody, totalDonationAmount } = opts;
  const safeMessage = esc(messageBody).replace(/\n/g, "<br />");
  const hasDonationHistory = totalDonationAmount > 0;

  const historyBlock = hasDonationHistory
    ? `
    <div style="margin:24px 0;padding:18px 20px;
                background:linear-gradient(135deg,#fef9f5,#fff8ec);
                border:1px solid #f0e0d4;border-radius:8px;text-align:center;">
      <div style="font-size:13px;color:#8a8a8a;margin-bottom:6px;">
        💝 ${esc(memberName)} 님과 함께한 동행
      </div>
      <div style="font-family:'Inter',sans-serif;font-size:22px;font-weight:700;
                  color:#7a1f2b;letter-spacing:-0.5px;">
        누적 후원 ₩${totalDonationAmount.toLocaleString()}
      </div>
      <div style="font-size:12px;color:#a08568;margin-top:6px;">
        교사 유가족분들에게 큰 힘이 되어주셨습니다 🎗
      </div>
    </div>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      안녕하세요, <strong>${esc(memberName)}</strong> 님.
    </p>

    <div style="margin:18px 0;padding:18px 22px;background:#fafaf8;
                border-left:3px solid #7a1f2b;border-radius:4px;
                font-size:14px;color:#333333;line-height:1.85;">
      ${safeMessage}
    </div>

    ${historyBlock}

    <div style="margin:24px 0;padding:18px 20px;background:#ffffff;
                border:1px solid #e8e6e3;border-radius:8px;">
      <div style="font-size:14px;font-weight:700;color:#0f0f0f;margin-bottom:10px;
                  font-family:'Noto Serif KR',serif;">
        🎗 사이렌은 지금 이런 활동을 하고 있습니다
      </div>
      <div style="font-size:13px;color:#525252;line-height:1.85;">
        • 유가족 심리 상담 및 법률 자문 매칭<br />
        • 교사 악성민원 신고 및 대응 지원<br />
        • 자녀 교육·장학 사업 운영<br />
        • 추모 사업 및 사회 인식 개선 캠페인
      </div>
      <div style="margin-top:12px;font-size:12.5px;color:#8a8a8a;line-height:1.6;">
        모든 후원금은 <strong>매년 투명하게</strong> 사용 내역이 공개됩니다.<br />
        협회 홈페이지의 "재정 보고"에서 언제든 확인하실 수 있습니다.
      </div>
    </div>

    <div style="margin:24px 0 0;padding:14px 16px;background:#f5f4f2;
                border-radius:6px;font-size:12px;color:#8a8a8a;line-height:1.7;">
      📬 <strong>이 메일을 받으신 이유</strong><br />
      ${esc(memberName)} 님은 사이렌의 소중한 후원 회원이십니다.<br />
      알림 메일을 받지 않으시려면 마이페이지 → 알림 설정에서 변경하실 수 있습니다.
    </div>

    <p style="margin:20px 0 0;color:#525252;font-size:13.5px;line-height:1.7;">
      언제 어디서든 ${esc(memberName)} 님의 마음 곁에서<br />
      함께 걷고 있겠습니다. 🙏
    </p>
  `;

  return {
    subject: `[SIREN] ${memberName}님, 사이렌이 안부를 전합니다 🎗`,
    html: baseLayout({
      title: "사이렌이 안부를 전합니다",
      bodyHtml,
      ctaText: "사이렌 홈페이지 방문",
      ctaUrl: `${SITE_URL}/index.html`,
    }),
  };
}