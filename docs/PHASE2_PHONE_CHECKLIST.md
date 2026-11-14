# CS2 Phase 2 — Phone checklist (all 4 accounts)

Prepared 2026-11-14 (Sat morning IST). Updated 2026-11-14 ~11:00 IST:
Cloudflare Free account CREATED under musepuchuku@gmail.com via Google
sign-in — the human-check box never blocked it this time; Free plan only,
no payment method, no paid plan. Dashboard open. (Main chat, 2026-11-14
05:29 UTC.) Remaining: Cito, Telegram, GitHub — see below.
Nothing is deployed or live yet. Phase 1 audit, schema, Worker skeleton and
dashboard are built and tested locally (see docs/PHASE1_AUDIT.md).

Budget guardrails for every step: Free plans only, no card, no payment method,
no paid plan. Target is $0/month; Bosco's $50–$100 is a ceiling, not approval
to spend. Never paste an API key or bot token in chat — secure entry only.

Do the steps in this order; tell Jaffa "done" after each one.

## 1. Cloudflare Free — DONE 2026-11-14 ~11:00 IST
- Free account created under musepuchuku@gmail.com via Google sign-in.
  Free plan only, no payment method, no paid plan. Dashboard open.
- (Yesterday's blocker — the "Verify you are human" checkbox — did not
  block it this time.)

## 2. Cito Free (phone browser) — NEXT
- Go to citoapi.com/signup and create a Free account — $0/month, 500 calls
  per 30 days, no card.
- Copy the API key somewhere safe; do NOT paste it in chat. Jaffa will ask
  for it through secure entry, then verify it with exactly 1 test call.
- Note: on Free, odds/player props are Pro+ only, so any odds shown later
  are model-only fair odds, labelled as such.

## 3. Telegram bot (phone, ~2 minutes)
- Open Telegram, search @BotFather, send /newbot, give it a name and a
  username ending in `bot`.
- Keep the token private (same as the Cito key — secure entry only).
- Open your new bot and tap Start / send it a hello, so it is allowed to
  message you. Tell Jaffa the bot's name.

## 4. GitHub (in the Muse chat)
- Authorise the GitHub connector via the connect link already sent, then
  choose which repos Jaffa can access. A private repo is recommended.

## What happens after
- Jaffa checks the GitHub connection, verifies the Cito key with 1 test call,
  sends the first Telegram test message, and only then deploys the Worker +
  D1 skeleton — Cloudflare Free is now confirmed, so deployment is unblocked
  once Cito/Telegram/GitHub are in.

## If you'd rather not do it on your phone
- Say "retry" and Jaffa will retry the Cito and Cloudflare signups fresh in
  the browser. Known risk: the Cloudflare human-verification checkbox
  blocked the assistant's browser 5 times yesterday, so a retry may stall
  at the same step and need your click anyway.
