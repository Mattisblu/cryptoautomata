# AI Crypto Trading Terminal

## Overview
The AI Crypto Trading Terminal is a professional, AI-powered cryptocurrency futures trading application designed for automated trading on Coinstore and BYDFI exchanges. It offers real-time market data, intelligent trade execution, and advanced risk management features. The project aims to provide a robust platform for users to deploy and optimize various trading strategies.

## User Preferences
- Dark mode default (professional trading interface)
- Monospace fonts for numerical data (JetBrains Mono)
- Green for profit/long, Red for loss/short
- Paper trading mode as default for safety

## System Architecture

### UI/UX Decisions
- Frontend built with React 18, Vite, Tailwind CSS, and shadcn/ui components.
- Charting powered by Lightweight Charts (TradingView).
- Real-time updates with high-resolution data (3s klines stream, 2s cache TTL).
- Visual Rule Editor GUI for algorithm configuration.
- Volatility Guard Protection and Scalping Frequency Controls with distinct UI themes (orange for volatility, purple for frequency).
- Multi-Strategy support with a dedicated UI for managing running sessions, algorithms, and A/B tests.

### Technical Implementations
- **Frontend**: React 18, Vite, Tailwind CSS, shadcn/ui, React Context (TradingContext), TanStack Query v5, WebSocket for real-time data, Lightweight Charts.
- **Backend**: Express.js, WebSocket Server (ws), OpenAI integration via Replit AI, PostgreSQL (Neon) with Drizzle ORM.
- **Trading Logic**:
    - `StrategyOrchestrator`: Manages multiple trading algorithms concurrently, each with independent state via unique `sessionId`.
    - `positionBroker.ts`: Manages logical positions, supporting individual trade tracking, ROI-based TP/SL, and trailing stops, especially for exchanges aggregating positions.
    - `volatilityGuard.ts`: Monitors market volatility using ATR, Sigma, and Wick ratios, automatically closing positions upon detecting erratic price movements.
    - Scalping Frequency Controls: Implements `tradeCooldownSeconds`, `maxTradesPerHour`, `minHoldTimeSeconds`, and `maxConcurrentPositions` for fine-grained control over high-frequency strategies.
    - User-selectable timeframe for bots (e.g., 1m, 5m, 15m).
    - Per-Request Data Source Tracking: Eliminates race conditions by embedding `dataSource` and `dataError` directly into service function results.
- **API and Authentication**: HMAC-SHA256 authentication for exchange APIs, secure credential retrieval.
- **Database**: PostgreSQL (Neon) with Drizzle ORM for persistent data, in-memory storage for real-time data.

### Feature Specifications
- **Automated Trading**: AI-powered algorithms for automated trade execution.
- **Real-Time Data**: Live market data with high-resolution updates and automatic fallback to simulation.
- **Multi-Strategy Support**: Ability to run multiple trading algorithms simultaneously across different markets.
- **Live Strategy Optimization**: AI monitors and suggests/applies optimizations (Manual Review, Semi-Auto, Full-Auto).
- **Risk Management**: Isolated margin, configurable stop-loss/take-profit, market-specific leverage limits, position size limits, daily loss limits.
- **Execution Modes**: Paper Trading (simulated, default) and Real Trading (live exchange execution).
- **Notification System**: Real-time alerts and configurable notification settings.
- **Analytics Dashboard**: Comprehensive trade history, performance metrics, and PnL summaries.
- **Rule Editor GUI**: Visual interface for defining and validating trading algorithm rules.

## External Dependencies

- **Exchanges**:
    - Coinstore (via `coinstoreApi.ts`)
    - BYDFI (via `bydfiApi.ts`)
    - Bitunix (via `bitunixApi.ts` for real order execution)
- **AI Integration**: OpenAI (via Replit AI Integrations)
- **Database**: PostgreSQL (specifically Neon for managed PostgreSQL)
- **ORM**: Drizzle ORM
- **Charting Library**: Lightweight Charts (TradingView)
- **Frontend Framework**: React 18
- **Backend Framework**: Express.js
- **Styling**: Tailwind CSS, shadcn/ui
- **State Management**: TanStack Query v5
- **Real-time Communication**: WebSocket