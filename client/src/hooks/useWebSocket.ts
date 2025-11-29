import { useEffect, useRef, useCallback, useState } from "react";
import { useTradingContext } from "@/lib/tradingContext";
import type { Ticker, Kline, TradeCycleState, Order, Position } from "@shared/schema";

export function useWebSocket() {
  const {
    selectedExchange,
    selectedMarket,
    timeframe,
    setTicker,
    setKlines,
    setTradeCycleState,
    orders,
    setOrders,
    positions,
    setPositions,
    setConnectionState,
  } = useTradingContext();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Keep refs to current orders/positions for WebSocket callback
  const ordersRef = useRef(orders);
  const positionsRef = useRef(positions);
  
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);
  
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        setConnectionState({
          status: "connected",
          exchange: selectedExchange || "coinstore",
          lastHeartbeat: Date.now(),
        });

        // Subscribe to market data if we have a selection
        if (selectedExchange && selectedMarket) {
          ws.send(
            JSON.stringify({
              type: "subscribe",
              exchange: selectedExchange,
              symbol: selectedMarket.symbol,
              timeframe: timeframe,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case "ticker":
              setTicker(message.data as Ticker);
              setConnectionState({
                status: "connected",
                exchange: selectedExchange || "coinstore",
                lastHeartbeat: Date.now(),
              });
              break;

            case "klines":
              setKlines(message.data as Kline[]);
              break;

            case "tradeCycle":
              setTradeCycleState(message.data as TradeCycleState);
              break;

            case "order": {
              const newOrder = message.data as Order;
              const currentOrders = ordersRef.current;
              const existingIndex = currentOrders.findIndex((o) => o.id === newOrder.id);
              if (existingIndex >= 0) {
                const updated = [...currentOrders];
                updated[existingIndex] = newOrder;
                setOrders(updated);
              } else {
                setOrders([...currentOrders, newOrder]);
              }
              break;
            }

            case "position": {
              const newPos = message.data as Position;
              const currentPositions = positionsRef.current;
              const existingIndex = currentPositions.findIndex((p) => p.id === newPos.id);
              if (existingIndex >= 0) {
                const updated = [...currentPositions];
                updated[existingIndex] = newPos;
                setPositions(updated);
              } else {
                setPositions([...currentPositions, newPos]);
              }
              break;
            }
          }
        } catch (error) {
          console.error("WebSocket message parse error:", error);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        setConnectionState({
          status: "disconnected",
          exchange: selectedExchange || "coinstore",
        });

        // Attempt reconnection after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setConnectionState({
          status: "error",
          exchange: selectedExchange || "coinstore",
          error: "Connection error",
        });
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("WebSocket connection failed:", error);
    }
  }, [selectedExchange, selectedMarket, timeframe, setTicker, setKlines, setTradeCycleState, setOrders, setPositions, setConnectionState]);

  const subscribe = useCallback(
    (symbol: string, timeframe: string = "15m") => {
      if (wsRef.current?.readyState === WebSocket.OPEN && selectedExchange) {
        wsRef.current.send(
          JSON.stringify({
            type: "subscribe",
            exchange: selectedExchange,
            symbol,
            timeframe,
          })
        );
      }
    },
    [selectedExchange]
  );

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []);

  // Re-subscribe when market or timeframe changes
  useEffect(() => {
    if (isConnected && selectedMarket && selectedExchange) {
      subscribe(selectedMarket.symbol, timeframe);
    }
  }, [isConnected, selectedMarket, selectedExchange, timeframe, subscribe]);

  return {
    isConnected,
    connect,
    disconnect,
    subscribe,
  };
}
