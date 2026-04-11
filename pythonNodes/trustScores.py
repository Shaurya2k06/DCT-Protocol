"""
DCT Trust Score System
======================
Three signals combined into a TrustProfile that gates on-chain delegation.

Signal 1 - Scope adherence (cryptographic, from TLSNotary / on-chain events)
Signal 2 - Task completion (validator-defined, off-chain)
Signal 3 - Outcome quality (time-weighted heuristic, off-chain)
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
    completed       : from Signal 2 validator
    response_body   : selectively revealed portion from TLSNotary attestation
    spend_declared  : USDC (6 decimals) declared in the action
    spend_limit     : USDC (6 decimals) limit in the agent's scope
    latency_ms      : wall-clock time for the action
    timestamp       : UTC time of execution
    tool            : tool name string
    agent_id        : ERC-8004 token ID
    """
    agent_id:       int
    tool:           str
    scope_adhered:  bool
    completed:      bool
    spend_declared: int
    spend_limit:    int
    latency_ms:     int
    timestamp:      datetime
    response_body:  dict = field(default_factory=dict)


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
    signal_1:            Optional[float]   # scope adherence rate
    signal_2:            Optional[float]   # task completion rate
    signal_3:            Optional[float]   # outcome quality
    execution_count:     int
    # On-chain delegation gates derived from tier + composite
    max_children:        int          # width gate
    max_depth:           int          # depth gate
    max_spend_fraction:  float        # fraction of parent spend limit


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
    Validators are defined at delegation time — never by the executing agent.

    Only events whose tool has a registered expectation are scored.
    Events with no expectation are silently skipped (not penalised).
    """
    agent_events = [
        e for e in events
        if e.agent_id == agent_id and e.tool in expectations
    ]
    if not agent_events:
        return None

    completed = 0
    for event in agent_events:
        exp = expectations[event.tool]
        try:
            if exp.validator(event.response_body):
                completed += 1
        except Exception:
            pass   # validator crash = not completed, not an error

    return completed / len(agent_events)


# ---------------------------------------------------------------------------
# Signal 3 — Outcome quality  (time-weighted heuristic)
# ---------------------------------------------------------------------------

DECAY_HALF_LIFE_DAYS = 7.0   # events older than 7 days count for ~50%


def signal_3_outcome_quality(
    agent_id: int,
    events:   list[ExecutionEvent],
    now:      Optional[datetime] = None,
) -> Optional[float]:
    """
    Time-weighted composite quality per execution.

    Quality per execution:
      0.60 — task completed (S2 completion flag on the event)
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
        # Normalise timezone
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

        quality = (
            0.60 * float(e.completed) +
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


def _derive_tier(
    composite:       float,
    execution_count: int,
    s2:              Optional[float],
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

    # If task completion is measurably bad, cap at BRONZE regardless of other signals
    if s2 is not None and s2 < 0.50:
        return AgentTier.BRONZE

    if execution_count >= 50 and composite >= 0.85:
        return AgentTier.GOLD
    if execution_count >= 10 and composite >= 0.70:
        return AgentTier.SILVER
    return AgentTier.BRONZE


# ---------------------------------------------------------------------------
# Combined trust profile
# ---------------------------------------------------------------------------

# Signal weights — S1 is cryptographically backed so it dominates
_W1 = 0.65   # scope adherence  (cryptographic)
_W3 = 0.35   # outcome quality  (heuristic)

# Neutral prior used when a signal has no data yet
_PRIOR = 0.5


def compute_trust_profile(
    agent_id:     int,
    events:       list[ExecutionEvent],
    expectations: dict[str, TaskExpectation],
    now:          Optional[datetime] = None,
) -> TrustProfile:
    """
    Combine all three signals into a TrustProfile.

    S1 and S3 drive the composite score.
    S2 acts as a gate — a low completion rate caps the tier at BRONZE.
    """
    s1 = signal_1_scope_adherence(agent_id, events)
    s2 = signal_2_task_completion(agent_id, events, expectations)
    s3 = signal_3_outcome_quality(agent_id, events, now)

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

    # Fill missing signals with neutral prior — do not treat absence as failure
    s1_val = s1 if s1 is not None else _PRIOR
    s3_val = s3 if s3 is not None else _PRIOR

    composite = _W1 * s1_val + _W3 * s3_val
    tier      = _derive_tier(composite, execution_count, s2)
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
            completed      = False,     # Signal 2 fills this separately
            spend_declared = int(raw["spend_declared"]),
            spend_limit    = int(raw["spend_limit"]),
            latency_ms     = int(raw.get("latency_ms", 0)),
            timestamp      = ts,
            response_body  = raw.get("response_body", {}),
        )
    except (KeyError, ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# On-chain event reader  (Phase 3 integration point)
# ---------------------------------------------------------------------------

def load_events_from_chain(
    registry_contract,          # web3.eth.Contract instance
    enforcer_contract,          # web3.eth.Contract instance
    from_block: int = 0,
) -> list[ExecutionEvent]:
    """
    Read ActionValidated and ActionRejected events from DCTEnforcer
    and produce ExecutionEvent records with scope_adhered set correctly.

    This is a read-only operation — no transactions.
    """
    events: list[ExecutionEvent] = []

    try:
        validated = enforcer_contract.events.ActionValidated.get_logs(
            fromBlock=from_block
        )
        for log in validated:
            a = log["args"]
            events.append(ExecutionEvent(
                agent_id       = a["agentTokenId"],
                tool           = Web3.to_hex(a["toolHash"]),
                scope_adhered  = True,
                completed      = False,
                spend_declared = a["spendAmount"],
                spend_limit    = 0,    # fetch from scopeCommitments if needed
                latency_ms     = 0,
                timestamp      = datetime.now(timezone.utc),
                response_body  = {},
            ))

        rejected = enforcer_contract.events.ActionRejected.get_logs(
            fromBlock=from_block
        )
        for log in rejected:
            a = log["args"]
            events.append(ExecutionEvent(
                agent_id       = a["agentTokenId"],
                tool           = Web3.to_hex(a["toolHash"]) if "toolHash" in a else "",
                scope_adhered  = False,
                completed      = False,
                spend_declared = 0,
                spend_limit    = 0,
                latency_ms     = 0,
                timestamp      = datetime.now(timezone.utc),
                response_body  = {},
            ))
    except Exception as exc:
        print(f"[load_events_from_chain] warning: {exc}")

    return events