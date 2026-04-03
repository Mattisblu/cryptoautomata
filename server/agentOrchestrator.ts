import { getTool } from './agentTools/toolRegistry';
import type { AgentMessage } from './agents/workflowSchema';
import { invokeLLMTool } from './agentTools/llmTool';
import { planWithLLM } from './agentTools/llmPlanner';
import { storage } from './storage';

// Simple orchestrator that chooses a tool plan and executes tools in sequence.
// Plan selection is currently static but can be replaced by an LLM planner.
export async function handleTradeRequest(
  request: any,
  onMessage?: (msg: AgentMessage) => void
): Promise<AgentMessage[]> {
  console.log(`[Orchestrator] Received trade request: ${JSON.stringify({ symbol: request.symbol, exchange: request.exchange, side: request.side, quantity: request.quantity, objective: !!request.objective })}`);
  const plan = await planWithLLM(request);
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

  // If user provided a high-level objective, consult the LLM via the dedicated llmTool wrapper.
  // Skip this when an approved algorithm is already attached (approve flow).
  if (request.objective && !(request.algorithm && request.autoApprove)) {
    try {
      const llmResult = await invokeLLMTool(request);
      const proposalMsg = llmResult.message;
      results.push(proposalMsg);
      if (onMessage) onMessage(proposalMsg);

      if (llmResult.proposalId) {
        // Algorithm was generated and persisted
        if (request.autoApprove) {
          // Load the algorithm so downstream tools can use it
          const proposal = await storage.getProposal(llmResult.proposalId);
          if (proposal?.algorithm) {
            context['algorithm'] = {
              id: `${Date.now()}-algo-context`,
              from: 'Manager' as any,
              to: 'Manager' as any,
              type: 'NOTIFY',
              payload: proposal.algorithm,
              timestamp: Date.now(),
            } as AgentMessage;
          }
        } else {
          // Pending approval — stop here, UI will trigger approve/reject
          return results;
        }
      } else {
        // No algorithm — informational only, stop pipeline
        return results;
      }
    } catch (err) {
      const errMsg: AgentMessage = {
        id: `${Date.now()}-error-llm`,
        from: 'Manager' as any,
        to: 'Manager' as any,
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
