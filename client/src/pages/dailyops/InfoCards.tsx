import React, { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { formatDateWithHoliday, getHolidayName } from '@/lib/koreanHolidays';
import { Cloud, CloudRain, Sun } from 'lucide-react';
import { Card, Badge } from '@/components/ui/index';
import { fmtTs, getShiftLabel } from './helpers';

export function DateInfoCard({ date }: { date: string }) {
  const holiday = getHolidayName(date);
  const dateInfo = formatDateWithHoliday(date);

  return (
    <Card className="bg-card border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold text-foreground">
            {dateInfo.display}
          </p>
        </div>
        {holiday && (
          <Badge variant="danger">
            {holiday}
          </Badge>
        )}
      </div>
    </Card>
  );
}

export function TodayStaffCard({
  restaurantId,
  date,
}: {
  restaurantId: number;
  date: string;
}) {
  const query = trpc.dailyOps.getTodayStaff.useQuery({
    restaurantId,
    date,
  });

  const staff: any[] = query.data?.staff || [];
  const headcount = query.data?.headcount || 0;
  const effectiveCount = query.data?.effectiveCount ?? headcount;
  const totalHours = staff.reduce((sum: number, s: any) => sum + (s.hours ?? 0), 0);
  const hasHalf = staff.some((s: any) => s.isHalf);

  return (
    <Card className="bg-card border-border p-4">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-foreground">금일 출근 인원</h4>
        <div className="text-right">
          <span className="text-lg font-bold text-blue-600">
            {hasHalf ? `${effectiveCount}명` : `${headcount}명`}
          </span>
          {totalHours > 0 && (
            <span className="text-xs text-muted-foreground ml-1.5">
              ({totalHours}h)
            </span>
          )}
        </div>
      </div>
      {staff.length > 0 && (
        <div className="space-y-0.5">
          {staff.map((s: any, i: number) => {
            const label = getShiftLabel(s.shiftPreset, s.isHalf);
            return (
              <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{s.userName ?? '미배정'}</span>
                <span className={s.isHalf ? 'text-amber-500 font-medium' : ''}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function YesterdayClosingCard({
  restaurantId,
  date,
}: {
  restaurantId: number;
  date: string;
}) {
  const query = trpc.dailyOps.getYesterdaySummary.useQuery({
    restaurantId,
    date,
  });

  const data = query.data;

  if (!data) {
    return (
      <Card className="bg-card border-border p-4">
        <h4 className="text-sm font-semibold text-foreground mb-2">어제 마감 요약</h4>
        <p className="text-xs text-muted-foreground">어제 데이터 없음</p>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border p-4">
      <h4 className="text-sm font-semibold text-foreground mb-2">어제 마감 요약</h4>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>마감 {fmtTs(data.closeCheckedAt)}</span>
        <span className="font-medium text-foreground">₩{(data.totalSales || 0).toLocaleString()}</span>
      </div>
      {data.closeNote && <p className="text-xs text-muted-foreground mt-1">메모: {data.closeNote}</p>}
    </Card>
  );
}

interface WeatherData {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    precipitation: number;
  };
  timezone: string;
}

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;

export function WeatherCard() {
  const { selectedRestaurant } = useRestaurant();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingDefault, setUsingDefault] = useState(false);

  useEffect(() => {
    const lat = selectedRestaurant?.latitude ? Number(selectedRestaurant.latitude) : 0;
    const lng = selectedRestaurant?.longitude ? Number(selectedRestaurant.longitude) : 0;
    const useLat = lat > 0 ? lat : DEFAULT_LAT;
    const useLng = lng > 0 ? lng : DEFAULT_LNG;
    setUsingDefault(lat === 0 || lng === 0);

    const fetchWeather = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${useLat}&longitude=${useLng}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&timezone=Asia/Seoul`
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data?.current) throw new Error('응답 데이터 없음');
        setWeather(data);
        setError(null);
      } catch (err) {
        setError('날씨 정보 조회 실패');
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
  }, [selectedRestaurant?.latitude, selectedRestaurant?.longitude]);

  const getWeatherIcon = (code: number) => {
    if (code === 0) return <Sun className="w-8 h-8 text-yellow-500" />;
    if (code >= 1 && code <= 3) return <Cloud className="w-8 h-8 text-muted-foreground" />;
    if ([45, 48].includes(code)) return <Cloud className="w-8 h-8 text-slate-400" />;
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return <CloudRain className="w-8 h-8 text-blue-500" />;
    if ([71, 73, 75, 77].includes(code)) return <CloudRain className="w-8 h-8 text-sky-300" />;
    if ([95, 96, 99].includes(code)) return <CloudRain className="w-8 h-8 text-purple-500" />;
    return <Cloud className="w-8 h-8 text-muted-foreground" />;
  };

  const getWeatherDescription = (code: number): string => {
    const weatherMap: Record<number, string> = {
      0: '맑음', 1: '구름 조금', 2: '구름 약간', 3: '흐림',
      45: '안개', 48: '짙은 안개',
      51: '이슬비', 53: '이슬비', 55: '강한 이슬비',
      61: '약한 비', 63: '비', 65: '강한 비',
      71: '약한 눈', 73: '눈', 75: '강한 눈', 77: '싸락눈',
      80: '약한 소나기', 81: '소나기', 82: '강한 소나기',
      95: '뇌우', 96: '뇌우+우박', 99: '강한 뇌우+우박',
    };
    return weatherMap[code] || '알 수 없음';
  };

  if (loading) {
    return (
      <Card className="bg-card border-border p-4">
        <h4 className="text-sm font-semibold text-foreground mb-2">오늘 날씨</h4>
        <p className="text-xs text-muted-foreground">로딩 중...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-card border-border p-4">
        <h4 className="text-sm font-semibold text-foreground mb-2">오늘 날씨</h4>
        <p className="text-xs text-muted-foreground">{error}</p>
      </Card>
    );
  }

  if (!weather?.current) {
    return null;
  }

  const { temperature_2m: temp, apparent_temperature: feelsLike, relative_humidity_2m: humidity, weather_code: code, wind_speed_10m: wind, precipitation } = weather.current;

  return (
    <Card className="bg-card border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-foreground">오늘 날씨</h4>
        {usingDefault && <span className="text-[10px] text-muted-foreground/60">서울 기준</span>}
      </div>
      <div className="flex items-center gap-3">
        {getWeatherIcon(code)}
        <div className="flex-1">
          <div className="flex items-baseline gap-1.5">
            <p className="text-xl font-bold text-foreground">{Math.round(temp)}°C</p>
            <p className="text-xs text-muted-foreground">체감 {Math.round(feelsLike)}°</p>
          </div>
          <p className="text-xs text-muted-foreground">{getWeatherDescription(code)}</p>
        </div>
      </div>
      <div className="flex gap-3 mt-2 pt-2 border-t border-border/50">
        <span className="text-[11px] text-muted-foreground">습도 {humidity}%</span>
        <span className="text-[11px] text-muted-foreground">풍속 {wind}km/h</span>
        {precipitation > 0 && <span className="text-[11px] text-blue-500">강수 {precipitation}mm</span>}
      </div>
    </Card>
  );
}

export function WeekdayAvgSalesCard({
  restaurantId,
  date,
}: {
  restaurantId: number;
  date: string;
}) {
  const query = trpc.dailyOps.getWeekdayAvgSales.useQuery({
    restaurantId,
    date,
  });

  const data = query.data;

  if (!data) {
    return (
      <Card className="bg-card border-border p-4">
        <h4 className="text-sm font-semibold text-foreground mb-2">요일 평균 매출</h4>
        <p className="text-xs text-muted-foreground">데이터 없음</p>
      </Card>
    );
  }

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayIndex = new Date(date).getDay();
  const dayName = dayNames[dayIndex];

  return (
    <Card className="bg-card border-border p-4">
      <h4 className="text-sm font-semibold text-foreground mb-2">요일 평균 매출</h4>
      <p className="text-sm text-muted-foreground">
        최근 8주 {dayName}요일 평균: <span className="font-bold text-foreground">₩{(data.avg ?? 0).toLocaleString()}</span>
      </p>
      <p className="text-xs text-muted-foreground mt-1">({data.count}주 기준)</p>
    </Card>
  );
}
