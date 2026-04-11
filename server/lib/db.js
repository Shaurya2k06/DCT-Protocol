/**
 * Optional Neon PostgreSQL — enabled when DATABASE_URL is set.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool;
let warnedMissingDb;

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

/** Coerce API / SDK trust profile into DB row (avoids NaN / undefined tier breaking INSERT). */
export function normalizeTrustProfileRow(raw) {
  const p = raw || {};
  const num = (x, fallback = 0) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  };
  const optNum = (x) => {
    if (x == null || x === "") return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const tier =
    typeof p.tier === "string" && p.tier.length > 0 && p.tier !== "undefined"
      ? p.tier
      : "COLD";
  return {
    composite_score: num(p.composite_score, 0),
    tier,
    signal_1: optNum(p.signal_1),
    signal_2: optNum(p.signal_2),
    signal_3: optNum(p.signal_3),
    execution_count: Math.max(0, Math.floor(num(p.execution_count, 0))),
    max_children: Math.max(0, Math.floor(num(p.max_children ?? 1, 1))),
    max_depth: Math.max(0, Math.floor(num(p.max_depth ?? 1, 1))),
    max_spend_fraction: num(p.max_spend_fraction, 0.1),
  };
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
  const p = normalizeTrustProfileRow(profile);
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
      p.composite_score,
      p.tier,
      p.signal_1,
      p.signal_2,
      p.signal_3,
      p.execution_count,
      p.max_children,
      p.max_depth,
      p.max_spend_fraction,
    ]
  );
  return result.rows[0] || null;
}

/**
 * @deprecated Prefer syncTrustProfileToDb — kept for callers that need the old “skip COLD” behavior.
 */
export async function upsertTrustProfileFromComputed(agentTokenId, computed) {
  if (!pool) return null;
  const n = Number(computed?.execution_count ?? 0);
  if (n < 1) return null;
  return upsertTrustProfile(agentTokenId, computed);
}

/**
 * Persist the same DCT profile the API returns (always upserts; matches GET /api/trust JSON).
 */
export async function syncTrustProfileToDb(agentTokenId, computed) {
  if (!pool) {
    if (!warnedMissingDb) {
      warnedMissingDb = true;
      console.warn(
        "[db] DATABASE_URL not set or DB init failed — trust profiles are not persisted (set DATABASE_URL in server .env)"
      );
    }
    return { ok: false, reason: "no_database" };
  }
  try {
    const row = await upsertTrustProfile(agentTokenId, computed);
    if (process.env.TRUST_DB_DEBUG === "1") {
      console.info("[db] trust upsert", { agentTokenId, tier: row?.tier, execution_count: row?.execution_count });
    }
    return { ok: true, row };
  } catch (e) {
    console.error("[db] syncTrustProfileToDb failed:", e.message);
    return { ok: false, reason: e.message };
  }
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
