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

from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

from trustScores import (
    ExecutionEvent,
    TaskExpectation,
    TrustProfile,
    compute_trust_profile,
    parse_tlsn_attestation,
)

# ---------------------------------------------------------------------------
# Config — edit here or set environment variables
# ---------------------------------------------------------------------------

CONFIG = {
    "rpc_url":          os.getenv("RPC_URL",          "http://127.0.0.1:8545"),
    "registry":         os.getenv("REGISTRY_ADDRESS", ""),
    "enforcer":         os.getenv("ENFORCER_ADDRESS", ""),
    "verifier":         os.getenv("VERIFIER_ADDRESS", ""),
    "notary_key":       os.getenv("NOTARY_PRIVATE_KEY", ""),
    "agent_key":        os.getenv("AGENT_PRIVATE_KEY",  ""),
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

    # Sign the raw digest (not EIP-191 prefixed — matches contract's recover())
    account      = Account.from_key(notary_key)
    signed       = account.sign_message(encode_defunct(digest))
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
) -> list[ExecutionEvent]:
    events: list[ExecutionEvent] = []
    now = datetime.now(timezone.utc)

    try:
        validated_logs = enforcer.events.ActionValidated.get_logs(
            from_block=from_block
        )
        for log in validated_logs:
            a = log["args"]
            # Get block timestamp for accurate time-decay in Signal 3
            block     = w3.eth.get_block(log["blockNumber"])
            timestamp = datetime.fromtimestamp(block["timestamp"], tz=timezone.utc)

            events.append(ExecutionEvent(
                agent_id       = a["agentTokenId"],
                tool           = Web3.to_hex(a["toolHash"]),
                scope_adhered  = True,
                completed      = False,   # Signal 2 applied separately
                spend_declared = a["spendAmount"],
                spend_limit    = 0,       # fetch from scopeCommitments if needed
                latency_ms     = 0,
                timestamp      = timestamp,
                response_body  = {},
            ))

        rejected_logs = enforcer.events.ActionRejected.get_logs(
            from_block=from_block
        )
        for log in rejected_logs:
            a         = log["args"]
            block     = w3.eth.get_block(log["blockNumber"])
            timestamp = datetime.fromtimestamp(block["timestamp"], tz=timezone.utc)

            events.append(ExecutionEvent(
                agent_id       = a["agentTokenId"],
                tool           = "",
                scope_adhered  = False,
                completed      = False,
                spend_declared = 0,
                spend_limit    = 0,
                latency_ms     = 0,
                timestamp      = timestamp,
                response_body  = {},
            ))

    except Exception as exc:
        print(f"[load_events_from_chain] warning: {exc}")

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
) -> TrustProfile:
    """
    Full pipeline:
      1. Read events from chain
      2. Read on-chain trust score for comparison
      3. Compute off-chain trust profile
      4. Print both for visibility
    """
    events  = load_events_from_chain(w3, enforcer, from_block)
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

    return profile


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

    # 4. Compute trust profile from chain events
    print("\n--- Computing trust profile ---")
    expectations = {
        "web_fetch": TaskExpectation(
            tool      = "web_fetch",
            validator = lambda body: len(body.get("content", "")) > 0,
        )
    }

    profile = get_trust_profile(
        w3             = w3,
        registry       = registry,
        enforcer       = enforcer,
        agent_token_id = 0,
        expectations   = expectations,
        from_block     = 0,
    )

    return profile


if __name__ == "__main__":
    # Write deploy script if it doesn't exist
    deploy_path = Path("script/Deploy.s.sol")
    if not deploy_path.exists():
        deploy_path.parent.mkdir(exist_ok=True)
        deploy_path.write_text(DEPLOY_SCRIPT)
        print(f"Wrote {deploy_path}")

    run_demo()