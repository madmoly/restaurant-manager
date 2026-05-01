// Excel/CSV → 마크다운 표 텍스트 변환 유틸 (정산표 OCR 대조용).
// 같은 Claude 정산표 프롬프트에 텍스트 모드로 보낼 수 있게 정규화.
//
// 동작:
//   1. file.arrayBuffer() → SheetJS workbook
//   2. 시트별 sheet_to_json({header:1}) → 2D array
//   3. 빈 행 / 공백 컬럼 제거
//   4. 마크다운 표 형식 (헤더 / 구분선 / 데이터)
//   5. 다중 시트면 "## 시트명" 헤더로 분리
//   6. 누적 길이가 임계 초과(추정 50k 토큰 ≈ 50KB 텍스트)면 첫 시트만 반환 + truncated=true

// xlsx는 dynamic import로 로드 (다른 페이지들과 청크 공유, CLAUDE.md §16 번들 분리 정책)
export interface SpreadsheetExtractResult {
  text: string;
  sheetCount: number;
  // 길이 초과로 일부 시트가 잘렸는지 여부
  truncated: boolean;
  truncatedSheetNames?: string[];
}

const MAX_TEXT_LENGTH = 50_000;

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // 마크다운 표 호환: 파이프/개행 escape
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function sheetToMarkdown(rows: unknown[][]): string {
  // 빈 행 제거
  const cleaned = rows
    .map((row) => row.map(escapeCell))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (cleaned.length === 0) return "";

  // 컬럼 수: 모든 행의 max
  const colCount = Math.max(...cleaned.map((r) => r.length));

  // 끝쪽 공백 컬럼 제거 (모든 행이 빈 컬럼인 컬럼만)
  let effectiveCols = colCount;
  while (effectiveCols > 0 && cleaned.every((r) => !r[effectiveCols - 1])) {
    effectiveCols--;
  }
  if (effectiveCols === 0) return "";

  const pad = (row: string[]) => {
    const out = row.slice(0, effectiveCols);
    while (out.length < effectiveCols) out.push("");
    return out;
  };

  const header = pad(cleaned[0]);
  const separator = Array(effectiveCols).fill("---");
  const body = cleaned.slice(1).map(pad);

  const formatRow = (row: string[]) => `| ${row.join(" | ")} |`;
  const lines = [formatRow(header), formatRow(separator), ...body.map(formatRow)];
  return lines.join("\n");
}

export async function spreadsheetToText(file: File): Promise<SpreadsheetExtractResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const sheetNames = wb.SheetNames;

  const parts: string[] = [];
  const truncatedSheetNames: string[] = [];
  let truncated = false;
  let totalLength = 0;

  for (let i = 0; i < sheetNames.length; i++) {
    const name = sheetNames[i];
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
    const md = sheetToMarkdown(rows as unknown[][]);
    if (!md) continue;

    const block = sheetNames.length > 1 ? `## ${name}\n\n${md}` : md;
    const projected = totalLength + block.length + 4;
    if (projected > MAX_TEXT_LENGTH && parts.length > 0) {
      // 이미 한 시트라도 들어간 상태에서 임계 초과 → 잔여 시트 truncate
      truncated = true;
      truncatedSheetNames.push(...sheetNames.slice(i));
      break;
    }
    if (block.length > MAX_TEXT_LENGTH) {
      // 단일 시트 자체가 임계 초과 → 잘라내고 truncated=true
      parts.push(block.slice(0, MAX_TEXT_LENGTH));
      truncated = true;
      truncatedSheetNames.push(name, ...sheetNames.slice(i + 1));
      break;
    }
    parts.push(block);
    totalLength = projected;
  }

  return {
    text: parts.join("\n\n"),
    sheetCount: sheetNames.length,
    truncated,
    truncatedSheetNames: truncated ? truncatedSheetNames : undefined,
  };
}

// 파일 확장자 기준 모드 판정
export function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return /\.(xlsx|xls|csv)$/i.test(name)
    || file.type === "text/csv"
    || file.type === "application/vnd.ms-excel"
    || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export function isImageOrPdfFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  if (file.type === "application/pdf") return true;
  return /\.(jpe?g|png|heic|heif|pdf)$/i.test(file.name);
}
