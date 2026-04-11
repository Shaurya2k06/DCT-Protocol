/**
 * Optional PostgreSQL audit trail — no-op when DATABASE_URL is unset.
 */

import { recordAudit } from "./db.js";

/**
 * @param {string} kind
 * @param {object} [payload]
 * @param {import("express").Request} [req]
 */
export async function audit(kind, payload = {}, req) {
  const base =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...payload }
      : { value: payload };
  if (req?.ip) base.ip = req.ip;
  try {
    await recordAudit(kind, base);
  } catch (e) {
    console.warn("audit:", kind, e.message);
  }
}
