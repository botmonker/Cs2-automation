// CS2 Zero-Budget Worker — Phase 3e: batched D1 writes
// Free tier only. No odds on Free: /api/predictions returns MODEL-ONLY fair odds.
// Phase 3e fix: syncs did ~300 sequential D1 round-trips and timed out, so all
// bulk writes now go through env.DB.batch() (chunks of 50) and the results
// sync reads tracked matches with a single IN query instead of one per item.
// Free tier only. No odds on Free: /api/predictions returns MODEL-ONLY fair odds.
// Telegram: Worker sends a daily report to Bosco via the Bot API (free).
// Secrets needed: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (Cloudflare secrets).
// Bot cannot message a user who has not started it — Bosco must /start the bot.
// Report = next 10 upcoming matches with model probs + Elo leaders + quota.
// Cron sends the report after each sync run (2 messages/day max).
const CITO_BASE = "https://api.citoapi.com/api/v1";
const ELO_BASE = 1500;
const K_PLAYED = 32;
const K_FORFEIT = 16;
const MODEL_VERSION = "elo-v1";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json" },
  });
}

function eloWinProb(eloA, eloB) {
  return 1 / (1 + Math.pow(10, -(eloA - eloB) / 400));
}

function fairOdds(p) {
  return p > 0 && p < 1 ? Math.round((1 / p) * 100) / 100 : null;
}

// BO3 scorelines, maps independent, first to 2. Sums to 1.0.
function bo3Scorelines(pMap) {
  return {
    "2-0": pMap * pMap,
    "2-1": 2 * pMap * pMap * (1 - pMap),
    "1-2": 2 * pMap * (1 - pMap) * (1 - pMap),
    "0-2": (1 - pMap) * (1 - pMap),
  };
}

async function quota(env) {
  // D1 api_usage is source of truth; Cito headers are checked on every live call.
  try {
    const row = await env.DB.prepare(
      "SELECT calls_used, calls_remaining FROM api_usage WHERE provider='cito' ORDER BY id DESC LIMIT 1"
    ).first();
    return row || { calls_used: 0, calls_remaining: 500 };
  } catch { return { calls_used: 0, calls_remaining: 500, note: "D1 not bound yet" }; }
}

async function logCall(env, calls = 1) {
  try {
    const q = await quota(env);
    const used = (q.calls_used || 0) + calls;
    await env.DB.prepare(
      "INSERT INTO api_usage (provider, period_start, calls_used, calls_remaining, updated_at) VALUES ('cito', date('now'), ?, ?, datetime('now'))"
    ).bind(used, 500 - used).run();
    return { used, remaining: 500 - used };
  } catch { return null; }
}

// D1 batch helper: run many prepared statements in a few round-trips.
// Sequential .run() calls each cost a D1 round-trip (~50-300ms), so a sync
// doing ~300 of them times out. batch() sends up to 100 statements per call;
// chunk at 50 to stay well under the limit. Returns total rows changed.
async function batchRun(env, stmts, chunk = 50) {
  let changes = 0;
  for (let i = 0; i < stmts.length; i += chunk) {
    const part = stmts.slice(i, i + chunk);
    if (!part.length) continue;
    const out = await env.DB.batch(part);
    for (const r of out || []) if (r && r.meta && r.meta.changes) changes += r.meta.changes;
  }
  return changes;
}

// Elo table is created by the Worker itself — no manual SQL step needed.
async function ensureEloTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS team_elo (team_id TEXT PRIMARY KEY, elo REAL NOT NULL, matches_played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, updated_at TEXT)"
  ).run();
}

async function getEloMap(env) {
  const map = {};
  try {
    await ensureEloTable(env);
    const { results } = await env.DB.prepare("SELECT team_id, elo, matches_played, wins FROM team_elo").all();
    for (const r of results) map[r.team_id] = { elo: r.elo, played: r.matches_played, wins: r.wins || 0 };
  } catch (e) { /* fall through: all teams default 1500 */ }
  return map;
}

// Pure Elo move on a shared in-memory map: computes both new ratings, updates
// the map (so chained results in one run feed forward), and returns the two
// upsert statements for the caller to batch — no D1 round-trips here.
function eloMove(env, eloMap, winnerId, loserId, k, now) {
  const wPrev = eloMap[winnerId] || { elo: ELO_BASE, played: 0, wins: 0 };
  const lPrev = eloMap[loserId] || { elo: ELO_BASE, played: 0, wins: 0 };
  const wElo = wPrev.elo, lElo = lPrev.elo;
  const expectedW = eloWinProb(wElo, lElo);
  const newW = Math.round((wElo + k * (1 - expectedW)) * 10) / 10;
  const newL = Math.round((lElo + k * (0 - (1 - expectedW))) * 10) / 10;
  eloMap[winnerId] = { elo: newW, played: (wPrev.played || 0) + 1, wins: (wPrev.wins || 0) + 1 };
  eloMap[loserId] = { elo: newL, played: (lPrev.played || 0) + 1, wins: lPrev.wins || 0 };
  const upsert = "INSERT INTO team_elo (team_id, elo, matches_played, wins, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(team_id) DO UPDATE SET elo=excluded.elo, matches_played=excluded.matches_played, wins=excluded.wins, updated_at=excluded.updated_at";
  const stmts = [
    env.DB.prepare(upsert).bind(winnerId, newW, eloMap[winnerId].played, eloMap[winnerId].wins, now),
    env.DB.prepare(upsert).bind(loserId, newL, eloMap[loserId].played, eloMap[loserId].wins, now),
  ];
  return { winner_elo_before: wElo, winner_elo_after: newW, loser_elo_before: lElo, loser_elo_after: newL, stmts };
}

// Defensive result extraction: Cito's exact winner/score field names vary by
// endpoint version, so try every known shape before giving up on a match.
function extractResult(m) {
  let winner = m.winnerTeamId || m.winnerId || m.winner_team_id || null;
  if (!winner && m.winner) {
    if (typeof m.winner === "string") {
      if (m.winner === "team1" || m.winner === m.team1Id) winner = m.team1Id;
      else if (m.winner === "team2" || m.winner === m.team2Id) winner = m.team2Id;
      else winner = m.winner;
    } else if (typeof m.winner === "object") {
      winner = m.winner.id || m.winner.teamId || m.winner.team_id || null;
    }
  }
  if (!winner && m.winnerTeam) winner = m.winnerTeam.id || m.winnerTeam.teamId || null;
  let s1 = m.team1Score ?? m.team1_score ?? m.score1 ?? m.team1MapsWon ?? null;
  let s2 = m.team2Score ?? m.team2_score ?? m.score2 ?? m.team2MapsWon ?? null;
  if ((s1 == null || s2 == null) && typeof m.seriesScore === "string") {
    const parts = m.seriesScore.split("-").map((x) => parseInt(x, 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) { s1 = parts[0]; s2 = parts[1]; }
  }
  if ((s1 == null || s2 == null) && typeof m.score === "string") {
    const parts = m.score.split("-").map((x) => parseInt(x, 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) { s1 = parts[0]; s2 = parts[1]; }
  }
  if (s1 == null && Array.isArray(m.maps)) {
    s1 = m.maps.filter((x) => (x.winnerTeamId || x.winnerId) === m.team1Id).length;
    s2 = m.maps.filter((x) => (x.winnerTeamId || x.winnerId) === m.team2Id).length;
  }
  if (!winner && s1 != null && s2 != null && s1 !== s2) winner = s1 > s2 ? m.team1Id : m.team2Id;
  const score = (s1 != null && s2 != null) ? `${s1}-${s2}` : null;
  const forfeit = (m.resultType && String(m.resultType).includes("forfeit")) || m.isForfeit === true;
  return { winner, score, forfeit };
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, reason: "no_telegram_config" };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).description || ""; } catch (e) { /* ignore */ }
    return { ok: false, reason: `telegram_http_${r.status}`, detail };
  }
  return { ok: true };
}

function fmtTime(iso) {
  if (!iso) return "?";
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

async function buildDailyReport(env) {
  const q = await quota(env);
  const lines = ["CS2 Zero-Budget — daily report (model-only, no market odds)"];
  lines.push(`Cito quota: ${q.calls_remaining} left of 500`);
  try {
    const rc = await env.DB.prepare("SELECT COUNT(*) AS n FROM results").first();
    lines.push(`Results recorded: ${rc ? rc.n : 0}`);
  } catch (e) { /* ignore */ }
  try {
    const { results } = await env.DB.prepare(
      "SELECT t.name, e.elo, e.matches_played, e.wins FROM team_elo e LEFT JOIN teams t ON t.id=e.team_id WHERE e.matches_played > 0 ORDER BY e.elo DESC LIMIT 5"
    ).all();
    if (results.length) {
      lines.push("Elo leaders:");
      for (const r of results) lines.push(`- ${r.name || r.team_id}: ${r.elo} (${r.wins}-${r.matches_played - r.wins})`);
    } else {
      lines.push("Elo leaders: none yet — no results recorded");
    }
  } catch (e) { /* ignore */ }
  try {
    const { results } = await env.DB.prepare(
      "SELECT m.id, m.tournament, m.team1_id, m.team2_id, m.starts_at, m.best_of, t1.name AS n1, t2.name AS n2 FROM matches m LEFT JOIN teams t1 ON t1.id=m.team1_id LEFT JOIN teams t2 ON t2.id=m.team2_id WHERE m.status='upcoming' ORDER BY m.starts_at LIMIT 10"
    ).all();
    if (!results.length) {
      lines.push("Upcoming: none in D1 — run /api/sync");
    } else {
      lines.push("Upcoming:");
      for (const m of results) {
        let p1 = null, o1 = null, o2 = null;
        try {
          const pr = await env.DB.prepare(
            "SELECT selection_key, probability, fair_odds FROM predictions WHERE match_id=? AND market_key='match_winner'"
          ).bind(m.id).all();
          for (const row of pr.results || []) {
            if (row.selection_key === m.team1_id) { p1 = row.probability; o1 = row.fair_odds; }
            if (row.selection_key === m.team2_id) { o2 = row.fair_odds; }
          }
        } catch (e) { /* ignore */ }
        const prob = p1 == null ? "no prediction" : `${Math.round(p1 * 100)}% / ${100 - Math.round(p1 * 100)}% (fair ${o1} / ${o2})`;
        lines.push(`- ${m.n1 || m.team1_id} vs ${m.n2 || m.team2_id} — ${prob}, BO${m.best_of || 3}, ${fmtTime(m.starts_at)}, ${m.tournament || ""}`);
      }
    }
  } catch (e) { lines.push("Upcoming: could not read D1"); }
  return lines.join("\n");
}

async function generatePredictions(env) {
  if (!env.DB) return { ok: false, reason: "no_d1" };
  const now = new Date().toISOString();
  const eloMap = await getEloMap(env);
  const rated = Object.values(eloMap).filter((x) => x.played > 0).length;
  const quality = rated === 0
    ? "baseline-no-history: all teams Elo 1500, no results history yet — 50/50 until results feed in"
    : `elo-v1: Elo from completed matches in D1 (${rated} teams rated)`;
  const { results } = await env.DB.prepare(
    "SELECT id, team1_id, team2_id, best_of FROM matches WHERE status='upcoming' ORDER BY starts_at LIMIT 50"
  ).all();
  const stmts = [];
  for (const m of results) {
    if (!m.team1_id || !m.team2_id) continue;
    const elo1 = (eloMap[m.team1_id] && eloMap[m.team1_id].elo) || ELO_BASE;
    const elo2 = (eloMap[m.team2_id] && eloMap[m.team2_id].elo) || ELO_BASE;
    const pMap = eloWinProb(elo1, elo2);
    const bo = m.best_of || 3;
    let p1, scores = null;
    if (bo === 1) {
      p1 = pMap;
      scores = { "1-0": pMap, "0-1": 1 - pMap };
    } else if (bo === 5) {
      p1 = Math.pow(pMap, 3) + 3 * Math.pow(pMap, 3) * (1 - pMap) + 6 * Math.pow(pMap, 3) * Math.pow(1 - pMap, 2);
    } else {
      // BO3 (default)
      p1 = pMap * pMap + 2 * pMap * pMap * (1 - pMap);
      scores = bo3Scorelines(pMap);
    }
    const rows = [
      [`${m.id}:winner:${m.team1_id}`, m.id, "match_winner", m.team1_id, p1],
      [`${m.id}:winner:${m.team2_id}`, m.id, "match_winner", m.team2_id, 1 - p1],
    ];
    if (scores) {
      for (const [score, p] of Object.entries(scores)) {
        rows.push([`${m.id}:scoreline:${score}`, m.id, bo === 1 ? "bo1_scoreline" : "bo3_scoreline", score, p]);
      }
    }
    for (const [id, matchId, market, selection, p] of rows) {
      stmts.push(env.DB.prepare(
        "INSERT OR REPLACE INTO predictions (id, match_id, market_key, selection_key, probability, fair_odds, model_version, feature_cutoff_at, created_at, data_quality, is_live) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)"
      ).bind(id, matchId, market, selection, Math.round(p * 10000) / 10000, fairOdds(p), MODEL_VERSION, now, now, quality));
    }
  }
  const inserted = await batchRun(env, stmts);
  return { ok: true, matches: results.length, predictions_inserted: inserted, model_version: MODEL_VERSION, note: quality };
}

async function syncFixtures(env) {
  const q = await quota(env);
  if (q.calls_remaining < 20) return { ok: false, reason: "quota_low", calls_remaining: q.calls_remaining };
  if (!env.CITO_API_KEY) return { ok: false, reason: "no_cito_key" };
  if (!env.DB) return { ok: false, reason: "no_d1" };
  const r = await fetch(`${CITO_BASE}/cs2/matches/upcoming?limit=50`, {
    headers: { "x-api-key": env.CITO_API_KEY },
  });
  if (r.status === 429) return { ok: false, reason: "rate_limited_429" };
  if (!r.ok) return { ok: false, reason: `cito_http_${r.status}` };
  const body = await r.json();
  const list = Array.isArray(body.data) ? body.data : [];
  const now = new Date().toISOString();
  const teamStmts = [], matchStmts = [];
  for (const m of list) {
    if (!m.id || !m.team1Id || !m.team2Id) continue;
    for (const [tid, tname] of [[m.team1Id, m.team1Name], [m.team2Id, m.team2Name]]) {
      if (!tname) continue;
      teamStmts.push(env.DB.prepare(
        "INSERT OR IGNORE INTO teams (id, provider_team_id, name, updated_at) VALUES (?, ?, ?, ?)"
      ).bind(tid, tid, tname, now));
    }
    matchStmts.push(env.DB.prepare(
      "INSERT OR REPLACE INTO matches (id, provider_match_id, tournament, team1_id, team2_id, starts_at, status, best_of, source_updated_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(m.id, m.id, m.eventName || null, m.team1Id, m.team2Id, m.startsAt || null, m.status || "upcoming", m.bestOf || null, now, JSON.stringify(m)));
  }
  const teams = await batchRun(env, teamStmts);
  const matches = await batchRun(env, matchStmts);
  const usage = await logCall(env, 1);
  let predictions = null;
  try { predictions = await generatePredictions(env); } catch (e) { predictions = { ok: false, reason: "predictions_error" }; }
  return { ok: true, fetched: list.length, teams_inserted: teams, matches_upserted: matches, quota: usage, predictions };
}

async function syncResults(env) {
  const q = await quota(env);
  if (q.calls_remaining < 20) return { ok: false, reason: "quota_low", calls_remaining: q.calls_remaining };
  if (!env.CITO_API_KEY) return { ok: false, reason: "no_cito_key" };
  if (!env.DB) return { ok: false, reason: "no_d1" };
  const r = await fetch(`${CITO_BASE}/cs2/matches/recent?limit=50`, {
    headers: { "x-api-key": env.CITO_API_KEY },
  });
  if (r.status === 429) return { ok: false, reason: "rate_limited_429" };
  if (!r.ok) return { ok: false, reason: `cito_http_${r.status}` };
  const body = await r.json();
  const list = Array.isArray(body.data) ? body.data : [];
  const now = new Date().toISOString();
  const sampleKeys = list.length ? Object.keys(list[0]) : [];
  let matched = 0, recorded = 0, eloUpdates = 0, skippedNoWinner = 0, alreadyDone = 0;
  const eloMoves = [];
  // One query for all tracked matches (was one round-trip per recent item).
  const trackedMap = {};
  const ids = list.filter((m) => m.id).map((m) => m.id);
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const { results: trackedRows } = await env.DB.prepare(
      `SELECT id, team1_id, team2_id, status FROM matches WHERE id IN (${ph})`
    ).bind(...ids).all();
    for (const r of trackedRows) trackedMap[r.id] = r;
  }
  const eloMap = await getEloMap(env);
  const writeStmts = [];
  for (const m of list) {
    if (!m.id) continue;
    // Only process matches we already track in D1.
    const tracked = trackedMap[m.id];
    if (!tracked) continue;
    matched++;
    if (tracked.status === "completed") { alreadyDone++; continue; }
    const { winner, score, forfeit } = extractResult(m);
    if (!winner || (winner !== tracked.team1_id && winner !== tracked.team2_id)) { skippedNoWinner++; continue; }
    const loser = winner === tracked.team1_id ? tracked.team2_id : tracked.team1_id;
    const completedAt = m.completedAt || m.endedAt || m.updatedAt || now;
    writeStmts.push(env.DB.prepare(
      "INSERT OR IGNORE INTO results (match_id, winner_team_id, final_score, completed_at, source) VALUES (?, ?, ?, ?, 'cito-recent')"
    ).bind(m.id, winner, score, completedAt));
    writeStmts.push(env.DB.prepare("UPDATE matches SET status='completed' WHERE id=?").bind(m.id));
    const move = eloMove(env, eloMap, winner, loser, forfeit ? K_FORFEIT : K_PLAYED, now);
    writeStmts.push(...move.stmts);
    eloUpdates++;
    eloMoves.push({ match_id: m.id, winner, score, forfeit, winner_elo_before: move.winner_elo_before, winner_elo_after: move.winner_elo_after, loser_elo_before: move.loser_elo_before, loser_elo_after: move.loser_elo_after });
    recorded++;
  }
  await batchRun(env, writeStmts);
  const usage = await logCall(env, 1);
  let predictions = null;
  try { predictions = await generatePredictions(env); } catch (e) { predictions = { ok: false, reason: "predictions_error" }; }
  return { ok: true, fetched: list.length, matched_tracked: matched, results_recorded: recorded, elo_updates: eloUpdates, skipped_no_winner: skippedNoWinner, already_completed: alreadyDone, quota: usage, predictions, sample_keys: sampleKeys, elo_moves: eloMoves.slice(0, 10) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const q = await quota(env);
      return json({ ok: true, service: "cs2-automation", plan: "free", cito_calls_remaining: q.calls_remaining, cito_calls_used: q.calls_used, odds: "NO QUOTE on Free — model-only fair odds", ts: new Date().toISOString() });
    }
    if (url.pathname === "/api/quota") return json(await quota(env));
    if (url.pathname === "/api/sync") {
      // Manual fixture sync — 1 Cito call. Also regenerates predictions (0 calls).
      const result = await syncFixtures(env);
      return json(result, result.ok ? 200 : 500);
    }
    if (url.pathname === "/api/results") {
      // Manual results sync — 1 Cito call. Records finished tracked matches,
      // updates Elo, regenerates predictions (0 extra calls).
      const result = await syncResults(env);
      return json(result, result.ok ? 200 : 500);
    }
    if (url.pathname === "/api/notify") {
      // Send the daily report to Telegram now. 0 Cito calls.
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ ok: false, reason: "no_telegram_config", note: "Add secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then Deploy" }, 500);
      const text = await buildDailyReport(env);
      const sent = await sendTelegram(env, text);
      return json({ ok: sent.ok, reason: sent.reason || null, detail: sent.detail || null, preview: text.slice(0, 300) }, sent.ok ? 200 : 500);
    }
    if (url.pathname === "/api/predict") {
      // Generate predictions from the matches + Elo already in D1. 0 Cito calls.
      const result = await generatePredictions(env);
      return json(result, result.ok ? 200 : 500);
    }
    if (url.pathname === "/api/elo") {
      try {
        await ensureEloTable(env);
        const { results } = await env.DB.prepare(
          "SELECT t.name, e.team_id, e.elo, e.matches_played, e.wins, e.updated_at FROM team_elo e LEFT JOIN teams t ON t.id=e.team_id WHERE e.matches_played > 0 ORDER BY e.elo DESC LIMIT 100"
        ).all();
        return json({ source: "d1", count: results.length, ratings: results });
      } catch (e) { return json({ source: "unavailable", reason: "no Elo data yet", ratings: [] }); }
    }
    if (url.pathname === "/api/upcoming") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT id, tournament, team1_id, team2_id, starts_at, status, best_of FROM matches WHERE status='upcoming' ORDER BY starts_at LIMIT 50"
        ).all();
        return json({ source: "d1", count: results.length, matches: results });
      } catch (e) { return json({ source: "unavailable", reason: "D1 not bound / no fixtures yet", matches: [] }); }
    }
    if (url.pathname === "/api/predictions") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT match_id, market_key, selection_key, probability, fair_odds, model_version, data_quality FROM predictions ORDER BY created_at DESC, match_id LIMIT 500"
        ).all();
        return json({ source: "model-only", note: "Fair odds are model-derived, NOT a market price. No external quote on Free.", predictions: results });
      } catch (e) { return json({ source: "unavailable", reason: "D1 not bound / no predictions yet", predictions: [] }); }
    }
    return json({ error: "not_found", routes: ["/api/health", "/api/quota", "/api/sync", "/api/results", "/api/predict", "/api/notify", "/api/elo", "/api/upcoming", "/api/predictions"] }, 404);
  },

  // Cron: fixture sync + results sync, quota-guarded. 2 Cito calls per run,
  // twice daily = ~120/month of the 500 budget. Then send the daily report
  // to Telegram (skipped silently if the bot is not configured yet).
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await syncFixtures(env); } catch (e) { /* next run retries */ }
      try { await syncResults(env); } catch (e) { /* next run retries */ }
      try {
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          const text = await buildDailyReport(env);
          await sendTelegram(env, text);
        }
      } catch (e) { /* Telegram failure must never break the syncs */ }
    })());
  },
};
