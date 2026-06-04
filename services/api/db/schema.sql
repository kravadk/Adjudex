CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  pool_address TEXT,
  chain_id INTEGER NOT NULL,
  factory_address TEXT,
  creation_tx_hash TEXT,
  creator_address TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  oracle_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  asset TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  resolution_criteria TEXT,
  resolver_address TEXT,
  resolution_tx_hash TEXT,
  resolution_evidence_hash TEXT,
  resolution_proposer TEXT,
  resolution_proposed_at TIMESTAMPTZ,
  resolution_proof_tx_hash TEXT,
  proof_url TEXT,
  import_source_id TEXT,
  import_candidate_id TEXT,
  source_published_at TIMESTAMPTZ,
  provenance_note TEXT,
  deadline_at TIMESTAMPTZ NOT NULL,
  resolved_outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS markets_chain_pool_address_uidx
  ON markets (chain_id, lower(pool_address))
  WHERE pool_address IS NOT NULL;

ALTER TABLE markets ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE markets ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE markets ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS factory_address TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS creation_tx_hash TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS creator_address TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolution_criteria TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolver_address TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolution_tx_hash TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolution_evidence_hash TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolution_proposer TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolution_proposed_at TIMESTAMPTZ;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolution_proof_tx_hash TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS import_source_id TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS import_candidate_id TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS source_published_at TIMESTAMPTZ;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS provenance_note TEXT;

-- Esports vertical: all nullable, only populated when category = 'esports'.
-- Indexer write-path silently ignores null values for non-esports markets.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS game TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS tournament TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS team_a TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS team_b TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS match_starts_at TIMESTAMPTZ;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS best_of_maps INTEGER;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS stream_url TEXT;
-- Sub-markets (handicap / totals / props) reference parent moneyline market.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS parent_market_id TEXT;
-- Market kind: "moneyline" (default) / "handicap" / "totals" / "prop".
ALTER TABLE markets ADD COLUMN IF NOT EXISTS kind TEXT;
-- Traditional-sports vertical (category = 'sports'). Mirror of game/tournament.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS sport TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS league TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS liquidity_mode TEXT NOT NULL DEFAULT 'parimutuel';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS group_id TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS creator_handle TEXT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS best_bid_bps INTEGER;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS best_ask_bps INTEGER;

CREATE INDEX IF NOT EXISTS markets_game_idx ON markets (game) WHERE game IS NOT NULL;
CREATE INDEX IF NOT EXISTS markets_sport_idx ON markets (sport) WHERE sport IS NOT NULL;
CREATE INDEX IF NOT EXISTS markets_parent_market_id_idx ON markets (parent_market_id) WHERE parent_market_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS markets_group_id_idx ON markets (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS markets_creator_handle_idx ON markets (lower(creator_handle)) WHERE creator_handle IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'markets_status_check'
  ) THEN
    ALTER TABLE markets
      ADD CONSTRAINT markets_status_check
      CHECK (status IN ('draft', 'open', 'locked', 'resolving', 'resolved', 'claimable', 'archived'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS market_stats (
  market_id TEXT PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  volume_usd NUMERIC NOT NULL DEFAULT 0,
  yes_probability NUMERIC NOT NULL DEFAULT 50,
  yes_probability_change_1h NUMERIC NOT NULL DEFAULT 0,
  bettors INTEGER NOT NULL DEFAULT 0,
  ai_lp_count INTEGER NOT NULL DEFAULT 0,
  is_hot BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  reputation NUMERIC NOT NULL,
  lifetime_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  markets_touched INTEGER NOT NULL DEFAULT 0,
  erc8004_address TEXT NOT NULL,
  chain_id INTEGER,
  registration_tx_hash TEXT,
  strategy_description TEXT,
  proof_url TEXT,
  last_action TEXT,
  registered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS strategy_description TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_action TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS registration_tx_hash TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS agents_chain_wallet_uidx ON agents (chain_id, lower(erc8004_address)) WHERE chain_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agents_registration_tx_uidx ON agents (chain_id, registration_tx_hash) WHERE chain_id IS NOT NULL AND registration_tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_reputation_history (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  reputation NUMERIC NOT NULL,
  lifetime_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  markets_touched INTEGER NOT NULL DEFAULT 0,
  proof_url TEXT,
  reason TEXT,
  transaction_hash TEXT,
  chain_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_reputation_history_agent_idx ON agent_reputation_history (agent_id, created_at ASC);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  stake_usd NUMERIC NOT NULL,
  avg_price NUMERIC NOT NULL,
  shares NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  payout_usd NUMERIC,
  transaction_hash TEXT,
  chain_id INTEGER NOT NULL,
  block_hash TEXT,
  block_number BIGINT,
  log_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE positions ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE positions ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE positions ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS block_number BIGINT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS log_index INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_transaction_hash_key') THEN
    ALTER TABLE positions DROP CONSTRAINT positions_transaction_hash_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS positions_transaction_hash_idx ON positions (transaction_hash);
CREATE UNIQUE INDEX IF NOT EXISTS positions_chain_tx_log_uidx
  ON positions (chain_id, transaction_hash, log_index)
  WHERE transaction_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  market_id TEXT REFERENCES markets(id) ON DELETE SET NULL,
  transaction_hash TEXT,
  chain_id INTEGER NOT NULL,
  block_hash TEXT,
  block_number BIGINT,
  log_index INTEGER,
  side TEXT,
  amount_usd NUMERIC,
  wallet_short TEXT,
  agent_handle TEXT,
  resolved_as TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS transaction_hash TEXT;
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE activity_events ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE activity_events ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS block_number BIGINT;
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS log_index INTEGER;
CREATE INDEX IF NOT EXISTS activity_events_chain_tx_log_idx
  ON activity_events (chain_id, transaction_hash, log_index)
  WHERE transaction_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  payout_usd NUMERIC NOT NULL,
  transaction_hash TEXT,
  chain_id INTEGER NOT NULL,
  block_hash TEXT,
  block_number BIGINT,
  log_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE claims ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE claims ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE claims ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS block_number BIGINT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS log_index INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_transaction_hash_key') THEN
    ALTER TABLE claims DROP CONSTRAINT claims_transaction_hash_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS claims_transaction_hash_idx ON claims (transaction_hash);
CREATE UNIQUE INDEX IF NOT EXISTS claims_chain_tx_log_uidx
  ON claims (chain_id, transaction_hash, log_index)
  WHERE transaction_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  amount_usd NUMERIC NOT NULL,
  transaction_hash TEXT,
  chain_id INTEGER NOT NULL,
  block_hash TEXT,
  block_number BIGINT,
  log_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE refunds ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE refunds ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS block_number BIGINT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS log_index INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_transaction_hash_key') THEN
    ALTER TABLE refunds DROP CONSTRAINT refunds_transaction_hash_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS refunds_transaction_hash_idx ON refunds (transaction_hash);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_chain_tx_log_uidx
  ON refunds (chain_id, transaction_hash, log_index)
  WHERE transaction_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS indexer_state (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  last_block BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE indexer_state ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE indexer_state ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Reorg detection + status surface: hash of the last finalised block so the
-- next sync can detect a divergent reorg and rewind the cursor.
ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS last_block_hash TEXT;
ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS last_status TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS last_reorg_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS market_timeline (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  yes_probability NUMERIC NOT NULL,
  volume_usd NUMERIC NOT NULL,
  event_kind TEXT NOT NULL,
  transaction_hash TEXT,
  chain_id INTEGER NOT NULL,
  block_hash TEXT,
  block_number BIGINT,
  log_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE market_timeline ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE market_timeline ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE market_timeline ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE market_timeline ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE market_timeline ADD COLUMN IF NOT EXISTS block_number BIGINT;
ALTER TABLE market_timeline ADD COLUMN IF NOT EXISTS log_index INTEGER;
CREATE INDEX IF NOT EXISTS market_timeline_chain_tx_log_idx
  ON market_timeline (chain_id, transaction_hash, log_index)
  WHERE transaction_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS transaction_syncs (
  transaction_hash TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  block_hash TEXT,
  block_number BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_hash, chain_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transaction_syncs_pkey'
      AND conrelid = 'transaction_syncs'::regclass
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (transaction_hash)'
  ) THEN
    ALTER TABLE transaction_syncs DROP CONSTRAINT transaction_syncs_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transaction_syncs_pkey'
      AND conrelid = 'transaction_syncs'::regclass
  ) THEN
    ALTER TABLE transaction_syncs ADD CONSTRAINT transaction_syncs_pkey PRIMARY KEY (transaction_hash, chain_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS reclaim_proofs (
  session_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  proof JSONB NOT NULL,
  market_id TEXT,
  source_url TEXT,
  chain_id INTEGER,
  pool_address TEXT,
  wallet_address TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reclaim_proofs ADD COLUMN IF NOT EXISTS market_id TEXT;
ALTER TABLE reclaim_proofs ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE reclaim_proofs ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE reclaim_proofs ADD COLUMN IF NOT EXISTS pool_address TEXT;
ALTER TABLE reclaim_proofs ADD COLUMN IF NOT EXISTS wallet_address TEXT;

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  message TEXT NOT NULL,
  chain_id INTEGER,
  domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);
ALTER TABLE auth_nonces ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE auth_nonces ADD COLUMN IF NOT EXISTS domain TEXT;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  chain_id INTEGER,
  domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS domain TEXT;

CREATE TABLE IF NOT EXISTS user_settings (
  address TEXT PRIMARY KEY,
  preferred_chain TEXT NOT NULL DEFAULT 'arbitrum-sepolia',
  currency_display TEXT NOT NULL DEFAULT 'USD',
  notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  animations_enabled BOOLEAN NOT NULL DEFAULT true,
  compact_mode BOOLEAN NOT NULL DEFAULT false,
  default_stake_usd NUMERIC NOT NULL DEFAULT 50,
  explorer_preference TEXT NOT NULL DEFAULT 'default',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
  address TEXT NOT NULL,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (address, market_id)
);

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  kind TEXT NOT NULL,
  market_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivery tracking for the notification worker. `delivery_channel` is the
-- transport that handled the row (e.g. "email", "push", "log"); NULL means
-- not yet picked up. `delivery_error` is the last attempt's error message.
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS delivery_channel TEXT;
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS delivery_error TEXT;
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS notification_events_undelivered_idx
  ON notification_events (created_at)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS user_activity_events (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  kind TEXT NOT NULL,
  market_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_activity_events_address_created_at_idx
  ON user_activity_events (lower(address), created_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_events_kind_created_at_idx
  ON user_activity_events (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS liquidity_incentive_programs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  top_percent_bps INTEGER NOT NULL,
  rebate_bps INTEGER NOT NULL,
  min_volume_usd NUMERIC NOT NULL DEFAULT 0,
  budget_usd NUMERIC,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (top_percent_bps > 0 AND top_percent_bps <= 10000),
  CHECK (rebate_bps >= 0 AND rebate_bps <= 10000),
  CHECK (ends_at > starts_at),
  CHECK (status IN ('active', 'paused', 'ended'))
);

CREATE INDEX IF NOT EXISTS liquidity_incentive_programs_status_window_idx
  ON liquidity_incentive_programs (status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS liquidity_incentive_payouts (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES liquidity_incentive_programs(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  amount_usd NUMERIC NOT NULL,
  transaction_hash TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS liquidity_incentive_payouts_uidx
  ON liquidity_incentive_payouts (program_id, lower(address), transaction_hash, chain_id);
CREATE INDEX IF NOT EXISTS liquidity_incentive_payouts_program_idx
  ON liquidity_incentive_payouts (program_id, created_at DESC);

CREATE TABLE IF NOT EXISTS import_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'soft',
  oracle_type TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_candidates (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_published_at TIMESTAMPTZ,
  event_date TIMESTAMPTZ,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  description TEXT NOT NULL,
  oracle_type TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDC',
  deadline_at TIMESTAMPTZ,
  resolution_criteria TEXT,
  confidence NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'needs_review',
  risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  spec_json JSONB,
  spec_hash TEXT,
  spec_uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_url)
);

CREATE TABLE IF NOT EXISTS import_candidate_sources (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES import_candidates(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_deployments (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES import_candidates(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE import_deployments ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE import_deployments ALTER COLUMN chain_id SET NOT NULL;
ALTER TABLE import_deployments ALTER COLUMN chain_id DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_deployments_transaction_hash_key') THEN
    ALTER TABLE import_deployments DROP CONSTRAINT import_deployments_transaction_hash_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS positions_address_idx ON positions (lower(address));
CREATE INDEX IF NOT EXISTS activity_created_at_idx ON activity_events (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_market_created_at_idx ON activity_events (market_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_timeline_market_created_at_idx ON market_timeline (market_id, created_at ASC);
CREATE INDEX IF NOT EXISTS watchlist_address_idx ON watchlist (lower(address), created_at DESC);
CREATE INDEX IF NOT EXISTS notification_events_address_created_at_idx ON notification_events (lower(address), created_at DESC);
CREATE INDEX IF NOT EXISTS import_candidates_status_idx ON import_candidates (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS import_deployments_candidate_idx ON import_deployments (candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS import_deployments_chain_tx_uidx
  ON import_deployments (chain_id, transaction_hash);

-- Subscriptions (S4.A). One row per active subscription. address is the
-- subscriber wallet. tier is "free" | "pro" | "enterprise". status is
-- "active" | "past_due" | "canceled" | "trialing". A subscription is
-- linked EITHER to a Stripe subscription (fiat path) OR a Sablier USDC
-- stream id (on-chain path); never both.
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  stripe_subscription_id TEXT,
  usdc_stream_id TEXT,
  price_usd_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_address_active_uidx
  ON subscriptions (lower(address))
  WHERE status IN ('active', 'trialing', 'past_due');

CREATE INDEX IF NOT EXISTS subscriptions_status_period_idx
  ON subscriptions (status, current_period_end);

-- Append-only event log for subscription lifecycle. Webhook receivers
-- (Stripe, Sablier) write here, and the worker reconciles into
-- `subscriptions` on the next tick.
CREATE TABLE IF NOT EXISTS subscription_events (
  id TEXT PRIMARY KEY,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE CASCADE,
  external_id TEXT,
  kind TEXT NOT NULL,
  payload JSONB,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_events_subscription_idx
  ON subscription_events (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_events_unprocessed_idx
  ON subscription_events (created_at)
  WHERE processed_at IS NULL;

-- Referral attribution (S4.B). When a user mints USDC or opens a first
-- position, we record which address referred them. Attribution is
-- on-chain (signed message) so it's auditable + cannot be retroactively
-- changed. Only one referral per address (first-write-wins).
CREATE TABLE IF NOT EXISTS referrals (
  address TEXT PRIMARY KEY,
  referrer_address TEXT NOT NULL,
  signature TEXT NOT NULL,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_position_at TIMESTAMPTZ,
  first_position_market_id TEXT,
  lifetime_fees_usd_cents INTEGER NOT NULL DEFAULT 0,
  lifetime_rebate_usd_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx
  ON referrals (lower(referrer_address));

-- Agent followers (S6.C.2). One row per (agent, follower) pair. Used by
-- /api/agents/:id/social to surface follower count + recent followers
-- on the profile page. Strictly social signal — does NOT affect the
-- on-chain ERC-8004 reputation score; that stays sybil-resistant.
CREATE TABLE IF NOT EXISTS agent_followers (
  agent_id TEXT NOT NULL,
  follower_address TEXT NOT NULL,
  followed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, follower_address)
);

CREATE INDEX IF NOT EXISTS agent_followers_agent_idx
  ON agent_followers (agent_id, followed_at DESC);
CREATE INDEX IF NOT EXISTS agent_followers_follower_idx
  ON agent_followers (lower(follower_address), followed_at DESC);

-- Auto-ingest pipeline bookkeeping. One row per market the match-ingest
-- worker created from a feed. Decouples pipeline lifecycle from the main
-- `markets` table: the deployer writes both, the resolve worker drives the
-- lifecycle column here. UNIQUE(source_kind, external_match_id) is the
-- dedupe guard so the same match never spawns two markets.
CREATE TABLE IF NOT EXISTS auto_markets (
  market_id TEXT PRIMARY KEY,
  pool_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  external_match_id TEXT NOT NULL,
  category TEXT NOT NULL,
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  -- open -> proposed -> finalized | refunded | skipped
  lifecycle TEXT NOT NULL DEFAULT 'open',
  proposed_outcome INTEGER,
  proposed_at TIMESTAMPTZ,
  challenge_deadline TIMESTAMPTZ,
  resolve_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_markets_source_match_uidx
  ON auto_markets (source_kind, external_match_id);
CREATE INDEX IF NOT EXISTS auto_markets_lifecycle_idx
  ON auto_markets (lifecycle, deadline_at);

-- Market discussion threads. SIWE-gated writes; public reads. `hidden`
-- is a soft-delete / moderation flag so a removed comment leaves an
-- auditable row. Author may hard-delete their own; admins may hide any.
CREATE TABLE IF NOT EXISTS market_comments (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  author_address TEXT NOT NULL,
  body TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_comments_market_idx
  ON market_comments (market_id, created_at DESC) WHERE hidden = false;
CREATE INDEX IF NOT EXISTS market_comments_author_idx
  ON market_comments (lower(author_address), created_at DESC);

-- Social graph between traders (humans). Distinct from agent_followers
-- (which tracks following AI agents). One row per (follower, followee).
-- Powers public /profile/[address] follower counts + follow button.
CREATE TABLE IF NOT EXISTS user_followers (
  follower_address TEXT NOT NULL,
  followee_address TEXT NOT NULL,
  followed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_address, followee_address)
);

CREATE INDEX IF NOT EXISTS user_followers_followee_idx
  ON user_followers (lower(followee_address), followed_at DESC);
CREATE INDEX IF NOT EXISTS user_followers_follower_idx
  ON user_followers (lower(follower_address), followed_at DESC);

-- Outbound webhooks. A subscription is a URL + HMAC secret owned by a
-- SIWE address. On a subscribed event (e.g. market.resolved) a delivery
-- row is enqueued per active subscription; the webhook worker POSTs it
-- with an X-Adjudex-Signature header and retries with backoff.
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  owner_address TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT ARRAY['market.resolved']::TEXT[],
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_subscriptions_owner_idx
  ON webhook_subscriptions (lower(owner_address), created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_active_idx
  ON webhook_subscriptions (active) WHERE active = true;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

ALTER TABLE IF EXISTS webhook_deliveries
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP INDEX IF EXISTS webhook_deliveries_pending_idx;
CREATE INDEX IF NOT EXISTS webhook_deliveries_pending_idx
  ON webhook_deliveries (status, next_attempt_at, created_at) WHERE status = 'pending';

-- Competitive gap layer: AMM liquidity, signed order intents, exclusive
-- outcome groups, creator markets, parlays, and market opportunities.
CREATE TABLE IF NOT EXISTS market_liquidity (
  market_id TEXT PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'parimutuel',
  yes_reserve NUMERIC NOT NULL DEFAULT 0,
  no_reserve NUMERIC NOT NULL DEFAULT 0,
  yes_shares NUMERIC NOT NULL DEFAULT 0,
  no_shares NUMERIC NOT NULL DEFAULT 0,
  vault_debt NUMERIC NOT NULL DEFAULT 0,
  vault_surplus NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode IN ('parimutuel', 'amm'))
);

CREATE TABLE IF NOT EXISTS share_trades (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  side TEXT NOT NULL,
  action TEXT NOT NULL,
  amount_usd NUMERIC NOT NULL,
  shares NUMERIC NOT NULL,
  transaction_hash TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  block_hash TEXT,
  block_number BIGINT,
  log_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (side IN ('YES', 'NO')),
  CHECK (action IN ('buy', 'sell'))
);
CREATE UNIQUE INDEX IF NOT EXISTS share_trades_chain_tx_log_uidx
  ON share_trades (chain_id, transaction_hash, log_index)
  WHERE transaction_hash IS NOT NULL AND log_index IS NOT NULL;
CREATE INDEX IF NOT EXISTS share_trades_market_idx ON share_trades (market_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_exposure (
  market_id TEXT PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  vault_address TEXT NOT NULL,
  debt_usd NUMERIC NOT NULL DEFAULT 0,
  surplus_usd NUMERIC NOT NULL DEFAULT 0,
  total_outstanding_debt_usd NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_intents (
  hash TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  pool_address TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  amount_usd NUMERIC NOT NULL,
  limit_price_bps INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  nonce TEXT NOT NULL,
  maker_address TEXT NOT NULL,
  builder_address TEXT,
  metadata_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (side IN ('YES', 'NO')),
  CHECK (order_type IN ('buy', 'sell')),
  CHECK (status IN ('open', 'filled', 'cancelled', 'expired'))
);
CREATE INDEX IF NOT EXISTS order_intents_market_status_idx ON order_intents (market_id, status, limit_price_bps);
CREATE INDEX IF NOT EXISTS order_intents_maker_idx ON order_intents (lower(maker_address), created_at DESC);

CREATE TABLE IF NOT EXISTS order_fills (
  id TEXT PRIMARY KEY,
  order_hash TEXT NOT NULL REFERENCES order_intents(hash) ON DELETE CASCADE,
  counterparty_hash TEXT,
  amount_usd NUMERIC NOT NULL,
  price_bps INTEGER NOT NULL,
  transaction_hash TEXT,
  chain_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_cancellations (
  order_hash TEXT PRIMARY KEY REFERENCES order_intents(hash) ON DELETE CASCADE,
  maker_address TEXT NOT NULL,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_groups (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  winning_market_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('open', 'resolved', 'archived'))
);

CREATE TABLE IF NOT EXISTS market_group_outcomes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES market_groups(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  probability_bps INTEGER NOT NULL DEFAULT 5000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, market_id)
);
CREATE INDEX IF NOT EXISTS market_group_outcomes_group_idx ON market_group_outcomes (group_id);

CREATE TABLE IF NOT EXISTS market_group_positions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES market_groups(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  stake_usd NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neg_risk_conversions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES market_groups(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  source_market_id TEXT NOT NULL,
  target_market_id TEXT NOT NULL,
  amount_usd NUMERIC NOT NULL,
  transaction_hash TEXT,
  chain_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resolution_disputes (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  pool_address TEXT,
  status TEXT NOT NULL,
  outcome TEXT,
  evidence_hash TEXT,
  challenger_address TEXT,
  bond_amount NUMERIC NOT NULL DEFAULT 0,
  transaction_hash TEXT,
  chain_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resolution_disputes_market_idx ON resolution_disputes (market_id, created_at ASC);

CREATE TABLE IF NOT EXISTS creators (
  handle TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  channel_url TEXT NOT NULL,
  preferred_games TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS creators_wallet_uidx ON creators (lower(wallet_address));

CREATE TABLE IF NOT EXISTS parlay_drafts (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  legs JSONB NOT NULL,
  naive_probability_bps INTEGER NOT NULL,
  correlation_warning TEXT,
  executable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parlay_drafts_address_idx ON parlay_drafts (lower(address), created_at DESC);

CREATE TABLE IF NOT EXISTS market_opportunities (
  id TEXT PRIMARY KEY,
  market_id TEXT REFERENCES markets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  probability_gap_bps INTEGER NOT NULL DEFAULT 0,
  liquidity_depth_usd NUMERIC NOT NULL DEFAULT 0,
  confidence NUMERIC NOT NULL DEFAULT 0,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('open', 'closed'))
);
CREATE INDEX IF NOT EXISTS market_opportunities_market_idx ON market_opportunities (market_id, created_at DESC);
