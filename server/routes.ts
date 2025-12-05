import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { exchangeService, createTickerStream } from "./exchangeService";
import { analyzeAndRespond } from "./openai";
import { tradingBot } from "./tradingBot";
import { strategyOrchestrator } from "./strategyOrchestrator";
import { notificationService } from "./notificationService";
import { apiCredentialsSchema, manualOrderSchema, riskParametersSchema, insertTradeSchema } from "@shared/schema";
import type { Exchange, TradeCycleState, StopOrder, RunningStrategyStatus } from "@shared/schema";
import { z } from "zod";

// Schema for trade update validation
const updateTradeSchema = z.object({
  exitPrice: z.number().optional(),
  pnl: z.number().optional(),
  pnlPercent: z.number().optional(),
  status: z.enum(["open", "closed", "liquidated"]).optional(),
  closedAt: z.string().datetime().transform(s => new Date(s)).optional(),
  closeReason: z.string().optional(),
});

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // WebSocket server for real-time data
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();
  const tickerStreams = new Map<string, { stop: () => void }>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    notificationService.registerClient(ws);
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
            (streamData) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                  type: "ticker", 
                  data: streamData.ticker,
                  dataSource: streamData.dataSource,
                  ...(streamData.dataError ? { dataError: streamData.dataError } : {})
                }));
              }
            }
          );
          tickerStreams.set(streamKey, stream);

          // Send initial klines - getKlines now returns KlinesResult with data source embedded
          const klinesResult = await exchangeService.getKlines(
            data.exchange as Exchange,
            data.symbol,
            data.timeframe || "15m",
            100
          );
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              type: "klines", 
              data: klinesResult.klines,
              dataSource: klinesResult.dataSource,
              ...(klinesResult.dataError ? { dataError: klinesResult.dataError } : {})
            }));
          }
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      notificationService.unregisterClient(ws);
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

      // getMarkets now returns MarketsResult with data source embedded
      const result = await exchangeService.getMarkets(exchange);
      await storage.setMarkets(exchange, result.markets);

      res.json({ 
        success: true, 
        exchange, 
        markets: result.markets, 
        dataSource: result.dataSource,
        ...(result.dataError ? { dataError: result.dataError } : {})
      });
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

      // getTicker now returns TickerResult with data source embedded
      const result = await exchangeService.getTicker(exchange, symbol);
      await storage.setTicker(exchange, symbol, result.ticker);

      res.json({ 
        success: true, 
        ticker: result.ticker, 
        dataSource: result.dataSource,
        ...(result.dataError ? { dataError: result.dataError } : {})
      });
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

      // getKlines now returns KlinesResult with data source embedded
      const result = await exchangeService.getKlines(exchange, symbol, timeframe, limit);
      await storage.setKlines(exchange, symbol, timeframe, result.klines);

      res.json({ 
        success: true, 
        klines: result.klines, 
        dataSource: result.dataSource,
        ...(result.dataError ? { dataError: result.dataError } : {})
      });
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

  // ============ ALGORITHM VERSIONS ROUTES ============

  // Get all versions of an algorithm
  app.get("/api/algorithms/:id/versions", async (req, res) => {
    try {
      const versions = await storage.getAlgorithmVersions(req.params.id);
      res.json({ success: true, versions });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Save a new version of an algorithm
  app.post("/api/algorithms/:id/versions", async (req, res) => {
    try {
      const algorithm = await storage.getAlgorithm(req.params.id);
      if (!algorithm) {
        return res.status(404).json({ success: false, error: "Algorithm not found" });
      }

      // Get the latest version number
      const latestVersion = await storage.getLatestAlgorithmVersion(req.params.id);
      const newVersionNumber = latestVersion ? latestVersion.version + 1 : 1;

      const versionData = {
        algorithmId: req.params.id,
        version: newVersionNumber,
        name: algorithm.name,
        mode: algorithm.mode,
        symbol: algorithm.symbol,
        rules: JSON.stringify(algorithm.rules),
        riskManagement: JSON.stringify(algorithm.riskManagement),
        changeNotes: req.body.changeNotes || null,
        parentVersionId: latestVersion?.id || null,
      };

      const newVersion = await storage.createAlgorithmVersion(versionData);

      // Update the algorithm's version number
      await storage.updateAlgorithm({
        ...algorithm,
        version: newVersionNumber,
        updatedAt: Date.now(),
      });

      res.json({ success: true, version: newVersion });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Get a specific version
  app.get("/api/algorithm-versions/:versionId", async (req, res) => {
    try {
      const version = await storage.getAlgorithmVersion(parseInt(req.params.versionId));
      if (!version) {
        return res.status(404).json({ success: false, error: "Version not found" });
      }
      res.json({ success: true, version });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Restore a specific version (make it the current algorithm)
  app.post("/api/algorithm-versions/:versionId/restore", async (req, res) => {
    try {
      const version = await storage.getAlgorithmVersion(parseInt(req.params.versionId));
      if (!version) {
        return res.status(404).json({ success: false, error: "Version not found" });
      }

      const algorithm = await storage.getAlgorithm(version.algorithmId);
      if (!algorithm) {
        return res.status(404).json({ success: false, error: "Algorithm not found" });
      }

      // Restore the algorithm to this version
      const restoredAlgorithm = {
        ...algorithm,
        name: version.name,
        mode: version.mode as "ai-trading" | "ai-scalping" | "manual",
        symbol: version.symbol,
        rules: JSON.parse(version.rules),
        riskManagement: JSON.parse(version.riskManagement),
        version: version.version,
        updatedAt: Date.now(),
      };

      await storage.updateAlgorithm(restoredAlgorithm);
      res.json({ success: true, algorithm: restoredAlgorithm });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ A/B TESTS ROUTES ============

  // Get all A/B tests
  app.get("/api/ab-tests", async (req, res) => {
    try {
      const tests = await storage.getAbTests();
      res.json({ success: true, tests });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Get a specific A/B test
  app.get("/api/ab-tests/:id", async (req, res) => {
    try {
      const test = await storage.getAbTest(parseInt(req.params.id));
      if (!test) {
        return res.status(404).json({ success: false, error: "A/B test not found" });
      }
      res.json({ success: true, test });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Create a new A/B test
  app.post("/api/ab-tests", async (req, res) => {
    try {
      const { name, description, algorithmAId, algorithmBId, exchange, symbol } = req.body;

      if (!name || !algorithmAId || !algorithmBId || !exchange || !symbol) {
        return res.status(400).json({ 
          success: false, 
          error: "Name, both algorithm IDs, exchange, and symbol are required" 
        });
      }

      const algorithmA = await storage.getAlgorithm(algorithmAId);
      const algorithmB = await storage.getAlgorithm(algorithmBId);

      if (!algorithmA || !algorithmB) {
        return res.status(404).json({ 
          success: false, 
          error: "One or both algorithms not found" 
        });
      }

      const testData = {
        name,
        description: description || null,
        algorithmAId,
        algorithmAName: algorithmA.name,
        algorithmAVersion: algorithmA.version,
        algorithmBId,
        algorithmBName: algorithmB.name,
        algorithmBVersion: algorithmB.version,
        exchange,
        symbol,
        status: "pending",
      };

      const newTest = await storage.createAbTest(testData);
      res.json({ success: true, test: newTest });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Start an A/B test
  app.post("/api/ab-tests/:id/start", async (req, res) => {
    try {
      const test = await storage.getAbTest(parseInt(req.params.id));
      if (!test) {
        return res.status(404).json({ success: false, error: "A/B test not found" });
      }

      if (test.status !== "pending") {
        return res.status(400).json({ 
          success: false, 
          error: "A/B test is not in pending status" 
        });
      }

      const updatedTest = await storage.updateAbTest(test.id, {
        status: "running",
        startedAt: new Date(),
      });

      res.json({ success: true, test: updatedTest });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Complete/stop an A/B test
  app.post("/api/ab-tests/:id/complete", async (req, res) => {
    try {
      const test = await storage.getAbTest(parseInt(req.params.id));
      if (!test) {
        return res.status(404).json({ success: false, error: "A/B test not found" });
      }

      // Determine winner based on PnL
      let winnerId = null;
      if (test.pnlA > test.pnlB) {
        winnerId = test.algorithmAId;
      } else if (test.pnlB > test.pnlA) {
        winnerId = test.algorithmBId;
      }

      const updatedTest = await storage.updateAbTest(test.id, {
        status: "completed",
        endedAt: new Date(),
        winnerId,
      });

      res.json({ success: true, test: updatedTest });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Update A/B test results (used by trading bot to record trades)
  app.patch("/api/ab-tests/:id/results", async (req, res) => {
    try {
      const { algorithmId, pnl, won } = req.body;
      const test = await storage.getAbTest(parseInt(req.params.id));
      
      if (!test) {
        return res.status(404).json({ success: false, error: "A/B test not found" });
      }

      const updates: Partial<typeof test> = {};
      
      if (algorithmId === test.algorithmAId) {
        updates.tradesA = (test.tradesA || 0) + 1;
        updates.pnlA = (test.pnlA || 0) + pnl;
        if (updates.tradesA > 0) {
          const winningA = won ? 1 : 0;
          updates.winRateA = ((test.winRateA || 0) * (test.tradesA || 0) + winningA * 100) / updates.tradesA;
        }
      } else if (algorithmId === test.algorithmBId) {
        updates.tradesB = (test.tradesB || 0) + 1;
        updates.pnlB = (test.pnlB || 0) + pnl;
        if (updates.tradesB > 0) {
          const winningB = won ? 1 : 0;
          updates.winRateB = ((test.winRateB || 0) * (test.tradesB || 0) + winningB * 100) / updates.tradesB;
        }
      }

      const updatedTest = await storage.updateAbTest(test.id, updates);
      res.json({ success: true, test: updatedTest });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Delete an A/B test
  app.delete("/api/ab-tests/:id", async (req, res) => {
    try {
      await storage.deleteAbTest(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ NOTIFICATIONS ROUTES ============

  // Get all notifications
  app.get("/api/notifications", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const notifications = await storage.getNotifications(limit);
      res.json({ success: true, notifications });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Get unread notifications count
  app.get("/api/notifications/unread", async (req, res) => {
    try {
      const notifications = await storage.getUnreadNotifications();
      res.json({ success: true, notifications, count: notifications.length });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Mark a notification as read
  app.patch("/api/notifications/:id/read", async (req, res) => {
    try {
      await storage.markNotificationRead(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/mark-all-read", async (req, res) => {
    try {
      await storage.markAllNotificationsRead();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Delete a notification
  app.delete("/api/notifications/:id", async (req, res) => {
    try {
      await storage.deleteNotification(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Clear all notifications
  app.delete("/api/notifications", async (req, res) => {
    try {
      await storage.clearNotifications();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Get notification settings
  app.get("/api/notifications/settings", async (req, res) => {
    try {
      const settings = await storage.getNotificationSettings();
      res.json({ success: true, settings });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Update notification settings
  app.put("/api/notifications/settings", async (req, res) => {
    try {
      const settings = await storage.saveNotificationSettings(req.body);
      notificationService.invalidateSettings();
      res.json({ success: true, settings });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ TRADING CYCLE ROUTES ============

  app.post("/api/trading/start", async (req, res) => {
    try {
      const { mode, executionMode, optimizationMode, symbol, algorithmId, exchange } = req.body;

      if (!symbol) {
        return res.status(400).json({ success: false, error: "Symbol required" });
      }

      const exchangeName = (exchange || "coinstore") as Exchange;
      const execMode = (executionMode || "paper") as "paper" | "real";
      const optMode = (optimizationMode || "manual") as "manual" | "semi-auto" | "full-auto";
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

      // Generate a sessionId for tracking this trading session
      const sessionId = randomUUID();

      // Start trading bot if algorithm available
      if (algorithm) {
        await tradingBot.start({
          exchange: exchangeName,
          symbol,
          algorithm,
          executionMode: execMode,
          optimizationMode: optMode,
          checkIntervalMs: mode === "ai-scalping" ? 2000 : 5000,
          onOptimizationSuggestion: (suggestion) => {
            broadcast("optimizationSuggestion", { ...suggestion, sessionId });
          },
          onMetricsUpdate: (metrics) => {
            broadcast("liveMetrics", { ...metrics, sessionId });
          },
          onAlgorithmUpdate: (algo) => {
            broadcast("algorithmUpdate", { algorithm: algo, sessionId });
          },
        });

        // Register this strategy in the running strategies table so it shows on the Strategies page
        await storage.createRunningStrategy({
          sessionId,
          algorithmId: algorithm.id,
          algorithmName: algorithm.name,
          algorithmVersion: algorithm.version,
          exchange: exchangeName,
          symbol,
          executionMode: execMode,
          optimizationMode: optMode,
          status: "running",
          totalTrades: 0,
          successfulTrades: 0,
          totalPnl: 0,
        });

        // Broadcast that a strategy started
        const strategy = await storage.getRunningStrategy(sessionId);
        broadcast("strategyStarted", strategy);
      }

      const state: TradeCycleState = {
        status: "running",
        mode,
        executionMode: execMode,
        optimizationMode: optMode,
        exchange: exchangeName,
        symbol,
        startedAt: Date.now(),
        algorithmId: algorithm?.id,
        sessionId, // Include sessionId in state for tracking
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

        // Also update the running strategy status in database
        if (currentState.sessionId) {
          await storage.updateRunningStrategy(currentState.sessionId, { status: "paused" });
          const strategy = await storage.getRunningStrategy(currentState.sessionId);
          broadcast("strategyUpdated", strategy);
        }

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

        // Also update the running strategy status in database
        if (currentState.sessionId) {
          await storage.updateRunningStrategy(currentState.sessionId, { status: "running" });
          const strategy = await storage.getRunningStrategy(currentState.sessionId);
          broadcast("strategyUpdated", strategy);
        }

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

      // Stop the running strategy in database
      if (currentState?.sessionId) {
        await storage.stopRunningStrategy(currentState.sessionId);
        broadcast("strategyStopped", { sessionId: currentState.sessionId });
      }

      const newState: TradeCycleState = {
        status: "idle",
        mode: currentState?.mode || "ai-trading",
        executionMode: currentState?.executionMode || "paper",
        optimizationMode: currentState?.optimizationMode || "manual",
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

      // Stop the running strategy in database
      if (currentState?.sessionId) {
        await storage.stopRunningStrategy(currentState.sessionId);
        broadcast("strategyStopped", { sessionId: currentState.sessionId });
      }

      const newState: TradeCycleState = {
        status: "idle",
        mode: currentState?.mode || "ai-trading",
        executionMode: currentState?.executionMode || "paper",
        optimizationMode: currentState?.optimizationMode || "manual",
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
        optimizationMode: "manual",
        exchange: "coinstore",
        symbol: "",
      };
      res.json({ success: true, state: state || defaultState });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ RUNNING STRATEGIES ROUTES ============

  app.get("/api/running-strategies", async (req, res) => {
    try {
      const exchange = req.query.exchange as string | undefined;
      const status = req.query.status as RunningStrategyStatus | undefined;
      
      const strategies = await storage.getRunningStrategies({ exchange, status });
      res.json({ success: true, strategies });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/api/running-strategies/:sessionId", async (req, res) => {
    try {
      const strategy = await storage.getRunningStrategy(req.params.sessionId);
      if (!strategy) {
        return res.status(404).json({ success: false, error: "Strategy session not found" });
      }
      res.json({ success: true, strategy });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/strategies/:algorithmId/start", async (req, res) => {
    try {
      const { algorithmId } = req.params;
      const { exchange, symbol, executionMode, optimizationMode } = req.body;

      if (!exchange || !symbol) {
        return res.status(400).json({ success: false, error: "Exchange and symbol are required" });
      }

      const algorithm = await storage.getAlgorithm(algorithmId);
      if (!algorithm) {
        return res.status(404).json({ success: false, error: "Algorithm not found" });
      }

      const credentials = await storage.getCredentials(exchange as Exchange);
      if (!credentials) {
        return res.status(401).json({ success: false, error: "Not authenticated to exchange" });
      }

      const sessionId = await strategyOrchestrator.startStrategy({
        exchange: exchange as Exchange,
        symbol,
        algorithm,
        executionMode: executionMode || "paper",
        optimizationMode: optimizationMode || "manual",
        onOptimizationSuggestion: (suggestion) => {
          broadcast("optimizationSuggestion", { ...suggestion, sessionId });
        },
        onMetricsUpdate: (metrics) => {
          broadcast("liveMetrics", { ...metrics, sessionId });
        },
        onAlgorithmUpdate: (algo) => {
          broadcast("algorithmUpdate", { algorithm: algo, sessionId });
        },
      });

      const strategy = await storage.getRunningStrategy(sessionId);
      broadcast("strategyStarted", strategy);

      res.json({ success: true, sessionId, strategy });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/running-strategies/:sessionId/pause", async (req, res) => {
    try {
      await strategyOrchestrator.pauseStrategy(req.params.sessionId);
      const strategy = await storage.getRunningStrategy(req.params.sessionId);
      broadcast("strategyUpdated", strategy);
      res.json({ success: true, strategy });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/running-strategies/:sessionId/resume", async (req, res) => {
    try {
      await strategyOrchestrator.resumeStrategy(req.params.sessionId);
      const strategy = await storage.getRunningStrategy(req.params.sessionId);
      broadcast("strategyUpdated", strategy);
      res.json({ success: true, strategy });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/running-strategies/:sessionId/stop", async (req, res) => {
    try {
      await strategyOrchestrator.stopStrategy(req.params.sessionId);
      broadcast("strategyStopped", { sessionId: req.params.sessionId });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/running-strategies/:sessionId/close-all", async (req, res) => {
    try {
      await strategyOrchestrator.closeAllPositionsAndStop(req.params.sessionId);
      broadcast("strategyStopped", { sessionId: req.params.sessionId });
      res.json({ success: true });
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

  // ============ RISK PARAMETERS ROUTES ============

  app.get("/api/risk-parameters", async (req, res) => {
    try {
      const params = await storage.getRiskParameters();
      // Return default parameters if none set
      const defaultParams = {
        maxPositionSize: 1000,
        maxLeverage: 10,
        stopLossPercent: 2,
        takeProfitPercent: 4,
        maxDailyLoss: 1000,
        trailingStop: false,
        trailingStopPercent: undefined,
        autoStopLoss: true,
        autoTakeProfit: true,
        breakEvenTrigger: undefined,
      };
      res.json({ success: true, params: params || defaultParams });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/risk-parameters", async (req, res) => {
    try {
      const validatedParams = riskParametersSchema.parse(req.body);
      await storage.setRiskParameters(validatedParams);
      res.json({ success: true, params: validatedParams });
    } catch (error) {
      res.status(400).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ STOP ORDERS ROUTES ============

  app.get("/api/stop-orders", async (req, res) => {
    try {
      const exchange = (req.query.exchange as Exchange) || "coinstore";
      const positionId = req.query.positionId as string | undefined;

      let stopOrders: StopOrder[];
      if (positionId) {
        stopOrders = await storage.getStopOrdersByPosition(exchange, positionId);
      } else {
        stopOrders = await storage.getStopOrders(exchange);
      }

      res.json({ success: true, stopOrders });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.delete("/api/stop-orders/:id", async (req, res) => {
    try {
      const exchange = (req.query.exchange as Exchange) || "coinstore";
      await storage.deleteStopOrder(exchange, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // ============ TRADE HISTORY & ANALYTICS ROUTES ============

  // Get trade history with optional filters
  app.get("/api/trades", async (req, res) => {
    try {
      const options = {
        exchange: req.query.exchange as string | undefined,
        symbol: req.query.symbol as string | undefined,
        status: req.query.status as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      };

      const trades = await storage.getTrades(options);
      res.json({ success: true, trades });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Get a single trade by ID
  app.get("/api/trades/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const trade = await storage.getTrade(id);
      
      if (!trade) {
        return res.status(404).json({ success: false, error: "Trade not found" });
      }

      res.json({ success: true, trade });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Create a new trade (usually called by trading bot)
  app.post("/api/trades", async (req, res) => {
    try {
      const tradeData = insertTradeSchema.parse(req.body);
      const trade = await storage.createTrade(tradeData);
      res.json({ success: true, trade });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: error.errors[0].message });
      }
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Update a trade (e.g., when closing)
  app.patch("/api/trades/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, error: "Invalid trade ID" });
      }
      
      const updates = updateTradeSchema.parse(req.body);
      const trade = await storage.updateTrade(id, updates);
      
      if (!trade) {
        return res.status(404).json({ success: false, error: "Trade not found" });
      }

      res.json({ success: true, trade });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: error.errors[0].message });
      }
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Get trade analytics/statistics
  app.get("/api/analytics", async (req, res) => {
    try {
      const exchange = req.query.exchange as string | undefined;
      const analytics = await storage.getTradeAnalytics(exchange);
      res.json({ success: true, analytics });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Get daily summaries for PnL chart
  app.get("/api/analytics/daily", async (req, res) => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 30;
      const summaries = await storage.getDailySummaries(days);
      res.json({ success: true, summaries });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // Get algorithm performance metrics
  app.get("/api/analytics/algorithms", async (req, res) => {
    try {
      const algorithmId = req.query.algorithmId as string | undefined;
      const performance = await storage.getAlgorithmPerformance(algorithmId);
      res.json({ success: true, performance });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  return httpServer;
}
