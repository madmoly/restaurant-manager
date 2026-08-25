import { useState, useMemo } from "react";
import { snapTo30Min } from "@/lib/scheduleHelpers";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { Settings, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SHIFT_PRESET_DEFAULTS } from "@/lib/scheduleHelpers";

interface ShiftPresetTabProps {
  restaurantId: number;
  shiftPresets: any[];
  onPresetsChange: () => void;
}

export default function ShiftPresetTab({ restaurantId, shiftPresets, onPresetsChange }: ShiftPresetTabProps) {
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [editForms, setEditForms] = useState<Record<string, { label: string; weekdayStart: string; weekdayEnd: string; weekdayBreak: number; weekendStart: string; weekendEnd: string; weekendBreak: number }>>({});
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newType, setNewType] = useState({ label: "", weekdayStart: "", weekdayEnd: "", weekdayBreak: 0, weekendStart: "", weekendEnd: "", weekendBreak: 0 });

  const utils = trpc.useUtils();

  const saveMut = trpc.restaurants.saveShiftPresets.useMutation({
    onSuccess() { toast.success("저장됨"); utils.restaurants.getShiftPresets.invalidate({ restaurantId }); onPresetsChange(); setExpandedType(null); },
    onError(e: any) { toast.error(e.message); },
  });
  const createMut = trpc.restaurants.createShiftPresetType.useMutation({
    onSuccess() { toast.success("근무유형 추가됨"); utils.restaurants.getShiftPresets.invalidate({ restaurantId }); onPresetsChange(); setShowAddCustom(false); setNewType({ label: "", weekdayStart: "", weekdayEnd: "", weekdayBreak: 0, weekendStart: "", weekendEnd: "", weekendBreak: 0 }); },
    onError(e: any) { toast.error(e.message); },
  });
  const deleteMut = trpc.restaurants.deleteShiftPreset.useMutation({
    onSuccess() { toast.success("삭제됨"); utils.restaurants.getShiftPresets.invalidate({ restaurantId }); onPresetsChange(); setExpandedType(null); },
    onError(e: any) { toast.error(e.message); },
  });
  const toggleMut = trpc.restaurants.toggleShiftPreset.useMutation({
    onSuccess() { utils.restaurants.getShiftPresets.invalidate({ restaurantId }); onPresetsChange(); },
    onError(e: any) { toast.error(e.message); },
  });

  const allTypes = useMemo(() => {
    const base = SHIFT_PRESET_DEFAULTS.map((p) => {
      const dbRow = (shiftPresets ?? []).find((r: any) => r.presetType === p.value);
      return { value: p.value, label: dbRow?.label || p.label, isCustom: false };
    });
    const custom = (shiftPresets ?? []).filter((p: any) => p.isCustom).reduce((acc: { value: string; label: string; isCustom: boolean }[], p: any) => { if (!acc.find((a) => a.value === p.presetType)) acc.push({ value: p.presetType, label: p.label || p.presetType, isCustom: true }); return acc; }, []);
    return [...base, ...custom];
  }, [shiftPresets]);

  const presetLabel = (v: string) => { const dbRow = shiftPresets?.find((p: any) => p.presetType === v); if (dbRow?.label) return dbRow.label; const d = SHIFT_PRESET_DEFAULTS.find((p) => p.value === v); return d?.label ?? v; };

  const openEdit = (presetType: string) => {
    if (expandedType === presetType) { setExpandedType(null); return; }
    const wd = (shiftPresets ?? []).find((p: any) => p.presetType === presetType && p.dayType === "weekday");
    const we = (shiftPresets ?? []).find((p: any) => p.presetType === presetType && p.dayType === "weekend");
    const label = wd?.label || we?.label || presetLabel(presetType);
    setEditForms((prev) => ({
      ...prev,
      [presetType]: {
        label,
        weekdayStart: wd?.startTime ?? "", weekdayEnd: wd?.endTime ?? "",
        weekdayBreak: wd?.breakMinutes ?? (presetType === "full" ? 60 : 0),
        weekendStart: we?.startTime ?? "", weekendEnd: we?.endTime ?? "",
        weekendBreak: we?.breakMinutes ?? (presetType === "full" ? 60 : 0),
      },
    }));
    setExpandedType(presetType);
  };

  const handleSaveType = (presetType: string) => {
    const f = editForms[presetType];
    if (!f) return;
    const items: any[] = [];
    const isCustom = !SHIFT_PRESET_DEFAULTS.some((d) => d.value === presetType);
    if (f.weekdayStart && f.weekdayEnd) {
      items.push({ presetType, dayType: "weekday" as const, label: f.label, startTime: f.weekdayStart, endTime: f.weekdayEnd, breakMinutes: f.weekdayBreak, isCustom });
    }
    const weStart = f.weekendStart || f.weekdayStart;
    const weEnd = f.weekendEnd || f.weekdayEnd;
    const weBreak = f.weekendStart ? f.weekendBreak : f.weekdayBreak;
    if (weStart && weEnd) {
      items.push({ presetType, dayType: "weekend" as const, label: f.label, startTime: weStart, endTime: weEnd, breakMinutes: weBreak, isCustom });
    }
    if (items.length === 0) { toast.error("평일 시간을 입력해주세요"); return; }
    saveMut.mutate({ restaurantId, presets: items });
  };

  const handleAddCustom = () => {
    if (!newType.label || !newType.weekdayStart || !newType.weekdayEnd) { toast.error("이름과 평일 시간을 입력해주세요"); return; }
    const key = `custom_${Date.now().toString(36)}`;
    createMut.mutate({
      restaurantId, presetType: key, label: newType.label,
      weekday: { startTime: newType.weekdayStart, endTime: newType.weekdayEnd, breakMinutes: newType.weekdayBreak },
      weekend: newType.weekendStart && newType.weekendEnd
        ? { startTime: newType.weekendStart, endTime: newType.weekendEnd, breakMinutes: newType.weekendBreak }
        : undefined,
    });
  };

  const TimeRow = ({ label, startTime, endTime, breakMin, onStartChange, onEndChange, onBreakChange }: {
    label: string; startTime: string; endTime: string; breakMin: number;
    onStartChange: (v: string) => void; onEndChange: (v: string) => void; onBreakChange: (v: number) => void;
  }) => (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="w-8 text-muted-foreground shrink-0">{label}</span>
      <input type="time" step="1800" value={startTime} onChange={(e) => onStartChange(snapTo30Min(e.target.value))} className="w-[90px] rounded border border-input bg-background px-1.5 py-1 text-xs" />
      <span className="text-muted-foreground">~</span>
      <input type="time" step="1800" value={endTime} onChange={(e) => onEndChange(snapTo30Min(e.target.value))} className="w-[90px] rounded border border-input bg-background px-1.5 py-1 text-xs" />
      <span className="text-muted-foreground shrink-0 ml-1">휴게</span>
      <input type="number" value={breakMin} onChange={(e) => onBreakChange(Number(e.target.value) || 0)} className="w-[48px] rounded border border-input bg-background px-1 py-1 text-xs text-center" min={0} max={180} />
      <span className="text-muted-foreground">분</span>
    </div>
  );

  const calcHours = (start?: string, end?: string, breakMin?: number) => {
    if (!start || !end) return null;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let totalMin = (eh * 60 + em) - (sh * 60 + sm);
    if (totalMin <= 0) totalMin += 24 * 60;
    totalMin -= (breakMin || 0);
    const rounded = Math.floor(Math.max(0, totalMin) / 10) * 10;
    return rounded / 60;
  };
  const fmtHours = (h: number | null) => h !== null ? (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" /> 근무유형 프리셋
          </CardTitle>
          <button
            onClick={() => { setShowAddCustom(!showAddCustom); setExpandedType(null); }}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 유형 추가
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* 커스텀 추가 폼 */}
        {showAddCustom && (
          <div className="p-3 rounded-lg bg-violet-50/50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 space-y-2.5">
            <p className="text-xs font-semibold text-violet-700 dark:text-violet-400">새 근무유형</p>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">이름</label>
              <input
                value={newType.label} onChange={(e) => setNewType({ ...newType, label: e.target.value })}
                placeholder="예: 미들, 라운지, 주방오픈"
                className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs"
              />
            </div>
            <TimeRow label="평일"
              startTime={newType.weekdayStart} endTime={newType.weekdayEnd} breakMin={newType.weekdayBreak}
              onStartChange={(v) => setNewType({ ...newType, weekdayStart: v })}
              onEndChange={(v) => setNewType({ ...newType, weekdayEnd: v })}
              onBreakChange={(v) => setNewType({ ...newType, weekdayBreak: v })}
            />
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">주말 <span className="text-muted-foreground/60">(비우면 평일과 동일)</span></p>
              <TimeRow label="주말"
                startTime={newType.weekendStart} endTime={newType.weekendEnd} breakMin={newType.weekendBreak}
                onStartChange={(v) => setNewType({ ...newType, weekendStart: v })}
                onEndChange={(v) => setNewType({ ...newType, weekendEnd: v })}
                onBreakChange={(v) => setNewType({ ...newType, weekendBreak: v })}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleAddCustom} disabled={createMut.isPending} className="h-7 px-3 text-xs">추가</Button>
              <button onClick={() => setShowAddCustom(false)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
            </div>
          </div>
        )}

        {/* 프리셋 목록 */}
        <div className="space-y-1.5">
          {allTypes.map((pt) => {
            const rows = (shiftPresets ?? []).filter((p: any) => p.presetType === pt.value);
            const hasData = rows.length > 0;
            const isActive = hasData ? rows.some((r: any) => r.isActive !== false) : true;
            const wd = rows.find((r: any) => r.dayType === "weekday");
            const we = rows.find((r: any) => r.dayType === "weekend");
            const isExpanded = expandedType === pt.value;
            const sameTime = wd && we && wd.startTime === we.startTime && wd.endTime === we.endTime && wd.breakMinutes === we.breakMinutes;
            const wdHours = wd ? calcHours(wd.startTime, wd.endTime, wd.breakMinutes) : null;
            const weHours = we ? calcHours(we.startTime, we.endTime, we.breakMinutes) : null;

            return (
              <div
                key={pt.value}
                className={`rounded-lg border transition-all ${isExpanded ? "border-primary/40 bg-accent/30" : "border-border/60 hover:border-border"} ${!isActive ? "opacity-50" : ""}`}
              >
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                  onClick={() => openEdit(pt.value)}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {pt.isCustom && <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />}
                    <span className={`text-xs font-medium truncate ${!isActive ? "line-through" : ""}`}>
                      {pt.label}
                    </span>
                  </div>

                  <div className="flex flex-col items-end text-[11px] text-muted-foreground shrink-0 leading-tight">
                    {wd && sameTime && (
                      <span>
                        {wd.startTime}~{wd.endTime}
                        {wd.breakMinutes > 0 && <span className="text-orange-500 ml-0.5">휴{wd.breakMinutes}</span>}
                        {wdHours !== null && <span className="text-primary font-medium ml-1">{fmtHours(wdHours)}</span>}
                      </span>
                    )}
                    {wd && !sameTime && (
                      <span>
                        평 {wd.startTime}~{wd.endTime}
                        {wd.breakMinutes > 0 && <span className="text-orange-500 ml-0.5">휴{wd.breakMinutes}</span>}
                        {wdHours !== null && <span className="text-primary/70 ml-0.5">{fmtHours(wdHours)}</span>}
                      </span>
                    )}
                    {we && !sameTime && (
                      <span>
                        주 {we.startTime}~{we.endTime}
                        {we.breakMinutes > 0 && <span className="text-orange-500 ml-0.5">휴{we.breakMinutes}</span>}
                        {weHours !== null && <span className="text-primary/70 ml-0.5">{fmtHours(weHours)}</span>}
                      </span>
                    )}
                    {!wd && !we && <span className="italic text-muted-foreground/60">미설정</span>}
                  </div>

                  <Pencil className={`w-3 h-3 shrink-0 transition-colors ${isExpanded ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`} />

                  {hasData && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={isActive}
                        onCheckedChange={(checked: boolean) => toggleMut.mutate({ restaurantId, presetType: pt.value, isActive: checked })}
                        className="scale-90"
                      />
                    </div>
                  )}
                </div>

                {isExpanded && editForms[pt.value] && (
                  <div className="px-3 pb-3 space-y-2.5 border-t border-border/40 pt-2.5">
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-0.5">표시 이름</label>
                      <input
                        value={editForms[pt.value].label}
                        onChange={(e) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], label: e.target.value } }))}
                        className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs font-medium"
                        placeholder="표시 이름"
                      />
                    </div>

                    <TimeRow label="평일"
                      startTime={editForms[pt.value].weekdayStart}
                      endTime={editForms[pt.value].weekdayEnd}
                      breakMin={editForms[pt.value].weekdayBreak}
                      onStartChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekdayStart: v } }))}
                      onEndChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekdayEnd: v } }))}
                      onBreakChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekdayBreak: v } }))}
                    />
                    {editForms[pt.value].weekdayStart && editForms[pt.value].weekdayEnd && (() => {
                      const h = calcHours(editForms[pt.value].weekdayStart, editForms[pt.value].weekdayEnd, editForms[pt.value].weekdayBreak);
                      return h !== null ? <p className="text-[10px] text-primary font-medium pl-9">실근무 {fmtHours(h)}</p> : null;
                    })()}

                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">주말 <span className="text-muted-foreground/60">(비우면 평일과 동일)</span></p>
                      <TimeRow label="주말"
                        startTime={editForms[pt.value].weekendStart}
                        endTime={editForms[pt.value].weekendEnd}
                        breakMin={editForms[pt.value].weekendBreak}
                        onStartChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekendStart: v } }))}
                        onEndChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekendEnd: v } }))}
                        onBreakChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekendBreak: v } }))}
                      />
                      {editForms[pt.value].weekendStart && editForms[pt.value].weekendEnd && (() => {
                        const h = calcHours(editForms[pt.value].weekendStart, editForms[pt.value].weekendEnd, editForms[pt.value].weekendBreak);
                        return h !== null ? <p className="text-[10px] text-primary font-medium pl-9">실근무 {fmtHours(h)}</p> : null;
                      })()}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" onClick={() => handleSaveType(pt.value)} disabled={saveMut.isPending} className="h-7 px-4 text-xs">저장</Button>
                      <button onClick={() => setExpandedType(null)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                      {pt.isCustom && (
                        <button
                          onClick={() => { if (confirm(`"${pt.label}" 유형을 삭제하시겠습니까?`)) deleteMut.mutate({ id: rows[0]?.id }); }}
                          className="ml-auto text-xs text-red-400 hover:text-red-600 flex items-center gap-0.5"
                        >
                          <Trash2 className="w-3 h-3" /> 삭제
                        </button>
                      )}
                    </div>

                    {!pt.isCustom && (
                      <p className="text-[10px] text-muted-foreground/60">시간을 비우면 매장 영업시간 기반으로 자동 계산됩니다</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
