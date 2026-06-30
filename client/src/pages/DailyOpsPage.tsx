import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatDate } from 'date-fns';
import { useLocation, useSearch } from 'wouter';
import { trpc } from '../lib/trpc';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { resizeImage, OCR_HIGH } from '@/lib/imageResize';
import { formatDateWithHoliday, getHolidayName } from '@/lib/koreanHolidays';
import { formatKRW } from '@/lib/utils';
import { calcHeadcountWeight } from '@/lib/scheduleHelpers';
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
  Loader2,
  Copy,
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

  // 초기화 가드: (restaurantId, date, targetTab) 조합이 바뀔 때만 서버값으로 재초기화
  // — 그렇지 않으면 매 save→refetch마다 로컬 state가 덮어쓰여 체크박스가 점멸함
  const initKeyRef = useRef<string>('');
  const initKey = `${restaurantId}|${date}|${targetTab}`;

  // 저장 쓰로틀: 빠른 연타 시 마지막 요청만 전송
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{
    ids: number[];
    txt: Record<number, string>;
    pht: Record<number, string>;
  } | null>(null);

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
    onSuccess: (_data, variables) => {
      // 캐시를 로컬 낙관값으로 직접 갱신 — refetch 대신 직접 주입하여 useEffect 재트리거 방지
      checklistUtils.storeChecklists.getLog.setData(
        { restaurantId, logDate: date, targetTab },
        (old: any) => ({
          ...(old ?? {
            id: 0,
            restaurantId,
            logDate: date,
            targetTab,
            checkType: null,
            noOrderToday: false,
          }),
          checkedItemIds: variables.checkedItemIds,
          checkedItems: variables.checkedItems ?? [],
          completedAt: new Date(),
        }),
      );
    },
    onError: (error: any) => {
      toast.error(`저장 실패: ${error.message}`);
      // 실패 시에만 서버 값으로 복구
      checklistUtils.storeChecklists.getLog.invalidate({ restaurantId, logDate: date, targetTab });
    },
  });

  // Initialize from log data — 키 조합이 바뀔 때만 최초 1회
  useEffect(() => {
    if (initKeyRef.current === initKey) return;
    if (logQuery.isLoading) return;

    initKeyRef.current = initKey;

    if (logQuery.data?.checkedItemIds) {
      setCheckedItemIds(logQuery.data.checkedItemIds);
      const newTextValues: Record<number, string> = {};
      const newPhotoValues: Record<number, string> = {};
      logQuery.data.checkedItems?.forEach((item: any) => {
        if (item.textValue || item.answer) {
          newTextValues[item.itemId] = item.textValue ?? item.answer;
        }
        if (item.photoUrl) newPhotoValues[item.itemId] = item.photoUrl;
      });
      setTextValues(newTextValues);
      setPhotoValues(newPhotoValues);
    } else {
      setCheckedItemIds([]);
      setTextValues({});
      setPhotoValues({});
    }
  }, [initKey, logQuery.data, logQuery.isLoading]);

  const flushSave = () => {
    const payload = pendingSaveRef.current;
    if (!payload) return;
    pendingSaveRef.current = null;
    const updatedCheckedItems = (templatesQuery.data ?? [])
      .filter((item) => payload.ids.includes(item.id))
      .map((item) => ({
        itemId: item.id,
        answer: payload.txt[item.id] || undefined,
        photoUrl: payload.pht[item.id] || undefined,
      }));
    saveLogMutation.mutate({
      restaurantId, logDate: date, targetTab,
      checkedItemIds: payload.ids, checkedItems: updatedCheckedItems,
    });
  };

  const doSave = (ids: number[], txtOverride?: Record<number, string>, photoOverride?: Record<number, string>) => {
    pendingSaveRef.current = {
      ids,
      txt: txtOverride ?? textRef.current,
      pht: photoOverride ?? photoRef.current,
    };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, 250); // 250ms trailing debounce
  };

  // 언마운트 시 보류 중 저장 flush
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        flushSave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const _biz = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayStr = `${_biz.getFullYear()}-${String(_biz.getMonth() + 1).padStart(2, "0")}-${String(_biz.getDate()).padStart(2, "0")}`;
  const isToday = date === todayStr;

  return (
    <Card className={`p-4 ${isToday ? "bg-primary/5 border-primary/30" : "bg-card border-border"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className={`text-lg font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
            {dateInfo.display}
          </p>
          {isToday && (
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">오늘</span>
          )}
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
        <span className="font-medium text-foreground">{formatKRW(data.totalSales || 0)}</span>
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
        최근 8주 {dayName}요일 평균: <span className="font-bold text-foreground">{formatKRW(data.avg ?? 0)}</span>
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

// OCR 분석 실패 사유 → 사용자 노출 문구 (서버 reason 필드 매핑)
const OCR_REASON_LABEL: Record<string, string> = {
  rate_limited: '분석 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.',
  parse_failed: '전표 판독에 실패했습니다. 다시 촬영하거나 직접 입력해주세요.',
  upstream_error: '일시적인 분석 오류입니다. 잠시 후 다시 시도해주세요.',
  timeout: '분석이 너무 오래 걸려 중단되었습니다. 잠시 후 다시 시도해주세요.',
  network_error: '연결이 끊겼습니다. 네트워크 상태를 확인하고 다시 시도해주세요.',
};
const MAX_OCR_AUTO_RETRY = 2;
const OCR_RETRY_DELAYS_MS = [2000, 5000];
const OCR_ANALYZE_TIMEOUT_MS = 70_000;

interface PurchaseItemRow {
  rawItemName: string;
  spec?: string;          // 규격 (용량/중량/사이즈)
  originalName?: string;  // OCR 원본 전체명칭
  quantity: string;
  unitName: string;
  unitPrice: string;
  lineTotal: string;
  counterpartyItemId?: number;
  confidence?: string;
  matchedItemId?: number;
  matchedItemName?: string;
  itemCandidates?: { itemId: number; itemName: string; score: number; source: string }[];
}

function emptyPurchaseItem(): PurchaseItemRow {
  return { rawItemName: '', quantity: '', unitName: '개', unitPrice: '', lineTotal: '' };
}

type PurchaseInputMode = 'none' | 'order' | 'receive' | 'expense';

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
  onDateChange,
}: {
  restaurantId: number;
  date: string;
  onDateChange?: (newDate: string) => void;
}) {
  // ── 발주 메모 state ──
  const [showMemoForm, setShowMemoForm] = useState(false);
  const [memoCounterpartyId, setMemoCounterpartyId] = useState<number | undefined>(undefined);
  const [memoCpText, setMemoCpText] = useState('');
  const [showMemoCpDropdown, setShowMemoCpDropdown] = useState(false);
  const [memoContent, setMemoContent] = useState('');
  const [memoAttachment, setMemoAttachment] = useState<string | undefined>(undefined);
  const [memoUploading, setMemoUploading] = useState(false);

  // ── OCR 전표 입력 state ──
  const [showOcrSection, setShowOcrSection] = useState(false);
  const [counterpartyId, setCounterpartyId] = useState<number | undefined>(undefined);
  const [cpSearchText, setCpSearchText] = useState('');
  const [showCpDropdown, setShowCpDropdown] = useState(false);
  const [cpCandidates, setCpCandidates] = useState<{ id: number; name: string; score: number }[]>([]);
  const [note, setNote] = useState('');
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItemRow[]>([emptyPurchaseItem()]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | undefined>(undefined);

  // OCR 상태
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrOriginalItems, setOcrOriginalItems] = useState<any[] | null>(null);
  const [ocrRotation, setOcrRotation] = useState(0);
  const [ocrStep, setOcrStep] = useState<'idle' | 'uploaded' | 'analyzed'>('idle');
  const [ocrDateSuggestion, setOcrDateSuggestion] = useState<string | null>(null);
  const ocrRetryRef = useRef(0);
  const ocrRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  // 품목 Combobox 상태 (행 인덱스별)
  const [itemDropdownIdx, setItemDropdownIdx] = useState<number | null>(null);
  const [itemSearchText, setItemSearchText] = useState<Record<number, string>>({});

  // ── 즉시지출 state ──
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expCategoryId, setExpCategoryId] = useState<number>(0);
  const [expTitle, setExpTitle] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');
  const [expAttachment, setExpAttachment] = useState<string | undefined>(undefined);
  const [expUploading, setExpUploading] = useState(false);

  const utils = trpc.useUtils();

  // ── 발주 메모 queries ──
  const memosQuery = trpc.purchasesV2.listMemosByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const unreceivedQuery = trpc.purchasesV2.listUnreceived.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  // ── 기존 매입(전표) queries ──
  const ordersQuery = trpc.purchasesV2.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );

  const counterpartiesQuery = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const orderItemsQuery = trpc.purchasesV2.getOrderItems.useQuery(
    { restaurantId, orderId: expandedId! },
    { enabled: expandedId !== null && restaurantId > 0 },
  );

  // 거래처 선택 시 해당 품목 로드
  const cpItemsQuery = trpc.counterpartyItems.listByCounterparty.useQuery(
    { counterpartyId: counterpartyId! },
    { enabled: counterpartyId !== undefined && counterpartyId > 0 },
  );

  // 마스터 품목 목록 (Combobox용)
  const allItemsQuery = trpc.items.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  // ── 즉시지출 queries ──
  const expensesQuery = trpc.dailyExpenses.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const categoriesQuery = trpc.dailyExpenses.listCategories.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const categories = categoriesQuery.data || [];
  const expenses = expensesQuery.data || [];
  const totalExpenses = expenses.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);

  // 카테고리 시드 (최초 1회) — 렌더 본문 mutation 호출 금지, useEffect로 격리
  const seedCatMut = trpc.dailyExpenses.seedDefaultCategories.useMutation({
    onSuccess: () => categoriesQuery.refetch(),
  });
  const seedAttemptedRef = useRef(false);
  useEffect(() => {
    seedAttemptedRef.current = false;
  }, [restaurantId]);
  useEffect(() => () => {
    if (ocrRetryTimerRef.current) clearTimeout(ocrRetryTimerRef.current);
  }, []);
  useEffect(() => {
    if (
      restaurantId > 0 &&
      !categoriesQuery.isLoading &&
      (categoriesQuery.data?.length ?? 0) === 0 &&
      !seedCatMut.isPending &&
      !seedAttemptedRef.current
    ) {
      seedAttemptedRef.current = true;
      seedCatMut.mutate({ restaurantId });
    }
  }, [restaurantId, categoriesQuery.isLoading, categoriesQuery.data, seedCatMut]);

  // ── 발주 메모 mutations ──
  const createMemoMut = trpc.purchasesV2.createMemo.useMutation({
    onSuccess() {
      toast.success('발주 메모가 등록되었습니다.');
      utils.purchasesV2.listMemosByDate.invalidate();
      resetMemoForm();
    },
    onError(err: any) { toast.error(`등록 실패: ${err.message}`); },
  });

  const toggleReceivedMut = trpc.purchasesV2.toggleReceived.useMutation({
    onSuccess() {
      toast.success('입고 상태가 변경되었습니다.');
      utils.purchasesV2.listMemosByDate.invalidate();
      utils.purchasesV2.listUnreceived.invalidate();
    },
    onError(err: any) { toast.error(`변경 실패: ${err.message}`); },
  });

  const deleteOrder = trpc.purchasesV2.deleteOrder.useMutation({
    onSuccess() {
      toast.success('삭제됨');
      utils.purchasesV2.listByDate.invalidate();
      utils.purchasesV2.listMemosByDate.invalidate();
      utils.purchasesV2.listUnreceived.invalidate();
      setExpandedId(null);
    },
    onError(err: any) { toast.error(`삭제 실패: ${err.message}`); },
  });

  // ── 즉시지출 mutations ──
  const createExpenseMut = trpc.dailyExpenses.create.useMutation({
    onSuccess() {
      toast.success('즉시지출이 등록되었습니다.');
      utils.dailyExpenses.listByDate.invalidate();
      setExpCategoryId(0);
      setExpTitle('');
      setExpAmount('');
      setExpNote('');
      setExpAttachment(undefined);
      setShowExpenseForm(false);
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

  // ── OCR 전표 저장 mutation ──
  const createOrder = trpc.purchasesV2.createOrder.useMutation({
    onSuccess() {
      toast.success('입고가 등록되었습니다.');
      utils.purchasesV2.listByDate.invalidate();
      resetOcrForm();
    },
    onError(err: any) { toast.error(`등록 실패: ${err.message}`); },
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

  const createCounterpartyForMemo = trpc.counterparties.create.useMutation({
    onSuccess(data: any) {
      setMemoCounterpartyId(data.id);
      setMemoCpText('');
      setShowMemoCpDropdown(false);
      utils.counterparties.list.invalidate();
      toast.success('거래처가 등록되었습니다');
    },
    onError(err: any) { toast.error(`거래처 등록 실패: ${err.message}`); },
  });

  // ── 즉시지출 사진 업로드 ──
  const handleExpensePhotoUpload = async (file: File) => {
    try {
      setExpUploading(true);
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch('/api/upload/order-image', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('업로드 실패');
      const { url } = await res.json();
      setExpAttachment(url);
    } catch (err: any) {
      toast.error(err.message || '사진 업로드 실패');
    } finally {
      setExpUploading(false);
    }
  };

  // ── 즉시지출 등록 핸들러 ──
  const handleExpenseSubmit = () => {
    if (!expTitle.trim()) { toast.error('지출 내역을 입력하세요.'); return; }
    const amt = parseNum(expAmount);
    if (amt <= 0) { toast.error('금액을 입력하세요.'); return; }
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

  // ── 발주 메모 폼 리셋 ──
  const resetMemoForm = () => {
    setShowMemoForm(false);
    setMemoCounterpartyId(undefined);
    setMemoCpText('');
    setShowMemoCpDropdown(false);
    setMemoContent('');
    setMemoAttachment(undefined);
  };

  // ── 발주 메모 사진 업로드 ──
  const handleMemoPhotoUpload = async (file: File) => {
    try {
      setMemoUploading(true);
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch('/api/upload/order-image', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('업로드 실패');
      const { url } = await res.json();
      setMemoAttachment(url);
    } catch (err: any) {
      toast.error(err.message || '사진 업로드 실패');
    } finally {
      setMemoUploading(false);
    }
  };

  // ── 발주 메모 등록 핸들러 ──
  const handleMemoSubmit = () => {
    if (!memoContent.trim()) { toast.error('발주 내용을 입력하세요.'); return; }
    if (!memoCounterpartyId && !memoCpText.trim()) { toast.error('거래처를 선택하거나 입력하세요.'); return; }
    createMemoMut.mutate({
      restaurantId,
      counterpartyId: memoCounterpartyId,
      counterpartyName: memoCounterpartyId ? undefined : memoCpText.trim(),
      content: memoContent,
      attachmentUrl: memoAttachment,
      purchaseDate: date,
    });
  };

  // ── OCR 폼 리셋 ──
  const resetOcrForm = () => {
    setShowOcrSection(false);
    setCounterpartyId(undefined);
    setCpSearchText('');
    setShowCpDropdown(false);
    setCpCandidates([]);
    setNote('');
    setPurchaseItems([emptyPurchaseItem()]);
    setAttachmentUrl(undefined);
    setOcrPreviewUrl(null);
    setOcrError(null);
    setOcrRotation(0);
    setOcrStep('idle');
    setOcrDateSuggestion(null);
    ocrRetryRef.current = 0;
    if (ocrRetryTimerRef.current) { clearTimeout(ocrRetryTimerRef.current); ocrRetryTimerRef.current = null; }
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

  // ── STEP 1: 사진 업로드 + Tesseract 방향감지 1회 ───────────────
  const handleOcrUpload = async (file: File) => {
    try {
      setOcrProcessing(true);
      setOcrError(null);
      setOcrRotation(0);

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
      setOcrStep('uploaded');

    } catch (error: any) {
      setOcrError(error.message || '업로드 실패');
      toast.error(error.message || '업로드 실패');
    } finally {
      setOcrProcessing(false);
    }
  };

  // ── STEP 2: 회전 적용 + OCR 분석 실행 ───────────────
  const handleOcrAnalyze = async () => {
    if (!attachmentUrl || ocrProcessing) return;
    try {
      setOcrProcessing(true);
      setOcrError(null);

      toast.info('전표 분석중... (최대 1분 소요될 수 있습니다)');

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), OCR_ANALYZE_TIMEOUT_MS);

      let ocrRes: Response;
      try {
        ocrRes = await fetch('/api/ocr/extract-purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: attachmentUrl,
            restaurantId,
            rotation: ocrRotation,
            counterpartyId: counterpartyId || undefined,
          }),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        const err = new Error(
          fetchErr?.name === 'AbortError' ? 'OCR 분석 시간 초과' : '네트워크 연결이 끊겼습니다'
        ) as Error & { retryable?: boolean; reason?: string };
        err.retryable = true;
        err.reason = fetchErr?.name === 'AbortError' ? 'timeout' : 'network_error';
        throw err;
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (!ocrRes.ok) {
        const errData = await ocrRes.json().catch(() => ({}));
        const err = new Error(errData.error || 'OCR 처리 실패') as Error & { retryable?: boolean; reason?: string };
        err.retryable = errData.retryable === true;
        err.reason = errData.reason;
        throw err;
      }

      const ocrData = await ocrRes.json();

      setOcrRotation(0);
      setOcrPreviewUrl(attachmentUrl + `?t=${Date.now()}`);
      setOcrStep('analyzed');

      if (ocrData.items && ocrData.items.length > 0) {
        setOcrOriginalItems(ocrData.items);
      }

      // 거래처 매칭
      if (!counterpartyId && ocrData.counterpartyName) {
        if (ocrData.counterpartyId) {
          const cpList = counterpartiesQuery.data || [];
          const matchedCp = cpList.find((cp: any) => cp.id === ocrData.counterpartyId);
          setCounterpartyId(ocrData.counterpartyId);
          toast.success(`거래처 자동선택: ${matchedCp?.name || ocrData.counterpartyName}`);
        } else if (ocrData.counterpartyCandidates && ocrData.counterpartyCandidates.length > 0) {
          setCpCandidates(ocrData.counterpartyCandidates);
          setCpSearchText(ocrData.counterpartyName.trim());
          toast.info(`"${ocrData.counterpartyName}" — 비슷한 거래처가 있습니다. 확인해주세요`);
        } else {
          setCpSearchText(ocrData.counterpartyName.trim());
          setShowCpDropdown(true);
          toast.info(`거래처 "${ocrData.counterpartyName}" — 목록에서 선택하거나 새로 등록하세요`);
        }
      }

      // 날짜 확인
      if (ocrData.transactionDate && onDateChange) {
        const ocrDate = ocrData.transactionDate;
        if (ocrDate !== date) {
          setOcrDateSuggestion(ocrDate);
        }
      }

      // 거래처 정보 업데이트
      if (ocrData.counterpartyInfo && ocrData.counterpartyId) {
        const ci = ocrData.counterpartyInfo;
        const changes: string[] = [];
        if (ci.contactName) changes.push(`담당자: ${ci.contactName}`);
        if (ci.contactPhone) changes.push(`연락처: ${ci.contactPhone}`);
        if (changes.length > 0) {
          toast(`거래처 정보가 감지되었습니다.\n${changes.join(', ')}`, {
            duration: 15000,
            action: {
              label: '반영',
              onClick: async () => {
                try {
                  await fetch('/api/ocr/update-counterparty-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      counterpartyId: ocrData.counterpartyId,
                      contactName: ci.contactName || undefined,
                      contactPhone: ci.contactPhone || undefined,
                    }),
                  });
                  toast.success('거래처 정보가 업데이트되었습니다.');
                } catch {
                  toast.error('거래처 정보 업데이트 실패');
                }
              },
            },
          });
        }
      }

      // 품목 프리필
      if (ocrData.items && ocrData.items.length > 0) {
        setPurchaseItems(
          ocrData.items.map((item: any) => ({
            rawItemName: item.matchedItemName || item.shortName || item.name || '',
            spec: item.spec || '',
            originalName: item.originalName || item.name || '',
            quantity: item.quantity ? String(Math.round(parseFloat(item.quantity) * 100) / 100) : '',
            unitName: item.unit || '개',
            unitPrice: item.unitPrice || '',
            lineTotal: item.lineTotal || '',
            confidence: item.confidence || 'high',
            matchedItemId: item.matchedItemId,
            matchedItemName: item.matchedItemName,
            itemCandidates: item.itemCandidates,
          }))
        );
        const matchedCount = ocrData.items.filter((i: any) => i.matchedItemId).length;
        const candidateCount = ocrData.items.filter((i: any) => !i.matchedItemId && i.itemCandidates?.length > 0).length;
        const lowConfCount = ocrData.items.filter((i: any) => i.confidence === 'low').length;
        if (candidateCount > 0 || lowConfCount > 0) {
          const parts: string[] = [];
          if (candidateCount > 0) parts.push(`${candidateCount}개 품목 확인 필요`);
          if (lowConfCount > 0) parts.push(`${lowConfCount}개 수량/단가 확인`);
          toast.success(`${ocrData.items.length}개 항목 추출 (${parts.join(', ')})`);
        } else {
          toast.success(`${ocrData.items.length}개 항목 추출${matchedCount > 0 ? ` (${matchedCount}개 자동매칭)` : ''}`);
        }
      } else {
        toast.info('항목을 추출하지 못했습니다. 직접 입력해주세요.');
      }

      if (ocrData.note) setNote(ocrData.note);
    } catch (error: any) {
      const autoRetryExcluded = error.reason === 'timeout' || error.reason === 'network_error';
      if (error.retryable && !autoRetryExcluded && ocrRetryRef.current < MAX_OCR_AUTO_RETRY) {
        const nextRetry = ocrRetryRef.current + 1;
        ocrRetryRef.current = nextRetry;
        const delayMs = OCR_RETRY_DELAYS_MS[nextRetry - 1];
        toast.info(`분석 실패, 자동 재시도 중... (${nextRetry}/${MAX_OCR_AUTO_RETRY})`);
        ocrRetryTimerRef.current = setTimeout(() => handleOcrAnalyze(), delayMs);
        return;
      } else {
        setOcrError(OCR_REASON_LABEL[error.reason] || error.message || '전표 분석에 실패했습니다. 이미지를 다시 올리거나 직접 입력해주세요.');
        setOcrStep('uploaded');
        toast.error('분석 실패 — 이미지를 다시 올리거나 직접 입력해주세요');
      }
    } finally {
      setOcrProcessing(false);
    }
  };

  // ── OCR 전표 저장 핸들러 ──
  const handleOcrCreate = () => {
    if (ocrDateSuggestion) {
      toast.error('명세서 날짜를 확인해주세요. 변경 또는 유지를 선택하세요.');
      return;
    }
    if (!counterpartyId) {
      toast.error('거래처를 선택하세요.');
      return;
    }

    const validItems = purchaseItems
      .filter(i => i.rawItemName.trim())
      .filter(i => parseFloat(i.lineTotal || '0') > 0);

    if (validItems.length === 0) {
      toast.error('최소 1개 항목 (품명+금액)을 입력하세요.');
      return;
    }

    // P1-1: 미매칭 품목 경고
    const unmatchedCount = validItems.filter(i => !i.matchedItemId).length;
    if (unmatchedCount > 0) {
      const proceed = window.confirm(
        `${unmatchedCount}개 품목이 마스터에 미매칭 상태입니다.\n가격분석에서 제외됩니다. 저장하시겠습니까?`
      );
      if (!proceed) return;
    }

    createOrder.mutate({
      restaurantId,
      purchaseDate: date,
      counterpartyId,
      status: 'received',
      note: note || undefined,
      attachmentUrl,
      items: validItems.map(i => ({
        rawItemName: i.rawItemName,
        itemId: i.matchedItemId,
        counterpartyItemId: i.counterpartyItemId,
        quantity: i.quantity || undefined,
        unitName: i.unitName || undefined,
        unitPrice: i.unitPrice || undefined,
        lineTotal: i.lineTotal || '0',
      })),
    });

    // OCR 수정 데이터 비동기 제출
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
  const memos = memosQuery.data || [];
  const unreceived = unreceivedQuery.data || [];
  const counterpartiesList = counterpartiesQuery.data || [];
  const cpItems = cpItemsQuery.data || [];
  const allItems = allItemsQuery.data || [];
  const cpItemIds = new Set(cpItems.map((ci: any) => ci.itemId));
  const masterOnlyItems = allItems.filter((mi: any) => !cpItemIds.has(mi.id));
  const receivedOrders = orders.filter((o: any) => o.status === 'received');
  const totalAmount = receivedOrders.reduce((sum, o: any) => sum + Number(o.totalAmount || 0), 0);
  const formTotal = purchaseItems.reduce((sum, i) => sum + parseFloat(i.lineTotal || '0'), 0);

  // ── OCR 품목 매칭 적용 (드롭다운 선택 + 추천 칩 공통) ──
  // 거래처 등록 품목(counterparty_items) 적용: 단가는 OCR 파싱 값 우선, 없으면 lastPrice/defaultPrice
  const applyCpItem = (idx: number, ci: any) => {
    setPurchaseItems(prev => {
      const updated = [...prev];
      if (!updated[idx]) return prev;
      const hasOcrPrice = !!updated[idx].unitPrice;
      updated[idx] = {
        ...updated[idx],
        rawItemName: ci.supplierItemName || ci.itemName,
        matchedItemId: ci.itemId,
        matchedItemName: ci.supplierItemName || ci.itemName,
        counterpartyItemId: ci.id,
        unitName: ci.purchaseUnit || updated[idx].unitName || '개',
        unitPrice: hasOcrPrice ? updated[idx].unitPrice : (ci.lastPrice || ci.defaultPrice || updated[idx].unitPrice),
        itemCandidates: undefined,
      };
      const qty = parseFloat(updated[idx].quantity || '0');
      const price = parseFloat(updated[idx].unitPrice || '0');
      if (qty > 0 && price > 0) updated[idx].lineTotal = String(Math.round(qty * price));
      return updated;
    });
    setItemDropdownIdx(null);
    setItemSearchText(prev => { const n = { ...prev }; delete n[idx]; return n; });
  };
  // 마스터 품목(items) 적용: 단가는 건드리지 않음 (거래처별 단가 없음)
  const applyMasterItem = (idx: number, mi: any) => {
    setPurchaseItems(prev => {
      const updated = [...prev];
      if (!updated[idx]) return prev;
      updated[idx] = {
        ...updated[idx],
        rawItemName: mi.name,
        matchedItemId: mi.id,
        matchedItemName: mi.name,
        counterpartyItemId: undefined,
        unitName: mi.baseUnit || updated[idx].unitName || '개',
        itemCandidates: undefined,
      };
      return updated;
    });
    setItemDropdownIdx(null);
    setItemSearchText(prev => { const n = { ...prev }; delete n[idx]; return n; });
  };

  return (
    <div className="space-y-4 p-4">
      {/* 매입 탭 체크리스트 */}
      <TabChecklists
        restaurantId={restaurantId}
        date={date}
        targetTab="purchase"
      />

      {/* ═══════════════ 미입고 발주 리마인더 ═══════════════ */}
      {unreceived.length > 0 && (
        <Card className="bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">미입고 발주 {unreceived.length}건</span>
          </div>
          {unreceived.map((memo: any) => (
            <div key={memo.id} className="flex items-center justify-between text-xs border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 bg-white/50 dark:bg-black/10">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{memo.counterpartyName}</span>
                <span className="text-muted-foreground ml-1.5">{fmtShortDate(memo.purchaseDate)}</span>
                {memo.content && (
                  <p className="text-muted-foreground mt-0.5 truncate">{memo.content}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 ml-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] h-6 px-2 gap-0.5 border-green-300 text-green-600 hover:bg-green-50 dark:border-green-700 dark:text-green-400"
                  onClick={() => toggleReceivedMut.mutate({ restaurantId, id: memo.id, isReceived: true })}
                  disabled={toggleReceivedMut.isPending}
                >
                  <Check className="w-2.5 h-2.5" /> 입고확인
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* ═══════════════ 오늘의 발주 메모 ═══════════════ */}
      <Card className="bg-card border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">오늘의 발주 메모</h3>
          <span className="text-xs text-muted-foreground">{memos.length}건</span>
        </div>

        {memos.length === 0 && !showMemoForm && (
          <p className="text-sm text-muted-foreground text-center py-3">등록된 발주 메모가 없습니다</p>
        )}

        {memos.length > 0 && (
          <div className="space-y-2 mb-3">
            {memos.map((memo: any) => (
              <div key={memo.id} className="border border-border rounded-lg px-3 py-2.5">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">{memo.counterpartyName}</span>
                      {memo.isReceived ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">입고완료</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 font-medium">미입고</span>
                      )}
                    </div>
                    {memo.content && (
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{memo.content}</p>
                    )}
                    {memo.attachmentUrl && (
                      <img
                        src={memo.attachmentUrl}
                        alt="첨부"
                        className="mt-1.5 w-16 h-16 object-cover rounded border border-border cursor-pointer"
                        onClick={() => setViewerImage(memo.attachmentUrl)}
                      />
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">{memo.createdByName} {fmtTs(memo.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Checkbox
                      checked={memo.isReceived}
                      onCheckedChange={(v) => toggleReceivedMut.mutate({ restaurantId, id: memo.id, isReceived: !!v })}
                      disabled={toggleReceivedMut.isPending}
                    />
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { if (confirm('삭제할까요?')) deleteOrder.mutate({ restaurantId, id: memo.id }); }} disabled={deleteOrder.isPending}>
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 발주 메모 입력 폼 (인라인) */}
        {showMemoForm ? (
          <div className="border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/5 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">발주 기록하기</h4>
              <button onClick={resetMemoForm} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 거래처 */}
            <div className="relative">
              <Label className="text-xs">거래처</Label>
              {memoCounterpartyId ? (
                <div className="mt-1 flex items-center gap-2 h-9 rounded-md border border-border bg-background px-3">
                  <span className="text-sm text-foreground flex-1">
                    {counterpartiesList.find((cp: any) => cp.id === memoCounterpartyId)?.name ?? '거래처'}
                  </span>
                  <button type="button" onClick={() => { setMemoCounterpartyId(undefined); setMemoCpText(''); }} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={memoCpText}
                    onChange={(e) => { setMemoCpText(e.target.value); setShowMemoCpDropdown(true); }}
                    onFocus={() => setShowMemoCpDropdown(true)}
                    onBlur={() => setTimeout(() => setShowMemoCpDropdown(false), 200)}
                    placeholder="거래처 검색 또는 직접입력"
                    className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  />
                  {showMemoCpDropdown && (
                    <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
                      {counterpartiesList
                        .filter((cp: any) => !memoCpText || cp.name.toLowerCase().includes(memoCpText.toLowerCase()))
                        .map((cp: any) => (
                          <button
                            key={cp.id}
                            type="button"
                            onClick={() => {
                              setMemoCounterpartyId(cp.id);
                              setMemoCpText('');
                              setShowMemoCpDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
                          >
                            {cp.name}
                          </button>
                        ))}
                      {memoCpText.trim() && !counterpartiesList.some((cp: any) => cp.name === memoCpText.trim()) && (
                        <button
                          type="button"
                          onClick={() => {
                            createCounterpartyForMemo.mutate({
                              restaurantId,
                              name: memoCpText.trim(),
                              counterpartyType: 'supplier',
                            });
                          }}
                          disabled={createCounterpartyForMemo.isPending}
                          className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors border-t border-border font-medium"
                        >
                          <Plus className="w-3.5 h-3.5 inline mr-1" />
                          "{memoCpText.trim()}" 새 거래처 등록
                        </button>
                      )}
                      {counterpartiesList.filter((cp: any) => !memoCpText || cp.name.toLowerCase().includes(memoCpText.toLowerCase())).length === 0 && !memoCpText.trim() && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">등록된 거래처가 없습니다</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 내용 */}
            <div>
              <Label className="text-xs">내용</Label>
              <Textarea
                placeholder="발주 내용 (품목, 수량 등 자유롭게 메모)"
                value={memoContent}
                onChange={(e) => setMemoContent(e.target.value)}
                className="mt-1 text-sm min-h-[60px]"
                rows={2}
              />
            </div>

            {/* 사진 첨부 */}
            {memoAttachment ? (
              <div className="space-y-1.5">
                <img
                  src={memoAttachment}
                  alt="첨부"
                  className="w-full max-h-36 object-contain rounded border border-border cursor-pointer"
                  onClick={() => setViewerImage(memoAttachment)}
                />
                <div className="flex justify-end">
                  <button onClick={() => setMemoAttachment(undefined)} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                    <X className="w-3.5 h-3.5" /> 삭제
                  </button>
                </div>
              </div>
            ) : memoUploading ? (
              <div className="flex items-center justify-center py-3">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="ml-2 text-xs text-muted-foreground">업로드 중...</span>
              </div>
            ) : (
              <label className="flex items-center gap-2 border border-dashed border-border rounded-lg p-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                <Camera className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">사진 첨부 (선택)</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  if (e.target.files?.[0]) handleMemoPhotoUpload(e.target.files[0]);
                }} />
              </label>
            )}

            {/* 버튼 */}
            <div className="flex gap-2">
              <button
                onClick={handleMemoSubmit}
                disabled={createMemoMut.isPending}
                className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
              >
                {createMemoMut.isPending ? '등록 중...' : '저장'}
              </button>
              <button
                onClick={resetMemoForm}
                className="px-4 py-2.5 rounded-lg text-sm text-muted-foreground border border-border hover:bg-muted/50 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowMemoForm(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 border border-dashed border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <Plus className="w-4 h-4" />
            발주 기록하기
          </button>
        )}
      </Card>

      {/* ═══════════════ 즉시지출 ═══════════════ */}
      <Card className="bg-card border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">즉시지출</h3>
          {expenses.length > 0 && (
            <span className="text-sm font-bold text-foreground">{formatKRW(totalExpenses)}</span>
          )}
        </div>

        {expenses.length > 0 && (
          <div className="space-y-2 mb-3">
            {expenses.map((exp: any) => (
              <div key={exp.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{exp.title}</span>
                  {exp.categoryName && (
                    <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">{exp.categoryName}</span>
                  )}
                  {exp.note && <p className="text-xs text-muted-foreground mt-0.5 truncate">{exp.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-medium tabular-nums">{formatKRW(Number(exp.amount))}</span>
                  {exp.attachmentUrl && (
                    <button onClick={() => setViewerImage(exp.attachmentUrl)} className="text-violet-500">
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
        )}

        {showExpenseForm ? (
          <div className="border border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-900/5 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">즉시지출 등록</h4>
              <button onClick={() => setShowExpenseForm(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[11px] text-violet-600 dark:text-violet-400 bg-violet-100/50 dark:bg-violet-900/20 px-2 py-1 rounded">
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
              <Input placeholder="메모" value={expNote} onChange={(e) => setExpNote(e.target.value)} className="mt-1 text-sm h-8" />
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
                <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                <span className="ml-2 text-xs text-muted-foreground">업로드 중...</span>
              </div>
            ) : (
              <label className="flex items-center gap-2 border border-dashed border-violet-300 dark:border-violet-700 rounded-lg p-3 cursor-pointer hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-colors">
                <Camera className="w-5 h-5 text-violet-500" />
                <div>
                  <p className="text-xs font-medium text-foreground">증빙사진 첨부 (선택)</p>
                  <p className="text-[10px] text-muted-foreground">영수증, 결제내역 등</p>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  if (e.target.files?.[0]) handleExpensePhotoUpload(e.target.files[0]);
                }} />
              </label>
            )}

            <button
              onClick={handleExpenseSubmit}
              disabled={createExpenseMut.isPending}
              className="w-full py-3 rounded-lg text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50"
            >
              {createExpenseMut.isPending ? '등록 중...' : `즉시지출 등록${expAmount ? ` (${expAmount}원)` : ''}`}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowExpenseForm(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-violet-600 dark:text-violet-400 border border-dashed border-violet-300 dark:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
          >
            <Plus className="w-4 h-4" />
            즉시지출 등록
          </button>
        )}
      </Card>

      {/* ═══════════════ 전표 매입 (OCR) ═══════════════ */}
      <Card className="bg-card border-border p-4">
        <button
          onClick={() => setShowOcrSection(!showOcrSection)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">전표 매입</h3>
            {receivedOrders.length > 0 && (
              <span className="text-xs text-muted-foreground">{receivedOrders.length}건</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {totalAmount > 0 && (
              <span className="text-sm font-bold text-foreground">{formatKRW(totalAmount)}</span>
            )}
            <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showOcrSection ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </button>

        {/* 입고 목록 (항상 표시) */}
        {receivedOrders.length > 0 && (
          <div className="space-y-2 mt-3">
            {receivedOrders.map((order: any) => (
              <div key={order.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-foreground truncate">
                      {order.counterpartyName || '미지정 거래처'}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">입고</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground tabular-nums">{formatKRW(Number(order.totalAmount))}</span>
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
                          {item.quantity && `${parseFloat(Number(item.quantity).toFixed(2))}${item.unitName ? item.unitName : ''} × `}
                          {formatKRW(Number(item.lineTotal))}
                        </span>
                      </div>
                    ))}
                    {order.note && <p className="text-xs text-muted-foreground mt-1">메모: {order.note}</p>}
                    <div className="flex justify-end pt-1">
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('이 매입 기록을 삭제할까요?')) deleteOrder.mutate({ restaurantId, id: order.id }); }} disabled={deleteOrder.isPending}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* OCR 전표 입력 영역 (collapsible) */}
        {showOcrSection && (
          <div className="mt-3 border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/5 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">전표 입력하기</h4>
              <button onClick={resetOcrForm} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 전표 촬영 영역 */}
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
                    if (e.target.files?.[0]) handleOcrUpload(e.target.files[0]);
                  }}
                  className="hidden"
                />
              </label>
            )}

            {/* OCR 처리 중 */}
            {ocrProcessing && (
              <div className="flex flex-col items-center py-6 space-y-2">
                <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-foreground">전표 분석중...</p>
                <p className="text-[10px] text-muted-foreground">품목, 수량, 단가를 자동 추출합니다</p>
              </div>
            )}

            {/* OCR 에러 */}
            {ocrError && (
              <div className="bg-red-500/10 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-600 dark:text-red-400">{ocrError}</p>
                <p className="text-xs text-muted-foreground mt-1">일시적 분석 실패입니다. 잠시 후 다시 시도하거나 직접 입력해주세요.</p>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setOcrError(null); setOcrPreviewUrl(null); }}>
                  다시 촬영
                </Button>
              </div>
            )}

            {/* OCR 프리뷰 이미지 + 회전/분석 컨트롤 */}
            {ocrPreviewUrl && !ocrProcessing && (
              <div className="space-y-2">
                <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
                  <img
                    src={ocrPreviewUrl}
                    alt="전표 이미지"
                    className="w-full max-h-48 object-contain cursor-pointer transition-transform duration-200"
                    style={{ transform: `rotate(${ocrRotation}deg)` }}
                    onClick={() => setViewerImage(ocrPreviewUrl)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setViewerImage(ocrPreviewUrl)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50"
                      title="확대 보기"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    {ocrStep === 'uploaded' && (
                      <>
                        <button
                          onClick={() => setOcrRotation((prev) => prev - 90)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50"
                          title="왼쪽 회전"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setOcrRotation((prev) => prev + 90)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50"
                          title="오른쪽 회전"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-1">{((ocrRotation % 360) + 360) % 360}° 회전</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const hasItems = purchaseItems.some(i => i.rawItemName.trim() || i.lineTotal);
                      if (hasItems && ocrStep === 'analyzed' && !confirm('분석된 품목이 초기화됩니다. 이미지를 삭제할까요?')) return;
                      setOcrPreviewUrl(null);
                      setAttachmentUrl(undefined);
                      setOcrStep('idle');
                      setOcrRotation(0);
                      setPurchaseItems([emptyPurchaseItem()]);
                    }}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-500/10"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>삭제</span>
                  </button>
                </div>

                {ocrStep === 'uploaded' && (
                  <>
                    <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                      글씨가 정방향으로 읽히는지 확인하세요. 돌아가 있으면 회전 버튼을 눌러주세요.
                    </p>
                    <button
                      onClick={() => { ocrRetryRef.current = 0; if (ocrRetryTimerRef.current) clearTimeout(ocrRetryTimerRef.current); handleOcrAnalyze(); }}
                      disabled={ocrProcessing}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Search className="w-4 h-4" />
                      전표 분석 시작
                    </button>
                  </>
                )}
              </div>
            )}

            {/* OCR 날짜 불일치 */}
            {ocrDateSuggestion && (() => {
              const diff = Math.round((new Date(date).getTime() - new Date(ocrDateSuggestion).getTime()) / 86400000);
              const absDiff = Math.abs(diff);
              return (
                <div className="bg-red-500/10 border-2 border-red-400 dark:border-red-600 rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                        날짜 불일치 — 확인 필수
                      </p>
                      <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                        명세서 날짜 <strong className="text-red-700 dark:text-red-300">{ocrDateSuggestion}</strong>
                        {' '}/ 현재 입고일 <strong>{date}</strong>
                        {absDiff > 0 && <span className="ml-1">({absDiff}일 차이)</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (onDateChange) {
                          onDateChange(ocrDateSuggestion);
                          toast.success(`입고일이 ${ocrDateSuggestion}로 변경됨`);
                        }
                        setOcrDateSuggestion(null);
                      }}
                      className="flex-1 text-xs font-bold bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition-colors"
                    >
                      명세서 날짜({ocrDateSuggestion})로 변경
                    </button>
                    <button
                      onClick={() => {
                        if (absDiff >= 3) {
                          if (!confirm(`${absDiff}일 차이가 납니다. 정말 현재 날짜(${date})를 유지할까요?`)) return;
                        }
                        setOcrDateSuggestion(null);
                      }}
                      className="text-[11px] text-muted-foreground px-3 py-2 border border-border rounded-lg hover:bg-muted/50"
                    >
                      유지
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* 거래처 선택/입력 */}
            <div className="relative">
              <Label className="text-xs">거래처</Label>
              {counterpartyId ? (
                <div className="mt-1 flex items-center gap-2 h-9 rounded-md border border-border bg-background px-3">
                  <span className="text-sm text-foreground flex-1">
                    {counterpartiesList.find((cp: any) => cp.id === counterpartyId)?.name ?? '거래처'}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setCounterpartyId(undefined); setCpSearchText(''); setCpCandidates([]); }}
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

            {/* 거래처 후보 매칭 배너 */}
            {cpCandidates.length > 0 && !counterpartyId && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5 space-y-1.5">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  비슷한 거래처가 있습니다. 맞는 것을 선택하세요:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {cpCandidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCounterpartyId(c.id);
                        setCpSearchText('');
                        setCpCandidates([]);
                        toast.success(`거래처 선택: ${c.name}`);
                      }}
                      className="px-2.5 py-1.5 text-xs bg-amber-500/20 hover:bg-amber-500/40 text-amber-800 dark:text-amber-200 rounded-md transition-colors font-medium"
                    >
                      {c.name} ({c.score}%)
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setCpCandidates([]);
                      setShowCpDropdown(true);
                    }}
                    className="px-2.5 py-1.5 text-xs bg-muted/50 hover:bg-muted text-muted-foreground rounded-md transition-colors"
                  >
                    해당없음
                  </button>
                </div>
              </div>
            )}

            {/* 합계 표시 */}
            {purchaseItems.some(i => parseFloat(i.lineTotal || '0') > 0) && (
              <div className="bg-blue-500/5 p-2.5 rounded flex justify-between items-center">
                <span className="text-xs text-muted-foreground">{purchaseItems.filter(i => i.rawItemName.trim()).length}개 항목</span>
                <span className="text-sm font-bold text-blue-600 tabular-nums">
                  합계 {formatKRW(formTotal)}
                </span>
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
                  <span className="absolute -top-2 -left-1 bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm">{idx + 1}</span>
                  {(isLowConf || isMedConf) && (
                    <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded w-fit ${isLowConf ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'}`}>
                      <AlertCircle className="w-3 h-3" />
                      {isLowConf ? '판독 불확실 — 확인 필요' : '합계 보정됨 — 확인 필요'}
                    </div>
                  )}
                  {/* 품명 Combobox + 규격 */}
                  <div>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder="품명 검색 또는 입력"
                          value={itemDropdownIdx === idx && itemSearchText[idx] !== undefined ? itemSearchText[idx] : item.rawItemName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setItemSearchText(prev => ({ ...prev, [idx]: val }));
                            const updated = [...purchaseItems];
                            updated[idx] = { ...updated[idx], rawItemName: val, matchedItemId: undefined, matchedItemName: undefined, counterpartyItemId: undefined };
                            setPurchaseItems(updated);
                            setItemDropdownIdx(idx);
                          }}
                          onFocus={() => {
                            setItemDropdownIdx(idx);
                            setItemSearchText(prev => ({ ...prev, [idx]: item.rawItemName }));
                          }}
                          onBlur={() => setTimeout(() => {
                            if (itemDropdownIdx === idx) {
                              setItemDropdownIdx(null);
                              setItemSearchText(prev => { const n = { ...prev }; delete n[idx]; return n; });
                            }
                          }, 200)}
                          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground font-medium"
                        />
                        {item.matchedItemName && (
                          <Check className="absolute right-2 top-2.5 w-3.5 h-3.5 text-emerald-500" />
                        )}
                        {itemDropdownIdx === idx && (() => {
                          const searchVal = (itemSearchText[idx] ?? '').toLowerCase();
                          const candidateIds = new Set((item.itemCandidates || []).map((c: any) => c.itemId));
                          const filteredCp = counterpartyId
                            ? cpItems.filter((ci: any) => {
                                const name = (ci.supplierItemName || ci.itemName || '').toLowerCase();
                                return !searchVal || name.includes(searchVal);
                              })
                            : [];
                          const filteredMaster = masterOnlyItems
                            .filter((mi: any) => {
                              const name = (mi.name || '').toLowerCase();
                              return !searchVal || name.includes(searchVal);
                            })
                            .slice(0, 20);
                          if (filteredCp.length === 0 && filteredMaster.length === 0) return null;
                          return (
                            <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
                              {filteredCp.map((ci: any) => (
                                <button
                                  key={`cp-${ci.id}`}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => applyCpItem(idx, ci)}
                                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors flex items-center justify-between"
                                >
                                  <span className="truncate">
                                    {ci.supplierItemName || ci.itemName}
                                    {candidateIds.has(ci.itemId) && (
                                      <span className="ml-1.5 text-[10px] px-1 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded">추천</span>
                                    )}
                                  </span>
                                  {ci.lastPrice && (
                                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{formatKRW(Number(ci.lastPrice))}</span>
                                  )}
                                </button>
                              ))}
                              {filteredCp.length > 0 && filteredMaster.length > 0 && (
                                <div className="border-t border-border px-3 py-1">
                                  <span className="text-[10px] text-muted-foreground">전체 품목</span>
                                </div>
                              )}
                              {filteredMaster.map((mi: any) => (
                                <button
                                  key={`mi-${mi.id}`}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => applyMasterItem(idx, mi)}
                                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors flex items-center"
                                >
                                  <span className="truncate">
                                    {mi.name}
                                    {candidateIds.has(mi.id) && (
                                      <span className="ml-1.5 text-[10px] px-1 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded">추천</span>
                                    )}
                                  </span>
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      {(item.spec || ocrPreviewUrl) && (
                        <div className="w-24">
                          <Input
                            placeholder="규격"
                            value={item.spec || ''}
                            onChange={(e) => updateItem(idx, 'spec', e.target.value)}
                            className="w-full text-sm h-9 text-muted-foreground"
                          />
                        </div>
                      )}
                    </div>
                    {item.originalName && item.originalName !== item.rawItemName && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 px-1 truncate">전표 원본: {item.originalName}</p>
                    )}
                  </div>
                  {/* OCR 추천 칩 — 자동매칭 실패 시 상위 3개 후보 제시 */}
                  {!item.matchedItemId && (item.itemCandidates?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1 px-1">
                      <span className="text-[10px] text-muted-foreground">비슷한 품목</span>
                      {item.itemCandidates!.slice(0, 3).map((c: any) => (
                        <button
                          key={`${c.source}-${c.itemId}`}
                          type="button"
                          onClick={() => {
                            if (c.source === 'counterparty') {
                              const ci = cpItems.find((x: any) => x.itemId === c.itemId);
                              if (ci) applyCpItem(idx, ci);
                            } else {
                              const mi = masterOnlyItems.find((x: any) => x.id === c.itemId);
                              if (mi) applyMasterItem(idx, mi);
                            }
                          }}
                          className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs hover:bg-amber-500/20 transition-colors"
                        >
                          {c.itemName}
                          {c.score > 0 && <span className="ml-1 text-[9px] opacity-70">{c.score}%</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* 수량 + 단위 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground mb-0.5 block">수량</span>
                      <Input placeholder="0" type="number" step="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} className="text-sm h-9" />
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
                  {purchaseItems.length > 1 && (
                    <button
                      onClick={() => {
                        const hasContent = item.rawItemName.trim() || item.quantity || item.unitPrice || item.lineTotal;
                        if (hasContent && !confirm(`"${item.rawItemName || '이 항목'}" 을(를) 삭제할까요?`)) return;
                        setPurchaseItems(purchaseItems.filter((_, i) => i !== idx));
                      }}
                      className="w-full flex items-center justify-center gap-1 text-xs text-red-400 hover:text-red-500 py-1 border border-dashed border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> 이 항목 삭제
                    </button>
                  )}
                </div>
                );
              })}
              <Button variant="secondary" size="sm" onClick={() => setPurchaseItems([...purchaseItems, emptyPurchaseItem()])} className="w-full">
                <Plus className="w-3 h-3 mr-1" /> 항목 추가
              </Button>
            </div>

            {/* 메모 */}
            <div>
              <Label className="text-xs">메모 (선택)</Label>
              <Input placeholder="메모" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 text-sm h-8" />
            </div>

            {/* 합계 + 저장 */}
            <div className="bg-blue-500/5 p-3 rounded flex justify-between items-center">
              <span className="text-sm font-medium text-foreground">합계:</span>
              <span className="font-bold text-blue-600 tabular-nums">
                {formatKRW(formTotal)}
              </span>
            </div>

            <button
              onClick={handleOcrCreate}
              disabled={createOrder.isPending}
              className="w-full py-3 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
            >
              {createOrder.isPending ? '등록 중...' : '입고 등록'}
            </button>
          </div>
        )}

        {!showOcrSection && receivedOrders.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-3 mt-2">등록된 전표 매입이 없습니다</p>
        )}

        {!showOcrSection && (
          <button
            onClick={() => setShowOcrSection(true)}
            className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 border border-dashed border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <Camera className="w-4 h-4" />
            전표 입력하기
          </button>
        )}
      </Card>

      {/* ─── 금일 입고/발주 없음 확인 ─── */}
      <NoPurchaseConfirmation restaurantId={restaurantId} date={date} hasPurchases={orders.length > 0 || memos.length > 0} />

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

  // ── 중간정산 보고용 데이터 ──
  const restaurantQuery = trpc.restaurants.get.useQuery(
    { id: restaurantId },
    { enabled: restaurantId > 0 },
  );
  const daySchedulesQuery = trpc.schedules.getDaySchedules.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );

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

  // 중간정산 보고 텍스트 생성 — snapshot(저장된 중간매출 1건)의 recordedAt을 체크시간으로 사용
  const generateMidReportText = (snapshot: any): string => {
    const rest = restaurantQuery.data;
    const restName = rest?.name ?? '매장';

    // 날짜: 2026년 4월 19일 일요일
    const dt = new Date(date + 'T12:00:00');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 ${dayNames[dt.getDay()]}요일`;

    // 체크시간: snapshot.recordedAt
    const recordedAt = new Date(snapshot.recordedAt);
    const hh = String(recordedAt.getHours()).padStart(2, '0');
    const mm = String(recordedAt.getMinutes()).padStart(2, '0');
    const checkTime = `${hh}:${mm}`;
    const checkpointMs = recordedAt.getTime();

    // 체크매출/객수: 해당 스냅샷 시점까지의 누적
    const upto = midSales.filter((m: any) => new Date(m.recordedAt).getTime() <= checkpointMs);
    const checkAmount = upto.reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
    const checkReceipts = upto.reduce((s: number, m: any) => s + Number(m.receiptCount || 0), 0);

    // 운영일지 특이사항: 해당 스냅샷 시점까지의 note 있는 행만
    const noteLines = upto
      .filter((m: any) => m.note && String(m.note).trim())
      .map((m: any) => {
        const t = m.recordedAt ? fmtTs(m.recordedAt) : '';
        return ` -${t ? t + ' ' : ''}${m.note}`;
      });

    // 금일 근무자: 당일 전체 스케줄 (마감 보고와 동일)
    const todaySchedules = (daySchedulesQuery.data ?? []).filter((s: any) => s.status !== 'canceled');

    const lines: string[] = [];
    lines.push(`[${restName}] ${dateStr}`);
    lines.push(`* 체크시간: ${checkTime}`);
    lines.push(`* 체크매출: ${fmtNum(checkAmount)}원`);
    lines.push(`* 객수: ${checkReceipts}건`);
    lines.push('');
    lines.push(`* 운영일지 특이사항`);
    if (noteLines.length > 0) {
      lines.push(...noteLines);
    } else {
      lines.push(' -없음');
    }
    lines.push('');
    lines.push(`* 금일 근무자`);
    if (todaySchedules.length > 0) {
      for (const s of todaySchedules) {
        const name = s.userName ?? s.tempWorkerName ?? '미배정';
        const w = calcHeadcountWeight(
          s.startTime,
          s.endTime,
          rest?.openTime,
          rest?.closeTime,
          rest?.halfShiftThreshold,
        );
        if (w === 0.5) {
          const hours = ((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000)
            .toFixed(1)
            .replace(/\.0$/, '');
          lines.push(`  ${name} ${hours}시간`);
        } else {
          lines.push(`  ${name} ${getRoleLabel(s)}`);
        }
      }
    } else {
      lines.push(`  없음`);
    }
    lines.push('===========');
    return lines.join('\n');
  };

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
                      {formatKRW(Number(sale.amount))}
                      {sale.receiptCount > 0 && <span className="text-xs text-muted-foreground ml-1">({sale.receiptCount}건)</span>}
                    </div>
                    {sale.note && (
                      <div className="text-xs text-muted-foreground">{sale.note}</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {fmtTs(sale.recordedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="이 시점의 중간정산 보고 복사"
                      onClick={() => {
                        const text = generateMidReportText(sale);
                        navigator.clipboard.writeText(text).then(() => {
                          toast.success('중간정산 보고가 클립보드에 복사되었습니다');
                        }).catch(() => {
                          toast.error('복사 실패');
                        });
                      }}
                    >
                      <Copy className="w-4 h-4 text-blue-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMidSalesMutation.mutate({ id: sale.id, restaurantId })}
                      disabled={deleteMidSalesMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
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
  const [salesOcrLoading, setSalesOcrLoading] = useState(false);
  const salesOcrInputRef = useRef<HTMLInputElement>(null);

  const handleSalesOcr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      setSalesOcrLoading(true);
      // 리사이즈
      const resized = await resizeImage(file, OCR_HIGH);
      // 업로드
      const formData = new FormData();
      formData.append('photo', resized);
      const uploadRes = await fetch('/api/upload/order-image', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('이미지 업로드 실패');
      const { url } = await uploadRes.json();

      // OCR 분석
      toast.info('전표 분석 중...');
      const ocrRes = await fetch('/api/ocr/extract-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url, restaurantId }),
      });
      if (!ocrRes.ok) {
        const errData = await ocrRes.json().catch(() => ({}));
        throw new Error(errData.error || 'OCR 처리 실패');
      }
      const data = await ocrRes.json();
      const m = data.mapped;

      // 결과를 폼에 채우기
      if (m.cashAmount) setCashAmount(fmtNum(m.cashAmount));
      if (m.cardAmount) setCardAmount(fmtNum(m.cardAmount));
      if (m.giftCardAmount) setGiftCardAmount(fmtNum(m.giftCardAmount));
      if (m.transferAmount) setTransferAmount(fmtNum(m.transferAmount));
      if (m.otherAmount) {
        setOtherItems([{ itemName: '기타 (OCR)', amount: m.otherAmount }]);
      }

      toast.success('전표 인식 완료 — 금액을 확인해주세요');
      if (data.confidence === 'low') {
        toast.warning('인식 신뢰도가 낮습니다. 금액을 꼭 확인해주세요.');
      }
    } catch (err: any) {
      toast.error(err.message || '전표 인식 실패');
    } finally {
      setSalesOcrLoading(false);
    }
  };

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

  // ── 보고 복사용 데이터 ──
  const restaurantQuery = trpc.restaurants.get.useQuery(
    { id: restaurantId },
    { enabled: restaurantId > 0 },
  );
  const cumulativeSalesQuery = trpc.dailyOps.getCumulativeSales.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const tomorrowDate = useMemo(() => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [date]);
  const tomorrowSchedules = trpc.schedules.getDaySchedules.useQuery(
    { restaurantId, date: tomorrowDate },
    { enabled: restaurantId > 0 },
  );

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

  const generateReportText = (): string => {
    const rest = restaurantQuery.data;
    const restName = rest?.name ?? '매장';
    const cumulative = Number(cumulativeSalesQuery.data?.cumulative ?? 0);
    const cash = parseNum(cashAmount);
    const card = parseNum(cardAmount);
    const gift = parseNum(giftCardAmount);
    const transfer = parseNum(transferAmount);
    const total = cash + card + gift + transfer + otherItems.reduce((s, i) => s + i.amount, 0);
    const specialTotal = specialItems.reduce((s, i) => s + i.amount, 0);
    const fixedCash = rest?.fixedCashRegister ?? 200000;

    // 날짜 포맷 (4/5 토)
    const dt = new Date(date + 'T12:00:00');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = `${dt.getMonth() + 1}/${dt.getDate()} ${dayNames[dt.getDay()]}`;

    const lines: string[] = [];
    lines.push(`[${restName}] ${dateStr}`);
    lines.push('');
    lines.push(`누적매출: ${fmtNum(cumulative)}원`);
    lines.push(`금일매출: ${fmtNum(total)}원`);
    lines.push('');
    lines.push(`현금: ${fmtNum(cash)}원`);
    lines.push(`카드: ${fmtNum(card)}원`);
    if (gift > 0) lines.push(`상품권: ${fmtNum(gift)}원`);
    if (transfer > 0) lines.push(`이체: ${fmtNum(transfer)}원${transferDepositor ? ` (${transferDepositor})` : ''}`);
    for (const item of otherItems) {
      if (item.amount > 0) lines.push(`${item.itemName}: ${fmtNum(item.amount)}원`);
    }
    if (specialTotal > 0) {
      lines.push('');
      for (const item of specialItems) {
        if (item.amount > 0) lines.push(`${item.typeName}: -${fmtNum(item.amount)}원${item.note ? ` (${item.note})` : ''}`);
      }
    }
    lines.push('');
    lines.push(`시재: ${fmtNum(fixedCash)}원`);

    // 금일 근무자
    const todaySchedules = (daySchedulesQuery.data ?? []).filter((s: any) => s.status !== 'canceled');
    if (todaySchedules.length > 0) {
      lines.push('');
      lines.push('금일근무:');
      for (const s of todaySchedules) {
        const name = s.userName ?? s.tempWorkerName ?? '미배정';
        const w = calcHeadcountWeight(s.startTime, s.endTime, rest?.openTime, rest?.closeTime, rest?.halfShiftThreshold);
        if (w === 0.5) {
          const hours = ((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000).toFixed(1).replace(/\.0$/, '');
          lines.push(`  ${name} ${hours}시간`);
        } else {
          lines.push(`  ${name} ${getRoleLabel(s)}`);
        }
      }
    }

    // 내일 근무자
    const tmrw = (tomorrowSchedules.data ?? []).filter((s: any) => s.status !== 'canceled');
    if (tmrw.length > 0) {
      const tmrwDt = new Date(tomorrowDate + 'T12:00:00');
      const tmrwStr = `${tmrwDt.getMonth() + 1}/${tmrwDt.getDate()} ${dayNames[tmrwDt.getDay()]}`;
      lines.push('');
      lines.push(`내일근무 (${tmrwStr}):`);
      for (const s of tmrw) {
        const name = s.userName ?? s.tempWorkerName ?? '미배정';
        const w = calcHeadcountWeight(s.startTime, s.endTime, rest?.openTime, rest?.closeTime, rest?.halfShiftThreshold);
        if (w === 0.5) {
          const hours = ((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000).toFixed(1).replace(/\.0$/, '');
          lines.push(`  ${name} ${hours}시간`);
        } else {
          lines.push(`  ${name} ${getRoleLabel(s)}`);
        }
      }
    }

    return lines.join('\n');
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
            <span className="text-foreground">{formatKRW(midSalesTotal)}</span>
          </div>
        </div>
      </Card>

      {/* ─── 근무 스케줄 요약 ─── */}
      <ClosingScheduleSummary restaurantId={restaurantId} date={date} />

      {/* 매출 입력 */}
      <Card className="bg-card border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">매출 입력</h3>
          <button
            onClick={() => salesOcrInputRef.current?.click()}
            disabled={salesOcrLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-500/10 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-500/20 disabled:opacity-50"
          >
            {salesOcrLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            전표 촬영
          </button>
          <input
            ref={salesOcrInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleSalesOcr}
          />
        </div>
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

          <div className="flex gap-2">
            <Button
              onClick={handleSaveSales}
              disabled={saveSalesMutation.isPending}
              className="flex-1"
            >
              {saveSalesMutation.isPending ? '저장 중...' : '매출 저장'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const text = generateReportText();
                navigator.clipboard.writeText(text).then(() => {
                  toast.success('보고 텍스트가 클립보드에 복사되었습니다');
                }).catch(() => {
                  toast.error('복사 실패');
                });
              }}
              className="shrink-0"
            >
              <Copy className="w-4 h-4 mr-1" /> 보고 복사
            </Button>
          </div>
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

/** 스케줄 행의 매장 역할을 한국어 라벨로 변환 */
function getRoleLabel(s: any): string {
  const storeRole = s?.storeRole;
  if (storeRole === 'owner' || storeRole === 'store_manager') return '점장';
  if (storeRole === 'supervisor' || storeRole === 'manager') return '매니져';
  return '사원';
}

function ClosingScheduleSummary({ restaurantId, date }: { restaurantId: number; date: string }) {
  const [expanded, setExpanded] = useState(true);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data: restaurant } = trpc.restaurants.get.useQuery(
    { id: restaurantId },
    { enabled: restaurantId > 0 }
  );

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

  const weightedTotal = daySchedules.reduce((sum: number, s: any) => {
    const w = calcHeadcountWeight(s.startTime, s.endTime, restaurant?.openTime, restaurant?.closeTime, restaurant?.halfShiftThreshold);
    return sum + w;
  }, 0);

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
          <span className="text-xs text-muted-foreground">({weightedTotal % 1 === 0 ? weightedTotal : weightedTotal.toFixed(1)}명)</span>
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
                      {calcHeadcountWeight(s.startTime, s.endTime, restaurant?.openTime, restaurant?.closeTime, restaurant?.halfShiftThreshold) === 0.5 && (
                        <span className="text-amber-500 ml-1 text-xs">(반차)</span>
                      )}
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
