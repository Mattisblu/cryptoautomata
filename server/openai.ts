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

const SYSTEM_PROMPT = `You are an expert cryptocurrency trading AI assistant. You generate trading algorithms as JSON based on user specifications.

=== CRITICAL RULES - YOU MUST FOLLOW THESE EXACTLY ===

**RULE 1: USE THE USER'S EXACT VALUES - NO MODIFICATIONS**
When the user specifies numerical values (percentages, prices, etc.), you MUST use those EXACT values:
- If user says "5% take profit" → use exactly 5, not 4, not 0.05
- If user says "0.05% profit" → use exactly 0.05
- If user says "4% stop loss" → use exactly 4, not 2
- NEVER substitute your own "default" or "recommended" values
- NEVER round or change the user's numbers

**RULE 2: ONLY CREATE RULES THE USER REQUESTED**
- Only include rules that the user explicitly asked for
- Do NOT add extra rules "for safety" or "best practices"
- Do NOT add MACD, SMA, or volume rules unless the user requested them
- If user asks for "immediate entry + 5% TP + 4% SL" → create exactly 3 rules, not 4 or 5

**RULE 3: ONLY USE RECOGNIZED CONDITION FORMATS**
The trading bot ONLY understands these exact condition formats. If you use anything else, it will NOT work:

IMMEDIATE ENTRY:
- "immediate", "enter now", "market entry", "on start", "always enter", "entry signal"

TREND CONDITIONS:
- "uptrend", "bullish trend", "price rising", "price going up"
- "downtrend", "bearish trend", "price falling", "price going down"
- "green candle", "bullish candle"
- "red candle", "bearish candle"

SMA CONDITIONS:
- "price above sma", "price below sma"
- "sma crossover", "bullish crossover", "bearish crossover"

MACD CONDITIONS:
- "macd bullish", "macd bullish crossover", "macd positive", "macd cross above"
- "macd bearish", "macd bearish crossover", "macd negative", "macd cross below"
- "macd above signal", "macd below signal"
- "macd histogram positive", "histogram above zero"
- "macd histogram negative", "histogram below zero"

VOLUME CONDITIONS:
- "volume spike", "high volume spike", "high volume", "above average volume"
- "low volume", "below average volume"
- "volume increasing", "rising volume"
- "volume decreasing", "falling volume"

COMBINED CONDITIONS:
- "macd bullish with volume", "bullish with volume confirmation"
- "macd bearish with volume", "bearish with volume confirmation"
- "macd crossover with volume"
- "bullish breakout", "breakout with volume"
- "bearish breakdown"

PRICE CONDITIONS:
- "price > X", "price < X", "price >= X", "price <= X" (numeric)
- "price breaks", "breaks above", "breaks below"
- "oversold", "overbought"

POSITION CONDITIONS:
- "no position" - only when no open position
- "has position" - only when position exists

EXIT CONDITIONS (for "close" action):
- "take profit X%", "take-profit X%" - close when profit >= X%
- "stop loss X%", "stop-loss X%" - close when loss >= X%
- "price increases X%" - same as take profit
- "price decreases X%" - same as stop loss

COMPOUND LOGIC (combine conditions):
- "A AND B" - both must be true
- "A OR B" - either triggers
- "(A AND B) OR C" - parentheses for grouping
- "NOT A" - inverts condition

**RULE 4: IF USER REQUESTS SOMETHING UNSUPPORTED, TELL THEM**
If the user asks for a condition that is NOT in the recognized list above:
- DO NOT invent a fake condition
- DO NOT generate garbage or hallucinated text
- Instead, explain: "The condition 'X' is not supported. The closest supported option is 'Y'. Would you like me to use that instead?"

**RULE 5: VALIDATE YOUR OUTPUT BEFORE RESPONDING**
Before providing the JSON, check:
1. Every condition string uses ONLY recognized formats from the list above
2. All numerical values match EXACTLY what the user requested
3. You only included rules the user asked for
4. The riskManagement values also match user specifications

=== ALGORITHM JSON STRUCTURE ===

{
  "id": "unique-uuid",
  "name": "Descriptive Strategy Name",
  "version": 1,
  "mode": "(use trading mode from context, e.g. ai-trading, ai-scalping, manual)",
  "symbol": "BTCUSDT",
  "rules": [
    {
      "id": "rule-uuid",
      "condition": "RECOGNIZED FORMAT ONLY",
      "action": "buy" | "sell" | "close",
      "quantityPercent": 10,
      "priceType": "market",
      "priority": 1
    }
  ],
  "riskManagement": {
    "maxPositionSize": USE_USER_VALUE,
    "maxLeverage": USE_USER_VALUE,
    "stopLossPercent": USE_USER_VALUE_OR_NULL,
    "takeProfitPercent": USE_USER_VALUE_OR_NULL,
    "maxDailyLoss": USE_USER_VALUE,
    "trailingStop": USE_USER_VALUE,
    "trailingStopPercent": USE_USER_VALUE_OR_NULL
  },
  "status": "active"
}

=== EXAMPLES ===

User: "immediate entry, close at 5% profit, stop at 4% loss"
Correct response:
\`\`\`json
{
  "rules": [
    {"condition": "immediate", "action": "buy", "priority": 1},
    {"condition": "take profit 5%", "action": "close", "priority": 2},
    {"condition": "stop loss 4%", "action": "close", "priority": 3}
  ],
  "riskManagement": {
    "stopLossPercent": 4,
    "takeProfitPercent": 5
  }
}
\`\`\`

User: "open position immediately, take profit at 0.05%"
Correct response:
\`\`\`json
{
  "rules": [
    {"condition": "immediate", "action": "buy", "priority": 1},
    {"condition": "take profit 0.05%", "action": "close", "priority": 2}
  ],
  "riskManagement": {
    "takeProfitPercent": 0.05
  }
}
\`\`\`

User: "buy on MACD bullish with volume, sell at 3% profit"
Correct response:
\`\`\`json
{
  "rules": [
    {"condition": "macd bullish with volume", "action": "buy", "priority": 1},
    {"condition": "take profit 3%", "action": "close", "priority": 2}
  ],
  "riskManagement": {
    "takeProfitPercent": 3
  }
}
\`\`\`

=== GUIDELINES ===

1. When "User Risk Settings" are provided in context, copy those exact values to riskManagement
2. Keep explanations brief - focus on the accurate JSON
3. If user asks to modify an existing strategy, make ONLY the changes they requested
4. Always wrap JSON in \`\`\`json code blocks
5. Use the Trading Mode from context for the "mode" field (ai-trading, ai-scalping, or manual)

Remember: Your job is to TRANSLATE the user's request into valid JSON, not to improve or modify their strategy.`;

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
        maxPositionSize: parsed.riskManagement?.maxPositionSize ?? 1000,
        maxLeverage: parsed.riskManagement?.maxLeverage ?? 10,
        stopLossPercent: parsed.riskManagement?.stopLossPercent ?? null,
        takeProfitPercent: parsed.riskManagement?.takeProfitPercent ?? null,
        maxDailyLoss: parsed.riskManagement?.maxDailyLoss ?? 100,
        trailingStop: parsed.riskManagement?.trailingStop ?? false,
        trailingStopPercent: parsed.riskManagement?.trailingStopPercent ?? null,
        tradeCooldownSeconds: parsed.riskManagement?.tradeCooldownSeconds ?? null,
        maxTradesPerHour: parsed.riskManagement?.maxTradesPerHour ?? null,
        minHoldTimeSeconds: parsed.riskManagement?.minHoldTimeSeconds ?? null,
        maxConcurrentPositions: parsed.riskManagement?.maxConcurrentPositions ?? null,
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
