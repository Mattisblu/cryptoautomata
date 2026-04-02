import { getTool } from './agentTools/toolRegistry';
import type { AgentMessage } from './agents/workflowSchema';
import { analyzeAndRespond } from './openai';
import { exchangeService } from './exchangeService';
import { storage } from './storage';

// Simple orchestrator that chooses a tool plan and executes tools in sequence.
// Plan selection is currently static but can be replaced by an LLM planner.
export async function handleTradeRequest(
  request: any,
  onMessage?: (msg: AgentMessage) => void
): Promise<AgentMessage[]> {
  console.log(`[Orchestrator] Received trade request: ${JSON.stringify({ symbol: request.symbol, exchange: request.exchange, side: request.side, quantity: request.quantity, objective: !!request.objective })}`);
  const plan = selectPlanForRequest(request);
  const context: Record<string, AgentMessage | undefined> = {};
  const results: AgentMessage[] = [];

  // If an algorithm was provided directly (e.g., after user approval), attach it to context
  if (request.algorithm && request.autoApprove) {
    const algoMsg: AgentMessage = {
      id: `${Date.now()}-algo-context`,
      from: ("Manager" as any),
      to: ("Manager" as any),
      type: 'NOTIFY',
      payload: request.algorithm,
      timestamp: Date.now(),
    } as AgentMessage;
    context['algorithm'] = algoMsg;
    if (onMessage) onMessage(algoMsg);
  }

  // If user provided a high-level objective, consult the LLM to generate/propose a strategy
  if (request.objective) {
    try {
      // Build a lightweight market context for the LLM
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

      const llmResp = await analyzeAndRespond(request.objective, aiContext);

      // If the LLM returned an algorithm, present it as a proposal
      if (llmResp.algorithm) {
        // Persist proposal so UI can list and approve it. Prefer updating an existing
        // pending proposal (created by the route) to avoid duplicates.
        try {
          const existing = (await storage.getProposals()).find((p: any) =>
            p.status === 'pending' &&
            p.userId === (request.userId || 'unknown') &&
            p.request?.objective === request.objective &&
            p.request?.symbol === request.symbol &&
            p.request?.exchange === request.exchange
          );

          let proposal: any;
          if (existing) {
            proposal = await storage.updateProposal(existing.id, {
              algorithm: llmResp.algorithm,
              message: llmResp.message || 'analysis complete',
            });
          } else {
            proposal = await storage.createProposal({
              userId: request.userId || 'unknown',
              request,
              algorithm: llmResp.algorithm,
              message: llmResp.message || undefined,
              status: request.autoApprove ? 'approved' : 'pending',
            });
          }

          const proposalMsg: AgentMessage = {
            id: `${Date.now()}-proposal`,
            from: ("Manager" as any),
            to: ("Manager" as any),
            type: 'NOTIFY',
            payload: { proposalId: proposal.id, proposal: llmResp.algorithm, message: llmResp.message, requiresApproval: !request.autoApprove },
            timestamp: Date.now(),
          } as AgentMessage;
          results.push(proposalMsg);
          if (onMessage) onMessage(proposalMsg);

          // If user allowed auto-approve, attach algorithm to context for tools to use
          if (request.autoApprove) {
            context['algorithm'] = {
              id: `${Date.now()}-algo-context`,
              from: ("Manager" as any),
              to: ("Manager" as any),
              type: 'NOTIFY',
              payload: llmResp.algorithm,
              timestamp: Date.now(),
            } as AgentMessage;
          } else {
            // If not auto-approved, stop here and wait for user approval path
            return results;
          }
        } catch (err) {
          console.error('[Orchestrator] Failed to persist proposal:', err);
        }
      } else {
        // No algorithm produced: send LLM message back for user's review
        const infoMsg: AgentMessage = {
          id: `${Date.now()}-llm-info`,
          from: ("Manager" as any),
          to: ("Manager" as any),
          type: 'NOTIFY',
          payload: { message: llmResp.message, requiresApproval: true },
          timestamp: Date.now(),
        } as AgentMessage;
        results.push(infoMsg);
        if (onMessage) onMessage(infoMsg);
        return results;
      }
    } catch (err) {
      const errMsg: AgentMessage = {
        id: `${Date.now()}-error-llm`,
        from: ("Manager" as any),
        to: ("Manager" as any),
        type: 'ERROR',
        payload: (err as Error).message || String(err),
        timestamp: Date.now(),
      } as AgentMessage;
      results.push(errMsg);
      if (onMessage) onMessage(errMsg);
      // proceed with normal tool plan as fallback
    }
  }

  for (const step of plan) {
    const tool = getTool(step);
    if (!tool) {
      const errMsg: AgentMessage = {
        id: `${Date.now()}-error-${step}`,
        from: ("Execution" as any),
        to: ("Manager" as any),
        type: 'ERROR',
        payload: `Tool not found: ${step}`,
        timestamp: Date.now(),
      } as AgentMessage;
      results.push(errMsg);
      if (onMessage) onMessage(errMsg);
      break;
    }

    try {
      console.log(`[Orchestrator] Executing tool '${step}'`);
      const start = Date.now();
      const res = await tool(request, context);
      const dur = Date.now() - start;
      console.log(`[Orchestrator] Tool '${step}' completed in ${dur}ms`);
      results.push(res);
      context[step] = res;
      if (onMessage) onMessage(res);
    } catch (err) {
      const errMsg: AgentMessage = {
        id: `${Date.now()}-error-${step}`,
        from: ("Execution" as any),
        to: ("Manager" as any),
        type: 'ERROR',
        payload: (err as Error).message || String(err),
        timestamp: Date.now(),
      } as AgentMessage;
      console.error(`[Orchestrator] Tool '${step}' error:`, err);
      results.push(errMsg);
      if (onMessage) onMessage(errMsg);
      break;
    }
  }

  console.log(`[Orchestrator] Completed plan with ${results.length} messages`);
  return results;
}

function selectPlanForRequest(request: any): string[] {
  // Default plan: market -> risk -> execution
  // If running in `agent` trading mode and no algorithm provided, allow the
  // agent to call the AI tool autonomously as the first step.
  if (!request.algorithm && request.tradingMode === 'agent') {
    return ['ai', 'market', 'risk', 'execution'];
  }
  // In future: consult LLM or policy engine to choose alternative tools
  return ['market', 'risk', 'execution'];
}

// Accept `algorithm` passed directly on the request for approve flow
export async function handleApprovedProposal(request: any, onMessage?: (msg: AgentMessage) => void) {
  // Attach algorithm to request so tools can consume it
  request.autoApprove = true;
  if (request.algorithm) {
    // nothing extra required; orchestrator will attach context when autoApprove
  }
  return handleTradeRequest(request, onMessage);
}

export default { handleTradeRequest };
