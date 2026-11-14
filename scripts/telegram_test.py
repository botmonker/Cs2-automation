"""Telegram test — sends ONE private message. No message without token+chat_id.
Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... python3 scripts/telegram_test.py
Bot cannot message a user who has not started it — Bosco must /start the bot first.
"""
import os, sys, requests
tok = os.environ.get("TELEGRAM_BOT_TOKEN")
chat = os.environ.get("TELEGRAM_CHAT_ID")
if not tok or not chat:
    print("NO TOKEN/CHAT_ID: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. No message sent.")
    sys.exit(2)
r = requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                  json={"chat_id": chat, "text": "CS2 Zero-Budget test ✅\nBot is connected. No odds on Free — model-only forecasts only.\nResearch only, no wager placed."}, timeout=15)
print(r.status_code, r.text[:300])
sys.exit(0 if r.status_code == 200 else 1)
