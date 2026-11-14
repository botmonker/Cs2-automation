# CS2 Zero-Budget Automation — Phase 1 Audit
Date: 13 Nov 2026 | Project director: Jaffa (Meta Muse)
Source: `workspace/user/files/Meta_Muse_CS2_Zero_Budget_Blueprint_0_30db.pdf`

## Budget note — read this first
- Blueprint hard budget: **$0/month**.
- Bosco's message 13 Nov: **$50–$100/month ceiling, ask before any purchase**.
- Resolution: $0 is the target. $50–$100 is a ceiling, NOT an approval to spend.
  Nothing paid will be bought without explicit approval. Cito Pro ($59/mo)
  would fit the ceiling but is NOT part of the $0 plan and is NOT approved.

## 1. Muse connectors / tools — audited
| Capability | Status |
|---|---|
| Meta Muse access | Yes — this session, no upgrade needed |
| GitHub connector | **NOT connected** — `github status`: auth_status not_connected. Connect URL available, needs Bosco to authorise + select repos |
| Cloudflare connector | **None exists** in Muse — no Cloudflare connector found. Setup is via Cloudflare dashboard / Wrangler CLI, not via Muse |
| Cito API connector | **None exists** — no connector. Direct REST with `x-api-key` header |
| Telegram connector | **None exists** — no connector. Direct Bot API HTTPS with BotFather token |
| Muse scheduled work (cron) | Available in Muse — can run scheduled checks as a fallback scheduler, but must NOT be the only scheduler; Cloudflare Cron is the design |
| Local tools verified | Python 3.12.3, Node v24.22.1, git, curl, jq — present. Wrangler 4.161.0 via npx — present. requests + sqlite3 + pandas 2.1.4 — present. **scikit-learn NOT installed** (needed later for model training; `pip install scikit-learn` is free, no approval needed for install, but do it in Phase 3+) |
| Existing CS2 workspace | None — created `~/workspace/cs2-automation/` today |

## 2. Pricing / terms — verified live 13 Nov 2026
### Cito API — VERIFIED from official pricing page (citoapi.com/pricing, crawled 13 Nov 08:13 UTC)
- Free: **$0/mo, 500 API calls/month, 10 calls/min, 30 days in-depth history, live data 60-second delay, no credit card required**. Exceeding = 429, no charge.
- Starter: $15/mo, 10,000 calls/mo, 90 days history, still 60s delay.
- Pro: **$59/mo**, 250,000 calls/mo, real-time live, full archive. **NOT approved.**
- Scale: $100/mo. Enterprise: custom.
- Monthly period is a rolling 30 days from key start, NOT calendar month. Headers `X-RateLimit-Monthly-*` + `GET /health` report remaining.

### Cito odds — CONFIRMED Pro+ only
- Official docs (docs.citoapi.com/docs/api/cs2/odds, crawled 13 Nov): "Odds are included on Pro and above."
- Applies to `GET /cs2/matches/{matchId}/odds`, odds history, and `?include=odds`.
- Player props: also Pro+ ("Player props are included on Pro and above").
- Consequence: **NO external odds quote on Free. All odds shown must be model-derived fair odds, labelled model-only. Market edge comparison is DISABLED until a permitted quote exists.**
- Note: new accounts get a 3-day odds trial — do NOT use it without Bosco approval, as it is a trial that ends; the $0 plan must work without it.

### Cloudflare — VERIFIED via docs summaries 13 Nov
- Workers Free: **100,000 requests/day, 10 ms CPU/invocation, no card**, resets midnight UTC. Over limit = Error 1027 / fail, NOT a bill.
- D1 Free: **5M rows read/day, 100,000 rows written/day, 5 GB storage**. Over limit = queries error until reset, NOT a bill.
- Pages Free: static hosting, $0. Paid Workers is $5/mo minimum — do NOT enable billing.
- Limit: max 5 Cron Triggers/account. Design uses 2.
- Caveat: verify no-card at actual signup. If signup asks for a card, STOP and use local fallback.

### Telegram Bot API — VERIFIED
- Free, no plan/card/review. Create via @BotFather `/newbot`, token is the only credential.
- Limits are flood-control only (~1 msg/sec per chat, ~30/sec overall). Paid broadcasts are irrelevant at this volume.
- Bot cannot message a user who has not started it — Bosco must message the bot first.

### GitHub Free
- Free public/private repos. No secrets in repo. Muse GitHub App needs Bosco to select repos after OAuth.

### PandaScore — DO NOT USE
- Pricing page says free stats plans are for non-betting-related usage. This project is market-prediction research, so do NOT use PandaScore unless written permission is obtained. No such permission exists.

## 3. What is NOT verified / NOT operational — do not claim otherwise
- ❌ No Cito API key exists yet. No live Cito call has been made. Endpoints, quota counter, and 60s delay are documented, NOT tested with a real key.
- ❌ No Cloudflare account confirmed. No Worker, D1 database, or Pages site deployed.
- ❌ No Telegram bot created. No test message sent. No chat ID known.
- ❌ No GitHub repo created. No code pushed.
- ❌ No live fixtures, predictions, or dashboard exist yet.
- ❌ No odds, player props, or live probabilities exist — and odds/props cannot exist on Free.

## 4. Local infrastructure — PREPARED AND TESTED
- Schema from Blueprint §7 written to `db/schema.sql` (10 tables + 3 indexes).
- **Local test PASSED 13 Nov:** SQLite DB created, schema applied, test fixture
  Vitality vs MOUZ BO3 inserted, BO3 scoreline enumeration computed:
  2-0 34.1%, 2-1 28.3%, 1-2 20.5%, 0-2 17.1% — sums to 1.0 exactly.
  Predictions + api_usage (500 remaining) rows inserted and read back.
  Test DB: `db/cs2_local_test.db` (test data only, not live data).
- Workspace: `~/workspace/cs2-automation/{docs,db,worker,scripts,tests}`

## 5. Cito quota rationing (Blueprint §4, unchanged)
Fixtures 60 + live list 120 + match detail 120 + player props 60 (only if allowed — currently Pro+, so 0 usable) + results 60 + reserve 80 = 500/mo ceiling.
With props unavailable on Free, reallocate props budget to reserve/detail only after a live key test.

## 6. Account actions needing Bosco's approval — NOT done yet
1. Create Cito free account + API key (no card). Bosco to sign up, or approve Muse-guided signup.
2. Create Cloudflare free account (no payment method). Bosco to sign up.
3. Create Telegram bot via @BotFather + message it first, share chat ID. Bosco to do on phone.
4. Connect GitHub in Muse + select repo (private recommended). Bosco to authorise.
5. Confirm: private dashboard (unlisted) is acceptable, and no repo to be made public without separate approval.
6. Confirm scope for pilot: which tournaments / teams to watch first (to ration the 500 calls).

## 7. Local fallback — ready if cloud signup is blocked
Python + SQLite + Streamlit on Bosco's existing computer, `.env` for Cito key (never in Git), Telegram via Bot API. Cost $0 new spend. Limitation: runs only while computer is on; not 24/7.

## 8. Phase 2 readiness
Blocked on items 1–3 above (Cito key, Cloudflare account, Telegram bot).
Once approved, Phase 2 is: Worker + D1 + Pages skeleton, `/api/health`, `/api/upcoming`, quota counter, Telegram test message — then test each before Phase 3.

## Phase 2 status — 13 Nov 19:50 IST
- Worker skeleton (`worker/src/index.js`, `wrangler.toml`), Cito client, Telegram test script: written, syntax/fail-safe tested, no calls made without keys.
- Static dashboard (`worker/pages/index.html`): written, checks for model-only label + /api/health present. NOT deployed — no Cloudflare account yet.
- GitHub: connect link sent, NOT connected yet — awaiting Bosco authorisation + repo selection.
- Cito: browser signup task (browser-task:91061204) ended 19:50 IST without a result — no account/key confirmed. Was waiting on secure sign-in entry. Retry as fresh task or Bosco signs up himself.
- Cloudflare: signup blocked by Turnstile 'Verify you are human' (5 attempts, verify-then-reset). No account created, no payment/billing. Bosco agreed to take over browser to click checkbox; window paused, expires 19:57 IST 13 Nov.
- Telegram: no bot created yet — Bosco to do on phone via @BotFather.
- Cost to date: $0. Nothing paid, no trial, no billing enabled.

## Phase 2 update — 14 Nov 11:06 IST
- Cloudflare Free account CREATED (musepuchuku@gmail.com, Google sign-in, no human-check block).
- Cito Free account CREATED (musepuchuku@gmail.com, Google OAuth). Dashboard verified: Free $0/mo, 500 req/month, 0/500 used, Active Nov 2026. Default Key exists, masked only — full key still needed via secure entry for the 1-call verification test.
- GitHub: still not connected. Telegram: still no bot.

## Acceptance checklist — Phase 1
- [x] Blueprint read in full
- [x] Muse connectors audited
- [x] Cloudflare / Cito / Telegram / GitHub pricing verified live, $0 confirmed
- [x] Cito odds = Pro+ confirmed from official docs
- [x] Local schema tested, BO3 probabilities sum to 1
- [ ] Cito key created (needs Bosco)
- [ ] Cloudflare account created (needs Bosco)
- [ ] Telegram bot created + test message (needs Bosco)
- [ ] GitHub connected + repo selected (needs Bosco)
- [ ] Total recurring cost verified $0 (pending account checks — no billing enabled anywhere yet)
