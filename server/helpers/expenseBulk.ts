/**
 * 즉시지출 일괄등록 insert 값 생성. 단건 create(server/routers/dailyExpenses.ts)와 컬럼을 동일하게 채운다.
 * - date는 "YYYY-MM-DD" 문자열 그대로 전달한다. Date 객체를 만들면 mysql2가 서버 로컬 타임존으로
 *   직렬화해 하루 밀릴 수 있다(단건 create도 문자열 그대로).
 */
export interface BulkExpenseInputRow {
  date: string;
  categoryId: number;
  title: string;
  amount: number;
}

export function toDailyExpenseInsertValues(
  restaurantId: number,
  userId: number,
  rows: BulkExpenseInputRow[],
  categoryNameById: Map<number, string>,
) {
  return rows.map((r) => ({
    restaurantId,
    date: r.date,
    categoryId: r.categoryId,
    category: categoryNameById.get(r.categoryId) ?? null,
    title: r.title,
    amount: String(r.amount),
    note: null,
    attachmentUrl: null,
    createdBy: userId,
  }));
}
