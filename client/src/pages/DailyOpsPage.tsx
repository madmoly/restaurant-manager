import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatDate } from 'date-fns';
import { useLocation, useSearch } from 'wouter';
import { trpc } from '../lib/trpc';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { resizeImage, OCR_HIGH } from '@/lib/imageResize';
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
  ZoomOut,
  Pencil,
  Minus,
  RotateCw,
  RotateCcw,
  Search,
  ChevronLeft,
  ChevronRight,
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
// 이미지 확대보기 모달 (핀치줌 + 버튼 줌 + 드래그 이동)
// ============================================================================
function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const lastTouchDist = useRef<number | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);

  const zoomIn = () => setScale(s => Math.min(s + 0.5, 5));
  const zoomOut = () => { setScale(s => { const ns = Math.max(s - 0.5, 1); if (ns === 1) setPos({ x: 0, y: 0 }); return ns; }); };
  const resetZoom = () => { setScale(1); setPos({ x: 0, y: 0 }); };

  // 마우스 드래그
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPos({ x: dragStart.current.posX + (e.clientX - dragStart.current.x), y: dragStart.current.posY + (e.clientY - dragStart.current.y) });
  };
  const onMouseUp = () => setDragging(false);

  // 터치 핀치줌 + 드래그
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1 && scale > 1) {
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, posX: pos.x, posY: pos.y };
      setDragging(true);
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = (dist - lastTouchDist.current) * 0.01;
      setScale(s => Math.min(Math.max(s + delta, 1), 5));
      lastTouchDist.current = dist;
    } else if (e.touches.length === 1 && dragging) {
      setPos({ x: dragStart.current.posX + (e.touches[0].clientX - dragStart.current.x), y: dragStart.current.posY + (e.touches[0].clientY - dragStart.current.y) });
    }
  };
  const onTouchEnd = () => { lastTouchDist.current = null; setDragging(false); };

  // 더블클릭/더블탭 토글
  const onDoubleClick = () => { if (scale > 1) resetZoom(); else setScale(2.5); };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* 상단 바: 줌 컨트롤 + 닫기 */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/60 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="p-2 rounded-lg bg-white/10 active:bg-white/20 text-white disabled:opacity-30" disabled={scale <= 1}>
            <ZoomOut className="w-5 h-5" />
          </button>
          <button onClick={resetZoom} className="px-3 py-1.5 rounded-lg bg-white/10 active:bg-white/20 text-white text-xs font-mono min-w-[48px] text-center">
            {Math.round(scale * 100)}%
          </button>
          <button onClick={zoomIn} className="p-2 rounded-lg bg-white/10 active:bg-white/20 text-white disabled:opacity-30" disabled={scale >= 5}>
            <ZoomIn className="w-5 h-5" />
          </button>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-white/10 active:bg-white/20 text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      {/* 이미지 영역 */}
      <div
        ref={imgRef}
        className="flex-1 flex items-center justify-center overflow-hidden select-none"
        style={{ cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in', touchAction: 'none' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={onDoubleClick}
      >
        <img
          src={src}
          alt="확대 이미지"
          className="max-w-full max-h-full object-contain transition-transform duration-100"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transformOrigin: 'center center' }}
          draggable={false}
        />
      </div>
      {/* 하단 힌트 */}
      {scale <= 1 && (
        <p className="text-center text-white/40 text-[10px] py-1.5">더블탭으로 확대 · 핀치로 줌</p>
      )}
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
  // ref로 최신 상태 추적 (클로저 문제 방지)
  const textRef = useRef(textValues);
  textRef.current = textValues;
  const photoRef = useRef(photoValues);
  photoRef.current = photoValues;

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

  const checklistUtils = trpc.useUtils();
  const saveLogMutation = trpc.storeChecklists.saveLog.useMutation({
    onSuccess: () => {
      // 마감탭 체크리스트 완료 상태 실시간 갱신
      checklistUtils.storeChecklists.getLog.invalidate({ restaurantId, logDate: date });
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

  const doSave = (ids: number[], txtOverride?: Record<number, string>, photoOverride?: Record<number, string>) => {
    const txt = txtOverride ?? textRef.current;
    const pht = photoOverride ?? photoRef.current;
    const updatedCheckedItems = templatesQuery.data
      ?.filter((item) => ids.includes(item.id))
      .map((item) => ({
        itemId: item.id,
        answer: txt[item.id] || undefined,
        photoUrl: pht[item.id] || undefined,
      })) || [];
    saveLogMutation.mutate({
      restaurantId, logDate: date, targetTab,
      checkedItemIds: ids, checkedItems: updatedCheckedItems,
    });
  };

  const handleToggleItem = (itemId: number) => {
    setCheckedItemIds((prev) => {
      const next = prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId];
      doSave(next);
      return next;
    });
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
        setPhotoValues((prev) => {
          const next = { ...prev, [itemId]: dataUrl };
          doSave(checkedItemIds, undefined, next);
          return next;
        });
      };
      reader.readAsDataURL(resized);
    } catch (error) {
      toast.error('이미지 처리 실패');
    }
  };

  const saveCurrentState = () => doSave(checkedItemIds);

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
                        autoComplete="off"
                        value={textValues[item.id] || ''}
                        onChange={(e) => handleTextChange(item.id, e.target.value)}
                        onBlur={() => saveCurrentState()}
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

      {/* 자동저장 — 체크/텍스트blur/사진 시 즉시 저장 */}
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
// PURCHASE TAB – 발주(사진+메모) / 입고(발주선택→확인) / 즉시지출
// ============================================================================

type PurchaseInputMode = 'none' | 'order' | 'receive' | 'expense';

// ─── PendingOrdersBanner: 미입고 발주 알림 (입고탭 전환용) ──────────────
function PendingOrdersBanner({ restaurantId, onSwitchToReceive }: { restaurantId: number; onSwitchToReceive?: () => void }) {
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
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600">대기</Badge>
        </div>
      ))}
      {onSwitchToReceive && (
        <Button size="sm" variant="outline" className="w-full h-7 text-xs mt-1 border-green-300 text-green-600" onClick={onSwitchToReceive}>
          <Check className="w-3 h-3 mr-1" /> 입고 처리하기
        </Button>
      )}
    </Card>
  );
}

// ─── PurchaseTab 본체: 발주등록 / 입고확인 / 즉시지출 ────────────────────────
function PurchaseTab({
  restaurantId,
  date,
  onDateChange,
}: {
  restaurantId: number;
  date: string;
  onDateChange?: (newDate: string) => void;
}) {
  const [inputMode, setInputMode] = useState<PurchaseInputMode>('none');

  // ── 발주 등록 state ──
  const [orderNote, setOrderNote] = useState('');
  const [orderAttachment, setOrderAttachment] = useState<string | undefined>(undefined);
  const [orderCounterpartyId, setOrderCounterpartyId] = useState<number | undefined>(undefined);
  const [orderUploading, setOrderUploading] = useState(false);

  // ── 입고 확인 state ──
  const [selectedReceiveId, setSelectedReceiveId] = useState<number | null>(null);
  const [receiveAmount, setReceiveAmount] = useState('');

  // ── 즉시지출 state ──
  const [expCategoryId, setExpCategoryId] = useState<number>(0);
  const [expTitle, setExpTitle] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');
  const [expAttachment, setExpAttachment] = useState<string | undefined>(undefined);
  const [expUploading, setExpUploading] = useState(false);

  // ── 공통 ──
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  // ── Queries ──
  const ordersQuery = trpc.purchasesV2.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const counterpartiesQuery = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const pendingQuery = trpc.purchasesV2.pendingOrders.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const expensesQuery = trpc.dailyExpenses.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const categoriesQuery = trpc.dailyExpenses.listCategories.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const orderItemsQuery = trpc.purchasesV2.getOrderItems.useQuery(
    { orderId: expandedId! },
    { enabled: expandedId !== null },
  );

  // 카테고리 시드 (최초 1회)
  const seedMut = trpc.dailyExpenses.seedDefaultCategories.useMutation({
    onSuccess: () => categoriesQuery.refetch(),
  });
  const categories = categoriesQuery.data || [];
  if (categories.length === 0 && !categoriesQuery.isLoading && restaurantId > 0 && !seedMut.isPending) {
    seedMut.mutate({ restaurantId });
  }

  // ── Mutations ──
  const createOrderMut = trpc.purchasesV2.createOrder.useMutation({
    onSuccess() {
      toast.success('발주가 등록되었습니다.');
      utils.purchasesV2.listByDate.invalidate();
      utils.purchasesV2.pendingOrders.invalidate();
      resetForm();
    },
    onError(err: any) { toast.error(`등록 실패: ${err.message}`); },
  });

  const receiveOrderMut = trpc.purchasesV2.receiveOrder.useMutation({
    onSuccess() {
      toast.success('입고 확인 완료');
      utils.purchasesV2.listByDate.invalidate();
      utils.purchasesV2.pendingOrders.invalidate();
      resetForm();
    },
    onError(err: any) { toast.error(`입고 확인 실패: ${err.message}`); },
  });

  const deleteOrderMut = trpc.purchasesV2.deleteOrder.useMutation({
    onSuccess() {
      toast.success('삭제됨');
      utils.purchasesV2.listByDate.invalidate();
      utils.purchasesV2.pendingOrders.invalidate();
      setExpandedId(null);
    },
    onError(err: any) { toast.error(`삭제 실패: ${err.message}`); },
  });

  const createExpenseMut = trpc.dailyExpenses.create.useMutation({
    onSuccess() {
      toast.success('즉시지출이 등록되었습니다.');
      utils.dailyExpenses.listByDate.invalidate();
      resetForm();
    },
    onError(err: any) { toast.error(`등록 실패: ${err.message}`); },
  });

  const deleteExpenseMut = trpc.dailyExpenses.delete.useMutation({
    onSuccess() {
      toast.success('삭제됨');
      utils.dailyExpenses.listByDate.invalidate();
    },
    onError(err: any) { toast.error(`삭제 실패: ${err.message}`); },
  });

  const resetForm = () => {
    setInputMode('none');
    setOrderNote('');
    setOrderAttachment(undefined);
    setOrderCounterpartyId(undefined);
    setOrderUploading(false);
    setSelectedReceiveId(null);
    setReceiveAmount('');
    setExpCategoryId(0);
    setExpTitle('');
    setExpAmount('');
    setExpNote('');
    setExpAttachment(undefined);
    setExpUploading(false);
  };

  // ── 사진 업로드 공통 핸들러 ──
  const handlePhotoUpload = async (
    file: File,
    setUrl: (url: string | undefined) => void,
    setUploading: (v: boolean) => void,
  ) => {
    try {
      setUploading(true);
      const resized = await resizeImage(file, OCR_HIGH);
      const formData = new FormData();
      formData.append('photo', resized);
      const res = await fetch('/api/upload/order-image', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('업로드 실패');
      const { url } = await res.json();
      setUrl(url);
    } catch (err: any) {
      toast.error(err.message || '사진 업로드 실패');
    } finally {
      setUploading(false);
    }
  };

  // ── 발주 등록 핸들러 ──
  const handleOrderSubmit = () => {
    if (!orderAttachment && !orderNote.trim()) {
      toast.error('발주 사진 또는 메모를 입력하세요.');
      return;
    }
    createOrderMut.mutate({
      restaurantId,
      purchaseDate: date,
      counterpartyId: orderCounterpartyId,
      status: 'ordered',
      note: orderNote || undefined,
      attachmentUrl: orderAttachment,
      items: [],
    });
  };

  // ── 입고 확인 핸들러 ──
  const handleReceiveSubmit = () => {
    if (!selectedReceiveId) {
      toast.error('입고할 발주를 선택하세요.');
      return;
    }
    receiveOrderMut.mutate({
      id: selectedReceiveId,
      totalAmount: receiveAmount ? String(parseNum(receiveAmount)) : undefined,
    });
  };

  // ── 즉시지출 등록 핸들러 ──
  const handleExpenseSubmit = () => {
    if (!expTitle.trim()) {
      toast.error('지출 내역을 입력하세요.');
      return;
    }
    const amt = parseNum(expAmount);
    if (amt <= 0) {
      toast.error('금액을 입력하세요.');
      return;
    }
    createExpenseMut.mutate({
      restaurantId,
      date,
      categoryId: expCategoryId > 0 ? expCategoryId : undefined,
      title: expTitle,
      amount: String(amt),
      note: expNote || undefined,
      attachmentUrl: expAttachment,
    });
  };

  const orders = ordersQuery.data || [];
  const expenses = expensesQuery.data || [];
  const counterpartiesList = counterpartiesQuery.data || [];
  const pending = pendingQuery.data || [];
  const receivedOrders = orders.filter((o: any) => o.status === 'received');
  const orderedOrders = orders.filter((o: any) => o.status !== 'received');
  const totalReceived = receivedOrders.reduce((sum, o: any) => sum + Number(o.totalAmount || 0), 0);
  const totalExpenses = expenses.reduce((sum, e: any) => sum + Number(e.amount || 0), 0);

  return (
    <div className="space-y-4 p-4">
      {/* 매입 탭 체크리스트 */}
      <TabChecklists restaurantId={restaurantId} date={date} targetTab="purchase" />

      {/* ─── 일별 매입 현황 ─── */}
      <Card className="bg-card border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">매입 현황</h3>
            {orderedOrders.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 font-medium">
                미입고 {orderedOrders.length}건
              </span>
            )}
          </div>
          <span className="text-sm font-bold text-foreground">입고 ₩{totalReceived.toLocaleString()}</span>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">등록된 매입 내역이 없습니다</p>
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
                      {order.counterpartyName || '미지정'}
                    </span>
                    {order.status === 'ordered' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 font-medium shrink-0">발주</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium shrink-0">입고</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {Number(order.totalAmount) > 0 && (
                      <span className="font-medium text-foreground tabular-nums">₩{Number(order.totalAmount).toLocaleString()}</span>
                    )}
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${expandedId === order.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </button>
                {expandedId === order.id && (
                  <div className="px-3 pb-3 border-t border-border pt-2 space-y-1.5">
                    {orderItemsQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">로딩 중...</p>
                    ) : (orderItemsQuery.data || []).length > 0 ? (
                      (orderItemsQuery.data || []).map((item: any) => (
                        <div key={item.id} className="flex justify-between text-xs">
                          <span className="text-foreground">{item.rawItemName || item.itemName || '품목'}</span>
                          <span className="text-muted-foreground tabular-nums">₩{Number(item.lineTotal).toLocaleString()}</span>
                        </div>
                      ))
                    ) : null}
                    {order.note && <p className="text-xs text-muted-foreground mt-1">메모: {order.note}</p>}
                    {order.attachmentUrl && (
                      <img
                        src={order.attachmentUrl}
                        alt="첨부"
                        className="w-full max-h-32 object-contain rounded border border-border cursor-pointer mt-1"
                        onClick={() => setViewerImage(order.attachmentUrl)}
                      />
                    )}
                    <div className="flex justify-end pt-1">
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('이 기록을 삭제할까요?')) deleteOrderMut.mutate({ id: order.id }); }} disabled={deleteOrderMut.isPending}>
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

      {/* ─── 즉시지출 현황 ─── */}
      {expenses.length > 0 && (
        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">즉시지출</h3>
            <span className="text-sm font-bold text-foreground">₩{totalExpenses.toLocaleString()}</span>
          </div>
          <div className="space-y-2">
            {expenses.map((exp: any) => (
              <div key={exp.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{exp.title}</span>
                  {exp.categoryName && (
                    <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{exp.categoryName}</span>
                  )}
                  {exp.note && <p className="text-xs text-muted-foreground mt-0.5 truncate">{exp.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-medium tabular-nums">₩{Number(exp.amount).toLocaleString()}</span>
                  {exp.attachmentUrl && (
                    <button onClick={() => setViewerImage(exp.attachmentUrl)} className="text-blue-500">
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { if (confirm('삭제할까요?')) deleteExpenseMut.mutate({ id: exp.id }); }} disabled={deleteExpenseMut.isPending}>
                    <Trash2 className="w-3 h-3 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── 3버튼: 발주등록 / 입고확인 / 즉시지출 ─── */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => { resetForm(); setInputMode(inputMode === 'order' ? 'none' : 'order'); }}
          className={`h-12 flex flex-col items-center justify-center rounded-lg text-xs font-bold transition-all border-2 ${
            inputMode === 'order'
              ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-300 shadow-md'
              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
          }`}
        >
          <Camera className="w-4 h-4 mb-0.5" />
          발주등록
        </button>
        <button
          onClick={() => { resetForm(); setInputMode(inputMode === 'receive' ? 'none' : 'receive'); }}
          className={`h-12 flex flex-col items-center justify-center rounded-lg text-xs font-bold transition-all border-2 ${
            inputMode === 'receive'
              ? 'bg-emerald-600 text-white border-emerald-700 ring-2 ring-emerald-300 shadow-md'
              : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
          }`}
        >
          <Check className="w-4 h-4 mb-0.5" />
          입고확인
        </button>
        <button
          onClick={() => { resetForm(); setInputMode(inputMode === 'expense' ? 'none' : 'expense'); }}
          className={`h-12 flex flex-col items-center justify-center rounded-lg text-xs font-bold transition-all border-2 ${
            inputMode === 'expense'
              ? 'bg-blue-600 text-white border-blue-700 ring-2 ring-blue-300 shadow-md'
              : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
          }`}
        >
          <Plus className="w-4 h-4 mb-0.5" />
          즉시지출
        </button>
      </div>

      {/* ═══════════════ 발주등록 폼 ═══════════════ */}
      {inputMode === 'order' && (
        <Card className="bg-amber-50/30 dark:bg-amber-900/5 border-amber-200 dark:border-amber-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground text-sm">발주 등록</h3>
            <button onClick={resetForm} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/20 px-2 py-1 rounded">
            발주서 사진 + 메모만 등록합니다. 입고 시 금액/품목을 입력하세요.
          </p>

          {/* 거래처 선택 (선택사항) */}
          <div>
            <Label className="text-xs">거래처 (선택)</Label>
            <select
              value={orderCounterpartyId || ''}
              onChange={(e) => setOrderCounterpartyId(e.target.value ? Number(e.target.value) : undefined)}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="">미지정</option>
              {counterpartiesList.map((cp: any) => (
                <option key={cp.id} value={cp.id}>{cp.name}</option>
              ))}
            </select>
          </div>

          {/* 사진 업로드 */}
          {orderAttachment ? (
            <div className="space-y-2">
              <img
                src={orderAttachment}
                alt="발주서"
                className="w-full max-h-48 object-contain rounded border border-border cursor-pointer"
                onClick={() => setViewerImage(orderAttachment)}
              />
              <div className="flex justify-between">
                <button onClick={() => setViewerImage(orderAttachment)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <ZoomIn className="w-3.5 h-3.5" /> 확대
                </button>
                <button onClick={() => setOrderAttachment(undefined)} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                  <X className="w-3.5 h-3.5" /> 삭제
                </button>
              </div>
            </div>
          ) : orderUploading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">업로드 중...</span>
            </div>
          ) : (
            <label className="flex flex-col items-center border border-dashed border-amber-300 dark:border-amber-700 rounded-lg p-4 cursor-pointer hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors">
              <Camera className="w-6 h-6 text-amber-500 mb-1" />
              <p className="text-xs font-medium text-foreground">발주서 사진 촬영/선택</p>
              <p className="text-[10px] text-muted-foreground">증빙용 사진을 첨부하세요</p>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                if (e.target.files?.[0]) handlePhotoUpload(e.target.files[0], setOrderAttachment, setOrderUploading);
              }} />
            </label>
          )}

          {/* 메모 */}
          <div>
            <Label className="text-xs">메모</Label>
            <Textarea
              placeholder="발주 내용, 요청사항 등"
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              className="mt-1 text-sm min-h-[60px]"
            />
          </div>

          <button
            onClick={handleOrderSubmit}
            disabled={createOrderMut.isPending}
            className="w-full py-3 rounded-lg text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
          >
            {createOrderMut.isPending ? '등록 중...' : '발주 등록'}
          </button>
        </Card>
      )}

      {/* ═══════════════ 입고확인 폼 ═══════════════ */}
      {inputMode === 'receive' && (
        <Card className="bg-emerald-50/30 dark:bg-emerald-900/5 border-emerald-200 dark:border-emerald-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground text-sm">입고 확인</h3>
            <button onClick={resetForm} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>

          {pending.length === 0 ? (
            <div className="text-center py-6">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">미입고 발주가 없습니다</p>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-100/50 dark:bg-emerald-900/20 px-2 py-1 rounded">
                입고할 발주를 선택하세요
              </p>
              <div className="space-y-2">
                {pending.map((order: any) => (
                  <button
                    key={order.id}
                    onClick={() => setSelectedReceiveId(selectedReceiveId === order.id ? null : order.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border-2 transition-all ${
                      selectedReceiveId === order.id
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-1 ring-emerald-300'
                        : 'border-border hover:border-emerald-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedReceiveId === order.id ? 'border-emerald-500 bg-emerald-500' : 'border-muted-foreground'
                        }`}>
                          {selectedReceiveId === order.id && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="font-medium text-sm text-foreground">{order.counterpartyName || '미지정'}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtShortDate(order.purchaseDate, true)}</span>
                    </div>
                    {order.note && <p className="text-xs text-muted-foreground mt-1 ml-7 truncate">{order.note}</p>}
                  </button>
                ))}
              </div>

              {selectedReceiveId && (
                <div>
                  <Label className="text-xs">입고 금액 (선택)</Label>
                  <Input
                    placeholder="금액 미입력 시 0원으로 처리"
                    value={receiveAmount}
                    onChange={(e) => setReceiveAmount(handleWonInput(e.target.value))}
                    className="mt-1 text-sm h-10 text-right font-medium"
                    inputMode="numeric"
                  />
                </div>
              )}

              <button
                onClick={handleReceiveSubmit}
                disabled={!selectedReceiveId || receiveOrderMut.isPending}
                className="w-full py-3 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
              >
                {receiveOrderMut.isPending ? '처리 중...' : '입고 확인'}
              </button>
            </>
          )}
        </Card>
      )}

      {/* ═══════════════ 즉시지출 폼 ═══════════════ */}
      {inputMode === 'expense' && (
        <Card className="bg-blue-50/30 dark:bg-blue-900/5 border-blue-200 dark:border-blue-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground text-sm">즉시지출 등록</h3>
            <button onClick={resetForm} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-100/50 dark:bg-blue-900/20 px-2 py-1 rounded">
            인터넷발주, 수리비, 소모품 등 발주/입고와 별개의 지출을 기록합니다
          </p>

          {/* 카테고리 */}
          <div>
            <Label className="text-xs">분류</Label>
            <select
              value={expCategoryId}
              onChange={(e) => setExpCategoryId(Number(e.target.value))}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value={0}>분류 선택</option>
              {categories.map((cat: any) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {/* 내역 */}
          <div>
            <Label className="text-xs">내역</Label>
            <Input
              placeholder="지출 내역 (예: 쿠팡 세제, 화장실 수리)"
              value={expTitle}
              onChange={(e) => setExpTitle(e.target.value)}
              className="mt-1 text-sm h-9"
            />
          </div>

          {/* 금액 */}
          <div>
            <Label className="text-xs">금액</Label>
            <Input
              placeholder="0"
              value={expAmount}
              onChange={(e) => setExpAmount(handleWonInput(e.target.value))}
              className="mt-1 text-sm h-10 text-right font-medium"
              inputMode="numeric"
            />
          </div>

          {/* 메모 */}
          <div>
            <Label className="text-xs">메모 (선택)</Label>
            <Input
              placeholder="메모"
              value={expNote}
              onChange={(e) => setExpNote(e.target.value)}
              className="mt-1 text-sm h-8"
            />
          </div>

          {/* 증빙사진 */}
          {expAttachment ? (
            <div className="space-y-2">
              <img
                src={expAttachment}
                alt="증빙"
                className="w-full max-h-36 object-contain rounded border border-border cursor-pointer"
                onClick={() => setViewerImage(expAttachment)}
              />
              <div className="flex justify-end">
                <button onClick={() => setExpAttachment(undefined)} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                  <X className="w-3.5 h-3.5" /> 삭제
                </button>
              </div>
            </div>
          ) : expUploading ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-xs text-muted-foreground">업로드 중...</span>
            </div>
          ) : (
            <label className="flex items-center gap-2 border border-dashed border-blue-300 dark:border-blue-700 rounded-lg p-3 cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors">
              <Camera className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-xs font-medium text-foreground">증빙사진 첨부 (선택)</p>
                <p className="text-[10px] text-muted-foreground">영수증, 결제내역 등</p>
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                if (e.target.files?.[0]) handlePhotoUpload(e.target.files[0], setExpAttachment, setExpUploading);
              }} />
            </label>
          )}

          <button
            onClick={handleExpenseSubmit}
            disabled={createExpenseMut.isPending}
            className="w-full py-3 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {createExpenseMut.isPending ? '등록 중...' : `즉시지출 등록${expAmount ? ` (₩${expAmount})` : ''}`}
          </button>
        </Card>
      )}

      {/* 미입고 발주 배너 */}
      <PendingOrdersBanner restaurantId={restaurantId} onSwitchToReceive={() => { resetForm(); setInputMode('receive'); }} />

      {/* ─── 금일 입고/발주 없음 확인 ─── */}
      <NoPurchaseConfirmation restaurantId={restaurantId} date={date} hasPurchases={orders.length > 0 || expenses.length > 0} />

      {/* 이미지 확대보기 모달 */}
      {viewerImage && (
        <ImageViewer src={viewerImage} onClose={() => setViewerImage(null)} />
      )}
    </div>
  );
}

// ============================================================================
// NO PURCHASE CONFIRMATION – 금일 입고/발주 없음 확인
// ============================================================================

function NoPurchaseConfirmation({ restaurantId, date, hasPurchases }: {
  restaurantId: number;
  date: string;
  hasPurchases: boolean;
}) {
  const purchaseLog = trpc.storeChecklists.getLog.useQuery({
    restaurantId,
    logDate: date,
    targetTab: 'purchase',
  });

  const saveLogMutation = trpc.storeChecklists.saveLog.useMutation({
    onSuccess: () => {
      toast.success('금일 입고/발주 없음이 확인되었습니다.');
      purchaseLog.refetch();
    },
    onError: (error: any) => {
      toast.error(`저장 실패: ${error.message}`);
    },
  });

  const isNoOrder = purchaseLog.data?.noOrderToday === true;

  // 매입 내역이 있으면 표시 불필요
  if (hasPurchases) return null;

  const handleConfirm = () => {
    const existingCheckedIds = (purchaseLog.data?.checkedItemIds as number[]) ?? [];
    saveLogMutation.mutate({
      restaurantId,
      logDate: date,
      targetTab: 'purchase',
      checkedItemIds: existingCheckedIds,
      noOrderToday: true,
    });
  };

  const handleCancel = () => {
    const existingCheckedIds = (purchaseLog.data?.checkedItemIds as number[]) ?? [];
    saveLogMutation.mutate({
      restaurantId,
      logDate: date,
      targetTab: 'purchase',
      checkedItemIds: existingCheckedIds,
      noOrderToday: false,
    });
  };

  if (isNoOrder) {
    return (
      <Card className="bg-emerald-500/10 border-emerald-200 dark:border-emerald-800 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">금일 입고/발주 없음 확인됨</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saveLogMutation.isPending}>
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={handleConfirm}
      disabled={saveLogMutation.isPending}
      className="w-full h-11 border-dashed border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-foreground/50"
    >
      <Minus className="w-4 h-4 mr-2" />
      금일 입고/발주 없음
    </Button>
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
      // 현재 템플릿 ID와 로그의 체크 ID 교집합으로 비교 (템플릿 추가/삭제 대응)
      const templateIds = new Set(tab.templates.map((t: any) => t.id));
      const logChecked = (tab.log?.checkedItemIds as number[] ?? []).filter(id => templateIds.has(id));
      totalItems += total;
      totalChecked += logChecked.length;
      if (logChecked.length < total) incomplete.push(tab.label);
    }
    return { incomplete, totalItems, totalChecked, allDone: incomplete.length === 0 && totalItems > 0 };
  }, [
    openTemplates.data, purchaseTemplates.data, middayTemplates.data, closeTemplates.data,
    openLog.data, purchaseLog.data, middayLog.data, closeLog.data,
  ]);

  // ── 매입 확인 상태 (입고 내역 or 입고없음 확인) ──
  const purchaseOrdersQuery = trpc.purchasesV2.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const purchaseConfirmed = useMemo(() => {
    const hasPurchases = (purchaseOrdersQuery.data ?? []).length > 0;
    const noOrderConfirmed = purchaseLog.data?.noOrderToday === true;
    return hasPurchases || noOrderConfirmed;
  }, [purchaseOrdersQuery.data, purchaseLog.data]);

  // ── 스케줄 완료 상태 ──
  const daySchedulesQuery = trpc.schedules.getDaySchedules.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const scheduleStatus = useMemo(() => {
    const schedules = daySchedulesQuery.data ?? [];
    if (schedules.length === 0) return { allDone: true, total: 0, completed: 0, confirmed: 0, draft: 0 };
    const completed = schedules.filter((s: any) => s.status === 'completed').length;
    const confirmed = schedules.filter((s: any) => s.status === 'confirmed').length;
    const draft = schedules.filter((s: any) => s.status === 'draft').length;
    // confirmed는 마감 시 자동 완료되므로, draft만 없으면 OK
    return { allDone: draft === 0, total: schedules.length, completed, confirmed, draft };
  }, [daySchedulesQuery.data]);

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

  const utils = trpc.useUtils();
  const saveSalesMutation = trpc.dailyOps.saveDailySales.useMutation({
    onSuccess: () => {
      toast.success('매출이 저장되었습니다.');
      salesQuery.refetch();
      // 마감탭 매출/손익 갱신 → 마감 조건 재평가
      utils.dailyClosings.calculateDay.invalidate();
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
              autoComplete="off"
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
              autoComplete="off"
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
              autoComplete="off"
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
                autoComplete="off"
                value={transferAmount}
                onChange={(e) => setTransferAmount(handleWonInput(e.target.value))}
                className="flex-1 text-right"
              />
              <Input
                placeholder="입금자명"
                autoComplete="off"
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
                  autoComplete="off"
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
                  autoComplete="off"
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
        purchaseConfirmed={purchaseConfirmed}
        scheduleStatus={scheduleStatus}
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
  const [expanded, setExpanded] = useState(true);
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

function ClosingProfitSection({ restaurantId, date, closeNote, checklistAllDone, checklistStatus, purchaseConfirmed, scheduleStatus, alreadyCloseChecked }: {
  restaurantId: number;
  date: string;
  closeNote?: string;
  checklistAllDone: boolean;
  checklistStatus: { totalChecked: number; totalItems: number; incomplete: string[] };
  purchaseConfirmed: boolean;
  scheduleStatus: { allDone: boolean; total: number; completed: number; confirmed: number; draft: number };
  alreadyCloseChecked: boolean;
}) {
  const [laborCost, setLaborCost] = useState('0');
  const [closingNote, setClosingNote] = useState('');
  const utils = trpc.useUtils();

  // 미입고 발주 건수 확인
  const purchaseOrdersQuery = trpc.purchasesV2.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );
  const pendingOrderCount = (purchaseOrdersQuery.data ?? []).filter((o: any) => o.status !== 'received').length;

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
    } else if (calculated?.laborCost) {
      // 신규 마감: 스케줄 기반 자동 계산된 인건비 반영
      setLaborCost(calculated.laborCost);
      setClosingNote('');
    } else {
      setLaborCost('0');
      setClosingNote('');
    }
  }, [existing, calculated]);

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

  const completeDayMut = trpc.schedules.completeDay.useMutation();

  // 휴무일 확인 (지정 휴무 + 정기 휴무 요일) — Hook은 조건부 return 전에 선언
  const closedDaysQuery = trpc.storeClosures.listByMonth.useQuery(
    { restaurantId, year: dateObj.getFullYear(), month: dateObj.getMonth() + 1 },
    { enabled: restaurantId > 0 }
  );
  const weeklyClosuresQuery = trpc.storeClosures.getWeeklyClosures.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );
  const isClosedDay = useMemo(() => {
    const specificClosed = (closedDaysQuery.data ?? []).some(
      (d: any) => (typeof d.closedDate === 'string' ? d.closedDate : d.closedDate?.toISOString?.()?.slice(0, 10)) === date
    );
    if (specificClosed) return true;
    const dayOfWeek = dateObj.getDay();
    return (weeklyClosuresQuery.data ?? []).some((w: any) => w.weekday === dayOfWeek);
  }, [closedDaysQuery.data, weeklyClosuresQuery.data, date]);

  if (calcLoading) return null;

  const salesTotal = calculated?.salesTotal ?? '0';
  const purchasesTotal = calculated?.purchasesTotal ?? '0';
  const profit = Number(salesTotal) - Number(purchasesTotal) - Number(laborCost) - dailyFixed;

  // 마감 불가 조건: 체크리스트 + 매입확인 + 스케줄(draft 없어야 함) + 매출0 검증
  const checklistOk = checklistStatus.totalItems === 0 || checklistAllDone;
  const scheduleOk = scheduleStatus.allDone; // draft === 0
  const salesZero = !isClosedDay && Number(salesTotal) === 0;
  const canClose = checklistOk && purchaseConfirmed && scheduleOk;

  const handleSaveClosing = () => {
    if (salesZero && !existing) {
      if (!window.confirm('매출이 0원입니다. 매출 0원으로 마감하시겠습니까?')) return;
    }
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
    // confirmed 스케줄 → completed 자동 처리
    if (scheduleStatus.confirmed > 0) {
      completeDayMut.mutate({ restaurantId, date });
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
        <div className="flex items-center gap-2">
          <Label className="text-xs">인건비 (원)</Label>
          {!existing && calculated?.laborCost && Number(calculated.laborCost) > 0 && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400">스케줄 자동계산</span>
          )}
        </div>
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

      {/* 마감 불가 사유 경고 */}
      {!canClose && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-3 space-y-1">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">마감 전 완료 필요 항목</p>
          {!checklistOk && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              · 체크리스트 미완료 ({checklistStatus.totalChecked}/{checklistStatus.totalItems}) — {checklistStatus.incomplete.join(', ')}
            </p>
          )}
          {!purchaseConfirmed && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              · 매입 미확인 — 매입탭에서 입고 등록 또는 "입고/발주 없음" 확인 필요
            </p>
          )}
          {!scheduleOk && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              · 미확정 스케줄 {scheduleStatus.draft}건 — <a href={`/schedule?date=${date}`} className="underline font-medium hover:text-amber-800">스케줄 수정</a> (초안 상태는 마감 불가)
            </p>
          )}
        </div>
      )}

      {/* 매출 0원 안내 (휴무일 아닌 경우) */}
      {salesZero && !existing && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-700 p-3">
          <p className="text-[11px] text-orange-700 dark:text-orange-300">
            ⚠ 매출이 0원입니다. 마감 확정 시 확인 메시지가 표시됩니다.
          </p>
        </div>
      )}

      {/* 미입고 발주 경고 (차단은 아님, 안내) */}
      {pendingOrderCount > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-700 p-3">
          <p className="text-[11px] text-blue-700 dark:text-blue-300">
            ⚠ 미입고 발주 {pendingOrderCount}건이 있습니다. 발주 상태의 매입은 정산에 반영되지 않습니다.
          </p>
        </div>
      )}

      {/* confirmed 스케줄 자동완료 안내 */}
      {canClose && !existing && scheduleStatus.confirmed > 0 && (
        <p className="text-[11px] text-blue-600 dark:text-blue-400">
          확정 스케줄 {scheduleStatus.confirmed}건이 마감 시 자동으로 완료 처리됩니다.
        </p>
      )}

      <Button
        onClick={handleSaveClosing}
        disabled={save.isPending || checkCloseMutation.isPending || completeDayMut.isPending || (!existing && !canClose)}
        className="w-full"
        size="lg"
      >
        {save.isPending || checkCloseMutation.isPending || completeDayMut.isPending
          ? '저장 중...'
          : !canClose && !existing
            ? '마감 조건 충족 후 확정 가능'
            : existing
              ? '마감 수정'
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
