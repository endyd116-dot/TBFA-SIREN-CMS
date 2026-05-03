// lib/csv-export.ts
// ★ Phase M-12: CSV 생성 헬퍼 (UTF-8 BOM + Excel 호환)

/* CSV 셀 이스케이프 */
function escapeCell(v: any): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  /* 줄바꿈/콤마/큰따옴표 포함 시 큰따옴표로 감싸고, 안의 큰따옴표는 두 번 */
  if (/[",\r\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 객체 배열을 CSV 문자열로 변환
 * @param rows  데이터 행 배열
 * @param columns  [{ key, label }] 컬럼 정의
 * @param options.bom  UTF-8 BOM 추가 (Excel 한글 인식용, 기본 true)
 */
export function buildCSV<T = any>(
  rows: T[],
  columns: Array<{ key: keyof T | string; label: string }>,
  options: { bom?: boolean } = {},
): string {
  const bom = options.bom !== false;
  const header = columns.map((c) => escapeCell(c.label)).join(",");
  const body = rows.map((row: any) =>
    columns.map((c) => escapeCell(row[c.key as any])).join(","),
  ).join("\r\n");

  const csv = header + "\r\n" + body;
  return bom ? "\uFEFF" + csv : csv;
}

/**
 * CSV 응답 Response 생성
 */
export function csvResponse(csv: string, filename: string): Response {
  const safeName = encodeURIComponent(filename);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`,
      "Cache-Control": "no-store",
    },
  });
}