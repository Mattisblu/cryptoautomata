import type { 
  TradingAlgorithm, 
  OptimizationMode, 
  OptimizationSuggestion, 
  LiveStrategyMetrics,
  Ticker,
  Kline,
  Position,
  Exchange,
} from "@shared/schema";
import { analyzeAndRespond } from "./openai";
import { storage } from "./storage";
import { exchangeService } from "./exchangeService";

interface OptimizerConfig {
  exchange: Exchange;
  symbol: string;
  algorithm: TradingAlgorithm;
  optimizationMode: OptimizationMode;
  timeframe: string; // User-selected timeframe for analysis (1m, 5m, 15m, etc.)
  onSuggestion: (suggestion: Omit<OptimizationSuggestion, "id" | "timestamp">) => void;
  onMetricsUpdate: (metrics: LiveStrategyMetrics) => void;
  onAlgorithmUpdate?: (algorithm: TradingAlgorithm) => void;
}

class StrategyOptimizer {
  private config: OptimizerConfig | null = null;
  private metrics: LiveStrategyMetrics | null = null;
  private analysisInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  
  private readonly ANALYSIS_INTERVAL_MS = 60000; // 1 minute between analyses
  private readonly MIN_TRADES_FOR_ANALYSIS = 3;   // Need at least 3 trades before optimizing
  private readonly DRAWDOWN_THRESHOLD = 5;        // Alert if drawdown exceeds 5%
  private readonly WIN_RATE_THRESHOLD = 40;       // Alert if win rate drops below 40%

  async start(config: OptimizerConfig): Promise<void> {
    this.config = config;
    this.isRunning = true;
    
    // Initialize metrics
    this.metrics = {
      algorithmId: config.algorithm.id,
      sessionStarted: Date.now(),
      tradesExecuted: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnl: 0,
      maxDrawdown: 0,
      currentDrawdown: 0,
      peakPnl: 0,
      lastAnalysis: 0,
    };

    console.log(`[StrategyOptimizer] Started in ${config.optimizationMode} mode for ${config.symbol}`);
    
    // Start periodic analysis
    this.analysisInterval = setInterval(() => {
      this.runAnalysisCycle();
    }, this.ANALYSIS_INTERVAL_MS);

    // Run initial analysis after a short delay
    setTimeout(() => this.runAnalysisCycle(), 10000);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    console.log("[StrategyOptimizer] Stopped");
  }

  // Called by trading bot when a trade is executed
  recordTrade(pnl: number, isWin: boolean): void {
    if (!this.metrics) return;

    this.metrics.tradesExecuted++;
    this.metrics.totalPnl += pnl;
    
    if (isWin) {
      this.metrics.winningTrades++;
    } else {
      this.metrics.losingTrades++;
    }

    // Update peak and drawdown
    if (this.metrics.totalPnl > this.metrics.peakPnl) {
      this.metrics.peakPnl = this.metrics.totalPnl;
    }
    
    this.metrics.currentDrawdown = this.metrics.peakPnl - this.metrics.totalPnl;
    if (this.metrics.currentDrawdown > this.metrics.maxDrawdown) {
      this.metrics.maxDrawdown = this.metrics.currentDrawdown;
    }

    // Notify metrics update
    if (this.config) {
      this.config.onMetricsUpdate(this.metrics);
    }

    // Check if we need immediate analysis (significant drawdown or losing streak)
    if (this.shouldTriggerUrgentAnalysis()) {
      this.runAnalysisCycle();
    }
  }

  private shouldTriggerUrgentAnalysis(): boolean {
    if (!this.metrics) return false;

    const winRate = this.metrics.tradesExecuted > 0 
      ? (this.metrics.winningTrades / this.metrics.tradesExecuted) * 100 
      : 50;

    // Trigger if drawdown exceeds threshold
    if (this.metrics.currentDrawdown > this.DRAWDOWN_THRESHOLD) {
      return true;
    }

    // Trigger if win rate drops significantly after enough trades
    if (this.metrics.tradesExecuted >= this.MIN_TRADES_FOR_ANALYSIS && winRate < this.WIN_RATE_THRESHOLD) {
      return true;
    }

    return false;
  }

  private async runAnalysisCycle(): Promise<void> {
    if (!this.config || !this.metrics || !this.isRunning) return;
    
    // Skip if not enough trades
    if (this.metrics.tradesExecuted < this.MIN_TRADES_FOR_ANALYSIS) {
      console.log(`[StrategyOptimizer] Not enough trades (${this.metrics.tradesExecuted}/${this.MIN_TRADES_FOR_ANALYSIS}) for analysis`);
      return;
    }

    // Prevent too frequent analyses
    const timeSinceLastAnalysis = Date.now() - this.metrics.lastAnalysis;
    if (timeSinceLastAnalysis < this.ANALYSIS_INTERVAL_MS / 2) {
      return;
    }

    this.metrics.lastAnalysis = Date.now();

    try {
      const { exchange, symbol, algorithm, optimizationMode } = this.config;

      // Get current market data - getTicker/getKlines now return result types
      const tickerResult = await exchangeService.getTicker(exchange, symbol);
      const timeframe = this.config.timeframe || "15m";
      const klinesResult = await exchangeService.getKlines(exchange, symbol, timeframe, 50);
      const ticker = tickerResult.ticker;
      const klines = klinesResult.klines;
      const positions = await storage.getPositions(exchange);

      // Calculate performance metrics
      const winRate = this.metrics.tradesExecuted > 0 
        ? (this.metrics.winningTrades / this.metrics.tradesExecuted) * 100 
        : 0;

      // Detect market condition
      const marketCondition = this.detectMarketCondition(klines);
      this.metrics.marketCondition = marketCondition;

      // Build analysis prompt based on optimization mode
      const analysisPrompt = this.buildAnalysisPrompt(
        algorithm,
        this.metrics,
        marketCondition,
        optimizationMode
      );

      console.log(`[StrategyOptimizer] Running analysis... Win Rate: ${winRate.toFixed(1)}%, PnL: $${this.metrics.totalPnl.toFixed(2)}`);

      // Call AI for analysis
      const response = await analyzeAndRespond(analysisPrompt, {
        symbol,
        ticker,
        klines,
        positions,
        tradingMode: algorithm.mode,
        currentAlgorithm: algorithm,
        timeframe,
        riskParameters: algorithm.riskManagement,
        executionMode: "paper",
        marketMaxLeverage: 100,
      });

      // Process AI response
      if (response.algorithm) {
        this.handleOptimizationSuggestion(response.algorithm, response.message, optimizationMode);
      } else if (this.shouldGenerateSuggestion(response.message)) {
        // AI suggested changes but didn't provide full algorithm
        this.handleTextSuggestion(response.message, this.metrics);
      }

    } catch (error) {
      console.error("[StrategyOptimizer] Analysis error:", error);
    }
  }

  private detectMarketCondition(klines: Kline[]): "trending" | "ranging" | "volatile" | "quiet" {
    if (klines.length < 20) return "quiet";

    // Calculate volatility (ATR-like)
    let totalRange = 0;
    for (let i = 1; i < klines.length; i++) {
      totalRange += klines[i].high - klines[i].low;
    }
    const avgRange = totalRange / (klines.length - 1);
    const avgPrice = klines[klines.length - 1].close;
    const volatilityPercent = (avgRange / avgPrice) * 100;

    // Calculate trend strength
    const firstPrice = klines[0].close;
    const lastPrice = klines[klines.length - 1].close;
    const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;

    // Classify market condition
    if (volatilityPercent > 2) {
      return Math.abs(priceChange) > 3 ? "trending" : "volatile";
    } else if (Math.abs(priceChange) > 2) {
      return "trending";
    } else if (volatilityPercent < 0.5) {
      return "quiet";
    } else {
      return "ranging";
    }
  }

  private buildAnalysisPrompt(
    algorithm: TradingAlgorithm,
    metrics: LiveStrategyMetrics,
    marketCondition: string,
    optimizationMode: OptimizationMode
  ): string {
    const winRate = metrics.tradesExecuted > 0 
      ? (metrics.winningTrades / metrics.tradesExecuted) * 100 
      : 0;

    let modeInstruction = "";
    switch (optimizationMode) {
      case "manual":
        modeInstruction = "Suggest specific improvements but DO NOT generate a new algorithm unless explicitly asked. Focus on explaining what parameters should change and why.";
        break;
      case "semi-auto":
        modeInstruction = "You may generate an updated algorithm with adjusted parameters (entry thresholds, stop-loss levels, position sizing). Keep the core strategy logic intact.";
        break;
      case "full-auto":
        modeInstruction = "You may generate a completely new algorithm if the current strategy is not performing well in current market conditions.";
        break;
    }

    return `STRATEGY OPTIMIZATION ANALYSIS

Current Algorithm: "${algorithm.name}"
Mode: ${algorithm.mode}

LIVE PERFORMANCE METRICS:
- Trades Executed: ${metrics.tradesExecuted}
- Win Rate: ${winRate.toFixed(1)}%
- Total PnL: $${metrics.totalPnl.toFixed(2)}
- Current Drawdown: $${metrics.currentDrawdown.toFixed(2)}
- Max Drawdown: $${metrics.maxDrawdown.toFixed(2)}
- Session Duration: ${Math.round((Date.now() - metrics.sessionStarted) / 60000)} minutes

MARKET CONDITION: ${marketCondition.toUpperCase()}

CURRENT STRATEGY RULES:
${JSON.stringify(algorithm.rules, null, 2)}

RISK MANAGEMENT:
${JSON.stringify(algorithm.riskManagement, null, 2)}

OPTIMIZATION MODE: ${optimizationMode.toUpperCase()}
${modeInstruction}

Analyze the strategy performance against current market conditions. Consider:
1. Is the strategy suited for the current ${marketCondition} market?
2. Are the entry/exit conditions optimal?
3. Is the risk management appropriate given the performance?
4. What specific changes would improve performance?

${optimizationMode !== "manual" ? "If you recommend changes, provide an updated algorithm JSON." : "Provide specific recommendations for the user to review."}`;
  }

  private shouldGenerateSuggestion(message: string): boolean {
    const suggestionKeywords = [
      "suggest", "recommend", "adjust", "increase", "decrease",
      "tighten", "loosen", "modify", "change", "improve", "optimize"
    ];
    const lowerMessage = message.toLowerCase();
    return suggestionKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private handleOptimizationSuggestion(
    suggestedAlgorithm: TradingAlgorithm,
    reason: string,
    optimizationMode: OptimizationMode
  ): void {
    if (!this.config || !this.metrics) return;

    const winRate = this.metrics.tradesExecuted > 0 
      ? (this.metrics.winningTrades / this.metrics.tradesExecuted) * 100 
      : 0;

    // Determine suggestion type and whether to auto-apply
    // "manual" mode: all suggestions require user approval
    // "semi-auto" mode: parameter adjustments are auto-applied
    // "full-auto" mode: all changes are auto-applied
    const shouldAutoApply = optimizationMode === "full-auto" || optimizationMode === "semi-auto";
    
    const suggestion: Omit<OptimizationSuggestion, "id" | "timestamp"> = {
      type: optimizationMode === "semi-auto" ? "parameter" : "full",
      reason: reason.slice(0, 500), // Truncate for display
      suggestedAlgorithm,
      performanceContext: {
        winRate,
        totalPnl: this.metrics.totalPnl,
        recentTrades: this.metrics.tradesExecuted,
        drawdown: this.metrics.currentDrawdown,
      },
      status: shouldAutoApply ? "auto-applied" : "pending",
    };

    // Auto-apply for semi-auto and full-auto modes
    if (shouldAutoApply && this.config.onAlgorithmUpdate) {
      console.log(`[StrategyOptimizer] Auto-applying optimization in ${optimizationMode} mode`);
      this.config.onAlgorithmUpdate(suggestedAlgorithm);
    }

    // Notify about the suggestion
    this.config.onSuggestion(suggestion);
  }

  private handleTextSuggestion(message: string, metrics: LiveStrategyMetrics): void {
    if (!this.config) return;

    const winRate = metrics.tradesExecuted > 0 
      ? (metrics.winningTrades / metrics.tradesExecuted) * 100 
      : 0;

    const suggestion: Omit<OptimizationSuggestion, "id" | "timestamp"> = {
      type: "parameter",
      reason: message.slice(0, 500),
      performanceContext: {
        winRate,
        totalPnl: metrics.totalPnl,
        recentTrades: metrics.tradesExecuted,
        drawdown: metrics.currentDrawdown,
      },
      status: "pending",
    };

    this.config.onSuggestion(suggestion);
  }

  getMetrics(): LiveStrategyMetrics | null {
    return this.metrics;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const strategyOptimizer = new StrategyOptimizer();
