/**
 * Optional Neon PostgreSQL — enabled when DATABASE_URL is set.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool;

export async function initDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return null;
  }
  pool = new pg.Pool({
    connectionString: url,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  await pool.query(sql);
  return pool;
}

export function getPool() {
  return pool;
}

/** @param {string} kind @param {object} payload */
export async function recordAudit(kind, payload) {
  if (!pool) return;
  await pool.query(
    "INSERT INTO dct_audit (kind, payload) VALUES ($1, $2::jsonb)",
    [kind, JSON.stringify(payload)]
  );
}

/**
 * @param {number|string} agentTokenId
 * @param {object} profile
 */
export async function upsertTrustProfile(agentTokenId, profile) {
  if (!pool) return null;
  const p = profile || {};
  const result = await pool.query(
    `INSERT INTO agent_trust_profiles (
      agent_token_id,
      composite_score,
      tier,
      signal_1,
      signal_2,
      signal_3,
      execution_count,
      max_children,
      max_depth,
      max_spend_fraction,
      computed_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()
    )
    ON CONFLICT (agent_token_id)
    DO UPDATE SET
      composite_score = EXCLUDED.composite_score,
      tier = EXCLUDED.tier,
      signal_1 = EXCLUDED.signal_1,
      signal_2 = EXCLUDED.signal_2,
      signal_3 = EXCLUDED.signal_3,
      execution_count = EXCLUDED.execution_count,
      max_children = EXCLUDED.max_children,
      max_depth = EXCLUDED.max_depth,
      max_spend_fraction = EXCLUDED.max_spend_fraction,
      computed_at = now()
    RETURNING *`,
    [
      Number(agentTokenId),
      Number(p.composite_score),
      String(p.tier),
      p.signal_1 == null ? null : Number(p.signal_1),
      p.signal_2 == null ? null : Number(p.signal_2),
      p.signal_3 == null ? null : Number(p.signal_3),
      Number(p.execution_count),
      Number(p.max_children),
      Number(p.max_depth),
      Number(p.max_spend_fraction),
    ]
  );
  return result.rows[0] || null;
}

/** @param {number|string} agentTokenId */
export async function getLatestTrustProfile(agentTokenId) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT
      agent_token_id,
      composite_score,
      tier,
      signal_1,
      signal_2,
      signal_3,
      execution_count,
      max_children,
      max_depth,
      max_spend_fraction,
      computed_at
     FROM agent_trust_profiles
     WHERE agent_token_id = $1
     LIMIT 1`,
    [Number(agentTokenId)]
  );
  return result.rows[0] || null;
}
