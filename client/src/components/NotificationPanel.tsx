import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { 
  Bell, 
  Settings, 
  X, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  Target,
  Activity,
  Info,
  Check
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { Notification, NotificationSettings } from "@shared/schema";

function formatTimeAgo(timestamp: Date | string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "trade_open":
      return <Activity className="w-4 h-4 text-blue-500" />;
    case "trade_close":
      return <TrendingUp className="w-4 h-4 text-green-500" />;
    case "stop_loss":
      return <TrendingDown className="w-4 h-4 text-red-500" />;
    case "take_profit":
      return <Target className="w-4 h-4 text-green-500" />;
    case "trailing_stop":
      return <Activity className="w-4 h-4 text-yellow-500" />;
    case "error":
      return <AlertTriangle className="w-4 h-4 text-destructive" />;
    case "info":
    default:
      return <Info className="w-4 h-4 text-muted-foreground" />;
  }
}

function NotificationItem({ notification, onMarkRead }: { 
  notification: Notification; 
  onMarkRead: (id: number) => void;
}) {
  const pnl = notification.pnl;
  const isProfitable = pnl !== null && pnl >= 0;

  return (
    <div
      className={`p-3 hover-elevate cursor-pointer transition-colors ${
        !notification.isRead ? "bg-accent/30" : ""
      }`}
      onClick={() => !notification.isRead && onMarkRead(notification.id)}
      data-testid={`notification-item-${notification.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {getNotificationIcon(notification.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium truncate">{notification.title}</p>
            {!notification.isRead && (
              <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {notification.message}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">
              {formatTimeAgo(notification.createdAt)}
            </span>
            {pnl !== null && (
              <Badge 
                variant={isProfitable ? "default" : "destructive"} 
                className="text-xs px-1.5 py-0"
              >
                {isProfitable ? "+" : ""}{pnl.toFixed(2)}
              </Badge>
            )}
            {notification.exchange && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {notification.exchange}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationSettingsPanel({ settings, onUpdate }: {
  settings: NotificationSettings | null;
  onUpdate: (settings: Partial<NotificationSettings>) => void;
}) {
  const [localSettings, setLocalSettings] = useState<Partial<NotificationSettings>>({
    tradeOpenEnabled: true,
    tradeCloseEnabled: true,
    stopLossEnabled: true,
    takeProfitEnabled: true,
    browserEnabled: false,
    soundEnabled: false,
    minPnlAlert: 0,
    ...settings,
  });

  const handleToggle = (key: keyof NotificationSettings, value: boolean) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    onUpdate(newSettings);
  };

  return (
    <div className="p-4 space-y-4">
      <h4 className="text-sm font-medium">Notification Settings</h4>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm">Trade Opens</span>
          <Switch
            checked={localSettings.tradeOpenEnabled}
            onCheckedChange={(v) => handleToggle("tradeOpenEnabled", v)}
            data-testid="switch-trade-open"
          />
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-sm">Trade Closes</span>
          <Switch
            checked={localSettings.tradeCloseEnabled}
            onCheckedChange={(v) => handleToggle("tradeCloseEnabled", v)}
            data-testid="switch-trade-close"
          />
        </div>
        
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">Stop-Loss / Trailing Stops</span>
            <p className="text-xs text-muted-foreground">Includes trailing stop triggers</p>
          </div>
          <Switch
            checked={localSettings.stopLossEnabled}
            onCheckedChange={(v) => handleToggle("stopLossEnabled", v)}
            data-testid="switch-stop-loss"
          />
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-sm">Take-Profit Triggers</span>
          <Switch
            checked={localSettings.takeProfitEnabled}
            onCheckedChange={(v) => handleToggle("takeProfitEnabled", v)}
            data-testid="switch-take-profit"
          />
        </div>

        <Separator className="my-2" />

        <div className="flex items-center justify-between">
          <span className="text-sm">Browser Notifications</span>
          <Switch
            checked={localSettings.browserEnabled}
            onCheckedChange={(v) => handleToggle("browserEnabled", v)}
            data-testid="switch-browser"
          />
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-sm">Sound Alerts</span>
          <Switch
            checked={localSettings.soundEnabled}
            onCheckedChange={(v) => handleToggle("soundEnabled", v)}
            data-testid="switch-sound"
          />
        </div>
      </div>
    </div>
  );
}

export function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"notifications" | "settings">("notifications");

  const { data: notificationsData, isLoading } = useQuery<{ notifications: Notification[] }>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
  });

  const { data: settingsData } = useQuery<{ settings: NotificationSettings }>({
    queryKey: ["/api/notifications/settings"],
  });

  const notifications = notificationsData?.notifications || [];
  const settings = settingsData?.settings || null;
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: Partial<NotificationSettings>) => {
      await apiRequest("PUT", "/api/notifications/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/settings"] });
    },
  });

  const handleMarkRead = (id: number) => {
    markReadMutation.mutate(id);
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate();
  };

  const handleUpdateSettings = (newSettings: Partial<NotificationSettings>) => {
    updateSettingsMutation.mutate(newSettings);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium flex items-center justify-center px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-0" 
        align="end"
        data-testid="notification-popover"
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <TabsList className="h-8">
              <TabsTrigger value="notifications" className="text-xs px-2 h-6">
                <Bell className="w-3 h-3 mr-1" />
                Alerts
              </TabsTrigger>
              <TabsTrigger value="settings" className="text-xs px-2 h-6">
                <Settings className="w-3 h-3 mr-1" />
                Settings
              </TabsTrigger>
            </TabsList>
            {tab === "notifications" && unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={handleMarkAllRead}
                data-testid="button-mark-all-read"
              >
                <Check className="w-3 h-3 mr-1" />
                Mark all
              </Button>
            )}
          </div>

          <TabsContent value="notifications" className="m-0">
            <ScrollArea className="h-80">
              {isLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  No notifications yet
                </div>
              ) : (
                <div className="divide-y">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkRead={handleMarkRead}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="settings" className="m-0">
            <NotificationSettingsPanel
              settings={settings}
              onUpdate={handleUpdateSettings}
            />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
