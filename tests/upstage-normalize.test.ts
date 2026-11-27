/**
 * Upstage 표 정규화 테스트 — 전체 페이지 촬영 시 하단 합계영역이 품목 격자를 오염시키는 케이스
 *
 * 재현 근거: 월푸상사(주) 거래명세표(0855) 2026-11-02.
 * 표 상단만 촬영 → 7열 깨끗한 격자 → 판독 성공.
 * 전체 페이지 촬영 → 하단 "①직전미수금 | ①+②합계 | ② | 공급가액 | 부가세" 칸 경계가 품목 열과 어긋나
 *   격자가 합집합으로 쪼개지고 품목 행에 colspan이 붙음 + 빈 행 20여 개 → 열 밀림.
 */
import { describe, it, expect } from "vitest";
import { normalizeTableHtml, buildClaudeContext, type UpstageParseResult } from "../server/ocr-engines/upstage";

// 합집합 격자: 품목 열이 3칸(0~2), 단위(3), 수량(4~5), 단가(6), 공급가액(7), 부가세(8), 비고(9)
const UNION_GRID = `<table>
<tr><td colspan='3'>품목 / 규격</td><td>단위</td><td colspan='2'>수 량</td><td>단 가</td><td>공급가액</td><td>부가세</td><td>비 고</td></tr>
<tr><td colspan='3'>까나리액젓/하선정/3kg(3kg)</td><td>EA</td><td colspan='2'>1.000</td><td>14,260</td><td>12,964</td><td>1,296</td><td></td></tr>
<tr><td colspan='3'>백합/냉동/1kg(1kg*5개/박스)</td><td>팩</td><td colspan='2'>10.000</td><td>5,200</td><td>52,000</td><td></td><td></td></tr>
<tr><td colspan='3'>두백감자/kg(kg/면세)</td><td>kg</td><td colspan='2'>10.000</td><td>2,870</td><td>28,700</td><td></td><td></td></tr>
<tr><td colspan='3'></td><td></td><td colspan='2'></td><td></td><td></td><td></td><td></td></tr>
<tr><td colspan='3'></td><td></td><td colspan='2'></td><td></td><td></td><td></td><td></td></tr>
<tr><td>①직전<br>미수금</td><td>18,730,211</td><td>①+②합계</td><td colspan='2'>19,204,461</td><td>②</td><td>474,250</td><td>443,143</td><td>31,107</td><td></td></tr>
<tr><td>당일<br>수금액</td><td></td><td>총미수금</td><td colspan='2'></td><td>인계자</td><td>인</td><td>인수자</td><td colspan='2'>인</td></tr>
<tr><td colspan='10'>공지사항 월푸상사 입금 계좌번호</td></tr>
</table>`;

describe("normalizeTableHtml", () => {
  const n = normalizeTableHtml(UNION_GRID);

  it("품목 표로 판정하고 헤더 7열로 재정렬한다", () => {
    expect(n.kind).toBe("items");
    expect(n.headerLabels).toEqual(["품목 / 규격", "단위", "수 량", "단 가", "공급가액", "부가세", "비 고"]);
    expect(n.hadSpans).toBe(true);
  });

  it("품목 행은 헤더 열에 1:1로 매핑된다 (면세 행 열 밀림 없음)", () => {
    const rows = (n.html!.match(/<tr>[\s\S]*?<\/tr>/g) ?? []).slice(1);
    const cells = rows.map((r) => (r.match(/<td>([\s\S]*?)<\/td>/g) ?? []).map((c) => c.replace(/<\/?td>/g, "")));
    expect(cells).toEqual([
      ["까나리액젓/하선정/3kg(3kg)", "EA", "1.000", "14,260", "12,964", "1,296", ""],
      ["백합/냉동/1kg(1kg*5개/박스)", "팩", "10.000", "5,200", "52,000", "", ""],
      ["두백감자/kg(kg/면세)", "kg", "10.000", "2,870", "28,700", "", ""],
    ]);
    expect(n.bodyRowCount).toBe(3);
    expect(n.droppedEmptyRows).toBe(2);
  });

  it("하단 미수금/합계/서명/공지 영역은 품목에서 분리된다", () => {
    expect(n.footerLines.length).toBe(3);
    expect(n.footerLines[0]).toContain("19,204,461");
    expect(n.footerLines[0]).toContain("474,250");
    expect(n.html).not.toContain("18,730,211");
  });

  it("일자별 소계 행 뒤의 품목은 버리지 않는다", () => {
    const html = `<table>
<tr><td>월일</td><td>품목</td><td>수량</td><td>단가</td><td>금액</td></tr>
<tr><td>11/01</td><td>양파</td><td>1</td><td>21,000</td><td>21,000</td></tr>
<tr><td></td><td>소계</td><td></td><td></td><td>21,000</td></tr>
<tr><td>11/02</td><td>대파</td><td>2</td><td>3,000</td><td>6,000</td></tr>
</table>`;
    const r = normalizeTableHtml(html);
    expect(r.bodyRowCount).toBe(2);
    expect(r.html).toContain("대파");
    expect(r.footerLines).toEqual(["소계 | 21,000"]);
  });

  it("rowspan으로 이어지는 칸은 값을 중복하지 않는다", () => {
    const html = `<table>
<tr><td>품목</td><td>수량</td><td>단가</td><td>비고</td></tr>
<tr><td>양파</td><td>1</td><td>21,000</td><td rowspan='2'>메모</td></tr>
<tr><td>대파</td><td>2</td><td>3,000</td></tr>
</table>`;
    const r = normalizeTableHtml(html);
    const rows = (r.html!.match(/<tr>[\s\S]*?<\/tr>/g) ?? []).slice(1);
    expect(rows[1]).toBe("<tr><td>대파</td><td>2</td><td>3,000</td><td></td></tr>");
  });

  it("헤더가 없는 표는 other로 처리", () => {
    const r = normalizeTableHtml(`<table><tr><td>등록번호</td><td>215-87-14280</td></tr></table>`);
    expect(r.kind).toBe("other");
    expect(r.preLines).toEqual(["등록번호 | 215-87-14280"]);
  });
});

describe("buildClaudeContext", () => {
  const parsed: UpstageParseResult = {
    ok: true,
    raw: {} as any,
    markdown: "# 거래명세표\n2026년11월02일 (월)\n| 품목 | 단위 |\n|---|---|\n| x | y |\n<table><tr><td>dup</td></tr></table>",
    tablesHtml: [`<table><tr><td>상호</td><td>월푸상사(주)</td></tr></table>`, UNION_GRID],
    paragraphs: [],
    pages: 1,
    elapsedMs: 0,
  };
  const ctx = buildClaudeContext(parsed);

  it("정규화 품목표 + 하단영역 + 표 제거된 markdown으로 구성", () => {
    expect(ctx).toContain("## 품목 표");
    expect(ctx).toContain("## 하단 합계/미수금");
    expect(ctx).toContain("월푸상사(주)");
    expect(ctx).toContain("2026년11월02일");
    expect(ctx).not.toContain("colspan");
    expect(ctx).not.toContain("dup");
    expect(ctx).not.toContain("| x | y |");
  });

  it("품목 표가 없으면 기존 원본 HTML 경로 유지", () => {
    const c = buildClaudeContext({ ...parsed, tablesHtml: [`<table><tr><td>a</td></tr></table>`] });
    expect(c).toContain("## 표 원본 HTML");
  });
});
