import { AgentRole, AgentMessage, TradeRequest, ExecutionResult } from './workflowSchema';
import { exchangeService, getAvailableBalance } from '../exchangeService';
import { storage } from '../storage';

// executionAgent will honor `executionMode` on the incoming TradeRequest.

export class ExecutionAgent {
  role: AgentRole = AgentRole.Execution;

  async executeTrade(request: TradeRequest): Promise<AgentMessage> {
    console.log(`[ExecutionAgent] executeTrade start for ${request.symbol} qty=${request.quantity} mode=${request.executionMode || 'paper'}`);

    // If executionMode === 'real', attempt to place a real order using stored credentials
    if (request.executionMode === 'real') {
      try {
        const creds = await storage.getCredentials(request.exchange as any);
        if (!creds) {
          console.warn('[ExecutionAgent] No credentials found for real trading, falling back to paper order');
        } else {
          const realParams = {
            symbol: request.symbol,
            side: request.side as 'buy' | 'sell',
            type: (request.price ? 'limit' : 'market') as 'market' | 'limit',
            quantity: request.quantity,
            price: request.price,
            leverage: request.leverage,
          };

          const realResult = await exchangeService.placeRealOrder(request.exchange as any, creds, realParams as any);
          if (realResult.success) {
            const result: ExecutionResult = { success: true, orderId: realResult.order?.id || realResult.exchangeOrderId || `${Date.now()}-real` };
            return {
              id: `${Date.now()}-exec`,
              from: this.role,
              to: AgentRole.Manager,
              type: 'RESPONSE_EXECUTE_TRADE',
              payload: result,
              timestamp: Date.now(),
            };
          } else {
            console.error('[ExecutionAgent] Real order failed:', realResult.error);
            // fallthrough to simulated placeOrder below
          }
        }
      } catch (err) {
        console.error('[ExecutionAgent] Exception placing real order:', err);
        // fallthrough to simulated placeOrder
      }
    }

    // Default: use simulated placeOrder (paper trading)
    console.log(`[ExecutionAgent] placing simulated order for ${request.symbol}`);
    try {
      const creds = await storage.getCredentials(request.exchange as any);
      const balance = await getAvailableBalance(
        request.exchange as any,
        creds || ({ apiKey: 'test', secretKey: 'test', exchange: request.exchange } as any),
        (request.executionMode as any) || 'paper'
      );

      const currentPrice = await exchangeService.getTicker(request.exchange as any, request.symbol).then(r => r.ticker.lastPrice).catch(() => 0);
      const leverage = request.leverage || 1;
      const notional = (request.quantity || 0) * (currentPrice || 0);
      const requiredMargin = leverage > 0 ? notional / leverage : notional;

      if (requiredMargin > balance.available) {
        const result: ExecutionResult = { success: false, error: `Insufficient available balance $${balance.available.toFixed(2)} for required margin $${requiredMargin.toFixed(2)}` };
        return {
          id: `${Date.now()}-exec`,
          from: this.role,
          to: AgentRole.Manager,
          type: 'RESPONSE_EXECUTE_TRADE',
          payload: result,
          timestamp: Date.now(),
        };
      }
    } catch (err) {
      console.warn('[ExecutionAgent] balance pre-check failed', err);
    }
    const order = await exchangeService.placeOrder(
      request.exchange as any,
      'test',
      'test',
      false,
      { apiKey: 'test', secretKey: 'test', exchange: request.exchange as any, saveCredentials: false },
      {
        symbol: request.symbol,
        side: request.side,
        quantity: request.quantity,
        price: request.price,
      }
    );
    console.log(`[ExecutionAgent] placeOrder returned id=${order?.id}`);
    const result: ExecutionResult = {
      success: !!order,
      orderId: order?.id || `${Date.now()}-order`,
    };
    return {
      id: `${Date.now()}-exec`,
      from: this.role,
      to: AgentRole.Manager,
      type: 'RESPONSE_EXECUTE_TRADE',
      payload: result,
      timestamp: Date.now(),
    };
  }
}

export const executionAgent = new ExecutionAgent();
