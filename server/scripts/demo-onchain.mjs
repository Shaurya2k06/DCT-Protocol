#!/usr/bin/env node
/**
 * One command: new wallet → fund → ERC-8004 register → Biscuit mint →
 * DCTRegistry.registerDelegation (root) → DCTEnforcer execute → revoke,
 * with PostgreSQL audit rows when DATABASE_URL is set.
 *
 * Requires Base Sepolia addresses in server/addresses.json (chainId 84532).
 * Requires PRIVATE_KEY (funder) + ETH on Base Sepolia for the funder.
 *
 * Usage (from server/):
 *   node --experimental-wasm-modules scripts/demo-onchain.mjs
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import {
  setDCTContext,
  initRootKey,
  mintRootToken,
  execute,
  revoke,
  signNotaryAttestation,
} from "@shaurya2k06/dctsdk";
import { initDb, getPool, recordAudit } from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function normalizePk(pk) {
  if (!pk) return null;
  const s = String(pk).trim();
  return s.startsWith("0x") ? s : `0x${s}`;
}

async function audit(kind, payload) {
  try {
    await recordAudit(kind, payload);
  } catch (e) {
    console.warn("audit:", kind, e.message);
  }
}

async function main() {
  const expectedChain = 84532;
  const addrsPath = path.join(root, "addresses.json");
  const addrs = loadJson(addrsPath);
  if (Number(addrs.chainId) !== expectedChain) {
    console.error(
      `This demo expects server/addresses.json chainId ${expectedChain} (Base Sepolia). Got ${addrs.chainId}. Deploy + sync first.`
    );
    process.exit(1);
  }

  const funderPk = normalizePk(process.env.PRIVATE_KEY);
  if (!funderPk) {
    console.error("Set PRIVATE_KEY (funds the new demo wallet; deployer key on Base Sepolia).");
    process.exit(1);
  }

  const rpc =
    process.env.RPC_URL?.trim() ||
    (process.env.ALCHEMY_API_KEY
      ? `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      : null);
  if (!rpc) {
    console.error("Set RPC_URL or ALCHEMY_API_KEY for Base Sepolia.");
    process.exit(1);
  }

  await initDb();
  const dbUp = !!getPool();

  const provider = new ethers.JsonRpcProvider(rpc);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== expectedChain) {
    console.error(`Wrong network: chainId ${net.chainId} (expected ${expectedChain})`);
    process.exit(1);
  }

  const funder = new ethers.Wallet(funderPk, provider);

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" DCT on-chain demo — Base Sepolia");
  console.log("══════════════════════════════════════════════════════════════");

  console.log("\n[1] Funder (operator wallet)");
  console.log("    address:", funder.address);

  const demo = ethers.Wallet.createRandom().connect(provider);
  console.log("\n[2] New demo wallet (ERC-8004 + DCT signer)");
  console.log("    address:", demo.address);

  const fundEth = ethers.parseEther("0.00035");
  const fBal = await provider.getBalance(funder.address);
  if (fBal < fundEth + ethers.parseEther("0.00002")) {
    console.error("Funder ETH balance too low on Base Sepolia. Use a faucet.");
    process.exit(1);
  }

  console.log("\n[3] Funding demo wallet …");
  const fundTx = await funder.sendTransaction({ to: demo.address, value: fundEth });
  const fundRc = await fundTx.wait();
  console.log("    tx:", fundRc.hash);
  console.log("    block:", fundRc.blockNumber);
  await audit("demo.fund", { txHash: fundRc.hash, to: demo.address, valueWei: fundEth.toString() });

  const idAbi = loadJson(path.join(root, "abi", "IdentityRegistry.json")).abi;
  const regAbi = loadJson(path.join(root, "abi", "DCTRegistry.json")).abi;
  const enfAbi = loadJson(path.join(root, "abi", "DCTEnforcer.json")).abi;

  const erc8004 = new ethers.Contract(
    ethers.getAddress(addrs.ERC8004IdentityRegistry),
    idAbi,
    demo
  );
  const registry = new ethers.Contract(ethers.getAddress(addrs.DCTRegistry), regAbi, demo);
  const enforcer = new ethers.Contract(ethers.getAddress(addrs.DCTEnforcer), enfAbi, demo);

  console.log("\n[4] ERC-8004 register (demo wallet calls IdentityRegistry) …");
  const uri = `ipfs://dct-demo-${Date.now()}`;
  const regTx = await erc8004.register(uri);
  const regRc = await regTx.wait();
  let agentId = null;
  const iface = erc8004.interface;
  for (const log of regRc.logs) {
    try {
      const p = iface.parseLog(log);
      if (p?.name === "Registered") {
        agentId = p.args.agentId.toString();
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (agentId == null) throw new Error("Could not parse Registered event");
  console.log("    ERC-8004 agentId:", agentId);
  console.log("    tx:", regRc.hash);
  await audit("demo.erc8004.register", { agentId, txHash: regRc.hash, uri });

  setDCTContext({
    registry,
    enforcer,
    erc8004,
    signer: demo,
  });

  initRootKey();

  const toolName = "research";
  const allowedToolsList = [toolName, "web_fetch"];
  const spendLimitUsdc = 50_000_000;
  const maxDepth = 3;
  const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;

  console.log("\n[5] mintRootToken (Biscuit WASM) …");
  const minted = mintRootToken({
    agentId: String(agentId),
    allowedTools: allowedToolsList,
    spendLimitUsdc,
    maxDepth,
    expiresAt: expiresAtSec,
  });
  console.log("    revocationId:", minted.revocationId);
  await audit("demo.biscuit.mint", { agentId, revocationId: minted.revocationId });

  // Must match minted token metadata byte-for-byte for keccak256(abi.encode(scope))
  const scope = {
    allowedTools: allowedToolsList.map((t) => ethers.keccak256(ethers.toUtf8Bytes(t))),
    spendLimitUsdc: BigInt(spendLimitUsdc),
    maxDepth,
    expiresAt: expiresAtSec,
  };

  console.log("\n[6] DCTRegistry.registerDelegation (root — commits scope on-chain) …");
  const delTx = await registry.registerDelegation(
    ethers.ZeroHash,
    minted.revocationId,
    scope,
    BigInt(agentId)
  );
  const delRc = await delTx.wait();
  console.log("    tx:", delRc.hash);
  console.log("    block:", delRc.blockNumber);
  await audit("demo.delegation.register", { agentId, txHash: delRc.hash, revocationId: minted.revocationId });

  const notaryPk = normalizePk(process.env.NOTARY_PRIVATE_KEY || process.env.PRIVATE_KEY);
  const toolHash = ethers.keccak256(ethers.toUtf8Bytes(toolName));
  let tls = signNotaryAttestation(toolHash, notaryPk.replace(/^0x/, ""));
  if (!String(tls).startsWith("0x")) tls = `0x${tls}`;

  console.log("\n[7] execute → DCTEnforcer.validateActionWithScope …");
  const execResult = await execute({
    tokenB64: minted.serialized,
    agentTokenId: String(agentId),
    toolName,
    spendAmount: 1,
    tlsAttestation: tls,
  });
  console.log("    result:", JSON.stringify(execResult, null, 2));
  await audit("demo.execute", {
    agentId,
    success: execResult.success,
    txHash: execResult.txHash,
    stage: execResult.stage,
  });

  if (!execResult.success) {
    console.error("\nExecute failed — check notary key matches deployment notarySigner.");
    process.exit(1);
  }

  console.log("\n[8] revoke (DCTRegistry.revoke) …");
  const revResult = await revoke(minted.revocationId, String(agentId));
  console.log("    tx:", revResult.txHash, "block:", revResult.blockNumber);
  await audit("demo.revoke", { agentId, txHash: revResult.txHash });

  if (dbUp) {
    console.log("\n[9] Recent rows in PostgreSQL dct_audit …");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, kind, payload, created_at FROM dct_audit ORDER BY id DESC LIMIT 15`
    );
    for (const r of rows) {
      const preview = JSON.stringify(r.payload);
      const short = preview.length > 100 ? `${preview.slice(0, 100)}…` : preview;
      console.log(`    #${r.id} ${r.kind} @ ${r.created_at?.toISOString?.() ?? r.created_at}`);
      console.log(`       ${short}`);
    }
  } else {
    console.log("\n[9] DATABASE_URL unset — skipped DB listing (audit calls were no-ops).");
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" Done. Explorer: https://sepolia.basescan.org/address/" + demo.address);
  console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
