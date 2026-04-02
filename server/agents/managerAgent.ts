import { AgentRole, AgentMessage, AgentMessageType, TradeRequest, TradeValidation } from './workflowSchema';
import { marketAgent } from './marketAgent';
import { riskAgent } from './riskAgent';
import { executionAgent } from './executionAgent';
import { handleTradeRequest as orchestratorHandleTrade } from '../agentOrchestrator';

export class ManagerAgent {
  role: AgentRole = AgentRole.Manager;

  async handleUserTradeRequest(
    request: TradeRequest,
    onMessage?: (msg: AgentMessage) => void
  ): Promise<AgentMessage[]> {
    // Delegate to orchestrator (manager acts as the brain that requests tool plans)
    try {
      const messages = await orchestratorHandleTrade(request as any, onMessage);
      return messages;
    } catch (err) {
      // Fallback to the previous static flow if the orchestrator fails
      const marketMsg = await marketAgent.getMarketData(request.symbol, request.exchange);
      if (onMessage) onMessage(marketMsg);
      const validationMsg = await riskAgent.validateTrade(request, marketMsg.payload);
      if (onMessage) onMessage(validationMsg);
      let executionMsg: AgentMessage | null = null;
      if (validationMsg.payload.valid) {
        executionMsg = await executionAgent.executeTrade(request);
        if (onMessage && executionMsg) onMessage(executionMsg);
      }
      return [marketMsg, validationMsg, executionMsg].filter(Boolean) as AgentMessage[];
    }
  }

  async notify(type: AgentMessageType, payload: any): Promise<AgentMessage> {
    return {
      id: `${Date.now()}-notify`,
      from: this.role,
      to: AgentRole.Manager,
      type,
      payload,
      timestamp: Date.now(),
    };
  }
}

export const managerAgent = new ManagerAgent();
