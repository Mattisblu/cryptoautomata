# AI Crypto Trading Terminal

## Overview
A professional AI-powered cryptocurrency futures trading application with automated trading algorithms, real-time market data, and intelligent trade execution for Coinstore and BYDFI exchanges.

## Current State
- **Phase**: Phase 3 - Analytics & Persistence
- **Last Updated**: November 2024

## Recent Changes
- Added PostgreSQL database for persistent trade history storage
- Created Trade History Analytics Dashboard with performance metrics
- Implemented cumulative PnL chart and win/loss distribution visualization
- Trading bot now records trades to database when positions open/close
- Added API endpoints for trade analytics and historical data
- Database tables: trades, daily_summaries, algorithm_performance
- Previous features: BYDFI support, Paper/Real toggle, Risk Management with SL/TP/Trailing stops

## Architecture

### Frontend (React + TypeScript)
- **Framework**: React 18 with Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **State Management**: React Context (TradingContext)
- **Data Fetching**: TanStack Query v5
- **Real-time**: WebSocket for live market data
- **Charting**: Lightweight Charts (TradingView)

### Backend (Express + TypeScript)
- **Framework**: Express.js
- **Real-time**: WebSocket Server (ws)
- **AI Integration**: OpenAI via Replit AI Integrations
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Storage**: In-memory for real-time data (MemStorage), PostgreSQL for trade history

### Key Files
```
client/
├── src/
│   ├── components/     # UI components
│   │   ├── AIChatbot.tsx
│   │   ├── KlineChart.tsx
│   │   ├── PositionsTable.tsx
│   │   ├── OrdersTable.tsx
│   │   ├── RiskParametersCard.tsx
│   │   ├── TradeCycleControls.tsx
│   │   └── ...
│   ├── hooks/
│   │   └── useWebSocket.ts
│   ├── lib/
│   │   └── tradingContext.tsx
│   └── pages/
│       ├── Dashboard.tsx
│       └── Analytics.tsx     # Trade history & performance dashboard
server/
├── db.ts              # Database connection (Drizzle + Neon)
├── routes.ts          # API endpoints
├── storage.ts         # Data persistence (in-memory + database)
├── openai.ts          # AI integration
├── exchangeService.ts # Exchange API simulation (Coinstore + BYDFI)
└── tradingBot.ts      # Automated trading logic with trade recording
shared/
└── schema.ts          # Type definitions + Drizzle table schemas
```

## Supported Exchanges

### Coinstore
- 8 trading pairs: BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX
- Max leverage: 100x
- Maker fee: 0.02%, Taker fee: 0.04%

### BYDFI
- 12 trading pairs: BTC, ETH, SOL, BNB, XRP, ADA, DOGE, LINK, MATIC, ARB, OP, APT
- Max leverage: 125x
- Maker fee: 0.01%, Taker fee: 0.03%
- Faster API response times

## Execution Modes

### Paper Trading (Default)
- Simulated order execution without real funds
- Safe for testing strategies
- All trades are logged as [PAPER]

### Real Trading
- Would execute orders on exchange with real funds
- Warning shown when switching to this mode
- All trades are logged as [REAL]
- Currently uses simulated data until real API connected

## API Endpoints

### Authentication
- `POST /api/auth/connect` - Connect exchange API credentials
- `POST /api/auth/disconnect` - Disconnect and clear credentials

### Market Data
- `GET /api/exchange-info?exchange=coinstore` - Get exchange configuration
- `GET /api/markets?exchange=coinstore` - Get available markets
- `GET /api/ticker?exchange=coinstore&symbol=BTCUSDT` - Get ticker data
- `GET /api/klines?exchange=coinstore&symbol=BTCUSDT&timeframe=15m` - Get candlestick data

### Trading
- `GET /api/positions?exchange=coinstore` - Get open positions
- `GET /api/orders?exchange=coinstore` - Get order history
- `POST /api/orders` - Place manual order

### AI Chat
- `POST /api/chat` - Send message to AI trading assistant
- `GET /api/chat/messages` - Get chat history
- `DELETE /api/chat/messages` - Clear chat history

### Algorithms
- `GET /api/algorithms` - List saved algorithms
- `GET /api/algorithms/:id` - Get specific algorithm
- `DELETE /api/algorithms/:id` - Delete algorithm

### Trade Cycle
- `POST /api/trading/start` - Start trading cycle (includes executionMode: "paper" | "real")
- `POST /api/trading/pause` - Pause trading
- `POST /api/trading/resume` - Resume trading
- `POST /api/trading/stop` - Stop trading
- `POST /api/trading/close-all` - Close all positions and stop
- `GET /api/trading/state` - Get current trading state

### Trade History & Analytics
- `GET /api/trades` - Get trade history (filters: exchange, symbol, status, limit, startDate, endDate)
- `GET /api/trades/:id` - Get specific trade details
- `POST /api/trades` - Create a new trade record (used by trading bot)
- `PATCH /api/trades/:id` - Update trade (e.g., when closing)
- `GET /api/analytics` - Get overall trade statistics (filters: exchange)
- `GET /api/analytics/daily?days=30` - Get daily PnL summaries
- `GET /api/analytics/algorithms?algorithmId=xxx` - Get algorithm performance metrics

### WebSocket
- `ws://host/ws` - Real-time data stream
  - Subscribe: `{ type: "subscribe", exchange: "coinstore", symbol: "BTCUSDT", timeframe: "15m" }`
  - Receives: ticker updates, kline updates, trade cycle events

## Trading Modes

1. **AI Trading**: Automated trading with AI-generated algorithms
2. **AI Scalping**: High-frequency automated scalping (faster cycle)
3. **Manual Trading**: Execute trades manually with full control

## Trade Cycle Flow

1. User selects exchange (Coinstore or BYDFI) and market
2. User enters API credentials
3. User selects Paper or Real trading mode
4. AI chatbot analyzes market data
5. AI generates trading algorithm (JSON)
6. User loads algorithm
7. User starts trading cycle
8. Trading bot executes trades based on algorithm rules
9. Positions and orders displayed in real-time with [PAPER] or [REAL] labels
10. AI continues analyzing and can update algorithm
11. User stops cycle or closes all positions

## Risk Management
- All positions use isolated margin (never cross)
- Configurable stop-loss and take-profit
- Maximum leverage limits (exchange-specific)
- Maximum position size limits
- Daily loss limits
- Paper trading mode for risk-free testing

## Development

### Running Locally
```bash
npm run dev
```

### Environment Variables
- Uses Replit AI Integrations for OpenAI (no API key needed)
- `SESSION_SECRET` - Session encryption secret

## User Preferences
- Dark mode default (professional trading interface)
- Monospace fonts for numerical data (JetBrains Mono)
- Green for profit/long, Red for loss/short
- Paper trading mode as default for safety
