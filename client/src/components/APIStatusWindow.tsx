import { AlertTriangle, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTradingContext } from "@/lib/tradingContext";
import { cn } from "@/lib/utils";

interface ApiStatus {
  id: string;
  timestamp: number;
  message: string;
  type: "error" | "warning" | "success" | "info";
  source: string;
}

export function APIStatusWindow() {
  const { dataError, connectionState } = useTradingContext();
  
  // Build status messages
  const statuses: ApiStatus[] = [];
  
  // Connection status
  if (connectionState.connected) {
    statuses.push({
      id: "connection-active",
      timestamp: Date.now(),
      message: "WebSocket connected",
      type: "success",
      source: "WebSocket",
    });
  } else if (connectionState.error) {
    statuses.push({
      id: "connection-error",
      timestamp: Date.now(),
      message: `Connection failed: ${connectionState.error}`,
      type: "error",
      source: "WebSocket",
    });
  }
  
  // Data errors
  if (dataError) {
    statuses.push({
      id: "data-error",
      timestamp: Date.now(),
      message: `Data error: ${dataError}`,
      type: "error",
      source: "Market Data",
    });
  }
  
  // Default status if no errors
  if (statuses.length === 0) {
    statuses.push({
      id: "all-good",
      timestamp: Date.now(),
      message: "All systems operational",
      type: "success",
      source: "System",
    });
  }

  const getIcon = (type: string) => {
    switch (type) {
      case "error":
        return <XCircle className="h-4 w-4 text-loss" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-profit" />;
      default:
        return <AlertCircle className="h-4 w-4 text-blue-500" />;
    }
  };

  const getBadgeVariant = (type: string) => {
    switch (type) {
      case "error":
        return "destructive";
      case "warning":
        return "secondary";
      case "success":
        return "outline";
      default:
        return "outline";
    }
  };

  const hasErrors = statuses.some((s) => s.type === "error");

  return (
    <Card data-testid="api-status-window" className={cn(
      "border",
      hasErrors && "border-loss/30"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {hasErrors ? (
              <XCircle className="h-4 w-4 text-loss" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-profit" />
            )}
            API Status
          </CardTitle>
          <Badge 
            variant={getBadgeVariant(hasErrors ? "error" : "success")}
            className="text-[10px]"
          >
            {hasErrors ? "Issues" : "Healthy"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[120px]">
          <div className="space-y-2 pr-4">
            {statuses.map((status) => (
              <div
                key={status.id}
                className="flex items-start gap-2 p-2 rounded-md bg-muted/30 text-xs"
              >
                <div className="flex-shrink-0 mt-0.5">
                  {getIcon(status.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-muted-foreground">
                      {status.source}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(status.timestamp).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className={cn(
                    "text-[11px] break-words",
                    status.type === "error" && "text-loss",
                    status.type === "warning" && "text-yellow-600 dark:text-yellow-500",
                    status.type === "success" && "text-profit",
                  )}>
                    {status.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
