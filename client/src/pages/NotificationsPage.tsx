import { trpc } from "@/lib/trpc";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bell, Check, AlertTriangle, Calendar, TrendingUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  schedule_change: { icon: <Calendar className="h-4 w-4" />, color: "text-blue-600 bg-blue-50", label: "스케줄 변경" },
  cost_exceeded: { icon: <AlertTriangle className="h-4 w-4" />, color: "text-red-600 bg-red-50", label: "비용 초과" },
  target_achieved: { icon: <TrendingUp className="h-4 w-4" />, color: "text-green-600 bg-green-50", label: "목표 달성" },
  general: { icon: <Info className="h-4 w-4" />, color: "text-gray-600 bg-gray-50", label: "일반" },
};

export default function NotificationsPage() {
  const utils = trpc.useUtils();
  const notifQuery = trpc.notifications.list.useQuery();
  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => { utils.notifications.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const notifications = notifQuery.data ?? [];
  const unread = notifications.filter((n: any) => !n.isRead).length;

  return (
    <AppLayout title="알림" subtitle={unread > 0 ? `읽지 않은 알림 ${unread}건` : "모든 알림을 읽었습니다"}>
      <div className="p-4 lg:p-6 space-y-3">
        {unread > 0 && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
              notifications.filter((n: any) => !n.isRead).forEach((n: any) => markReadMutation.mutate({ id: n.id }));
            }}>
              <Check className="h-3.5 w-3.5 mr-1" /> 모두 읽음 처리
            </Button>
          </div>
        )}

        {notifications.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Bell className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">알림이 없습니다.</p>
            </CardContent>
          </Card>
        ) : notifications.map((n: any) => {
          const config = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.general;
          return (
            <Card key={n.id} className={cn("transition-all", !n.isRead ? "border-blue-200 bg-blue-50/30" : "opacity-70")}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn("p-2 rounded-lg flex-shrink-0", config.color)}>
                    {config.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-sm">{n.title}</p>
                      <Badge variant="outline" className="text-xs">{config.label}</Badge>
                      {!n.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />}
                    </div>
                    {n.content && <p className="text-xs text-muted-foreground">{n.content}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString("ko-KR")}</p>
                  </div>
                  {!n.isRead && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => markReadMutation.mutate({ id: n.id })}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
}
