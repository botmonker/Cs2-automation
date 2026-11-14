-- CS2 Zero-Budget Blueprint §7 — D1 / SQLite schema (identical SQL, SQLite-compatible)
-- Timestamps ISO 8601 UTC. Predictions append-only. No secrets in DB.
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, provider_team_id TEXT UNIQUE, name TEXT NOT NULL,
  region TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, provider_player_id TEXT UNIQUE, nickname TEXT NOT NULL,
  team_id TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, provider_match_id TEXT UNIQUE, tournament TEXT,
  team1_id TEXT, team2_id TEXT, starts_at TEXT, status TEXT, best_of INTEGER,
  source_updated_at TEXT, raw_json TEXT
);
CREATE TABLE IF NOT EXISTS rosters (
  match_id TEXT, player_id TEXT, team_id TEXT, status TEXT,
  captured_at TEXT, source TEXT
);
CREATE TABLE IF NOT EXISTS team_map_stats (
  team_id TEXT, map_name TEXT, maps_played INTEGER, wins INTEGER,
  rounds_for INTEGER, rounds_against INTEGER, rating REAL, updated_at TEXT,
  PRIMARY KEY(team_id, map_name)
);
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT, provider TEXT,
  market_key TEXT, selection_key TEXT, decimal_odds REAL, status TEXT,
  captured_at TEXT, raw_json TEXT
);
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY, match_id TEXT, market_key TEXT, selection_key TEXT,
  probability REAL, fair_odds REAL, model_version TEXT, feature_cutoff_at TEXT,
  created_at TEXT, data_quality TEXT, is_live INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS results (
  match_id TEXT PRIMARY KEY, winner_team_id TEXT, final_score TEXT,
  completed_at TEXT, source TEXT
);
CREATE TABLE IF NOT EXISTS model_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT, model_version TEXT, market_key TEXT,
  sample_size INTEGER, brier_score REAL, log_loss REAL,
  calibration_error REAL, evaluated_at TEXT
);
CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, period_start TEXT,
  calls_used INTEGER, calls_remaining INTEGER, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_matches_start ON matches(starts_at);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_odds_match_market ON odds_snapshots(match_id, market_key);
