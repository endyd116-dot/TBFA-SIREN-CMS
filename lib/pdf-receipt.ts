/**
 * SIREN — PDF 기부금 영수증 생성 (STEP H-2c)
 *
 * - pdf-lib + @pdf-lib/fontkit 사용
 * - assets/fonts/NotoSansKR-Regular.ttf 임베딩 (subset)
 * - A4 (595 x 842 pt) 1장
 * - 협회 정보는 환경변수에서 읽음 (없으면 샘플 값)
 *
 * 환경변수:
 *   ORG_NAME              — 단체명
 *   ORG_REGISTRATION_NO   — 고유번호 (사업자등록번호 격)
 *   ORG_REPRESENTATIVE    — 대표자
 *   ORG_ADDRESS           — 주소
 *   ORG_PHONE             — 연락처
 */
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ============ 협회 정보 (환경변수 기반) ============ */
function getOrgInfo() {
  return {
    name: process.env.ORG_NAME || "(샘플) 교사유가족협의회",
    registrationNo: process.env.ORG_REGISTRATION_NO || "000-00-00000",
    representative: process.env.ORG_REPRESENTATIVE || "○○○",
    address: process.env.ORG_ADDRESS || "(샘플) 서울특별시 ○○구 ○○로 ○○",
    phone: process.env.ORG_PHONE || "(샘플) 02-0000-0000",
  };
}

/* ============ 폰트 캐싱 (Lambda 컨테이너 재사용 시 성능 향상) ============ */
let _fontCache: Uint8Array | null = null;

function loadKoreanFont(): Uint8Array {
  if (_fontCache) return _fontCache;
  /* process.cwd() = /var/task (Netlify Functions) */
  const fontPath = join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf");
  const buf = readFileSync(fontPath);
  _fontCache = buf;
  return buf;
}

/* ============ 영수증 데이터 인터페이스 ============ */
export interface ReceiptData {
  receiptNumber: string;
  donorName: string;
  donorEmail?: string | null;
  donorPhone?: string | null;
  amount: number;
  donationDate: Date;
  payMethod: string;          // card / bank / cms
  donationType: string;       // regular / onetime
}

/* ============ 메인 함수: PDF 바이너리 생성 ============ */
export async function generateReceiptPDF(data: ReceiptData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);

  /* 한글 폰트 임베딩 (subset: 사용된 글자만 포함 → 파일 크기 작음) */
  const fontBytes = loadKoreanFont();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  /* A4 1장 추가 */
  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const org = getOrgInfo();

  /* 색상 정의 */
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const lightGray = rgb(0.92, 0.92, 0.92);
  const lineColor = rgb(0.2, 0.2, 0.2);
  const stampRed = rgb(0.7, 0.05, 0.1);

  /* ───────── 제목 ───────── */
  const title = "기 부 금  영 수 증";
  const titleSize = 22;
  const titleWidth = font.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (width - titleWidth) / 2,
    y: height - 80,
    size: titleSize,
    font,
    color: black,
  });

  /* 부제목 */
  const subtitle = "(소득세법 시행규칙 별지 제45호의2 서식)";
  const subSize = 10;
  const subWidth = font.widthOfTextAtSize(subtitle, subSize);
  page.drawText(subtitle, {
    x: (width - subWidth) / 2,
    y: height - 105,
    size: subSize,
    font,
    color: gray,
  });

  /* ───────── 영수증 번호 / 발급일 ───────── */
  page.drawText(`영수증 번호: ${data.receiptNumber}`, {
    x: 50,
    y: height - 140,
    size: 11,
    font,
    color: black,
  });

  const issueDate = new Date();
  const issueDateStr = `발급일: ${issueDate.getFullYear()}년 ${issueDate.getMonth() + 1}월 ${issueDate.getDate()}일`;
  const issueDateWidth = font.widthOfTextAtSize(issueDateStr, 11);
  page.drawText(issueDateStr, {
    x: width - 50 - issueDateWidth,
    y: height - 140,
    size: 11,
    font,
    color: black,
  });

  /* 상단 구분선 */
  let y = height - 165;
  page.drawLine({
    start: { x: 50, y },
    end: { x: width - 50, y },
    thickness: 1.5,
    color: lineColor,
  });

  /* ───────── 헬퍼: 라벨/값 박스 그리기 ───────── */
  function drawLabelValue(
    label: string,
    value: string,
    x: number,
    yPos: number,
    labelW: number,
    valueW: number
  ) {
    /* 라벨 박스 (회색 배경) */
    page.drawRectangle({
      x,
      y: yPos - 25,
      width: labelW,
      height: 25,
      color: lightGray,
      borderColor: lineColor,
      borderWidth: 0.8,
    });
    /* 값 박스 (흰색) */
    page.drawRectangle({
      x: x + labelW,
      y: yPos - 25,
      width: valueW,
      height: 25,
      borderColor: lineColor,
      borderWidth: 0.8,
    });
    /* 라벨 텍스트 */
    page.drawText(label, {
      x: x + 8,
      y: yPos - 17,
      size: 10,
      font,
      color: black,
    });
    /* 값 텍스트 (긴 텍스트 자동 자르기) */
    const maxValueLen = Math.floor(valueW / 6);
    const displayValue = value.length > maxValueLen ? value.slice(0, maxValueLen - 2) + ".." : value;
    page.drawText(displayValue, {
      x: x + labelW + 8,
      y: yPos - 17,
      size: 10,
      font,
      color: black,
    });
  }

  /* ───────── ① 기부자 정보 ───────── */
  y -= 25;
  page.drawText("① 기부자 정보", {
    x: 50,
    y,
    size: 12,
    font,
    color: black,
  });
  y -= 8;

  drawLabelValue("성명", data.donorName, 50, y, 70, 210);
  drawLabelValue("연락처", data.donorPhone || "-", 330, y, 70, 165);

  y -= 25;
  drawLabelValue("이메일", data.donorEmail || "-", 50, y, 70, 445);

  /* ───────── ② 기부단체 정보 ───────── */
  y -= 40;
  page.drawText("② 기부단체 정보", {
    x: 50,
    y,
    size: 12,
    font,
    color: black,
  });
  y -= 8;

  drawLabelValue("단체명", org.name, 50, y, 70, 425);
  y -= 25;
  drawLabelValue("고유번호", org.registrationNo, 50, y, 70, 210);
  drawLabelValue("대표자", org.representative, 330, y, 70, 165);
  y -= 25;
  drawLabelValue("주소", org.address, 50, y, 70, 425);
  y -= 25;
  drawLabelValue("연락처", org.phone, 50, y, 70, 425);

  /* ───────── ③ 기부 내역 ───────── */
  y -= 40;
  page.drawText("③ 기부 내역", {
    x: 50,
    y,
    size: 12,
    font,
    color: black,
  });
  y -= 8;

  const donDateStr = `${data.donationDate.getFullYear()}년 ${data.donationDate.getMonth() + 1}월 ${data.donationDate.getDate()}일`;
  drawLabelValue("기부일자", donDateStr, 50, y, 70, 210);
  drawLabelValue("기부유형", data.donationType === "regular" ? "정기후원" : "일시후원", 330, y, 70, 165);

  y -= 25;
  const amountStr = `₩ ${data.amount.toLocaleString()} (금 ${numberToKorean(data.amount)} 원정)`;
  drawLabelValue("기부금액", amountStr, 50, y, 70, 425);

  y -= 25;
  const payMap: Record<string, string> = {
    card: "신용카드",
    bank: "계좌이체",
    cms: "자동이체(CMS)",
  };
  drawLabelValue("결제방법", payMap[data.payMethod] || data.payMethod, 50, y, 70, 210);
  drawLabelValue("기부금구분", "지정기부금", 330, y, 70, 165);

  /* ───────── 증명 문구 ───────── */
  y -= 60;
  const proofText = "위와 같이 기부금을 기부하였음을 증명합니다.";
  const proofWidth = font.widthOfTextAtSize(proofText, 12);
  page.drawText(proofText, {
    x: (width - proofWidth) / 2,
    y,
    size: 12,
    font,
    color: black,
  });

  /* ───────── 발급 단체명 + 직인 ───────── */
  y -= 50;
  const orgLine = `${org.name}`;
  const orgLineSize = 14;
  const orgWidth = font.widthOfTextAtSize(orgLine, orgLineSize);
  const orgX = (width - orgWidth) / 2 - 25;
  page.drawText(orgLine, {
    x: orgX,
    y,
    size: orgLineSize,
    font,
    color: black,
  });

  /* 직인 자리 (붉은 원형 표시 — 실제 직인 이미지가 없으므로 표식만) */
  page.drawCircle({
    x: orgX + orgWidth + 35,
    y: y + 5,
    size: 22,
    borderColor: stampRed,
    borderWidth: 1.2,
  });
  const stampText = "직인";
  const stampSize = 9;
  const stampWidth = font.widthOfTextAtSize(stampText, stampSize);
  page.drawText(stampText, {
    x: orgX + orgWidth + 35 - stampWidth / 2,
    y: y + 1,
    size: stampSize,
    font,
    color: stampRed,
  });

  /* ───────── 하단 안내 (구분선 + 안내문) ───────── */
  page.drawLine({
    start: { x: 50, y: 120 },
    end: { x: width - 50, y: 120 },
    thickness: 0.5,
    color: gray,
  });

  const notes = [
    "• 본 영수증은 「소득세법」 제34조 및 「법인세법」 제24조에 따른 기부금 영수증입니다.",
    "• 본 영수증은 발급기관에서 전자 발급되었으며, 영수증 번호로 진위를 확인할 수 있습니다.",
    `• 문의: ${org.phone} / ${org.name}`,
  ];

  let noteY = 100;
  for (const note of notes) {
    page.drawText(note, {
      x: 50,
      y: noteY,
      size: 8.5,
      font,
      color: gray,
    });
    noteY -= 14;
  }

  /* ───────── PDF 바이너리 반환 ───────── */
  return pdfDoc.save();
}

/* ============ 숫자 → 한글 금액 변환 ============ */
function numberToKorean(num: number): string {
  if (num === 0) return "영";
  if (num < 0) return "마이너스 " + numberToKorean(-num);

  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const placeNames = ["", "십", "백", "천"];
  const units = ["", "만", "억", "조"];

  let result = "";
  let unitIdx = 0;
  let n = num;

  while (n > 0) {
    const chunk = n % 10000;
    if (chunk > 0) {
      let chunkStr = "";
      let temp = chunk;
      let placeIdx = 0;
      while (temp > 0) {
        const d = temp % 10;
        if (d > 0) {
          /* 자리수가 1일 때, 십/백/천 자리에서는 "일" 생략 (단, 일의 자리는 표시) */
          const dStr = d === 1 && placeIdx > 0 ? "" : digits[d];
          chunkStr = dStr + placeNames[placeIdx] + chunkStr;
        }
        temp = Math.floor(temp / 10);
        placeIdx++;
      }
      result = chunkStr + units[unitIdx] + result;
    }
    n = Math.floor(n / 10000);
    unitIdx++;
  }

  return result;
}