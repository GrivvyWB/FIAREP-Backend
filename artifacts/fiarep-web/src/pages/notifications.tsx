import { useListNotifications, useMarkNotificationRead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListNotificationsQueryKey } from "@workspace/api-client-react";
import { Bell, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Notifications() {
  const { data: notifications, isLoading } = useListNotifications();
  const markRead = useMarkNotificationRead();
  const queryClient = useQueryClient();

  const handleMarkRead = async (id: string) => {
    await markRead.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground text-sm">View and manage your alerts.</p>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border">
        <div className="p-4">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading notifications...</div>
          ) : notifications?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Bell className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-bold">All caught up!</h3>
              <p className="text-sm text-muted-foreground mt-1">You have no new notifications.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications?.map(notif => (
                <div key={notif.id} className={`flex items-start gap-4 p-4 transition-colors ${notif.read ? 'opacity-60' : 'bg-primary/5'}`}>
                  <div className={`w-10 h-10 rounded-full shrink-0 grid place-items-center ${notif.read ? 'bg-secondary text-muted-foreground' : 'bg-primary text-sidebar'}`}>
                    <Bell className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className={`text-[14.5px] ${notif.read ? '' : 'font-semibold'}`}>
                      {notif.message}
                    </p>
                    {notif.detail && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {notif.detail}
                      </p>
                    )}
                    <span className="text-xs text-muted-foreground block mt-2">
                      {new Date(notif.at).toLocaleString()}
                    </span>
                  </div>
                  {!notif.read && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="shrink-0 gap-1.5 h-8 text-xs font-semibold"
                      onClick={() => handleMarkRead(notif.id)}
                      disabled={markRead.isPending}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Mark Read
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
