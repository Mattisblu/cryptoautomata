import { useState } from "react";
import { Play, Pause, Square, AlertTriangle, Loader2, Clock, FlaskConical, Zap, Brain, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OptimizationMode } from "@shared/schema";
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
    selectedExchange,
    selectedMarket,
    tradingMode,
    executionMode,
    setExecutionMode,
    optimizationMode,
    setOptimizationMode,
    positions,
    activeAlgorithm,
  } = useTradingContext();
  const { toast } = useToast();
  const [showCloseAllDialog, setShowCloseAllDialog] = useState(false);

  const isRunning = tradeCycleState.status === "running";
  const isPaused = tradeCycleState.status === "paused";
  const isStopping = tradeCycleState.status === "stopping";
  const hasPositions = positions.length > 0;
  const isPaperTrading = executionMode === "paper";
  const canSwitchMode = !isRunning && !isPaused;

  const startTradingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/trading/start", {
        mode: tradingMode,
        executionMode,
        optimizationMode,
        symbol: selectedMarket?.symbol,
        algorithmId: activeAlgorithm?.id,
        exchange: selectedExchange,
      });
    },
    onSuccess: () => {
      setTradeCycleState({
        ...tradeCycleState,
        status: "running",
        mode: tradingMode,
        executionMode,
        optimizationMode,
        exchange: selectedExchange || tradeCycleState.exchange,
        symbol: selectedMarket?.symbol || "",
        startedAt: Date.now(),
        algorithmId: activeAlgorithm?.id,
      });
      const modeLabel = tradingMode === "ai-trading" ? "AI Trading" : tradingMode === "ai-scalping" ? "AI Scalping" : "Manual";
      const execLabel = isPaperTrading ? "Paper Trading" : "Real Trading";
      toast({
        title: "Trading Started",
        description: `${modeLabel} mode activated (${execLabel}).`,
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
        executionMode,
        optimizationMode,
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
        executionMode,
        optimizationMode,
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

  // Manual mode doesn't require an algorithm, AI modes do
  const requiresAlgorithm = tradingMode !== "manual";
  const hasRequiredAlgorithm = !requiresAlgorithm || Boolean(activeAlgorithm);
  const canStart = isAuthenticated && selectedMarket && !isRunning && !isPaused && !isStopping && hasRequiredAlgorithm;
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

            {/* Paper/Real Trading Indicator when running */}
            {(isRunning || isPaused) && (
              <Badge 
                variant={isPaperTrading ? "secondary" : "destructive"}
                className="text-xs gap-1"
                data-testid="badge-execution-mode"
              >
                {isPaperTrading ? (
                  <>
                    <FlaskConical className="h-3 w-3" />
                    Paper
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3" />
                    Real
                  </>
                )}
              </Badge>
            )}
          </div>

          {/* Paper/Real Trading Toggle */}
          <div className="flex items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md border transition-colors",
                  !canSwitchMode && "opacity-50",
                  isPaperTrading 
                    ? "border-muted bg-muted/30" 
                    : "border-yellow-500/50 bg-yellow-500/10"
                )}>
                  <div className="flex items-center gap-2">
                    <FlaskConical className={cn(
                      "h-4 w-4",
                      isPaperTrading ? "text-muted-foreground" : "text-muted-foreground/50"
                    )} />
                    <Label 
                      htmlFor="execution-mode" 
                      className={cn(
                        "text-sm cursor-pointer",
                        isPaperTrading ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      Paper
                    </Label>
                  </div>
                  
                  <Switch
                    id="execution-mode"
                    checked={!isPaperTrading}
                    onCheckedChange={(checked) => {
                      if (canSwitchMode) {
                        setExecutionMode(checked ? "real" : "paper");
                        toast({
                          title: checked ? "Real Trading Mode" : "Paper Trading Mode",
                          description: checked 
                            ? "Warning: Orders will be executed on the exchange with real funds!" 
                            : "Orders will be simulated without real funds.",
                          variant: checked ? "destructive" : "default",
                        });
                      }
                    }}
                    disabled={!canSwitchMode}
                    data-testid="switch-execution-mode"
                  />
                  
                  <div className="flex items-center gap-2">
                    <Label 
                      htmlFor="execution-mode" 
                      className={cn(
                        "text-sm cursor-pointer",
                        !isPaperTrading ? "text-yellow-500 font-medium" : "text-muted-foreground"
                      )}
                    >
                      Real
                    </Label>
                    <Zap className={cn(
                      "h-4 w-4",
                      !isPaperTrading ? "text-yellow-500" : "text-muted-foreground/50"
                    )} />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[250px]">
                {isPaperTrading ? (
                  <p>Paper Trading: Orders are simulated without using real funds. Safe for testing strategies.</p>
                ) : (
                  <p className="text-yellow-500">Real Trading: Orders will be executed on the exchange with real funds. Use with caution!</p>
                )}
                {!canSwitchMode && (
                  <p className="text-muted-foreground mt-1">Stop trading to switch modes.</p>
                )}
              </TooltipContent>
            </Tooltip>

            {/* Strategy Optimization Mode Selector */}
            {tradingMode !== "manual" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md border transition-colors",
                    !canSwitchMode && "opacity-50",
                    "border-muted bg-muted/30"
                  )}>
                    <Brain className="h-4 w-4 text-primary" />
                    <Select
                      value={optimizationMode}
                      onValueChange={(value: OptimizationMode) => {
                        if (canSwitchMode) {
                          setOptimizationMode(value);
                          const labels: Record<OptimizationMode, string> = {
                            "manual": "Manual Review",
                            "semi-auto": "Semi-Auto",
                            "full-auto": "Full Auto"
                          };
                          const descriptions: Record<OptimizationMode, string> = {
                            "manual": "AI will suggest changes for you to approve",
                            "semi-auto": "AI will auto-adjust parameters, but you approve major changes",
                            "full-auto": "AI can fully modify the strategy automatically"
                          };
                          toast({
                            title: `Strategy Optimization: ${labels[value]}`,
                            description: descriptions[value],
                          });
                        }
                      }}
                      disabled={!canSwitchMode}
                    >
                      <SelectTrigger 
                        className="w-[140px] h-8 text-sm border-0 bg-transparent"
                        data-testid="select-optimization-mode"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">
                          <div className="flex items-center gap-2">
                            <Settings2 className="h-3.5 w-3.5" />
                            <span>Manual Review</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="semi-auto">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>Semi-Auto</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="full-auto">
                          <div className="flex items-center gap-2">
                            <Brain className="h-3.5 w-3.5" />
                            <span>Full Auto</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px]">
                  <p className="font-medium mb-1">Live Strategy Optimization</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    How the AI adapts your strategy during trading:
                  </p>
                  <ul className="text-xs space-y-1.5">
                    <li className={optimizationMode === "manual" ? "text-primary" : "text-muted-foreground"}>
                      <span className="font-medium">Manual:</span> AI suggests, you approve
                    </li>
                    <li className={optimizationMode === "semi-auto" ? "text-primary" : "text-muted-foreground"}>
                      <span className="font-medium">Semi-Auto:</span> AI adjusts parameters, you approve big changes
                    </li>
                    <li className={optimizationMode === "full-auto" ? "text-primary" : "text-muted-foreground"}>
                      <span className="font-medium">Full Auto:</span> AI can rewrite strategy entirely
                    </li>
                  </ul>
                  {!canSwitchMode && (
                    <p className="text-muted-foreground mt-2 text-xs">Stop trading to change mode.</p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Control Buttons */}
          <div className="flex items-center gap-2">
            {!isRunning && !isPaused && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
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
                  </span>
                </TooltipTrigger>
                {!canStart && (
                  <TooltipContent side="bottom" className="max-w-[280px]">
                    <p className="font-medium mb-1">To start trading:</p>
                    <ul className="text-xs space-y-1 text-muted-foreground">
                      <li className={isAuthenticated ? "text-profit" : ""}>
                        {isAuthenticated ? "✓" : "1."} Connect to exchange
                      </li>
                      <li className={selectedMarket ? "text-profit" : ""}>
                        {selectedMarket ? "✓" : "2."} Select a market
                      </li>
                      {requiresAlgorithm && (
                        <li className={activeAlgorithm ? "text-profit" : ""}>
                          {activeAlgorithm ? "✓" : "3."} Generate & load a strategy (use the AI chatbot)
                        </li>
                      )}
                    </ul>
                    {!requiresAlgorithm && (
                      <p className="text-xs text-muted-foreground mt-1">Manual mode - no algorithm needed</p>
                    )}
                  </TooltipContent>
                )}
              </Tooltip>
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
