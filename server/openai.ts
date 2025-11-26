import OpenAI from "openai";
import pLimit from "p-limit";
import pRetry from "p-retry";
import type { TradingAlgorithm, TradingMode, Ticker, Kline, Position, TradingRule, RiskManagement } from "@shared/schema";
import { randomUUID } from "crypto";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access without requiring your own OpenAI API key.
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// Rate limiter for API calls
const limit = pLimit(2);

// Helper function to check if error is rate limit or quota violation
function isRateLimitError(error: any): boolean {
  const errorMsg = error?.message || String(error);
  return (
    errorMsg.includes("429") ||
    errorMsg.includes("RATELIMIT_EXCEEDED") ||
    errorMsg.toLowerCase().includes("quota") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

interface MarketContext {
  symbol?: string;
  ticker?: Ticker;
  klines?: Kline[];
  positions?: Position[];
  tradingMode?: TradingMode;
  currentAlgorithm?: TradingAlgorithm;
}

interface ChatResponse {
  message: string;
  algorithm?: TradingAlgorithm;
}

const SYSTEM_PROMPT = `You are an expert cryptocurrency trading AI assistant specializing in futures trading strategies. You analyze market data, generate trading algorithms, and provide market insights.

When the user asks you to generate a trading strategy or algorithm, you MUST respond with a JSON algorithm in your response. The algorithm should follow this exact structure:

{
  "id": "unique-uuid",
  "name": "Strategy Name",
  "version": 1,
  "createdAt": timestamp,
  "updatedAt": timestamp,
  "mode": "ai-trading" | "ai-scalping",
  "symbol": "BTCUSDT",
  "rules": [
    {
      "id": "rule-uuid",
      "condition": "Description of when this rule triggers",
      "action": "buy" | "sell" | "close" | "hold",
      "quantityPercent": 10,
      "priceType": "market" | "limit",
      "priority": 1
    }
  ],
  "riskManagement": {
    "maxPositionSize": 1000,
    "maxLeverage": 10,
    "stopLossPercent": 2,
    "takeProfitPercent": 4,
    "maxDailyLoss": 100,
    "trailingStop": false
  },
  "status": "active"
}

Important guidelines:
1. Always use isolated margin mode for safety
2. Keep leverage recommendations conservative (1-20x)
3. Always include stop-loss and take-profit in risk management
4. Explain your strategy reasoning before providing the JSON
5. Consider the current market conditions when generating strategies
6. For scalping strategies, use tighter stops and smaller position sizes
7. Analyze provided kline data for trend, support/resistance levels
8. If ticker data shows high volatility, recommend lower leverage

When analyzing market data:
- Look at price trends from kline data
- Calculate key levels (support, resistance)
- Assess volume patterns
- Consider the 24h change percentage from ticker
- Evaluate current positions for risk exposure

Always wrap your algorithm JSON in a code block with \`\`\`json and \`\`\` markers.`;

export async function analyzeAndRespond(
  userMessage: string,
  context: MarketContext
): Promise<ChatResponse> {
  const contextInfo = buildContextInfo(context);

  const response = await limit(() =>
    pRetry(
      async () => {
        const completion = await openai.chat.completions.create({
          model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `${contextInfo}\n\nUser request: ${userMessage}`,
            },
          ],
          max_completion_tokens: 4096,
        });
        return completion.choices[0]?.message?.content || "";
      },
      {
        retries: 5,
        minTimeout: 2000,
        maxTimeout: 64000,
        factor: 2,
        onFailedAttempt: (error) => {
          if (!isRateLimitError(error)) {
            throw new pRetry.AbortError(error);
          }
        },
      }
    )
  );

  // Parse the response to extract algorithm if present
  const algorithm = extractAlgorithmFromResponse(response, context);

  return {
    message: response,
    algorithm,
  };
}

function buildContextInfo(context: MarketContext): string {
  const parts: string[] = [];

  if (context.symbol) {
    parts.push(`Trading Symbol: ${context.symbol}`);
  }

  if (context.tradingMode) {
    parts.push(`Trading Mode: ${context.tradingMode}`);
  }

  if (context.ticker) {
    parts.push(`
Current Ticker Data:
- Last Price: ${context.ticker.lastPrice}
- 24h Change: ${context.ticker.priceChangePercent.toFixed(2)}%
- 24h High: ${context.ticker.high24h}
- 24h Low: ${context.ticker.low24h}
- 24h Volume: ${context.ticker.volume24h}`);
  }

  if (context.klines && context.klines.length > 0) {
    const recentKlines = context.klines.slice(-20);
    const highs = recentKlines.map((k) => k.high);
    const lows = recentKlines.map((k) => k.low);
    const closes = recentKlines.map((k) => k.close);
    
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
    const trend = closes[closes.length - 1] > closes[0] ? "upward" : "downward";

    parts.push(`
Recent Price Analysis (last ${recentKlines.length} candles):
- Trend: ${trend}
- Recent High: ${maxHigh}
- Recent Low: ${minLow}
- Average Close: ${avgClose.toFixed(4)}
- Current vs Average: ${((closes[closes.length - 1] / avgClose - 1) * 100).toFixed(2)}%`);
  }

  if (context.positions && context.positions.length > 0) {
    const totalPnl = context.positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    parts.push(`
Open Positions: ${context.positions.length}
Total Unrealized PnL: ${totalPnl.toFixed(2)}
${context.positions.map((p) => `- ${p.symbol} ${p.side.toUpperCase()} ${p.quantity} @ ${p.entryPrice} (PnL: ${p.unrealizedPnl.toFixed(2)})`).join("\n")}`);
  }

  if (context.currentAlgorithm) {
    parts.push(`
Current Algorithm: ${context.currentAlgorithm.name} v${context.currentAlgorithm.version}
- Rules: ${context.currentAlgorithm.rules.length}
- Status: ${context.currentAlgorithm.status}`);
  }

  return parts.length > 0 ? `Current Market Context:\n${parts.join("\n")}` : "";
}

function extractAlgorithmFromResponse(
  response: string,
  context: MarketContext
): TradingAlgorithm | undefined {
  // Look for JSON code block
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return undefined;

  try {
    const parsed = JSON.parse(jsonMatch[1]);

    // Validate and create a proper algorithm structure
    const algorithm: TradingAlgorithm = {
      id: parsed.id || randomUUID(),
      name: parsed.name || "AI Generated Strategy",
      version: parsed.version || 1,
      createdAt: parsed.createdAt || Date.now(),
      updatedAt: Date.now(),
      mode: parsed.mode || context.tradingMode || "ai-trading",
      symbol: parsed.symbol || context.symbol || "BTCUSDT",
      rules: (parsed.rules || []).map((rule: any, index: number) => ({
        id: rule.id || randomUUID(),
        condition: rule.condition || "",
        action: rule.action || "hold",
        quantity: rule.quantity,
        quantityPercent: rule.quantityPercent,
        priceType: rule.priceType || "market",
        limitOffset: rule.limitOffset,
        priority: rule.priority ?? index + 1,
      })) as TradingRule[],
      riskManagement: {
        maxPositionSize: parsed.riskManagement?.maxPositionSize || 1000,
        maxLeverage: parsed.riskManagement?.maxLeverage || 10,
        stopLossPercent: parsed.riskManagement?.stopLossPercent || 2,
        takeProfitPercent: parsed.riskManagement?.takeProfitPercent || 4,
        maxDailyLoss: parsed.riskManagement?.maxDailyLoss || 100,
        trailingStop: parsed.riskManagement?.trailingStop || false,
        trailingStopPercent: parsed.riskManagement?.trailingStopPercent,
      } as RiskManagement,
      status: "active",
    };

    return algorithm;
  } catch (error) {
    console.error("Failed to parse algorithm from response:", error);
    return undefined;
  }
}

export async function generateTradingSignals(
  ticker: Ticker,
  klines: Kline[]
): Promise<string> {
  const prompt = `Analyze the following market data and provide brief trading signals (1-2 sentences max):

Ticker:
- Price: ${ticker.lastPrice}
- 24h Change: ${ticker.priceChangePercent}%
- Volume: ${ticker.volume24h}

Recent candles (last 10):
${klines
  .slice(-10)
  .map((k) => `O:${k.open} H:${k.high} L:${k.low} C:${k.close}`)
  .join("\n")}

Provide a quick market sentiment (bullish/bearish/neutral) and key level to watch.`;

  const response = await limit(() =>
    pRetry(
      async () => {
        const completion = await openai.chat.completions.create({
          model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025
          messages: [
            {
              role: "system",
              content: "You are a concise crypto trading analyst. Give brief, actionable insights.",
            },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 256,
        });
        return completion.choices[0]?.message?.content || "";
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 16000,
        factor: 2,
        onFailedAttempt: (error) => {
          if (!isRateLimitError(error)) {
            throw new pRetry.AbortError(error);
          }
        },
      }
    )
  );

  return response;
}
