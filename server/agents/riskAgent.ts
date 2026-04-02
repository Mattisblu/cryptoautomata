import { AgentRole, AgentMessage, TradeRequest, TradeValidation, MarketData } from './workflowSchema';
import { getVolatilityGuard } from '../volatilityGuard';
import { getAvailableBalance } from '../exchangeService';
import { storage } from '../storage';
import { exchangeService } from '../exchangeService';

interface AlgorithmLike {
  riskManagement?: any;
}

export class RiskAgent {
  role: AgentRole = AgentRole.Risk;

  async validateTrade(request: TradeRequest, marketData: MarketData, algorithm?: AlgorithmLike): Promise<AgentMessage> {
    console.log(`[RiskAgent] validateTrade start for ${request.symbol} qty=${request.quantity}`);

    const guard = getVolatilityGuard(request.exchange, request.symbol);
    const volatilityCheck = guard.check();

    // Base validity checks
    let valid = request.quantity > 0 && request.symbol === marketData.symbol && volatilityCheck.severity === 'normal' && !volatilityCheck.triggered;
    let reason: string | undefined = undefined;

    // If an algorithm with riskManagement is provided, enforce its constraints
    if (algorithm && algorithm.riskManagement) {
      try {
        const rm = algorithm.riskManagement;
        // If maxPositionSize provided, ensure requested not exceed (approx by price)
        if (rm.maxPositionSize && marketData.price) {
          const notional = request.quantity * marketData.price;
          if (notional > rm.maxPositionSize) {
            valid = false;
            reason = `Requested position notional $${notional.toFixed(2)} exceeds algorithm maxPositionSize $${rm.maxPositionSize}`;
          }
        }

        // Max leverage check (if provided)
        if (rm.maxLeverage && request.leverage && request.leverage > rm.maxLeverage) {
          valid = false;
          reason = `Requested leverage ${request.leverage}x exceeds algorithm maxLeverage ${rm.maxLeverage}x`;
        }

        // Stop-loss / take-profit presence check — warn if algorithm requires but request lacks
        if (rm.autoStopLoss && (rm.stopLossPercent === null || rm.stopLossPercent === undefined)) {
          // algorithm expects stop-loss configured; mark invalid
          valid = false;
          reason = reason ? `${reason}; missing required stopLossPercent` : 'Algorithm requires stopLossPercent but none provided in algorithm';
        }
      } catch (err) {
        console.warn('[RiskAgent] error applying algorithm riskManagement', err);
      }
    }

    // Compose validation payload
    const validation: TradeValidation = {
      valid,
      reason: valid ? undefined : (reason || 'Invalid trade parameters or volatility risk'),
      riskReport: { volatility: volatilityCheck },
    };

    try {
      // Fetch available balance for this exchange and user
      const creds = await storage.getCredentials(request.exchange as any);
      const balance = await getAvailableBalance(
        request.exchange as any,
        creds || ({ apiKey: 'test', secretKey: 'test', exchange: request.exchange } as any),
        (request.executionMode as any) || 'paper'
      );

      // Determine required margin for this trade (notional / leverage)
      const price = marketData.price || 0;
      const leverage = request.leverage || (algorithm?.riskManagement?.leverage) || exchangeService.getExchangeInfo(request.exchange as any)?.maxLeverage || 1;
      const notional = (request.quantity || 0) * price;
      const requiredMargin = leverage > 0 ? notional / leverage : notional;

      // Respect algorithm-defined maxRiskPercent if present
      if (algorithm && algorithm.riskManagement && algorithm.riskManagement.maxRiskPercent) {
        const maxAlloc = Math.max(0, balance.available * algorithm.riskManagement.maxRiskPercent);
        if (requiredMargin > maxAlloc) {
          validation.valid = false;
          validation.reason = `Required margin $${requiredMargin.toFixed(2)} exceeds allowed allocation $${maxAlloc.toFixed(2)} (maxRiskPercent)`;
        }
      } else {
        // Default guard: require available balance to cover required margin
        if (requiredMargin > balance.available) {
          validation.valid = false;
          validation.reason = `Insufficient available balance $${balance.available.toFixed(2)} for required margin $${requiredMargin.toFixed(2)}`;
        }
      }

      validation.riskReport = {
        ...validation.riskReport,
        balance,
        requiredMargin,
        notional,
        leverage,
      };
    } catch (err) {
      console.warn('[RiskAgent] balance check failed', err);
    }

    console.log(`[RiskAgent] validateTrade result valid=${validation.valid} severity=${volatilityCheck.severity} reason=${validation.reason}`);
    return {
      id: `${Date.now()}-risk`,
      from: this.role,
      to: AgentRole.Manager,
      type: 'RESPONSE_TRADE_VALIDATION',
      payload: validation,
      timestamp: Date.now(),
    };
  }
}

export const riskAgent = new RiskAgent();
