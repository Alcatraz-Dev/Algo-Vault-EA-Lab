import type { TourStep } from "./TourGuide";

export type GuideConfig = {
    key: string;
    pageTitle: string;
    match: (pathname: string) => boolean;
    steps: TourStep[];
    legacySeenKeys?: string[];
};

const exactOrPrefix = (target: string) => (p: string) => p === target || p.startsWith(target + "?") || p.startsWith(target + "/");

const GUIDES: GuideConfig[] = [
    // ── Workflow Intelligence Studio ──
    {
        key: "workflow-studio",
        pageTitle: "Workflow Intelligence Studio",
        match: exactOrPrefix("/admin/intelligence/studio"),
        steps: [
            { target: "[data-guide='page-header']", title: "Workflow Intelligence Studio", body: "Build, test, and deploy automated trading strategies with a visual node DAG editor." },
            { target: "[data-guide='studio-actions']", title: "Create & Load Workflows", body: "Start with a blank canvas, load pre-built templates, or let AI generate the strategy graph." },
            { target: "[data-guide='ai-builder']", title: "Build Strategy with AI", body: "Describe your trading rules in plain language, and the AI Router will generate a validated node graph." },
            { target: "[data-guide='templates']", title: "Workflow Templates", body: "Pick battle-tested trading workflows like RSI breakouts, trailing stops, or volatility scalpers." },
            { target: "[data-guide='palette']", title: "Node Library Palette", body: "Drag market data, indicator, risk, AI, logic, and alert nodes onto the canvas." },
            { target: "[data-guide='canvas']", title: "React Flow DAG Canvas", body: "Wire node outputs to inputs to construct your strategy flow. Click any node to open the Inspector." },
            { target: "[data-guide='inspector']", title: "Node Parameter Inspector", body: "Customize symbols, timeframes, indicator parameters, and toggle node states in real-time." },
            { target: "[data-guide='actions']", title: "Validate & Run Test", body: "Validate node schemas and test execution live against real market data before saving." },
        ],
    },

    // ── Account Workflows ──
    {
        key: "account-workflows",
        pageTitle: "Workflow Automation",
        match: exactOrPrefix("/account/workflows"),
        steps: [
            { target: "[data-guide='page-header']", title: "Workflow Automations", body: "Create, monitor, and run automated trading strategies connected to your account." },
            { target: "[data-guide='create-actions']", title: "New Workflow & AI Tools", body: "Use New Workflow, Templates, or AI Builder to build trading strategy DAGs." },
            { target: "[data-guide='stats']", title: "Workflow Counters", body: "Track total, active, draft, and paused automations at a glance." },
            { target: "[data-guide='search-bar']", title: "Search & Status Filters", body: "Quickly filter automations by name or state (active, draft, paused)." },
            { target: "[data-guide='workflows-grid']", title: "Workflow Management Cards", body: "Run, edit in Studio, duplicate, or manage permissions for each workflow card." },
        ],
    },

    // ── Admin Workflows Hub ──
    {
        key: "admin-workflows",
        pageTitle: "Admin Workflow Hub",
        match: (p) => p === "/admin/workflows" || p === "/admin/intelligence/workflows",
        steps: [
            { target: "[data-guide='page-header']", title: "Admin Workflow Management", body: "Monitor system execution runs, configure kill switch, and manage platform workflow definitions." },
            { target: "[data-guide='kill-switch']", title: "Global Kill Switch", body: "Emergency stop switch to halt all automated workflow executions instantly across the platform." },
            { target: "[data-guide='stats']", title: "Status Breakdown", body: "Overview of active, paused, disabled, draft, and archived workflows." },
            { target: "[data-guide='workflows-list']", title: "Realtime Workflows List", body: "Inspect, trigger manual runs, toggle active/paused states, or edit in Studio." },
            { target: "[data-guide='audit-log']", title: "Execution Audit Log", body: "Track recent failures, execution tracebacks, and automated trigger logs." },
        ],
    },

    // ── Trading Studio ──
    {
        key: "studio",
        pageTitle: "Trading Studio",
        match: (p) => p === "/account/tradingview" || p === "/admin/tradingview" || p === "/trading",
        legacySeenKeys: ["algovault-studio-guide-v1"],
        steps: [
            { target: "[data-guide='palette']", title: "Build from the palette", body: "Drag any node onto the canvas, or click to add it. Indicators, conditions, entries and risk tools all live here." },
            { target: "[data-guide='ai-builder']", title: "AI Strategy Builder", body: "Describe your strategy in plain English — e.g. 'Buy when EMA crosses RSI below 70 with 1% stop loss' — and AI will auto-build the full node graph for you." },
            { target: "[data-guide='canvas']", title: "Connect the flow", body: "Click the output dot (right side) of a node, then the input dot (left side) of the next node to wire the logic together." },
            { target: "[data-guide='modes']", title: "Switch modes", body: "Move between the Visual builder, Pine code, and Bar replay. In Pine code mode, write your own script and click Apply to Chart." },
            { target: "[data-guide='code-toolbar']", title: "AI-powered code tools", body: "Use Analyze to check compatibility, AI Fix to auto-fix errors in your Pine script, and Describe to get an AI summary of what your code does." },
            { target: "[data-guide='chart']", title: "Preview on the chart", body: "The chart below shows your indicators live. Click Apply to Chart after editing Pine code to refresh the displayed studies." },
            { target: "[data-guide='actions']", title: "Save & export", body: "Save the workspace to reopen it later, or download the generated code as a .txt file." },
            { target: "[data-guide='alerts']", title: "Create alerts", body: "After analyzing your Pine script, click Create Alert to set up real-time notifications via Discord, Telegram, or email when your strategy triggers." },
        ],
    },

    // ── Dashboard ──
    {
        key: "dashboard",
        pageTitle: "Dashboard",
        match: exactOrPrefix("/dashboard"),
        steps: [
            { target: "[data-guide='page-header']", title: "Your command centre", body: "The dashboard is a live overview of your accounts, alerts and strategy signals — customise it to fit your workflow." },
            { target: "[data-guide='edit-layout']", title: "Add & edit widgets", body: "Click Edit Layout, then Add Widget and pick what appears on your grid — positions, alerts, performance charts and more." },
            { target: "[data-guide='widgets']", title: "Saved grid layout", body: "Your widget arrangement saves automatically in real time. Rearrange or remove widgets at any time." },
            { target: "[data-guide='quick-links']", title: "Quick launch cards", body: "Jump to AI Copilot, Market Scanner, Insights or the Tools suite directly from the cards below." },
        ],
    },

    // ── Account Hub ──
    {
        key: "account-home",
        pageTitle: "Account Hub",
        match: (p) => p === "/account",
        steps: [
            { target: "[data-guide='page-header']", title: "Welcome to AlgoVault", body: "Your personal trading hub. From here you can manage licenses, connect bots, set files, and access every tool." },
            { target: "[data-guide='quick-access']", title: "Quick access hub", body: "Use the cards on this page to jump to frequently used pages — Licenses, Trading Access, Set Files, and more." },
            { target: "[data-guide='sidebar']", title: "Navigation sidebar", body: "The sidebar groups pages by Account, Tools, Analytics and Trading for fast access at any time." },
            { target: "[data-guide='licenses-card']", title: "Product Licenses", body: "Manage active strategy licenses, link MT5 account numbers, and manage upgrades." },
            { target: "[data-guide='tools-card']", title: "Trading Tools", body: "Access calculators, market session overlap clocks, pip value lookups, and risk tools." },
        ],
    },

    // ── AI Signals ──
    {
        key: "signals",
        pageTitle: "AI Signals",
        match: (p) => p === "/signals",
        steps: [
            { target: "[data-guide='scan']", title: "Scan the markets", body: "Click Scan for Signals to generate fresh AI trading ideas across forex, gold, indices and crypto." },
            { target: "[data-guide='daily-limit']", title: "Daily usage tracker", body: "Free accounts get 3 signals a day, Pro up to 10. Upgrade to unlock more scans and priority alerts." },
            { target: "[data-guide='top-signals']", title: "Top opportunities", body: "The highest-confidence signals are ranked first, each with entry, stop-loss and take-profit levels." },
            { target: "[data-guide='tabs']", title: "Signal feed filter", body: "Filter signals by Active, Ready or Forming, then click any card for the full analysis." },
            { target: "[data-guide='analytics']", title: "Signal analytics", body: "Track win rate, average R:R and TP hit rates so you know exactly how the signals perform." },
        ],
    },
    {
        key: "signals-stats",
        pageTitle: "Signal Performance",
        match: exactOrPrefix("/signals/stats"),
        steps: [
            { target: "[data-guide='page-header']", title: "Signal Performance Metrics", body: "Historical performance metrics, win rates, and expected return stats for all generated AI signals." },
            { target: "[data-guide='stats']", title: "Win Rate & Profit Factor", body: "Inspect detailed risk-to-reward metrics across different assets, market sessions, and strategies." },
            { target: "[data-guide='content']", title: "Detailed breakdown", body: "Expand any row to see individual signal outcomes, entry accuracy, and TP/SL hit ratios." },
        ],
    },
    {
        key: "signals-history",
        pageTitle: "Signal History",
        match: exactOrPrefix("/signals/history"),
        steps: [
            { target: "[data-guide='page-header']", title: "Historical Signal Log", body: "Comprehensive log of all past AI signals, showing exit price, TP/SL hit status, and net gain/loss." },
            { target: "[data-guide='filters']", title: "Filter Signal Log", body: "Filter signal history by asset class, outcome, date range, or confidence score." },
            { target: "[data-guide='stats']", title: "Performance summary", body: "View aggregated stats at the top — total signals, win rate, average return, and best/worst trades." },
        ],
    },

    // ── Live Trading ──
    {
        key: "live",
        pageTitle: "Live Trading",
        match: (p) => p === "/live",
        steps: [
            { target: "[data-guide='account-selector']", title: "Live account overview", body: "Pick the licensed product and MT5 account you want to inspect — live performance loads instantly." },
            { target: "[data-guide='metrics']", title: "Key real-time metrics", body: "Balance, equity, total profit, drawdown, win rate and profit factor are all tracked in real time." },
            { target: "[data-guide='date-range']", title: "Change date range", body: "Switch between 1D, 1W, 1M, 3M, 1Y or All to filter the equity chart and stats." },
            { target: "[data-guide='equity-chart']", title: "Live equity curve", body: "The chart plots equity over the selected range and keeps updating automatically while the page is open." },
        ],
    },

    // ── Copy Trading ──
    {
        key: "copy-trading",
        pageTitle: "Copy Trading",
        match: exactOrPrefix("/copy-trading"),
        steps: [
            { target: "[data-guide='page-header']", title: "Mirror master accounts", body: "Copy trading mirrors trades from master MT5 accounts to your own account in real time with full risk controls." },
            { target: "[data-guide='stats']", title: "Your copy overview", body: "Track active followers, open copied trades, total copy profit and the number of trades mirrored." },
            { target: "[data-guide='configs']", title: "Follower configurations", body: "Each follower configuration has its own lot sizing, max-open-trade limits and risk filters." },
        ],
    },

    // ── Trading Terminal ──
    {
        key: "trading",
        pageTitle: "Trading Terminal",
        match: exactOrPrefix("/trading"),
        steps: [
            { target: "[data-guide='page-header']", title: "Trading terminal header", body: "Monitor connection status, account balance and equity in real time from the top bar." },
            { target: "[data-guide='account-selector']", title: "Account selector", body: "Switch between your connected MT5 accounts to view their specific positions and orders." },
            { target: "[data-guide='chart']", title: "Chart area", body: "The main chart displays the selected symbol. TradingView integration is loaded here." },
            { target: "[data-guide='tabs']", title: "Positions, orders & history", body: "Switch between Open Positions, Pending Orders and Execution Log tabs to see everything happening on your account." },
            { target: "[data-guide='order-panel']", title: "Order panel", body: "Place market, limit and stop orders directly from this panel. Risk is calculated automatically." },
        ],
    },

    // ── Portfolio ──
    {
        key: "portfolio",
        pageTitle: "Portfolio Overview",
        match: exactOrPrefix("/portfolio"),
        steps: [
            { target: "[data-guide='page-header']", title: "Portfolio header", body: "Get an aggregated view of all your connected MT5 accounts in one place." },
            { target: "[data-guide='stats']", title: "Summary cards", body: "Total balance, equity, floating P/L, margin used, drawdown and online accounts are summarised here." },
            { target: "[data-guide='accounts']", title: "Accounts table", body: "See every connected account with its broker, server, balance, equity and status at a glance." },
        ],
    },

    // ── Scanner ──
    {
        key: "scanner",
        pageTitle: "Market Scanner",
        match: (p) => p === "/scanner",
        steps: [
            { target: "[data-guide='page-header']", title: "Multi-Asset Scanner", body: "The scanner screens multiple instruments at once using technical indicators and AI signals." },
            { target: "[data-guide='controls']", title: "Scan controls", body: "Click Scan Markets to run a fresh multi-asset scan across your chosen symbols and timeframes." },
            { target: "[data-guide='stats']", title: "Scan Criteria & Filters", body: "Choose indicator conditions, timeframes and filters to view matching opportunities in real time." },
            { target: "[data-guide='results']", title: "Scan results", body: "Review detected setups with direction, strength and regime tags. Click any row for full analysis." },
        ],
    },

    // ── Account Health ──
    {
        key: "account-health",
        pageTitle: "Account Health",
        match: exactOrPrefix("/account-health"),
        steps: [
            { target: "[data-guide='page-header']", title: "Account Health Score", body: "Real-time audit of leverage safety, margin level, equity drawdown, and broker risk score." },
            { target: "[data-guide='score-ring']", title: "Health score ring", body: "A composite 0-100 score based on drawdown, margin usage, exposure, P/L and signal quality." },
            { target: "[data-guide='breakdown']", title: "Score breakdown", body: "See exactly how each risk component contributes to your overall health score." },
            { target: "[data-guide='metrics']", title: "Live metrics", body: "Balance, equity, open positions, risk and margin level update in real time." },
        ],
    },

    // ── Account Settings ──
    {
        key: "settings",
        pageTitle: "Account Settings",
        match: exactOrPrefix("/account/settings"),
        steps: [
            { target: "[data-guide='page-header']", title: "Account & Security Settings", body: "Manage user profile details, email notification preferences, password updates, and API access." },
            { target: "[data-guide='tabs']", title: "Settings tabs", body: "Switch between General Profile, MT5 Connections, Security, Risk Controls and Notifications." },
            { target: "[data-guide='profile-form']", title: "Profile form", body: "Update your display name, bio, location and trading experience here." },
            { target: "[data-guide='mt5-accounts']", title: "MT5 accounts", body: "Add, edit or remove MetaTrader 5 accounts linked to your licences." },
        ],
    },

    // ── Backtests ──
    {
        key: "backtests",
        pageTitle: "Backtesting",
        match: exactOrPrefix("/backtests"),
        steps: [
            { target: "[data-guide='bot-selector']", title: "Select a strategy", body: "Choose the bot or strategy to review — its real logo, platform and symbol populate automatically." },
            { target: "[data-guide='modes']", title: "Switch report types", body: "Move between Myfxbook-style analytics, the MT5 Strategy Tester report, verified trade log, and live benchmarking." },
            { target: "[data-guide='metrics']", title: "Key performance metrics", body: "Total return, win rate, profit factor, max drawdown and recovery factor are summarised at a glance." },
            { target: "[data-guide='charts']", title: "Deep-dive charts", body: "Use Equity Curve, Drawdown Depth, Day of Week and Trading Sessions views to understand returns." },
        ],
    },

    // ── Strategy Lab ──
    {
        key: "strategy-lab",
        pageTitle: "Strategy Lab",
        match: exactOrPrefix("/strategy-lab"),
        steps: [
            { target: "[data-guide='page-header']", title: "Pick or write a strategy", body: "Load any saved Pine strategy or write a new one to start experimenting with parameters." },
            { target: "[data-guide='stats']", title: "Walk-forward optimisation", body: "Run a walk-forward test to see how your strategy performs out of sample on rolling windows." },
            { target: "[data-guide='content']", title: "Robustness scoring", body: "The comparison table shows equity curves, key metrics, and robustness scores side by side." },
            { target: "[data-guide='actions']", title: "Deploy winning setup", body: "When you are confident, deploy the winning strategy configuration directly to your live or paper account." },
        ],
    },

    // ── Smart Management ──
    {
        key: "trade-management",
        pageTitle: "Smart Management",
        match: exactOrPrefix("/trade-management"),
        steps: [
            { target: "[data-guide='page-header']", title: "Automated trade rules", body: "Define automated rules that close, move, or protect positions when market conditions change." },
            { target: "[data-guide='stats']", title: "Breakeven & trailing stops", body: "Set rules to automatically move stop-loss to breakeven or trail price at specific profit targets." },
            { target: "[data-guide='content']", title: "Smart close rules", body: "Set rules to partially or fully close positions based on profit targets, time limits, or risk thresholds." },
            { target: "[data-guide='actions']", title: "Manual overrides", body: "Disable or edit any rule at any time without losing the configuration. Changes apply instantly." },
        ],
    },

    // ── Alert Center ──
    {
        key: "alert-center",
        pageTitle: "Alert Center",
        match: (p) => p === "/alert-center" || p === "/alerts",
        steps: [
            { target: "[data-guide='stats']", title: "Alert metrics", body: "See unread counts, target hits and risk events at a glance so you always know what needs attention." },
            { target: "[data-guide='filters']", title: "Filter alert feeds", body: "Switch between All, Unread, Trades, Targets and Risk filters to zero in on the alerts that matter." },
            { target: "[data-guide='notifications']", title: "Your notification feed", body: "Click an unread alert to mark it as read, or use Mark all read to clear the badge in one tap." },
        ],
    },
    {
        key: "alert-history",
        pageTitle: "Alert History",
        match: exactOrPrefix("/alerts/history"),
        steps: [
            { target: "[data-guide='page-header']", title: "Historical Alert Archive", body: "Review all triggered price, margin, drawdown, and signal notifications in chronological order." },
            { target: "[data-guide='stats']", title: "Alert statistics", body: "See counts of alerts by type — price alerts, risk warnings, signal notifications, and system events." },
            { target: "[data-guide='filters']", title: "Filter by type", body: "Use the filter bar to narrow alerts by category, date range, or read/unread status." },
        ],
    },

    // ── My Bots ──
    {
        key: "bots",
        pageTitle: "My Bots",
        match: exactOrPrefix("/account/bots"),
        steps: [
            { target: "[data-guide='page-header']", title: "All your bots in one place", body: "Connect Marketplace products or register your own Custom EA to monitor every bot through a single dashboard." },
            { target: "[data-guide='stats']", title: "Register a Custom bot", body: "Click Register Bot and enter your EA name, MT5 account number and magic number to start monitoring." },
            { target: "[data-guide='content']", title: "Link Marketplace products", body: "If you have a Marketplace product licence, link it here to start tracking live performance automatically." },
        ],
    },

    // ── Licenses ──
    {
        key: "licenses",
        pageTitle: "Licenses",
        match: exactOrPrefix("/account/licenses"),
        steps: [
            { target: "[data-guide='page-header']", title: "Your product licences", body: "Every Marketplace product you purchase is listed here with its status, expiry date and linked MT5 account." },
            { target: "[data-guide='stats']", title: "Connect to MT5", body: "Assign a product licence to an MT5 account and magic number so the gateway can report its trades." },
            { target: "[data-guide='content']", title: "License details", body: "Expand any license to see activation status, expiry countdown, and linked account information." },
        ],
    },

    // ── Purchases ──
    {
        key: "purchases",
        pageTitle: "Purchases",
        match: exactOrPrefix("/account/purchases"),
        steps: [
            { target: "[data-guide='page-header']", title: "Order history", body: "All your marketplace purchases and subscriptions are listed here. Click 'Browse Marketplace' to explore more products." },
            { target: "[data-guide='purchases-list']", title: "Your purchased products", body: "Each card shows the product name, version and license status. Expand it to view your license key, expiry date and linked MT5 account." },
            { target: "[data-guide='stats']", title: "License details grid", body: "Payment status, license key, expiry date and MT5 account number are shown for each product in this 4-column grid." },
            { target: "[data-guide='security']", title: "Secure EX5 delivery", body: "Your EX5 files are delivered through an authenticated secure endpoint. You must have an active license to download." },
        ],
    },

    // ── Set Files ──
    {
        key: "setfiles",
        pageTitle: "Set Files",
        match: exactOrPrefix("/account/setfiles"),
        steps: [
            { target: "[data-guide='page-header']", title: "EA Parameter Set Files", body: "Download verified preset files (.set) optimized for specific currency pairs and risk settings." },
            { target: "[data-guide='stats']", title: "Available presets", body: "Browse the collection of .set files organized by currency pair and risk profile." },
            { target: "[data-guide='content']", title: "Download & apply", body: "Click any preset to download the .set file, then load it into your MT5 Strategy Tester or EA inputs." },
        ],
    },

    // ── Subscribe ──
    {
        key: "subscribe",
        pageTitle: "Subscription Plans",
        match: exactOrPrefix("/account/subscribe"),
        steps: [
            { target: "[data-guide='page-header']", title: "Upgrade Your Plan", body: "Select a Pro, Elite, or Institutional subscription to unlock unlimited EA connections and signals." },
            { target: "[data-guide='stats']", title: "Plan comparison", body: "Compare features side-by-side — AI signals, copy trading, strategy lab access, and support tiers." },
            { target: "[data-guide='content']", title: "Current plan status", body: "See your active subscription, billing cycle, and next renewal date at the top of the page." },
        ],
    },

    // ── Account Tools ──
    {
        key: "account-tools",
        pageTitle: "Account Tools",
        match: exactOrPrefix("/account/tools"),
        steps: [
            { target: "[data-guide='page-header']", title: "Quick Tool Launchpad", body: "Access all proprietary trading tools, risk calculators, and session clocks directly from your account hub." },
            { target: "[data-guide='stats']", title: "Tool categories", body: "Tools are grouped by category — Calculators, Session Clocks, Risk Analysis, and Market Data." },
            { target: "[data-guide='content']", title: "Launch a tool", body: "Click any tool card to open it. Each tool opens in a new view with its own inputs and results." },
        ],
    },

    // ── Trading Access ──
    {
        key: "trading-access",
        pageTitle: "Trading Gateway",
        match: exactOrPrefix("/account/trading-access"),
        steps: [
            { target: "[data-guide='page-header']", title: "MT4/MT5 Gateway Bridge", body: "Set up WebSockets credentials and terminal bridges to connect desktop MetaTrader terminals to AlgoVault." },
            { target: "[data-guide='stats']", title: "Connection status", body: "View which MT5 accounts are currently connected, their last heartbeat, and data flow status." },
            { target: "[data-guide='content']", title: "Setup instructions", body: "Follow the step-by-step guide to install the EA on your MT5 terminal and configure the WebSocket link." },
        ],
    },

    // ── Marketplace ──
    {
        key: "marketplace",
        pageTitle: "Marketplace",
        match: exactOrPrefix("/marketplace"),
        steps: [
            { target: "[data-guide='search']", title: "Search products", body: "Find strategies, indicators and set files by name, symbol or platform using the search box." },
            { target: "[data-guide='filters']", title: "Filter by category", body: "Narrow the catalogue to Expert Advisors, Indicators, Pine Strategies, MT5/MT4/TradingView or free/paid products." },
            { target: "[data-guide='products']", title: "Verified product cards", body: "Each card shows key stats and pricing — open it for the full description, reviews and author info." },
        ],
    },

    // ── Calculators ──
    {
        key: "calculators",
        pageTitle: "Trading Calculators",
        match: exactOrPrefix("/tools/calculators"),
        steps: [
            { target: "[data-guide='page-header']", title: "Trading Calculators Suite", body: "Use the calculators to accurately size positions, manage lot risk, calculate pip values, and protect capital." },
            { target: "[data-guide='stats']", title: "Interactive inputs", body: "Fill in the fields — account balance, risk percentage, stop-loss distance — and results update instantly." },
            { target: "[data-guide='content']", title: "Calculator results", body: "Results show recommended lot size, risk amount in dollars, and margin requirements for the trade." },
        ],
    },

    // ── Broker Fees ──
    {
        key: "broker-fees",
        pageTitle: "Broker Fees",
        match: exactOrPrefix("/tools/broker-fees"),
        steps: [
            { target: "[data-guide='page-header']", title: "Broker Spreads & Commissions", body: "Compare live commission structures, swaps, and slippage metrics across major forex & CFD brokers." },
            { target: "[data-guide='stats']", title: "Spread comparison", body: "View real-time spread data for each broker across major currency pairs and commodities." },
            { target: "[data-guide='content']", title: "Swap rates", body: "Check overnight swap rates for long and short positions to calculate carry costs for holding trades." },
        ],
    },

    // ── Currency Strength ──
    {
        key: "currency-strength",
        pageTitle: "Currency Strength",
        match: exactOrPrefix("/tools/currency-strength"),
        steps: [
            { target: "[data-guide='page-header']", title: "Live Currency Matrix", body: "Gauge real-time relative strength across USD, EUR, GBP, JPY, AUD, CAD, CHF, and NZD." },
            { target: "[data-guide='stats']", title: "Strength meters", body: "Each currency shows a real-time strength score from -100 to +100 based on cross-pair analysis." },
            { target: "[data-guide='content']", title: "Heatmap view", body: "The matrix shows pairwise correlations — strong currencies vs weak currencies highlight trade opportunities." },
        ],
    },

    // ── Drawdown Calculator ──
    {
        key: "drawdown-calculator",
        pageTitle: "Drawdown Calculator",
        match: exactOrPrefix("/tools/drawdown-calculator"),
        steps: [
            { target: "[data-guide='page-header']", title: "Drawdown & Recovery Tool", body: "Calculate required gain percentage to recover from specified peak-to-trough account equity drops." },
            { target: "[data-guide='stats']", title: "Drawdown inputs", body: "Enter your current drawdown percentage to see exactly how much gain is needed to break even." },
            { target: "[data-guide='content']", title: "Recovery table", body: "The table maps drawdown levels to required recovery percentages — a 50% drawdown needs 100% gain." },
        ],
    },

    // ── Fibonacci ──
    {
        key: "fibonacci",
        pageTitle: "Fibonacci Calculator",
        match: exactOrPrefix("/tools/fibonacci"),
        steps: [
            { target: "[data-guide='page-header']", title: "Fibonacci Retracements", body: "Input swing high and swing low prices to generate key 23.6%, 38.2%, 50%, 61.8%, and 78.6% levels." },
            { target: "[data-guide='stats']", title: "Price inputs", body: "Enter the swing high and swing low prices — the calculator generates all retracement and extension levels." },
            { target: "[data-guide='content']", title: "Level visualization", body: "View calculated levels in a table with potential support/resistance zones and price targets." },
        ],
    },

    // ── Session Overlap ──
    {
        key: "overlap",
        pageTitle: "Session Overlap Clock",
        match: exactOrPrefix("/tools/overlap"),
        steps: [
            { target: "[data-guide='page-header']", title: "Market Overlap Hours", body: "Identify high-volatility window overlaps between London, New York, Tokyo, and Sydney trading sessions." },
            { target: "[data-guide='stats']", title: "Session timeline", body: "Visual timeline shows when each session is open and highlights the overlap windows in real time." },
            { target: "[data-guide='content']", title: "Volatility indicator", body: "Each overlap window shows a volatility score — London/New York overlap is typically the most active." },
        ],
    },

    // ── Pip Reference ──
    {
        key: "pip-reference",
        pageTitle: "Pip Reference Table",
        match: exactOrPrefix("/tools/pip-reference"),
        steps: [
            { target: "[data-guide='page-header']", title: "Pip Value Matrix", body: "Reference pip values in major currencies across standard (100k), mini (10k), and micro (1k) lot sizes." },
            { target: "[data-guide='stats']", title: "Lot size selector", body: "Switch between standard, mini, and micro lot sizes to see pip values for each currency pair." },
            { target: "[data-guide='content']", title: "Pip value table", body: "Each row shows the pip value in account currency for a specific pair and lot size combination." },
        ],
    },

    // ── Risk of Ruin ──
    {
        key: "risk-of-ruin",
        pageTitle: "Risk of Ruin",
        match: exactOrPrefix("/tools/risk-of-ruin"),
        steps: [
            { target: "[data-guide='page-header']", title: "Risk of Ruin Calculator", body: "Calculate theoretical mathematical probability of account depletion based on win rate and risk per trade." },
            { target: "[data-guide='stats']", title: "Input parameters", body: "Enter your win rate, risk-reward ratio, and risk per trade percentage to calculate ruin probability." },
            { target: "[data-guide='content']", title: "Probability output", body: "The result shows the probability of losing a specified percentage of your account before recovery." },
        ],
    },

    // ── Sessions ──
    {
        key: "sessions",
        pageTitle: "Trading Sessions",
        match: exactOrPrefix("/tools/sessions"),
        steps: [
            { target: "[data-guide='page-header']", title: "Global Session Clocks", body: "Live countdown clocks and local time alignment for London, New York, Tokyo, and Sydney markets." },
            { target: "[data-guide='stats']", title: "Session timers", body: "Each session shows time until open/close, current status (open/closed), and local time." },
            { target: "[data-guide='content']", title: "Session details", body: "Click any session to see typical spread conditions, volume profile, and best trading hours." },
        ],
    },

    // ── Equity Curve ──
    {
        key: "equity-curve",
        pageTitle: "Equity Curve",
        match: exactOrPrefix("/equity-curve"),
        steps: [
            { target: "[data-guide='curves']", title: "Choose an account", body: "Every connected account has its own equity curve — use the tabs to pick the one you want to inspect." },
            { target: "[data-guide='stats']", title: "Performance summary", body: "Net P/L, return percentage, max drawdown and data points are summarised for the selected account." },
            { target: "[data-guide='chart']", title: "Equity & balance over time", body: "The chart plots equity and balance history — hover any point for the exact value on that day." },
        ],
    },

    // ── Compare ──
    {
        key: "compare",
        pageTitle: "Compare Accounts",
        match: (p) => p === "/compare",
        steps: [
            { target: "[data-guide='page-header']", title: "Compare accounts", body: "Side-by-side metrics for every connected MT5 account — click any column header to re-sort." },
            { target: "[data-guide='summary']", title: "Summary metrics", body: "Totals for balance, equity, trades and the overall best account are pinned at the top of the comparison." },
        ],
    },

    // ── Broker Compare ──
    {
        key: "broker-compare",
        pageTitle: "Broker Comparison",
        match: (p) => p === "/broker-compare",
        steps: [
            { target: "[data-guide='page-header']", title: "Institutional Broker Comparison", body: "Benchmark spreads, execution speeds, regulation, and deposit methods across top tier-1 brokers." },
            { target: "[data-guide='stats']", title: "Comparison table", body: "Compare brokers side-by-side across spread, commission, regulation, platform, and min deposit." },
            { target: "[data-guide='content']", title: "Filter & sort", body: "Use filters to narrow by regulation tier, platform type, or minimum deposit requirement." },
        ],
    },

    // ── Trade Journal ──
    {
        key: "trade-journal",
        pageTitle: "Trade Journal",
        match: exactOrPrefix("/trade-journal"),
        steps: [
            { target: "[data-guide='page-header']", title: "Automated Trade Journal", body: "The journal automatically records every trade with entry, exit, P/L and chart snapshots." },
            { target: "[data-guide='stats']", title: "Trade Notes & Review", body: "Write strategy notes, write lessons learned, and filter performance patterns over time." },
            { target: "[data-guide='content']", title: "Journal entries", body: "Each entry shows the full trade lifecycle — entry time, exit time, P/L, and any notes you added." },
        ],
    },

    // ── Risk Management ──
    {
        key: "risk",
        pageTitle: "Risk Management",
        match: exactOrPrefix("/risk"),
        steps: [
            { target: "[data-guide='page-header']", title: "Risk & Exposure Overview", body: "Total open risk, margin usage, and drawdown across all your connected trading accounts." },
            { target: "[data-guide='stats']", title: "Risk Thresholds & Limits", body: "Set limits for maximum trade risk, daily loss limits, and receive instant alert notifications." },
            { target: "[data-guide='content']", title: "Exposure breakdown", body: "See risk distribution by currency pair, asset class, and direction (long vs short)." },
        ],
    },

    // ── AI Copilot ──
    {
        key: "ai-copilot",
        pageTitle: "AI Copilot",
        match: (p) => p === "/ai-copilot",
        steps: [
            { target: "[data-guide='page-header']", title: "AI Trading Copilot", body: "Ask your AI copilot about market conditions, strategy setups, and live account risk." },
            { target: "[data-guide='stats']", title: "Quick prompts", body: "Use preset prompts to instantly analyze market regime, check account exposure, or review open positions." },
            { target: "[data-guide='content']", title: "Chat interface", body: "Type any trading question — the AI analyzes your real account data and market conditions to respond." },
        ],
    },

    // ── Economic Calendar ──
    {
        key: "economic-calendar",
        pageTitle: "Economic Calendar",
        match: (p) => p === "/economic-calendar",
        steps: [
            { target: "[data-guide='page-header']", title: "Economic Event Calendar", body: "Track high-impact macroeconomic releases and plan around market-moving news events." },
            { target: "[data-guide='stats']", title: "Event impact levels", body: "Events are color-coded by impact — red (high), orange (medium), yellow (low) — to prioritize your attention." },
            { target: "[data-guide='content']", title: "Event details", body: "Click any event to see forecast vs previous values, historical data, and expected market reaction." },
        ],
    },

    // ── Analysis ──
    {
        key: "analysis",
        pageTitle: "Technical Analysis",
        match: exactOrPrefix("/analysis"),
        steps: [
            { target: "[data-guide='page-header']", title: "Automated Technical Analysis", body: "AI-driven multi-timeframe pattern recognition, trend channels, and key support/resistance levels." },
            { target: "[data-guide='stats']", title: "Pattern Detection Cards", body: "Explore detected chart patterns (Head & Shoulders, Flags, Wedges) with target projections." },
        ],
    },

    // ── Trade Replay ──
    {
        key: "trade-replay",
        pageTitle: "Trade Replay",
        match: exactOrPrefix("/trade-replay"),
        steps: [
            { target: "[data-guide='page-header']", title: "Bar-by-Bar Trade Simulator", body: "Replay historical trade setups bar-by-bar to test execution timing and psychological discipline." },
            { target: "[data-guide='stats']", title: "Playback Controls", body: "Adjust playback speed, pause at candle closes, and record simulated trade entries." },
        ],
    },

    // ── Monte Carlo ──
    {
        key: "monte-carlo",
        pageTitle: "Monte Carlo Simulator",
        match: exactOrPrefix("/monte-carlo"),
        steps: [
            { target: "[data-guide='page-header']", title: "Monte Carlo Stress Testing", body: "Simulate 1,000+ randomized sequence iterations to test portfolio ruin probabilities and max drawdowns." },
            { target: "[data-guide='stats']", title: "Confidence Bands & Distribution", body: "View 95% and 99% confidence bands for account equity under extreme market shock conditions." },
        ],
    },

    // ── Report Generator ──
    {
        key: "report-generator",
        pageTitle: "Report Generator",
        match: exactOrPrefix("/report-generator"),
        steps: [
            { target: "[data-guide='page-header']", title: "Institutional Report Generator", body: "Export publication-ready PDF performance statements with branded charts, trade logs, and verified metrics." },
            { target: "[data-guide='stats']", title: "Customization & Branding", body: "Select date ranges, include/exclude trade notes, and add proprietary logos to your reports." },
        ],
    },

    // ── Single-spotlight pages (enhanced to 2-3 steps) ──
    {
        key: "ai-historical",
        pageTitle: "Historical AI Scans",
        match: exactOrPrefix("/ai-historical"),
        steps: [
            { target: "[data-guide='page-header']", title: "Historical AI Signal Database", body: "Search and back-verify every signal generated by AlgoVault AI models over past market cycles." },
            { target: "[data-guide='stats']", title: "Search & filter", body: "Filter by symbol, date range, confidence level, and outcome to find specific signal types." },
            { target: "[data-guide='content']", title: "Signal verification", body: "Each historical signal shows entry, exit, actual result, and whether TP or SL was hit first." },
        ],
    },
    {
        key: "walk-forward",
        pageTitle: "Walk-Forward Matrix",
        match: exactOrPrefix("/walk-forward"),
        steps: [
            { target: "[data-guide='page-header']", title: "Walk-Forward Optimization", body: "Test strategy parameter stability across rolling in-sample and out-of-sample window iterations." },
            { target: "[data-guide='stats']", title: "Optimization windows", body: "Each row shows an in-sample training window and its corresponding out-of-sample validation result." },
            { target: "[data-guide='content']", title: "Robustness metrics", body: "Check parameter stability scores — consistent performance across windows indicates a robust strategy." },
        ],
    },
    {
        key: "social",
        pageTitle: "Trader Community",
        match: exactOrPrefix("/social"),
        steps: [
            { target: "[data-guide='page-header']", title: "Community Feed & Discussions", body: "Share verified trade setups, discuss Pine algorithms, and follow top-performing community members." },
            { target: "[data-guide='stats']", title: "Feed filters", body: "Filter posts by topic — strategies, signals, analysis, or general discussion." },
            { target: "[data-guide='content']", title: "Post & engage", body: "Create posts with chart screenshots, verified performance badges, and strategy links." },
        ],
    },
    {
        key: "execution-analytics",
        pageTitle: "Execution Analytics",
        match: exactOrPrefix("/execution-analytics"),
        steps: [
            { target: "[data-guide='page-header']", title: "Execution Speed & Slippage", body: "Measure latency, order execution delay, and price slippage per broker and order type." },
            { target: "[data-guide='stats']", title: "Latency metrics", body: "Average execution time, p95 latency, and slippage distribution are displayed for each broker." },
            { target: "[data-guide='content']", title: "Trade-by-trade log", body: "Each row shows the requested vs executed price, time to fill, and slippage in pips." },
        ],
    },
    {
        key: "correlation",
        pageTitle: "Asset Correlation",
        match: (p) => p === "/correlation" || p === "/tools/correlation",
        steps: [
            { target: "[data-guide='page-header']", title: "Cross-Asset Correlation Matrix", body: "Discover positive and inverse price correlations between forex pairs, gold, indices, and crypto." },
            { target: "[data-guide='stats']", title: "Correlation heatmap", body: "Green cells show positive correlation, red cells show inverse — use this for portfolio diversification." },
            { target: "[data-guide='content']", title: "Time period selector", body: "Switch between 1W, 1M, 3M, and 1Y windows to see how correlations change over different periods." },
        ],
    },
    {
        key: "signal-transparency",
        pageTitle: "Signal Audit",
        match: exactOrPrefix("/signal-transparency"),
        steps: [
            { target: "[data-guide='page-header']", title: "AI Model Transparency", body: "Immutable cryptographic audit trail for every AI signal recommendation issued." },
            { target: "[data-guide='stats']", title: "Audit log", body: "Each signal entry shows the hash, timestamp, model version, and input data used for the prediction." },
            { target: "[data-guide='content']", title: "Verify authenticity", body: "Click any entry to verify its cryptographic signature — proof the signal was generated before the market moved." },
        ],
    },
    {
        key: "strategy-compare",
        pageTitle: "Strategy Comparison",
        match: exactOrPrefix("/strategy-compare"),
        steps: [
            { target: "[data-guide='page-header']", title: "Side-by-Side Strategy Matrix", body: "Compare Sharpe ratio, max drawdown, win rate, and profit factor across multiple trading EAs." },
            { target: "[data-guide='stats']", title: "Comparison table", body: "Each column represents a strategy — sort by any metric to find the best performer." },
            { target: "[data-guide='content']", title: "Equity curve overlay", body: "Toggle equity curves on/off to visually compare growth trajectories of different strategies." },
        ],
    },
    {
        key: "news",
        pageTitle: "Market News",
        match: exactOrPrefix("/news"),
        steps: [
            { target: "[data-guide='page-header']", title: "Real-Time Market News", body: "Curated financial news feed with sentiment tags and market-impact indicators." },
            { target: "[data-guide='stats']", title: "Impact filtering", body: "Filter news by impact level, asset class, or source to focus on market-moving events." },
            { target: "[data-guide='content']", title: "Sentiment analysis", body: "Each article shows AI-generated sentiment score and which assets are most affected." },
        ],
    },
    {
        key: "insights",
        pageTitle: "Market Insights",
        match: exactOrPrefix("/insights"),
        steps: [
            { target: "[data-guide='page-header']", title: "AI Macro Insights", body: "Daily structural market briefs, central bank interest rate projections, and liquidity analysis." },
            { target: "[data-guide='stats']", title: "Insight categories", body: "Browse insights by category — Macro, Technical, Sentiment, or Liquidity analysis." },
            { target: "[data-guide='content']", title: "Daily briefing", body: "Each insight includes a summary, key data points, and actionable trading implications." },
        ],
    },
    {
        key: "goals",
        pageTitle: "Trading Goals",
        match: exactOrPrefix("/goals"),
        steps: [
            { target: "[data-guide='page-header']", title: "Target & Discipline Tracker", body: "Set monthly profit goals, maximum loss limits, and track discipline adherence stats over time." },
            { target: "[data-guide='stats']", title: "Active goals", body: "View your current goals with progress bars — see how close you are to hitting each target." },
            { target: "[data-guide='content']", title: "Goal history", body: "Review past goals, completion rates, and lessons learned from previous months." },
        ],
    },
    {
        key: "pricing",
        pageTitle: "Pricing",
        match: exactOrPrefix("/pricing"),
        steps: [
            { target: "[data-guide='page-header']", title: "AlgoVault Membership", body: "Choose the ideal tier for your trading journey — Free, Pro, or Institutional." },
            { target: "[data-guide='stats']", title: "Plan features", body: "Each plan shows exactly what's included — AI signals, copy trading, strategy lab, and support level." },
            { target: "[data-guide='content']", title: "FAQ section", body: "Scroll down for answers to common questions about billing, refunds, and plan upgrades." },
        ],
    },
    {
        key: "affiliates",
        pageTitle: "Affiliate Program",
        match: (p) => p === "/affiliates" || p === "/account/affiliate",
        steps: [
            { target: "[data-guide='page-header']", title: "Earn With AlgoVault", body: "Share your referral link and earn up to 15% commission on every purchase made by referred traders." },
            { target: "[data-guide='stats']", title: "Your referral stats", body: "Track link clicks, new signups, and total commission earned from your referral dashboard." },
            { target: "[data-guide='content']", title: "Share your link", body: "Copy your unique referral link and share it on Telegram, Twitter, or with your trading community." },
        ],
    },
    {
        key: "donate",
        pageTitle: "Support AlgoVault",
        match: exactOrPrefix("/donate"),
        steps: [
            { target: "[data-guide='page-header']", title: "Support Development", body: "Contribute to the open-source trading algorithm ecosystem and community tools." },
            { target: "[data-guide='stats']", title: "Donation options", body: "Choose a one-time or recurring contribution amount to support ongoing platform development." },
        ],
    },
    {
        key: "verified-performance",
        pageTitle: "Verified Records",
        match: exactOrPrefix("/verified-performance"),
        steps: [
            { target: "[data-guide='page-header']", title: "Cryptographic Performance Verification", body: "Publicly verified account track records signed directly by MetaTrader gateway instances." },
            { target: "[data-guide='stats']", title: "Verification badges", body: "Each account shows a cryptographic proof badge — click to verify the signature independently." },
            { target: "[data-guide='content']", title: "Performance timeline", body: "View the full performance history with equity curves, monthly returns, and drawdown periods." },
        ],
    },
    {
        key: "spreads",
        pageTitle: "Live Spreads",
        match: exactOrPrefix("/spreads"),
        steps: [
            { target: "[data-guide='page-header']", title: "Real-Time Broker Spreads", body: "Live streaming spread comparison table across major FX & commodity instruments." },
            { target: "[data-guide='stats']", title: "Spread table", body: "Each row shows the current spread for a pair across your connected brokers — sort to find the tightest." },
            { target: "[data-guide='content']", title: "Spread history", body: "Click any cell to see the spread history over the last 24 hours — identify when spreads widen." },
        ],
    },
    {
        key: "statement",
        pageTitle: "Account Statement",
        match: exactOrPrefix("/statement"),
        steps: [
            { target: "[data-guide='page-header']", title: "Official Trading Statement", body: "Detailed breakdown of deposits, withdrawals, realized profit, closed trades, and broker fees." },
            { target: "[data-guide='stats']", title: "Statement summary", body: "Total deposits, withdrawals, net profit, and broker fees are summarized at the top." },
            { target: "[data-guide='content']", title: "Trade list", body: "Each closed trade shows entry/exit prices, duration, P/L, and any swap or commission charged." },
        ],
    },
    {
        key: "tags",
        pageTitle: "Strategy Tags",
        match: exactOrPrefix("/tags"),
        steps: [
            { target: "[data-guide='page-header']", title: "Strategy Tag Directory", body: "Filter market tools and EAs by strategy methodology: Scalping, Trend, Grid, Martingale, Arbitrage." },
            { target: "[data-guide='stats']", title: "Tag cloud", body: "Click any tag to see all strategies using that methodology — the most popular tags appear largest." },
            { target: "[data-guide='content']", title: "Strategy cards", body: "Each card shows the strategy name, tag, performance stats, and a link to the full marketplace listing." },
        ],
    },

    // ── Admin Pages ──
    {
        key: "admin-dashboard",
        pageTitle: "Admin Dashboard",
        match: (p) => p === "/admin",
        steps: [
            { target: "[data-guide='page-header']", title: "Admin Command Centre", body: "Overview of platform health — active users, revenue, orders, and system alerts at a glance." },
            { target: "[data-guide='stats']", title: "Key metrics", body: "Total users, active subscriptions, MRR, and pending orders are displayed in the stat cards." },
            { target: "[data-guide='content']", title: "Recent activity", body: "The activity feed shows latest registrations, purchases, license activations, and support tickets." },
        ],
    },
    {
        key: "admin-bots",
        pageTitle: "Manage Bots",
        match: (p) => p === "/admin/bots",
        steps: [
            { target: "[data-guide='page-header']", title: "Bot Management", body: "Create, edit, and manage all marketplace products — Expert Advisors, indicators, and set files." },
            { target: "[data-guide='stats']", title: "Product list", body: "Every product is listed with name, platform, price, active licenses, and last updated date." },
            { target: "[data-guide='content']", title: "Create new product", body: "Click 'New Bot' to add a product — fill in name, description, pricing, files, and version history." },
        ],
    },
    {
        key: "admin-live",
        pageTitle: "Live Accounts",
        match: (p) => p === "/admin/live",
        steps: [
            { target: "[data-guide='page-header']", title: "Live Account Monitor", body: "Monitor all customer-connected MT5 accounts — balances, equity, and gateway connection status." },
            { target: "[data-guide='stats']", title: "Account list", body: "Each row shows the account number, broker, balance, equity, and whether the gateway is online." },
            { target: "[data-guide='content']", title: "Account details", body: "Click any account to see full trade history, equity curve, and connection diagnostics." },
        ],
    },
    {
        key: "admin-backtests",
        pageTitle: "Manage Backtests",
        match: (p) => p === "/admin/backtests",
        steps: [
            { target: "[data-guide='page-header']", title: "Backtest Management", body: "Review and manage all backtest results uploaded by developers and generated by the platform." },
            { target: "[data-guide='stats']", title: "Backtest list", body: "Each entry shows the strategy name, symbol, timeframe, return %, and max drawdown." },
            { target: "[data-guide='content']", title: "Backtest details", body: "Click any entry to view the full MT5 Strategy Tester report, equity curve, and trade log." },
        ],
    },
    {
        key: "admin-orders",
        pageTitle: "Order Management",
        match: (p) => p === "/admin/orders",
        steps: [
            { target: "[data-guide='page-header']", title: "Order Queue", body: "View and manage all customer orders — subscriptions, one-time purchases, and license activations." },
            { target: "[data-guide='stats']", title: "Order list", body: "Each order shows customer email, product, amount, status (pending/completed/failed), and date." },
            { target: "[data-guide='content']", title: "Order actions", body: "Click any order to see full payment details, refund options, and license generation status." },
        ],
    },
    {
        key: "admin-licenses",
        pageTitle: "License Management",
        match: (p) => p === "/admin/licenses",
        steps: [
            { target: "[data-guide='page-header']", title: "License Administration", body: "Manage all product licenses — view, generate, revoke, or transfer licenses for any customer." },
            { target: "[data-guide='stats']", title: "License list", body: "Each license shows the key, customer email, product, expiry date, and linked MT5 account." },
            { target: "[data-guide='content']", title: "Generate license", body: "Click 'Generate Manual License' to create a license for a customer without requiring payment." },
        ],
    },
    {
        key: "admin-users",
        pageTitle: "User Management",
        match: (p) => p === "/admin/users",
        steps: [
            { target: "[data-guide='page-header']", title: "User Directory", body: "Browse and manage all registered users — view profiles, roles, subscriptions, and activity." },
            { target: "[data-guide='stats']", title: "User list", body: "Each row shows name, email, role, registration date, and subscription status." },
            { target: "[data-guide='content']", title: "User actions", body: "Click any user to view full profile, order history, licenses, and perform admin actions." },
        ],
    },
    {
        key: "admin-settings",
        pageTitle: "Admin Settings",
        match: (p) => p === "/admin/settings",
        steps: [
            { target: "[data-guide='page-header']", title: "Platform Settings", body: "Configure site name, tagline, support email, features, and platform-wide defaults." },
            { target: "[data-guide='stats']", title: "Settings sections", body: "Settings are grouped — General, Features, Notifications, Security, and API keys." },
            { target: "[data-guide='content']", title: "Save changes", body: "Click Save after making changes — settings take effect immediately across the platform." },
        ],
    },
    {
        key: "admin-copy-trading",
        pageTitle: "Copy Trading Admin",
        match: (p) => p === "/admin/copy-trading",
        steps: [
            { target: "[data-guide='page-header']", title: "Copy Trading Management", body: "Manage master accounts, follower configurations, and copy trading rules across the platform." },
            { target: "[data-guide='stats']", title: "Master accounts", body: "View all master accounts with their total followers, AUM, and performance stats." },
            { target: "[data-guide='content']", title: "Follower configs", body: "Review follower configurations — lot sizing rules, risk limits, and copy ratios." },
        ],
    },
    {
        key: "admin-signals",
        pageTitle: "AI Signals Admin",
        match: (p) => p === "/admin/signals",
        steps: [
            { target: "[data-guide='page-header']", title: "Signal Management", body: "Review all AI-generated signals — performance, accuracy, and model version tracking." },
            { target: "[data-guide='stats']", title: "Signal list", body: "Each signal shows asset, direction, confidence, entry price, outcome, and generated at timestamp." },
            { target: "[data-guide='content']", title: "Performance analytics", body: "View aggregate win rates, average return per signal, and model accuracy over time." },
        ],
    },
    {
        key: "admin-affiliates",
        pageTitle: "Affiliate Offers",
        match: (p) => p === "/admin/affiliates",
        steps: [
            { target: "[data-guide='page-header']", title: "Affiliate Offer Management", body: "Create and manage external affiliate offers — broker partnerships, tool integrations, and commission structures." },
            { target: "[data-guide='stats']", title: "Offer list", body: "Each offer shows name, provider, category, commission type, status, and click count." },
            { target: "[data-guide='content']", title: "Create offer", body: "Click 'New Offer' to add a partner — fill in name, URL, commission type, and upload branding." },
        ],
    },
    {
        key: "admin-reviews",
        pageTitle: "Review Management",
        match: (p) => p === "/admin/reviews",
        steps: [
            { target: "[data-guide='page-header']", title: "Product Reviews", body: "Moderate and manage all customer reviews across marketplace products." },
            { target: "[data-guide='stats']", title: "Review list", body: "Each review shows the product, reviewer, rating, text, and moderation status." },
            { target: "[data-guide='content']", title: "Moderation actions", body: "Approve, reject, or flag reviews. Respond to customer feedback directly from the admin panel." },
        ],
    },
    {
        key: "admin-tradingview",
        pageTitle: "TradingView Admin",
        match: (p) => p === "/admin/tradingview",
        // Inherits studio guide — already matched by the "studio" entry
        steps: [],
    },
    {
        key: "admin-setfiles",
        pageTitle: "Set Files Admin",
        match: (p) => p === "/admin/setfiles",
        steps: [
            { target: "[data-guide='page-header']", title: "Set File Management", body: "Upload, organize, and manage EA parameter preset files for marketplace products." },
            { target: "[data-guide='stats']", title: "File list", body: "Each file shows name, associated product, symbol, risk profile, and download count." },
            { target: "[data-guide='content']", title: "Upload set file", body: "Click 'Upload' to add a new .set file — associate it with a product and tag the currency pair." },
        ],
    },
    {
        key: "admin-trading-accounts",
        pageTitle: "Trading Accounts",
        match: (p) => p === "/admin/trading-accounts",
        steps: [
            { target: "[data-guide='page-header']", title: "Trading Account Overview", body: "View all customer trading accounts connected through the MT5 Gateway." },
            { target: "[data-guide='stats']", title: "Account list", body: "Each account shows broker, server, account number, owner, balance, and connection status." },
            { target: "[data-guide='content']", title: "Connection diagnostics", body: "Click any account to check gateway connectivity, last heartbeat, and data flow health." },
        ],
    },
    {
        key: "admin-trading-licenses",
        pageTitle: "Trading Licenses",
        match: (p) => p === "/admin/trading-licenses",
        steps: [
            { target: "[data-guide='page-header']", title: "Trading License Management", body: "Manage product licenses linked to trading accounts — activate, deactivate, or transfer." },
            { target: "[data-guide='stats']", title: "License list", body: "Each license shows product name, customer, MT5 account, expiry, and activation status." },
            { target: "[data-guide='content']", title: "License actions", body: "Extend expiry, change linked account, or revoke license from the action menu." },
        ],
    },
    {
        key: "admin-developers",
        pageTitle: "Developer Management",
        match: (p) => p === "/admin/developers",
        steps: [
            { target: "[data-guide='page-header']", title: "Developer Portal", body: "Manage developer accounts, API keys, and product submissions." },
            { target: "[data-guide='stats']", title: "Developer list", body: "Each developer shows name, email, submitted products, and approval status." },
            { target: "[data-guide='content']", title: "Product review", body: "Review pending product submissions — check files, test backtests, and approve or reject." },
        ],
    },
    {
        key: "admin-whitelabel",
        pageTitle: "Whitelabel Settings",
        match: (p) => p === "/admin/whitelabel",
        steps: [
            { target: "[data-guide='page-header']", title: "Whitelabel Configuration", body: "Customize branding, domain, logos, colors, and contact info for white-label deployments." },
            { target: "[data-guide='stats']", title: "Branding settings", body: "Upload custom logo, set primary/accent colors, configure site name and tagline." },
            { target: "[data-guide='content']", title: "Preview & save", body: "Preview changes before saving — the preview shows how the platform will look with your branding." },
        ],
    },
];

export function findGuide(pathname: string): GuideConfig | undefined {
    return GUIDES.find((guide) => guide.steps.length > 0 && guide.match(pathname));
}
