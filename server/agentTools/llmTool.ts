/**
 * llmTool.ts
 *
 * Agent-specific LLM bridge.  Wraps `analyzeAndRespond` from openai.ts with:
 *  - agent-aware context building (market data, risk params, positions)
 *  - proposal persistence / dedup logic
 *  - agent-flavoured prompt prefix for dynamic trading vs. algorithm generation
 *
 * openai.ts stays focused on the AI-trading-panel flow (system prompt, extraction,
 * retries).  This module is what the orchestrator and tool registry import.
 */

import { analyzeAndRespond } from '../openai';
import { exchangeService } from '../exchangeService';
import { storage } from '../storage';
import type { AgentMessage } from '../agents/workflowSchema';
import type { Exchange } from '@shared/schema';

export interface LLMToolRequest {
  symbol: string;
  exchange: string;
  side?: string;
  quantity?: number;
  objective?: string;
  timeframe?: string;
  tradingMode?: string;
  executionMode?: string;
  userId?: string;
  autoApprove?: boolean;
}

export interface LLMToolResult {
  message: AgentMessage;
  /** The persisted / updated proposal id, if an algorithm was generated */
  proposalId?: string;
}

const CONTEXT_FETCH_TIMEOUT_MS = Number(process.env.CONTEXT_FETCH_TIMEOUT_MS || 10000);

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => {
      console.warn(`[LLMTool] ${label} timed out after ${timeoutMs}ms`);
      resolve(null);
    }, timeoutMs);
  });

  try {
    return (await Promise.race([promise, timeoutPromise])) as T | null;
  } catch (err) {
    console.warn(`[LLMTool] ${label} failed:`, err);
    return null;
  }
}

/**
 * Build market context for the LLM, identical to what the AI trading panel sends
 * but populated from live exchange data accessible to the server.
 */
async function buildAgentContext(request: LLMToolRequest) {
  const exchange = request.exchange as Exchange;
  const tickerResult = await withTimeout(
    exchangeService.getTicker(exchange, request.symbol),
    CONTEXT_FETCH_TIMEOUT_MS,
    'getTicker',
  );
  const klinesResult = await withTimeout(
    exchangeService.getKlines(exchange, request.symbol, request.timeframe || '15m', 100),
    CONTEXT_FETCH_TIMEOUT_MS,
    'getKlines',
  );
  const positions =
    (await withTimeout(storage.getPositions(exchange), CONTEXT_FETCH_TIMEOUT_MS, 'getPositions')) || [];
  const riskParams = await storage.getRiskParameters().catch(() => undefined);

  return {
    symbol: request.symbol,
    ticker: tickerResult?.ticker,
    klines: klinesResult?.klines,
    positions,
    tradingMode: request.tradingMode as any,
    timeframe: request.timeframe,
    riskParameters: riskParams ?? undefined,
    executionMode: request.executionMode as any,
  };
}

/**
 * Persist a proposal (or update an existing pending one to avoid duplicates).
 * Returns the proposal object.
 */
async function upsertProposal(request: LLMToolRequest, algorithm: any, message: string) {
  const existing = (await storage.getProposals()).find(
    (p: any) =>
      p.status === 'pending' &&
      p.userId === (request.userId || 'agent') &&
      p.request?.objective === request.objective &&
      p.request?.symbol === request.symbol &&
      p.request?.exchange === request.exchange,
  );

  if (existing) {
    return storage.updateProposal(existing.id, {
      algorithm,
      message,
      status: request.autoApprove ? 'approved' : existing.status,
    });
  }

  return storage.createProposal({
    userId: request.userId || 'agent',
    request,
    algorithm,
    message,
    status: request.autoApprove ? 'approved' : 'pending',
  });
}

/**
 * Invoke the LLM as an agent tool.
 *
 * - Builds market context from live data
 * - Calls analyzeAndRespond (same function used by AI trading panel)
 * - Persists the resulting algorithm as a proposal if one is generated
 * - Returns an AgentMessage suitable for the orchestrator pipeline
 */
export async function invokeLLMTool(request: LLMToolRequest): Promise<LLMToolResult> {
  console.log(`[LLMTool] invoking for ${request.symbol} @ ${request.exchange}`);

  const aiContext = await buildAgentContext(request);

  const prompt =
    request.objective ||
    `Analyze ${request.symbol} on ${request.exchange} and generate a conservative trading algorithm with clear entry/exit rules, stop-loss and take-profit levels, and appropriate position sizing.`;

  const llmResp = await analyzeAndRespond(prompt, aiContext).catch((e) => ({
    message: String(e),
    algorithm: undefined,
  }));

  if (llmResp.algorithm) {
    try {
      const proposal = await upsertProposal(
        request,
        llmResp.algorithm,
        llmResp.message || 'agent generated algorithm',
      );

      const msg: AgentMessage = {
        id: `${Date.now()}-llm-proposal`,
        from: 'AI Tool' as any,
        to: 'Manager' as any,
        type: 'NOTIFY',
        payload: {
          proposalId: proposal.id,
          proposal: llmResp.algorithm,
          message: llmResp.message,
          requiresApproval: !request.autoApprove,
          source: 'agent',
        },
        timestamp: Date.now(),
      } as AgentMessage;

      console.log(`[LLMTool] proposal persisted: ${proposal.id}`);
      return { message: msg, proposalId: proposal.id };
    } catch (err) {
      console.error('[LLMTool] failed to persist proposal:', err);
    }
  }

  // No algorithm produced — return an informational message
  const infoMsg: AgentMessage = {
    id: `${Date.now()}-llm-info`,
    from: 'AI Tool' as any,
    to: 'Manager' as any,
    type: 'NOTIFY',
    payload: { message: llmResp.message || 'No algorithm generated' },
    timestamp: Date.now(),
  } as AgentMessage;

  console.warn('[LLMTool] completed without algorithm');

  return { message: infoMsg };
}
