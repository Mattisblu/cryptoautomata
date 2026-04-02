import { AgentRole, AgentMessage, MarketData } from './workflowSchema';
import { exchangeService } from '../exchangeService';

export class MarketAgent {
  role: AgentRole = AgentRole.Market;

  async getMarketData(symbol: string, exchange: string): Promise<AgentMessage> {
    console.log(`[MarketAgent] getMarketData start for ${symbol} @ ${exchange}`);
    // Integrate with exchangeService for real data
    const tickerResult = await exchangeService.getTicker(exchange as any, symbol);
    const ticker = tickerResult.ticker;
    const marketData: MarketData = {
      symbol,
      price: ticker.lastPrice,
      orderbook: undefined, // TODO: add orderbook if available
      indicators: undefined, // TODO: add indicators if available
    };
    console.log(`[MarketAgent] getMarketData result price=${marketData.price}`);
    return {
      id: `${Date.now()}-market`,
      from: this.role,
      to: AgentRole.Manager,
      type: 'RESPONSE_MARKET_DATA',
      payload: marketData,
      timestamp: Date.now(),
    };
  }
}

export const marketAgent = new MarketAgent();
