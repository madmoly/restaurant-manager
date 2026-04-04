import React, { useState, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { resizeImage } from '@/lib/imageResize';
import { toast } from 'sonner';
import { Camera, X, Check } from 'lucide-react';
import { Button, Card, Input, Badge } from '@/components/ui/index';
import { Checkbox } from '@/components/ui/checkbox';
import { TAB_LABELS } from './helpers';

export function TabChecklists({
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

export function ChecklistSection({
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
      checklistUtils.storeChecklists.getLog.invalidate({ restaurantId, logDate: date });
    },
    onError: (error: any) => {
      toast.error(`저장 실패: ${error.message}`);
    },
  });

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
    </Card>
  );
}
