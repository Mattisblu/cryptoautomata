# AI Crypto Trading Terminal

## Overview
A professional AI-powered cryptocurrency futures trading application with automated trading algorithms, real-time market data, and intelligent trade execution for Coinstore and BYDFI exchanges.

## Current State
- **Phase**: Phase 5 - Notifications & Alerts
- **Last Updated**: November 2024

## Recent Changes
- Added Notification System with real-time alerts for trading events
- NotificationPanel component in Dashboard header with bell icon and unread badge
- Notification types: trade_open, trade_close, stop_loss, take_profit, trailing_stop, error, info
- Configurable notification settings: toggle by type, browser notifications, sound alerts
- Trading bot integration: sends notifications on position open/close, SL/TP/trailing triggers
- Database tables: notifications, notification_settings
- Previous: Strategy Management page, Algorithm versioning, A/B testing
- Previous features: BYDFI support, Paper/Real toggle, Risk Management, Analytics Dashboard

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
│   │   ├── NotificationPanel.tsx  # Alerts dropdown with settings
│   │   └── ...
│   ├── hooks/
│   │   └── useWebSocket.ts
│   ├── lib/
│   │   └── tradingContext.tsx
│   └── pages/
│       ├── Dashboard.tsx
│       ├── Analytics.tsx     # Trade history & performance dashboard
│       └── Strategies.tsx    # Algorithm versioning & A/B testing
server/
├── db.ts              # Database connection (Drizzle + Neon)
├── routes.ts          # API endpoints
├── storage.ts         # Data persistence (in-memory + database)
├── openai.ts          # AI integration
├── exchangeService.ts # Exchange API simulation (Coinstore + BYDFI)
├── tradingBot.ts      # Automated trading logic with trade recording
└── notificationService.ts  # Real-time notification dispatch
shared/
└── schema.ts          # Type definitions + Drizzle table schemas
```

## Supported Exchanges

### Coinstore
- 8 trading pairs with market-specific leverage limits:
  - BTCUSDT: 100x | ETHUSDT: 75x
  - SOL/BNB/XRP: 50x | ADA/DOGE/AVAX: 25x
- Maker fee: 0.02%, Taker fee: 0.04%

### BYDFI
- 12 trading pairs with market-specific leverage limits:
  - BTCUSDT: 125x | ETHUSDT: 100x
  - SOL/BNB/XRP: 75x | ADA/DOGE/LINK/MATIC: 50x
  - ARB/OP/APT: 25x
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

### Algorithm Versions
- `GET /api/algorithms/:id/versions` - Get version history for an algorithm
- `POST /api/algorithms/:id/versions` - Save a new version snapshot
- `GET /api/algorithm-versions/:versionId` - Get specific version details
- `POST /api/algorithm-versions/:versionId/restore` - Restore algorithm to a previous version

### A/B Tests
- `GET /api/ab-tests` - List all A/B tests
- `GET /api/ab-tests/:id` - Get specific A/B test
- `POST /api/ab-tests` - Create a new A/B test
- `POST /api/ab-tests/:id/start` - Start an A/B test
- `POST /api/ab-tests/:id/complete` - Complete an A/B test and determine winner
- `PATCH /api/ab-tests/:id/results` - Update test results (PnL, trades, win rate)
- `DELETE /api/ab-tests/:id` - Delete an A/B test

### Notifications
- `GET /api/notifications` - Get all notifications
- `PATCH /api/notifications/:id/read` - Mark notification as read
- `POST /api/notifications/mark-all-read` - Mark all notifications as read
- `GET /api/notifications/settings` - Get notification settings
- `PUT /api/notifications/settings` - Update notification settings

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
- Market-specific leverage limits (displayed in UI, enforced by trading bot)
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
