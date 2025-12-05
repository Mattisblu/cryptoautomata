import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Code, 
  Plus, 
  Trash2, 
  History, 
  FlaskConical, 
  Trophy, 
  Play, 
  Square,
  Pause,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Copy,
  CheckCircle,
  Loader2,
  ArrowLeft,
  Activity,
  StopCircle,
  Zap,
  Clock
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTradingContext } from "@/lib/tradingContext";
import type { TradingAlgorithm, AlgorithmVersion, AbTest, RunningStrategy } from "@shared/schema";
import { cn } from "@/lib/utils";

function formatDate(timestamp: number | Date | string | null): string {
  if (!timestamp) return "N/A";
  const date = typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AlgorithmCard({ 
  algorithm, 
  onDelete,
  onSaveVersion,
}: { 
  algorithm: TradingAlgorithm; 
  onDelete: () => void;
  onSaveVersion: () => void;
}) {
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const { setActiveAlgorithm, activeAlgorithm } = useTradingContext();
  const { toast } = useToast();
  const isActive = activeAlgorithm?.id === algorithm.id;

  const { data: versionsData } = useQuery<{ versions: AlgorithmVersion[] }>({
    queryKey: [`/api/algorithms/${algorithm.id}/versions`],
    enabled: isVersionsOpen,
  });

  const restoreVersionMutation = useMutation({
    mutationFn: async (versionId: number) => {
      return apiRequest("POST", `/api/algorithm-versions/${versionId}/restore`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/algorithms"] });
      queryClient.invalidateQueries({ queryKey: [`/api/algorithms/${algorithm.id}/versions`] });
      toast({
        title: "Version Restored",
        description: "Algorithm has been restored to the selected version.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Restore Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card className={cn(isActive && "border-profit")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{algorithm.name}</CardTitle>
            <Badge variant="outline" className="text-[10px]">v{algorithm.version}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {isActive && (
              <Badge className="bg-profit text-white text-xs">Active</Badge>
            )}
            <Badge variant="secondary" className="capitalize text-xs">
              {algorithm.mode.replace("-", " ")}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="bg-muted/50 rounded-md px-2 py-1.5">
            <span className="text-muted-foreground text-xs">Symbol</span>
            <p className="font-mono font-medium">{algorithm.symbol}</p>
          </div>
          <div className="bg-muted/50 rounded-md px-2 py-1.5">
            <span className="text-muted-foreground text-xs">Rules</span>
            <p className="font-mono font-medium">{algorithm.rules.length}</p>
          </div>
          <div className="bg-muted/50 rounded-md px-2 py-1.5">
            <span className="text-muted-foreground text-xs">Updated</span>
            <p className="font-medium text-xs">{formatDate(algorithm.updatedAt)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Max Leverage</span>
            <span className="font-mono">{algorithm.riskManagement.maxLeverage}x</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Stop Loss</span>
            <span className="font-mono text-loss">{algorithm.riskManagement.stopLossPercent}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Take Profit</span>
            <span className="font-mono text-profit">{algorithm.riskManagement.takeProfitPercent}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Max Position</span>
            <span className="font-mono">${algorithm.riskManagement.maxPositionSize}</span>
          </div>
        </div>

        <Collapsible open={isVersionsOpen} onOpenChange={setIsVersionsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              <span className="flex items-center gap-2">
                <History className="h-3.5 w-3.5" />
                Version History
              </span>
              {isVersionsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2">
            {versionsData?.versions && versionsData.versions.length > 0 ? (
              versionsData.versions.map((version) => (
                <div 
                  key={version.id} 
                  className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-mono text-xs">v{version.version}</span>
                    <span className="text-muted-foreground text-xs ml-2">
                      {formatDate(version.createdAt)}
                    </span>
                    {version.changeNotes && (
                      <p className="text-xs text-muted-foreground mt-1">{version.changeNotes}</p>
                    )}
                  </div>
                  <Button 
                    size="sm" 
                    variant="ghost"
                    onClick={() => restoreVersionMutation.mutate(version.id)}
                    disabled={restoreVersionMutation.isPending}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground text-center py-2">
                No version history. Save a version to track changes.
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        <div className="flex gap-2 pt-2 border-t">
          {!isActive && (
            <Button 
              size="sm" 
              className="flex-1 bg-profit hover:bg-profit/90"
              onClick={() => {
                setActiveAlgorithm(algorithm);
                toast({ title: "Algorithm Loaded", description: `${algorithm.name} is now active.` });
              }}
            >
              Load
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onSaveVersion} className="flex-1">
            <Copy className="h-3.5 w-3.5 mr-1" />
            Save Version
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-loss" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ABTestCard({ test, onComplete, onDelete }: { 
  test: AbTest; 
  onComplete: () => void;
  onDelete: () => void;
}) {
  const isRunning = test.status === "running";
  const isCompleted = test.status === "completed";
  const isPending = test.status === "pending";

  const aWinning = (test.pnlA || 0) > (test.pnlB || 0);
  const bWinning = (test.pnlB || 0) > (test.pnlA || 0);

  return (
    <Card className={cn(isRunning && "border-yellow-500")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{test.name}</CardTitle>
          </div>
          <Badge 
            variant={isRunning ? "default" : isCompleted ? "secondary" : "outline"}
            className={cn(
              "text-xs",
              isRunning && "bg-yellow-500 text-white",
              isCompleted && "bg-profit text-white"
            )}
          >
            {test.status.charAt(0).toUpperCase() + test.status.slice(1)}
          </Badge>
        </div>
        {test.description && (
          <CardDescription className="text-xs">{test.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className={cn(
            "border rounded-md p-3 space-y-2",
            aWinning && isCompleted && "border-profit bg-profit/5",
            test.winnerId === test.algorithmAId && "border-profit"
          )}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Strategy A</span>
              {test.winnerId === test.algorithmAId && (
                <Trophy className="h-4 w-4 text-profit" />
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{test.algorithmAName} v{test.algorithmAVersion}</p>
            <div className="grid grid-cols-2 gap-2 text-xs pt-2">
              <div>
                <span className="text-muted-foreground">Trades</span>
                <p className="font-mono font-medium">{test.tradesA || 0}</p>
              </div>
              <div>
                <span className="text-muted-foreground">PnL</span>
                <p className={cn(
                  "font-mono font-medium",
                  (test.pnlA || 0) >= 0 ? "text-profit" : "text-loss"
                )}>
                  {(test.pnlA || 0) >= 0 ? "+" : ""}${(test.pnlA || 0).toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Win Rate</span>
                <p className="font-mono font-medium">{(test.winRateA || 0).toFixed(1)}%</p>
              </div>
            </div>
          </div>

          <div className={cn(
            "border rounded-md p-3 space-y-2",
            bWinning && isCompleted && "border-profit bg-profit/5",
            test.winnerId === test.algorithmBId && "border-profit"
          )}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Strategy B</span>
              {test.winnerId === test.algorithmBId && (
                <Trophy className="h-4 w-4 text-profit" />
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{test.algorithmBName} v{test.algorithmBVersion}</p>
            <div className="grid grid-cols-2 gap-2 text-xs pt-2">
              <div>
                <span className="text-muted-foreground">Trades</span>
                <p className="font-mono font-medium">{test.tradesB || 0}</p>
              </div>
              <div>
                <span className="text-muted-foreground">PnL</span>
                <p className={cn(
                  "font-mono font-medium",
                  (test.pnlB || 0) >= 0 ? "text-profit" : "text-loss"
                )}>
                  {(test.pnlB || 0) >= 0 ? "+" : ""}${(test.pnlB || 0).toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Win Rate</span>
                <p className="font-mono font-medium">{(test.winRateB || 0).toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          <span>{test.exchange.toUpperCase()} · {test.symbol}</span>
          {test.startedAt && (
            <span className="ml-2">· Started {formatDate(test.startedAt)}</span>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t">
          {isRunning && (
            <Button size="sm" variant="outline" className="flex-1" onClick={onComplete}>
              <Square className="h-3.5 w-3.5 mr-1" />
              Complete Test
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-loss" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RunningStrategyCard({ 
  strategy, 
  onPause,
  onResume,
  onStop,
  onCloseAll,
}: { 
  strategy: RunningStrategy;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onCloseAll: () => void;
}) {
  const isRunning = strategy.status === "running";
  const isPaused = strategy.status === "paused";

  const runtime = strategy.startedAt 
    ? Math.floor((Date.now() - new Date(strategy.startedAt).getTime()) / 1000 / 60) 
    : 0;

  return (
    <Card className={cn(
      isRunning && "border-profit",
      isPaused && "border-yellow-500"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{strategy.algorithmName || "Strategy"}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge 
              variant={isRunning ? "default" : isPaused ? "secondary" : "outline"}
              className={cn(
                "text-xs",
                isRunning && "bg-profit text-white",
                isPaused && "bg-yellow-500 text-white"
              )}
            >
              {isRunning && <Zap className="h-3 w-3 mr-1" />}
              {isPaused && <Pause className="h-3 w-3 mr-1" />}
              {strategy.status.charAt(0).toUpperCase() + strategy.status.slice(1)}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {strategy.executionMode === "paper" ? "Paper" : "Real"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Exchange</span>
            <p className="font-medium">{strategy.exchange.toUpperCase()}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Symbol</span>
            <p className="font-mono font-medium">{strategy.symbol}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Optimization</span>
            <p className="font-medium capitalize">{strategy.optimizationMode}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Runtime</span>
            <p className="font-mono font-medium flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {runtime}m
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm border-t pt-4">
          <div>
            <span className="text-muted-foreground text-xs">Trades</span>
            <p className="font-mono font-medium">{strategy.totalTrades || 0}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">PnL</span>
            <p className={cn(
              "font-mono font-medium",
              (strategy.totalPnl || 0) >= 0 ? "text-profit" : "text-loss"
            )}>
              {(strategy.totalPnl || 0) >= 0 ? "+" : ""}${(strategy.totalPnl || 0).toFixed(2)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Win Rate</span>
            <p className="font-mono font-medium">
              {strategy.totalTrades > 0 
                ? ((strategy.successfulTrades / strategy.totalTrades) * 100).toFixed(1)
                : "0.0"}%
            </p>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Started {formatDate(strategy.startedAt)}
        </div>

        <div className="flex gap-2 pt-2 border-t flex-wrap">
          {isRunning && (
            <Button size="sm" variant="outline" onClick={onPause}>
              <Pause className="h-3.5 w-3.5 mr-1" />
              Pause
            </Button>
          )}
          {isPaused && (
            <Button size="sm" variant="outline" className="bg-profit text-white hover:bg-profit/90" onClick={onResume}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Resume
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onStop}>
            <Square className="h-3.5 w-3.5 mr-1" />
            Stop
          </Button>
          <Button size="sm" variant="ghost" className="text-loss" onClick={onCloseAll}>
            <StopCircle className="h-3.5 w-3.5 mr-1" />
            Close All
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Strategies() {
  const { toast } = useToast();
  const { selectedExchange, selectedMarket } = useTradingContext();
  const [isCreateTestOpen, setIsCreateTestOpen] = useState(false);
  const [saveVersionAlgoId, setSaveVersionAlgoId] = useState<string | null>(null);
  const [changeNotes, setChangeNotes] = useState("");
  const [newTest, setNewTest] = useState({
    name: "",
    description: "",
    algorithmAId: "",
    algorithmBId: "",
  });

  const { data: algorithmsData, isLoading: algorithmsLoading } = useQuery<{ algorithms: TradingAlgorithm[] }>({
    queryKey: ["/api/algorithms"],
  });

  const { data: abTestsData, isLoading: abTestsLoading } = useQuery<{ tests: AbTest[] }>({
    queryKey: ["/api/ab-tests"],
  });

  const { data: runningStrategiesData, isLoading: runningStrategiesLoading } = useQuery<{ strategies: RunningStrategy[] }>({
    queryKey: ["/api/running-strategies"],
    refetchInterval: 5000,
  });

  const pauseStrategyMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return apiRequest("POST", `/api/running-strategies/${sessionId}/pause`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/running-strategies"] });
      toast({ title: "Strategy Paused" });
    },
    onError: (error: Error) => {
      toast({ title: "Pause Failed", description: error.message, variant: "destructive" });
    },
  });

  const resumeStrategyMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return apiRequest("POST", `/api/running-strategies/${sessionId}/resume`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/running-strategies"] });
      toast({ title: "Strategy Resumed" });
    },
    onError: (error: Error) => {
      toast({ title: "Resume Failed", description: error.message, variant: "destructive" });
    },
  });

  const stopStrategyMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return apiRequest("POST", `/api/running-strategies/${sessionId}/stop`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/running-strategies"] });
      toast({ title: "Strategy Stopped" });
    },
    onError: (error: Error) => {
      toast({ title: "Stop Failed", description: error.message, variant: "destructive" });
    },
  });

  const closeAllStrategyMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return apiRequest("POST", `/api/running-strategies/${sessionId}/close-all`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/running-strategies"] });
      toast({ title: "Strategy Stopped", description: "All positions closed." });
    },
    onError: (error: Error) => {
      toast({ title: "Close Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteAlgorithmMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/algorithms/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/algorithms"] });
      toast({ title: "Algorithm Deleted" });
    },
  });

  const saveVersionMutation = useMutation({
    mutationFn: async ({ algorithmId, changeNotes }: { algorithmId: string; changeNotes: string }) => {
      return apiRequest("POST", `/api/algorithms/${algorithmId}/versions`, { changeNotes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/algorithms"] });
      setSaveVersionAlgoId(null);
      setChangeNotes("");
      toast({ title: "Version Saved", description: "A new version has been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const createAbTestMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/ab-tests", {
        ...newTest,
        exchange: selectedExchange || "coinstore",
        symbol: selectedMarket?.symbol || "BTCUSDT",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
      setIsCreateTestOpen(false);
      setNewTest({ name: "", description: "", algorithmAId: "", algorithmBId: "" });
      toast({ title: "A/B Test Created" });
    },
    onError: (error: Error) => {
      toast({ title: "Create Failed", description: error.message, variant: "destructive" });
    },
  });

  const startAbTestMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/ab-tests/${id}/start`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
      toast({ title: "A/B Test Started" });
    },
  });

  const completeAbTestMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/ab-tests/${id}/complete`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
      toast({ title: "A/B Test Completed" });
    },
  });

  const deleteAbTestMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/ab-tests/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
      toast({ title: "A/B Test Deleted" });
    },
  });

  const algorithms = algorithmsData?.algorithms || [];
  const abTests = abTestsData?.tests || [];
  const runningStrategies = runningStrategiesData?.strategies || [];
  const activeStrategies = runningStrategies.filter(s => s.status === "running" || s.status === "paused");

  return (
    <div className="container max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="button-back-to-dashboard">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Code className="w-6 h-6 text-primary" />
              Strategy Management
            </h1>
            <p className="text-muted-foreground text-sm">
              Manage your trading algorithms, version history, and A/B tests
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="running">
        <TabsList className="flex-wrap">
          <TabsTrigger value="running" className="gap-2" data-testid="tab-running-strategies">
            <Activity className="h-4 w-4" />
            Running
            {activeStrategies.length > 0 && (
              <Badge className="ml-1 bg-profit">{activeStrategies.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="algorithms" className="gap-2" data-testid="tab-algorithms">
            <Code className="h-4 w-4" />
            Algorithms
            {algorithms.length > 0 && (
              <Badge variant="secondary" className="ml-1">{algorithms.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ab-tests" className="gap-2" data-testid="tab-ab-tests">
            <FlaskConical className="h-4 w-4" />
            A/B Tests
            {abTests.filter(t => t.status === "running").length > 0 && (
              <Badge className="ml-1 bg-yellow-500">{abTests.filter(t => t.status === "running").length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="running" className="mt-6">
          {runningStrategiesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeStrategies.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Activity className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Running Strategies</h3>
                <p className="text-muted-foreground text-sm max-w-md mb-4">
                  Start a strategy from the Algorithms tab or use the AI chatbot on the Dashboard 
                  to generate and run trading algorithms.
                </p>
                <Link href="/">
                  <Button data-testid="button-go-to-dashboard">
                    <Play className="h-4 w-4 mr-2" />
                    Go to Dashboard
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {activeStrategies.length} active {activeStrategies.length === 1 ? "strategy" : "strategies"}
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {activeStrategies.map((strategy) => (
                  <RunningStrategyCard
                    key={strategy.sessionId}
                    strategy={strategy}
                    onPause={() => pauseStrategyMutation.mutate(strategy.sessionId)}
                    onResume={() => resumeStrategyMutation.mutate(strategy.sessionId)}
                    onStop={() => stopStrategyMutation.mutate(strategy.sessionId)}
                    onCloseAll={() => closeAllStrategyMutation.mutate(strategy.sessionId)}
                  />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="algorithms" className="mt-6">
          {algorithmsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : algorithms.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Code className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Algorithms Yet</h3>
                <p className="text-muted-foreground text-sm max-w-md">
                  Use the AI chatbot on the Dashboard to generate trading algorithms. 
                  They will appear here for management and version tracking.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {algorithms.map((algorithm) => (
                <AlgorithmCard
                  key={algorithm.id}
                  algorithm={algorithm}
                  onDelete={() => deleteAlgorithmMutation.mutate(algorithm.id)}
                  onSaveVersion={() => setSaveVersionAlgoId(algorithm.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ab-tests" className="mt-6 space-y-6">
          <div className="flex justify-end">
            <Dialog open={isCreateTestOpen} onOpenChange={setIsCreateTestOpen}>
              <DialogTrigger asChild>
                <Button disabled={algorithms.length < 2}>
                  <Plus className="h-4 w-4 mr-2" />
                  New A/B Test
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create A/B Test</DialogTitle>
                  <DialogDescription>
                    Compare two trading strategies side by side
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="test-name">Test Name</Label>
                    <Input
                      id="test-name"
                      placeholder="e.g., Momentum vs Mean Reversion"
                      value={newTest.name}
                      onChange={(e) => setNewTest({ ...newTest, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="test-description">Description (optional)</Label>
                    <Textarea
                      id="test-description"
                      placeholder="What are you testing?"
                      value={newTest.description}
                      onChange={(e) => setNewTest({ ...newTest, description: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Strategy A</Label>
                      <Select
                        value={newTest.algorithmAId}
                        onValueChange={(value) => setNewTest({ ...newTest, algorithmAId: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select algorithm" />
                        </SelectTrigger>
                        <SelectContent>
                          {algorithms.map((algo) => (
                            <SelectItem key={algo.id} value={algo.id}>
                              {algo.name} (v{algo.version})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Strategy B</Label>
                      <Select
                        value={newTest.algorithmBId}
                        onValueChange={(value) => setNewTest({ ...newTest, algorithmBId: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select algorithm" />
                        </SelectTrigger>
                        <SelectContent>
                          {algorithms.map((algo) => (
                            <SelectItem key={algo.id} value={algo.id}>
                              {algo.name} (v{algo.version})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateTestOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => createAbTestMutation.mutate()}
                    disabled={!newTest.name || !newTest.algorithmAId || !newTest.algorithmBId || createAbTestMutation.isPending}
                  >
                    {createAbTestMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create Test
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {abTestsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : abTests.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <FlaskConical className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No A/B Tests Yet</h3>
                <p className="text-muted-foreground text-sm max-w-md">
                  Create an A/B test to compare two trading strategies and find the best performer.
                  {algorithms.length < 2 && " You need at least 2 algorithms to create a test."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {abTests.map((test) => (
                <ABTestCard
                  key={test.id}
                  test={test}
                  onComplete={() => completeAbTestMutation.mutate(test.id)}
                  onDelete={() => deleteAbTestMutation.mutate(test.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!saveVersionAlgoId} onOpenChange={() => setSaveVersionAlgoId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Version</DialogTitle>
            <DialogDescription>
              Create a snapshot of the current algorithm state
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="change-notes">Change Notes (optional)</Label>
              <Textarea
                id="change-notes"
                placeholder="What changed in this version?"
                value={changeNotes}
                onChange={(e) => setChangeNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveVersionAlgoId(null)}>
              Cancel
            </Button>
            <Button 
              onClick={() => saveVersionAlgoId && saveVersionMutation.mutate({ algorithmId: saveVersionAlgoId, changeNotes })}
              disabled={saveVersionMutation.isPending}
            >
              {saveVersionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
