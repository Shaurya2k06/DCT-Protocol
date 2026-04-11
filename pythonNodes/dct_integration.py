"""
DCT Integration Layer
=====================
Connects the Python trust score system to deployed Solidity contracts.

Stack:
  - Network      : Foundry local (anvil) or Base Sepolia
  - Contracts    : DCTRegistry, DCTEnforcer, NotaryAttestationVerifier
  - Trust score  : trust_score.py (Phase 1 — already passing)

Usage:
    # Start anvil first
    anvil

    # Deploy contracts
    forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

    # Run integration
    python dct_integration.py

Environment variables (or edit CONFIG below):
    RPC_URL                  default: http://127.0.0.1:8545
    REGISTRY_ADDRESS         DCTRegistry deployed address
    ENFORCER_ADDRESS         DCTEnforcer deployed address
    VERIFIER_ADDRESS         NotaryAttestationVerifier deployed address
    NOTARY_PRIVATE_KEY       private key of the notarySigner account
    AGENT_PRIVATE_KEY        private key of the agent wallet
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

from eth_account import Account
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

from trustScores import (
    ExecutionEvent,
    TaskExpectation,
    TrustProfile,
    compute_trust_profile,
    load_events_from_chain as _load_trust_events_from_chain,
    parse_tlsn_attestation,
)


def _load_local_env_file() -> None:
    """Load KEY=VALUE entries from .env in this directory if present."""
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for line in env_path.read_text().splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def _load_fallback_addresses() -> dict:
    """Best-effort address fallback from deployment artifacts."""
    base = Path(__file__).resolve().parent.parent
    candidates = [
        base / "contracts" / "deployment.json",
        base / "server" / "addresses.local-anvil.json",
        base / "server" / "addresses.json",
    ]
    for path in candidates:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text())
            contracts = data.get("contracts", {}) if isinstance(data, dict) else {}
            return {
                "registry": data.get("DCTRegistry") or contracts.get("DCTRegistry") or "",
                "enforcer": data.get("DCTEnforcer") or contracts.get("DCTEnforcer") or "",
                "verifier": data.get("NotaryAttestationVerifier")
                or contracts.get("NotaryAttestationVerifier")
                or "",
            }
        except Exception:
            continue
    return {"registry": "", "enforcer": "", "verifier": ""}


_load_local_env_file()
_ADDR_FALLBACK = _load_fallback_addresses()


def _discover_agent_ids(default: int = 0) -> list[int]:
    """
    Discover agent IDs from env and deployment artifacts.
    Priority: AGENT_TOKEN_IDS env, then known JSON files, then default.
    """
    discovered: list[int] = []

    env_ids = os.getenv("AGENT_TOKEN_IDS", "").strip()
    if env_ids:
        for raw in env_ids.split(","):
            item = raw.strip()
            if not item:
                continue
            try:
                discovered.append(int(item))
            except ValueError:
                pass

    base = Path(__file__).resolve().parent.parent
    candidates = [
        base / "contracts" / "deployment.json",
        base / "server" / "addresses.local-anvil.json",
        base / "server" / "addresses.json",
    ]
    for path in candidates:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text())
            if not isinstance(data, dict):
                continue
            for raw_id in data.get("agents", []):
                try:
                    discovered.append(int(raw_id))
                except (TypeError, ValueError):
                    pass
        except Exception:
            continue

    if not discovered:
        return [default]
    return sorted(set(discovered))

# ---------------------------------------------------------------------------
# Config — edit here or set environment variables
# ---------------------------------------------------------------------------

CONFIG = {
    "rpc_url":          os.getenv("RPC_URL",          "http://127.0.0.1:8545"),
    "registry":         os.getenv("REGISTRY_ADDRESS") or _ADDR_FALLBACK["registry"],
    "enforcer":         os.getenv("ENFORCER_ADDRESS") or _ADDR_FALLBACK["enforcer"],
    "verifier":         os.getenv("VERIFIER_ADDRESS") or _ADDR_FALLBACK["verifier"],
    "notary_key":       os.getenv("NOTARY_PRIVATE_KEY", ""),
    "agent_key":        os.getenv("AGENT_PRIVATE_KEY",  ""),
    "server_url":       os.getenv("DCT_SERVER_URL", "http://127.0.0.1:3000"),
    "server_api_key":   os.getenv("TRUST_PROFILE_API_KEY", ""),
}

# ---------------------------------------------------------------------------
# ABIs — minimal, only the functions we call
# ---------------------------------------------------------------------------

REGISTRY_ABI = [
    {
        "name": "registerDelegation",
        "type": "function",
        "inputs": [
            {"name": "parentId",          "type": "bytes32"},
            {"name": "childId",           "type": "bytes32"},
            {"name": "childScope",        "type": "tuple", "components": [
                {"name": "allowedTools",    "type": "bytes32[]"},
                {"name": "spendLimitUsdc",  "type": "uint256"},
                {"name": "maxDepth",        "type": "uint8"},
                {"name": "expiresAt",       "type": "uint64"},
            ]},
            {"name": "parentAgentTokenId","type": "uint256"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    {
        "name": "isRevoked",
        "type": "function",
        "inputs":  [{"name": "tokenId", "type": "bytes32"}],
        "outputs": [{"name": "",        "type": "bool"}],
        "stateMutability": "view",
    },
    {
        "name": "trustScore",
        "type": "function",
        "inputs":  [{"name": "agentTokenId", "type": "uint256"}],
        "outputs": [{"name": "",             "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "scopeCommitments",
        "type": "function",
        "inputs":  [{"name": "tokenId", "type": "bytes32"}],
        "outputs": [{"name": "",        "type": "bytes32"}],
        "stateMutability": "view",
    },
    {
        "name": "setEnforcer",
        "type": "function",
        "inputs":  [{"name": "_enforcer", "type": "address"}],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    # Events
    {
        "name": "DelegationRegistered",
        "type": "event",
        "inputs": [
            {"name": "parentId",      "type": "bytes32", "indexed": True},
            {"name": "childId",       "type": "bytes32", "indexed": True},
            {"name": "holderAgentId", "type": "uint256", "indexed": False},
        ],
    },
    {
        "name": "TrustUpdated",
        "type": "event",
        "inputs": [
            {"name": "agentId",   "type": "uint256", "indexed": True},
            {"name": "newScore",  "type": "uint256", "indexed": False},
            {"name": "violation", "type": "bool",    "indexed": False},
        ],
    },
]

ENFORCER_ABI = [
    {
        "name": "validateActionWithScope",
        "type": "function",
        "inputs": [
            {"name": "revocationId",    "type": "bytes32"},
            {"name": "agentTokenId",    "type": "uint256"},
            {"name": "toolHash",        "type": "bytes32"},
            {"name": "spendAmount",     "type": "uint256"},
            {"name": "tlsnAttestation", "type": "bytes"},
            {"name": "redeemer",        "type": "address"},
            {"name": "allowedTools",    "type": "bytes32[]"},
            {"name": "spendLimitUsdc",  "type": "uint256"},
            {"name": "maxDepth",        "type": "uint8"},
            {"name": "expiresAt",       "type": "uint64"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
    },
    # Events
    {
        "name": "ActionValidated",
        "type": "event",
        "inputs": [
            {"name": "revocationId", "type": "bytes32", "indexed": True},
            {"name": "agentTokenId", "type": "uint256", "indexed": True},
            {"name": "toolHash",     "type": "bytes32", "indexed": False},
            {"name": "spendAmount",  "type": "uint256", "indexed": False},
        ],
    },
    {
        "name": "ActionRejected",
        "type": "event",
        "inputs": [
            {"name": "revocationId", "type": "bytes32", "indexed": True},
            {"name": "agentTokenId", "type": "uint256", "indexed": True},
            {"name": "reason",       "type": "string",  "indexed": False},
        ],
    },
]

VERIFIER_ABI = [
    {
        "name": "verify",
        "type": "function",
        "inputs": [
            {"name": "attestation",         "type": "bytes"},
            {"name": "expectedEndpointHash","type": "bytes32"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
    },
    {
        "name": "notarySigner",
        "type": "function",
        "inputs":  [],
        "outputs": [{"name": "", "type": "address"}],
        "stateMutability": "view",
    },
]


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def connect(rpc_url: str) -> Web3:
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    # Required for Anvil / PoA chains
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to {rpc_url}")
    print(f"Connected to {rpc_url} — chain ID {w3.eth.chain_id}")
    return w3


def get_contracts(w3: Web3) -> tuple:
    missing = [
        key
        for key, value in {
            "REGISTRY_ADDRESS": CONFIG["registry"],
            "ENFORCER_ADDRESS": CONFIG["enforcer"],
            "VERIFIER_ADDRESS": CONFIG["verifier"],
        }.items()
        if not value
    ]
    if missing:
        raise ValueError(
            "Missing contract addresses: "
            + ", ".join(missing)
            + ". Set them in pythonNodes/.env or deployment files."
        )

    registry = w3.eth.contract(
        address = Web3.to_checksum_address(CONFIG["registry"]),
        abi     = REGISTRY_ABI,
    )
    enforcer = w3.eth.contract(
        address = Web3.to_checksum_address(CONFIG["enforcer"]),
        abi     = ENFORCER_ABI,
    )
    verifier = w3.eth.contract(
        address = Web3.to_checksum_address(CONFIG["verifier"]),
        abi     = VERIFIER_ABI,
    )
    return registry, enforcer, verifier


# ---------------------------------------------------------------------------
# Attestation production
# This is what your TLSNotary Rust prover produces.
# In production: call your notary server / parse TlsProof bytes.
# Here: sign with the notary key directly (same cryptographic operation).
# ---------------------------------------------------------------------------

def produce_attestation(
    tool:         str,
    notary_key:   str,
    w3:           Web3,
) -> bytes:
    """
    Produce a 65-byte ECDSA attestation over:
        digest = keccak256(abi.encodePacked("DCT_TLSN", keccak256(tool)))

    This matches exactly what NotaryAttestationVerifier.verify() checks.
    In production this signature comes from your TLSNotary notary server.
    """
    tool_hash    = Web3.keccak(text=tool)
    packed       = b"DCT_TLSN" + tool_hash
    digest       = Web3.keccak(packed)

    # Contract recovers directly from this digest, so sign the digest bytes directly.
    signed       = Account._sign_hash(digest, private_key=notary_key)
    attestation  = signed.signature

    print(f"  Attestation produced for tool '{tool}': {attestation.hex()[:20]}...")
    return bytes(attestation)


def verify_attestation_locally(
    verifier,
    attestation: bytes,
    tool:        str,
) -> bool:
    """
    Call NotaryAttestationVerifier.verify() as a view call before
    submitting the full transaction. Catches invalid attestations
    before wasting gas.
    """
    tool_hash = Web3.keccak(text=tool)
    result    = verifier.functions.verify(attestation, tool_hash).call()
    print(f"  Local attestation check for '{tool}': {'PASS' if result else 'FAIL'}")
    return result


# ---------------------------------------------------------------------------
# On-chain operations
# ---------------------------------------------------------------------------

def register_delegation(
    w3:            Web3,
    registry,
    agent_key:     str,
    parent_id:     bytes,
    child_id:      bytes,
    tools:         list[str],
    spend_limit:   int,
    max_depth:     int,
    agent_token_id: int,
) -> str:
    account    = Account.from_key(agent_key)
    tool_hashes = [Web3.keccak(text=t) for t in tools]

    scope = (
        tool_hashes,
        spend_limit,
        max_depth,
        int(time.time()) + 3600,
    )

    tx = registry.functions.registerDelegation(
        parent_id,
        child_id,
        scope,
        agent_token_id,
    ).build_transaction({
        "from":  account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas":   300_000,
    })

    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    print(f"  registerDelegation tx: {tx_hash.hex()} — status: {receipt.status}")
    return tx_hash.hex()


def execute_action(
    w3:            Web3,
    enforcer,
    verifier,
    agent_key:     str,
    notary_key:    str,
    revocation_id: bytes,
    agent_token_id: int,
    tool:          str,
    spend_amount:  int,
    allowed_tools: list[str],
    spend_limit:   int,
    max_depth:     int,
) -> tuple[bool, str]:
    """
    Full execution flow:
      1. Produce TLSNotary attestation
      2. Verify locally (no gas wasted on bad attestation)
      3. Submit validateActionWithScope transaction
      4. Return (success, tx_hash)
    """
    account      = Account.from_key(agent_key)
    tool_hash    = Web3.keccak(text=tool)
    tool_hashes  = [Web3.keccak(text=t) for t in allowed_tools]
    attestation  = produce_attestation(tool, notary_key, w3)

    # Pre-flight check
    if not verify_attestation_locally(verifier, attestation, tool):
        print("  Attestation failed local check — aborting")
        return False, ""

    tx = enforcer.functions.validateActionWithScope(
        revocation_id,
        agent_token_id,
        tool_hash,
        spend_amount,
        attestation,
        account.address,
        tool_hashes,
        spend_limit,
        max_depth,
        int(time.time()) + 3600,
    ).build_transaction({
        "from":  account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas":   400_000,
    })

    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    success = receipt.status == 1
    print(f"  validateActionWithScope tx: {tx_hash.hex()} — {'SUCCESS' if success else 'FAILED'}")
    return success, tx_hash.hex()


# ---------------------------------------------------------------------------
# Event reader — pulls chain events into ExecutionEvent records
# ---------------------------------------------------------------------------

def load_events_from_chain(
    w3:        Web3,
    enforcer,
    from_block: int = 0,
    delegation_scope_hints: Optional[dict[str, int]] = None,
) -> list[ExecutionEvent]:
    """
    Pull ActionValidated / ActionRejected into ExecutionEvents (shared logic in trustScores).

    delegation_scope_hints: map Web3.to_hex(revocationId) -> spendLimitUsdc from registration;
    commitments are hashed on-chain so limits must be supplied out-of-band.
    """
    events = _load_trust_events_from_chain(
        enforcer,
        from_block=from_block,
        w3=w3,
        delegation_scope_hints=delegation_scope_hints,
    )
    print(f"  Loaded {len(events)} events from chain (from block {from_block})")
    return events


# ---------------------------------------------------------------------------
# Trust score bridge
# Connects chain events to compute_trust_profile
# ---------------------------------------------------------------------------

def get_trust_profile(
    w3:            Web3,
    registry,
    enforcer,
    agent_token_id: int,
    expectations:  dict[str, TaskExpectation],
    from_block:    int = 0,
    preloaded_events: Optional[list[ExecutionEvent]] = None,
    delegation_scope_hints: Optional[dict[str, int]] = None,
) -> TrustProfile:
    """
    Full pipeline:
      1. Read events from chain
      2. Read on-chain trust score for comparison
      3. Compute off-chain trust profile
      4. Print both for visibility
    """
    events = (
        preloaded_events
        if preloaded_events is not None
        else load_events_from_chain(w3, enforcer, from_block, delegation_scope_hints=delegation_scope_hints)
    )
    profile = compute_trust_profile(
        agent_token_id,
        events,
        expectations,
        now=datetime.now(timezone.utc),
    )

    # On-chain score for comparison (1e18 = baseline)
    on_chain_score = registry.functions.trustScore(agent_token_id).call()

    print(f"\n  Trust profile for agent {agent_token_id}:")
    print(f"    Tier              : {profile.tier.name}")
    print(f"    Composite score   : {profile.composite_score:.3f}")
    print(f"    Signal 1 (scope)  : {profile.signal_1}")
    print(f"    Signal 2 (tasks)  : {profile.signal_2}")
    print(f"    Signal 3 (quality): {profile.signal_3}")
    print(f"    Max children      : {profile.max_children}")
    print(f"    Max depth         : {profile.max_depth}")
    print(f"    Max spend fraction: {profile.max_spend_fraction}")
    print(f"    On-chain score    : {on_chain_score / 1e18:.3f}x baseline")

    persist_trust_profile(profile, CONFIG["server_url"], CONFIG["server_api_key"])

    return profile


def persist_trust_profile(
    profile: TrustProfile,
    server_url: str,
    api_key: str = "",
) -> bool:
    """
    Persist the latest off-chain TrustProfile through the Node API.
    The server route then upserts into Neon/PostgreSQL.
    """
    if not server_url:
        return False

    payload = {
        "source": "python.dct_integration",
        "profile": {
            "composite_score": profile.composite_score,
            "tier": profile.tier.name,
            "signal_1": profile.signal_1,
            "signal_2": profile.signal_2,
            "signal_3": profile.signal_3,
            "execution_count": profile.execution_count,
            "max_children": profile.max_children,
            "max_depth": profile.max_depth,
            "max_spend_fraction": profile.max_spend_fraction,
        },
    }

    url = f"{server_url.rstrip('/')}/api/agents/{profile.agent_id}/trust-profile"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["x-trust-profile-key"] = api_key

    req = Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urlopen(req, timeout=10) as resp:
            if 200 <= resp.status < 300:
                print(f"  Persisted trust profile to API: {url}")
                return True
            print(f"  Persist trust profile failed with status {resp.status}")
            return False
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore") if exc.fp else ""
        print(f"  Persist trust profile HTTP {exc.code}: {body[:200]}")
        return False
    except URLError as exc:
        print(f"  Persist trust profile network error: {exc}")
        return False


# ---------------------------------------------------------------------------
# Foundry deployment script helper
# Writes a Solidity deploy script if you don't have one yet
# ---------------------------------------------------------------------------

DEPLOY_SCRIPT = """// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Script.sol";
import "../src/TestAgentRegistry.sol";
import "../src/DCTRegistry.sol";
import "../src/DCTEnforcer.sol";
import "../src/NotaryAttestationVerifier.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address notarySigner = vm.envAddress("NOTARY_SIGNER");
        vm.startBroadcast(deployerKey);

        TestAgentRegistry erc8004   = new TestAgentRegistry();
        NotaryAttestationVerifier v = new NotaryAttestationVerifier(notarySigner);
        DCTRegistry registry        = new DCTRegistry(address(erc8004));
        DCTEnforcer enforcer        = new DCTEnforcer(
            address(registry),
            address(erc8004),
            address(v)
        );

        // Wire enforcer into registry
        registry.setEnforcer(address(enforcer));

        vm.stopBroadcast();

        // Print addresses for environment variables
        console.log("ERC8004_ADDRESS  =", address(erc8004));
        console.log("VERIFIER_ADDRESS =", address(v));
        console.log("REGISTRY_ADDRESS =", address(registry));
        console.log("ENFORCER_ADDRESS =", address(enforcer));
    }
}
"""


# ---------------------------------------------------------------------------
# Demo run — shows the full pipeline end to end
# ---------------------------------------------------------------------------

def run_demo():
    print("=== DCT Integration Demo ===\n")

    # 1. Connect
    w3                           = connect(CONFIG["rpc_url"])
    registry, enforcer, verifier = get_contracts(w3)

    # Use Anvil's default funded accounts if no keys provided
    if not CONFIG["agent_key"]:
        # Anvil default account 0 private key
        CONFIG["agent_key"]  = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    if not CONFIG["notary_key"]:
        # Anvil default account 1 private key
        CONFIG["notary_key"] = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

    agent_account  = Account.from_key(CONFIG["agent_key"])
    notary_account = Account.from_key(CONFIG["notary_key"])
    print(f"Agent address  : {agent_account.address}")
    print(f"Notary address : {notary_account.address}")

    # Verify notary signer matches contract
    contract_notary = verifier.functions.notarySigner().call()
    if contract_notary.lower() != notary_account.address.lower():
        print(f"\nWARNING: Contract notarySigner ({contract_notary}) does not match")
        print(f"         your NOTARY_PRIVATE_KEY address ({notary_account.address})")
        print("         Attestation verification will fail.")
        print("         Redeploy with correct notarySigner or update NOTARY_PRIVATE_KEY\n")

    # 2. Register a delegation (agent token ID 0 assumed — mint first in production)
    print("\n--- Registering delegation ---")
    parent_id = Web3.keccak(text="demo-root")
    child_id  = Web3.keccak(text="demo-child-1")
    scope_hints = {Web3.to_hex(child_id).lower(): 10_000_000}

    register_delegation(
        w3            = w3,
        registry      = registry,
        agent_key     = CONFIG["agent_key"],
        parent_id     = parent_id,
        child_id      = child_id,
        tools         = ["web_fetch"],
        spend_limit   = 10_000_000,
        max_depth     = 3,
        agent_token_id = 0,
    )

    # 3. Execute a valid action
    print("\n--- Executing action ---")
    success, tx_hash = execute_action(
        w3             = w3,
        enforcer       = enforcer,
        verifier       = verifier,
        agent_key      = CONFIG["agent_key"],
        notary_key     = CONFIG["notary_key"],
        revocation_id  = child_id,
        agent_token_id = 0,
        tool           = "web_fetch",
        spend_amount   = 1_000_000,
        allowed_tools  = ["web_fetch"],
        spend_limit    = 10_000_000,
        max_depth      = 3,
    )

    # 4. Compute trust profile(s) from chain events
    print("\n--- Computing trust profile(s) ---")
    expectations = {
        "web_fetch": TaskExpectation(
            tool      = "web_fetch",
            validator = lambda body: len(body.get("content", "")) > 0,
        )
    }

    events = load_events_from_chain(w3, enforcer, from_block=0, delegation_scope_hints=scope_hints)
    agent_ids = _discover_agent_ids(default=0)
    for event_agent_id in sorted({int(e.agent_id) for e in events}):
        if event_agent_id not in agent_ids:
            agent_ids.append(event_agent_id)

    print(f"  Agent IDs to score: {agent_ids}")

    profiles: list[TrustProfile] = []
    for agent_id in agent_ids:
        profile = get_trust_profile(
            w3                       = w3,
            registry                 = registry,
            enforcer                 = enforcer,
            agent_token_id           = agent_id,
            expectations             = expectations,
            from_block               = 0,
            preloaded_events         = events,
            delegation_scope_hints   = scope_hints,
        )
        profiles.append(profile)

    return profiles


if __name__ == "__main__":
    # Write deploy script if it doesn't exist
    deploy_path = Path("script/Deploy.s.sol")
    if not deploy_path.exists():
        deploy_path.parent.mkdir(exist_ok=True)
        deploy_path.write_text(DEPLOY_SCRIPT)
        print(f"Wrote {deploy_path}")

    run_demo()