/**
 * llmPlanner.ts
 *
 * Dynamic LLM-based plan selector for the agent orchestrator.
 *
 * Given a trade request and the registry of available tools, asks the LLM
 * to choose an ordered execution plan (array of tool names).  Falls back
 * to a hard-coded default plan if the LLM is unavailable or returns an
 * invalid response.
 *
 * Intentionally uses a minimal, focused prompt — NOT the full trading-algorithm
 * system prompt.  The goal is fast, reliable tool routing, not content generation.
 */

import axios from 'axios';

const OLLAMA_HOST  = process.env.OLLAMA_URL     || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL   || 'kimi-k2.5:cloud';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);
const OLLAMA_API_KEY    = process.env.OLLAMA_API_KEY || 'ollama';

/** Descriptions surfaced to the planner LLM for each registered tool. */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  ai:        'Generate a trading algorithm from the user\'s objective using an LLM. Required when no algorithm is provided and the user has a high-level goal.',
  market:    'Fetch live market data (ticker, order book, recent klines) for the requested symbol and exchange.',
  risk:      'Validate the proposed trade against active risk parameters (max position size, leverage, daily-loss limits) and open positions.',
  execution: 'Execute the trade on the exchange in paper or live mode.',
};

const SYSTEM_PROMPT = `You are a tool-routing planner for a crypto trading agent.
Your ONLY job is to output a JSON array of tool names that should run (in order) to fulfil a trade request.

Available tools:
${Object.entries(TOOL_DESCRIPTIONS).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

Rules:
- Output ONLY a valid JSON array of tool names, nothing else.
- Only include tools from the list above.
- The array must contain at least one tool.
- "execution" should always be last if included.
- Include "ai" only when the user has an objective AND no algorithm is already provided.
- If an algorithm is already provided (approve flow), skip "ai".
- Typical plans: ["ai","market","risk","execution"] or ["market","risk","execution"]`;

const VALID_TOOLS = new Set(Object.keys(TOOL_DESCRIPTIONS));

/** Fallback plan when LLM planner is unavailable or returns garbage. */
function staticFallbackPlan(request: any): string[] {
  if (!request.algorithm && request.tradingMode === 'agent') {
    return ['ai', 'market', 'risk', 'execution'];
  }
  return ['market', 'risk', 'execution'];
}

/**
 * Ask the LLM to select an ordered tool plan for the given request.
 * Returns a validated array of known tool names.
 * Falls back to `staticFallbackPlan` on any error or invalid output.
 */
export async function planWithLLM(request: any): Promise<string[]> {
  const requestSummary = JSON.stringify({
    symbol:      request.symbol,
    exchange:    request.exchange,
    tradingMode: request.tradingMode,
    hasObjective:  !!request.objective,
    hasAlgorithm:  !!request.algorithm,
    autoApprove:   !!request.autoApprove,
    executionMode: request.executionMode,
  });

  try {
    const resp = await axios.post(
      `${OLLAMA_HOST}/api/chat`,
      {
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: `Trade request: ${requestSummary}\n\nReturn the JSON tool plan array.` },
        ],
        stream: false,
      },
      {
        timeout: OLLAMA_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${OLLAMA_API_KEY}` },
      }
    );

    const content: string = resp.data?.message?.content || resp.data?.response || '';
    // Extract first JSON array from the response
    const match = content.match(/\[[\s\S]*?\]/);
    if (!match) {
      console.warn('[LLMPlanner] no JSON array in response, using fallback');
      return staticFallbackPlan(request);
    }

    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn('[LLMPlanner] invalid plan array, using fallback');
      return staticFallbackPlan(request);
    }

    const plan: string[] = parsed.filter((t): t is string => typeof t === 'string' && VALID_TOOLS.has(t));
    if (plan.length === 0) {
      console.warn('[LLMPlanner] plan contained no valid tools, using fallback');
      return staticFallbackPlan(request);
    }

    console.log(`[LLMPlanner] selected plan: [${plan.join(', ')}]`);
    return plan;
  } catch (err: any) {
    console.warn('[LLMPlanner] error calling LLM, using fallback plan:', err?.response?.data || err?.message);
    return staticFallbackPlan(request);
  }
}
