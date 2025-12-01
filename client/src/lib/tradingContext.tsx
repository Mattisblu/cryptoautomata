import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type {
  Exchange,
  Market,
  TradingMode,
  ExecutionMode,
  OptimizationMode,
  Ticker,
  Kline,
  Position,
  Order,
  TradingAlgorithm,
  ChatMessage,
  TradeCycleState,
  ConnectionState,
  ApiCredentials,
  RiskParameters,
  OptimizationSuggestion,
  LiveStrategyMetrics,
} from "@shared/schema";

interface TradingContextValue {
  // Exchange & Market
  selectedExchange: Exchange | null;
  setSelectedExchange: (exchange: Exchange | null) => void;
  selectedMarket: Market | null;
  setSelectedMarket: (market: Market | null) => void;
  markets: Market[];
  setMarkets: (markets: Market[]) => void;
  
  // Trading mode
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
  
  // Execution mode (Paper vs Real)
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;
  
  // Optimization mode for live strategy adjustments
  optimizationMode: OptimizationMode;
  setOptimizationMode: (mode: OptimizationMode) => void;
  
  // Optimization suggestions from AI
  optimizationSuggestions: OptimizationSuggestion[];
  addOptimizationSuggestion: (suggestion: Omit<OptimizationSuggestion, "id" | "timestamp">) => void;
  updateOptimizationSuggestion: (id: string, status: OptimizationSuggestion["status"]) => void;
  clearOptimizationSuggestions: () => void;
  
  // Live strategy metrics
  liveMetrics: LiveStrategyMetrics | null;
  setLiveMetrics: (metrics: LiveStrategyMetrics | null) => void;
  
  // Chart timeframe
  timeframe: string;
  setTimeframe: (timeframe: string) => void;
  
  // Risk parameters
  riskParameters: RiskParameters | null;
  setRiskParameters: (params: RiskParameters | null) => void;
  
  // Market data
  ticker: Ticker | null;
  setTicker: (ticker: Ticker | null) => void;
  klines: Kline[];
  setKlines: (klines: Kline[]) => void;
  
  // Positions & Orders
  positions: Position[];
  setPositions: (positions: Position[]) => void;
  orders: Order[];
  setOrders: (orders: Order[]) => void;
  
  // AI & Algorithms
  chatMessages: ChatMessage[];
  addChatMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  clearChatMessages: () => void;
  activeAlgorithm: TradingAlgorithm | null;
  setActiveAlgorithm: (algo: TradingAlgorithm | null) => void;
  
  // Trade cycle
  tradeCycleState: TradeCycleState;
  setTradeCycleState: (state: TradeCycleState) => void;
  
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
  
  // Credentials
  credentials: ApiCredentials | null;
  setCredentials: (creds: ApiCredentials | null) => void;
  isAuthenticated: boolean;
  
  // Theme
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const TradingContext = createContext<TradingContextValue | null>(null);

export function TradingProvider({ children }: { children: ReactNode }) {
  // Exchange & Market state
  const [selectedExchange, setSelectedExchange] = useState<Exchange | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  
  // Trading mode
  const [tradingMode, setTradingMode] = useState<TradingMode>("ai-trading");
  
  // Execution mode (Paper vs Real trading)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("paper");
  
  // Optimization mode for live strategy adjustments
  const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>("manual");
  
  // Optimization suggestions from AI
  const [optimizationSuggestions, setOptimizationSuggestions] = useState<OptimizationSuggestion[]>([]);
  
  // Live strategy metrics
  const [liveMetrics, setLiveMetrics] = useState<LiveStrategyMetrics | null>(null);
  
  // Chart timeframe
  const [timeframe, setTimeframe] = useState<string>("15m");
  
  // Risk parameters (initialized with defaults so AI always has context)
  const defaultRiskParams: RiskParameters = {
    maxPositionSize: 1000,
    maxLeverage: 10,
    stopLossPercent: 2,
    takeProfitPercent: 4,
    maxDailyLoss: 1000,
    trailingStop: false,
    trailingStopPercent: 1.5,
    autoStopLoss: true,
    autoTakeProfit: true,
    breakEvenTrigger: 2,
  };
  const [riskParameters, setRiskParameters] = useState<RiskParameters | null>(defaultRiskParams);
  
  // Market data
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [klines, setKlines] = useState<Kline[]>([]);
  
  // Positions & Orders
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  
  // Chat & Algorithms
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activeAlgorithm, setActiveAlgorithm] = useState<TradingAlgorithm | null>(null);
  
  // Trade cycle
  const [tradeCycleState, setTradeCycleState] = useState<TradeCycleState>({
    status: "idle",
    mode: "ai-trading",
    executionMode: "paper",
    optimizationMode: "manual",
    exchange: "coinstore",
    symbol: "",
  });
  
  // Connection
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: "disconnected",
    exchange: "coinstore",
  });
  
  // Credentials
  const [credentials, setCredentials] = useState<ApiCredentials | null>(null);
  
  // Theme
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  
  const addChatMessage = useCallback((message: Omit<ChatMessage, "id" | "timestamp">) => {
    const newMessage: ChatMessage = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev, newMessage]);
  }, []);
  
  const clearChatMessages = useCallback(() => {
    setChatMessages([]);
  }, []);
  
  const addOptimizationSuggestion = useCallback((suggestion: Omit<OptimizationSuggestion, "id" | "timestamp">) => {
    const newSuggestion: OptimizationSuggestion = {
      ...suggestion,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    setOptimizationSuggestions(prev => [...prev, newSuggestion]);
  }, []);
  
  const updateOptimizationSuggestion = useCallback((id: string, status: OptimizationSuggestion["status"]) => {
    setOptimizationSuggestions(prev => 
      prev.map(s => s.id === id ? { ...s, status } : s)
    );
  }, []);
  
  const clearOptimizationSuggestions = useCallback(() => {
    setOptimizationSuggestions([]);
  }, []);
  
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const newTheme = prev === "dark" ? "light" : "dark";
      if (newTheme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      return newTheme;
    });
  }, []);
  
  // Initialize theme from document
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);
  
  const isAuthenticated = credentials !== null;
  
  return (
    <TradingContext.Provider
      value={{
        selectedExchange,
        setSelectedExchange,
        selectedMarket,
        setSelectedMarket,
        markets,
        setMarkets,
        tradingMode,
        setTradingMode,
        executionMode,
        setExecutionMode,
        optimizationMode,
        setOptimizationMode,
        optimizationSuggestions,
        addOptimizationSuggestion,
        updateOptimizationSuggestion,
        clearOptimizationSuggestions,
        liveMetrics,
        setLiveMetrics,
        timeframe,
        setTimeframe,
        riskParameters,
        setRiskParameters,
        ticker,
        setTicker,
        klines,
        setKlines,
        positions,
        setPositions,
        orders,
        setOrders,
        chatMessages,
        addChatMessage,
        clearChatMessages,
        activeAlgorithm,
        setActiveAlgorithm,
        tradeCycleState,
        setTradeCycleState,
        connectionState,
        setConnectionState,
        credentials,
        setCredentials,
        isAuthenticated,
        theme,
        toggleTheme,
      }}
    >
      {children}
    </TradingContext.Provider>
  );
}

export function useTradingContext() {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error("useTradingContext must be used within a TradingProvider");
  }
  return context;
}
