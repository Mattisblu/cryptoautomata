import OpenAI from "openai";
import pLimit from "p-limit";
import pRetry, { AbortError } from "p-retry";
import type { TradingAlgorithm, TradingMode, ExecutionMode, Ticker, Kline, Position, TradingRule, RiskManagement, RiskParameters } from "@shared/schema";
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
  timeframe?: string;
  riskParameters?: RiskParameters;
  executionMode?: ExecutionMode;
  marketMaxLeverage?: number;
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
      "condition": "MUST use one of the recognized condition formats below",
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
    "trailingStop": false,
    "trailingStopPercent": 1.5,
    "tradeCooldownSeconds": null,
    "maxTradesPerHour": null,
    "minHoldTimeSeconds": null,
    "maxConcurrentPositions": null
  },
  "status": "active"
}

CRITICAL: Rule conditions MUST use ONLY these recognized formats (the trading bot only understands these exact keywords):

**Trend Conditions (for buy/sell actions):**
- "uptrend" or "upward trend" or "bullish trend" or "trending up" - triggers when price > prev close AND green candle
- "downtrend" or "downward trend" or "bearish trend" or "trending down" - triggers when price < prev close AND red candle
- "price rising" or "price going up" - same as uptrend
- "price falling" or "price going down" - same as downtrend

**Candle Conditions:**
- "green candle" or "bullish candle" - last candle close > open
- "red candle" or "bearish candle" - last candle close < open

**Price vs Previous Close:**
- "above previous close" or "price above prev" - current price > previous candle close
- "below previous close" or "price below prev" - current price < previous candle close

**Price Change Conditions:**
- "positive change" or "price is up" - 24h price change > 0
- "negative change" or "price is down" - 24h price change < 0

**SMA Conditions:**
- "price above sma" - price above 20-period SMA
- "price below sma" - price below 20-period SMA
- "sma crossover" or "bullish crossover" - SMA20 > SMA50
- "bearish crossover" - SMA20 < SMA50

**MACD Conditions:**
- "macd bullish" or "macd positive" - MACD trend is bullish
- "macd bearish" or "macd negative" - MACD trend is bearish
- "macd bullish crossover" or "macd cross above" - bullish MACD crossover
- "macd bearish crossover" or "macd cross below" - bearish MACD crossover
- "macd above signal" - MACD line above signal line
- "macd below signal" - MACD line below signal line

**Volume Conditions:**
- "volume spike" or "high volume spike" - volume > 2x average
- "high volume" or "above average volume" - volume > 1.5x average
- "low volume" - volume below average
- "volume increasing" or "rising volume" - volume trend increasing

**Combined Conditions:**
- "macd bullish with volume" - MACD bullish AND high volume
- "macd bearish with volume" - MACD bearish AND high volume
- "bullish breakout" - MACD bullish + volume spike + price above SMA
- "bearish breakdown" - MACD bearish + volume spike + price below SMA

**Numeric Price Conditions:**
- "price > X" or "price >= X" - triggers when current price is above X
- "price < X" or "price <= X" - triggers when current price is below X
- "price == X" - triggers when price equals X (with tolerance)

**Take Profit / Stop Loss (for close actions when has position):**
- "take profit X%" or "take-profit X%" - close when profit >= X%
- "stop loss X%" or "stop-loss X%" - close when loss >= X%
- "price increases X%" - for take profit on long
- "price decreases X%" - for stop loss on long

**Position Conditions:**
- "no position" - only trigger when no open position
- "has position" - only trigger when position exists

**Immediate Entry:**
- "immediate" or "enter now" or "market entry" - enter immediately if no position

**COMPOUND CONDITIONS (Advanced Logic):**
You can combine multiple conditions using logical operators. Use parentheses for grouping.

- **AND** - Both conditions must be true: "macd bullish AND volume spike"
- **OR** - Either condition must be true: "uptrend OR macd bullish crossover"
- **NOT** - Inverts the condition: "NOT downtrend" (true when not in downtrend)
- **XOR** - Exactly one condition must be true: "macd bullish XOR high volume"
- **Parentheses** - Group conditions: "(macd bullish AND volume spike) OR bullish breakout"
- **IF-THEN** - Conditional logic: "IF macd bullish THEN volume spike" (if first is true, second must also be true)

Compound condition examples:
- "macd bullish AND price above sma" - Both must be true
- "volume spike OR macd bullish crossover" - Either triggers action
- "(uptrend AND high volume) OR bullish breakout" - Nested logic
- "NOT overbought AND macd bullish" - Not overbought AND bullish
- "macd bullish XOR volume spike" - One but not both
- "IF has position THEN take profit 3%" - Conditional close

Nesting rules:
- Maximum 3 levels of parentheses supported
- Operators are evaluated left to right, parentheses first
- NOT applies to the immediately following condition or group

DO NOT use any other condition formats - they will not be recognized by the trading bot!

Example valid rules:
- {"condition": "uptrend", "action": "buy", "priority": 1}
- {"condition": "downtrend", "action": "sell", "priority": 2}
- {"condition": "macd bullish crossover", "action": "buy", "priority": 1}
- {"condition": "take profit 3%", "action": "close", "priority": 1}
- {"condition": "stop loss 2%", "action": "close", "priority": 2}
- {"condition": "price > 50000", "action": "buy", "priority": 1}
- {"condition": "macd bullish AND volume spike", "action": "buy", "priority": 1}
- {"condition": "(uptrend AND high volume) OR bullish breakout", "action": "buy", "priority": 1}
- {"condition": "NOT downtrend AND macd bullish", "action": "buy", "priority": 1}

Important guidelines:
1. Always use isolated margin mode for safety
2. Keep leverage recommendations conservative (1-20x)
3. Always include stop-loss and take-profit in risk management
4. Explain your strategy reasoning before providing the JSON
5. Consider the current market conditions when generating strategies
6. For scalping strategies, use tighter stops and smaller position sizes
7. Analyze provided kline data for trend, support/resistance levels
8. If ticker data shows high volatility, recommend lower leverage
9. CRITICAL: When "User Risk Settings" are provided in the context, you MUST use those values in your algorithm's riskManagement section:
   - Use the user's maxPositionSize, maxLeverage, stopLossPercent, takeProfitPercent, and maxDailyLoss
   - Include trailingStop and trailingStopPercent if the user has them enabled
   - Add frequency controls if provided: tradeCooldownSeconds, maxTradesPerHour, minHoldTimeSeconds, maxConcurrentPositions
   - These user settings are their preferred risk parameters - always respect them

When analyzing market data:
- Look at price trends from kline data
- Calculate key levels (support, resistance)
- Assess volume patterns
- Consider the 24h change percentage from ticker
- Evaluate current positions for risk exposure

When estimating trade cycle times or target hit probability:
- Use the provided chart timeframe to understand candle duration (1m, 5m, 15m, 1h, etc.)
- Use the "Average Move per Candle" metric to estimate time to reach targets
- Calculate expected time: distance_to_target / avg_move_per_candle * candle_duration
- Consider current volatility and 24h range when making time estimates
- Factor in the user's SL/TP settings when calculating expected trade duration
- For breakout strategies, estimate time differently than mean-reversion strategies

Always wrap your algorithm JSON in a code block with \`\`\`json and \`\`\` markers.`;

export async function analyzeAndRespond(
  userMessage: string,
  context: MarketContext
): Promise<ChatResponse> {
  const contextInfo = buildContextInfo(context);

  const FALLBACK_MESSAGE = "I apologize, but I'm having trouble analyzing the market right now. Please try again in a moment. You can also check the chart timeframe and current price action for immediate insights.";
  
  let response: string = FALLBACK_MESSAGE;
  
  try {
    const result = await limit(() =>
      pRetry(
        async () => {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o", // Using gpt-4o for more reliable responses
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `${contextInfo}\n\nUser request: ${userMessage}`,
              },
            ],
            max_completion_tokens: 4096,
          });
          const content = completion.choices[0]?.message?.content;
          
          // Validate non-empty response - retry if empty
          if (!content || content.trim().length === 0) {
            console.warn("OpenAI returned empty response, retrying...");
            throw new Error("Empty response from AI");
          }
          
          return content;
        },
        {
          retries: 3,
          minTimeout: 1000,
          maxTimeout: 30000,
          factor: 2,
          onFailedAttempt: (attemptInfo) => {
            const errorMessage = attemptInfo.error?.message || String(attemptInfo.error);
            console.warn(`AI attempt failed: ${errorMessage}`);
            // Only abort for non-retryable errors (not rate limits or empty responses)
            if (!isRateLimitError(attemptInfo.error) && !errorMessage.includes("Empty response")) {
              throw new AbortError(attemptInfo.error?.message || "Unknown error");
            }
          },
        }
      )
    );
    
    // Only use result if it's a non-empty string
    if (result && typeof result === 'string' && result.trim().length > 0) {
      response = result;
    }
  } catch (error) {
    console.error("AI analysis failed after retries:", error);
    // response already defaults to FALLBACK_MESSAGE
  }

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

  if (context.executionMode) {
    parts.push(`Execution Mode: ${context.executionMode === "paper" ? "Paper Trading (Simulated)" : "Real Trading"}`);
  }

  if (context.timeframe) {
    parts.push(`Chart Timeframe: ${context.timeframe}`);
  }

  if (context.marketMaxLeverage) {
    parts.push(`Market Max Leverage: ${context.marketMaxLeverage}x`);
  }

  if (context.riskParameters) {
    const rp = context.riskParameters;
    parts.push(`
User Risk Settings:
- Max Position Size: $${rp.maxPositionSize}
- Max Leverage: ${rp.maxLeverage}x
- Stop-Loss: ${rp.autoStopLoss ? `${rp.stopLossPercent}% (enabled)` : "disabled"}
- Take-Profit: ${rp.autoTakeProfit ? `${rp.takeProfitPercent}% (enabled)` : "disabled"}
- Trailing Stop: ${rp.trailingStop ? `${rp.trailingStopPercent}% (enabled)` : "disabled"}
- Max Daily Loss: $${rp.maxDailyLoss}`);
    
    // Add frequency controls if any are enabled
    const frequencyControls: string[] = [];
    if (rp.tradeCooldownSeconds) frequencyControls.push(`Trade Cooldown: ${rp.tradeCooldownSeconds}s`);
    if (rp.maxTradesPerHour) frequencyControls.push(`Max Trades/Hour: ${rp.maxTradesPerHour}`);
    if (rp.minHoldTimeSeconds) frequencyControls.push(`Min Hold Time: ${rp.minHoldTimeSeconds}s`);
    if (rp.maxConcurrentPositions) frequencyControls.push(`Max Concurrent Positions: ${rp.maxConcurrentPositions}`);
    if (frequencyControls.length > 0) {
      parts.push(`\nFrequency Controls:\n- ${frequencyControls.join('\n- ')}`);
    }
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

  if (context.klines && context.klines.length > 1) {
    const recentKlines = context.klines.slice(-20);
    const highs = recentKlines.map((k) => k.high);
    const lows = recentKlines.map((k) => k.low);
    const closes = recentKlines.map((k) => k.close);
    
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
    const trend = closes[closes.length - 1] > closes[0] ? "upward" : "downward";
    
    // Calculate volatility (requires at least 2 data points)
    let avgMovePercent = 0;
    if (closes.length >= 2) {
      const priceChanges = closes.slice(1).map((c, i) => Math.abs((c - closes[i]) / closes[i]) * 100);
      avgMovePercent = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
    }

    parts.push(`
Recent Price Analysis (last ${recentKlines.length} candles on ${context.timeframe || "unknown"} timeframe):
- Trend: ${trend}
- Recent High: ${maxHigh}
- Recent Low: ${minLow}
- Average Close: ${avgClose.toFixed(4)}
- Current vs Average: ${((closes[closes.length - 1] / avgClose - 1) * 100).toFixed(2)}%
- Average Move per Candle: ${avgMovePercent.toFixed(3)}%`);
  }

  if (context.positions && context.positions.length > 0) {
    const totalPnl = context.positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    parts.push(`
Open Positions: ${context.positions.length}
Total Unrealized PnL: ${totalPnl.toFixed(2)}
${context.positions.map((p) => `- ${p.symbol} ${p.side.toUpperCase()} ${p.quantity} @ ${p.entryPrice} (PnL: ${p.unrealizedPnl.toFixed(2)})`).join("\n")}`);
  }

  if (context.currentAlgorithm) {
    const algo = context.currentAlgorithm;
    const rm = algo.riskManagement;
    parts.push(`
Current Algorithm: ${algo.name} v${algo.version}
- Rules: ${algo.rules?.length || 0}
- Status: ${algo.status || 'active'}
- Algorithm SL: ${rm?.stopLossPercent || 2}%, TP: ${rm?.takeProfitPercent || 5}%
- Algorithm Leverage: ${rm?.maxLeverage || 10}x`);
  }

  return parts.length > 0 ? `Current Market Context:\n${parts.join("\n")}` : "";
}

function extractAlgorithmFromResponse(
  response: string,
  context: MarketContext
): TradingAlgorithm | undefined {
  let jsonString: string | undefined;
  
  // Pattern 1: ```json code block
  const jsonCodeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonCodeBlockMatch) {
    jsonString = jsonCodeBlockMatch[1];
  }
  
  // Pattern 2: ``` code block (without json label)
  if (!jsonString) {
    const codeBlockMatch = response.match(/```\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1].includes('"rules"')) {
      jsonString = codeBlockMatch[1];
    }
  }
  
  // Pattern 3: Raw JSON object with algorithm structure (more flexible)
  if (!jsonString) {
    const jsonObjectMatch = response.match(/\{[\s\S]*?"name"[\s\S]*?"rules"\s*:\s*\[[\s\S]*?\][\s\S]*?"riskManagement"[\s\S]*?\}/);
    if (jsonObjectMatch) {
      jsonString = jsonObjectMatch[0];
    }
  }
  
  // Pattern 4: Find any balanced JSON object containing "rules" array
  if (!jsonString) {
    const startIdx = response.indexOf('{"');
    if (startIdx !== -1 && response.includes('"rules"')) {
      let braceCount = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < response.length; i++) {
        if (response[i] === '{') braceCount++;
        if (response[i] === '}') braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
      const candidate = response.substring(startIdx, endIdx);
      if (candidate.includes('"rules"') && candidate.includes('"riskManagement"')) {
        jsonString = candidate;
      }
    }
  }
  
  if (!jsonString) {
    console.log("No algorithm JSON found in response");
    return undefined;
  }

  // Clean up common JSON issues from AI responses
  jsonString = jsonString
    .replace(/,\s*}/g, '}')  // Remove trailing commas before }
    .replace(/,\s*]/g, ']')  // Remove trailing commas before ]
    .replace(/[\x00-\x1F\x7F]/g, ' ')  // Remove control characters
    .trim();

  try {
    const parsed = JSON.parse(jsonString);

    // Always generate a proper UUID - AI often returns placeholder IDs like "unique-uuid"
    const algorithmId = randomUUID();
    
    // Validate and create a proper algorithm structure
    const algorithm: TradingAlgorithm = {
      id: algorithmId,
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
          model: "gpt-4o", // Using gpt-4o for more reliable responses
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
        onFailedAttempt: (attemptInfo) => {
          if (!isRateLimitError(attemptInfo.error)) {
            throw new AbortError(attemptInfo.error?.message || "Unknown error");
          }
        },
      }
    )
  );

  return response;
}
