import { Code, Clock, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTradingContext } from "@/lib/tradingContext";
import { cn } from "@/lib/utils";

function formatTimestamp(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return "Just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AlgorithmStatus() {
  const { activeAlgorithm, tradeCycleState } = useTradingContext();
  const isRunning = tradeCycleState.status === "running";

  if (!activeAlgorithm) {
    return (
      <Card data-testid="algorithm-status-empty">
        <CardContent className="py-4">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Code className="h-5 w-5" />
            <div className="flex-1">
              <p className="text-sm font-medium">No Algorithm Loaded</p>
              <p className="text-xs mt-1">
                Use the AI chatbot below to generate a trading strategy. 
                Try: "Generate a trading algorithm for BTCUSDT with 2% stop loss"
              </p>
              <p className="text-xs mt-2 text-profit">
                Then click "Load Algorithm" on the AI's response to activate it.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusConfig = {
    active: { icon: Loader2, color: "text-profit", animate: true },
    paused: { icon: AlertCircle, color: "text-yellow-500", animate: false },
    stopped: { icon: CheckCircle, color: "text-muted-foreground", animate: false },
  };

  const config = statusConfig[activeAlgorithm.status];
  const StatusIcon = config.icon;

  return (
    <Card data-testid="algorithm-status">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Code className="h-4 w-4" />
            Active Algorithm
          </CardTitle>
          <Badge 
            variant={isRunning ? "default" : "secondary"}
            className={cn(
              "text-xs",
              isRunning && "bg-profit text-white"
            )}
          >
            {isRunning ? "Running" : "Loaded"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-medium">{activeAlgorithm.name}</span>
          <Badge variant="outline" className="text-[10px]">
            v{activeAlgorithm.version}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/50 rounded-md px-2 py-1.5">
            <span className="text-muted-foreground">Mode</span>
            <p className="font-medium capitalize">
              {activeAlgorithm.mode.replace("-", " ")}
            </p>
          </div>
          <div className="bg-muted/50 rounded-md px-2 py-1.5">
            <span className="text-muted-foreground">Symbol</span>
            <p className="font-mono font-medium">{activeAlgorithm.symbol}</p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Rules</span>
            <span className="font-mono">{activeAlgorithm.rules.length}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Max Leverage</span>
            <span className="font-mono">{activeAlgorithm.riskManagement.maxLeverage}x</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Stop Loss</span>
            <span className="font-mono text-loss">
              {activeAlgorithm.riskManagement.stopLossPercent}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Take Profit</span>
            <span className="font-mono text-profit">
              {activeAlgorithm.riskManagement.takeProfitPercent}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t">
          <Clock className="h-3 w-3" />
          <span>Updated {formatTimestamp(activeAlgorithm.updatedAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
