# Copy Trading Technical Specification

## 1. Product Scope

Copy Trading lets a follower account mirror trades from an eligible master MT5 account inside the AlgoVault master account ecosystem. The feature supports one master account copied by many follower accounts, and one follower user subscribing to multiple masters or multiple follower account configurations.

Primary surfaces:

- Master trader dashboard: `/account/copy-trading` or a master tab in `/copy-trading`.
- Follower discovery and management: `/copy-trading`.
- Admin oversight: `/admin/copy-trading` and `/admin/settings`.
- APIs: `/api/copy-trading/marketplace`, `/api/copy-trading/config`, `/api/admin/copy-trading`, `/api/performance/heartbeat`, `/api/performance/trade`.

## 2. Data Model

### Firebase Paths

- `settings/copyTradingEnabled`
  Global platform switch. `false` disables discovery, config creation, and new fan-out.

- `live_accounts/{accountId}`
  Master-capable account record created by EA heartbeats. Includes `ownerUid`, `productId`, `productName`, `mt5Account`, `broker`, `server`, `balance`, `equity`, `floatingProfit`, `lastHeartbeatAt`, `allowCopyTrading`, `stats`, and optional `copyTradingOverride`.

- `users/{uid}/copyTradingOverride`
  User-level participation controls:
  `isFollowingDisabled`, `isBeingCopiedDisabled`.

- `live_accounts/{accountId}/copyTradingOverride`
  Admin/account-level master controls:
  `allowBeCopied`, `allowBeFollowed`, `isFollowingDisabled`, `isBeingCopiedDisabled`, `canBeListed`.

- `copy_trading/{followerUid}/{configId}`
  Follower subscription config:
  `masterId`, `masterMt5Account`, `followerMt5Account`, `licenseKey`, `isActive`, `lotMultiplier`, `maxLot`, `maxOpenTrades`, `reverseSignals`, `copyStopLoss`, `copyTakeProfit`, `totalCopied`, `totalProfit`, `createdAt`, `updatedAt`.

- `mt5_orders/{mt5Account}/{ticket}`
  Pending execution queue polled by the EA. Copy-trading generated orders use `source: "copy_follower"` and carry `masterTicket`, `copyConfigId`, `masterMt5Account`, `followerMt5Account`.

- `copied_trades/{followerUid}/{ticket}`
  Ledger for copied positions and realized performance.

## 3. Core Logic And Connectivity

### Account Linking

1. A master account becomes known when its EA posts a valid heartbeat to `/api/performance/heartbeat`.
2. The heartbeat validates product, license, MT5 account, and then writes `live_accounts/{productId}_{mt5Account}`.
3. A follower creates a subscription through `/api/copy-trading/config`.
4. The config links one `followerMt5Account` to one `masterId` and stores follower-side risk rules.
5. The system verifies the master exists and the global switch is enabled before creating a config.

### Eligibility Resolution

Master eligibility is resolved in this order:

1. Global setting: `settings/copyTradingEnabled`.
2. Account override: `live_accounts/{accountId}/copyTradingOverride`.
3. User override: `users/{ownerUid}/copyTradingOverride`.
4. Master opt-in flag: `live_accounts/{accountId}/allowCopyTrading`.

A master is listed only when the global switch is enabled, the account is recently online, `allowCopyTrading` is not false, the master is not blocked from being copied, following is allowed, and `canBeListed` is not false.

### Real-Time Trade Synchronization

The EA uses a polling-style realtime bridge:

1. Master EA posts open/close trade events to `/api/performance/trade`.
2. On a new master trade, `bridgeMasterOpen` calls `collectMatchingConfigs(masterId, mt5Account)`.
3. For each active follower config, `mirrorMasterOrder` creates a pending follower order in `mt5_orders/{followerMt5Account}/{newTicket}`.
4. Follower EAs receive pending orders on heartbeat and execute them in MT5.
5. When follower execution acknowledges a real MT5 ticket, the system attaches that ticket to `copied_trades`.
6. When the master closes, `mirrorMasterClose` queues close orders for matching open follower ledger entries.
7. When follower close events arrive, `reconcileCopiedClose` settles the copied trade ledger and updates config-level P/L.

### Execution Rules

Each copied order applies follower config controls:

- Dedupe by `masterTicket` and `source`.
- Enforce `maxOpenTrades` per config.
- Calculate volume as `masterVolume * lotMultiplier`.
- Cap volume by `maxLot`.
- Round to 0.01 lots with a minimum of 0.01.
- Flip BUY/SELL when `reverseSignals` is true.
- Copy or suppress SL/TP using `copyStopLoss` and `copyTakeProfit`.
- Prevent copy-of-copy recursion by ignoring trades already identified as `copy_follower`.

## 4. User Functionality And Toggles

### Master Toggle

Control: `Allow Copy Trading`.

State path: `live_accounts/{accountId}/allowCopyTrading`.

Behavior:

- On: account may be copied if all admin/global eligibility rules also pass.
- Off: account is removed from marketplace discovery, new fan-out is blocked, and existing follower configs remain visible but receive no new master signals.
- UI must show effective status: `Listed`, `Opted out`, `Admin restricted`, `Offline`, or `Platform disabled`.

### Follower Controls

Followers can:

- Start copying an eligible master.
- Pause/resume a subscription via `isActive`.
- Remove a subscription.
- Tune lot multiplier, max lot, max open trades, signal reversal, SL copying, and TP copying.
- Opt out of following entirely using `users/{uid}/copyTradingOverride/isFollowingDisabled`.

### User Opt-Out From Being Copied

Users can disable being copied through `users/{uid}/copyTradingOverride/isBeingCopiedDisabled`. This removes their account from discovery and prevents new trade fan-out from their master account.

## 5. UI/UX Framework

### Master Trader Dashboard

Entry: Account area.

Primary sections:

- Status header: effective marketplace state, online/offline heartbeat, global feature state.
- `Allow Copy Trading` toggle: immediate save, optimistic UI, clear disabled state when admin/global restrictions apply.
- Follower summary: active followers, paused followers, total copied trades, copied volume, follower P/L, last copied signal.
- Performance metrics: balance, equity, floating P/L, win rate, profit factor, total trades, drawdown, follower count trend.
- Follower table: follower MT5 account, config status, lot rules, copied trades, P/L, last activity.
- Audit timeline: opt-in changes, admin overrides, trade fan-out failures, Discord/Telegram notification results.

Key states:

- Empty: no followers yet, account can still be listed.
- Restricted: show who/what restricted the account without exposing internal admin notes.
- Offline: explain that marketplace listing requires recent heartbeat.
- Disabled globally: show read-only controls and direct users to support/admin.

### Follower Discovery

Entry: `/copy-trading`.

Primary sections:

- Search and filters: strategy/product, broker, online only, min followers, win rate, drawdown, profit factor.
- Master cards/table: product name, MT5 account, broker/server, online badge, follower count, total trades, total profit, drawdown, win rate, profit factor.
- Detail drawer: equity curve, monthly returns, trade distribution, recent trades, risk badges, copied-trade disclaimer.
- Start-copy flow:
  1. Select master.
  2. Pick follower MT5 account/license.
  3. Configure risk rules.
  4. Review expected behavior and risk warning.
  5. Confirm subscription.

Management view:

- Active subscriptions list.
- Pause/resume and remove actions.
- Edit risk settings.
- Copied trade history with open/closed status and realized P/L.
- Alert channel status with Discord and Telegram delivery audit.

## 6. Administrative Control Panel

Entry: `/admin/copy-trading`.

Admin capabilities:

- Toggle `settings/copyTradingEnabled`.
- Override a user's ability to follow.
- Override a user's/account's ability to be followed.
- Hide a master from marketplace with `canBeListed: false`.
- Pause or delete follower configs.
- Monitor active, paused, and failed connections.
- View live account heartbeat health.
- Inspect copied trade counts, open copied positions, realized follower P/L, fan-out latency, failed delivery count, and Discord/Telegram notification status.

Recommended admin layout:

- Top switch: global feature enabled/disabled.
- Metrics strip: total configs, active configs, active masters, active followers, copied trades today, failed copies today, average fan-out time.
- Live accounts table: account, owner, online state, allow toggle, override badges, followers, last heartbeat.
- Connections table: follower, master, config status, risk settings, copied trades, P/L, last activity, admin actions.
- System health panel: heartbeat freshness, order queue depth, pending MT5 executions, failed webhook notifications.

## 7. Permissions And Safety

Permission rules:

- Only authenticated users can create, edit, pause, or remove their own configs.
- Admins can read and mutate all configs.
- Master opt-in belongs to the master account owner unless admin override blocks it.
- Follower configs cannot be created when global copy trading is disabled or user following is disabled.
- Masters cannot be listed when globally disabled, opted out, admin hidden, blocked from being copied, or offline.

Safety requirements:

- Every copied order must be idempotent by master ticket and config.
- No copy-of-copy recursion.
- Existing configs should not be deleted by admin/user opt-out; they should stop receiving new signals or become paused.
- All fan-out and close events should write audit records.
- Notification delivery must return and store channel-level status.
- Discord uses a user webhook when present, otherwise server fallback `DISCORD_WEBHOOK_URL` or `DISCROD_WEBHOOK_URL`.

## 8. Acceptance Criteria

- A master can enable and disable `Allow Copy Trading`.
- Eligible online masters appear in marketplace; ineligible masters do not.
- A follower can create, pause, resume, edit, and remove a copy config.
- New master open trades create pending follower MT5 orders across all active configs.
- Master close events queue follower close orders.
- Dedupe prevents repeated master events from creating duplicate follower orders.
- Admins can globally disable the feature and override any user's follow/be-followed permissions.
- The settings page can send a test Discord notification and report whether it used a personal or server webhook.
