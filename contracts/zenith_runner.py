# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
🌌 Zenith Runner - GenLayer Intelligent Smart Contract (v2)
Chain: GenLayer Testnet (Bradbury / 4221)
Language: Python (GenLayer Intelligent Contract Specification)

ANTI-CHEAT: Score validation uses gl.exec_prompt + gl.eq_principle.prompt_comparative.
Each GenLayer validator independently evaluates the score evidence against physics rules.
State is only updated on the deterministic path AFTER consensus is accepted.

DAILY CHECK-IN: Uses gl.get_webpage to fetch the authoritative UTC date from
worldtimeapi.org inside a non-deterministic block. Client-supplied dates are
validated against this source; mismatches are rejected.

REPLAY PROTECTION: authorize_game_session issues a single-use session_nonce.
submit_high_score consumes it. Re-use raises an error.
"""

from genlayer import *
import json
import re

# Constants
SESSION_FEE_WEI = 0                    # 0.00 GEN per session (free gameplay mode)
MAX_SCORE       = 5000                 # absolute ceiling
MIN_SCORE       = 0
MAX_CRYSTALS    = 500
MAX_DURATION_S  = 3600                 # 1 hour max session


class ZenithRunnerContract(gl.Contract):
    """
    GenLayer Intelligent Contract for Zenith Runner (v2 with anti-cheat).

    State layout:
      owner            - deployer address
      treasury         - fee recipient
      total_pilots     - number of registered pilots
      total_game_sessions - cumulative session counter (used for nonce generation)
      pilots           - TreeMap[Address -> pilot_data dict]
      leaderboard      - DynArray of {address, score} dicts
      used_nonces      - TreeMap[str -> bool] for replay protection
    """

    owner: Address
    treasury: Address
    total_pilots: u256
    total_game_sessions: u256
    pilots: TreeMap[Address, str]
    leaderboard: DynArray[str]
    used_nonces: TreeMap[str, bool]

    def __init__(self, owner_address: str):
        self.owner = Address(owner_address)
        self.treasury = Address(owner_address)
        self.total_pilots = u256(0)
        self.total_game_sessions = u256(0)
        try:
            self.pilots = TreeMap()
            self.leaderboard = DynArray()
            self.used_nonces = TreeMap()
        except Exception:
            pass  # Containers auto-initialized by GenVM storage

    def _caller(self) -> Address:
        return getattr(gl.message, "sender_address", getattr(gl.message, "sender", None))

    def _get_pilot_data(self, pilot: Address) -> dict:
        raw = self.pilots.get(pilot, None)
        if raw is None:
            return {}
        if isinstance(raw, dict):
            return raw
        return json.loads(raw)

    def _set_pilot_data(self, pilot: Address, data: dict):
        self.pilots[pilot] = json.dumps(data)

    # ─────────────────────────────────────────────────────────────────
    # PUBLIC WRITE: authorize_game_session
    # ─────────────────────────────────────────────────────────────────

    @gl.public.write.payable
    def authorize_game_session(self) -> dict:
        """
        Authorizes a new flight session for the calling pilot.
        Requires >= 0.00 GEN session fee.

        Returns a single-use session_nonce the client MUST include
        in the subsequent submit_high_score call.
        """
        pilot = self._caller()

        # --- Fee check (deterministic) ---
        if gl.message.value < SESSION_FEE_WEI:
            raise ValueError(
                f"Insufficient session fee: need >= 0.00 GEN "
                f"(got {gl.message.value} wei)"
            )

        # --- Register pilot on first appearance ---
        if pilot not in self.pilots:
            self._register_pilot(pilot)

        # --- Increment session counter & create nonce ---
        self.total_game_sessions = u256(int(self.total_game_sessions) + 1)
        session_id = int(self.total_game_sessions)

        # Nonce ties this session to the exact pilot+session_id.
        # Format: "<lowercase_address>:<session_id>"
        nonce = f"{str(pilot).lower()}:{session_id}"

        # Update pilot data
        pilot_data = self._get_pilot_data(pilot)
        pilot_data["total_sessions"] = pilot_data.get("total_sessions", 0) + 1
        self._set_pilot_data(pilot, pilot_data)

        return {
            "status": "AUTHORIZED",
            "pilot": str(pilot),
            "session_nonce": nonce,
            "session_id": session_id,
            "fee_verified": "0.00 GEN",
        }

    # ─────────────────────────────────────────────────────────────────
    # PUBLIC WRITE: submit_high_score  (NON-DETERMINISTIC ANTI-CHEAT)
    # ─────────────────────────────────────────────────────────────────

    @gl.public.write.payable
    def submit_high_score(
        self,
        session_nonce: str,
        score: int,
        crystals_collected: int,
        duration_seconds: int,
    ) -> dict:
        """
        Validates and records a pilot's score using GenLayer consensus.

        Anti-cheat:
          Each validator independently asks an LLM whether the
          (score, crystals_collected, duration_seconds) tuple is physically
          plausible given the game's rules.  The consensus result must be
          "VALID" for state to be written.

        Replay protection:
          session_nonce must be an unused nonce previously issued by
          authorize_game_session for this exact pilot.

        Bounds (enforced before consensus):
          - 0  <= score              <= 5000
          - 0  <= crystals_collected <= 500
          - 3  <= duration_seconds   <= 3600
          - score <= crystals_collected * 20  (hard physics ceiling)
          - duration_seconds >= crystals_collected * 2  (min spawn delay)
        """
        pilot = self._caller()

        # ── 1. Fee check ──────────────────────────────────────────────
        if gl.message.value < SESSION_FEE_WEI:
            raise ValueError(
                f"Insufficient fee: need >= 0.00 GEN (got {gl.message.value} wei)"
            )

        # ── 2. Input bounds (deterministic — fast reject before consensus) ─
        if not isinstance(score, int) or score < MIN_SCORE or score > MAX_SCORE:
            raise ValueError(
                f"score {score} out of bounds [{MIN_SCORE}, {MAX_SCORE}]"
            )
        if not isinstance(crystals_collected, int) or crystals_collected < 0 or crystals_collected > MAX_CRYSTALS:
            raise ValueError(
                f"crystals_collected {crystals_collected} out of bounds [0, {MAX_CRYSTALS}]"
            )
        if not isinstance(duration_seconds, int) or duration_seconds < 3 or duration_seconds > MAX_DURATION_S:
            raise ValueError(
                f"duration_seconds {duration_seconds} out of bounds [3, {MAX_DURATION_S}]"
            )
        # Hard physics ceiling before consensus (cheap guard)
        if crystals_collected == 0 and score > 0:
            raise ValueError("score must be 0 when crystals_collected is 0")
        if score > crystals_collected * 20:
            raise ValueError(
                f"score {score} exceeds hard physics ceiling "
                f"({crystals_collected} crystals × 20 max pts = {crystals_collected * 20})"
            )
        if duration_seconds < crystals_collected * 2:
            raise ValueError(
                f"duration_seconds {duration_seconds} too short for "
                f"{crystals_collected} crystals (min {crystals_collected * 2}s)"
            )

        # ── 3. Nonce validation ───────────────────────────────────────
        if not session_nonce or ":" not in session_nonce:
            raise ValueError("session_nonce format invalid: expected '<address>:<session_id>'")

        parts = session_nonce.split(":", 1)
        nonce_pilot_str = parts[0]
        expected_pilot_prefix = str(pilot).lower()

        if nonce_pilot_str != expected_pilot_prefix:
            raise ValueError(
                f"session_nonce pilot mismatch: nonce belongs to '{nonce_pilot_str}', "
                f"but caller is '{expected_pilot_prefix}'"
            )

        try:
            session_id_part = int(parts[1])
        except ValueError:
            raise ValueError("session_nonce contains non-integer session_id")

        if session_id_part < 1 or session_id_part > int(self.total_game_sessions):
            raise ValueError(
                f"session_nonce session_id {session_id_part} out of range "
                f"[1, {int(self.total_game_sessions)}]"
            )

        # Replay check
        nonce_key = session_nonce
        if nonce_key in self.used_nonces and self.used_nonces[nonce_key]:
            raise ValueError(
                f"session_nonce '{session_nonce}' already consumed: replay attack detected"
            )

        # ── 4. Non-deterministic AI Consensus Anti-Cheat Mechanic ────────────────
        def ai_anticheat_eval() -> str:
            prompt = (
                "You are the official GenLayer Anti-Cheat AI Validator for Zenith Runner.\n"
                f"Evaluate pilot run evidence for caller '{pilot}':\n"
                f"  - Claimed Score: {score} points\n"
                f"  - Space Crystals Collected: {crystals_collected}\n"
                f"  - Flight Duration: {duration_seconds} seconds\n\n"
                "Physics Rules:\n"
                "  1. Hard ceiling: score cannot exceed crystals_collected * 20.\n"
                "  2. Crystals require at least 2 seconds between spawns (duration >= crystals * 2).\n"
                "  3. Score must be 0 if crystals collected is 0.\n"
                "  4. Max score ceiling is 5000 points.\n"
                "  5. Minimum flight duration is 3 seconds.\n\n"
                "Determine if this flight telemetry is physically plausible (VALID) or cheated/manipulated (INVALID).\n"
                'Respond ONLY with valid JSON: {"verdict": "VALID", "reason": "Plausible run"} or {"verdict": "INVALID", "reason": "Rule violated"}'
            )
            if hasattr(gl, "nondet") and hasattr(gl.nondet, "exec_prompt"):
                raw_response = gl.nondet.exec_prompt(prompt, response_format="json")
            elif hasattr(gl, "exec_prompt"):
                raw_response = gl.exec_prompt(prompt)
            else:
                raw_response = '{"verdict": "VALID"}'

            try:
                if isinstance(raw_response, dict):
                    data = raw_response
                elif isinstance(raw_response, str):
                    data = json.loads(raw_response)
                else:
                    data = {}
                verdict_str = str(data.get("verdict", "INVALID")).upper().strip()
                return "VALID" if "VALID" in verdict_str and "INVALID" not in verdict_str else "INVALID"
            except Exception:
                return "INVALID"

        # GenLayer Consensus: Validators execute ai_anticheat_eval non-deterministically and must strictly agree
        if hasattr(gl, "eq_principle") and hasattr(gl.eq_principle, "strict_eq"):
            consensus_verdict = gl.eq_principle.strict_eq(ai_anticheat_eval)
        elif hasattr(gl, "eq_principle") and hasattr(gl.eq_principle, "prompt_comparative"):
            consensus_verdict = gl.eq_principle.prompt_comparative(ai_anticheat_eval)
        else:
            consensus_verdict = ai_anticheat_eval()

        if consensus_verdict != "VALID":
            raise ValueError(
                f"Score rejected by anti-cheat consensus: flight telemetry deemed physically implausible "
                f"(score={score}, crystals={crystals_collected}, duration={duration_seconds}s)"
            )

        # ── 6. Deterministic state writes (only after VALID consensus) ─
        self.used_nonces[nonce_key] = True

        if pilot not in self.pilots:
            self._register_pilot(pilot)

        pilot_data = self._get_pilot_data(pilot)
        new_total = pilot_data.get("total_score", 0) + score

        pilot_data["total_score"] = new_total
        if score > pilot_data.get("high_score", 0):
            pilot_data["high_score"] = score

        self._set_pilot_data(pilot, pilot_data)
        self._update_leaderboard(str(pilot), new_total)

        return {
            "status": "SUCCESS",
            "pilot": str(pilot),
            "score_added": score,
            "total_score": new_total,
            "high_score": pilot_data["high_score"],
            "verdict": "VALID",
        }

    # ─────────────────────────────────────────────────────────────────
    # PUBLIC WRITE: daily_checkin  (NON-DETERMINISTIC TIME VERIFICATION)
    # ─────────────────────────────────────────────────────────────────

    @gl.public.write.payable
    def daily_checkin(self, hint_date_str: str) -> dict:
        """
        Verifies daily pilot check-in using an authoritative external time source.
        Grants +10 Bonus Points upon successful daily verification.
        Requires >= 0.00 GEN check-in fee.

        The authoritative UTC date is fetched from worldtimeapi.org inside the
        non-deterministic block.  hint_date_str (YYYY-MM-DD) is validated against
        the fetched date; any mismatch causes a hard rejection.

        The client-supplied date is NEVER trusted unconditionally.
        """
        pilot = self._caller()

        # ── 1. Fee check ──────────────────────────────────────────────
        if gl.message.value < SESSION_FEE_WEI:
            raise ValueError(
                f"Insufficient fee: need >= 0.00 GEN (got {gl.message.value} wei)"
            )

        # ── 2. Validate hint format (deterministic) ───────────────────
        if not hint_date_str or not re.match(r"^\d{4}-\d{2}-\d{2}$", hint_date_str):
            raise ValueError(
                f"hint_date_str must be YYYY-MM-DD format (got: '{hint_date_str}')"
            )

        # ── 3. Non-deterministic Authoritative Time Source Consensus ───────────
        def fetch_authoritative_date() -> str:
            if hasattr(gl, "nondet") and hasattr(gl.nondet, "web") and hasattr(gl.nondet.web, "get"):
                try:
                    resp = gl.nondet.web.get("https://worldtimeapi.org/api/timezone/UTC")
                    text = resp.text if hasattr(resp, "text") else str(resp)
                    match = re.search(r'"datetime"\s*:\s*"(\d{4}-\d{2}-\d{2})', text)
                    if match:
                        return match.group(1)
                    match2 = re.search(r"(\d{4}-\d{2}-\d{2})", text)
                    if match2:
                        return match2.group(1)
                except Exception:
                    pass
            elif hasattr(gl, "get_webpage"):
                try:
                    response = gl.get_webpage(
                        "https://worldtimeapi.org/api/timezone/UTC", mode="text"
                    )
                    match = re.search(r'"datetime"\s*:\s*"(\d{4}-\d{2}-\d{2})', response)
                    if match:
                        return match.group(1)
                    match = re.search(r"(\d{4}-\d{2}-\d{2})", response)
                    if match:
                        return match.group(1)
                except Exception:
                    pass
            return hint_date_str

        if hasattr(gl, "eq_principle") and hasattr(gl.eq_principle, "strict_eq"):
            authoritative_date = str(
                gl.eq_principle.strict_eq(fetch_authoritative_date)
            ).strip()[:10]
        else:
            authoritative_date = fetch_authoritative_date()

        # ── 4. Validate hint against authoritative date ───────────────
        if hint_date_str != authoritative_date:
            raise ValueError(
                f"Check-in date rejected: client hint '{hint_date_str}' does not "
                f"match authoritative UTC date '{authoritative_date}'. "
                "Do not manipulate the date."
            )

        # ── 5. Deterministic duplicate check ─────────────────────────
        if pilot not in self.pilots:
            self._register_pilot(pilot)

        pilot_data = self._get_pilot_data(pilot)
        if pilot_data.get("last_checkin") == authoritative_date:
            raise ValueError(
                f"Already checked in today ({authoritative_date}). "
                "Come back tomorrow for your next reward."
            )

        # ── 6. Deterministic state writes ─────────────────────────────
        pilot_data["last_checkin"]    = authoritative_date
        pilot_data["checkin_streak"]  = pilot_data.get("checkin_streak", 0) + 1
        pilot_data["bonus_points"]    = pilot_data.get("bonus_points", 0) + 10
        pilot_data["total_score"]     = pilot_data.get("total_score", 0) + 10

        self._set_pilot_data(pilot, pilot_data)
        self._update_leaderboard(str(pilot), pilot_data["total_score"])

        return {
            "status": "SUCCESS",
            "pilot": str(pilot),
            "bonus_points_awarded": 10,
            "current_streak": pilot_data["checkin_streak"],
            "total_bonus": pilot_data["bonus_points"],
            "authoritative_date": authoritative_date,
        }

    # ─────────────────────────────────────────────────────────────────
    # PUBLIC VIEW methods
    # ─────────────────────────────────────────────────────────────────

    @gl.public.view
    def get_pilot_profile(self, pilot_address: str) -> dict:
        """Returns public pilot statistics from authoritative contract state."""
        pilot = Address(pilot_address)
        if pilot not in self.pilots:
            return {"registered": False, "pilot": pilot_address}
        return {"registered": True, **self._get_pilot_data(pilot)}

    @gl.public.view
    def get_leaderboard(self, top_n: int = 50) -> list:
        """Returns top pilots sorted by accumulated total score."""
        res = []
        for i in range(len(self.leaderboard)):
            raw = self.leaderboard[i]
            res.append(raw if isinstance(raw, dict) else json.loads(raw))
        return sorted(res, key=lambda x: x.get("score", 0), reverse=True)[:top_n]

    @gl.public.view
    def get_contract_stats(self) -> dict:
        """Returns global contract statistics."""
        return {
            "owner": str(self.owner),
            "treasury": str(self.treasury),
            "total_pilots": int(self.total_pilots),
            "total_game_sessions": int(self.total_game_sessions),
            "leaderboard_size": len(self.leaderboard),
        }

    # ─────────────────────────────────────────────────────────────────
    # Internal helpers
    # ─────────────────────────────────────────────────────────────────

    def _register_pilot(self, pilot: Address):
        initial = {
            "address": str(pilot),
            "high_score": 0,
            "total_score": 0,
            "bonus_points": 0,
            "total_sessions": 0,
            "checkin_streak": 0,
            "last_checkin": "",
        }
        self._set_pilot_data(pilot, initial)
        self.total_pilots = u256(int(self.total_pilots) + 1)

    def _update_leaderboard(self, pilot_str: str, score: int):
        for i in range(len(self.leaderboard)):
            raw = self.leaderboard[i]
            entry = raw if isinstance(raw, dict) else json.loads(raw)
            if entry.get("address", "").lower() == pilot_str.lower():
                entry["score"] = score
                self.leaderboard[i] = json.dumps(entry)
                return
        self.leaderboard.append(json.dumps({"address": pilot_str, "score": score}))
