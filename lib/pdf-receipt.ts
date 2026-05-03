/**
 * SIREN — PDF 기부금 영수증 생성 (★ M-14: 직인 이미지 삽입 추가)
 *
 * - pdf-lib + @pdf-lib/fontkit 사용
 * - assets/fonts/NotoSansKR-Regular.ttf 임베딩 (subset: false)
 * - A4 (595 x 842 pt) 1장
 * - ★ M-14: 관리자가 업로드한 직인 이미지를 R2에서 가져와 PDF에 삽입
 *   * 직인 미설정 시 기존처럼 빨간 원형 표식 표시
 */
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, receiptSettings } from "../db";
import { blobUploads } from "../db/schema";
import { downloadFromR2 } from "./r2-server";

/* ============ 폰트 캐싱 ============ */
let _fontCache: ArrayBuffer | null = null;

function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const fontPath = join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf");
    const buf = readFileSync(fontPath);
    _fontCache = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    );
  }
  return new Uint8Array(_fontCache.slice(0));
}

/* ============ 영수증 설정 + 직인 조회 ============ */
interface ReceiptSettingsResolved {
  orgName: string;
  orgRegistrationNo: string;
  orgRepresentative: string;
  orgAddress: string;
  orgPhone: string;
  title: string;
  subtitle: string;
  proofText: string;
  donationTypeLabel: string;
  footerNotes: string[];
  /* ★ M-14 */
  stampBlobId: number | null;
  stampBlobKey: string | null;
  stampMimeType: string | null;
}

async function getReceiptSettings(): Promise<ReceiptSettingsResolved> {
  const envOrgName = process.env.ORG_NAME || "(샘플) 교사유가족협의회";
  const envOrgRegNo = process.env.ORG_REGISTRATION_NO || "000-00-00000";
  const envOrgRep = process.env.ORG_REPRESENTATIVE || "○○○";
  const envOrgAddr = process.env.ORG_ADDRESS || "(샘플) 서울특별시 ○○구 ○○로 ○○";
  const envOrgPhone = process.env.ORG_PHONE || "(샘플) 02-0000-0000";

  const defaultTitle = "기 부 금  영 수 증";
  const defaultSubtitle = "(소득세법 시행규칙 별지 제45호의2 서식)";
  const defaultProofText = "위와 같이 기부금을 기부하였음을 증명합니다.";
  const defaultDonationLabel = "지정기부금";
  const defaultFooter: string[] = [
    "• 본 영수증은 「소득세법」 제34조 및 「법인세법」 제24조에 따른 기부금 영수증입니다.",
    "• 본 영수증은 발급기관에서 전자 발급되었으며, 영수증 번호로 진위를 확인할 수 있습니다.",
    `• 문의: ${envOrgPhone} / ${envOrgName}`,
  ];

  try {
    const [row] = await db
      .select()
      .from(receiptSettings)
      .where(eq(receiptSettings.id, 1))
      .limit(1);

    if (row) {
      const r = row as any;
      let footerNotes: string[] = defaultFooter;
      if (r.footerNotes) {
        try {
          const parsed = JSON.parse(r.footerNotes);
          if (Array.isArray(parsed) && parsed.length > 0) {
            footerNotes = parsed.map((s: any) => String(s));
          }
        } catch {}
      }

      /* ★ M-14: 직인 BLOB 키 조회 */
      let stampBlobKey: string | null = null;
      let stampMimeType: string | null = null;
      const stampBlobId = r.stampBlobId || null;
      if (stampBlobId) {
        try {
          const [b] = await db
            .select({ blobKey: blobUploads.blobKey, mimeType: blobUploads.mimeType })
            .from(blobUploads)
            .where(eq(blobUploads.id, stampBlobId))
            .limit(1);
          if (b) {
            stampBlobKey = (b as any).blobKey;
            stampMimeType = (b as any).mimeType;
          }
        } catch (e) {
          console.warn("[pdf-receipt] 직인 BLOB 조회 실패:", e);
        }
      }

      return {
        orgName: r.orgName || envOrgName,
        orgRegistrationNo: r.orgRegistrationNo || envOrgRegNo,
        orgRepresentative: r.orgRepresentative || envOrgRep,
        orgAddress: r.orgAddress || envOrgAddr,
        orgPhone: r.orgPhone || envOrgPhone,
        title: r.title || defaultTitle,
        subtitle: r.subtitle || defaultSubtitle,
        proofText: r.proofText || defaultProofText,
        donationTypeLabel: r.donationTypeLabel || defaultDonationLabel,
        footerNotes,
        stampBlobId,
        stampBlobKey,
        stampMimeType,
      };
    }
  } catch (e) {
    console.warn("[pdf-receipt] receipt_settings 조회 실패, 환경변수 폴백:", e);
  }

  return {
    orgName: envOrgName,
    orgRegistrationNo: envOrgRegNo,
    orgRepresentative: envOrgRep,
    orgAddress: envOrgAddr,
    orgPhone: envOrgPhone,
    title: defaultTitle,
    subtitle: defaultSubtitle,
    proofText: defaultProofText,
    donationTypeLabel: defaultDonationLabel,
    footerNotes: defaultFooter,
    stampBlobId: null,
    stampBlobKey: null,
    stampMimeType: null,
  };
}

/* ============ 영수증 데이터 인터페이스 ============ */
export interface ReceiptData {
  receiptNumber: string;
  donorName: string;
  donorEmail?: string | null;
  donorPhone?: string | null;
  amount: number;
  donationDate: Date;
  payMethod: string;
  donationType: string;
}

/* ============ 메인 함수: PDF 바이너리 생성 ============ */
export async function generateReceiptPDF(data: ReceiptData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);

  /* 한글 폰트 임베딩 */
  const fontBytes = loadKoreanFont();
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });

  /* 영수증 설정 (DB 우선) */
  const settings = await getReceiptSettings();

  /* ★ M-14: 직인 이미지 임베딩 (있으면) */
  let stampImage: any = null;
  if (settings.stampBlobKey) {
    try {
      const imgBytes = await downloadFromR2(settings.stampBlobKey);
      if (imgBytes && imgBytes.length > 0) {
        const mime = (settings.stampMimeType || "").toLowerCase();
        if (mime.includes("png")) {
          stampImage = await pdfDoc.embedPng(imgBytes);
        } else if (mime.includes("jpeg") || mime.includes("jpg")) {
          stampImage = await pdfDoc.embedJpg(imgBytes);
        } else {
          /* MIME 모를 때 PNG 우선 시도 → JPG 폴백 */
          try {
            stampImage = await pdfDoc.embedPng(imgBytes);
          } catch {
            try { stampImage = await pdfDoc.embedJpg(imgBytes); }
            catch (e2) { console.warn("[pdf-receipt] 직인 이미지 형식 인식 실패"); }
          }
        }
      }
    } catch (e) {
      console.warn("[pdf-receipt] 직인 이미지 임베딩 실패:", e);
    }
  }

  /* A4 1장 추가 */
  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();

  /* 색상 정의 */
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const lightGray = rgb(0.92, 0.92, 0.92);
  const lineColor = rgb(0.2, 0.2, 0.2);
  const stampRed = rgb(0.7, 0.05, 0.1);

  /* ───────── 제목 ───────── */
  const title = settings.title;
  const titleSize = 22;
  const titleWidth = font.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (width - titleWidth) / 2,
    y: height - 80,
    size: titleSize,
    font,
    color: black,
  });

  const subtitle = settings.subtitle;
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
    x: 50, y: height - 140, size: 11, font, color: black,
  });

  const issueDate = new Date();
  const issueDateStr = `발급일: ${issueDate.getFullYear()}년 ${issueDate.getMonth() + 1}월 ${issueDate.getDate()}일`;
  const issueDateWidth = font.widthOfTextAtSize(issueDateStr, 11);
  page.drawText(issueDateStr, {
    x: width - 50 - issueDateWidth, y: height - 140, size: 11, font, color: black,
  });

  let y = height - 165;
  page.drawLine({
    start: { x: 50, y }, end: { x: width - 50, y },
    thickness: 1.5, color: lineColor,
  });

  /* 헬퍼 */
  function drawLabelValue(label: string, value: string, x: number, yPos: number, labelW: number, valueW: number) {
    page.drawRectangle({
      x, y: yPos - 25, width: labelW, height: 25,
      color: lightGray, borderColor: lineColor, borderWidth: 0.8,
    });
    page.drawRectangle({
      x: x + labelW, y: yPos - 25, width: valueW, height: 25,
      borderColor: lineColor, borderWidth: 0.8,
    });
    page.drawText(label, { x: x + 8, y: yPos - 17, size: 10, font, color: black });
    const maxValueLen = Math.floor(valueW / 6);
    const displayValue = value.length > maxValueLen ? value.slice(0, maxValueLen - 2) + ".." : value;
    page.drawText(displayValue, { x: x + labelW + 8, y: yPos - 17, size: 10, font, color: black });
  }

  /* ① 기부자 정보 */
  y -= 25;
  page.drawText("① 기부자 정보", { x: 50, y, size: 12, font, color: black });
  y -= 8;
  drawLabelValue("성명", data.donorName, 50, y, 70, 210);
  drawLabelValue("연락처", data.donorPhone || "-", 330, y, 70, 165);
  y -= 25;
  drawLabelValue("이메일", data.donorEmail || "-", 50, y, 70, 445);

  /* ② 기부단체 정보 */
  y -= 40;
  page.drawText("② 기부단체 정보", { x: 50, y, size: 12, font, color: black });
  y -= 8;
  drawLabelValue("단체명", settings.orgName, 50, y, 70, 425);
  y -= 25;
  drawLabelValue("고유번호", settings.orgRegistrationNo, 50, y, 70, 210);
  drawLabelValue("대표자", settings.orgRepresentative, 330, y, 70, 165);
  y -= 25;
  drawLabelValue("주소", settings.orgAddress, 50, y, 70, 425);
  y -= 25;
  drawLabelValue("연락처", settings.orgPhone, 50, y, 70, 425);

  /* ③ 기부 내역 */
  y -= 40;
  page.drawText("③ 기부 내역", { x: 50, y, size: 12, font, color: black });
  y -= 8;
  const donDateStr = `${data.donationDate.getFullYear()}년 ${data.donationDate.getMonth() + 1}월 ${data.donationDate.getDate()}일`;
  drawLabelValue("기부일자", donDateStr, 50, y, 70, 210);
  drawLabelValue("기부유형", data.donationType === "regular" ? "정기후원" : "일시후원", 330, y, 70, 165);
  y -= 25;
  const amountStr = `₩ ${data.amount.toLocaleString()} (금 ${numberToKorean(data.amount)} 원정)`;
  drawLabelValue("기부금액", amountStr, 50, y, 70, 425);
  y -= 25;
  const payMap: Record<string, string> = { card: "신용카드", bank: "계좌이체", cms: "자동이체(CMS)" };
  drawLabelValue("결제방법", payMap[data.payMethod] || data.payMethod, 50, y, 70, 210);
  drawLabelValue("기부금구분", settings.donationTypeLabel, 330, y, 70, 165);

  /* 증명 문구 */
  y -= 60;
  const proofText = settings.proofText;
  const proofWidth = font.widthOfTextAtSize(proofText, 12);
  page.drawText(proofText, { x: (width - proofWidth) / 2, y, size: 12, font, color: black });

  /* 발급 단체명 + 직인 */
  y -= 50;
  const orgLine = settings.orgName;
  const orgLineSize = 14;
  const orgWidth = font.widthOfTextAtSize(orgLine, orgLineSize);
  const orgX = (width - orgWidth) / 2 - 25;
  page.drawText(orgLine, { x: orgX, y, size: orgLineSize, font, color: black });

  /* ★ M-14: 직인 이미지가 있으면 삽입, 없으면 빨간 원형 표식 */
  const stampCenterX = orgX + orgWidth + 35;
  const stampCenterY = y + 5;

  if (stampImage) {
    /* 직인 이미지 그리기 (60x60 픽셀 박스에 맞춤) */
    const stampSize = 55;
    const stampDrawX = stampCenterX - stampSize / 2;
    const stampDrawY = stampCenterY - stampSize / 2;

    /* 비율 유지 */
    const imgW = stampImage.width;
    const imgH = stampImage.height;
    const ratio = Math.min(stampSize / imgW, stampSize / imgH);
    const drawW = imgW * ratio;
    const drawH = imgH * ratio;

    page.drawImage(stampImage, {
      x: stampCenterX - drawW / 2,
      y: stampCenterY - drawH / 2,
      width: drawW,
      height: drawH,
      opacity: 0.95,
    });
  } else {
    /* 직인 미설정 — 기존 빨간 원형 표식 */
    page.drawCircle({
      x: stampCenterX, y: stampCenterY, size: 22,
      borderColor: stampRed, borderWidth: 1.2,
    });
    const stampText = "직인";
    const stampTextSize = 9;
    const stampTextWidth = font.widthOfTextAtSize(stampText, stampTextSize);
    page.drawText(stampText, {
      x: stampCenterX - stampTextWidth / 2,
      y: stampCenterY - 3,
      size: stampTextSize,
      font,
      color: stampRed,
    });
  }

  /* 하단 안내 */
  page.drawLine({
    start: { x: 50, y: 120 }, end: { x: width - 50, y: 120 },
    thickness: 0.5, color: gray,
  });

  let noteY = 100;
  for (const note of settings.footerNotes) {
    page.drawText(note, { x: 50, y: noteY, size: 8.5, font, color: gray });
    noteY -= 14;
    if (noteY < 30) break;
  }

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