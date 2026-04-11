/**
 * Load env before any other server module reads process.env.
 * Default dotenv only reads `.env` from cwd — breaks when `npm start` runs from repo root.
 */
import { config } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

// Monorepo root .env (optional), then server/.env wins
config({ path: join(here, "..", ".env") });
config({ path: join(here, ".env"), override: true });
