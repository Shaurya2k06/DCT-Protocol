"""
Phase 1 — Unit tests for the trust score module.
No network, no chain, no TLSNotary. Pure Python.

Run:
    pip install pytest
    pytest test_trust_score_unit.py -v
"""

import math
from datetime import datetime, timedelta, timezone

import pytest

from trustScores import (
    AgentTier,
    ExecutionEvent,
    TaskExpectation,
    TrustProfile,
    _PRIOR,
    _W1,
    _W3,
    compute_trust_profile,
    parse_tlsn_attestation,
    signal_1_scope_adherence,
    signal_2_task_completion,
    signal_3_outcome_quality,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

NOW = datetime(2026, 4, 11, 12, 0, 0, tzinfo=timezone.utc)
AGENT = 42


def make_event(
    agent_id:       int  = AGENT,
    tool:           str  = "web_fetch",
    scope_adhered:  bool = True,
    completed:      bool = True,
    spend_declared: int  = 1_000_000,   # 1 USDC
    spend_limit:    int  = 10_000_000,  # 10 USDC
    latency_ms:     int  = 200,
    days_ago:       int  = 0,
    response_body:  dict = None,
) -> ExecutionEvent:
    return ExecutionEvent(
        agent_id       = agent_id,
        tool           = tool,
        scope_adhered  = scope_adhered,
        completed      = completed,
        spend_declared = spend_declared,
        spend_limit    = spend_limit,
        latency_ms     = latency_ms,
        timestamp      = NOW - timedelta(days=days_ago),
        response_body  = response_body or {},
    )


def web_fetch_validator(body: dict) -> bool:
    return len(body.get("content", "")) > 0


EXPECTATIONS = {
    "web_fetch": TaskExpectation(
        tool      = "web_fetch",
        validator = web_fetch_validator,
    )
}


# ---------------------------------------------------------------------------
# Signal 1 tests
# ---------------------------------------------------------------------------

class TestSignal1:
    def test_cold_start_returns_none(self):
        assert signal_1_scope_adherence(AGENT, []) is None

    def test_different_agent_returns_none(self):
        events = [make_event(agent_id=99)]
        assert signal_1_scope_adherence(AGENT, events) is None

    def test_perfect_adherence(self):
        events = [make_event(scope_adhered=True) for _ in range(10)]
        assert signal_1_scope_adherence(AGENT, events) == 1.0

    def test_zero_adherence(self):
        events = [make_event(scope_adhered=False) for _ in range(5)]
        assert signal_1_scope_adherence(AGENT, events) == 0.0

    def test_partial_adherence(self):
        events = (
            [make_event(scope_adhered=True)  for _ in range(7)] +
            [make_event(scope_adhered=False) for _ in range(3)]
        )
        result = signal_1_scope_adherence(AGENT, events)
        assert abs(result - 0.7) < 1e-9

    def test_mixed_agents_only_counts_target(self):
        events = [
            make_event(agent_id=AGENT, scope_adhered=True),
            make_event(agent_id=99,    scope_adhered=False),
            make_event(agent_id=AGENT, scope_adhered=True),
        ]
        assert signal_1_scope_adherence(AGENT, events) == 1.0


# ---------------------------------------------------------------------------
# Signal 2 tests
# ---------------------------------------------------------------------------

class TestSignal2:
    def test_cold_start_returns_none(self):
        assert signal_2_task_completion(AGENT, [], EXPECTATIONS) is None

    def test_no_matching_tool_returns_none(self):
        events = [make_event(tool="x402_pay")]
        assert signal_2_task_completion(AGENT, events, EXPECTATIONS) is None

    def test_perfect_completion(self):
        events = [
            make_event(tool="web_fetch", response_body={"content": "hello"})
            for _ in range(5)
        ]
        assert signal_2_task_completion(AGENT, events, EXPECTATIONS) == 1.0

    def test_zero_completion(self):
        events = [
            make_event(tool="web_fetch", response_body={"content": ""})
            for _ in range(5)
        ]
        assert signal_2_task_completion(AGENT, events, EXPECTATIONS) == 0.0

    def test_validator_crash_counts_as_failure(self):
        def crashing_validator(body: dict) -> bool:
            raise RuntimeError("boom")

        exps = {"web_fetch": TaskExpectation(tool="web_fetch", validator=crashing_validator)}
        events = [make_event(tool="web_fetch")]
        # Should not raise; should count as not completed
        result = signal_2_task_completion(AGENT, events, exps)
        assert result == 0.0

    def test_partial_completion(self):
        events = [
            make_event(tool="web_fetch", response_body={"content": "data"}),
            make_event(tool="web_fetch", response_body={"content": ""}),
            make_event(tool="web_fetch", response_body={"content": "more"}),
            make_event(tool="web_fetch", response_body={"content": ""}),
        ]
        result = signal_2_task_completion(AGENT, events, EXPECTATIONS)
        assert abs(result - 0.5) < 1e-9


# ---------------------------------------------------------------------------
# Signal 3 tests
# ---------------------------------------------------------------------------

class TestSignal3:
    def test_cold_start_returns_none(self):
        assert signal_3_outcome_quality(AGENT, [], now=NOW) is None

    def test_perfect_quality(self):
        # completed, scope_adhered, spend=0
        events = [
            make_event(
                scope_adhered  = True,
                completed      = True,
                spend_declared = 0,
                spend_limit    = 10_000_000,
            )
        ]
        result = signal_3_outcome_quality(AGENT, events, now=NOW)
        # 0.60 + 0.30 + 0.10*(1-0) = 1.0
        assert abs(result - 1.0) < 1e-9

    def test_zero_quality(self):
        events = [
            make_event(
                scope_adhered  = False,
                completed      = False,
                spend_declared = 10_000_000,
                spend_limit    = 10_000_000,
            )
        ]
        result = signal_3_outcome_quality(AGENT, events, now=NOW)
        # 0 + 0 + 0.10*(1-1.0) = 0
        assert abs(result - 0.0) < 1e-9

    def test_recent_events_outweigh_old(self):
        recent = make_event(scope_adhered=True,  completed=True,  days_ago=0)
        old    = make_event(scope_adhered=False, completed=False, days_ago=60)
        result = signal_3_outcome_quality(AGENT, [recent, old], now=NOW)
        # Recent event is ~1.0 quality, old is ~0.0
        # Half-life = 7 days; 60 days ago weight ≈ e^(-0.099*60) ≈ 0.0026
        assert result > 0.9

    def test_decay_is_exponential(self):
        half_life = 7
        # Both events have identical quality — only weight differs
        # This isolates the decay behaviour from the quality calculation
        e_now = make_event(
            scope_adhered  = True,
            completed      = True,
            spend_declared = 0,
            spend_limit    = 10_000_000,
            days_ago       = 0,
        )
        e_old = make_event(
            scope_adhered  = True,
            completed      = True,
            spend_declared = 0,
            spend_limit    = 10_000_000,
            days_ago       = half_life,
        )
        result   = signal_3_outcome_quality(AGENT, [e_now, e_old], now=NOW)

        k          = math.log(2) / 7
        weight_old = math.exp(-k * half_life)
        quality    = 1.0   # same for both events
        expected   = (1.0 * quality + weight_old * quality) / (1.0 + weight_old)
        assert abs(result - expected) < 0.001


# ---------------------------------------------------------------------------
# Composite TrustProfile tests
# ---------------------------------------------------------------------------

class TestComputeTrustProfile:
    def test_cold_start(self):
        profile = compute_trust_profile(AGENT, [], EXPECTATIONS, now=NOW)
        assert profile.tier             == AgentTier.COLD
        assert profile.composite_score  == 0.0
        assert profile.max_children     == 1
        assert profile.max_depth        == 1
        assert profile.max_spend_fraction == 0.10

    def test_bronze_tier_low_count(self):
        events = [make_event() for _ in range(5)]
        profile = compute_trust_profile(AGENT, events, EXPECTATIONS, now=NOW)
        assert profile.tier == AgentTier.BRONZE
        assert profile.max_children == 2

    def test_silver_tier(self):
        events = [make_event(response_body={"content": "data"}) for _ in range(15)]
        profile = compute_trust_profile(AGENT, events, EXPECTATIONS, now=NOW)
        assert profile.tier == AgentTier.SILVER

    def test_gold_tier(self):
        events = [make_event(response_body={"content": "data"}) for _ in range(55)]
        profile = compute_trust_profile(AGENT, events, EXPECTATIONS, now=NOW)
        assert profile.tier == AgentTier.GOLD

    def test_bad_s2_caps_at_bronze(self):
        # 60 executions with bad completion should stay BRONZE despite count
        events = [
            make_event(
                tool          = "web_fetch",
                response_body = {"content": ""},    # validator returns False
            )
            for _ in range(60)
        ]
        profile = compute_trust_profile(AGENT, events, EXPECTATIONS, now=NOW)
        assert profile.tier == AgentTier.BRONZE

    def test_composite_formula(self):
        # All perfect: s1=1.0, s3≈1.0 → composite ≈ 1.0
        events = [
            make_event(
                scope_adhered  = True,
                completed      = True,
                spend_declared = 0,
                spend_limit    = 10_000_000,
                days_ago       = 0,
            )
            for _ in range(10)
        ]
        profile = compute_trust_profile(AGENT, events, EXPECTATIONS, now=NOW)
        assert profile.composite_score > 0.95

    def test_no_s2_data_uses_prior_for_tier(self):
        # Tool without an expectation — s2 is None, should not penalise
        events = [make_event(tool="x402_pay") for _ in range(15)]
        profile = compute_trust_profile(AGENT, events, {}, now=NOW)
        # s2 is None so tier is not capped
        assert profile.tier in (AgentTier.SILVER, AgentTier.BRONZE)

    def test_prior_used_when_signal_missing(self):
        # Only one event — s1 is meaningful, s3 is also meaningful
        events = [make_event(scope_adhered=True, completed=True)]
        profile = compute_trust_profile(AGENT, events, EXPECTATIONS, now=NOW)
        expected_s1 = 1.0
        # s3 with one perfect event ≈ 1.0
        assert profile.composite_score >= _W1 * expected_s1


# ---------------------------------------------------------------------------
# TLSNotary attestation parser tests
# ---------------------------------------------------------------------------

class TestParseTlsnAttestation:
    def _base(self) -> dict:
        return {
            "agent_id":       42,
            "tool":           "web_fetch",
            "status_code":    200,
            "spend_declared": 1_000_000,
            "spend_limit":    10_000_000,
            "latency_ms":     150,
            "timestamp":      "2026-04-11T12:00:00Z",
            "response_body":  {"content": "hello"},
            "endpoint_hash":  "0xabc123",
        }

    def test_valid_attestation(self):
        event = parse_tlsn_attestation(self._base())
        assert event is not None
        assert event.agent_id      == 42
        assert event.scope_adhered is True
        assert event.tool          == "web_fetch"

    def test_4xx_marks_scope_not_adhered(self):
        raw = self._base()
        raw["status_code"] = 403
        event = parse_tlsn_attestation(raw)
        assert event is not None
        assert event.scope_adhered is False

    def test_5xx_marks_scope_not_adhered(self):
        raw = self._base()
        raw["status_code"] = 500
        event = parse_tlsn_attestation(raw)
        assert event is not None
        assert event.scope_adhered is False

    def test_missing_required_field_returns_none(self):
        raw = self._base()
        del raw["agent_id"]
        assert parse_tlsn_attestation(raw) is None

    def test_malformed_timestamp_returns_none(self):
        raw = self._base()
        raw["timestamp"] = "not-a-date"
        assert parse_tlsn_attestation(raw) is None

    def test_unix_timestamp(self):
        raw = self._base()
        raw["timestamp"] = 1_744_372_800   # unix int
        event = parse_tlsn_attestation(raw)
        assert event is not None

    def test_completed_is_false_by_default(self):
        # Signal 2 fills completed separately — parser never sets it True
        event = parse_tlsn_attestation(self._base())
        assert event.completed is False