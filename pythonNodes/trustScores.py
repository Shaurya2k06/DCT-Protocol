"""
DCT Trust Score System
======================
Three signals combined into a TrustProfile that gates on-chain delegation.

Signal 1 — Scope adherence (TLSNotary / on-chain); blended with an EMA against burst farming
Signal 2 — Task completion (delegation-time validators; tool hashes match keccak(tool))
Signal 3 — Outcome quality (time-weighted heuristic; uses infer_task_completed when expectations exist)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import IntEnum
from typing import Callable, Optional

from web3 import Web3


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class ExecutionEvent:
    """
    One execution record. Populated from on-chain events + off-chain log.

    scope_adhered   : from DCTEnforcer — ActionValidated / ActionRejected
    completed       : optional explicit completion (TLSN merge); infer_task_completed preferred
    response_body   : selectively revealed portion from TLSNotary attestation
    spend_declared  : USDC (6 decimals) declared in the action
    spend_limit     : USDC (6 decimals) limit in the agent's scope
    latency_ms      : wall-clock time for the action
    timestamp       : UTC time of execution
    tool            : tool name or keccak hex (0x…) from chain logs
    agent_id        : ERC-8004 token ID
    revocation_id   : delegation child id (bytes32) when sourced from chain — enables scope hints
    """
    agent_id:        int
    tool:            str
    scope_adhered:   bool
    completed:       bool
    spend_declared:  int
    spend_limit:     int
    latency_ms:      int
    timestamp:       datetime
    response_body:   dict = field(default_factory=dict)
    revocation_id:   Optional[bytes] = None


@dataclass
class TaskExpectation:
    """
    Defined at delegation time by the parent agent or human root.
    The validator is the only authoritative source for Signal 2.
    """
    tool:      str
    validator: Callable[[dict], bool]


class AgentTier(IntEnum):
    COLD   = 0   # no history at all
    BRONZE = 1   # < 10 executions or composite < 0.5
    SILVER = 2   # >= 10 executions, composite >= 0.7
    GOLD   = 3   # >= 50 executions, composite >= 0.85


@dataclass
class TrustProfile:
    agent_id:            int
    composite_score:     float        # 0.0 – 1.0
    tier:                AgentTier
    signal_1:            Optional[float]   # scope adherence rate (raw fraction)
    signal_2:            Optional[float]   # task completion rate
    signal_3:            Optional[float]   # outcome quality
    execution_count:     int
    # On-chain delegation gates derived from tier + composite
    max_children:        int          # width gate
    max_depth:           int          # depth gate
    max_spend_fraction:  float        # fraction of parent spend limit


# ---------------------------------------------------------------------------
# Tool identity + task inference
# ---------------------------------------------------------------------------

def tool_matches_expectation(event_tool: str, expectation_key: str) -> bool:
    """Match human-readable tool names to on-chain keccak hex (0x-prefixed 32-byte hash)."""
    if not expectation_key:
        return False
    if not event_tool:
        return False
    if event_tool == expectation_key:
        return True
    et = event_tool.strip().lower()
    if not (et.startswith("0x") and len(et) == 66):
        return False
    expected_hash = Web3.to_hex(Web3.keccak(text=expectation_key.strip())).lower()
    return et == expected_hash


def resolve_expectation_for_event(
    e: ExecutionEvent,
    expectations: dict[str, TaskExpectation],
) -> Optional[TaskExpectation]:
    if not expectations:
        return None
    for key in expectations:
        if tool_matches_expectation(e.tool, key):
            return expectations[key]
    return None


def _response_body_has_validator_payload(body: dict) -> bool:
    if not body:
        return False
    for v in body.values():
        if v in (None, "", [], {}):
            continue
        return True
    return False


def infer_task_completed(e: ExecutionEvent, exp: TaskExpectation) -> bool:
    """
    TLSN path: validator on response_body.
    Chain-only path (revocation_id set, spend_limit from delegation hints, empty body):
    structural completion when spend is in-band — cannot be gamed without a registered scope hint.
    """
    try:
        if exp.validator(e.response_body):
            return True
    except Exception:
        pass

    if e.revocation_id is None:
        return False
    if not e.scope_adhered:
        return False
    if e.spend_limit <= 0:
        return False
    if e.spend_declared > e.spend_limit:
        return False
    if _response_body_has_validator_payload(e.response_body):
        return False
    return True


def events_match_any_expectation(
    agent_id: int,
    events: list[ExecutionEvent],
    expectations: dict[str, TaskExpectation],
) -> bool:
    """True if at least one event for this agent maps to a declared expectation (by name or hash)."""
    if not expectations:
        return False
    for e in events:
        if e.agent_id != agent_id:
            continue
        if resolve_expectation_for_event(e, expectations) is not None:
            return True
    return False


# ---------------------------------------------------------------------------
# Signal 1 — Scope adherence  (cryptographic backing via TLSNotary)
# ---------------------------------------------------------------------------

def signal_1_scope_adherence(
    agent_id: int,
    events: list[ExecutionEvent],
) -> Optional[float]:
    """
    Fraction of executions where the agent stayed within declared scope.
    This is the only signal with cryptographic backing — treat it as ground truth.
    Returns None on cold start (no events for this agent).
    """
    agent_events = [e for e in events if e.agent_id == agent_id]
    if not agent_events:
        return None

    adhered = sum(1 for e in agent_events if e.scope_adhered)
    return adhered / len(agent_events)


def _scope_adherence_ema(agent_events: list[ExecutionEvent], alpha: float = 0.12) -> float:
    """Exponential moving average over time-ordered events — resists short bursts of cheap wins."""
    if not agent_events:
        return 0.5
    ordered = sorted(agent_events, key=lambda e: e.timestamp)
    ema = 1.0 if ordered[0].scope_adhered else 0.0
    for e in ordered[1:]:
        x = 1.0 if e.scope_adhered else 0.0
        ema = alpha * x + (1.0 - alpha) * ema
    return ema


def signal_1_effective_for_composite(
    agent_id: int,
    events: list[ExecutionEvent],
) -> Optional[float]:
    """
    Blend raw adherence with EMA so a spike of successes cannot erase a long poor history instantly.
    """
    raw = signal_1_scope_adherence(agent_id, events)
    if raw is None:
        return None
    agent_events = [e for e in events if e.agent_id == agent_id]
    ema = _scope_adherence_ema(agent_events)
    return _S1_RAW * raw + _S1_EMA * ema


# ---------------------------------------------------------------------------
# Signal 2 — Task completion  (validator-defined)
# ---------------------------------------------------------------------------

def signal_2_task_completion(
    agent_id:     int,
    events:       list[ExecutionEvent],
    expectations: dict[str, TaskExpectation],
) -> Optional[float]:
    """
    Fraction of completed tasks as judged by per-tool validators.
    Events whose tool does not resolve to any expectation are excluded (not penalised).
    """
    agent_events = [
        e for e in events
        if e.agent_id == agent_id and resolve_expectation_for_event(e, expectations) is not None
    ]
    if not agent_events:
        return None

    completed = 0
    for event in agent_events:
        exp = resolve_expectation_for_event(event, expectations)
        assert exp is not None
        if infer_task_completed(event, exp):
            completed += 1

    return completed / len(agent_events)


# ---------------------------------------------------------------------------
# Signal 3 — Outcome quality  (time-weighted heuristic)
# ---------------------------------------------------------------------------

DECAY_HALF_LIFE_DAYS = 7.0   # events older than 7 days count for ~50%


def signal_3_outcome_quality(
    agent_id: int,
    events: list[ExecutionEvent],
    now: Optional[datetime] = None,
    expectations: Optional[dict[str, TaskExpectation]] = None,
) -> Optional[float]:
    """
    Time-weighted composite quality per execution.

    Quality per execution:
      0.60 — task completion (validator + structural proxy, or legacy e.completed)
      0.30 — scope adhered
      0.10 — spend efficiency (spend_declared / spend_limit, lower = better)

    Exponential time decay: events older than DECAY_HALF_LIFE_DAYS
    count proportionally less. Recent behaviour dominates.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    agent_events = [e for e in events if e.agent_id == agent_id]
    if not agent_events:
        return None

    k = math.log(2) / DECAY_HALF_LIFE_DAYS   # decay constant

    weights: list[float] = []
    scores:  list[float] = []

    for e in agent_events:
        ts = e.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        age_days = max((now - ts).total_seconds() / 86400, 0)
        weight   = math.exp(-k * age_days)

        spend_efficiency = (
            e.spend_declared / e.spend_limit
            if e.spend_limit > 0 else 1.0
        )
        spend_efficiency = min(spend_efficiency, 1.0)

        if expectations:
            exp = resolve_expectation_for_event(e, expectations)
            if exp is not None:
                done = infer_task_completed(e, exp)
            else:
                done = e.completed
        else:
            done = e.completed

        quality = (
            0.60 * float(done) +
            0.30 * float(e.scope_adhered) +
            0.10 * (1.0 - spend_efficiency)
        )

        weights.append(weight)
        scores.append(quality)

    total_weight = sum(weights)
    if total_weight == 0:
        return None

    return sum(w * s for w, s in zip(weights, scores)) / total_weight


# ---------------------------------------------------------------------------
# Tier gates
# ---------------------------------------------------------------------------

_TIER_GATES: dict[AgentTier, dict] = {
    AgentTier.COLD: dict(
        max_children       = 1,
        max_depth          = 1,
        max_spend_fraction = 0.10,
    ),
    AgentTier.BRONZE: dict(
        max_children       = 2,
        max_depth          = 2,
        max_spend_fraction = 0.25,
    ),
    AgentTier.SILVER: dict(
        max_children       = 5,
        max_depth          = 4,
        max_spend_fraction = 0.60,
    ),
    AgentTier.GOLD: dict(
        max_children       = 10,
        max_depth          = 6,
        max_spend_fraction = 0.90,
    ),
}


def _distinct_tool_count(agent_events: list[ExecutionEvent]) -> int:
    return len({e.tool.lower() for e in agent_events if e.tool})


def _derive_tier(
    composite:         float,
    execution_count:   int,
    s2:                Optional[float],
    agent_id:          int,
    *,
    expectations:      dict[str, TaskExpectation],
    agent_events:      list[ExecutionEvent],
) -> AgentTier:
    """
    Tier assignment rules:
    - COLD   : no executions
    - GOLD   : >= 50 executions, composite >= 0.85, s2 never failed catastrophically
    - SILVER : >= 10 executions, composite >= 0.70
    - BRONZE : everything else with data
    """
    if execution_count == 0:
        return AgentTier.COLD

    if expectations and execution_count > 0:
        if not events_match_any_expectation(agent_id, agent_events, expectations):
            return AgentTier.BRONZE

    if s2 is not None and s2 < 0.50:
        return AgentTier.BRONZE

    distinct = _distinct_tool_count(agent_events)

    if execution_count >= 50 and composite >= 0.85:
        if execution_count >= _GOLD_DIVERSITY_MIN_EXECUTIONS and distinct < _GOLD_MIN_DISTINCT_TOOLS:
            return AgentTier.SILVER
        return AgentTier.GOLD
    if execution_count >= 10 and composite >= 0.70:
        return AgentTier.SILVER
    return AgentTier.BRONZE


# ---------------------------------------------------------------------------
# Combined trust profile
# ---------------------------------------------------------------------------

# S1 dominates; S2 and S3 moderate (task + heuristic)
_W1 = 0.50   # scope adherence (raw+EMA composite)
_W2 = 0.20   # task completion
_W3 = 0.30   # outcome quality (heuristic)

_S1_RAW = 0.62
_S1_EMA = 0.38

# Neutral prior used when a signal has no data yet
_PRIOR = 0.5

# Penalty when expectations exist but no execution matched any expected tool (gaming wrong tools)
_S2_ABSENT_EXPECTATION_PENALTY = 0.22

# Volume farming: GOLD needs breadth when history is long
_GOLD_MIN_DISTINCT_TOOLS = 2
_GOLD_DIVERSITY_MIN_EXECUTIONS = 35


def compute_trust_profile(
    agent_id:     int,
    events:       list[ExecutionEvent],
    expectations: dict[str, TaskExpectation],
    now:          Optional[datetime] = None,
) -> TrustProfile:
    """
    Combine all three signals into a TrustProfile.

    Composite uses S1 (effective), S2, and S3. S2 also gates tier when catastrophically low.
    """
    s1 = signal_1_scope_adherence(agent_id, events)
    s1_eff = signal_1_effective_for_composite(agent_id, events)
    s2 = signal_2_task_completion(agent_id, events, expectations)
    s3 = signal_3_outcome_quality(agent_id, events, now, expectations=expectations)

    agent_events     = [e for e in events if e.agent_id == agent_id]
    execution_count  = len(agent_events)

    if execution_count == 0:
        return TrustProfile(
            agent_id           = agent_id,
            composite_score    = 0.0,
            tier               = AgentTier.COLD,
            signal_1           = None,
            signal_2           = None,
            signal_3           = None,
            execution_count    = 0,
            **_TIER_GATES[AgentTier.COLD],
        )

    s1_val = s1_eff if s1_eff is not None else _PRIOR
    s3_val = s3 if s3 is not None else _PRIOR

    covers = events_match_any_expectation(agent_id, events, expectations)
    if s2 is not None:
        s2_val = s2
    elif not expectations:
        s2_val = _PRIOR
    elif not covers:
        s2_val = _S2_ABSENT_EXPECTATION_PENALTY
    else:
        s2_val = _PRIOR

    composite = _W1 * s1_val + _W2 * s2_val + _W3 * s3_val
    tier      = _derive_tier(
        composite,
        execution_count,
        s2,
        agent_id,
        expectations=expectations,
        agent_events=agent_events,
    )
    gates     = _TIER_GATES[tier]

    return TrustProfile(
        agent_id          = agent_id,
        composite_score   = composite,
        tier              = tier,
        signal_1          = s1,
        signal_2          = s2,
        signal_3          = s3,
        execution_count   = execution_count,
        **gates,
    )


# ---------------------------------------------------------------------------
# TLSNotary attestation parser  (Phase 2 integration point)
# ---------------------------------------------------------------------------

def parse_tlsn_attestation(raw: dict) -> Optional[ExecutionEvent]:
    """
    Convert a decoded TLSNotary attestation into an ExecutionEvent.

    Expected attestation fields (selectively revealed by the prover):
      endpoint_hash  : keccak256 of tool name (hex string)
      status_code    : HTTP status
      response_body  : dict of selectively revealed fields
      spend_declared : int (6-decimal USDC)
      spend_limit    : int (6-decimal USDC)
      agent_id       : int
      tool           : str
      timestamp      : ISO-8601 UTC string
      latency_ms     : int

    Returns None if the attestation is malformed.
    """
    try:
        ts_raw = raw["timestamp"]
        if isinstance(ts_raw, str):
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        else:
            ts = datetime.fromtimestamp(ts_raw, tz=timezone.utc)

        status = int(raw["status_code"])
        scope_adhered = (200 <= status < 300)

        return ExecutionEvent(
            agent_id       = int(raw["agent_id"]),
            tool           = str(raw["tool"]),
            scope_adhered  = scope_adhered,
            completed      = False,     # prefer infer_task_completion when expectations set
            spend_declared = int(raw["spend_declared"]),
            spend_limit    = int(raw["spend_limit"]),
            latency_ms     = int(raw.get("latency_ms", 0)),
            timestamp      = ts,
            response_body  = raw.get("response_body", {}),
            revocation_id  = None,
        )
    except (KeyError, ValueError, TypeError):
        return None


def _revocation_id_to_bytes(rid) -> Optional[bytes]:
    try:
        if isinstance(rid, (bytes, bytearray)):
            b = bytes(rid)
            return b if len(b) <= 32 else b[-32:]
        hx = Web3.to_hex(rid)
        if hx.startswith("0x"):
            hx = hx[2:]
        return bytes.fromhex(hx)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# On-chain event reader  (Phase 3 integration point)
# ---------------------------------------------------------------------------

def load_events_from_chain(
    enforcer_contract,
    from_block: int = 0,
    w3=None,
    delegation_scope_hints: Optional[dict[str, int]] = None,
) -> list[ExecutionEvent]:
    """
    Read ActionValidated and ActionRejected events from DCTEnforcer
    and produce ExecutionEvent records with scope_adhered set correctly.

    delegation_scope_hints: maps Web3.to_hex(revocationId) -> spendLimitUsdc from registration
    (commitments are hashed on-chain; limits cannot be recovered from the commitment alone).

    This is a read-only operation — no transactions.
    """
    events: list[ExecutionEvent] = []
    hints = delegation_scope_hints or {}

    try:
        validated = enforcer_contract.events.ActionValidated.get_logs(
            fromBlock=from_block
        )
        for log in validated:
            a = log["args"]
            rid = a["revocationId"]
            rid_hex = Web3.to_hex(rid)
            rid_lower = rid_hex.lower()

            if w3 is not None:
                block = w3.eth.get_block(log["blockNumber"])
                timestamp = datetime.fromtimestamp(block["timestamp"], tz=timezone.utc)
            else:
                timestamp = datetime.now(timezone.utc)

            spend_limit = hints.get(rid_lower, hints.get(rid_hex, 0))

            rid_bytes = _revocation_id_to_bytes(rid)

            events.append(ExecutionEvent(
                agent_id       = a["agentTokenId"],
                tool           = Web3.to_hex(a["toolHash"]),
                scope_adhered  = True,
                completed      = False,
                spend_declared = a["spendAmount"],
                spend_limit    = spend_limit,
                latency_ms     = 0,
                timestamp      = timestamp,
                response_body  = {},
                revocation_id  = rid_bytes,
            ))

        rejected = enforcer_contract.events.ActionRejected.get_logs(
            fromBlock=from_block
        )
        for log in rejected:
            a = log["args"]
            rid = a["revocationId"]
            rid_hex = Web3.to_hex(rid)

            if w3 is not None:
                block = w3.eth.get_block(log["blockNumber"])
                timestamp = datetime.fromtimestamp(block["timestamp"], tz=timezone.utc)
            else:
                timestamp = datetime.now(timezone.utc)

            rid_bytes = _revocation_id_to_bytes(rid)

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
                revocation_id  = rid_bytes,
            ))
    except Exception as exc:
        print(f"[load_events_from_chain] warning: {exc}")

    return events
