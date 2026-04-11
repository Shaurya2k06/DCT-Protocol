#!/usr/bin/env node
/**
 * Reads Foundry broadcast output and writes server + client address JSON for Base Sepolia (or Anvil).
 *
 * Usage:
 *   node scripts/sync-addresses-from-broadcast.mjs --chain 84532 --erc8004 0x8004...
 *
 * If the deploy used DEPLOY_LOCAL_IDENTITY_REGISTRY=true, ERC-8004 is taken from the TestAgentRegistry CREATE.
 * Otherwise pass --erc8004 (official Base Sepolia registry).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const chain = arg("--chain") || "84532";
const erc8004Cli = arg("--erc8004");
const broadcastPath = path.join(
  root,
  "broadcast",
  "DeployDCT.s.sol",
  String(parseInt(chain, 10)),
  "run-latest.json"
);

if (!fs.existsSync(broadcastPath)) {
  console.error("Missing:", broadcastPath);
  console.error("Run forge script with --broadcast first.");
  process.exit(1);
}

const run = JSON.parse(fs.readFileSync(broadcastPath, "utf-8"));
const txs = run.transactions || [];

let erc8004 = erc8004Cli?.trim() || null;
let usedLocalTestRegistry = false;
const proxies = [];

for (const t of txs) {
  if (t.transactionType !== "CREATE") continue;
  if (t.contractName === "TestAgentRegistry") {
    erc8004 = t.contractAddress;
    usedLocalTestRegistry = true;
  } else if (t.contractName === "ERC1967Proxy") {
    proxies.push(t.contractAddress);
  }
}

if (!erc8004) {
  console.error("Could not determine ERC8004 address. Pass --erc8004 0x...");
  process.exit(1);
}

if (proxies.length < 3) {
  console.error("Expected 3 ERC1967Proxy deployments (notary, registry, enforcer). Found:", proxies.length);
  process.exit(1);
}

const [notary, registry, enforcer] = proxies;
const variant = usedLocalTestRegistry ? "test" : "official";

const payload = {
  ERC8004IdentityRegistry: erc8004,
  NotaryAttestationVerifier: notary,
  DCTRegistry: registry,
  DCTEnforcer: enforcer,
  identityRegistryVariant: variant,
  chainId: Number.parseInt(chain, 10),
  network:
    chain === "84532"
      ? "base-sepolia"
      : chain === "31337"
        ? "anvil-local"
        : `chain-${chain}`,
  agents: [],
};

const serverPath = path.join(root, "..", "server", "addresses.json");
const clientPath = path.join(root, "..", "client", "src", "addresses.json");

fs.writeFileSync(serverPath, JSON.stringify(payload, null, 2) + "\n");
fs.writeFileSync(clientPath, JSON.stringify(payload, null, 2) + "\n");
console.log("Wrote", serverPath);
console.log("Wrote", clientPath);
