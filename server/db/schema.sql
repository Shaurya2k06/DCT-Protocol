-- DCT API persistence (Neon / PostgreSQL)
CREATE TABLE IF NOT EXISTS dct_audit (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dct_audit_created ON dct_audit (created_at DESC);
