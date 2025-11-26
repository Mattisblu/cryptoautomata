# Crypto Trading Application Design Guidelines

## Design Approach

**Reference-Based Hybrid Approach**: Drawing inspiration from TradingView's professional trading interfaces combined with Linear's clean dashboard aesthetic. This creates a data-dense yet modern trading environment that balances technical functionality with visual clarity.

**Core Principles**:
- Information hierarchy: Critical trading data always visible and prioritized
- Scannable layouts: Grid-based organization for rapid data comprehension
- Professional credibility: Clean, technical aesthetic that inspires trust
- Responsive density: Adaptive layouts that maintain data visibility across devices

---

## Typography

**Font Stack**:
- Primary: Inter (Google Fonts) - excellent for UI, data displays, and readability
- Monospace: JetBrains Mono (Google Fonts) - for numerical data, prices, percentages, API responses

**Hierarchy**:
- H1 (Page Headers): text-2xl, font-semibold - Exchange/Market selection headers
- H2 (Section Headers): text-xl, font-semibold - Trading Mode labels, Position Status
- H3 (Component Headers): text-lg, font-medium - Data panel titles, Form sections
- Body (Primary): text-base, font-normal - Chatbot messages, form labels, descriptions
- Body (Secondary): text-sm, font-normal - Timestamps, metadata, helper text
- Data Display: text-base/text-lg, font-mono - Prices, volumes, percentages, ticker symbols
- Small Data: text-sm, font-mono - Order IDs, timestamps in tables

---

## Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, 12, 16 for consistent rhythm
- Component padding: p-4 to p-6
- Section spacing: space-y-6 to space-y-8
- Grid gaps: gap-4 to gap-6
- Card spacing: p-6 for larger panels, p-4 for compact widgets

**Grid Structure**:
- Main layout: Two-column dashboard (70/30 split on desktop)
  - Primary column: Chart data, position tracking, order execution
  - Secondary column: AI chatbot interface, market selector
- Mobile: Single column stack with collapsible sections

**Breakpoints**:
- Mobile-first approach with lg: and xl: modifiers for dashboard features
- Maintain data visibility at all viewport sizes

---

## Component Library

### Navigation & Selection

**Exchange/Market Selector**:
- Dropdown select components with search functionality
- Display: Selected exchange badge with icon, market pair prominently shown
- Layout: Horizontal flex layout with gap-4, grouped in top header area

**Trading Mode Tabs**:
- Three equal-width tabs: "AI Trading", "AI Scalping", "Manual Trading"
- Active state clearly distinguished
- Full-width on mobile, auto-width on desktop

### Data Displays

**Ticker Display** (Bottom of GUI):
- Horizontal scrolling ticker bar with key metrics
- Metrics: Last Price (large, monospace), 24h Change (%, with +/- indicator), Volume, High/Low
- Fixed to bottom: sticky positioning, always visible

**Kline/Chart Widget**:
- Large primary panel showing candlestick chart visualization
- Use TradingView-style layout: time axis at bottom, price axis on right
- Compact controls for timeframe selection (1m, 5m, 15m, 1h, 4h, 1d)

**Position Tracker**:
- Table layout with columns: Symbol, Entry Price, Current Price, P&L, Size, Margin Type
- Rows with subtle borders, monospace fonts for numerical data
- Expandable rows for additional order details

**Order Status Feed**:
- Card-based layout showing recent orders chronologically
- Each card: Order ID, Type (Buy/Sell), Price, Quantity, Status badge, Timestamp
- Status badges with distinct visual treatment (Filled, Pending, Cancelled)

### Forms & Inputs

**API Credentials Form**:
- Vertical form layout with clear labels
- Input fields: API Key, Secret Key (masked input with reveal toggle)
- Checkbox: "Save credentials securely" with explanation text
- Primary action button: "Connect & Authorize"

**Manual Trading Panel** (for Manual Mode):
- Compact order entry form in sidebar
- Inputs: Order Type (Market/Limit), Side (Buy/Sell), Quantity, Price
- Leverage slider with numerical display
- Prominent "Execute Trade" button

### AI Chatbot Interface

**Chatbot Panel**:
- Dedicated vertical panel (fills secondary column on desktop)
- Message thread: Alternating user/AI messages with clear visual distinction
- User messages: right-aligned, compact
- AI responses: left-aligned, with avatar icon, generous width for code/JSON display
- Message bubbles with rounded corners, adequate padding (p-4)

**Input Area**:
- Fixed to bottom of chatbot panel
- Textarea with placeholder: "Ask AI to analyze market or generate strategy..."
- Send button adjacent to textarea
- Auto-expanding textarea for longer queries

**Algorithm Display**:
- Code block styling for JSON algorithm display within chatbot
- Syntax highlighting for JSON structure
- Copy button for generated algorithms
- Visual indicator when algorithm is loaded by trading bot

### Status & Notifications

**Connection Status Indicator**:
- Small badge in top-right corner showing WebSocket/API connection state
- States: Connected (green dot), Connecting (yellow pulse), Disconnected (red)
- Tooltip on hover with connection details

**Trade Cycle Controls**:
- Control bar with Start/Stop/Close All Positions buttons
- Current status display: "Trading Active" or "Trading Paused"
- Warning dialog for "Close All Positions" action

**Data Logging Indicator**:
- Subtle text indicator showing last JSON update timestamp
- Format: "Algorithms updated 3s ago" in small, secondary text

### Overlays & Modals

**Confirmation Dialogs**:
- Center-screen overlay for critical actions (Close All Positions, Disconnect)
- Clear warning text, two-button choice (Cancel/Confirm)
- Backdrop blur effect

**Settings Panel** (Optional):
- Slide-out drawer from right side
- Sections for: Exchange Preferences, Risk Parameters, Notification Settings
- Toggle switches and input fields with consistent spacing

---

## Layout Specifications

**Dashboard Layout**:
```
Header Area (h-16 to h-20):
- Exchange/Market Selector (left)
- Trading Mode Tabs (center)
- Connection Status (right)

Main Content Area (flex-1, two-column):
Left Column (w-2/3 or w-full on mobile):
- Kline Chart (h-96 on desktop, h-64 on mobile)
- Position Tracker Table (below chart)
- Order Status Feed (below positions)

Right Column (w-1/3, stacks below on mobile):
- AI Chatbot Interface (fills available height)
- Manual Trading Panel (when in Manual mode)

Bottom Ticker Bar (h-12 to h-16):
- Fixed position, scrolling market data
```

**Responsive Behavior**:
- Desktop (lg:): Two-column layout as described
- Tablet (md:): Chatbot collapses to bottom drawer, main content full-width
- Mobile: Vertical stack, collapsible sections with accordion pattern

---

## Animations

Use sparingly and only for functional feedback:
- Real-time price updates: Subtle flash animation (green for increase, red for decrease)
- WebSocket connection: Pulse animation on connecting state
- New chatbot messages: Gentle slide-in from bottom
- Position updates: Brief highlight on change

**No Animations For**:
- Page transitions
- Decorative effects
- Layout shifts

---

## Images

**No Hero Images**: This is a functional trading application, not a marketing site. All screen real estate prioritizes data and functionality.

**Icon Usage**:
- Use Heroicons via CDN for UI elements (chevrons, settings, close buttons)
- Exchange logos: Small brand icons next to exchange selector (16x16 to 24x24)
- Trading icons: Simple line icons for Buy/Sell indicators, order types

**Charts/Visualizations**:
- Integrate lightweight charting library (e.g., Lightweight Charts by TradingView)
- Real-time candlestick visualization with clean, minimal styling