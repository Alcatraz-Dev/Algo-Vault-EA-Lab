# AlgoVault Pro Signal Intelligence — Telegram Channel Setup & Notification Guide

This guide explains how to integrate Telegram channels into **AlgoVault Pro Signal Intelligence**, how signal parsing works, and how Pro users receive real-time push notifications via Telegram Bot and Discord Bot—even when they are offline or not currently using the platform.

---

## Architecture Overview

```
┌──────────────────────────────┐
│  Telegram Signal Channels    │
│ (Private / Public VIP Group) │
└──────────────┬───────────────┘
               │ (Listener / Webhook Ingestion)
               ▼
┌──────────────────────────────┐
│ AlgoVault Ingestion Webhook  │
│ /api/telegram-signals/webhook│
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Multilingual Signal Engine   │
│ - Fast Dictionary Parser     │
│ - SHA256 Fingerprint Dedupe  │
│ - Signal Normalizer          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Firebase RTDB / Pro Signals  │
└──────────────┬───────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────┐
│      Background Push Notification Dispatcher           │
├──────────────────────────────┬─────────────────────────┤
│ Telegram Bot API             │ Discord Webhook         │
│ (Pushes directly to user phone│ (Delivers to user server│
│  or chat app while offline)  │  or direct channel)     │
└──────────────────────────────┴─────────────────────────┘
```

> **Privacy & Branding Rule**:
> Signals are stored and displayed to subscribers under the **AlgoVault Signal** brand. Source channel details are preserved strictly for internal admin audits (`channelQuality`, `sourceMetadata`).

---

## 1. Setting Up Signal Ingestion from Telegram Channels

You can connect Telegram channels using three supported methods depending on your access level:

### Method A: Automated MTProto Userbot Listener (Recommended for Private & VIP Channels)

If you are a member of a private Telegram VIP channel, use a lightweight listener script (Python `Pyrogram`/`Telethon` or Node.js `GramJS`) to automatically stream incoming messages to AlgoVault.

#### Python Listener Example (`pyrogram_listener.py`):

```python
import os
import requests
from pyrogram import Client, filters

# Telegram API credentials from https://my.telegram.org
API_ID = 1234567 # Your Telegram API ID
API_HASH = "your_telegram_api_hash"
TARGET_CHANNEL_ID = -1001234567890 # Telegram Channel ID (e.g. -100...)

# AlgoVault Server Ingestion Endpoint
ALGOVAULT_URL = "https://your-domain.com/api/telegram-signals/webhook"
INGESTION_SECRET = "your_telegram_ingestion_secret"

app = Client("algovault_userbot", api_id=API_ID, api_hash=API_HASH)

@app.on_message(filters.chat(TARGET_CHANNEL_ID))
def handle_new_signal(client, message):
    if not message.text:
        return
    
    payload = {
        "userId": "system",
        "rawText": message.text,
        "channelId": str(message.chat.id),
        "channelName": message.chat.title or "VIP Signal Channel",
        "messageId": str(message.id),
        "replyToMessageId": str(message.reply_to_message_id) if message.reply_to_message_id else None
    }
    
    headers = {
        "Authorization": f"Bearer {INGESTION_SECRET}",
        "Content-Type": "application/json"
    }
    
    try:
        res = requests.post(ALGOVAULT_URL, json=payload, headers=headers, timeout=5)
        print(f"[AlgoVault Signal Ingested] Status: {res.status_code}, Response: {res.json()}")
    except Exception as e:
        print(f"[Ingestion Error]: {e}")

if __name__ == "__main__":
    app.run()
```

---

### Method B: Telegram Bot Webhook (For Channels You Manage)

If you own or manage the Telegram channel:

1. **Create a Telegram Bot**:
   - Talk to [@BotFather](https://t.me/BotFather) on Telegram.
   - Run `/newbot`, name your bot, and copy the **HTTP API Bot Token** (e.g., `7890123456:AA...`).

2. **Add Bot as Administrator**:
   - Add your bot as an Administrator to your channel with **Read Messages** permissions.

3. **Set Up Telegram Webhook**:
   - Call the Telegram Webhook API to forward updates directly to AlgoVault:
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-domain.com/api/telegram-signals/webhook?secret=<YOUR_INGESTION_SECRET>"
   ```

---

### Method C: Manual & Admin Panel Signal Injection

You can also submit signals directly via the API or Admin Panel:

- Endpoint: `POST /api/pro-signals`
- Headers: `Authorization: Bearer <FIREBASE_ID_TOKEN>`
- Body:
```json
{
  "rawText": "BUY EURUSD @ 1.0850 SL 1.0800 TP1 1.0900 TP2 1.0950",
  "sourceMetadata": {
    "sourceId": "admin_portal",
    "sourceType": "telegram_channel",
    "channelName": "AlgoVault Official Signals"
  }
}
```

---

## 2. Environment Variables Configuration

In your `.env.local` or production environment variables, configure the following keys:

```env
# Telegram Bot Token for sending push notifications to users
TELEGRAM_BOT_TOKEN="7890123456:AA..."

# Ingestion Secret for securing the /api/telegram-signals/webhook endpoint
TELEGRAM_INGESTION_SECRET="your_secure_ingestion_secret_here"

# Server Fallback Discord Webhook (optional)
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."

# Public Application URL
NEXT_PUBLIC_APP_URL="https://your-domain.com"
```

---

## 3. How Pro Offline Push Notifications Work

When a new signal is ingested into AlgoVault:

1. **Entitlement Check**:
   AlgoVault verifies active **Pro** or **Enterprise** subscription status.

2. **Connected Account Detection**:
   The background notification engine checks if the user has connected their Telegram or Discord account in **Account Settings** (`/account/settings?tab=notifications`):
   - **Telegram**: User connects via `@telegramUsername` or numeric `telegramChatId`.
   - **Discord**: User connects via Discord Webhook or server integration.

3. **Push Delivery**:
   Even if the user **is not currently open on the platform**, the system dispatches:
   - **Telegram Push Message**: Delivered directly to the user's mobile/desktop Telegram app via `@BotFather` bot.
   - **Discord Push Message**: Delivered directly to the user's connected Discord channel/DM.

---

## 4. Testing & Verification

### Test Webhook Signal Ingestion

Run this `curl` command to test parsing and push delivery:

```bash
curl -X POST "http://localhost:3000/api/telegram-signals/webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer default_ingest_secret" \
  -d '{
    "userId": "system",
    "rawText": "BUY XAUUSD @ 2030 - 2032 SL 2015 TP1 2040 TP2 2050 TP3 OPEN",
    "channelName": "VIP Gold Signals"
  }'
```

### Run Full Pro Signal Test Suite

Run the unit test runner to verify 100% test coverage across fast parsing, multilingual dictionary matching, duplicate fingerprinting, and break-even lifecycle transitions:

```bash
npx tsx features/telegram-signals/tests/run-tests.ts
```
