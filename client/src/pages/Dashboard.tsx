import { useEffect, useState } from "react";
import { ExchangeSelector } from "@/components/ExchangeSelector";
import { MarketSelector } from "@/components/MarketSelector";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TradingModeTabs } from "@/components/TradingModeTabs";
import { KlineChart } from "@/components/KlineChart";
import { TickerBar } from "@/components/TickerBar";
import { PositionsTable } from "@/components/PositionsTable";
import { OrdersTable } from "@/components/OrdersTable";
import { ManualTradingPanel } from "@/components/ManualTradingPanel";
import { CredentialsForm } from "@/components/CredentialsForm";
import { TradeCycleControls } from "@/components/TradeCycleControls";
import { AIChatbot } from "@/components/AIChatbot";
import { AlgorithmStatus } from "@/components/AlgorithmStatus";
import { RiskParametersCard } from "@/components/RiskParametersCard";
import { APIStatusWindow } from "@/components/APIStatusWindow";
import { NotificationPanel } from "@/components/NotificationPanel";
import { useTradingContext } from "@/lib/tradingContext";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useQuery } from "@tanstack/react-query";
import { Bot, BarChart3, Code, ExternalLink, PanelRightOpen, PanelRightClose, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import type { Position, Order, Kline } from "@shared/schema";

export default function Dashboard() {
  const { 
    tradingMode, 
    selectedExchange, 
    selectedMarket,
    setPositions,
    setOrders,
    setKlines,
  } = useTradingContext();
  const isManualMode = tradingMode === "manual";
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Connect to WebSocket for real-time updates
  useWebSocket();

  // Fetch positions
  const { data: positionsData } = useQuery<{ positions: Position[] }>({
    queryKey: [`/api/positions?exchange=${selectedExchange}`],
    enabled: !!selectedExchange,
    refetchInterval: 5000,
  });

  // Fetch orders
  const { data: ordersData } = useQuery<{ orders: Order[] }>({
    queryKey: [`/api/orders?exchange=${selectedExchange}`],
    enabled: !!selectedExchange,
    refetchInterval: 5000,
  });

  // Fetch klines
  const { data: klinesData } = useQuery<{ success: boolean; klines: Kline[] }>({
    queryKey: [
      `/api/klines`,
      selectedExchange,
      selectedMarket?.symbol,
      "15m",
    ],
    enabled: !!selectedExchange && !!selectedMarket?.symbol,
    queryFn: async () => {
      const url = `/api/klines?exchange=${selectedExchange}&symbol=${selectedMarket?.symbol}&timeframe=15m`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch klines");
      return response.json();
    },
  });

  // Update positions in context
  useEffect(() => {
    if (positionsData?.positions) {
      setPositions(positionsData.positions);
    }
  }, [positionsData, setPositions]);

  // Update orders in context
  useEffect(() => {
    if (ordersData?.orders) {
      setOrders(ordersData.orders);
    }
  }, [ordersData, setOrders]);

  // Update klines in context
  useEffect(() => {
    if (klinesData?.klines) {
      setKlines(klinesData.klines);
    }
  }, [klinesData, setKlines]);

  return (
    <div className="flex flex-col h-screen bg-background" data-testid="dashboard">
      {/* Header */}
      <header className="flex-shrink-0 h-14 sm:h-16 border-b bg-card px-2 sm:px-4 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md bg-primary flex items-center justify-center">
              <Bot className="h-4 w-4 sm:h-5 sm:w-5 text-primary-foreground" />
            </div>
            <div className="hidden md:block">
              <h1 className="text-lg font-semibold leading-none">CryptoBot</h1>
              <p className="text-[10px] text-muted-foreground">AI Trading Terminal</p>
            </div>
          </div>

          {/* Selectors */}
          <div className="flex items-center gap-2 sm:gap-4">
            <ExchangeSelector />
            <MarketSelector />
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1 sm:gap-3">
          <a href="/strategies" target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm" className="hidden lg:flex gap-1.5" data-testid="link-strategies">
              <Code className="w-4 h-4" />
              Strategies
              <ExternalLink className="w-3 h-3 ml-0.5 opacity-50" />
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden" data-testid="link-strategies-mobile">
              <Code className="w-4 h-4" />
            </Button>
          </a>
          <a href="/analytics" target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm" className="hidden lg:flex gap-1.5" data-testid="link-analytics">
              <BarChart3 className="w-4 h-4" />
              Analytics
              <ExternalLink className="w-3 h-3 ml-0.5 opacity-50" />
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden" data-testid="link-analytics-mobile">
              <BarChart3 className="w-4 h-4" />
            </Button>
          </a>
          <NotificationPanel />
          <ConnectionStatus />
          <ThemeToggle />
        </div>
      </header>

      {/* Trading Mode Tabs */}
      <div className="flex-shrink-0 px-4 py-3 border-b bg-card/50">
        <TradingModeTabs />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Column - Main Trading Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Trade Cycle Controls */}
          <div className="flex-shrink-0 p-4 pb-0">
            <TradeCycleControls />
          </div>

          {/* Chart and Data */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-trading">
            {/* Chart */}
            <KlineChart />

            {/* Positions & Orders */}
            <div className="grid gap-4 lg:grid-cols-2">
              <PositionsTable />
              <OrdersTable />
            </div>
          </div>
        </div>

        {/* Right Column - Desktop Sidebar (hidden on mobile/tablet) */}
        <div className="hidden xl:flex w-[380px] border-l bg-card/30 flex-col overflow-hidden">
          <div className="flex-shrink-0 p-4 space-y-4 overflow-y-auto scrollbar-trading max-h-[calc(100vh-450px)]">
            {/* Credentials */}
            <CredentialsForm />

            {/* API Status Window */}
            <APIStatusWindow />

            {/* Algorithm Status (AI modes only) */}
            {!isManualMode && <AlgorithmStatus />}

            {/* Risk Parameters (AI modes only) */}
            {!isManualMode && <RiskParametersCard />}

            {/* Manual Trading Panel (Manual mode only) */}
            {isManualMode && <ManualTradingPanel />}
          </div>

          {/* AI Chatbot (AI modes only) */}
          {!isManualMode && (
            <div className="flex-1 min-h-[300px] border-t overflow-hidden">
              <AIChatbot />
            </div>
          )}
        </div>

        {/* Mobile/Tablet Sidebar Toggle Button */}
        <div className="xl:hidden fixed bottom-20 right-4 z-50">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button 
                size="lg" 
                className="rounded-full shadow-lg h-14 w-14"
                data-testid="button-toggle-sidebar"
              >
                <PanelRightOpen className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-[400px] p-0 flex flex-col">
              <SheetTitle className="sr-only">Trading Panel</SheetTitle>
              <div className="flex-shrink-0 p-4 space-y-4 overflow-y-auto scrollbar-trading">
                {/* Credentials */}
                <CredentialsForm />

                {/* API Status Window */}
                <APIStatusWindow />

                {/* Algorithm Status (AI modes only) */}
                {!isManualMode && <AlgorithmStatus />}

                {/* Risk Parameters (AI modes only) */}
                {!isManualMode && <RiskParametersCard />}

                {/* Manual Trading Panel (Manual mode only) */}
                {isManualMode && <ManualTradingPanel />}
              </div>

              {/* AI Chatbot (AI modes only) */}
              {!isManualMode && (
                <div className="flex-1 min-h-[300px] border-t overflow-hidden">
                  <AIChatbot />
                </div>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Bottom Ticker Bar */}
      <TickerBar />
    </div>
  );
}
