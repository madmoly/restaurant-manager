import React, { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui/index';
import { Label } from '@/components/ui/label';
import { fmtTs } from './helpers';
import { TabChecklists } from './ChecklistSection';

export function MiddayTab({
  restaurantId,
  date,
}: {
  restaurantId: number;
  date: string;
}) {
  const [midAmount, setMidAmount] = useState('');
  const [midReceiptCount, setMidReceiptCount] = useState('');
  const [midNote, setMidNote] = useState('');
  const midSalesQuery = trpc.dailyOps.getMidSales.useQuery({
    restaurantId,
    date,
  });

  const saveMidSalesMutation = trpc.dailyOps.saveMidSales.useMutation({
    onSuccess: () => {
      toast.success('중간 매출이 저장되었습니다.');
      setMidAmount('');
      setMidNote('');
      setMidReceiptCount('');
      midSalesQuery.refetch();
    },
    onError: (error: any) => {
      toast.error(`저장 실패: ${error.message}`);
    },
  });

  const deleteMidSalesMutation = trpc.dailyOps.deleteMidSales.useMutation({
    onSuccess: () => {
      toast.success('삭제되었습니다.');
      midSalesQuery.refetch();
    },
    onError: (error: any) => {
      toast.error(`삭제 실패: ${error.message}`);
    },
  });

  const handleSaveMidSales = async () => {
    const amount = parseInt(midAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      toast.error('올바른 금액을 입력하세요.');
      return;
    }

    saveMidSalesMutation.mutate({
      restaurantId,
      date,
      amount,
      receiptCount: parseInt(midReceiptCount, 10) || 0,
      note: midNote || undefined,
    });
  };

  const midSales = midSalesQuery.data || [];

  return (
    <div className="space-y-4 p-4">
      <TabChecklists
        restaurantId={restaurantId}
        date={date}
        targetTab="midday"
      />

      <Card className="bg-card border-border p-4">
        <h3 className="font-semibold text-foreground mb-4">중간 매출</h3>
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mid-amount" className="text-sm">
                매출액
              </Label>
              <Input
                id="mid-amount"
                type="number"
                placeholder="금액"
                value={midAmount}
                onChange={(e) => setMidAmount(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="mid-receipt" className="text-sm">
                영수건수
              </Label>
              <Input
                id="mid-receipt"
                type="number"
                placeholder="건수"
                value={midReceiptCount}
                onChange={(e) => setMidReceiptCount(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="mid-note" className="text-sm">
              메모 (선택)
            </Label>
            <Input
              id="mid-note"
              placeholder="메모"
              value={midNote}
              onChange={(e) => setMidNote(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button
            onClick={handleSaveMidSales}
            disabled={saveMidSalesMutation.isPending || !midAmount}
            className="w-full"
          >
            저장
          </Button>
        </div>

        {midSales.length > 0 && (
          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-medium text-foreground mb-2">저장된 중간 매출</h4>
            <div className="space-y-2">
              {midSales.map((sale: any) => (
                <div
                  key={sale.id}
                  className="flex items-center justify-between bg-card/50 border border-border rounded p-2 text-sm"
                >
                  <div>
                    <div className="font-medium text-foreground">
                      ₩{Number(sale.amount).toLocaleString()}
                      {sale.receiptCount > 0 && <span className="text-xs text-muted-foreground ml-1">({sale.receiptCount}건)</span>}
                    </div>
                    {sale.note && (
                      <div className="text-xs text-muted-foreground">{sale.note}</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {fmtTs(sale.recordedAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMidSalesMutation.mutate({ id: sale.id, restaurantId })}
                    disabled={deleteMidSalesMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
