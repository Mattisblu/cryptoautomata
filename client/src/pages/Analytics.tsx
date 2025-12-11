import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Target,
  DollarSign,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  FileText,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, BarChart, Bar } from "recharts";
import type { Trade } from "@shared/schema";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatDate(date: string | Date | null): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface AnalyticsData {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
}

function StatCard({ title, value, icon: Icon, trend, trendValue, className }: {
  title: string;
  value: string | number;
  icon: typeof TrendingUp;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  className?: string;
}) {
  return (
    <Card className={cn("relative overflow-hidden", className)} data-testid={`stat-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-mono font-bold mt-1">{value}</p>
            {trendValue && (
              <div className={cn(
                "flex items-center gap-1 text-xs mt-1",
                trend === "up" && "text-profit",
                trend === "down" && "text-loss",
                trend === "neutral" && "text-muted-foreground"
              )}>
                {trend === "up" && <ArrowUpRight className="w-3 h-3" />}
                {trend === "down" && <ArrowDownRight className="w-3 h-3" />}
                <span>{trendValue}</span>
              </div>
            )}
          </div>
          <div className={cn(
            "p-3 rounded-lg",
            trend === "up" && "bg-profit/10 text-profit",
            trend === "down" && "bg-loss/10 text-loss",
            !trend && "bg-muted text-muted-foreground"
          )}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const isProfitable = (trade.pnl || 0) > 0;
  const isOpen = trade.status === "open";

  return (
    <TableRow data-testid={`trade-row-${trade.id}`}>
      <TableCell>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              trade.positionSide === "long" ? "border-profit text-profit" : "border-loss text-loss"
            )}
          >
            {trade.positionSide.toUpperCase()}
          </Badge>
          <span className="font-mono font-medium">{trade.symbol}</span>
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-sm">
        {formatCurrency(trade.entryPrice)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">
        {trade.exitPrice ? formatCurrency(trade.exitPrice) : "-"}
      </TableCell>
      <TableCell className={cn(
        "text-right font-mono font-medium",
        isOpen ? "text-muted-foreground" : isProfitable ? "text-profit" : "text-loss"
      )}>
        {isOpen ? "Open" : formatCurrency(trade.pnl || 0)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">
        {trade.quantity.toFixed(4)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">
        {trade.leverage}x
      </TableCell>
      <TableCell>
        <Badge variant={trade.executionMode === "paper" ? "secondary" : "default"} className="text-xs">
          {trade.executionMode.toUpperCase()}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge 
          variant={isOpen ? "outline" : isProfitable ? "default" : "destructive"}
          className={cn(
            "text-xs",
            isOpen && "border-warning text-warning",
            !isOpen && isProfitable && "bg-profit/20 text-profit border-profit"
          )}
        >
          {trade.status.toUpperCase()}
        </Badge>
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">
        {formatDate(trade.openedAt)}
      </TableCell>
    </TableRow>
  );
}

export default function Analytics() {
  const [exchange, setExchange] = useState<string>("all");
  const [tradeLimit, setTradeLimit] = useState<string>("50");

  const { data: analyticsData, isLoading: analyticsLoading, refetch: refetchAnalytics } = useQuery<{ success: boolean; analytics: AnalyticsData }>({
    queryKey: ["/api/analytics", exchange],
    queryFn: async () => {
      const url = exchange === "all" ? "/api/analytics" : `/api/analytics?exchange=${exchange}`;
      const res = await fetch(url);
      return res.json();
    },
  });

  const { data: tradesData, isLoading: tradesLoading, refetch: refetchTrades } = useQuery<{ success: boolean; trades: Trade[] }>({
    queryKey: ["/api/trades", exchange, tradeLimit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: tradeLimit });
      if (exchange !== "all") params.append("exchange", exchange);
      const res = await fetch(`/api/trades?${params}`);
      return res.json();
    },
  });

  const analytics = analyticsData?.analytics;
  const trades = tradesData?.trades || [];

  const clearTradesMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/trades"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
    },
  });

  const clearingTrades = clearTradesMutation.isPending;

  const handleClearTrades = () => {
    if (window.confirm("Are you sure you want to clear all trade history? This cannot be undone.")) {
      clearTradesMutation.mutate();
    }
  };

  const winLossData = analytics ? [
    { name: "Wins", value: analytics.winningTrades, color: "hsl(var(--profit))" },
    { name: "Losses", value: analytics.losingTrades, color: "hsl(var(--loss))" },
  ] : [];

  const cumulativePnlData = trades
    .filter(t => t.status === "closed" && t.pnl !== null)
    .sort((a, b) => new Date(a.closedAt || a.openedAt).getTime() - new Date(b.closedAt || b.openedAt).getTime())
    .reduce((acc: { date: string; pnl: number }[], trade) => {
      const prevPnl = acc.length > 0 ? acc[acc.length - 1].pnl : 0;
      acc.push({
        date: formatDate(trade.closedAt || trade.openedAt),
        pnl: prevPnl + (trade.pnl || 0),
      });
      return acc;
    }, []);

  const handleRefresh = () => {
    refetchAnalytics();
    refetchTrades();
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="button-back">
                <ArrowDownRight className="w-4 h-4 mr-1 rotate-135" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-primary" />
                Trading Analytics
              </h1>
              <p className="text-sm text-muted-foreground">Track your trading performance and history</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Select value={exchange} onValueChange={setExchange}>
              <SelectTrigger className="w-36" data-testid="select-exchange-filter">
                <SelectValue placeholder="Exchange" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Exchanges</SelectItem>
                <SelectItem value="coinstore">Coinstore</SelectItem>
                <SelectItem value="bydfi">BYDFI</SelectItem>
                <SelectItem value="toobit">Toobit</SelectItem>
                <SelectItem value="bitunix">Bitunix</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={handleRefresh} data-testid="button-refresh">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {analyticsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : analytics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title="Total PnL"
              value={formatCurrency(analytics.totalPnl)}
              icon={DollarSign}
              trend={analytics.totalPnl >= 0 ? "up" : "down"}
              trendValue={`${analytics.totalTrades} trades`}
            />
            <StatCard
              title="Win Rate"
              value={`${analytics.winRate.toFixed(1)}%`}
              icon={Target}
              trend={analytics.winRate >= 50 ? "up" : "down"}
              trendValue={`${analytics.winningTrades}W / ${analytics.losingTrades}L`}
            />
            <StatCard
              title="Profit Factor"
              value={analytics.profitFactor === Infinity ? "∞" : analytics.profitFactor.toFixed(2)}
              icon={Activity}
              trend={analytics.profitFactor >= 1.5 ? "up" : analytics.profitFactor >= 1 ? "neutral" : "down"}
            />
            <StatCard
              title="Avg Win/Loss"
              value={`${formatCurrency(analytics.avgWin)} / ${formatCurrency(analytics.avgLoss)}`}
              icon={TrendingUp}
              trend={analytics.avgWin > analytics.avgLoss ? "up" : "down"}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2" data-testid="chart-cumulative-pnl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Cumulative PnL
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cumulativePnlData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={cumulativePnlData}>
                    <defs>
                      <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `$${value}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                      formatter={(value: number) => [formatCurrency(value), "PnL"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="hsl(var(--primary))"
                      fill="url(#pnlGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No completed trades yet</p>
                    <p className="text-xs mt-1">Start trading to see your performance</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="chart-win-loss">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Win/Loss Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {winLossData.some(d => d.value > 0) ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={winLossData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {winLossData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No trade data</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card data-testid="table-trade-history">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Trade History
              </CardTitle>
              <div className="flex items-center gap-2">
                {trades.length > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={handleClearTrades}
                    disabled={clearingTrades}
                    data-testid="button-clear-trades"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {clearingTrades ? "Clearing..." : "Clear"}
                  </Button>
                )}
                <Select value={tradeLimit} onValueChange={setTradeLimit}>
                  <SelectTrigger className="w-24" data-testid="select-trade-limit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">Exit</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Leverage</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradesLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8">
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Loading trades...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : trades.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        <div className="flex flex-col items-center">
                          <FileText className="w-8 h-8 mb-2 opacity-50" />
                          <p className="text-sm">No trades recorded yet</p>
                          <p className="text-xs mt-1">Execute trades to see them here</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    trades.map((trade) => (
                      <TradeRow key={trade.id} trade={trade} />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {analytics && analytics.totalTrades > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card data-testid="stat-largest-trades">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Largest Trades</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-profit/10 border border-profit/20">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-profit" />
                    <span className="text-sm">Largest Win</span>
                  </div>
                  <span className="font-mono font-bold text-profit">
                    {formatCurrency(analytics.largestWin)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-loss/10 border border-loss/20">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-5 h-5 text-loss" />
                    <span className="text-sm">Largest Loss</span>
                  </div>
                  <span className="font-mono font-bold text-loss">
                    {formatCurrency(analytics.largestLoss)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="stat-risk-metrics">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Risk Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Risk/Reward Ratio</span>
                  <span className="font-mono font-medium">
                    1:{analytics.avgLoss > 0 ? (analytics.avgWin / analytics.avgLoss).toFixed(2) : "∞"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Expectancy per Trade</span>
                  <span className={cn(
                    "font-mono font-medium",
                    analytics.totalPnl / analytics.totalTrades >= 0 ? "text-profit" : "text-loss"
                  )}>
                    {formatCurrency(analytics.totalPnl / analytics.totalTrades)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Trades</span>
                  <span className="font-mono font-medium">{analytics.totalTrades}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
