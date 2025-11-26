import { useState } from "react";
import { Play, Pause, Square, AlertTriangle, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTradingContext } from "@/lib/tradingContext";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function formatDuration(startTime: number): string {
  const diff = Date.now() - startTime;
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function TradeCycleControls() {
  const { 
    tradeCycleState, 
    setTradeCycleState, 
    isAuthenticated, 
    selectedMarket,
    tradingMode,
    positions,
    activeAlgorithm,
  } = useTradingContext();
  const { toast } = useToast();
  const [showCloseAllDialog, setShowCloseAllDialog] = useState(false);

  const isRunning = tradeCycleState.status === "running";
  const isPaused = tradeCycleState.status === "paused";
  const isStopping = tradeCycleState.status === "stopping";
  const hasPositions = positions.length > 0;

  const startTradingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/trading/start", {
        mode: tradingMode,
        symbol: selectedMarket?.symbol,
        algorithmId: activeAlgorithm?.id,
      });
    },
    onSuccess: () => {
      setTradeCycleState({
        ...tradeCycleState,
        status: "running",
        mode: tradingMode,
        symbol: selectedMarket?.symbol || "",
        startedAt: Date.now(),
        algorithmId: activeAlgorithm?.id,
      });
      toast({
        title: "Trading Started",
        description: `${tradingMode === "ai-trading" ? "AI Trading" : tradingMode === "ai-scalping" ? "AI Scalping" : "Manual"} mode activated.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Start",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const pauseTradingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/trading/pause", {});
    },
    onSuccess: () => {
      setTradeCycleState({
        ...tradeCycleState,
        status: "paused",
      });
      toast({
        title: "Trading Paused",
        description: "Trade cycle has been paused. Existing positions are maintained.",
      });
    },
  });

  const resumeTradingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/trading/resume", {});
    },
    onSuccess: () => {
      setTradeCycleState({
        ...tradeCycleState,
        status: "running",
      });
      toast({
        title: "Trading Resumed",
        description: "Trade cycle has been resumed.",
      });
    },
  });

  const stopTradingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/trading/stop", {});
    },
    onSuccess: () => {
      setTradeCycleState({
        status: "idle",
        mode: tradingMode,
        exchange: tradeCycleState.exchange,
        symbol: "",
      });
      toast({
        title: "Trading Stopped",
        description: "Trade cycle has been stopped. Positions remain open.",
      });
    },
  });

  const closeAllPositionsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/trading/close-all", {});
    },
    onSuccess: () => {
      setTradeCycleState({
        status: "idle",
        mode: tradingMode,
        exchange: tradeCycleState.exchange,
        symbol: "",
      });
      setShowCloseAllDialog(false);
      toast({
        title: "All Positions Closed",
        description: "All open positions have been closed and trading has stopped.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Close Positions",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canStart = isAuthenticated && selectedMarket && !isRunning && !isPaused && !isStopping;
  const canPause = isRunning;
  const canResume = isPaused;
  const canStop = isRunning || isPaused;

  return (
    <Card data-testid="trade-cycle-controls">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Status Display */}
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md",
              isRunning ? "bg-profit/10" : 
              isPaused ? "bg-yellow-500/10" : 
              isStopping ? "bg-loss/10" : "bg-muted"
            )}>
              <div className={cn(
                "w-2 h-2 rounded-full",
                isRunning ? "bg-profit" : 
                isPaused ? "bg-yellow-500" : 
                isStopping ? "bg-loss animate-pulse" : "bg-muted-foreground"
              )} />
              <span className={cn(
                "text-sm font-medium",
                isRunning ? "text-profit" : 
                isPaused ? "text-yellow-500" : 
                isStopping ? "text-loss" : "text-muted-foreground"
              )} data-testid="text-trading-status">
                {isRunning ? "Trading Active" : 
                 isPaused ? "Paused" : 
                 isStopping ? "Stopping..." : "Idle"}
              </span>
            </div>

            {(isRunning || isPaused) && tradeCycleState.startedAt && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span className="font-mono" data-testid="text-trading-duration">
                  {formatDuration(tradeCycleState.startedAt)}
                </span>
              </div>
            )}

            {activeAlgorithm && (isRunning || isPaused) && (
              <Badge variant="outline" className="text-xs">
                {activeAlgorithm.name}
              </Badge>
            )}
          </div>

          {/* Control Buttons */}
          <div className="flex items-center gap-2">
            {!isRunning && !isPaused && (
              <Button
                onClick={() => startTradingMutation.mutate()}
                disabled={!canStart || startTradingMutation.isPending}
                className="bg-profit hover:bg-profit/90 text-white"
                data-testid="button-start-trading"
              >
                {startTradingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Start Trading
              </Button>
            )}

            {isRunning && (
              <Button
                variant="outline"
                onClick={() => pauseTradingMutation.mutate()}
                disabled={!canPause || pauseTradingMutation.isPending}
                data-testid="button-pause-trading"
              >
                {pauseTradingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Pause className="h-4 w-4 mr-2" />
                )}
                Pause
              </Button>
            )}

            {isPaused && (
              <Button
                onClick={() => resumeTradingMutation.mutate()}
                disabled={!canResume || resumeTradingMutation.isPending}
                className="bg-profit hover:bg-profit/90 text-white"
                data-testid="button-resume-trading"
              >
                {resumeTradingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Resume
              </Button>
            )}

            {(isRunning || isPaused) && (
              <Button
                variant="outline"
                onClick={() => stopTradingMutation.mutate()}
                disabled={!canStop || stopTradingMutation.isPending}
                data-testid="button-stop-trading"
              >
                {stopTradingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Square className="h-4 w-4 mr-2" />
                )}
                Stop
              </Button>
            )}

            {/* Close All Positions */}
            <AlertDialog open={showCloseAllDialog} onOpenChange={setShowCloseAllDialog}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={!hasPositions && !isRunning && !isPaused}
                  data-testid="button-close-all-positions"
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Close All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-loss" />
                    Close All Positions
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will immediately close all open positions at market price and stop the trading cycle. 
                    This action cannot be undone.
                    {hasPositions && (
                      <div className="mt-2 p-2 bg-loss/10 rounded-md text-loss text-sm">
                        You have {positions.length} open position{positions.length > 1 ? "s" : ""} that will be closed.
                      </div>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-close-all">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => closeAllPositionsMutation.mutate()}
                    className="bg-loss hover:bg-loss/90"
                    disabled={closeAllPositionsMutation.isPending}
                    data-testid="button-confirm-close-all"
                  >
                    {closeAllPositionsMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Closing...
                      </>
                    ) : (
                      "Close All Positions"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
