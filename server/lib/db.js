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
