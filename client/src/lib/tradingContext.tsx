import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type {
  Exchange,
  Market,
  TradingMode,
  ExecutionMode,
  Ticker,
  Kline,
  Position,
  Order,
  TradingAlgorithm,
  ChatMessage,
  TradeCycleState,
  ConnectionState,
  ApiCredentials,
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
