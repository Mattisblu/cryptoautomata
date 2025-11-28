import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { exchangeService, createTickerStream } from "./exchangeService";
import { analyzeAndRespond } from "./openai";
import { tradingBot } from "./tradingBot";
import { apiCredentialsSchema, manualOrderSchema } from "@shared/schema";
import type { Exchange, TradeCycleState } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // WebSocket server for real-time data
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();
  const tickerStreams = new Map<string, { stop: () => void }>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log("WebSocket client connected");

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === "subscribe" && data.symbol) {
          const streamKey = `${data.exchange}:${data.symbol}`;
          
          // Stop existing stream if any
          if (tickerStreams.has(streamKey)) {
            tickerStreams.get(streamKey)?.stop();
          }

          // Start new ticker stream with exchange-specific behavior
          const stream = createTickerStream(
            data.exchange as Exchange,
            data.symbol,
            (ticker) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "ticker", data: ticker }));
              }
            }
          );
          tickerStreams.set(streamKey, stream);

          // Send initial klines
          const klines = await exchangeService.getKlines(
            data.exchange as Exchange,
            data.symbol,
            data.timeframe || "15m",
            100
          );
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "klines", data: klines }));
          }
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log("WebSocket client disconnected");
    });
  });

  // Broadcast function for real-time updates
  function broadcast(type: string, data: any) {
    const message = JSON.stringify({ type, data });
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // ============ AUTH ROUTES ============
  
  app.post("/api/auth/connect", async (req, res) => {
    try {
      const credentials = apiCredentialsSchema.parse(req.body);
      
      // Validate credentials with exchange
      const isValid = await exchangeService.validateCredentials(credentials);
      
      if (!isValid) {
        return res.status(401).json({ 
          success: false, 
          error: "Invalid API credentials. Please check your keys." 
        });
      }

      // Save credentials
      await storage.saveCredentials(credentials);

      res.json({ success: true, message: "Connected successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: error.errors[0].message });
      }
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/auth/disconnect", async (req, res) => {
    try {
      const { exchange } = req.body;
      if (exchange) {
        await storage.clearCredentials(exchange as Exchange);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ MARKET DATA ROUTES ============

  app.get("/api/exchange-info", async (req, res) => {
    try {
      const exchange = req.query.exchange as Exchange;
      if (!exchange) {
        return res.status(400).json({ success: false, error: "Exchange required" });
      }

      const info = exchangeService.getExchangeInfo(exchange);
      res.json({ success: true, info });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/api/markets", async (req, res) => {
    try {
      const exchange = req.query.exchange as Exchange;
      if (!exchange) {
        return res.status(400).json({ success: false, error: "Exchange required" });
      }

      const markets = await exchangeService.getMarkets(exchange);
      await storage.setMarkets(exchange, markets);

      res.json({ success: true, exchange, markets });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/api/ticker", async (req, res) => {
    try {
      const exchange = req.query.exchange as Exchange;
      const symbol = req.query.symbol as string;

      if (!exchange || !symbol) {
        return res.status(400).json({ success: false, error: "Exchange and symbol required" });
      }

      const ticker = await exchangeService.getTicker(exchange, symbol);
      await storage.setTicker(exchange, symbol, ticker);

      res.json({ success: true, ticker });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/api/klines", async (req, res) => {
    try {
      const exchange = req.query.exchange as Exchange;
      const symbol = req.query.symbol as string;
      const timeframe = (req.query.timeframe as string) || "15m";
      const limit = parseInt(req.query.limit as string) || 100;

      if (!exchange || !symbol) {
        return res.status(400).json({ success: false, error: "Exchange and symbol required" });
      }

      const klines = await exchangeService.getKlines(exchange, symbol, timeframe, limit);
      await storage.setKlines(exchange, symbol, timeframe, klines);

      res.json({ success: true, klines });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ POSITIONS & ORDERS ROUTES ============

  app.get("/api/positions", async (req, res) => {
    try {
      const exchange = req.query.exchange as Exchange;
      if (!exchange) {
        return res.status(400).json({ success: false, error: "Exchange required" });
      }

      const positions = await storage.getPositions(exchange);
      res.json({ success: true, positions });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const exchange = req.query.exchange as Exchange;
      if (!exchange) {
        return res.status(400).json({ success: false, error: "Exchange required" });
      }

      const orders = await storage.getOrders(exchange);
      res.json({ success: true, orders });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/orders", async (req, res) => {
    try {
      const orderInput = manualOrderSchema.parse(req.body);
      const exchange = req.body.exchange as Exchange;

      if (!exchange) {
        return res.status(400).json({ success: false, error: "Exchange required" });
      }

      const credentials = await storage.getCredentials(exchange);
      if (!credentials) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }

      const order = await exchangeService.placeOrder(exchange, credentials, orderInput);
      await storage.addOrder(exchange, order);

      // Broadcast order update
      broadcast("order", order);

      res.json({ success: true, order });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: error.errors[0].message });
      }
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ AI CHAT ROUTES ============

  app.post("/api/chat", async (req, res) => {
    try {
      const { content, context } = req.body;

      if (!content) {
        return res.status(400).json({ success: false, error: "Message content required" });
      }

      // Save user message
      await storage.addChatMessage({
        role: "user",
        content,
      });

      // Get AI response
      const response = await analyzeAndRespond(content, context || {});

      // Save assistant message
      const assistantMessage = await storage.addChatMessage({
        role: "assistant",
        content: response.message,
        algorithmJson: response.algorithm,
      });

      // If algorithm was generated, save it
      if (response.algorithm) {
        await storage.saveAlgorithm(response.algorithm);
      }

      res.json({
        success: true,
        message: response.message,
        algorithm: response.algorithm,
      });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/api/chat/messages", async (req, res) => {
    try {
      const messages = await storage.getChatMessages();
      res.json({ success: true, messages });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.delete("/api/chat/messages", async (req, res) => {
    try {
      await storage.clearChatMessages();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ ALGORITHM ROUTES ============

  app.get("/api/algorithms", async (req, res) => {
    try {
      const algorithms = await storage.getAlgorithms();
      res.json({ success: true, algorithms });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/api/algorithms/:id", async (req, res) => {
    try {
      const algorithm = await storage.getAlgorithm(req.params.id);
      if (!algorithm) {
        return res.status(404).json({ success: false, error: "Algorithm not found" });
      }
      res.json({ success: true, algorithm });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.delete("/api/algorithms/:id", async (req, res) => {
    try {
      await storage.deleteAlgorithm(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ TRADING CYCLE ROUTES ============

  app.post("/api/trading/start", async (req, res) => {
    try {
      const { mode, executionMode, symbol, algorithmId, exchange } = req.body;

      if (!symbol) {
        return res.status(400).json({ success: false, error: "Symbol required" });
      }

      const exchangeName = (exchange || "coinstore") as Exchange;
      const execMode = (executionMode || "paper") as "paper" | "real";
      const credentials = await storage.getCredentials(exchangeName);
      
      if (!credentials) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }

      let algorithm = null;
      if (algorithmId) {
        algorithm = await storage.getAlgorithm(algorithmId);
      }

      // If no algorithm provided and in AI mode, require one
      if ((mode === "ai-trading" || mode === "ai-scalping") && !algorithm) {
        return res.status(400).json({ 
          success: false, 
          error: "Algorithm required for AI trading modes. Ask the AI to generate one first." 
        });
      }

      // Start trading bot if algorithm available
      if (algorithm) {
        await tradingBot.start({
          exchange: exchangeName,
          symbol,
          algorithm,
          executionMode: execMode,
          checkIntervalMs: mode === "ai-scalping" ? 2000 : 5000,
        });
      }

      const state: TradeCycleState = {
        status: "running",
        mode,
        executionMode: execMode,
        exchange: exchangeName,
        symbol,
        startedAt: Date.now(),
        algorithmId: algorithm?.id,
      };

      await storage.setTradeCycleState(state);
      broadcast("tradeCycle", state);

      res.json({ success: true, state });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/trading/pause", async (req, res) => {
    try {
      if (tradingBot.isRunning()) {
        await tradingBot.pause();
      }

      const currentState = await storage.getTradeCycleState();
      if (currentState) {
        const newState: TradeCycleState = {
          ...currentState,
          status: "paused",
        };
        await storage.setTradeCycleState(newState);
        broadcast("tradeCycle", newState);
        res.json({ success: true, state: newState });
      } else {
        res.status(400).json({ success: false, error: "No active trading session" });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/trading/resume", async (req, res) => {
    try {
      if (tradingBot.isPaused()) {
        await tradingBot.resume();
      }

      const currentState = await storage.getTradeCycleState();
      if (currentState) {
        const newState: TradeCycleState = {
          ...currentState,
          status: "running",
        };
        await storage.setTradeCycleState(newState);
        broadcast("tradeCycle", newState);
        res.json({ success: true, state: newState });
      } else {
        res.status(400).json({ success: false, error: "No active trading session" });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/trading/stop", async (req, res) => {
    try {
      if (tradingBot.isRunning()) {
        await tradingBot.stop();
      }

      const currentState = await storage.getTradeCycleState();
      const exchange = currentState?.exchange || "coinstore";

      const newState: TradeCycleState = {
        status: "idle",
        mode: currentState?.mode || "ai-trading",
        executionMode: currentState?.executionMode || "paper",
        exchange: exchange as Exchange,
        symbol: "",
      };

      await storage.setTradeCycleState(newState);
      broadcast("tradeCycle", newState);

      res.json({ success: true, state: newState });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/trading/close-all", async (req, res) => {
    try {
      await tradingBot.closeAllPositions();

      const currentState = await storage.getTradeCycleState();
      const exchange = currentState?.exchange || "coinstore";

      const newState: TradeCycleState = {
        status: "idle",
        mode: currentState?.mode || "ai-trading",
        executionMode: currentState?.executionMode || "paper",
        exchange: exchange as Exchange,
        symbol: "",
      };

      await storage.setTradeCycleState(newState);
      broadcast("tradeCycle", newState);

      res.json({ success: true, state: newState });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/api/trading/state", async (req, res) => {
    try {
      const state = await storage.getTradeCycleState();
      // Return complete default state if none exists
      const defaultState: TradeCycleState = {
        status: "idle",
        mode: "ai-trading",
        executionMode: "paper",
        exchange: "coinstore",
        symbol: "",
      };
      res.json({ success: true, state: state || defaultState });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ TRADE LOG ROUTES ============

  app.get("/api/logs", async (req, res) => {
    try {
      const logs = await storage.getTradeLog();
      res.json({ success: true, logs });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.delete("/api/logs", async (req, res) => {
    try {
      await storage.clearTradeLog();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  return httpServer;
}
