import React from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/index';
import { fmtTs } from './helpers';
import { TabChecklists } from './ChecklistSection';
import { DateInfoCard, TodayStaffCard, YesterdayClosingCard, WeatherCard, WeekdayAvgSalesCard } from './InfoCards';

export function OpenTab({
  restaurantId,
  date,
}: {
  restaurantId: number;
  date: string;
}) {
  const operationQuery = trpc.dailyOps.getByDate.useQuery({
    restaurantId,
    date,
  });

  const checkOpenMutation = trpc.dailyOps.checkOpen.useMutation({
    onSuccess: () => {
      toast.success('오픈 체크 완료');
      operationQuery.refetch();
    },
    onError: (error: any) => {
      toast.error(`오픈 체크 실패: ${error.message}`);
    },
  });

  const operation = operationQuery.data;

  return (
    <div className="space-y-4 p-4">
      <TabChecklists
        restaurantId={restaurantId}
        date={date}
        targetTab="open"
      />

      <DateInfoCard date={date} />
      <TodayStaffCard restaurantId={restaurantId} date={date} />
      <YesterdayClosingCard restaurantId={restaurantId} date={date} />
      <WeatherCard />
      <WeekdayAvgSalesCard restaurantId={restaurantId} date={date} />

      <Button
        onClick={() => {
          checkOpenMutation.mutate({
            restaurantId,
            date,
          });
        }}
        disabled={checkOpenMutation.isPending || !!operation?.openCheckedAt}
        className="w-full"
        size="lg"
      >
        {operation?.openCheckedAt
          ? `오픈 완료 (${fmtTs(operation.openCheckedAt)})`
          : '오픈 체크 완료'}
      </Button>
    </div>
  );
}
