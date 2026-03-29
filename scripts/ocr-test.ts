/**
 * OCR 정확도 테스트 스크립트
 *
 * 사용법: Railway 서버에서 실행
 *   npx tsx scripts/ocr-test.ts <이미지_디렉토리_경로>
 *
 * 또는 단일 이미지 테스트:
 *   npx tsx scripts/ocr-test.ts --single <이미지_파일_경로>
 *
 * Google Drive에서 이미지를 다운로드한 후 서버에 업로드하여 테스트:
 *   1. 이미지를 uploads/ocr-test/ 디렉토리에 배치
 *   2. npx tsx scripts/ocr-test.ts uploads/ocr-test/
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

// ─── 설정 ────────────────────────────────────────────────────────────────────
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8192;

// ─── OCR 프롬프트 (server/ocr.ts와 동일) ────────────────────────────────────
const OCR_PROMPT = `이 이미지는 한국 식당/매장의 매입 전표입니다 (거래명세서, 영수증, 간이영수증, 수기전표, 배달정산서 등).

당신의 임무: 이미지에서 **거래처명**과 **품목별 숫자 데이터**를 정확하게 추출하여 JSON으로 출력하세요.

## 문서 구조 파악 가이드

**거래명세서 (표 형태):**
- 열 순서: 품목/규격 | 단위 | 수량 | 단가 | 공급가액 | 부가세 | 비고
- "공급가액" = 수량 × 단가 (이 열이 lineTotal)
- 부가세/비고 열은 무시
- 하단에 합계 행이 있음 (items에 넣지 말 것)

**영수증/간이영수증:**
- 보통 품명, 수량, 금액 순서
- 합계/총액 행은 items에 넣지 말 것

**수기전표:**
- 손글씨로 작성, 열 구분이 불명확할 수 있음
- 읽기 어려운 글씨는 uncertain: true

## 추출 규칙

1. **거래처명**: 문서 상단에서 공급자(판매자) 업체명을 찾으세요. 상호명 필드.
2. **각 품목별 추출:**
   - shortName: 핵심 품목명만 (예: "핫철리소스/CHOLIMEX/250g(250g*24ea)/막소" → "핫철리소스")
   - originalName: 이미지에 적힌 전체 품목/규격 텍스트 그대로
   - quantity: **수량 열의 숫자** (순수 숫자, 콤마 제거). 소수점 있으면 유지. 예: "6.000" → "6", "0.500" → "0.5"
   - unit: 단위 (EA, kg, 박스, 봉, 병, 판, 개 등)
   - unitPrice: **단가 열의 숫자** (순수 숫자, 콤마 제거). 예: "1,200" → "1200"
   - lineTotal: **공급가액/금액 열의 숫자** (순수 숫자, 콤마 제거). 예: "6,546" → "6546"
   - uncertain: 글씨가 불명확하거나 숫자 판독이 애매하면 true, 아니면 false

3. **숫자 정확도가 최우선입니다:**
   - 수량 열과 단가 열을 혼동하지 마세요
   - 공급가액 열과 부가세 열을 혼동하지 마세요
   - 거래명세서에서 "수량" 다음 열은 "단가", 그 다음이 "공급가액"
   - 수량×단가 ≠ 공급가액이면 → 공급가액(문서에 적힌 값)을 lineTotal로 사용하고 uncertain: true

4. **합계/소계/총합 행은 items에 포함하지 마세요.** 대신 summary에 넣으세요.

5. note: 문서에 특이 메모가 있으면 포함, 없으면 null

## 출력 형식 (순수 JSON만, 코드블록 없이):
{
  "counterpartyName": "거래처명 또는 null",
  "documentType": "거래명세서|영수증|간이영수증|수기전표|배달정산서|기타",
  "items": [
    {
      "shortName": "품목 축약명",
      "originalName": "이미지 원본 텍스트",
      "quantity": "수량(숫자)",
      "unit": "단위",
      "unitPrice": "단가(숫자)",
      "lineTotal": "공급가액(숫자)",
      "uncertain": false
    }
  ],
  "summary": {
    "totalSupply": "공급가액 합계(숫자) 또는 null",
    "totalTax": "부가세 합계(숫자) 또는 null",
    "grandTotal": "총합계(숫자) 또는 null"
  },
  "note": "비고 또는 null"
}`;

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────
function loadImageBase64(filePath: string): { base64: string; mediaType: string } {
  const imageBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  };
  return {
    base64: imageBuffer.toString("base64"),
    mediaType: mimeMap[ext] || "image/jpeg",
  };
}

function parseAIJson(raw: string): any {
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  else if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").trim();

  try { return JSON.parse(jsonStr); } catch {}

  const lastCompleteItem = jsonStr.lastIndexOf("}");
  if (lastCompleteItem > 0) {
    let truncated = jsonStr.substring(0, lastCompleteItem + 1);
    const openBrackets = (truncated.match(/\[/g) || []).length;
    const closeBrackets = (truncated.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) truncated += "]";
    const openBraces = (truncated.match(/\{/g) || []).length;
    const closeBraces = (truncated.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces - closeBraces; i++) truncated += "}";
    return JSON.parse(truncated);
  }

  throw new Error("JSON 파싱 불가: " + raw.substring(0, 200));
}

// ─── 단일 이미지 OCR 테스트 ──────────────────────────────────────────────────
interface OcrTestResult {
  file: string;
  success: boolean;
  counterpartyName: string | null;
  documentType: string | null;
  itemCount: number;
  items: any[];
  summary: any;
  uncertainCount: number;
  validationErrors: string[];
  processingTimeMs: number;
  rawResponse?: string;
  error?: string;
}

async function testSingleImage(
  anthropic: Anthropic,
  filePath: string
): Promise<OcrTestResult> {
  const fileName = path.basename(filePath);
  const startTime = Date.now();

  try {
    const { base64, mediaType } = loadImageBase64(filePath);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as any,
              data: base64,
            },
          },
          { type: "text", text: OCR_PROMPT },
        ],
      }],
    });

    const responseText = response.content.find(c => c.type === "text");
    if (!responseText || responseText.type !== "text") {
      return {
        file: fileName, success: false, counterpartyName: null, documentType: null,
        itemCount: 0, items: [], summary: null, uncertainCount: 0,
        validationErrors: ["AI 응답 없음"], processingTimeMs: Date.now() - startTime,
      };
    }

    const parsed = parseAIJson(responseText.text);
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    // ── 검증 ──────────────────────────────────────────────────────────
    const validationErrors: string[] = [];

    // 1. 거래처명 추출 확인
    if (!parsed.counterpartyName) {
      validationErrors.push("거래처명 미추출");
    }

    // 2. 품목 존재 확인
    if (items.length === 0) {
      validationErrors.push("품목 0개 (빈 결과)");
    }

    // 3. 각 품목별 수량×단가 = 공급가액 크로스체크
    items.forEach((item: any, idx: number) => {
      const qty = parseFloat(String(item.quantity || "").replace(/,/g, "")) || 0;
      const price = parseFloat(String(item.unitPrice || "").replace(/,/g, "")) || 0;
      const total = parseFloat(String(item.lineTotal || "").replace(/,/g, "")) || 0;

      if (qty > 0 && price > 0 && total > 0) {
        const calculated = Math.round(qty * price);
        const diff = Math.abs(total - calculated);
        if (diff > 1 && diff / Math.max(total, calculated) > 0.02) {
          validationErrors.push(
            `품목[${idx}] "${item.shortName}": qty(${qty})×price(${price})=${calculated} ≠ lineTotal(${total}), 차이=${diff}`
          );
        }
      }

      // 핵심 필드 누락
      if (!item.shortName && !item.originalName) {
        validationErrors.push(`품목[${idx}]: 품명 누락`);
      }
      if (!item.quantity && !item.lineTotal) {
        validationErrors.push(`품목[${idx}] "${item.shortName}": 수량+금액 모두 누락`);
      }
    });

    // 4. 합계 크로스체크
    if (parsed.summary) {
      const docTotal = parseFloat(String(parsed.summary.totalSupply || parsed.summary.grandTotal || "").replace(/,/g, "")) || 0;
      if (docTotal > 0 && items.length > 0) {
        const itemSum = items.reduce((sum: number, it: any) =>
          sum + (parseFloat(String(it.lineTotal || "").replace(/,/g, "")) || 0), 0
        );
        const totalDiff = Math.abs(itemSum - docTotal);
        if (totalDiff > 100 && totalDiff / docTotal > 0.05) {
          validationErrors.push(
            `합계 불일치: 품목합산=${itemSum}, 문서합계=${docTotal}, 차이율=${(totalDiff/docTotal*100).toFixed(1)}%`
          );
        }
      }
    }

    const uncertainCount = items.filter((i: any) => i.uncertain === true).length;

    return {
      file: fileName,
      success: true,
      counterpartyName: parsed.counterpartyName || null,
      documentType: parsed.documentType || null,
      itemCount: items.length,
      items,
      summary: parsed.summary || null,
      uncertainCount,
      validationErrors,
      processingTimeMs: Date.now() - startTime,
      rawResponse: responseText.text,
    };
  } catch (err: any) {
    return {
      file: fileName, success: false, counterpartyName: null, documentType: null,
      itemCount: 0, items: [], summary: null, uncertainCount: 0,
      validationErrors: [err.message], processingTimeMs: Date.now() - startTime,
      error: err.message,
    };
  }
}

// ─── 리포트 생성 ─────────────────────────────────────────────────────────────
function generateReport(results: OcrTestResult[]): string {
  const total = results.length;
  const successful = results.filter(r => r.success).length;
  const withErrors = results.filter(r => r.validationErrors.length > 0).length;
  const totalItems = results.reduce((s, r) => s + r.itemCount, 0);
  const totalUncertain = results.reduce((s, r) => s + r.uncertainCount, 0);
  const avgTime = results.reduce((s, r) => s + r.processingTimeMs, 0) / total;
  const counterpartyDetected = results.filter(r => r.counterpartyName).length;

  let report = `
═══════════════════════════════════════════════════════════════
  OCR 정확도 테스트 리포트
  테스트 시각: ${new Date().toISOString()}
  모델: ${MODEL}
═══════════════════════════════════════════════════════════════

📊 요약
  - 테스트 이미지: ${total}장
  - API 호출 성공: ${successful}/${total} (${(successful/total*100).toFixed(0)}%)
  - 검증 오류 있는 이미지: ${withErrors}/${total} (${(withErrors/total*100).toFixed(0)}%)
  - 총 추출 품목: ${totalItems}개
  - uncertain 마킹 품목: ${totalUncertain}개 (${totalItems > 0 ? (totalUncertain/totalItems*100).toFixed(1) : 0}%)
  - 거래처명 탐지: ${counterpartyDetected}/${total} (${(counterpartyDetected/total*100).toFixed(0)}%)
  - 평균 처리 시간: ${(avgTime/1000).toFixed(1)}초

───────────────────────────────────────────────────────────────
📋 이미지별 상세 결과
───────────────────────────────────────────────────────────────
`;

  results.forEach((r, idx) => {
    const status = r.success
      ? (r.validationErrors.length === 0 ? "✅ PASS" : "⚠️ WARN")
      : "❌ FAIL";

    report += `
[${idx + 1}] ${r.file} — ${status}
  거래처: ${r.counterpartyName || "(미탐지)"}
  문서유형: ${r.documentType || "(미분류)"}
  품목: ${r.itemCount}개 (uncertain: ${r.uncertainCount}개)
  처리시간: ${(r.processingTimeMs/1000).toFixed(1)}초
`;

    if (r.items.length > 0) {
      report += `  품목 목록:\n`;
      r.items.forEach((item: any, i: number) => {
        const flag = item.uncertain ? " [?]" : "";
        report += `    ${i+1}. ${item.shortName}${flag} — 수량:${item.quantity} ${item.unit}, 단가:${item.unitPrice}, 금액:${item.lineTotal}\n`;
      });
    }

    if (r.validationErrors.length > 0) {
      report += `  ⚠ 검증 오류:\n`;
      r.validationErrors.forEach(e => {
        report += `    - ${e}\n`;
      });
    }

    if (r.summary) {
      report += `  합계: 공급가액=${r.summary.totalSupply || "?"}, 부가세=${r.summary.totalTax || "?"}, 총합=${r.summary.grandTotal || "?"}\n`;
    }
  });

  // ── 오류 패턴 분석 ──────────────────────────────────────────────
  const allErrors = results.flatMap(r => r.validationErrors);
  const errorPatterns: Record<string, number> = {};
  allErrors.forEach(e => {
    if (e.includes("거래처명 미추출")) errorPatterns["거래처명 미추출"] = (errorPatterns["거래처명 미추출"] || 0) + 1;
    else if (e.includes("품목 0개")) errorPatterns["품목 0개 (빈 결과)"] = (errorPatterns["품목 0개 (빈 결과)"] || 0) + 1;
    else if (e.includes("≠ lineTotal")) errorPatterns["수량×단가 ≠ 공급가액"] = (errorPatterns["수량×단가 ≠ 공급가액"] || 0) + 1;
    else if (e.includes("합계 불일치")) errorPatterns["품목합산 ≠ 문서합계"] = (errorPatterns["품목합산 ≠ 문서합계"] || 0) + 1;
    else if (e.includes("품명 누락")) errorPatterns["품명 누락"] = (errorPatterns["품명 누락"] || 0) + 1;
    else errorPatterns["기타"] = (errorPatterns["기타"] || 0) + 1;
  });

  if (Object.keys(errorPatterns).length > 0) {
    report += `
───────────────────────────────────────────────────────────────
📉 오류 패턴 분석
───────────────────────────────────────────────────────────────
`;
    Object.entries(errorPatterns)
      .sort(([,a], [,b]) => b - a)
      .forEach(([pattern, count]) => {
        report += `  ${pattern}: ${count}건\n`;
      });
  }

  return report;
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("사용법:");
    console.log("  npx tsx scripts/ocr-test.ts <이미지_디렉토리>");
    console.log("  npx tsx scripts/ocr-test.ts --single <이미지_파일>");
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey });
  const isSingle = args[0] === "--single";
  const targetPath = isSingle ? args[1] : args[0];

  if (!targetPath || !fs.existsSync(targetPath)) {
    console.error(`경로를 찾을 수 없습니다: ${targetPath}`);
    process.exit(1);
  }

  let imageFiles: string[];

  if (isSingle) {
    imageFiles = [targetPath];
  } else {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      console.error(`디렉토리가 아닙니다: ${targetPath}`);
      process.exit(1);
    }
    imageFiles = fs.readdirSync(targetPath)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort()
      .map(f => path.join(targetPath, f));
  }

  console.log(`\n🔍 OCR 테스트 시작: ${imageFiles.length}개 이미지\n`);

  const results: OcrTestResult[] = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const filePath = imageFiles[i];
    const fileName = path.basename(filePath);
    console.log(`[${i + 1}/${imageFiles.length}] ${fileName} 처리 중...`);

    const result = await testSingleImage(anthropic, filePath);
    results.push(result);

    const status = result.success
      ? (result.validationErrors.length === 0 ? "✅" : `⚠️ (${result.validationErrors.length}건)`)
      : "❌";
    console.log(`  → ${status} ${result.itemCount}개 품목, ${(result.processingTimeMs/1000).toFixed(1)}초`);

    // Rate limit 방지: 2초 대기
    if (i < imageFiles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // ── 리포트 생성 & 저장 ──────────────────────────────────────────
  const report = generateReport(results);
  console.log(report);

  // JSON 결과 저장
  const outputDir = path.join(process.cwd(), "scripts");
  const jsonPath = path.join(outputDir, "ocr-test-results.json");
  const reportPath = path.join(outputDir, "ocr-test-report.txt");

  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(reportPath, report);

  console.log(`\n📁 결과 저장됨:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  리포트: ${reportPath}`);
}

main().catch(err => {
  console.error("테스트 실행 오류:", err);
  process.exit(1);
});
