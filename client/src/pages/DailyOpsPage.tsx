import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { formatDate } from 'date-fns';
import { useLocation } from 'wouter';
import { trpc } from '../lib/trpc';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { resizeImage, OCR_HIGH, OCR_STORAGE } from '@/lib/imageResize';
import { formatDateWithHoliday, getHolidayName } from '@/lib/koreanHolidays';
import { toast } from 'sonner';
import {
  Camera,
  X,
  Plus,
  Check,
  AlertCircle,
  Cloud,
  CloudRain,
  Sun,
  Trash2,
  Clock,
  CheckCircle,
  Users,
  ZoomIn,
  Pencil,
  RotateCw,
} from 'lucide-react';

// ============================================================================
// 공통 포맷 헬퍼
// ============================================================================

/** 숫자를 000,000 형식 문자열로 변환 */
function fmtNum(v: number | string): string {
  const n = typeof v === 'string' ? parseInt(v.replace(/[^0-9-]/g, '') || '0', 10) : Math.round(v);
  return n.toLocaleString('ko-KR');
}

/** 콤마 포함 문자열 → 정수 */
function parseNum(v: string): number {
  return parseInt(v.replace(/[^0-9-]/g, '') || '0', 10);
}

/** 금액 입력용: 숫자만 허용 + 콤마 포맷 반환 */
function handleWonInput(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return parseInt(digits, 10).toLocaleString('ko-KR');
}

/** ISO 타임스탬프 → "HH:mm" 요약 */
function fmtTs(raw: string | Date | null | undefined): string {
  if (!raw) return '-';
  try {
    const d = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(d.getTime())) return typeof raw === 'string' ? raw : '-';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return typeof raw === 'string' ? raw : '-';
  }
}

/** 날짜 요약: 년도 생략, 필요 시 뒷 2자리만. "3/27" 또는 "3/27(목)" */
function fmtShortDate(raw: string | Date | null | undefined, withDay = false): string {
  if (!raw) return '-';
  const d = typeof raw === 'string' ? new Date(raw.length === 10 ? raw + 'T00:00:00' : raw) : raw;
  if (isNaN(d.getTime())) return typeof raw === 'string' ? raw : '-';
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (withDay) return `${m}/${day}(${dayNames[d.getDay()]})`;
  return `${m}/${day}`;
}

/** 근무유형 라벨: shiftPreset + 반차 여부 → "풀타임", "오픈반차" 등 */
function getShiftLabel(preset: string | null | undefined, isHalf: boolean): string {
  switch (preset) {
    case 'full':  return isHalf ? '반차' : '풀타임';
    case 'open':  return isHalf ? '오픈반차' : '오픈';
    case 'close': return isHalf ? '마감반차' : '마감';
    default:      return isHalf ? '반차' : '커스텀';
  }
}

// ============================================================================
// 이미지 확대보기 모달 (핀치줌/스와이프 지원)
// ============================================================================
function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 bg-white/20 backdrop-blur rounded-full p-2"
      >
        <X className="w-6 h-6 text-white" />
      </button>
      <img
        src={src}
        alt="확대 이미지"
        className="max-w-full max-h-full object-contain touch-pinch-zoom"
        style={{ touchAction: 'pinch-zoom' }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}
import { Button, Card, Input, Badge } from '@/components/ui/index';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

// ============================================================================
// TAB LABELS
// ============================================================================
const TAB_LABELS: Record<string, string> = {
  open: '오픈',
  purchase: '매입',
  midday: '일간보고',
  close: '마감',
};

// ============================================================================
// TAB CHECKLISTS — targetTab 기준으로 체크리스트 렌더링
// ============================================================================
function TabChecklists({
  restaurantId,
  date,
  targetTab,
}: {
  restaurantId: number;
  date: string;
  targetTab: 'open' | 'purchase' | 'midday' | 'close';
}) {
  return (
    <ChecklistSection
      restaurantId={restaurantId}
      date={date}
      targetTab={targetTab}
      label={`${TAB_LABELS[targetTab] ?? targetTab} 체크리스트`}
      icon={Check}
    />
  );
}

// ============================================================================
// CHECKLIST SECTION COMPONENT — targetTab 기반
// ============================================================================

function ChecklistSection({
  restaurantId,
  date,
  targetTab,
  label,
  icon: Icon,
}: {
  restaurantId: number;
  date: string;
  targetTab: 'open' | 'purchase' | 'midday' | 'close';
  label: string;
  icon: React.ElementType;
}) {
  const [checkedItemIds, setCheckedItemIds] = useState<number[]>([]);
  const [textValues, setTextValues] = useState<Record<number, string>>({});
  const [photoValues, setPhotoValues] = useState<Record<number, string>>({});

  const templatesQuery = trpc.storeChecklists.listTemplates.useQuery({
    restaurantId,
    targetTab,
    date,
  });

  const logQuery = trpc.storeChecklists.getLog.useQuery({
    restaurantId,
    logDate: date,
    targetTab,
  });

  const saveLogMutation = trpc.storeChecklists.saveLog.useMutation({
    onSuccess: () => {
      toast.success(`${label} 체크리스트가 저장되었습니다.`);
    },
    onError: (error: any) => {
      toast.error(`저장 실패: ${error.message}`);
    },
  });

  // Initialize from log data
  useEffect(() => {
    if (logQuery.data?.checkedItemIds) {
      setCheckedItemIds(logQuery.data.checkedItemIds);
      const newTextValues: Record<number, string> = {};
      const newPhotoValues: Record<number, string> = {};

      logQuery.data.checkedItems?.forEach((item: any) => {
        if (item.textValue) newTextValues[item.itemId] = item.textValue;
        if (item.photoUrl) newPhotoValues[item.itemId] = item.photoUrl;
      });

      setTextValues(newTextValues);
      setPhotoValues(newPhotoValues);
    }
  }, [logQuery.data]);

  const handleToggleItem = (itemId: number) => {
    setCheckedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const handleTextChange = (itemId: number, value: string) => {
    setTextValues((prev) => ({ ...prev, [itemId]: value }));
  };

  const handlePhotoCapture = async (itemId: number, file: File) => {
    try {
      const resized = await resizeImage(file, { maxSize: 800 });
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setPhotoValues((prev) => ({ ...prev, [itemId]: dataUrl }));
      };
      reader.readAsDataURL(resized);
    } catch (error) {
      toast.error('이미지 처리 실패');
    }
  };

  const handleSaveLog = async () => {
    const updatedCheckedItems = templatesQuery.data
      ?.filter((item) => checkedItemIds.includes(item.id))
      .map((item) => ({
        itemId: item.id,
        answer: textValues[item.id] || undefined,
        photoUrl: photoValues[item.id] || undefined,
      })) || [];

    saveLogMutation.mutate({
      restaurantId,
      logDate: date,
      targetTab,
      checkedItemIds,
      checkedItems: updatedCheckedItems,
    });
  };

  const isComplete =
    templatesQuery.data &&
    templatesQuery.data.length > 0 &&
    checkedItemIds.length === templatesQuery.data.length;

  const templates = templatesQuery.data || [];

  return (
    <Card className="bg-card border-border">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-foreground" />
          <h3 className="font-semibold text-foreground">{label}</h3>
          {isComplete && (
            <Badge variant="success">
              완료
            </Badge>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {checkedItemIds.length} / {templates.length}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">체크리스트 항목이 없습니다.</p>
        ) : (
          templates.map((item) => (
            <div
              key={item.id}
              className="border border-border rounded-lg p-3 bg-card/50"
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={checkedItemIds.includes(item.id)}
                  onCheckedChange={() => handleToggleItem(item.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {item.itemText}
                  </p>

                  {item.requirementType === 'text_input' && (
                    <div className="mt-2">
                      <Input
                        placeholder="입력"
                        value={textValues[item.id] || ''}
                        onChange={(e) => handleTextChange(item.id, e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>
                  )}

                  {item.requirementType === 'camera_photo' && (
                    <div className="mt-2">
                      {photoValues[item.id] ? (
                        <div className="relative inline-block">
                          <img
                            src={photoValues[item.id]}
                            alt="체크리스트 사진"
                            className="h-16 w-16 rounded object-cover"
                          />
                          <button
                            onClick={() =>
                              setPhotoValues((prev) => {
                                const newValues = { ...prev };
                                delete newValues[item.id];
                                return newValues;
                              })
                            }
                            className="absolute top-0 right-0 bg-red-500 rounded-full p-1"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-blue-600 hover:text-blue-700">
                          <Camera className="w-4 h-4" />
                          사진 촬영
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => {
                              if (e.target.files?.[0]) {
                                handlePhotoCapture(item.id, e.target.files[0]);
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-border">
        <Button
          onClick={handleSaveLog}
          disabled={saveLogMutation.isPending}
          className="w-full"
          variant="secondary"
        >
          {saveLogMutation.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </Card>
  );
}

// ============================================================================
// INFO CARDS
// ============================================================================

function DateInfoCard({ date }: { date: string }) {
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

function TodayStaffCard({
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

function YesterdayClosingCard({
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

// 서울 기본 좌표 (매장 위치 미설정 시 fallback)
const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;

function WeatherCard() {
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

function WeekdayAvgSalesCard({
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

// ============================================================================
// OPEN TAB
// ============================================================================

function OpenTab({
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

// ============================================================================
// PURCHASE TAB – 일별 매입 관리 (간편모드 + 전표OCR모드)
// ============================================================================

const UNIT_OPTIONS = ['개', '박스', 'kg', 'g', '리터', 'ml', '팩', '봉', '병', '캔', '포', '판', '줄', '묶음', '단', 'EA', '직접입력'];

interface PurchaseItemRow {
  rawItemName: string;
  originalName?: string; // OCR 원본 전체명칭
  quantity: string;
  unitName: string;
  unitPrice: string;
  lineTotal: string;
  counterpartyItemId?: number;
}

function emptyPurchaseItem(): PurchaseItemRow {
  return { rawItemName: '', quantity: '', unitName: '개', unitPrice: '', lineTotal: '' };
}

type PurchaseInputMode = 'none' | 'order' | 'receive';

function PendingOrdersBanner({ restaurantId, onReceive }: { restaurantId: number; onReceive?: (orderId: number) => void }) {
  const pendingQuery = trpc.purchasesV2.pendingOrders.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const pending = pendingQuery.data || [];
  if (pending.length === 0) return null;

  return (
    <Card className="bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">미입고 발주 {pending.length}건</span>
      </div>
      {pending.map((order: any) => (
        <div key={order.id} className="flex items-center justify-between text-xs">
          <div className="min-w-0">
            <span className="text-foreground font-medium">{order.counterpartyName || '미지정'}</span>
            {Number(order.totalAmount) > 0 && (
              <span className="text-muted-foreground ml-1.5">{fmtNum(Number(order.totalAmount))}원</span>
            )}
            <span className="text-muted-foreground ml-1.5">{fmtShortDate(order.purchaseDate)}</span>
            {order.itemCount > 0 && (
              <span className="text-muted-foreground ml-1">({order.itemCount}품목)</span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-6 px-2 gap-0.5 border-green-300 text-green-600 hover:bg-green-50 dark:border-green-700 dark:text-green-400"
            onClick={() => onReceive?.(order.id)}
          >
            <Check className="w-2.5 h-2.5" /> 입고전환
          </Button>
        </div>
      ))}
    </Card>
  );
}

function PurchaseTab({
  restaurantId,
  date,
}: {
  restaurantId: number;
  date: string;
}) {
  const [inputMode, setInputMode] = useState<PurchaseInputMode>('none');
  const [simpleMode, setSimpleMode] = useState(false);
  const [simpleTotalAmount, setSimpleTotalAmount] = useState('');
  const [counterpartyId, setCounterpartyId] = useState<number | undefined>(undefined);
  const [cpSearchText, setCpSearchText] = useState('');
  const [showCpDropdown, setShowCpDropdown] = useState(false);
  const [note, setNote] = useState('');
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItemRow[]>([emptyPurchaseItem()]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | undefined>(undefined);
  const [receivingOrderId, setReceivingOrderId] = useState<number | null>(null); // 입고전환 대상 발주 ID

  // OCR 상태
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrOriginalItems, setOcrOriginalItems] = useState<any[] | null>(null); // AI 원본 (수정 비교용)
  const [viewerImage, setViewerImage] = useState<string | null>(null); // 이미지 확대보기

  const utils = trpc.useUtils();

  const ordersQuery = trpc.purchasesV2.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );

  const counterpartiesQuery = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const orderItemsQuery = trpc.purchasesV2.getOrderItems.useQuery(
    { orderId: expandedId! },
    { enabled: expandedId !== null },
  );

  // 거래처 선택 시 해당 품목 로드
  const cpItemsQuery = trpc.counterpartyItems.listByCounterparty.useQuery(
    { counterpartyId: counterpartyId! },
    { enabled: counterpartyId !== undefined && counterpartyId > 0 },
  );

  const createOrder = trpc.purchasesV2.createOrder.useMutation({
    onSuccess() {
      toast.success(inputMode === 'order' ? '발주가 등록되었습니다.' : '입고가 등록되었습니다.');
      utils.purchasesV2.listByDate.invalidate();
      utils.purchasesV2.pendingOrders.invalidate();
      resetForm();
    },
    onError(err: any) { toast.error(`등록 실패: ${err.message}`); },
  });

  const receiveOrderMutation = trpc.purchasesV2.receiveOrder.useMutation({
    onSuccess() {
      toast.success('입고 전환 완료');
      utils.purchasesV2.listByDate.invalidate();
      utils.purchasesV2.pendingOrders.invalidate();
      resetForm();
    },
    onError(err: any) { toast.error(`입고 전환 실패: ${err.message}`); },
  });

  const deleteOrder = trpc.purchasesV2.deleteOrder.useMutation({
    onSuccess() {
      toast.success('삭제됨');
      utils.purchasesV2.listByDate.invalidate();
      setExpandedId(null);
    },
    onError(err: any) { toast.error(`삭제 실패: ${err.message}`); },
  });

  // 거래처 신규 생성
  const createCounterparty = trpc.counterparties.create.useMutation({
    onSuccess(data: any) {
      setCounterpartyId(data.id);
      setCpSearchText('');
      setShowCpDropdown(false);
      utils.counterparties.list.invalidate();
      toast.success('거래처가 등록되었습니다');
    },
    onError(err: any) { toast.error(`거래처 등록 실패: ${err.message}`); },
  });

  const resetForm = () => {
    setInputMode('none');
    setSimpleMode(false);
    setSimpleTotalAmount('');
    setCounterpartyId(undefined);
    setCpSearchText('');
    setShowCpDropdown(false);
    setNote('');
    setPurchaseItems([emptyPurchaseItem()]);
    setAttachmentUrl(undefined);
    setOcrPreviewUrl(null);
    setOcrError(null);
    setReceivingOrderId(null);
  };

  // 미입고 발주 → 입고 전환 시작
  const startReceiveFromOrder = async (orderId: number) => {
    setInputMode('receive');
    setReceivingOrderId(orderId);
    // 기존 발주의 품목 로드
    const items = await utils.purchasesV2.getOrderItems.fetch({ orderId });
    if (items && items.length > 0) {
      setPurchaseItems(
        items.map((item: any) => ({
          rawItemName: item.rawItemName || item.itemName || '',
          quantity: item.quantity || '',
          unitName: item.unitName || '개',
          unitPrice: item.unitPrice || '',
          lineTotal: item.lineTotal || '',
          counterpartyItemId: item.counterpartyItemId || undefined,
        })),
      );
    }
    // 발주의 거래처도 프리필
    const pendingOrders = utils.purchasesV2.pendingOrders.getData({ restaurantId });
    const order = pendingOrders?.find((o: any) => o.id === orderId);
    if (order?.counterpartyId) setCounterpartyId(order.counterpartyId);
    if (order?.note) setNote(order.note);
  };

  const updateItem = (idx: number, field: keyof PurchaseItemRow, value: string) => {
    const newItems = [...purchaseItems];
    newItems[idx] = { ...newItems[idx], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      const qty = parseFloat(newItems[idx].quantity || '0');
      const price = parseFloat(newItems[idx].unitPrice || '0');
      if (qty > 0 && price > 0) {
        newItems[idx].lineTotal = String(Math.round(qty * price));
      }
    }
    setPurchaseItems(newItems);
  };

  // 거래처 품목 빠른 추가
  const addFromCpItem = (cpItem: any) => {
    const newItem: PurchaseItemRow = {
      rawItemName: cpItem.supplierItemName || cpItem.itemName,
      quantity: '',
      unitName: cpItem.purchaseUnit || '개',
      unitPrice: cpItem.lastPrice || cpItem.defaultPrice || '',
      lineTotal: '',
      counterpartyItemId: cpItem.id,
    };
    // 빈 항목이 하나뿐이면 교체, 아니면 추가
    if (purchaseItems.length === 1 && !purchaseItems[0].rawItemName) {
      setPurchaseItems([newItem]);
    } else {
      setPurchaseItems([...purchaseItems, newItem]);
    }
  };

  // ── 1단계: 사진 업로드만 (OCR은 별도) ──────────────────────────────────────
  const handleOcrUpload = async (file: File) => {
    try {
      setOcrProcessing(true);
      setOcrError(null);

      // 원본 파일 그대로 업로드 (서버에서 EXIF 회전 + 리사이즈 처리)
      const formData = new FormData();
      formData.append('photo', file);

      const uploadRes = await fetch('/api/upload/order-image', {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('이미지 업로드 실패');
      const { url } = await uploadRes.json();
      setAttachmentUrl(url);
      setOcrPreviewUrl(url + `?t=${Date.now()}`);
      toast.info('이미지 방향을 확인하세요. 옆으로 보이면 회전 버튼을 누른 후 AI 판독을 시작하세요.');
    } catch (error: any) {
      setOcrError(error.message || '이미지 업로드 실패');
      toast.error(error.message || '이미지 업로드 실패');
    } finally {
      setOcrProcessing(false);
    }
  };

  // ── 2단계: AI OCR 판독 (사용자가 방향 확인 후 실행) ──────────────────────
  const handleOcrAnalyze = async () => {
    if (!attachmentUrl) return;
    try {
      setOcrProcessing(true);
      setOcrError(null);

      const ocrRes = await fetch('/api/ocr/extract-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: attachmentUrl, restaurantId }),
      });

      if (!ocrRes.ok) {
        const errData = await ocrRes.json().catch(() => ({}));
        throw new Error(errData.error || 'OCR 처리 실패');
      }

      const ocrData = await ocrRes.json();

      // OCR 원본 저장 (나중에 사용자 수정 비교용)
      if (ocrData.items && ocrData.items.length > 0) {
        setOcrOriginalItems(ocrData.items);
      }

      // 추출 결과로 폼 프리필
      if (ocrData.counterpartyName) {
        const matched = counterpartiesQuery.data?.find(
          (cp: any) => cp.name.includes(ocrData.counterpartyName) || ocrData.counterpartyName.includes(cp.name)
        );
        if (matched) setCounterpartyId(matched.id);
      }

      if (ocrData.items && ocrData.items.length > 0) {
        setPurchaseItems(
          ocrData.items.map((item: any) => ({
            rawItemName: item.shortName || item.name || '',
            originalName: item.originalName || item.name || '',
            quantity: item.quantity || '',
            unitName: item.unit || '개',
            unitPrice: item.unitPrice || '',
            lineTotal: item.lineTotal || '',
            confidence: item.confidence || 'high',
          }))
        );
        const lowConfCount = ocrData.items.filter((i: any) => i.confidence === 'low').length;
        if (lowConfCount > 0) {
          toast.success(`${ocrData.items.length}개 항목 추출 (${lowConfCount}개 확인 필요)`);
        } else {
          toast.success(`${ocrData.items.length}개 항목이 추출되었습니다.`);
        }
      } else {
        toast.info('항목을 추출하지 못했습니다. 직접 입력해주세요.');
      }

      if (ocrData.note) setNote(ocrData.note);
    } catch (error: any) {
      setOcrError(error.message || 'OCR 처리 중 오류 발생');
      toast.error(error.message || 'OCR 처리 실패');
    } finally {
      setOcrProcessing(false);
    }
  };

  const handleCreate = () => {
    const isOrderMode = inputMode === 'order';
    const isReceiveFromOrder = inputMode === 'receive' && receivingOrderId;

    if (simpleMode) {
      const total = parseFloat(simpleTotalAmount || '0');
      if (!isOrderMode && total <= 0) {
        toast.error('금액을 입력하세요.');
        return;
      }
      if (isReceiveFromOrder) {
        // 입고전환 (간편모드)
        receiveOrderMutation.mutate({
          id: receivingOrderId,
          totalAmount: simpleTotalAmount || '0',
        });
        return;
      }
      createOrder.mutate({
        restaurantId,
        purchaseDate: date,
        counterpartyId,
        status: isOrderMode ? 'ordered' : 'received',
        note: note || undefined,
        attachmentUrl,
        items: [{
          rawItemName: counterpartyId
            ? (counterpartiesQuery.data?.find((cp: any) => cp.id === counterpartyId)?.name || '매입')
            : '매입',
          lineTotal: simpleTotalAmount || '0',
        }],
      });
      return;
    }

    // 상세 모드
    const itemsWithName = purchaseItems.filter(i => i.rawItemName.trim());
    const validItems = isOrderMode
      ? itemsWithName  // 발주: 품명만 있으면 OK (금액 0 허용)
      : itemsWithName.filter(i => parseFloat(i.lineTotal || '0') > 0);  // 입고: 금액 필수

    // 발주: 거래처 또는 품목 또는 사진 중 하나만 있으면 OK
    if (isOrderMode) {
      if (!counterpartyId && validItems.length === 0 && !attachmentUrl) {
        toast.error('거래처, 품목, 또는 발주서 사진 중 하나는 입력하세요.');
        return;
      }
    } else if (validItems.length === 0) {
      toast.error('최소 1개 항목 (품명+금액)을 입력하세요.');
      return;
    }

    if (isReceiveFromOrder) {
      // 입고전환 (상세모드)
      receiveOrderMutation.mutate({
        id: receivingOrderId,
        items: validItems.map(i => ({
          rawItemName: i.rawItemName,
          counterpartyItemId: i.counterpartyItemId,
          quantity: i.quantity || undefined,
          unitName: i.unitName || undefined,
          unitPrice: i.unitPrice || undefined,
          lineTotal: i.lineTotal || '0',
        })),
      });
    } else {
      createOrder.mutate({
        restaurantId,
        purchaseDate: date,
        counterpartyId,
        status: isOrderMode ? 'ordered' : 'received',
        note: note || undefined,
        attachmentUrl,
        items: validItems.map(i => ({
          rawItemName: i.rawItemName,
          counterpartyItemId: i.counterpartyItemId,
          quantity: i.quantity || undefined,
          unitName: i.unitName || undefined,
          unitPrice: i.unitPrice || undefined,
          lineTotal: i.lineTotal || '0',
        })),
      });
    }

    // OCR 수정 데이터 비동기 제출 (품질 개선용, 실패해도 무시)
    if (ocrOriginalItems && attachmentUrl) {
      fetch('/api/ocr/submit-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          counterpartyId: counterpartyId || null,
          imageUrl: attachmentUrl,
          originalItems: ocrOriginalItems,
          correctedItems: validItems.map(i => ({
            rawItemName: i.rawItemName,
            quantity: i.quantity || '',
            unitName: i.unitName || '',
            unitPrice: i.unitPrice || '',
            lineTotal: i.lineTotal || '',
          })),
        }),
      }).catch(() => {});
      setOcrOriginalItems(null);
    }
  };

  const orders = ordersQuery.data || [];
  const counterpartiesList = counterpartiesQuery.data || [];
  const cpItems = cpItemsQuery.data || [];
  const totalAmount = orders.reduce((sum, o: any) => sum + Number(o.totalAmount || 0), 0);
  const formTotal = purchaseItems.reduce((sum, i) => sum + parseFloat(i.lineTotal || '0'), 0);

  return (
    <div className="space-y-4 p-4">
      {/* 매입 탭 체크리스트 */}
      <TabChecklists
        restaurantId={restaurantId}
        date={date}
        targetTab="purchase"
      />

      {/* ─── 일별 매입 현황 ─── */}
      <Card className="bg-card border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">매입 현황</h3>
          <span className="text-sm font-bold text-foreground">₩{totalAmount.toLocaleString()}</span>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">등록된 매입 전표가 없습니다</p>
        ) : (
          <div className="space-y-2">
            {orders.map((order: any) => (
              <div key={order.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-foreground truncate">
                      {order.counterpartyName || '미지정 거래처'}
                    </span>
                    {order.status === 'ordered' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 font-medium">발주</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground tabular-nums">₩{Number(order.totalAmount).toLocaleString()}</span>
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${expandedId === order.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </button>
                {expandedId === order.id && (
                  <div className="px-3 pb-3 border-t border-border pt-2 space-y-1.5">
                    {orderItemsQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">로딩 중...</p>
                    ) : (orderItemsQuery.data || []).map((item: any) => (
                      <div key={item.id} className="flex justify-between text-xs">
                        <span className="text-foreground">{item.rawItemName || item.itemName || '품목'}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {item.quantity && `${item.quantity}${item.unitName ? item.unitName : ''} × `}
                          ₩{Number(item.lineTotal).toLocaleString()}
                        </span>
                      </div>
                    ))}
                    {order.note && <p className="text-xs text-muted-foreground mt-1">메모: {order.note}</p>}
                    <div className="flex justify-end pt-1">
                      <Button variant="ghost" size="sm" onClick={() => deleteOrder.mutate({ id: order.id })} disabled={deleteOrder.isPending}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ─── 발주/입고 입력 버튼 (항상 표시, 토글) ─── */}
      <div className="flex gap-2">
        <Button
          onClick={() => { resetForm(); setInputMode(inputMode === 'order' ? 'none' : 'order'); }}
          variant={inputMode === 'order' ? 'default' : 'secondary'}
          className={`flex-1 h-12 flex gap-2 ${inputMode === 'order' ? 'ring-2 ring-amber-400' : ''}`}
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm font-medium">발주 입력</span>
        </Button>
        <Button
          onClick={() => { resetForm(); setInputMode(inputMode === 'receive' ? 'none' : 'receive'); }}
          variant={inputMode === 'receive' ? 'default' : 'secondary'}
          className={`flex-1 h-12 flex gap-2 ${inputMode === 'receive' ? 'ring-2 ring-blue-400' : ''}`}
        >
          <Check className="w-4 h-4" />
          <span className="text-sm font-medium">입고 입력</span>
        </Button>
      </div>

      {/* ─── 발주/입고 입력 폼 ─── */}
      {inputMode !== 'none' && (
        <Card className={`border p-4 space-y-3 ${inputMode === 'order' ? 'bg-amber-50/30 dark:bg-amber-900/5 border-amber-200 dark:border-amber-800' : 'bg-card border-border'}`}>
          {/* 헤더: 제목 + 간편입력 토글 + 닫기 */}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground text-sm">
              {receivingOrderId ? '입고 전환' : inputMode === 'order' ? '발주 입력' : '입고 입력'}
            </h3>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <span className="text-xs text-muted-foreground">간편입력</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={simpleMode}
                  onClick={() => setSimpleMode(!simpleMode)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${simpleMode ? 'bg-blue-600' : 'bg-muted'}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${simpleMode ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </label>
              <button onClick={resetForm} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 발주 모드 안내 */}
          {inputMode === 'order' && !receivingOrderId && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/20 px-2 py-1 rounded">
              거래처, 품목, 또는 발주서 사진만으로도 등록 가능 — 금액은 입고 시 입력
            </p>
          )}
          {receivingOrderId && (
            <p className="text-[11px] text-green-600 dark:text-green-400 bg-green-100/50 dark:bg-green-900/20 px-2 py-1 rounded">
              발주 #{receivingOrderId} 입고 전환 — 품목을 확인하고 금액을 입력하세요
            </p>
          )}

          {/* 전표 촬영 영역 (항상 표시) */}
          {!ocrPreviewUrl && !ocrProcessing && (
            <label className="flex flex-col items-center border border-dashed border-border rounded-lg p-3 cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-foreground">전표/영수증 촬영 또는 앨범 선택</p>
                  <p className="text-[10px] text-muted-foreground">사진 업로드 시 AI가 자동 입력합니다</p>
                </div>
              </div>
              <div className="mt-2 w-full bg-muted/30 rounded px-2.5 py-1.5 space-y-0.5">
                <p className="text-[10px] text-muted-foreground leading-relaxed">• 한 번에 전표 1장만 촬영/선택해주세요</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">• 거래처, 품목명, 단가, 수량, 합계가 잘 보이게 찍어주세요</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">• 그림자나 빛 반사를 피해주세요</p>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    if (simpleMode) setSimpleMode(false);
                    handleOcrUpload(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
            </label>
          )}

          {/* OCR 처리 중 */}
          {ocrProcessing && (
            <div className="flex flex-col items-center py-6 space-y-2">
              <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-foreground">AI가 전표를 분석 중...</p>
              <p className="text-[10px] text-muted-foreground">품목, 수량, 단가를 자동 추출합니다</p>
            </div>
          )}

          {/* OCR 에러 */}
          {ocrError && (
            <div className="bg-red-500/10 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-600 dark:text-red-400">{ocrError}</p>
              <p className="text-xs text-muted-foreground mt-1">API 키가 설정되지 않았거나 서버 오류입니다.</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setOcrError(null); setOcrPreviewUrl(null); }}>
                다시 촬영
              </Button>
            </div>
          )}

          {/* OCR 미리보기 이미지 + 회전/판독 컨트롤 */}
          {ocrPreviewUrl && !ocrProcessing && (
            <div className="space-y-2">
              <div className="relative">
                <img
                  src={ocrPreviewUrl}
                  alt="전표 이미지"
                  className="w-full rounded-lg border border-border max-h-48 object-contain bg-muted/20 cursor-pointer"
                  onClick={() => setViewerImage(ocrPreviewUrl)}
                />
                <button
                  onClick={() => setViewerImage(ocrPreviewUrl)}
                  className="absolute top-2 left-2 bg-black/50 text-white rounded-full p-1.5"
                  title="확대 보기"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setOcrPreviewUrl(null); setAttachmentUrl(undefined); setPurchaseItems([emptyPurchaseItem()]); }}
                  className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              {/* 회전 + AI 판독 버튼 */}
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!attachmentUrl) return;
                    try {
                      await fetch('/api/upload/rotate-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: attachmentUrl }),
                      });
                      setOcrPreviewUrl(attachmentUrl + `?t=${Date.now()}`);
                    } catch {
                      toast.error('회전 실패');
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  <RotateCw className="w-4 h-4" />
                  90° 회전
                </button>
                <button
                  onClick={handleOcrAnalyze}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <Camera className="w-4 h-4" />
                  AI 판독 시작
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">글씨가 정방향으로 보이는지 확인 후 AI 판독을 시작하세요</p>
            </div>
          )}

          {/* 거래처 선택/입력 (검색 + 신규 생성) */}
          <div className="relative">
            <Label className="text-xs">거래처</Label>
            {counterpartyId ? (
              <div className="mt-1 flex items-center gap-2 h-9 rounded-md border border-border bg-background px-3">
                <span className="text-sm text-foreground flex-1">
                  {counterpartiesList.find((cp: any) => cp.id === counterpartyId)?.name ?? '거래처'}
                </span>
                <button
                  type="button"
                  onClick={() => { setCounterpartyId(undefined); setCpSearchText(''); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={cpSearchText}
                  onChange={(e) => { setCpSearchText(e.target.value); setShowCpDropdown(true); }}
                  onFocus={() => setShowCpDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCpDropdown(false), 200)}
                  placeholder="거래처 검색 또는 입력"
                  className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                />
                {showCpDropdown && (
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
                    {counterpartiesList
                      .filter((cp: any) => !cpSearchText || cp.name.toLowerCase().includes(cpSearchText.toLowerCase()))
                      .map((cp: any) => (
                        <button
                          key={cp.id}
                          type="button"
                          onClick={() => {
                            setCounterpartyId(cp.id);
                            setCpSearchText('');
                            setShowCpDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          {cp.name}
                        </button>
                      ))}
                    {cpSearchText.trim() && !counterpartiesList.some((cp: any) => cp.name === cpSearchText.trim()) && (
                      <button
                        type="button"
                        onClick={() => {
                          createCounterparty.mutate({
                            restaurantId,
                            name: cpSearchText.trim(),
                            counterpartyType: 'supplier',
                          });
                        }}
                        disabled={createCounterparty.isPending}
                        className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors border-t border-border font-medium"
                      >
                        <Plus className="w-3.5 h-3.5 inline mr-1" />
                        "{cpSearchText.trim()}" 새 거래처 등록
                      </button>
                    )}
                    {counterpartiesList.filter((cp: any) => !cpSearchText || cp.name.toLowerCase().includes(cpSearchText.toLowerCase())).length === 0 && !cpSearchText.trim() && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">등록된 거래처가 없습니다</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── 간편입력 모드: 금액만 ── */}
          {simpleMode ? (
            <div>
              <Label className="text-xs">매입 금액</Label>
              <Input
                placeholder="총 금액 입력"
                type="number"
                value={simpleTotalAmount}
                onChange={(e) => setSimpleTotalAmount(e.target.value)}
                className="mt-1 text-sm h-10 text-right font-medium"
                autoFocus
              />
            </div>
          ) : (
            <>
              {/* 거래처 품목 빠른선택 */}
              {counterpartyId && cpItems.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">빠른 품목 추가</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {cpItems.map((cpItem: any) => (
                      <button
                        key={cpItem.id}
                        onClick={() => addFromCpItem(cpItem)}
                        className="text-xs px-2 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-500/20 transition-colors"
                      >
                        {cpItem.supplierItemName || cpItem.itemName}
                        {cpItem.lastPrice && <span className="ml-1 opacity-70">₩{Number(cpItem.lastPrice).toLocaleString()}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 항목 입력 */}
              <div className="space-y-2">
                <Label className="text-xs">매입 항목</Label>
                {purchaseItems.map((item, idx) => {
                  const isLowConf = item.confidence === 'low';
                  const isMedConf = item.confidence === 'medium';
                  const cardBorder = isLowConf
                    ? 'border-red-300 dark:border-red-700 bg-red-50/30 dark:bg-red-900/10'
                    : isMedConf
                      ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-900/10'
                      : ocrPreviewUrl
                        ? 'border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10'
                        : 'border-border bg-card/50';
                  return (
                  <div key={idx} className={`space-y-2 border rounded-lg p-3 ${cardBorder} relative`}>
                    {/* 항목 번호 */}
                    <span className="absolute -top-2 -left-1 bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm">{idx + 1}</span>
                    {/* 신뢰도 배지 */}
                    {(isLowConf || isMedConf) && (
                      <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded w-fit ${isLowConf ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'}`}>
                        <AlertCircle className="w-3 h-3" />
                        {isLowConf ? '판독 불확실 — 확인 필요' : '합계 보정됨 — 확인 필요'}
                      </div>
                    )}
                    {/* 품명 */}
                    <div>
                      <Input
                        placeholder="품명"
                        value={item.rawItemName}
                        onChange={(e) => updateItem(idx, 'rawItemName', e.target.value)}
                        className="w-full text-sm h-9 font-medium"
                      />
                      {item.originalName && item.originalName !== item.rawItemName && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 px-1 truncate">원본: {item.originalName}</p>
                      )}
                    </div>
                    {/* 수량 + 단위 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-muted-foreground mb-0.5 block">수량</span>
                        <Input placeholder="0" type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} className="text-sm h-9" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground mb-0.5 block">단위</span>
                        {UNIT_OPTIONS.includes(item.unitName) && item.unitName !== '직접입력' ? (
                          <select value={item.unitName} onChange={(e) => {
                            if (e.target.value === '직접입력') updateItem(idx, 'unitName', '');
                            else updateItem(idx, 'unitName', e.target.value);
                          }} className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground">
                            {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        ) : (
                          <div className="flex gap-1">
                            <Input placeholder="단위 입력" value={item.unitName} onChange={(e) => updateItem(idx, 'unitName', e.target.value)} className="text-sm h-9 flex-1" />
                            <button onClick={() => updateItem(idx, 'unitName', '개')} className="px-2 h-9 text-xs text-muted-foreground border border-border rounded-md hover:bg-muted" title="목록으로">▼</button>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* 단가 + 합계 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-muted-foreground mb-0.5 block">단가</span>
                        <Input placeholder="0" type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)} className="text-sm h-9" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground mb-0.5 block">합계</span>
                        <Input placeholder="0" type="number" value={item.lineTotal} onChange={(e) => updateItem(idx, 'lineTotal', e.target.value)} className="text-sm h-9 font-semibold" />
                      </div>
                    </div>
                    {/* 삭제 */}
                    <button
                      onClick={() => setPurchaseItems(purchaseItems.filter((_, i) => i !== idx))}
                      className="w-full flex items-center justify-center gap-1 text-xs text-red-400 hover:text-red-500 py-1 border border-dashed border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> 이 항목 삭제
                    </button>
                  </div>
                  );
                })}
                <Button variant="secondary" size="sm" onClick={() => setPurchaseItems([...purchaseItems, emptyPurchaseItem()])} className="w-full">
                  <Plus className="w-3 h-3 mr-1" /> 항목 추가
                </Button>
              </div>
            </>
          )}

          {/* 메모 */}
          <div>
            <Label className="text-xs">메모 (선택)</Label>
            <Input placeholder="메모" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 text-sm h-8" />
          </div>

          {/* 합계 + 저장 */}
          <div className="bg-blue-500/5 p-3 rounded flex justify-between items-center">
            <span className="text-sm font-medium text-foreground">합계:</span>
            <span className="font-bold text-blue-600 tabular-nums">
              ₩{simpleMode ? (parseFloat(simpleTotalAmount || '0')).toLocaleString() : formTotal.toLocaleString()}
            </span>
          </div>

          <Button
            onClick={handleCreate}
            disabled={createOrder.isPending || receiveOrderMutation.isPending}
            className="w-full"
            variant={inputMode === 'order' ? 'secondary' : 'default'}
          >
            {createOrder.isPending || receiveOrderMutation.isPending
              ? '등록 중...'
              : receivingOrderId ? '입고 확인'
              : inputMode === 'order' ? '발주 등록'
              : '입고 등록'}
          </Button>
        </Card>
      )}

      {/* 미입고 발주 전표 요약 (매입탭 최하단) */}
      <PendingOrdersBanner restaurantId={restaurantId} onReceive={startReceiveFromOrder} />

      {/* 이미지 확대보기 모달 */}
      {viewerImage && (
        <ImageViewer src={viewerImage} onClose={() => setViewerImage(null)} />
      )}
    </div>
  );
}

// ============================================================================
// MIDDAY TAB
// ============================================================================

function MiddayTab({
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
      {/* 일간보고 탭 체크리스트 */}
      <TabChecklists
        restaurantId={restaurantId}
        date={date}
        targetTab="midday"
      />

      {/* 중간 매출 */}
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
                    onClick={() => deleteMidSalesMutation.mutate({ id: sale.id })}
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

// ============================================================================
// CLOSE TAB
// ============================================================================

interface OtherItem {
  itemName: string;
  amount: number;
}

interface SpecialItem {
  typeName: string;
  amount: number;
  note?: string;
}

function CloseTab({
  restaurantId,
  date,
}: {
  restaurantId: number;
  date: string;
}) {
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [giftCardAmount, setGiftCardAmount] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDepositor, setTransferDepositor] = useState('');
  const [otherItems, setOtherItems] = useState<OtherItem[]>([]);
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>([]);
  const [closeNote, setCloseNote] = useState('');

  const operationQuery = trpc.dailyOps.getByDate.useQuery({
    restaurantId,
    date,
  });

  // ── 전체 체크리스트 완료 검증 (4탭 모두) ──
  const openTemplates = trpc.storeChecklists.listTemplates.useQuery({ restaurantId, targetTab: 'open', date });
  const purchaseTemplates = trpc.storeChecklists.listTemplates.useQuery({ restaurantId, targetTab: 'purchase', date });
  const middayTemplates = trpc.storeChecklists.listTemplates.useQuery({ restaurantId, targetTab: 'midday', date });
  const closeTemplates = trpc.storeChecklists.listTemplates.useQuery({ restaurantId, targetTab: 'close', date });
  const openLog = trpc.storeChecklists.getLog.useQuery({ restaurantId, logDate: date, targetTab: 'open' });
  const purchaseLog = trpc.storeChecklists.getLog.useQuery({ restaurantId, logDate: date, targetTab: 'purchase' });
  const middayLog = trpc.storeChecklists.getLog.useQuery({ restaurantId, logDate: date, targetTab: 'midday' });
  const closeLog = trpc.storeChecklists.getLog.useQuery({ restaurantId, logDate: date, targetTab: 'close' });

  const checklistStatus = useMemo(() => {
    const tabs = [
      { key: 'open', label: '오픈', templates: openTemplates.data ?? [], log: openLog.data },
      { key: 'purchase', label: '매입', templates: purchaseTemplates.data ?? [], log: purchaseLog.data },
      { key: 'midday', label: '일간보고', templates: middayTemplates.data ?? [], log: middayLog.data },
      { key: 'close', label: '마감', templates: closeTemplates.data ?? [], log: closeLog.data },
    ];
    const incomplete: string[] = [];
    let totalItems = 0;
    let totalChecked = 0;
    for (const tab of tabs) {
      const total = tab.templates.length;
      if (total === 0) continue;
      const checked = (tab.log?.checkedItemIds as number[] ?? []).length;
      totalItems += total;
      totalChecked += checked;
      if (checked < total) incomplete.push(tab.label);
    }
    return { incomplete, totalItems, totalChecked, allDone: incomplete.length === 0 && totalItems > 0 };
  }, [
    openTemplates.data, purchaseTemplates.data, middayTemplates.data, closeTemplates.data,
    openLog.data, purchaseLog.data, middayLog.data, closeLog.data,
  ]);

  const midSalesQuery = trpc.dailyOps.getMidSales.useQuery({
    restaurantId,
    date,
  });

  const salesQuery = trpc.dailyOps.getDailySales.useQuery({
    restaurantId,
    date,
  });

  const templatesQuery = trpc.dailyOps.getOtherItemTemplates.useQuery({
    restaurantId,
  });

  const saveSalesMutation = trpc.dailyOps.saveDailySales.useMutation({
    onSuccess: () => {
      toast.success('매출이 저장되었습니다.');
      salesQuery.refetch();
    },
    onError: (error: any) => {
      toast.error(`저장 실패: ${error.message}`);
    },
  });



  // Initialize from saved sales
  useEffect(() => {
    if (salesQuery.data) {
      const fmtSaved = (v: any) => { const n = Number(v); return n ? fmtNum(n) : ''; };
      setCashAmount(fmtSaved(salesQuery.data.cashAmount));
      setCardAmount(fmtSaved(salesQuery.data.cardAmount));
      setGiftCardAmount(fmtSaved(salesQuery.data.giftCardAmount));
      setTransferAmount(fmtSaved(salesQuery.data.transferAmount));
      setTransferDepositor(salesQuery.data.transferDepositor || '');
      setOtherItems((salesQuery.data.otherItems || []).map((i: any) => ({
        itemName: i.itemName,
        amount: typeof i.amount === 'string' ? parseInt(i.amount, 10) : i.amount,
      })));
      setSpecialItems((salesQuery.data.specialItems || []).map((i: any) => ({
        typeName: i.typeName,
        amount: typeof i.amount === 'string' ? parseInt(i.amount, 10) : i.amount,
        note: i.note || undefined,
      })));
      setCloseNote(salesQuery.data.note || '');
    }
  }, [salesQuery.data]);

  const handleSaveSales = async () => {
    const cash = parseNum(cashAmount);
    const card = parseNum(cardAmount);
    const giftCard = parseNum(giftCardAmount);
    const transfer = parseNum(transferAmount);

    saveSalesMutation.mutate({
      restaurantId,
      date,
      cashAmount: cash,
      cardAmount: card,
      giftCardAmount: giftCard,
      transferAmount: transfer,
      transferDepositor: transferDepositor || undefined,
      otherItems,
      specialItems,
      note: closeNote || undefined,
    });
  };

  const midSalesTotal = (midSalesQuery.data || []).reduce(
    (sum: number, sale: any) => sum + sale.amount,
    0
  );

  const totalAmount =
    (parseNum(cashAmount) +
      parseNum(cardAmount) +
      parseNum(giftCardAmount) +
      parseNum(transferAmount) +
      otherItems.reduce((sum, item) => sum + item.amount, 0));

  const templates = templatesQuery.data || [];

  return (
    <div className="space-y-4 p-4">
      {/* 마감 탭 체크리스트 */}
      <TabChecklists
        restaurantId={restaurantId}
        date={date}
        targetTab="close"
      />

      {/* 금일 운영 확인 */}
      <Card className="bg-card border-border p-4">
        <h3 className="font-semibold text-foreground mb-4">금일 운영 확인</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">오픈 시간:</span>
            <span className="text-foreground">
              {operationQuery.data?.openCheckedAt ? fmtTs(operationQuery.data.openCheckedAt) : '미확인'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">금일 출근 인원:</span>
            <span className="text-foreground">
              {operationQuery.data?.openHeadcount || 0}명
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">중간 매출:</span>
            <span className="text-foreground">₩{midSalesTotal.toLocaleString()}</span>
          </div>
        </div>
      </Card>

      {/* ─── 근무 스케줄 요약 ─── */}
      <ClosingScheduleSummary restaurantId={restaurantId} date={date} />

      {/* 매출 입력 */}
      <Card className="bg-card border-border p-4">
        <h3 className="font-semibold text-foreground mb-4">매출 입력</h3>
        <div className="space-y-3 mb-4">
          <div>
            <Label htmlFor="cash" className="text-sm">
              현금 매출
            </Label>
            <Input
              id="cash"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={cashAmount}
              onChange={(e) => setCashAmount(handleWonInput(e.target.value))}
              className="mt-1 text-right"
            />
          </div>
          <div>
            <Label htmlFor="card" className="text-sm">
              카드 매출
            </Label>
            <Input
              id="card"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={cardAmount}
              onChange={(e) => setCardAmount(handleWonInput(e.target.value))}
              className="mt-1 text-right"
            />
          </div>
          <div>
            <Label htmlFor="giftcard" className="text-sm">
              상품권 매출
            </Label>
            <Input
              id="giftcard"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={giftCardAmount}
              onChange={(e) => setGiftCardAmount(handleWonInput(e.target.value))}
              className="mt-1 text-right"
            />
          </div>
          <div>
            <Label htmlFor="transfer" className="text-sm">
              계좌이체 매출
            </Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="transfer"
                type="text"
                inputMode="numeric"
                placeholder="금액"
                value={transferAmount}
                onChange={(e) => setTransferAmount(handleWonInput(e.target.value))}
                className="flex-1 text-right"
              />
              <Input
                placeholder="입금자명"
                value={transferDepositor}
                onChange={(e) => setTransferDepositor(e.target.value)}
                className="w-28"
              />
            </div>
          </div>

          {/* 기타 매출 */}
          <div className="border-t border-border pt-3">
            <Label className="text-sm">기타 매출</Label>
            {otherItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 mt-2">
                <Input
                  placeholder="항목명"
                  value={item.itemName}
                  onChange={(e) => {
                    const newItems = [...otherItems];
                    newItems[idx].itemName = e.target.value;
                    setOtherItems(newItems);
                  }}
                  className="text-sm h-8"
                />
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="금액"
                  value={item.amount ? fmtNum(item.amount) : ''}
                  onChange={(e) => {
                    const newItems = [...otherItems];
                    newItems[idx].amount = parseNum(e.target.value);
                    setOtherItems(newItems);
                  }}
                  className="text-sm h-8 w-28 text-right"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOtherItems(otherItems.filter((_, i) => i !== idx));
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}

            {templates.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {templates.map((template: any) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      setOtherItems([
                        ...otherItems,
                        { itemName: template.itemName, amount: 0 },
                      ]);
                    }}
                    className="text-xs px-2 py-1 bg-blue-500/10 text-blue-600 border border-blue-200 rounded hover:bg-blue-500/20"
                  >
                    + {template.itemName}
                  </button>
                ))}
              </div>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOtherItems([...otherItems, { itemName: '', amount: 0 }])}
              className="w-full mt-2"
            >
              <Plus className="w-4 h-4 mr-2" /> 항목 추가
            </Button>
          </div>

          {/* 매출 특이사항 */}
          <div className="border-t border-border pt-3">
            <Label className="text-sm">매출 특이사항</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {['할인', '외상', '미입금', '기타'].map((type) => (
                <Button
                  key={type}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSpecialItems([...specialItems, { typeName: type, amount: 0 }]);
                  }}
                >
                  + {type}
                </Button>
              ))}
            </div>

            {specialItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 mt-2">
                <Input
                  placeholder="유형"
                  value={item.typeName}
                  onChange={(e) => {
                    const newItems = [...specialItems];
                    newItems[idx].typeName = e.target.value;
                    setSpecialItems(newItems);
                  }}
                  className="text-sm h-8 w-20"
                />
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="금액"
                  value={item.amount ? fmtNum(item.amount) : ''}
                  onChange={(e) => {
                    const newItems = [...specialItems];
                    newItems[idx].amount = parseNum(e.target.value);
                    setSpecialItems(newItems);
                  }}
                  className="text-sm h-8 w-28 text-right"
                />
                <Input
                  placeholder="메모"
                  value={item.note || ''}
                  onChange={(e) => {
                    const newItems = [...specialItems];
                    newItems[idx].note = e.target.value;
                    setSpecialItems(newItems);
                  }}
                  className="text-sm h-8"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSpecialItems(specialItems.filter((_, i) => i !== idx));
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* 메모 */}
          <div className="border-t border-border pt-3">
            <Label htmlFor="close-note" className="text-sm">
              매출 메모
            </Label>
            <Textarea
              id="close-note"
              placeholder="특이사항, 메모 등"
              value={closeNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCloseNote(e.target.value)}
              className="mt-1 text-sm h-20"
            />
          </div>

          {/* 합계 */}
          <div className="border-t border-border pt-3 bg-blue-500/5 p-3 rounded">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-foreground">합계:</span>
              <span className="text-lg font-bold text-blue-600">
                {fmtNum(totalAmount)}원
              </span>
            </div>
          </div>

          <Button
            onClick={handleSaveSales}
            disabled={saveSalesMutation.isPending}
            className="w-full"
          >
            {saveSalesMutation.isPending ? '저장 중...' : '매출 저장'}
          </Button>
        </div>
      </Card>

      {/* ─── 일마감 손익 + 마감 확정 (통합) ─── */}
      <ClosingProfitSection
        restaurantId={restaurantId}
        date={date}
        closeNote={closeNote}
        checklistAllDone={checklistStatus.allDone}
        checklistStatus={checklistStatus}
        alreadyCloseChecked={!!operationQuery.data?.closeCheckedAt}
      />
    </div>
  );
}

// ============================================================================
// CLOSING SCHEDULE SUMMARY – 요약형 (금일운영확인 아래 배치)
// ============================================================================

const SHIFT_LABELS: Record<string, string> = { open: '오픈', close: '마감', full: '풀타임' };



function ClosingScheduleSummary({ restaurantId, date }: { restaurantId: number; date: string }) {
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data: daySchedules = [], isLoading } = trpc.schedules.getDaySchedules.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  const completeDay = trpc.schedules.completeDay.useMutation({
    onSuccess(data: any) {
      toast.success(`${data.affected}건 근무완료 처리됨`);
      utils.schedules.getDaySchedules.invalidate();
    },
    onError(err: any) { toast.error(err.message); },
  });

  const completeOne = trpc.schedules.completeOne.useMutation({
    onSuccess() {
      toast.success('완료 처리됨');
      utils.schedules.getDaySchedules.invalidate();
    },
    onError(err: any) { toast.error(err.message); },
  });

  if (isLoading) return null;

  const confirmed = daySchedules.filter((s: any) => s.status === 'confirmed');
  const completed = daySchedules.filter((s: any) => s.status === 'completed');
  const draft = daySchedules.filter((s: any) => s.status === 'draft');
  const total = daySchedules.length;

  if (total === 0) return null;

  return (
    <Card className="bg-card border-border p-4 space-y-2">
      {/* 요약 헤더 (항상 표시) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-foreground text-sm">근무 스케줄</span>
          <span className="text-xs text-muted-foreground">({total}명)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px]">
            {completed.length > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">완료 {completed.length}</span>}
            {confirmed.length > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-medium">확정 {confirmed.length}</span>}
            {draft.length > 0 && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-medium">초안 {draft.length}</span>}
          </div>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </button>

      {/* 펼친 상세 (접이식) */}
      {expanded && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="space-y-1.5">
            {daySchedules.map((s: any) => {
              const isConfirmed = s.status === 'confirmed';
              const isCompleted = s.status === 'completed';
              const isDraft = s.status === 'draft';
              return (
                <div
                  key={s.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${
                    isCompleted
                      ? 'bg-emerald-500/10 border-emerald-200 dark:border-emerald-800'
                      : isDraft
                      ? 'bg-muted/30 border-border opacity-60'
                      : 'bg-card border-border'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : isDraft ? (
                      <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    )}
                    <span className="font-medium text-foreground truncate">
                      {s.userName ?? s.tempWorkerName ?? '미배정'}
                      {s.tempWorkerName && <span className="text-orange-500 ml-1 text-xs">(임시)</span>}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {fmtTs(s.startTime)}~{fmtTs(s.endTime)}
                      {s.shiftPreset && <span className="ml-1 opacity-70">({SHIFT_LABELS[s.shiftPreset] ?? s.shiftPreset})</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isCompleted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">완료</span>
                    )}
                    {isDraft && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-medium">초안</span>
                    )}
                    {isConfirmed && (
                      <button
                        onClick={(e) => { e.stopPropagation(); completeOne.mutate({ id: s.id }); }}
                        disabled={completeOne.isPending}
                        className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-medium hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                      >
                        완료처리
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 하단 액션 버튼 */}
          <div className="flex gap-2 pt-2">
            {confirmed.length > 0 && (
              <button
                onClick={() => completeDay.mutate({ restaurantId, date })}
                disabled={completeDay.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                전체 완료 처리 ({confirmed.length}건)
              </button>
            )}
            <button
              onClick={() => setLocation('/schedule')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium border border-border bg-muted/50 text-foreground hover:bg-muted transition-colors ${confirmed.length > 0 ? '' : 'flex-1'}`}
            >
              <Pencil className="w-4 h-4" />
              스케줄 수정
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// CLOSING PROFIT SECTION – 일마감 손익 요약
// ============================================================================

function ClosingProfitSection({ restaurantId, date, closeNote, checklistAllDone, checklistStatus, alreadyCloseChecked }: {
  restaurantId: number;
  date: string;
  closeNote?: string;
  checklistAllDone: boolean;
  checklistStatus: { totalChecked: number; totalItems: number; incomplete: string[] };
  alreadyCloseChecked: boolean;
}) {
  const [laborCost, setLaborCost] = useState('0');
  const [closingNote, setClosingNote] = useState('');
  const utils = trpc.useUtils();

  const { data: calculated, isLoading: calcLoading } = trpc.dailyClosings.calculateDay.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  const { data: existing } = trpc.dailyClosings.getByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  const dateObj = new Date(date);
  const daysInMonth = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
  const { data: fixedTotal } = trpc.fixedCosts.monthlyTotal.useQuery(
    { restaurantId, year: dateObj.getFullYear(), month: dateObj.getMonth() + 1 },
    { enabled: restaurantId > 0 }
  );
  const dailyFixed = fixedTotal ? Math.round(Number(fixedTotal.total) / daysInMonth) : 0;

  useEffect(() => {
    if (existing) {
      setLaborCost(existing.laborCost ?? '0');
      setClosingNote(existing.note ?? '');
    } else {
      setLaborCost('0');
      setClosingNote('');
    }
  }, [existing]);

  const save = trpc.dailyClosings.save.useMutation({
    onSuccess(data: any) {
      toast.success(data.updated ? '마감 수정 완료' : '마감 저장 완료');
      utils.dailyClosings.getByDate.invalidate();
      utils.dailyClosings.listByMonth.invalidate();
      utils.dailyClosings.monthlySummary.invalidate();
    },
    onError(err: any) { toast.error(err.message); },
  });

  const checkCloseMutation = trpc.dailyOps.checkClose.useMutation({
    onSuccess() {
      utils.dailyOps.getByDate.invalidate();
    },
  });

  if (calcLoading) return null;

  const salesTotal = calculated?.salesTotal ?? '0';
  const purchasesTotal = calculated?.purchasesTotal ?? '0';
  const profit = Number(salesTotal) - Number(purchasesTotal) - Number(laborCost) - dailyFixed;

  // 마감 불가 조건: 체크리스트 미완료
  const canClose = checklistStatus.totalItems === 0 || checklistAllDone;

  const handleSaveClosing = () => {
    save.mutate({
      restaurantId,
      closingDate: date,
      salesTotal,
      purchasesTotal,
      laborCost,
      fixedCostShare: String(dailyFixed),
      profit: String(profit),
      note: closingNote || undefined,
    });
    // 마감 체크도 동시 실행 (아직 안 된 경우만)
    if (!alreadyCloseChecked) {
      checkCloseMutation.mutate({
        restaurantId,
        date,
        closeNote: closeNote || undefined,
      });
    }
  };

  return (
    <Card className="bg-card border-border p-4 space-y-3">
      <h3 className="font-semibold text-foreground text-sm">일마감 손익</h3>

      {existing && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-lg">
          <Check className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">마감 완료됨 — 수정 가능</span>
        </div>
      )}

      {/* 자동 집계 */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-muted/30 rounded-lg p-2.5">
          <span className="text-xs text-muted-foreground">매출</span>
          <div className="font-semibold text-foreground tabular-nums">{Number(salesTotal).toLocaleString()}원</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-2.5">
          <span className="text-xs text-muted-foreground">매입</span>
          <div className="font-semibold text-foreground tabular-nums">{Number(purchasesTotal).toLocaleString()}원</div>
        </div>
      </div>

      {/* 인건비 */}
      <div>
        <Label className="text-xs">인건비 (원)</Label>
        <Input
          type="number"
          value={laborCost}
          onChange={(e) => setLaborCost(e.target.value)}
          className="mt-1 text-sm h-9"
        />
      </div>

      {/* 고정비 */}
      <div className="text-xs text-muted-foreground">
        고정비 (일할): {dailyFixed.toLocaleString()}원
        <span className="ml-1 opacity-70">({Number(fixedTotal?.total ?? 0).toLocaleString()}원 ÷ {daysInMonth}일)</span>
      </div>

      {/* 손익 */}
      <div className={`p-3 rounded-lg ${profit >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">손익</span>
          <span className={`text-xl font-bold tabular-nums ${profit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}>
            {profit >= 0 ? '+' : ''}{profit.toLocaleString()}원
          </span>
        </div>
      </div>

      {/* 메모 */}
      <Input
        value={closingNote}
        onChange={(e) => setClosingNote(e.target.value)}
        placeholder="마감 메모 (선택)"
        className="text-sm h-9"
      />

      {/* 체크리스트 미완료 경고 */}
      {!canClose && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-3">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            체크리스트 미완료 ({checklistStatus.totalChecked}/{checklistStatus.totalItems})
          </p>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
            미완료 탭: {checklistStatus.incomplete.join(', ')}
          </p>
        </div>
      )}

      <Button
        onClick={handleSaveClosing}
        disabled={save.isPending || checkCloseMutation.isPending || (!existing && !canClose)}
        className="w-full"
        size="lg"
      >
        {save.isPending || checkCloseMutation.isPending
          ? '저장 중...'
          : !canClose && !existing
            ? `체크리스트 완료 후 마감 가능 (${checklistStatus.totalChecked}/${checklistStatus.totalItems})`
            : existing
              ? '마감 수정'
              : alreadyCloseChecked
                ? '마감 확정'
                : '마감 확정'}
      </Button>
    </Card>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

type TabType = 'open' | 'purchase' | 'midday' | 'close';

export default function DailyOpsPage() {
  const { selectedRestaurant } = useRestaurant();
  const [date, setDate] = useState(formatDate(new Date(), 'yyyy-MM-dd'));
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
          <h1 className="text-2xl font-bold text-foreground mb-3">
            {selectedRestaurant.name}
          </h1>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm h-9"
            />
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="sticky top-[88px] z-10 bg-background/95 backdrop-blur border-b border-border">
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
            <PurchaseTab restaurantId={selectedRestaurant.id} date={date} />
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
