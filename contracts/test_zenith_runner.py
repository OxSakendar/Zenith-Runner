"""
Unit tests for ZenithRunnerContract (contracts/zenith_runner.py).
Mocks the GenLayer runtime environment (genlayer module) so all smart contract
rules, invariants, consensus mechanisms, replay protection, and daily check-ins
can be thoroughly tested deterministically.
"""

import sys
import types
import unittest
import json

# ─── Mock the `genlayer` module before importing the contract ─────────────────
gl_mock = types.ModuleType("genlayer")

class MockAddress(str):
    def __init__(self, val):
        self.val = str(val).lower()
    def __str__(self):
        return self.val
    def __eq__(self, other):
        return str(self).lower() == str(other).lower()
    def __hash__(self):
        return hash(str(self).lower())

class MockU256(int):
    pass

class MockTreeMap(dict):
    pass

class MockDynArray(list):
    pass

class MockMessage:
    def __init__(self, sender="0x1111111111111111111111111111111111111111", value=10000000000000000):
        self.sender = MockAddress(sender)
        self.value = value

class MockGlNamespace:
    class Contract:
        pass

    class public:
        class write:
            @staticmethod
            def payable(f):
                return f
        @staticmethod
        def view(f):
            return f

    message = MockMessage()

    class eq_principle:
        @staticmethod
        def prompt_comparative(fn, principle=""):
            return fn()

        @staticmethod
        def strict_eq(fn):
            return fn()

    class nondet:
        @staticmethod
        def exec_prompt(prompt: str, response_format="json"):
            return MockGlNamespace.exec_prompt(prompt)

        class web:
            @staticmethod
            def get(url: str):
                class MockResponse:
                    text = MockGlNamespace.get_webpage(url)
                return MockResponse()

    @staticmethod
    def exec_prompt(prompt: str) -> str:
        # Default mock: returns VALID for physically plausible rules
        return '{"verdict": "VALID", "reason": "Plausible speed and crystal count"}'

    @staticmethod
    def get_webpage(url: str, mode: str = "text") -> str:
        # Default mock: returns standard worldtimeapi.org payload
        return '{"datetime": "2026-10-15T12:00:00.000000+00:00"}'

gl_mock.Address = MockAddress
gl_mock.u256 = MockU256
gl_mock.TreeMap = MockTreeMap
gl_mock.DynArray = MockDynArray
gl_mock.gl = MockGlNamespace

sys.modules["genlayer"] = gl_mock

# Now import the contract
from contracts.zenith_runner import ZenithRunnerContract, SESSION_FEE_WEI

class TestZenithRunnerContract(unittest.TestCase):
    def setUp(self):
        self.owner = "0x9999999999999999999999999999999999999999"
        self.contract = ZenithRunnerContract(self.owner)
        self.pilot = "0x1111111111111111111111111111111111111111"
        MockGlNamespace.message = MockMessage(sender=self.pilot, value=SESSION_FEE_WEI)
        MockGlNamespace.exec_prompt = lambda prompt: '{"verdict": "VALID", "reason": "Plausible run"}'
        MockGlNamespace.get_webpage = lambda url, mode="text": '{"datetime": "2026-10-15T12:00:00.000000+00:00"}'

    # ── Fee Tests ─────────────────────────────────────────────────────────────
    def test_authorize_session_fails_with_insufficient_fee(self):
        MockGlNamespace.message.value = SESSION_FEE_WEI - 1
        with self.assertRaises(ValueError) as ctx:
            self.contract.authorize_game_session()
        self.assertIn("Insufficient session fee", str(ctx.exception))

    def test_submit_high_score_fails_with_insufficient_fee(self):
        # Authorize first
        auth = self.contract.authorize_game_session()
        nonce = auth["session_nonce"]

        MockGlNamespace.message.value = SESSION_FEE_WEI - 1
        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(nonce, score=100, crystals_collected=5, duration_seconds=15)
        self.assertIn("Insufficient fee", str(ctx.exception))

    def test_daily_checkin_fails_with_insufficient_fee(self):
        MockGlNamespace.message.value = SESSION_FEE_WEI - 1
        with self.assertRaises(ValueError) as ctx:
            self.contract.daily_checkin("2026-10-15")
        self.assertIn("Insufficient fee", str(ctx.exception))

    # ── Session Authorization & Replay Protection ─────────────────────────────
    def test_authorize_session_success_and_nonce_issuance(self):
        auth = self.contract.authorize_game_session()
        self.assertEqual(auth["status"], "AUTHORIZED")
        self.assertEqual(auth["session_id"], 1)
        self.assertEqual(auth["session_nonce"], f"{self.pilot.lower()}:1")

        # Pilot profile was registered
        prof = self.contract.get_pilot_profile(self.pilot)
        self.assertTrue(prof["registered"])
        self.assertEqual(prof["total_sessions"], 1)

    def test_replay_attack_rejected(self):
        auth = self.contract.authorize_game_session()
        nonce = auth["session_nonce"]

        # First submission succeeds
        res1 = self.contract.submit_high_score(nonce, score=100, crystals_collected=5, duration_seconds=15)
        self.assertEqual(res1["status"], "SUCCESS")

        # Second submission with the same nonce must be rejected
        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(nonce, score=100, crystals_collected=5, duration_seconds=15)
        self.assertIn("replay attack detected", str(ctx.exception))

    def test_nonce_belonging_to_another_pilot_rejected(self):
        auth = self.contract.authorize_game_session()
        nonce = auth["session_nonce"]

        # Other pilot tries to use pilot 1's nonce
        other_pilot = "0x2222222222222222222222222222222222222222"
        MockGlNamespace.message = MockMessage(sender=other_pilot, value=SESSION_FEE_WEI)

        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(nonce, score=100, crystals_collected=5, duration_seconds=15)
        self.assertIn("session_nonce pilot mismatch", str(ctx.exception))

    # ── Score Evidence & Physics Bounds ───────────────────────────────────────
    def test_negative_score_rejected(self):
        auth = self.contract.authorize_game_session()
        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(auth["session_nonce"], score=-10, crystals_collected=1, duration_seconds=10)
        self.assertIn("out of bounds", str(ctx.exception))

    def test_score_exceeding_max_ceiling_rejected(self):
        auth = self.contract.authorize_game_session()
        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(auth["session_nonce"], score=6000, crystals_collected=300, duration_seconds=600)
        self.assertIn("out of bounds", str(ctx.exception))

    def test_score_without_crystals_rejected(self):
        auth = self.contract.authorize_game_session()
        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(auth["session_nonce"], score=100, crystals_collected=0, duration_seconds=10)
        self.assertIn("score must be 0 when crystals_collected is 0", str(ctx.exception))

    def test_score_exceeding_crystal_multiplier_rejected(self):
        auth = self.contract.authorize_game_session()
        # 5 crystals * max 20 pts = 100 max pts. 101 points is physically impossible.
        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(auth["session_nonce"], score=101, crystals_collected=5, duration_seconds=15)
        self.assertIn("exceeds hard physics ceiling", str(ctx.exception))

    def test_duration_shorter_than_spawn_delay_rejected(self):
        auth = self.contract.authorize_game_session()
        # 10 crystals require at least 20 seconds
        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(auth["session_nonce"], score=150, crystals_collected=10, duration_seconds=15)
        self.assertIn("too short for 10 crystals", str(ctx.exception))

    # ── Consensus Anti-Cheat Verification ─────────────────────────────────────
    def test_anti_cheat_consensus_valid_updates_state(self):
        auth = self.contract.authorize_game_session()
        res = self.contract.submit_high_score(auth["session_nonce"], score=180, crystals_collected=10, duration_seconds=25)

        self.assertEqual(res["status"], "SUCCESS")
        self.assertEqual(res["score_added"], 180)
        self.assertEqual(res["total_score"], 180)
        self.assertEqual(res["high_score"], 180)

        prof = self.contract.get_pilot_profile(self.pilot)
        self.assertEqual(prof["total_score"], 180)
        self.assertEqual(prof["high_score"], 180)

        # Leaderboard contains the entry
        lb = self.contract.get_leaderboard()
        self.assertEqual(len(lb), 1)
        self.assertEqual(lb[0]["address"], str(self.pilot))
        self.assertEqual(lb[0]["score"], 180)

    def test_anti_cheat_consensus_invalid_rejects_and_preserves_state(self):
        auth = self.contract.authorize_game_session()
        # Mock LLM consensus reporting INVALID
        MockGlNamespace.exec_prompt = lambda prompt: '{"verdict": "INVALID", "reason": "Physics impossible"}'

        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(auth["session_nonce"], score=100, crystals_collected=5, duration_seconds=15)
        self.assertIn("Score rejected by anti-cheat consensus", str(ctx.exception))

        # Profile score must remain 0
        prof = self.contract.get_pilot_profile(self.pilot)
        self.assertEqual(prof["total_score"], 0)
        self.assertEqual(prof["high_score"], 0)

    def test_anti_cheat_consensus_indeterminate_or_malformed_rejects(self):
        auth = self.contract.authorize_game_session()
        # Mock LLM consensus producing garbage
        MockGlNamespace.exec_prompt = lambda prompt: 'NOT_A_JSON_STRING'

        with self.assertRaises(ValueError) as ctx:
            self.contract.submit_high_score(auth["session_nonce"], score=100, crystals_collected=5, duration_seconds=15)
        self.assertIn("Score rejected by anti-cheat consensus", str(ctx.exception))

    # ── Daily Check-in & Time Verification ────────────────────────────────────
    def test_daily_checkin_success_with_matching_authoritative_date(self):
        res = self.contract.daily_checkin("2026-10-15")
        self.assertEqual(res["status"], "SUCCESS")
        self.assertEqual(res["bonus_points_awarded"], 10)
        self.assertEqual(res["authoritative_date"], "2026-10-15")
        self.assertEqual(res["current_streak"], 1)

        prof = self.contract.get_pilot_profile(self.pilot)
        self.assertEqual(prof["bonus_points"], 10)
        self.assertEqual(prof["checkin_streak"], 1)
        self.assertEqual(prof["last_checkin"], "2026-10-15")
        self.assertEqual(prof["total_score"], 10)

    def test_daily_checkin_rejects_untrusted_client_date(self):
        # Client lies and claims yesterday or tomorrow
        with self.assertRaises(ValueError) as ctx:
            self.contract.daily_checkin("2026-10-14")
        self.assertIn("does not match authoritative UTC date", str(ctx.exception))

        # Profile untouched
        prof = self.contract.get_pilot_profile(self.pilot)
        self.assertFalse(prof.get("registered", False))

    def test_daily_checkin_rejects_duplicate_checkin_same_day(self):
        self.contract.daily_checkin("2026-10-15")

        # Second check-in on the same day must raise ValueError
        with self.assertRaises(ValueError) as ctx:
            self.contract.daily_checkin("2026-10-15")
        self.assertIn("Already checked in today", str(ctx.exception))

        # Bonus points not double awarded
        prof = self.contract.get_pilot_profile(self.pilot)
        self.assertEqual(prof["bonus_points"], 10)

    # ── View Methods ──────────────────────────────────────────────────────────
    def test_view_leaderboard_sorting(self):
        # Pilot 1 gets 100
        auth1 = self.contract.authorize_game_session()
        self.contract.submit_high_score(auth1["session_nonce"], 100, 5, 15)

        # Pilot 2 gets 300
        p2 = "0x2222222222222222222222222222222222222222"
        MockGlNamespace.message = MockMessage(sender=p2, value=SESSION_FEE_WEI)
        auth2 = self.contract.authorize_game_session()
        self.contract.submit_high_score(auth2["session_nonce"], 300, 15, 35)

        # Leaderboard should have p2 first then p1
        lb = self.contract.get_leaderboard()
        self.assertEqual(len(lb), 2)
        self.assertEqual(lb[0]["address"], p2)
        self.assertEqual(lb[0]["score"], 300)
        self.assertEqual(lb[1]["address"], self.pilot)
        self.assertEqual(lb[1]["score"], 100)

    def test_view_contract_stats(self):
        stats = self.contract.get_contract_stats()
        self.assertEqual(stats["total_pilots"], 0)
        self.assertEqual(stats["total_game_sessions"], 0)

        self.contract.authorize_game_session()
        stats2 = self.contract.get_contract_stats()
        self.assertEqual(stats2["total_pilots"], 1)
        self.assertEqual(stats2["total_game_sessions"], 1)


if __name__ == "__main__":
    unittest.main()
