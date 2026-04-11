-- DCT API persistence (Neon / PostgreSQL)
CREATE TABLE IF NOT EXISTS dct_audit (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dct_audit_created ON dct_audit (created_at DESC);

CREATE TABLE IF NOT EXISTS agent_trust_profiles (
  agent_token_id BIGINT PRIMARY KEY,
  composite_score DOUBLE PRECISION NOT NULL,
  tier TEXT NOT NULL,
  signal_1 DOUBLE PRECISION,
  signal_2 DOUBLE PRECISION,
  signal_3 DOUBLE PRECISION,
  execution_count INTEGER NOT NULL,
  max_children INTEGER NOT NULL,
  max_depth INTEGER NOT NULL,
  max_spend_fraction DOUBLE PRECISION NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_trust_profiles_computed_at
  ON agent_trust_profiles (computed_at DESC);
