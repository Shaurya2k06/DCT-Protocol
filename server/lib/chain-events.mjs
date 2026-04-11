/**
 * chain-events.mjs — On-chain event subscription via ethers.js WebSocket provider.
 *
 * Subscribes to DCTRegistry (DelegationRegistered, DelegationRevoked, TrustUpdated)
 * and DCTEnforcer (ActionValidated) when a WebSocket RPC is available.
 *
 * Falls back to HTTP polling (getLogs) at 6s intervals when WS is unavailable.
 *
 * Usage: import { subscribeChainEvents, chainEvents } from './chain-events.mjs'
 */

import { EventEmitter } from "events";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveHttpRpcUrl, resolveWsRpcUrl } from "./rpc-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const chainEvents = new EventEmitter();

let _started = false;
let _pollHandle = null;
let _lastBlock = 0n;

// ── ABI fragments we care about ────────────────────────────────────────────
const REGISTRY_ABI = [
  "event DelegationRegistered(bytes32 indexed parentId, bytes32 indexed childId, uint256 parentAgentTokenId)",
  "event DelegationRevoked(bytes32 indexed tokenId, uint256 indexed agentTokenId)",
  "event TrustUpdated(uint256 indexed agentTokenId, uint256 newScore, bool wasViolation)",
];
const ENFORCER_ABI = [
  "event ActionValidated(bytes32 indexed revocationId, uint256 indexed agentTokenId, bool passed)",
];

function loadAddresses() {
  const candidates = [
    path.join(__dirname, "..", "addresses.json"),
    path.join(__dirname, "..", "addresses.base-sepolia.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  }
  return {};
}

function wsRpcUrl() {
  return resolveWsRpcUrl();
}

function httpRpcUrl() {
  return resolveHttpRpcUrl();
}

function emit(type, data) {
  chainEvents.emit("event", { type, ...data, ts: Date.now() });
}

function attachContractListeners(provider, addrs) {
  const registryAddr = addrs.DCTRegistry;
  const enforcerAddr = addrs.DCTEnforcer;

  if (registryAddr) {
    const reg = new ethers.Contract(registryAddr, REGISTRY_ABI, provider);

    reg.on("DelegationRegistered", (parentId, childId, parentAgentTokenId, ev) => {
      emit("DelegationRegistered", {
        parentId,
        childId,
        agentId: parentAgentTokenId.toString(),
        txHash: ev.log?.transactionHash,
        blockNumber: ev.log?.blockNumber,
      });
    });

    reg.on("DelegationRevoked", (tokenId, agentTokenId, ev) => {
      emit("DelegationRevoked", {
        tokenId,
        agentId: agentTokenId.toString(),
        txHash: ev.log?.transactionHash,
        blockNumber: ev.log?.blockNumber,
      });
    });

    reg.on("TrustUpdated", (agentTokenId, newScore, wasViolation, ev) => {
      emit("TrustUpdated", {
        agentId: agentTokenId.toString(),
        newScore: newScore.toString(),
        wasViolation,
        txHash: ev.log?.transactionHash,
        blockNumber: ev.log?.blockNumber,
      });
    });
  }

  if (enforcerAddr) {
    const enf = new ethers.Contract(enforcerAddr, ENFORCER_ABI, provider);
    enf.on("ActionValidated", (revocationId, agentTokenId, passed, ev) => {
      emit("ActionValidated", {
        revocationId,
        agentId: agentTokenId.toString(),
        passed,
        txHash: ev.log?.transactionHash,
        blockNumber: ev.log?.blockNumber,
      });
    });
  }
}

// ── HTTP polling fallback ───────────────────────────────────────────────────
async function pollLogs(provider, addrs) {
  try {
    const latest = await provider.getBlockNumber();
    const fromBlock = _lastBlock > 0n ? _lastBlock + 1n : BigInt(latest) - 5n;
    if (BigInt(latest) < fromBlock) return;

    const ifaces = {
      registry: new ethers.Interface(REGISTRY_ABI),
      enforcer: new ethers.Interface(ENFORCER_ABI),
    };

    const targets = [
      { addr: addrs.DCTRegistry, iface: ifaces.registry },
      { addr: addrs.DCTEnforcer, iface: ifaces.enforcer },
    ].filter((t) => t.addr);

    for (const { addr, iface } of targets) {
      const logs = await provider.getLogs({
        address: addr,
        fromBlock: Number(fromBlock),
        toBlock: latest,
      });
      for (const log of logs) {
        try {
          const parsed = iface.parseLog(log);
          if (!parsed) continue;
          const args = {};
          parsed.fragment.inputs.forEach((inp, i) => {
            const v = parsed.args[i];
            args[inp.name] = typeof v === "bigint" ? v.toString() : v;
          });
          emit(parsed.name, { ...args, txHash: log.transactionHash, blockNumber: log.blockNumber });
        } catch {}
      }
    }
    _lastBlock = BigInt(latest);
  } catch (e) {
    // Silently swallow; polling continues.
    console.debug("[chain-events] poll error:", e.message);
  }
}

export async function subscribeChainEvents() {
  if (_started) return;
  _started = true;

  const addrs = loadAddresses();
  if (!addrs.DCTRegistry && !addrs.DCTEnforcer) {
    console.warn("[chain-events] no contract addresses found; event stream disabled");
    return;
  }

  const wsUrl = wsRpcUrl();

  if (wsUrl) {
    try {
      const provider = new ethers.WebSocketProvider(wsUrl);
      provider.websocket?.on?.("error", (e) => {
        console.warn("[chain-events] WS error:", e?.message);
      });
      attachContractListeners(provider, addrs);
      console.log("  Events:   WebSocket listener active (on-chain)");
      return;
    } catch (e) {
      console.warn("[chain-events] WS setup failed, falling back to polling:", e.message);
    }
  }

  // HTTP polling fallback (every 6 s)
  const httpUrl = httpRpcUrl();
  if (!httpUrl) {
    console.warn("[chain-events] no RPC URL; event stream disabled");
    return;
  }
  const provider = new ethers.JsonRpcProvider(httpUrl);
  _pollHandle = setInterval(() => pollLogs(provider, addrs), 6_000);
  console.log("  Events:   HTTP polling fallback (6s interval)");
}
