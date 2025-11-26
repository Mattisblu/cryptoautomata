import { Wifi, WifiOff, Loader2, AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTradingContext } from "@/lib/tradingContext";
import { cn } from "@/lib/utils";

export function ConnectionStatus() {
  const { connectionState, selectedExchange } = useTradingContext();
  const { status, lastHeartbeat, error } = connectionState;

  const getStatusConfig = () => {
    switch (status) {
      case "connected":
        return {
          icon: Wifi,
          color: "text-profit",
          bgColor: "bg-profit/20",
          dotColor: "bg-profit",
          label: "Connected",
        };
      case "connecting":
        return {
          icon: Loader2,
          color: "text-yellow-500",
          bgColor: "bg-yellow-500/20",
          dotColor: "bg-yellow-500",
          label: "Connecting...",
          animate: true,
        };
      case "error":
        return {
          icon: AlertCircle,
          color: "text-loss",
          bgColor: "bg-loss/20",
          dotColor: "bg-loss",
          label: "Error",
        };
      default:
        return {
          icon: WifiOff,
          color: "text-muted-foreground",
          bgColor: "bg-muted",
          dotColor: "bg-muted-foreground",
          label: "Disconnected",
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  const formatLastHeartbeat = () => {
    if (!lastHeartbeat) return "Never";
    const diff = Date.now() - lastHeartbeat;
    if (diff < 1000) return "Just now";
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    return `${Math.floor(diff / 60000)}m ago`;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md",
            config.bgColor
          )}
          data-testid="status-connection"
        >
          <div className={cn("relative flex items-center justify-center")}>
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                config.dotColor,
                config.animate && "pulse-connecting"
              )}
            />
          </div>
          <Icon
            className={cn(
              "h-3.5 w-3.5",
              config.color,
              config.animate && "animate-spin"
            )}
          />
          <span className={cn("text-xs font-medium", config.color)}>
            {config.label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <div className="text-xs space-y-1">
          <div className="font-medium">
            {selectedExchange ? selectedExchange.toUpperCase() : "No Exchange"}
          </div>
          <div className="text-muted-foreground">
            Last heartbeat: {formatLastHeartbeat()}
          </div>
          {error && (
            <div className="text-loss">Error: {error}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
