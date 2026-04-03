import { marketAgent } from '../agents/marketAgent';
import { riskAgent } from '../agents/riskAgent';
import { executionAgent } from '../agents/executionAgent';
import type { AgentMessage } from '../agents/workflowSchema';
import { invokeLLMTool } from './llmTool';

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

// AI tool: delegates to llmTool.ts which wraps openai.ts cleanly for agent use
registry.ai = async (request: any, _context: any) => {
  console.log(`[ToolRegistry] ai tool called for ${request.symbol} @ ${request.exchange}`);
  const result = await invokeLLMTool(request);
  console.log(`[ToolRegistry] ai tool finished${result.proposalId ? ` - proposal ${result.proposalId}` : ' (no algorithm)'}`);
  return result.message;
};

export function getTool(name: string): ToolFn | undefined {
  return registry[name];
}

export function listTools(): string[] {
  return Object.keys(registry);
}

export default registry;
