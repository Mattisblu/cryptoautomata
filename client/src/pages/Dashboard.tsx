import { useEffect } from "react";
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
import { useTradingContext } from "@/lib/tradingContext";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import type { Position, Order } from "@shared/schema";

export default function Dashboard() {
  const { 
    tradingMode, 
    selectedExchange, 
    selectedMarket,
    setPositions,
    setOrders,
  } = useTradingContext();
  const isManualMode = tradingMode === "manual";

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

  return (
    <div className="flex flex-col h-screen bg-background" data-testid="dashboard">
      {/* Header */}
      <header className="flex-shrink-0 h-16 border-b bg-card px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-semibold leading-none">CryptoBot</h1>
              <p className="text-[10px] text-muted-foreground">AI Trading Terminal</p>
            </div>
          </div>

          {/* Selectors */}
          <div className="flex items-center gap-4">
            <ExchangeSelector />
            <MarketSelector />
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <ConnectionStatus />
          <ThemeToggle />
        </div>
      </header>

      {/* Trading Mode Tabs */}
      <div className="flex-shrink-0 px-4 py-3 border-b bg-card/50">
        <TradingModeTabs />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
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

        {/* Right Column - Sidebar */}
        <div className="w-[380px] border-l bg-card/30 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 p-4 space-y-4 overflow-y-auto scrollbar-trading max-h-[calc(100vh-400px)]">
            {/* Credentials */}
            <CredentialsForm />

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
      </div>

      {/* Bottom Ticker Bar */}
      <TickerBar />
    </div>
  );
}
