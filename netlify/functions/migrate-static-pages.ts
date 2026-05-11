/**
 * GET /api/migrate-static-pages          진단 (인증 불필요)
 * GET /api/migrate-static-pages?run=1    어드민 인증 후 실행
 *
 * 이용약관 + 개인정보처리방침 본문을 site_settings에 UPSERT.
 * 기존 row가 있으면 덮어쓰기(UPDATE), 없으면 INSERT.
 * 호출 성공 후 즉시 파일 삭제 + 커밋.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-static-pages" };

const TERMS_BODY = `<h2>이용약관</h2>
<p><strong>제1조 (목적)</strong><br>
이 약관은 사단법인 교사유가족협의회(이하 "협의회")가 운영하는 SIREN 플랫폼(이하 "서비스")의 이용 조건 및 절차, 이용자와 협의회의 권리·의무와 책임 사항을 규정함을 목적으로 합니다.</p>

<p><strong>제2조 (정의)</strong><br>
① "서비스"란 협의회가 인터넷을 통해 제공하는 후원 관리, 회원 관리, 유가족 지원 신청, 사건 신고, 법률 상담, 커뮤니티 등 일체의 기능을 말합니다.<br>
② "회원"이란 본 약관에 동의하고 협의회에 회원 가입을 완료한 자를 말합니다.<br>
③ "유료 서비스"란 정기 후원, 일시 후원 등 협의회가 제공하는 유료 기능을 말합니다.</p>

<p><strong>제3조 (약관의 효력 및 변경)</strong><br>
① 이 약관은 서비스 화면에 게시하거나 기타 방법으로 이용자에게 공지함으로써 효력을 발생합니다.<br>
② 협의회는 합리적인 사유가 있는 경우 이 약관을 변경할 수 있으며, 변경된 약관은 공지 후 7일 이후 효력이 발생합니다.</p>

<p><strong>제4조 (서비스 제공 및 변경)</strong><br>
① 협의회는 다음 각 호의 서비스를 제공합니다.<br>
- 후원 관리 (정기 후원, 일시 후원, 효성 CMS+ 자동이체)<br>
- 유가족 지원 신청 (심리상담, 법률지원, 장학금 신청)<br>
- 사건·괴롭힘 신고 접수 및 인계<br>
- 법률 상담 신청<br>
- 커뮤니티 게시판 및 채팅<br>
- 워크스페이스(칸반 보드, 캘린더, 파일함)<br>
② 협의회는 운영상·기술상의 필요에 따라 제공하고 있는 서비스의 전부 또는 일부를 변경할 수 있습니다.</p>

<p><strong>제5조 (이용 신청 및 승낙)</strong><br>
① 이용 신청은 서비스 화면의 양식에 따라 이용자가 필요 정보를 기입하고 "동의" 버튼을 클릭함으로써 완료됩니다.<br>
② 협의회는 다음 각 호에 해당하는 경우 이용 신청을 거절할 수 있습니다.<br>
- 실명이 아닌 정보로 신청한 경우<br>
- 타인의 개인정보를 도용한 경우<br>
- 허위 정보를 기재한 경우</p>

<p><strong>제6조 (회원 정보 및 비밀번호 관리)</strong><br>
① 회원은 자신의 아이디와 비밀번호를 관리할 책임이 있습니다.<br>
② 회원은 자신의 아이디 및 비밀번호를 제3자에게 양도하거나 대여할 수 없습니다.<br>
③ 아이디 또는 비밀번호를 분실한 경우 서비스 내 "비밀번호 찾기" 기능을 이용하시기 바랍니다.</p>

<p><strong>제7조 (후원 및 환불 정책)</strong><br>
① 정기 후원은 매월 지정된 날짜에 자동으로 결제됩니다.<br>
② 후원 해지는 서비스 내 마이페이지 또는 협의회 사무국(전화: 대표번호)을 통해 신청할 수 있으며, 해지 신청일로부터 익월 결제부터 중단됩니다.<br>
③ 이미 결제된 후원금의 환불은 결제일로부터 7일 이내에 신청한 경우에 한하여 처리됩니다.</p>

<p><strong>제8조 (금지 행위)</strong><br>
회원은 다음 각 호에 해당하는 행위를 해서는 안 됩니다.<br>
① 허위 사실 기재 및 타인 사칭<br>
② 서비스의 정상적인 운영을 방해하는 행위<br>
③ 다른 회원의 개인정보를 무단으로 수집하거나 이용하는 행위<br>
④ 협의회의 명예를 훼손하거나 업무를 방해하는 행위<br>
⑤ 기타 관련 법령에 위반되는 행위</p>

<p><strong>제9조 (서비스 이용 제한)</strong><br>
협의회는 회원이 이 약관의 의무를 위반하거나 서비스의 정상적인 운영을 방해한 경우 경고, 일시 정지, 영구 이용 정지 등의 단계적 조치를 취할 수 있습니다.</p>

<p><strong>제10조 (책임의 한계)</strong><br>
① 협의회는 천재지변, 불가항력적 사유로 인하여 서비스를 제공할 수 없는 경우에는 서비스 제공에 대한 책임이 면제됩니다.<br>
② 협의회는 회원의 귀책 사유로 인한 서비스 이용 장애에 대하여 책임을 지지 않습니다.</p>

<p><strong>제11조 (분쟁 해결)</strong><br>
협의회와 회원 간에 발생한 분쟁은 상호 협의하여 해결함을 원칙으로 하며, 협의가 이루어지지 않을 경우 관할 법원은 협의회 소재지를 관할하는 법원으로 합니다.</p>

<p style="margin-top:24px;color:#888;font-size:13px">시행일: 2024년 1월 1일<br>
사단법인 교사유가족협의회 (사업자번호 118-82-71215)</p>`;

const PRIVACY_BODY = `<h2>개인정보처리방침</h2>
<p>사단법인 교사유가족협의회(이하 "협의회")는 정보주체의 자유와 권리 보호를 위해 「개인정보 보호법」 및 관계 법령이 정한 바를 준수하며, 적법하게 개인정보를 처리하고 안전하게 관리합니다. 이에 개인정보 보호법 제30조에 따라 정보주체에게 개인정보 처리에 관한 절차 및 기준을 안내하고, 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.</p>

<p><strong>제1조 (개인정보의 처리 목적)</strong><br>
협의회는 다음의 목적을 위하여 개인정보를 처리합니다.<br>
① 회원 가입 및 관리: 회원 가입 의사 확인, 회원 자격 유지·관리, 서비스 부정 이용 방지<br>
② 후원 관리: 정기·일시 후원 결제, 후원 내역 관리, 기부금 영수증 발급<br>
③ 유가족 지원 신청: 심리상담·법률지원·장학금 신청 접수 및 처리<br>
④ 사건·괴롭힘 신고 처리: 신고 접수, 기관 인계, 처리 현황 안내<br>
⑤ 민원 처리: 민원인 신원 확인, 민원 사항 확인, 처리 결과 통보</p>

<p><strong>제2조 (처리하는 개인정보의 항목)</strong><br>
① 필수 항목: 이름, 이메일 주소, 비밀번호, 연락처(전화번호)<br>
② 선택 항목: 생년월일, 성별, 주소, 소속 학교/직장<br>
③ 후원 결제 시: 카드번호(일부), 결제 승인번호(PG사 관리), 은행 계좌정보<br>
④ 서비스 이용 과정에서 자동 수집: 접속 IP, 쿠키, 서비스 이용 기록, 기기 정보</p>

<p><strong>제3조 (개인정보의 처리 및 보유 기간)</strong><br>
① 회원 정보: 회원 탈퇴 시까지 (탈퇴 후 3개월 내 파기)<br>
② 후원 결제 정보: 결제일로부터 5년 (국세기본법 준수)<br>
③ 사건·신고 관련 정보: 사건 종결 후 3년<br>
④ 접속 로그: 3개월<br>
단, 관계 법령의 규정에 의하여 보존할 필요가 있는 경우 해당 기간 동안 보존합니다.</p>

<p><strong>제4조 (개인정보의 제3자 제공)</strong><br>
협의회는 정보주체의 개인정보를 제1조에서 명시한 목적 범위 내에서만 처리하며, 정보주체의 동의, 법률의 특별한 규정 등 개인정보 보호법 제17조에 해당하는 경우에만 개인정보를 제3자에게 제공합니다.<br>
① 결제 대행: 토스페이먼츠(주), 효성에프엠에스(주) — 결제 처리 목적<br>
② 이메일 발송: Resend Inc. — 서비스 알림 이메일 발송 목적</p>

<p><strong>제5조 (개인정보 처리 위탁)</strong><br>
협의회는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁합니다.<br>
- 수탁자: Neon Technologies Inc. — 데이터베이스 관리<br>
- 수탁자: Netlify Inc. — 서비스 호스팅 및 Functions 운영<br>
- 수탁자: Cloudflare Inc. — 파일 저장소(R2) 운영</p>

<p><strong>제6조 (정보주체의 권리·의무 및 행사 방법)</strong><br>
정보주체는 협의회에 대해 언제든지 다음 각 호의 개인정보 보호 관련 권리를 행사할 수 있습니다.<br>
① 개인정보 열람 요구<br>
② 오류 등이 있을 경우 정정 요구<br>
③ 삭제 요구<br>
④ 처리 정지 요구<br>
권리 행사는 서비스 내 마이페이지 또는 이메일(개인정보보호책임자)을 통해 신청할 수 있으며, 10일 이내에 처리 결과를 안내해 드립니다.</p>

<p><strong>제7조 (개인정보의 파기)</strong><br>
협의회는 보유 기간이 경과하거나 처리 목적이 달성된 경우 해당 개인정보를 지체 없이 파기합니다.<br>
① 전자적 파일 형태: 복구 불가능한 방법으로 영구 삭제<br>
② 서면 등 기타 기록물: 분쇄기로 분쇄 또는 소각</p>

<p><strong>제8조 (개인정보의 안전성 확보 조치)</strong><br>
협의회는 개인정보의 안전성 확보를 위하여 다음과 같은 조치를 취하고 있습니다.<br>
① 비밀번호 단방향 암호화(bcrypt) 저장<br>
② HTTPS 전송 구간 암호화<br>
③ 접근 권한의 최소화 및 관리<br>
④ 개인정보 처리 시스템 접근 IP 제한</p>

<p><strong>제9조 (쿠키의 사용)</strong><br>
협의회는 이용자에게 서비스를 제공하기 위해 쿠키(Cookie)를 사용합니다. 쿠키는 로그인 상태 유지 등 서비스 제공에 필요한 최소한의 정보만 저장합니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 서비스 이용에 불편이 있을 수 있습니다.</p>

<p><strong>제10조 (개인정보 보호책임자)</strong><br>
협의회는 개인정보 처리에 관한 업무를 총괄하고 개인정보 처리와 관련한 정보주체의 불만 처리 및 피해 구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정합니다.<br>
- 성명: 협의회 대표<br>
- 직책: 대표<br>
- 이메일: 협의회 공식 이메일<br>
정보주체는 개인정보 보호법 제35조에 따른 열람 청구, 제37조에 따른 처리 정지 요구를 아래 기관에도 신청할 수 있습니다.<br>
▶ 개인정보침해 신고센터 (privacy.kisa.or.kr / 118)<br>
▶ 국민권익위원회 (www.acrc.go.kr / 1398)</p>

<p style="margin-top:24px;color:#888;font-size:13px">공고일: 2024년 1월 1일 / 시행일: 2024년 1월 1일<br>
사단법인 교사유가족협의회 (사업자번호 118-82-71215)</p>`;

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "정적 페이지 시드 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 */
  if (!run) {
    try {
      const { db } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const result = await db.execute(sql`
        SELECT id, scope, key, LEFT(value, 80) AS preview
        FROM site_settings
        WHERE scope IN ('page.terms', 'page.privacy', 'page.email_reject', 'page.ethics')
        ORDER BY scope
      `);
      const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
      return new Response(
        JSON.stringify({ ok: true, mode: "diagnose", rows }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return jsonError("diagnose", err);
    }
  }

  /* 실행 모드 — 어드민 인증 필수 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    const { db } = await import("../../db");
    const { sql } = await import("drizzle-orm");

    await db.execute(sql`
      INSERT INTO site_settings (scope, key, value, updated_at)
      VALUES
        ('page.terms',   'body', ${TERMS_BODY},   NOW()),
        ('page.privacy', 'body', ${PRIVACY_BODY}, NOW())
      ON CONFLICT (scope, key) DO UPDATE
        SET value      = EXCLUDED.value,
            updated_at = NOW()
    `);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "이용약관 + 개인정보처리방침 시드 완료 (UPSERT)",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return jsonError("upsert", err);
  }
};
