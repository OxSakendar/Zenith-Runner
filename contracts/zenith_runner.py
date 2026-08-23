# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
🌌 Zenith Runner - GenLayer Intelligent Smart Contract
Chain: GenLayer Testnet (Bradbury / 4221)
Language: Python (GenLayer Intelligent Contract Specification)
Contract Address: 0xb4412590158f0CceEc98ebffAFf99C851Ab6703c
"""

from genlayer import *

class ZenithRunnerContract(gl.Contract):
    """
    GenLayer Intelligent Contract for Zenith Runner.
    
    Handles pilot authentication, game session authorization with micro-transaction verification (0.01 GEN),
    daily check-in streaks, bonus point distribution, and global on-chain leaderboard management.
    """

    owner: Address
    treasury: Address
    total_pilots: u256
    total_game_sessions: u256
    pilots: TreeMap[Address, dict]
    leaderboard: DynArray[dict]

    def __init__(self, owner_address: str):
        self.owner = Address(owner_address)
        self.treasury = Address(owner_address)
        self.total_pilots = u256(0)
        self.total_game_sessions = u256(0)
        self.pilots = TreeMap()
        self.leaderboard = DynArray()

    @gl.public.write.payable
    def authorize_game_session(self, pilot_address: str = "") -> dict:
        """
        Authorizes a new flight session for a pilot.
        Requires 0.01 GEN session fee verification on GenLayer Testnet.
        """
        pilot = Address(pilot_address) if pilot_address else gl.message.sender
        
        # Verify micro-transaction fee (0.01 GEN = 10^16 wei)
        if gl.message.value < 10000000000000000:
            raise ValueError("Insufficient session fee: 0.01 GEN required for game authorization")

        if pilot not in self.pilots:
            self._register_pilot(pilot)
        
        pilot_data = dict(self.pilots[pilot])
        pilot_data['total_sessions'] = pilot_data.get('total_sessions', 0) + 1
        self.pilots[pilot] = pilot_data
        self.total_game_sessions = u256(int(self.total_game_sessions) + 1)
        
        return {
            "status": "AUTHORIZED",
            "pilot": str(pilot),
            "session_id": int(self.total_game_sessions),
            "fee_verified": "0.01 GEN",
            "timestamp": "GENLAYER_BLOCK_TIMESTAMP"
        }

    @gl.public.write.payable
    def submit_high_score(self, score: int, timestamp: str, pilot_address: str = "") -> dict:
        """
        Submits and verifies a pilot's high score.
        Accumulates total player points and updates global GenLayer leaderboard placement.
        Requires 0.01 GEN verification fee.
        """
        pilot = Address(pilot_address) if pilot_address else gl.message.sender
        
        if gl.message.value < 10000000000000000:
            raise ValueError("Insufficient fee: 0.01 GEN required for score verification")

        if pilot not in self.pilots:
            self._register_pilot(pilot)
        
        pilot_data = dict(self.pilots[pilot])
        new_total = pilot_data.get('total_score', 0) + score
        pilot_data['total_score'] = new_total
        
        if score > pilot_data.get('high_score', 0):
            pilot_data['high_score'] = score

        self.pilots[pilot] = pilot_data
        self._update_leaderboard(str(pilot), new_total, timestamp)

        return {
            "status": "SUCCESS",
            "pilot": str(pilot),
            "score_added": score,
            "total_score": pilot_data['total_score'],
            "high_score": pilot_data['high_score'],
            "timestamp": timestamp
        }

    @gl.public.write.payable
    def daily_checkin(self, date_str: str, pilot_address: str = "") -> dict:
        """
        Verifies daily pilot check-in on GenLayer Testnet.
        Grants +10 Bonus Points (BP) upon successful daily verification.
        Requires 0.01 GEN check-in fee.
        """
        pilot = Address(pilot_address) if pilot_address else gl.message.sender
        
        if gl.message.value < 10000000000000000:
            raise ValueError("Insufficient fee: 0.01 GEN required for daily check-in")

        if pilot not in self.pilots:
            self._register_pilot(pilot)

        pilot_data = dict(self.pilots[pilot])
        if pilot_data.get('last_checkin') == date_str:
            return {
                "status": "ALREADY_CHECKED_IN",
                "message": "Pilot already checked in today.",
                "pilot": str(pilot)
            }

        pilot_data['last_checkin'] = date_str
        pilot_data['checkin_streak'] = pilot_data.get('checkin_streak', 0) + 1
        pilot_data['bonus_points'] = pilot_data.get('bonus_points', 0) + 10
        pilot_data['total_score'] = pilot_data.get('total_score', 0) + 10

        self.pilots[pilot] = pilot_data
        self._update_leaderboard(str(pilot), pilot_data['total_score'], date_str)

        return {
            "status": "SUCCESS",
            "pilot": str(pilot),
            "bonus_points_awarded": 10,
            "current_streak": pilot_data['checkin_streak'],
            "total_bonus": pilot_data['bonus_points'],
            "date": date_str
        }

    @gl.public.view
    def get_pilot_profile(self, pilot_address: str) -> dict:
        """
        Retrieves public pilot stats, total score, check-in streak, and high score.
        """
        pilot = Address(pilot_address)
        if pilot not in self.pilots:
            return {"registered": False, "pilot": str(pilot)}
        return {"registered": True, **self.pilots[pilot]}

    @gl.public.view
    def get_leaderboard(self, top_n: int = 50) -> list:
        """
        Returns top pilot entries sorted by accumulated total score.
        """
        res = []
        for i in range(len(self.leaderboard)):
            res.append(dict(self.leaderboard[i]))
        sorted_entries = sorted(res, key=lambda x: x.get('score', 0), reverse=True)
        return sorted_entries[:top_n]

    @gl.public.view
    def get_contract_stats(self) -> dict:
        """
        Returns global contract statistics.
        """
        return {
            "owner": str(self.owner),
            "treasury": str(self.treasury),
            "total_pilots": int(self.total_pilots),
            "total_game_sessions": int(self.total_game_sessions),
            "leaderboard_size": len(self.leaderboard)
        }

    def _register_pilot(self, pilot: Address):
        self.pilots[pilot] = {
            "address": str(pilot),
            "high_score": 0,
            "total_score": 0,
            "bonus_points": 0,
            "total_sessions": 0,
            "checkin_streak": 0,
            "last_checkin": ""
        }
        self.total_pilots = u256(int(self.total_pilots) + 1)

    def _update_leaderboard(self, pilot_str: str, score: int, timestamp: str):
        found = False
        for i in range(len(self.leaderboard)):
            if self.leaderboard[i].get('address', '').lower() == pilot_str.lower():
                entry = dict(self.leaderboard[i])
                entry['score'] = score
                entry['updated_at'] = timestamp
                self.leaderboard[i] = entry
                found = True
                break
        if not found:
            self.leaderboard.append({
                "address": pilot_str,
                "score": score,
                "updated_at": timestamp
            })

