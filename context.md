
---

# DCT Protocol
## Delegated Capability Tokens
### Technical Whitepaper v1.0 — April 2026

---

## Abstract

DCT is a trustless delegation primitive for autonomous multi-agent systems. It enables an agent to cryptographically delegate a provably attenuated subset of its authority to another agent, who may further delegate a narrower subset, forming a verifiable chain where authority only ever narrows. A single on-chain write from any ancestor invalidates every downstream agent at execution time through lazy lineage traversal. DCT fills the precise gap between agent identity (ERC-8004) and agent action (x402 payments, tool calls) — composing with both without replacing either.

---

## 1. The Problem

Every multi-agent framework in production today handles delegation identically and incorrectly. In CrewAI, AutoGen, MetaGPT, and similar systems, when an orchestrator spawns a sub-agent, the child either inherits the parent's full credentials or receives its own independent key. No framework implements cryptographic scope narrowing, depth limits, or cascade revocation for delegated access.

The consequence is structural: when an orchestrator spawns ten specialist sub-agents, each carries the same authority as the orchestrator. A single compromised sub-agent is a full compromise. And when something goes wrong, by the third delegation hop there is no cryptographic link to the initiating agent or user — malicious agents can forge delegation claims and access resources they shouldn't reach.

The existing infrastructure almost solves this but not quite:

- **ERC-7710** supports chained delegation redemption — `redeemDelegations` enables users to redelegate permissions that have been delegated to them, creating a chain of delegations across trusted parties. But it has no tree-level cascade revocation. Disabling one delegation does not propagate to children. Each delegation is independently managed.
- **ERC-8004** gives agents verifiable identity on-chain. But AI agents are moving from experiments to systems that touch real-world value: payments, data access, and automated decision-making. Designers built most trust models for humans — they assume slow-moving identity, institutional accountability, and legible intent. Agent-to-agent interaction breaks those assumptions.
- **x402** gives agents payment rails. But paying for a tool call and being authorized to make that tool call are different problems.

**DCT closes the gap:** cryptographically attenuating authority at every delegation hop, with a single O(1) write that cascades lazily through the entire downstream lineage at execution time.

```
ERC-8004 (identity) + x402 (payment rails) + ERC-7710 (delegation redemption)
         + ???
= trustless multi-agent delegation

DCT fills the ???
```

---

## 2. Design Principles

**Authority only narrows.** Biscuit's Datalog semantics make this a cryptographic guarantee, not a convention. A child agent cannot construct a token with wider scope than its parent. There is no API call to upgrade permissions.

**Revocation is lazy and gas-efficient.** Rather than actively destroying every child token when a parent is revoked — a recursive call that hits gas limits at scale — DCT uses lazy revocation. Each child checks whether any ancestor in its lineage is revoked at the moment of execution. One SLOAD per ancestor hop. No recursion in the hot path. No gas bomb.

**No trusted intermediary.** No auth server, no oracle, no arbiter. Proof of authority is in the token. Revocation state is on-chain. Action verification uses MPC-TLS (TLSNotary). The smart contract is the only judge.

**Composable with the existing stack.** DCT is a custom caveat enforcer inside ERC-7710's DelegationManager. The Delegation Framework is an extensible permissions system that allows the sharing of authority in a flexible and attenuable way where delegations enable safe composition with other contracts. DCT extends it with the cross-agent-tree revocation primitive that ERC-7710 deliberately leaves to implementors.

---

## 3. Architecture

```
                    USER (root authority)
                         │
                         │  1. Signs root Biscuit DCT (Ed25519)
                         │  2. Registers lineage root in DCTRegistry
                         ▼
              ┌─────────────────────┐
              │    DCTRegistry.sol  │ ← Lineage tree + lazy revocation flags
              │    (novel contract) │ ← Trust scores per ERC-8004 agent
              └──────────┬──────────┘
                         │ consulted at every execution
                         ▼
              ┌─────────────────────┐
              │   DCTEnforcer.sol   │ ← Custom ERC-7710 caveat enforcer
              │  (novel contract)   │ ← Validates: revocation, identity,
              └──────────┬──────────┘   scope, zkTLS proof
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       Agent A        Agent B        Agent C
  (Biscuit block 0) (block 0+1)  (block 0+1+2)
  tools: [all]      tools:[fetch]  tools:[fetch]
  spend: ≤50 USDC   spend: ≤10    spend: ≤2
  depth: 3          depth: 2       depth: 1
          │
          └── Each attenuation happens OFFLINE
              Zero server calls. Pure cryptography.
```

---

## 4. Layer 1 — Off-Chain Token: Eclipse Biscuit

### Why Biscuit

The core requirement for multi-agent delegation is **offline attenuation**: Agent A must be able to produce a strictly narrower token for Agent B without contacting any server. This rules out:

- **JWT**: Cannot be attenuated. Requires the original issuer to sign a new token.
- **OAuth 2.0**: Requires the auth server to issue every token. Breaks in autonomous, decentralized systems.
- **Macaroons**: HMAC-based with a shared root secret — anyone knowing the root can forge any token in the chain.

Eclipse Biscuit provides flexible authorization in distributed systems. Inspired by macaroons, it improves on their limitations by providing public key cryptography and a structured authorization language while still providing offline attenuation. Eclipse Biscuit provides an authorization token with decentralized verification, offline attenuation and strong security policy enforcement based on a logic language.

The library wraps the Rust implementation of Eclipse Biscuit tokens in WebAssembly, for usage in NodeJS and browsers. It provides both EcmaScript and CommonJS modules, along with TypeScript type definitions.

Each block in the Biscuit chain is signed by the **appending agent's ephemeral Ed25519 key**. The root public key verifies the entire chain. No shared secrets. No server roundtrip. Offline verification at every hop.

> ⚠️ **NodeJS runtime flag required:** Support for WebAssembly modules in NodeJS is disabled by default and needs to be explicitly enabled with a command-line flag: `node --experimental-wasm-modules index.js`.

### DCT Token Structure

```datalog
// Authority Block — signed by root Ed25519 key
// Establishes the maximum possible scope for the entire chain
agent_erc8004_id("42");               // ERC-8004 token ID of root agent
allowed_tool("research");
allowed_tool("web_fetch");
allowed_tool("x402_pay");
spend_limit_usdc(50000000);           // 50 USDC (6 decimals)
max_depth(3);
expires_at(1745280000);               // Unix timestamp
scope_commitment("0xabc...");         // keccak256 of Scope struct (mirrors on-chain)

// Attenuation Block 1 — appended offline by Agent A for Agent B
// Agent A's ephemeral key signs this block
check if allowed_tool($t), $t == "web_fetch";  // research stripped
check if spend_usdc($s), $s <= 10000000;        // 50→10 USDC
check if agent_erc8004_id($id), $id == "87";   // bound to specific agent
check if time($t), $t < 1745280000;

// Attenuation Block 2 — appended offline by Agent B for Agent C
check if spend_usdc($s), $s <= 2000000;         // 10→2 USDC
check if agent_erc8004_id($id), $id == "193";
```

The Datalog evaluator enforces that every `check if` in every block passes before authorizing any action. Scope widening is not expressible in the language — it is a cryptographic impossibility, not a convention.

**References:**
- Docs: `doc.biscuitsec.org` · NodeJS guide: `doc.biscuitsec.org/usage/nodejs.html`
- GitHub: `github.com/eclipse-biscuit/biscuit-wasm`
- NPM: `npm install @biscuit-auth/biscuit-wasm`
- License: Apache 2.0

---

## 5. Layer 2 — On-Chain Registry: DCTRegistry.sol

### What ERC-7710 Does and Doesn't Provide

The Delegation Manager validates delegations and triggers executions on behalf of the delegator, ensuring tasks are executed accurately and securely. When a delegation is redeemed, the Delegation Manager performs the following steps. A Delegation enables the ability to share the capability to invoke some onchain action entirely offchain in a secure manner. Caveats can be combined to create delegations with restricted functionality that users can extend, share or redeem.

What ERC-7710 does **not** provide: when delegation B (a child of A) is disabled, delegation C (a child of B) remains valid. Each delegation is an independently managed record with no cross-tree lineage concept. DCTRegistry is exactly and only that — the cross-agent revocation tree that ERC-7710 deliberately leaves to implementors.

### Lazy Revocation Design

The lazy revocation pattern eliminates the gas bomb problem entirely. When you call `revoke(tokenId)`, it is a single O(1) write. Children are not actively killed — they simply fail `isRevoked()` at execution time, which walks up the lineage chain until it finds a revoked ancestor or reaches the root.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC8004 {
    function ownerOf(uint256 tokenId) external view returns (address);
}

struct Scope {
    bytes32[] allowedTools;    // keccak256(tool name) — no string comparison
    uint256   spendLimitUsdc;  // 6-decimal USDC
    uint8     maxDepth;
    uint64    expiresAt;
}

contract DCTRegistry is ReentrancyGuard {
    IERC8004 public immutable erc8004;
    address  public immutable enforcer;

    // Biscuit revocationId → directly revoked (by owner action)
    mapping(bytes32 => bool) public directlyRevoked;

    // revocationId → parent revocationId (lineage, set at registration)
    mapping(bytes32 => bytes32) public parentOf;

    // revocationId → committed Scope hash
    mapping(bytes32 => bytes32) public scopeCommitments;

    // revocationId → which ERC-8004 agent holds this token
    mapping(bytes32 => uint256) public holderAgent;

    // ERC-8004 agentTokenId → trust score (1e18 = baseline, 2e18 = max)
    mapping(uint256 => uint256) public trustScore;

    uint256 public constant BASE_TRUST  = 1e18;
    uint8   public constant MAX_DEPTH   = 8;    // hard ceiling
    uint256 public constant DECAY_NUM   = 90;
    uint256 public constant DECAY_DENOM = 100;

    event DelegationRegistered(
        bytes32 indexed parentId,
        bytes32 indexed childId,
        uint256 holderAgentId
    );
    event TokenRevoked(bytes32 indexed revocationId, address revokedBy);
    event TrustUpdated(uint256 indexed agentId, uint256 newScore, bool violation);

    modifier onlyEnforcer() {
        require(msg.sender == enforcer, "DCT: only enforcer");
        _;
    }

    constructor(address _erc8004, address _enforcer) {
        erc8004  = IERC8004(_erc8004);
        enforcer = _enforcer;
    }

    function registerDelegation(
        bytes32        parentId,
        bytes32        childId,
        Scope calldata childScope,
        uint256        parentAgentTokenId
    ) external nonReentrant {
        require(
            erc8004.ownerOf(parentAgentTokenId) == msg.sender,
            "DCT: not agent owner"
        );
        require(!isRevoked(parentId), "DCT: parent revoked");
        require(_depth(childId) < MAX_DEPTH, "DCT: max depth exceeded");

        parentOf[childId]         = parentId;
        scopeCommitments[childId] = keccak256(abi.encode(childScope));
        holderAgent[childId]      = parentAgentTokenId;

        if (trustScore[parentAgentTokenId] == 0) {
            trustScore[parentAgentTokenId] = BASE_TRUST;
        }

        emit DelegationRegistered(parentId, childId, parentAgentTokenId);
    }

    // LAZY REVOCATION: marks this token revoked.
    // Children are NOT actively killed — they fail isRevoked() at execution time.
    // Gas cost: O(1) always. No recursion. No gas bomb.
    function revoke(bytes32 tokenId, uint256 agentTokenId)
        external nonReentrant
    {
        require(
            erc8004.ownerOf(agentTokenId) == msg.sender,
            "DCT: not agent owner"
        );
        require(
            holderAgent[tokenId] == agentTokenId ||
            _isAncestorOwner(tokenId, agentTokenId),
            "DCT: not authorized to revoke"
        );
        directlyRevoked[tokenId] = true;
        emit TokenRevoked(tokenId, msg.sender);
    }

    // CORE LAZY CHECK: walks up the lineage chain.
    // If any ancestor is revoked, this token is invalid.
    // Gas: O(depth) SLOADs. At MAX_DEPTH=8, max ~6,400 gas worst case.
    function isRevoked(bytes32 tokenId) public view returns (bool) {
        bytes32 current = tokenId;
        uint8 hops = 0;
        while (current != bytes32(0) && hops < MAX_DEPTH) {
            if (directlyRevoked[current]) return true;
            current = parentOf[current];
            hops++;
        }
        return false;
    }

    // Trust scoring — callable only by DCTEnforcer
    function recordSuccess(uint256 agentTokenId) external onlyEnforcer {
        uint256 score    = trustScore[agentTokenId];
        if (score == 0) score = BASE_TRUST;
        uint256 headroom = 2e18 - score;
        trustScore[agentTokenId] = score + headroom / 100; // log growth → cap 2x
        emit TrustUpdated(agentTokenId, trustScore[agentTokenId], false);
    }

    function recordViolation(uint256 agentTokenId) external onlyEnforcer {
        uint256 score = trustScore[agentTokenId];
        if (score == 0) score = BASE_TRUST;
        trustScore[agentTokenId] = (score * DECAY_NUM) / DECAY_DENOM;
        emit TrustUpdated(agentTokenId, trustScore[agentTokenId], true);
    }

    // Used off-chain by orchestrators to gate how much they delegate
    function maxGrantableSpend(uint256 agentTokenId, uint256 parentLimit)
        external view returns (uint256)
    {
        uint256 score = trustScore[agentTokenId];
        if (score == 0) return parentLimit / 10;           // cold start: 10%
        return (parentLimit * score) / (2 * BASE_TRUST);  // trust-proportional
    }

    function _depth(bytes32 id) internal view returns (uint8 d) {
        bytes32 cur = parentOf[id];
        while (cur != bytes32(0) && d < MAX_DEPTH) {
            cur = parentOf[cur];
            d++;
        }
    }

    function _isAncestorOwner(bytes32 tokenId, uint256 agentId)
        internal view returns (bool)
    {
        bytes32 cur = parentOf[tokenId];
        uint8 hops = 0;
        while (cur != bytes32(0) && hops < MAX_DEPTH) {
            if (holderAgent[cur] == agentId) return true;
            cur = parentOf[cur];
            hops++;
        }
        return false;
    }
}
```

**Key design decisions:**

- `isRevoked()` walks up to 8 ancestors: at most 8 cold SLOADs (~800 gas each) = ~6,400 gas worst case. Acceptable for any execution context.
- `MAX_DEPTH = 8` is a hard ceiling enforced at registration time, bounding all loop costs unconditionally.
- `directlyRevoked` vs `isRevoked`: registering a revocation is O(1). Checking it is O(depth). This is the correct tradeoff — revocations are rare; checks are frequent.
- `ReentrancyGuard` from OpenZeppelin protects `registerDelegation` and `revoke` from re-entrant calls modifying lineage state mid-walk.

---

## 6. Layer 3 — Enforcement: DCTEnforcer.sol

DCTEnforcer is a **custom caveat enforcer** inside the MetaMask Delegation Framework. The CaveatBuilder supports various caveat types, each serving a specific purpose. These caveat types correspond to the out-of-the-box caveat enforcers that the MetaMask Delegation Toolkit provides. For more granular or custom control, you can also create custom caveat enforcers and add them to the caveat builder.

**Install (Solidity — for building custom enforcers like DCTEnforcer):**
```bash
# Correct install method for Solidity contracts
forge install metamask/delegation-framework@v1.3.0

# Add to remappings.txt:
# @metamask/delegation-framework/=lib/metamask/delegation-framework/
```

If you plan to extend the Delegation Framework smart contracts (for example, to create a custom caveat enforcer), install the contract package using Foundry's command-line tool, Forge: `forge install metamask/delegation-framework@v1.3.0`. Add `@metamask/delegation-framework/=lib/metamask/delegation-framework/` in your `remappings.txt` file.

**Install (TypeScript SDK):**
```bash
npm install @metamask/delegation-toolkit
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Correct Foundry import path after forge install
import {CaveatEnforcer} from
    "@metamask/delegation-framework/src/enforcers/CaveatEnforcer.sol";
import {ModeCode} from
    "@metamask/delegation-framework/src/utils/Types.sol";

interface IDCTRegistry {
    function isRevoked(bytes32 tokenId) external view returns (bool);
    function scopeCommitments(bytes32 tokenId) external view returns (bytes32);
    function recordSuccess(uint256 agentTokenId) external;
    function recordViolation(uint256 agentTokenId) external;
}

interface IERC8004 {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface ITLSNVerifier {
    // TLSNotary on-chain verifier
    // Verifies MPC-TLS attestation against notary public key
    function verify(
        bytes calldata attestation,
        bytes32 expectedEndpointHash
    ) external view returns (bool);
}

contract DCTEnforcer is CaveatEnforcer {
    IDCTRegistry  public immutable registry;
    IERC8004      public immutable erc8004;
    ITLSNVerifier public immutable tlsnVerifier;

    constructor(
        address _registry,
        address _erc8004,
        address _tlsnVerifier
    ) {
        registry     = IDCTRegistry(_registry);
        erc8004      = IERC8004(_erc8004);
        tlsnVerifier = ITLSNVerifier(_tlsnVerifier);
    }

    // terms = abi.encode(
    //   bytes32  revocationId,     // Biscuit token revocation ID
    //   uint256  agentTokenId,     // ERC-8004 token ID of executing agent
    //   bytes32  toolHash,         // keccak256(tool name)
    //   uint256  spendAmount,      // declared spend in 6-decimal USDC
    //   bytes    tlsnAttestation   // TLSNotary MPC-TLS attestation
    // )
    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address redeemer
    ) external override {
        (
            bytes32 revocationId,
            uint256 agentTokenId,
            bytes32 toolHash,
            uint256 spendAmount,
            bytes memory tlsnAttestation
        ) = abi.decode(terms, (bytes32, uint256, bytes32, uint256, bytes));

        // 1. Lazy revocation check — walks lineage, O(depth) SLOADs
        require(!registry.isRevoked(revocationId), "DCT: token revoked");

        // 2. Identity — redeemer must own the declared ERC-8004 agent NFT
        require(
            erc8004.ownerOf(agentTokenId) == redeemer,
            "DCT: wrong agent"
        );

        // 3. Scope — validate tool and spend against committed Scope struct
        bytes32 committed = registry.scopeCommitments(revocationId);
        require(committed != bytes32(0), "DCT: unknown token");
        require(
            _validateScope(committed, toolHash, spendAmount),
            "DCT: out of scope"
        );

        // 4. TLSNotary attestation — required for HTTP tool calls
        //    Proves agent actually called the declared endpoint
        //    Skip for non-HTTP tools (e.g. pure on-chain actions)
        if (tlsnAttestation.length > 0) {
            require(
                tlsnVerifier.verify(tlsnAttestation, toolHash),
                "DCT: invalid TLS attestation"
            );
        }

        registry.recordSuccess(agentTokenId);
    }

    function afterHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) external override {
        // Post-execution: verify outcome-based constraints
        // e.g. confirm actual USDC transferred matches declared spendAmount
    }

    function _validateScope(
        bytes32 committedHash,
        bytes32 toolHash,
        uint256 spendAmount
    ) internal pure returns (bool) {
        // Production: decode Scope from calldata, verify allowedTools[]
        // contains toolHash, verify spendAmount <= spendLimitUsdc,
        // then compare keccak256(abi.encode(scope)) == committedHash
        return committedHash != bytes32(0); // stub — expand for production
    }
}
```

**References:**
- Official docs: `docs.gator.metamask.io`
- GitHub: `github.com/MetaMask/delegation-framework`
- Delegation concepts: `docs.gator.metamask.io/concepts/delegation`
- Restrict a delegation: `docs.gator.metamask.io/how-to/create-delegation/restrict-delegation`

---

## 7. Layer 4 — Action Verification: TLSNotary (Rust)

### The Agent-vs-Browser Distinction

Reclaim Protocol and browser-based zkTLS tools are designed for human-authenticated sessions: a user logs into a website, the tool intercepts the TLS session via proxy, and generates a proof of what the website returned. This requires a human browser context.

Autonomous agents make direct API calls with API keys — no browser, no human session. The correct tool is TLSNotary's Rust implementation.

The `tlsn` crate provides the core protocol for generating and verifying proofs of TLS sessions. A prover can demonstrate to a verifier that specific data was exchanged with a TLS server, without revealing the full transcript.

The prover and verifier collaborate to construct a TLS transcript commitment from the prover's communication with a TLS server. This authenticates the transcript for the verifier, without the verifier learning the contents. The prover selectively reveals portions of the committed transcript to the verifier, proving statements about the data exchanged with the server.

### Recent API Consolidation

> ⚠️ **Breaking change:** The `tlsn-attestation` crate will continue to be maintained but will not receive new features. Existing users of the Notary client/server can of course fork and continue using them, but will be responsible for upgrading the core protocol dependency in future releases. The prover and verifier have been consolidated into the single `tlsn` crate. Use only `tlsn` as the dependency.

### Performance

Over the past months, major performance leaps have been made in TLSNotary. The VOLE-based IZK backend (QuickSilver) was implemented and control-flow and MPC optimizations were introduced across the stack. Starting with v0.1.0-alpha.8, QuickSilver replaced the older garbled-circuit proof backend, reducing bandwidth usage and sensitivity to latency. Subsequent releases added transcript hash commitments, low-bandwidth modes, faster APIs, and more.

### Rust Implementation

```rust
// Cargo.toml
// [dependencies]
// tlsn = "0.1.0-alpha.9"   ← single consolidated crate (NOT tlsn-prover separately)
// tokio = { version = "1", features = ["full"] }

use tlsn::prover::{Prover, ProverConfig};
use tlsn::core::proof::TlsProof;

async fn prove_api_call(
    server_host: &str,
    api_key: &str,
    notary_host: &str,
    notary_port: u16,
) -> TlsProof {
    // 1. Connect to the TLSNotary notary server (MPC partner)
    //    The notary holds one share of the TLS session key material.
    //    Neither party alone can forge a transcript.
    let notary_conn = connect_to_notary(notary_host, notary_port).await;

    // 2. Configure and initialize prover
    let config = ProverConfig::builder()
        .id("dct-agent-proof")
        .server_dns(server_host)
        .build()
        .unwrap();

    let prover = Prover::new(config)
        .setup(notary_conn)
        .await
        .unwrap();

    // 3. Make the actual HTTP call through MPC-TLS
    //    The TLS handshake and session keys are computed jointly.
    let (mut tls_conn, prover_fut) = prover
        .connect(server_host)
        .await
        .unwrap();

    // Send request through MPC-TLS connection
    tls_conn.write_all(
        format!(
            "GET /data HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\n\r\n",
            server_host, api_key
        ).as_bytes()
    ).await.unwrap();

    let mut response = Vec::new();
    tls_conn.read_to_end(&mut response).await.unwrap();

    // 4. Finalize — produces notary-signed attestation
    //    Selective disclosure: reveal endpoint + status code,
    //    redact API key and sensitive response fields.
    let prover = prover_fut.await.unwrap();
    let (mut prover, _) = prover.start_notarize();
    let proof = prover.finalize().await.unwrap();
    proof
    // TlsProof is submitted alongside the on-chain action.
    // ITLSNVerifier checks it against the notary's known public key
    // and the expected endpoint hash (keccak256(tool name)).
}
```

This demonstrates how to use TLSNotary in a simple interactive session between a Prover and a Verifier. It involves the Verifier first verifying the MPC-TLS session and then confirming the correctness of the data.

**References:**
- Docs: `tlsnotary.org`
- Rust API docs: `tlsnotary.github.io/tlsn/tlsn/`
- GitHub: `github.com/tlsnotary/tlsn`
- Quick start: `tlsnotary.org/docs/quick_start/rust/`
- Rust crate: `cargo add tlsn`
- Examples: `github.com/tlsnotary/tlsn/tree/main/crates/examples`

---

## 8. Layer 5 — Agent Identity: ERC-8004

ERC-8004, officially titled "Trustless Agents," is an Ethereum standard reshaping how autonomous AI agents interact, transact, and build trust in decentralized environments. This innovative protocol extends the Agent-to-Agent (A2A) framework by introducing a comprehensive trust layer that enables AI agents to discover, authenticate, and collaborate across organizational boundaries without requiring centralized intermediaries.

At a high level, ERC-8004 defines three registries: Identity Registry — an ERC-721 registry for agent identities (portable, browsable, transferable); Reputation Registry — a standardized interface for publishing and reading feedback signals; Validation Registry — hooks for validator smart contracts to publish validation results.

The Identity Registry is an upgradeable ERC-721 (ERC721URIStorage) where `agentURI` (tokenURI) points to the agent registration file. `register` mints a new agent NFT and assigns an `agentId`.

### Co-authors and Status

ERC-8004 was officially proposed on August 13, 2025, representing a collaborative effort from industry leaders including Marco De Rossi from MetaMask, Davide Crapis from the Ethereum Foundation, Jordan Ellis from Google, and Erik Reppel from Coinbase. After months of development and community review, Ethereum confirmed the mainnet deployment scheduled for January 29, 2026.

Reference implementations deployed to multiple testnets including Ethereum Sepolia, Base Sepolia, Linea Sepolia, and Hedera Testnet. Following the Ethereum mainnet launch, ERC-8004 has been confirmed to expand to Base, Coinbase's Layer 2 solution, which may serve as an experimental playground for AI agents while Ethereum mainnet functions as the final settlement and security layer.

### DCT Integration

Every agent in a DCT chain holds an ERC-8004 NFT. The token ID is:
- Embedded in every Biscuit authority block (`agent_erc8004_id("42")`)
- Verified by DCTEnforcer at execution (`erc8004.ownerOf(agentTokenId) == redeemer`)
- Used as the key for trust scores in DCTRegistry (`trustScore[agentTokenId]`)

**Note on Validation Registry:** For high-stakes interactions where social reputation proves insufficient, the Validation Registry provides generic hooks for requesting and recording independent verification. Rather than prescribing specific validation methods, ERC-8004 establishes a flexible framework supporting multiple trust models. This registry is under active revision with the TEE community. DCT does not integrate with it in v1.0.

**References:**
- EIP: `eips.ethereum.org/EIPS/eip-8004`
- Contracts repo: `github.com/erc-8004/erc-8004-contracts`
- Community site: `8004.org`
- Explorer: `8004scan.io`
- Base mainnet IdentityRegistry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`

---

## 9. Layer 6 — Execution Substrate: ERC-4337 via Pimlico

### Why ERC-4337 Is Required

ERC-7710 delegations authorize actions on **smart accounts**, not EOAs. Smart accounts require ERC-4337 to initiate transactions. A DeleGator Smart Account is a 4337-compatible Smart Account that implements delegation functionality. An end user will operate through a DeleGatorProxy which uses a chosen DeleGator implementation.

The EntryPoint enforces a strict separation of concerns: Validation Phase — the account's `validateUserOp` function runs to verify the signature and authorize the operation, with strict restrictions on what opcodes and storage the code can access. Execution Phase — the account's execute function runs the actual operation with full EVM capabilities.

This is the phase where DCTEnforcer's `beforeHook` runs — inside `validateUserOp` as a caveat, before execution.

### Pimlico

ERC-4337 bundlers are relayers that bundle user operations into transactions and submit them to the blockchain. You can interact with bundlers using standard JSON-RPC requests.

permissionless.js is a TypeScript library built on viem for building with ERC-4337 smart accounts, bundlers, paymasters, and user operations. The core focuses are avoiding provider lock-in, having no dependencies, maximum viem compatibility, and a small bundle size.

Pimlico's Verifying Paymaster lets you load up your off-chain Pimlico balance through the dashboard and sponsor on-chain gas fees for your users across 100+ chains. The ERC-20 Paymaster is a permissionless on-chain smart contract that lets users pay for their own gas fees using ERC-20 tokens.

This means agents do not need to hold ETH to execute delegated actions — gas can be sponsored entirely off-chain.

**API endpoint format:**
```
https://api.pimlico.io/v2/{chainId}/rpc?apikey={YOUR_API_KEY}
```

**References:**
- Docs: `docs.pimlico.io`
- permissionless.js: `docs.pimlico.io/permissionless`
- GitHub: `github.com/pimlicolabs`
- Install: `npm install permissionless`

---

## 10. Off-Chain SDK

```typescript
import {
    biscuit, block, PrivateKey, Biscuit
} from "@biscuit-auth/biscuit-wasm";
// ⚠️ Run Node with: node --experimental-wasm-modules index.js
import { ethers } from "ethers";
import { DCTRegistry__factory } from "./typechain";

// ERC-8004 Identity Registry — Base mainnet
const ERC8004_BASE = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const REGISTRY_ADDRESS = "0x..."; // Your deployed DCTRegistry

async function delegate(
    parentToken: Biscuit,
    parentAgentTokenId: bigint,
    childAgentTokenId: bigint,
    childTools: string[],
    childSpendLimit: bigint,
    signer: ethers.Signer
): Promise<Biscuit> {
    const registry = DCTRegistry__factory.connect(REGISTRY_ADDRESS, signer);

    // 1. Trust-gated scope — query on-chain before delegating
    const parentLimit = 50_000_000n; // 50 USDC
    const safeSpend   = await registry.maxGrantableSpend(
        childAgentTokenId,
        parentLimit
    );
    const actualSpend = childSpendLimit < safeSpend
        ? childSpendLimit
        : safeSpend;

    // 2. Attenuate Biscuit OFFLINE — zero network calls, pure cryptography
    const toolChecks = childTools
        .map(t => `check if allowed_tool("${t}");`)
        .join("\n    ");

    const childToken = parentToken.append(block`
        ${toolChecks}
        check if spend_usdc($s), $s <= ${actualSpend};
        check if agent_erc8004_id($id), $id == "${childAgentTokenId}";
        check if time($t), $t < ${
            BigInt(Math.floor(Date.now() / 1000) + 3600)
        };
    `);

    // 3. Register on-chain — links Biscuit revocationId into lineage tree
    const parentRevId = toBytes32(
        parentToken.getRevocationIdentifiers()[0]
    );
    const childRevId  = toBytes32(
        childToken.getRevocationIdentifiers()[0]
    );

    const scope = {
        allowedTools: childTools.map(t =>
            ethers.keccak256(ethers.toUtf8Bytes(t))
        ),
        spendLimitUsdc: actualSpend,
        maxDepth:       2,
        expiresAt:      BigInt(Math.floor(Date.now() / 1000) + 3600)
    };

    await registry.registerDelegation(
        parentRevId,
        childRevId,
        scope,
        parentAgentTokenId
    );

    return childToken;
}

// Revocation — O(1) on-chain write
// Children will fail isRevoked() automatically at next execution attempt
async function revoke(
    token: Biscuit,
    agentTokenId: bigint,
    signer: ethers.Signer
) {
    const registry = DCTRegistry__factory.connect(REGISTRY_ADDRESS, signer);
    const revId    = toBytes32(token.getRevocationIdentifiers()[0]);
    await registry.revoke(revId, agentTokenId);
}

function toBytes32(id: Uint8Array): string {
    return "0x" + Buffer.from(id)
        .toString("hex")
        .padStart(64, "0");
}
```

---

## 11. Complete Tech Stack

| Layer | Technology | Install | Reference |
|---|---|---|---|
| **Off-chain token** | Eclipse Biscuit v3 (Apache 2.0) | `npm i @biscuit-auth/biscuit-wasm` | `doc.biscuitsec.org` |
| **Delegation enforcement** | ERC-7710 MetaMask Delegation Framework | `forge install metamask/delegation-framework@v1.3.0` | `docs.gator.metamask.io` |
| **TypeScript SDK** | MetaMask Delegation Toolkit | `npm i @metamask/delegation-toolkit` | `docs.gator.metamask.io` |
| **Lineage registry** | DCTRegistry.sol (novel) | Deploy via Hardhat/Foundry | This document |
| **Action verification** | TLSNotary MPC-TLS (Rust) | `cargo add tlsn` | `tlsnotary.org` |
| **Agent identity** | ERC-8004 (Draft, deployed) | `eips.ethereum.org/EIPS/eip-8004` | `8004.org` |
| **ERC-8004 contracts** | Base mainnet registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `8004scan.io` |
| **Account abstraction** | ERC-4337 via Pimlico / permissionless.js | `npm i permissionless` | `docs.pimlico.io` |
| **EVM interaction** | viem + ethers v6 | `npm i viem ethers` | `viem.sh` |
| **Contracts** | Hardhat + OpenZeppelin | `npm i hardhat @openzeppelin/contracts` | `hardhat.org` |
| **Chain (testnet)** | Base Sepolia | RPC: `sepolia.base.org` | `docs.base.org` |
| **Chain (mainnet)** | Base mainnet | RPC: `mainnet.base.org` | `docs.base.org` |

---

## 12. Security Analysis

| Attack | What the attacker tries | Why it fails |
|---|---|---|
| **Scope widening** | Agent B appends a Biscuit block claiming wider tools or higher spend | Biscuit Datalog makes widening inexpressible. A `check if` from block 0 applies across all subsequent blocks unconditionally. |
| **Forged lineage** | Agent submits a Biscuit without a legitimate parent chain | Root public key verification fails. Every block must be signed by the previous holder's ephemeral Ed25519 key. |
| **Revocation evasion** | Agent uses a token after its ancestor is revoked | `isRevoked()` walks the lineage at execution time. Ancestor revocation flag is checked at every call. O(depth) gas, not escapable. |
| **Token replay** | Agent reuses a valid TLSNotary attestation from a different session | TLSNotary attestations bind to a specific session nonce and timestamp. Replay fails verifier check. |
| **Gas exhaustion** | Attacker registers a MAX_DEPTH chain to force expensive `isRevoked()` | `MAX_DEPTH = 8` caps the walk unconditionally at 8 SLOADs (~6,400 gas worst case). Enforced at registration time. |
| **Identity spoofing** | Agent claims to be a different ERC-8004 agent | `erc8004.ownerOf(agentTokenId) == redeemer` check fails. On-chain NFT ownership is ground truth. |
| **Trust farming** | Agent completes fake delegations to inflate trust score | `trustScore` only increments via `recordSuccess()` which is `onlyEnforcer`. DCTEnforcer requires a valid DCT token, correct identity, and a real successful action execution. |
| **Re-entrancy on registry** | Attacker re-enters `registerDelegation` or `revoke` mid-execution | `ReentrancyGuard` from OpenZeppelin blocks re-entrant calls on both functions. |
| **Depth limit bypass** | Attacker registers a child beyond MAX_DEPTH to create an unbounded loop | `_depth()` check at registration enforces MAX_DEPTH = 8 before the child record is written. Unbounded chains cannot be created. |

---

## 13. What DCT Is Not

**Not a replacement for ERC-7710.** ERC-7710 is an ERC standard that defines the minimal interface necessary for smart contracts to delegate capabilities to other smart contracts, smart contract accounts, or EOAs. ERC-7710 resulted from the Delegation Framework. DCT is a custom caveat enforcer running inside ERC-7710. It adds cross-agent-tree revocation — the one thing ERC-7710 explicitly leaves to implementors.

**Not a replacement for ERC-8004.** ERC-8004 makes agents discoverable via an ERC-721 identity whose tokenURI points to a registration file. ERC-8004 standardizes how reputation and validation signals are posted and queried on-chain. DCT consumes ERC-8004 identity as its ground truth — it doesn't replace it.

**Not a payment system.** Payment rails are intentionally out-of-scope for ERC-8004. They are equally out of scope for DCT. x402 handles payments. DCT handles the authority to make them.

**Not a framework.** DCT has no opinion on CrewAI vs LangGraph vs raw agents. It is infrastructure any agent runtime can adopt by adding three SDK calls: `delegate()`, `execute()`, `revoke()`.

---

## 14. The Five-Minute Demo

**Minute 1 — Setup.**
Three agents registered on ERC-8004 (show `8004scan.io` with their token IDs). Root creates a Biscuit authority token on-screen — show the WASM call completing in under 100ms. Dashboard shows empty delegation tree and baseline trust scores.

**Minute 2 — Delegation cascade.**
Agent A attenuates the token offline — zero network traffic, instant. A delegates to B. B attenuates and delegates to C. Each attenuation narrows scope. `registerDelegation()` fires for each hop — show three BaseScan transactions. Dashboard shows the live tree with three nodes.

**Minute 3 — Successful execution.**
Agent C makes a real external API call. TLSNotary Rust prover generates an MPC-TLS attestation server-side. DCTEnforcer validates four things in sequence: lineage not revoked (isRevoked walk), identity matches (ownerOf check), tool in scope (committed hash), attestation valid (TLSNotary verifier). Action executes. Trust scores increment. Show the BaseScan trace.

**Minute 4 — Scope enforcement.**
Agent C attempts a tool outside its Biscuit scope. Datalog check fails off-chain before the transaction is submitted — instant rejection, zero gas wasted. Then Agent C tries to exceed its spend limit — DCTEnforcer's scope check reverts on-chain. Two enforcement layers: off-chain Datalog, on-chain enforcer.

**Minute 5 — Cascade revocation.**
Root calls `revoke(rootRevId)` — one transaction, one SSTORE, O(1) gas. Agent C submits the same API call it just succeeded with. `isRevoked()` walks two ancestor hops, finds the revoked flag, reverts. Show the BaseScan call stack — the lineage walk is visible. Trust score for Agent B decays. The entire delegation tree is dead from a single write.

---

## 15. Positioning

```
ERC-8004 gives agents identity.
x402 gives them payment rails.
ERC-7710 gives them delegation redemption.

DCT gives them verifiable, cascading,
trust-aware authority — the layer
none of those three provide.

Every multi-agent system running in
production today is missing exactly
this primitive.
```

---

## Appendix: Reference Index

| Technology | Primary Reference | Secondary Reference |
|---|---|---|
| Eclipse Biscuit | `doc.biscuitsec.org` | `github.com/eclipse-biscuit/biscuit-wasm` |
| Biscuit NodeJS | `doc.biscuitsec.org/usage/nodejs.html` | `npmjs.com/package/@biscuit-auth/biscuit-wasm` |
| MetaMask Delegation Toolkit | `docs.gator.metamask.io` | `github.com/MetaMask/delegation-framework` |
| ERC-7710 | `eips.ethereum.org/EIPS/eip-7710` | `metamask.io/developer/delegation-toolkit` |
| TLSNotary (Rust) | `tlsnotary.org` | `tlsnotary.github.io/tlsn/tlsn/` |
| TLSNotary examples | `github.com/tlsnotary/tlsn/tree/main/crates/examples` | `tlsnotary.org/docs/quick_start/rust/` |
| ERC-8004 | `eips.ethereum.org/EIPS/eip-8004` | `8004.org` |
| ERC-8004 contracts | `github.com/erc-8004/erc-8004-contracts` | `8004scan.io` |
| Pimlico | `docs.pimlico.io` | `docs.pimlico.io/permissionless` |
| permissionless.js | `docs.pimlico.io/permissionless` | `github.com/pimlicolabs` |
| OpenZeppelin | `docs.openzeppelin.com/contracts` | `github.com/OpenZeppelin/openzeppelin-contracts` |
| Base chain | `docs.base.org` | `basescan.org` |

---

*MIT Licensed. All infrastructure live. No whitelist. All referenced URLs verified April 2026.*