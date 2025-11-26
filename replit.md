# AI Crypto Trading Terminal

## Overview
A professional AI-powered cryptocurrency futures trading application with automated trading algorithms, real-time market data, and intelligent trade execution for Coinstore exchange.

## Current State
- **Phase**: MVP Implementation Complete
- **Last Updated**: November 2024

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
- **Storage**: In-memory (MemStorage class)

### Key Files
```
client/
├── src/
│   ├── components/     # UI components
│   │   ├── AIChatbot.tsx
│   │   ├── KlineChart.tsx
│   │   ├── PositionsTable.tsx
│   │   ├── OrdersTable.tsx
│   │   ├── TradeCycleControls.tsx
│   │   └── ...
│   ├── hooks/
│   │   └── useWebSocket.ts
│   ├── lib/
│   │   └── tradingContext.tsx
│   └── pages/
│       └── Dashboard.tsx
server/
├── routes.ts          # API endpoints
├── storage.ts         # Data persistence
├── openai.ts          # AI integration
├── exchangeService.ts # Exchange API simulation
└── tradingBot.ts      # Automated trading logic
shared/
└── schema.ts          # Type definitions
```

## API Endpoints

### Authentication
- `POST /api/auth/connect` - Connect exchange API credentials
- `POST /api/auth/disconnect` - Disconnect and clear credentials

### Market Data
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
- `POST /api/trading/start` - Start trading cycle
- `POST /api/trading/pause` - Pause trading
- `POST /api/trading/resume` - Resume trading
- `POST /api/trading/stop` - Stop trading
- `POST /api/trading/close-all` - Close all positions and stop
- `GET /api/trading/state` - Get current trading state

### WebSocket
- `ws://host/ws` - Real-time data stream
  - Subscribe: `{ type: "subscribe", exchange: "coinstore", symbol: "BTCUSDT", timeframe: "15m" }`
  - Receives: ticker updates, kline updates, trade cycle events

## Trading Modes

1. **AI Trading**: Automated trading with AI-generated algorithms
2. **AI Scalping**: High-frequency automated scalping (faster cycle)
3. **Manual Trading**: Execute trades manually with full control

## Trade Cycle Flow

1. User selects exchange and market
2. User enters API credentials
3. AI chatbot analyzes market data
4. AI generates trading algorithm (JSON)
5. User loads algorithm
6. User starts trading cycle
7. Trading bot executes trades based on algorithm rules
8. Positions and orders displayed in real-time
9. AI continues analyzing and can update algorithm
10. User stops cycle or closes all positions

## Risk Management
- All positions use isolated margin (never cross)
- Configurable stop-loss and take-profit
- Maximum leverage limits
- Maximum position size limits
- Daily loss limits

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
