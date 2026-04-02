import { marketAgent } from '../agents/marketAgent';
import { riskAgent } from '../agents/riskAgent';
import { executionAgent } from '../agents/executionAgent';
import type { AgentMessage } from '../agents/workflowSchema';
import { analyzeAndRespond } from '../openai';
import { exchangeService } from '../exchangeService';
import { storage } from '../storage';

export type ToolFn = (request: any, context: any) => Promise<AgentMessage>;

const registry: Record<string, ToolFn> = {};

// Built-in tool registrations using existing agents
registry.market = async (request: any) => {
  console.log(`[ToolRegistry] market tool called for ${request.symbol} @ ${request.exchange}`);
  const res = await marketAgent.getMarketData(request.symbol, request.exchange);
  console.log(`[ToolRegistry] market tool finished`);
  return res;
};

registry.risk = async (request: any, context: any) => {
  // riskAgent expects the MarketData payload in context
  console.log(`[ToolRegistry] risk tool called`);
  const marketData = context?.market?.payload;
  const algorithm = context?.algorithm?.payload;
  const res = await riskAgent.validateTrade(request, marketData, algorithm);
  console.log(`[ToolRegistry] risk tool finished`);
  return res;
};

registry.execution = async (request: any) => {
  console.log(`[ToolRegistry] execution tool called`);
  const res = await executionAgent.executeTrade(request);
  console.log(`[ToolRegistry] execution tool finished`);
  return res;
};

export function registerTool(name: string, fn: ToolFn) {
  registry[name] = fn;
}

// AI tool: allows the orchestrator to call the LLM as a tool and persist a proposal
registry.ai = async (request: any, context: any) => {
  console.log(`[ToolRegistry] ai tool called for ${request.symbol} @ ${request.exchange}`);

  // build lightweight context (best-effort)
  const tickerResult = await exchangeService.getTicker(request.exchange, request.symbol).catch(() => null);
  const klinesResult = await exchangeService.getKlines(request.exchange, request.symbol, request.timeframe || '15m', 100).catch(() => null);
  const positions = await storage.getPositions(request.exchange).catch(() => []);
  const riskParams = await storage.getRiskParameters().catch(() => undefined);

  const aiContext = {
    symbol: request.symbol,
    ticker: tickerResult?.ticker,
    klines: klinesResult?.klines,
    positions,
    tradingMode: request.tradingMode,
    timeframe: request.timeframe,
    riskParameters: riskParams ?? undefined,
    executionMode: request.executionMode,
  };

  // Ask the LLM to craft a strategy when the agent chooses to use AI
  const prompt = request.objective || `Analyze ${request.symbol} on ${request.exchange} and generate a trading algorithm with entry/exit rules, risk management, and sizing.`;

  const llmResp = await analyzeAndRespond(prompt, aiContext).catch((e) => ({ message: String(e), algorithm: null }));

  if (llmResp.algorithm) {
    // Persist a proposal so the UI can surface it. If a pending proposal exists
    // that matches this request, update it instead of creating a duplicate.
    try {
      const existing = (await storage.getProposals()).find((p: any) =>
        p.status === 'pending' &&
        p.userId === (request.userId || 'agent') &&
        p.request?.objective === request.objective &&
        p.request?.symbol === request.symbol &&
        p.request?.exchange === request.exchange
      );

      let proposal: any;
      if (existing) {
        proposal = await storage.updateProposal(existing.id, {
          algorithm: llmResp.algorithm,
          message: llmResp.message || 'agent generated algorithm',
          status: request.autoApprove ? 'approved' : existing.status,
        });
      } else {
        proposal = await storage.createProposal({
          userId: request.userId || 'agent',
          request,
          algorithm: llmResp.algorithm,
          message: llmResp.message || 'agent generated algorithm',
          status: request.autoApprove ? 'approved' : 'pending',
        });
      }

      const msg: AgentMessage = {
        id: `${Date.now()}-ai-proposal`,
        from: ("AI Tool" as any),
        to: ("Manager" as any),
        type: 'NOTIFY',
        payload: { proposalId: proposal.id, proposal: llmResp.algorithm, message: llmResp.message, requiresApproval: !request.autoApprove },
        timestamp: Date.now(),
      } as AgentMessage;

      console.log(`[ToolRegistry] ai tool finished - proposal ${proposal.id}`);
      return msg;
    } catch (err) {
      console.error('[ToolRegistry] ai tool persist error:', err);
    }
  }

  const infoMsg: AgentMessage = {
    id: `${Date.now()}-ai-info`,
    from: ("AI Tool" as any),
    to: ("Manager" as any),
    type: 'NOTIFY',
    payload: { message: llmResp.message || 'No algorithm generated' },
    timestamp: Date.now(),
  } as AgentMessage;

  console.log(`[ToolRegistry] ai tool finished without algorithm`);
  return infoMsg;
};

export function getTool(name: string): ToolFn | undefined {
  return registry[name];
}

export function listTools(): string[] {
  return Object.keys(registry);
}

export default registry;
