/**
 * SIREN — 지출결의서 PDF 생성 (배치2·2026-07-01)
 * - pdf-lib + @pdf-lib/fontkit, NotoSansKR 임베딩(subset:false), A4 1장
 * - 최종 승인 시 admin-approval-decide에서 호출 → uploadToR2로 R2 박제
 */
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const fontPath = join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf");
    const buf = readFileSync(fontPath);
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array(_fontCache.slice(0));
}

export interface ResolutionStep { roleLabel: string; name: string; date: string; }
export interface ResolutionPdfData {
  resolutionNo: string;
  title: string;
  amount: number;
  budgetPath?: string;
  payeeName?: string;
  occurredAt?: string;
  description?: string;
  drafterName?: string;
  createdAt?: string;
  steps: ResolutionStep[];
  orgName?: string;
}

const KRW = (n: number) => (Number(n) || 0).toLocaleString("ko-KR") + "원";
const D = (s?: string) => (s ? String(s).slice(0, 10) : "");

export async function generateResolutionPDF(data: ResolutionPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(loadKoreanFont(), { subset: false });
  const page = pdf.addPage([595, 842]); // A4
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.55, 0.55, 0.55);
  const lineC = rgb(0.2, 0.2, 0.2);
  const headBg = rgb(0.95, 0.95, 0.95);

  const M = 45;
  const W = 595 - M * 2;
  let y = 842 - 60;

  /* ⚠️ 이 한글 폰트를 통째로 임베드(subset:false)하면 글자별 폭(/W)이 실리지 않아
     page.drawText(문장)이 숫자·공백을 전각(1em)으로 벌려 → 본문 표 밖으로 넘쳐 잘린다.
     글자별로 직접 배치(drawRun)하면 폭 계산(widthOfTextAtSize)과 렌더가 일치해 넘침이 사라진다.
     (급여 PDF lib/payroll-pdf.ts 와 동일한 우회) */
  const drawRun = (s: string, x: number, yy: number, size: number, color: any) => {
    let cx = x;
    for (const ch of Array.from(String(s ?? ""))) {
      const w = font.widthOfTextAtSize(ch, size);
      if (ch.trim()) page.drawText(ch, { x: cx, y: yy, size, font, color });
      cx += w;
    }
  };
  const text = (s: string, x: number, yy: number, size = 11, color = black) =>
    drawRun(s, x, yy, size, color);
  const rect = (x: number, yy: number, w: number, h: number, fill?: any) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: lineC, borderWidth: 0.8, color: fill });
  const center = (s: string, cx: number, yy: number, size = 11, color = black) => {
    const tw = font.widthOfTextAtSize(String(s ?? ""), size);
    drawRun(s, cx - tw / 2, yy, size, color);
  };

  // 제목
  page.drawRectangle({ x: M, y: y - 8, width: W, height: 40, borderColor: lineC, borderWidth: 2 });
  center("지 출 결 의 서", 595 / 2, y + 6, 22);
  y -= 24;
  const noW = font.widthOfTextAtSize(data.resolutionNo, 11);
  text(data.resolutionNo, M + W - noW, y, 11, gray);
  y -= 20;

  // 결재란
  const steps = data.steps && data.steps.length ? data.steps : [{ roleLabel: "결재", name: "", date: "" }];
  const cellW = Math.min(90, W / (steps.length + 0.0));
  const boxH = 66;
  const tableW = cellW * steps.length;
  const startX = M + W - tableW;
  rect(startX, y - boxH, tableW, 16, headBg);
  center("결      재", startX + tableW / 2, y - 12, 10, gray);
  for (let i = 0; i < steps.length; i++) {
    const cx = startX + cellW * i;
    rect(cx, y - boxH, cellW, boxH - 16);
    center(steps[i].roleLabel, cx + cellW / 2, y - 30, 9, gray);
    center(steps[i].name || "", cx + cellW / 2, y - 48, 11);
    center(steps[i].date ? D(steps[i].date) : "", cx + cellW / 2, y - 62, 7, gray);
  }
  y -= boxH + 22;

  // 본문 표
  const labelW = 90;
  const row = (label: string, value: string, h = 26, valSize = 11) => {
    rect(M, y - h, labelW, h, headBg);
    center(label, M + labelW / 2, y - h + (h / 2) - 4, 10, gray);
    rect(M + labelW, y - h, W - labelW, h);
    text(value, M + labelW + 10, y - h + (h / 2) - 4, valSize);
    y -= h;
  };
  const row2 = (l1: string, v1: string, l2: string, v2: string, h = 26) => {
    const half = W / 2;
    rect(M, y - h, labelW, h, headBg); center(l1, M + labelW / 2, y - h + h / 2 - 4, 10, gray);
    rect(M + labelW, y - h, half - labelW, h); text(v1, M + labelW + 8, y - h + h / 2 - 4, 11);
    rect(M + half, y - h, labelW, h, headBg); center(l2, M + half + labelW / 2, y - h + h / 2 - 4, 10, gray);
    rect(M + half + labelW, y - h, half - labelW, h); text(v2, M + half + labelW + 8, y - h + h / 2 - 4, 11);
    y -= h;
  };

  row2("지출일자", D(data.occurredAt), "금    액", KRW(data.amount));
  row2("예산과목", data.budgetPath || "", "지 급 처", data.payeeName || "");
  row("적    요", data.title || "");
  // 내용(멀티라인 박스)
  const contentH = 110;
  rect(M, y - contentH, labelW, contentH, headBg);
  center("내    용", M + labelW / 2, y - contentH / 2 - 4, 10, gray);
  rect(M + labelW, y - contentH, W - labelW, contentH);
  const desc = String(data.description || "").slice(0, 500);
  const maxCharW = W - labelW - 20;
  const lines: string[] = [];
  desc.split(/\n/).forEach((para) => {
    let cur = "";
    for (const ch of para) {
      if (font.widthOfTextAtSize(cur + ch, 10) > maxCharW) { lines.push(cur); cur = ch; }
      else cur += ch;
    }
    lines.push(cur);
  });
  let ty = y - 18;
  for (const ln of lines.slice(0, 8)) { text(ln, M + labelW + 10, ty, 10); ty -= 14; }
  y -= contentH;
  row2("기 안 자", data.drafterName || "", "기 안 일", D(data.createdAt));

  y -= 34;
  center("위와 같이 지출을 결의합니다.", 595 / 2, y, 12);
  y -= 30;
  center(data.orgName || "(사)교사유가족협의회", 595 / 2, y, 14);

  return await pdf.save();
}
