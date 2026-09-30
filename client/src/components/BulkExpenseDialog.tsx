import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { trpc } from '../lib/trpc';
import { formatKRW } from '@/lib/utils';
import { Button } from '@/components/ui/index';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Row {
  key: number;
  checked: boolean;
  date: string;
  amount: string;
  memo: string;
  categoryId: number | null;
  flags: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: number;
  categories: { id: number; name: string }[];
}

const FLAG_LABEL: Record<string, string> = { prepaid: '사전결제', duplicate: '기존 등록건과 중복', batchDuplicate: '입력 내 중복' };

export function BulkExpenseDialog({ open, onOpenChange, restaurantId, categories }: Props) {
  const utils = trpc.useUtils();
  const [text, setText] = useState('');
  const [submittedText, setSubmittedText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setText(''); setSubmittedText(''); setRows([]); setErrors([]); setWarnings([]);
    }
  }, [open]);

  const preview = trpc.dailyExpenses.previewBulk.useQuery(
    { restaurantId, text: submittedText },
    { enabled: open && submittedText.length > 0, staleTime: 0, gcTime: 0 },
  );

  useEffect(() => {
    const d = preview.data;
    if (!d) return;
    setRows(d.rows.map((r, i) => ({
      key: i,
      // 사전결제·기존건 중복은 기본 해제. 입력 내 중복(batchDuplicate)은 표시만 하고 체크 유지
      checked: !r.flags.includes('prepaid') && !r.flags.includes('duplicate'),
      date: r.date,
      amount: String(r.amount),
      memo: r.memo,
      categoryId: r.categoryId,
      flags: r.flags,
    })));
    setErrors(d.errors);
    setWarnings(d.warnings);
  }, [preview.data]);

  const bulkMut = trpc.dailyExpenses.bulkCreate.useMutation({
    onSuccess(res) {
      toast.success(`즉시지출 ${res.inserted}건이 등록되었습니다.`);
      utils.dailyExpenses.listByDate.invalidate();
      utils.dailyExpenses.monthlySummary.invalidate();
      onOpenChange(false);
    },
    onError(err: any) { toast.error(`일괄 등록 실패: ${err.message}`); },
  });

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const selected = rows.filter((r) => r.checked);
  const invalid = (r: Row) =>
    r.categoryId == null || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !(Number(r.amount) > 0) || !r.memo.trim();
  const hasInvalid = selected.some(invalid);
  const canSave = selected.length > 0 && !hasInvalid && !bulkMut.isPending;

  const save = () => {
    bulkMut.mutate({
      restaurantId,
      rows: selected.map((r) => ({
        date: r.date, categoryId: r.categoryId, title: r.memo.trim(), amount: Math.round(Number(r.amount)),
      })),
    });
  };

  const parse = () => {
    if (!text.trim()) { toast.error('붙여넣을 텍스트를 입력하세요.'); return; }
    if (text.trim() === submittedText) preview.refetch();
    else setSubmittedText(text.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>텍스트로 일괄입력</DialogTitle></DialogHeader>

        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={'분류 제목 줄 아래에 "9/25 쿠팡 세제 45,000원" 형식으로 붙여넣으세요.\n구분선(———)을 넣으면 분류가 초기화됩니다.'}
            className="text-sm"
          />
          <Button onClick={parse} disabled={preview.isFetching} className="w-full">
            {preview.isFetching ? '분석 중...' : '미리보기'}
          </Button>
          {preview.error && <p className="text-xs text-red-500">분석 실패: {preview.error.message}</p>}
        </div>

        {warnings.length > 0 && (
          <div className="text-xs text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-1.5 rounded space-y-0.5">
            {warnings.map((w, i) => <p key={i}>{w} — 아래 표에서 분류를 직접 선택하세요.</p>)}
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-2 w-8"></th>
                    <th className="p-2 text-left">날짜</th>
                    <th className="p-2 text-right">금액</th>
                    <th className="p-2 text-left">분류</th>
                    <th className="p-2 text-left">메모</th>
                    <th className="p-2 text-left">표시</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={`border-t border-border ${r.checked ? '' : 'opacity-60'}`}>
                      <td className="p-2">
                        <Checkbox checked={r.checked} onCheckedChange={(v) => update(r.key, { checked: v === true })} />
                      </td>
                      <td className="p-1">
                        <input type="date" value={r.date} onChange={(e) => update(r.key, { date: e.target.value })}
                          className="h-8 rounded border border-border bg-background px-1" />
                      </td>
                      <td className="p-1">
                        <input inputMode="numeric" value={r.amount}
                          onChange={(e) => update(r.key, { amount: e.target.value.replace(/[^\d]/g, '') })}
                          className="h-8 w-24 rounded border border-border bg-background px-1 text-right tabular-nums" />
                      </td>
                      <td className="p-1">
                        <select value={r.categoryId ?? 0}
                          onChange={(e) => update(r.key, { categoryId: Number(e.target.value) || null })}
                          className={`h-8 rounded border bg-background px-1 ${r.categoryId == null ? 'border-red-400' : 'border-border'}`}>
                          <option value={0}>분류 선택</option>
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="p-1">
                        <input value={r.memo} onChange={(e) => update(r.key, { memo: e.target.value })}
                          className="h-8 w-full min-w-[8rem] rounded border border-border bg-background px-1" />
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {r.flags.map((f) => (
                          <span key={f} className={`mr-1 px-1.5 py-0.5 rounded text-[10px] ${f === 'duplicate' ? 'bg-red-100 text-red-600' : f === 'batchDuplicate' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                            {FLAG_LABEL[f] ?? f}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                선택 {selected.length}건 · 합계 {formatKRW(selected.reduce((s, r) => s + (Number(r.amount) || 0), 0))}
              </span>
              {selected.some((r) => r.categoryId == null) && (
                <span className="text-xs text-red-500">분류 미지정 행이 있어 저장할 수 없습니다</span>
              )}
            </div>
            <Button onClick={save} disabled={!canSave} className="w-full">
              {bulkMut.isPending ? '저장 중...' : `${selected.length}건 저장`}
            </Button>
          </div>
        )}

        {errors.length > 0 && (
          <div className="border border-red-200 bg-red-50 dark:bg-red-900/10 rounded-lg p-2 text-xs space-y-1">
            <p className="font-semibold text-red-600">해석하지 못한 줄 {errors.length}개</p>
            {errors.map((e, i) => <p key={i} className="font-mono text-red-700 dark:text-red-400 break-all">{e}</p>)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
