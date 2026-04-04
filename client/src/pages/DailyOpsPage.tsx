import React, { useState } from 'react';
import { formatDate } from 'date-fns';
import { useSearch } from 'wouter';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { formatDateWithHoliday } from '@/lib/koreanHolidays';
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/index';
import { OpenTab } from './dailyops/OpenTab';
import { PurchaseTab } from './dailyops/PurchaseTab';
import { MiddayTab } from './dailyops/MiddayTab';
import { CloseTab } from './dailyops/CloseTab';
import type { TabType } from './dailyops/helpers';

export default function DailyOpsPage() {
  const { selectedRestaurant } = useRestaurant();
  const searchString = useSearch();
  const urlDate = new URLSearchParams(searchString).get('date');
  const [date, setDate] = useState(() => {
    if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) return urlDate;
    return formatDate(new Date(), 'yyyy-MM-dd');
  });
  const [activeTab, setActiveTab] = useState<TabType>('open');

  if (!selectedRestaurant) {
    return (
      <div className="flex items-center justify-center h-screen">
        <AlertCircle className="w-8 h-8 mr-2 text-red-500" />
        <p className="text-foreground">매장을 선택해주세요.</p>
      </div>
    );
  }

  const tabs: { key: TabType; label: string }[] = [
    { key: 'open', label: '오픈' },
    { key: 'purchase', label: '매입' },
    { key: 'midday', label: '일간보고' },
    { key: 'close', label: '마감' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border p-4">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-bold text-foreground">
              {selectedRestaurant.name}
            </h1>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-xs h-7 w-[130px] text-muted-foreground"
            />
          </div>
          {(() => {
            const info = formatDateWithHoliday(date);
            const shiftDate = (delta: number) => {
              const d = new Date(date + "T12:00:00");
              d.setDate(d.getDate() + delta);
              setDate(formatDate(d, "yyyy-MM-dd"));
            };
            return (
              <div className="flex items-center gap-2">
                <button onClick={() => shiftDate(-1)} className="p-1 rounded-md hover:bg-muted active:bg-muted/80 transition-colors">
                  <ChevronLeft className="w-5 h-5 text-muted-foreground" />
                </button>
                <p className="text-xl font-bold text-foreground flex-1 text-center">
                  {info.display}
                </p>
                <button onClick={() => shiftDate(1)} className="p-1 rounded-md hover:bg-muted active:bg-muted/80 transition-colors">
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
            );
          })()}
        </div>

        {/* Tab Navigation */}
        <div className="sticky top-[85px] z-10 bg-background/95 backdrop-blur border-b border-border">
          <div className="max-w-2xl mx-auto px-4">
            <div className="flex gap-1 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'text-foreground border-blue-600'
                      : 'text-muted-foreground hover:text-foreground border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="pb-20">
          {activeTab === 'open' && (
            <OpenTab restaurantId={selectedRestaurant.id} date={date} />
          )}
          {activeTab === 'purchase' && (
            <PurchaseTab restaurantId={selectedRestaurant.id} date={date} onDateChange={setDate} />
          )}
          {activeTab === 'midday' && (
            <MiddayTab restaurantId={selectedRestaurant.id} date={date} />
          )}
          {activeTab === 'close' && (
            <CloseTab restaurantId={selectedRestaurant.id} date={date} />
          )}
        </div>
      </div>
    </div>
  );
}
