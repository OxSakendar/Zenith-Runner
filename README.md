# 🌌 Zenith Runner — GenLayer Odyssey

[![Chain: GenLayer Studio](https://img.shields.io/badge/Chain-GenLayer%20Studio-8A2BE2?style=for-the-badge&logo=ethereum)](https://explorer-studio.genlayer.com/)
[![React: 19.x](https://img.shields.io/badge/React-19.x-blue?style=for-the-badge&logo=react)](https://react.dev/)
[![Vite: 8.x](https://img.shields.io/badge/Vite-8.x-ffd845?style=for-the-badge&logo=vite)](https://vite.dev/)
[![TypeScript: 6.x](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Tests: 50 Passing](https://img.shields.io/badge/Tests-50%20Passing-success?style=for-the-badge)](https://vitest.dev/)

**Zenith Runner** is a decentralized space/cyber runner game built with React 19, TypeScript, Vite, and HTML5 Canvas. The game features full Web3 integration on **GenLayer Studio**, utilizing GenLayer Intelligent Smart Contracts with non-deterministic LLM consensus anti-cheat verification, single-use session nonces for replay protection, and authoritative external time validation for daily check-ins — all running with **0.00 GEN** zero-fee sessions.

---

## 🔗 Project Links & Network Configuration

- **GitHub Repository**: [https://github.com/OxSakendar/Zenith-Runner](https://github.com/OxSakendar/Zenith-Runner)
- **GenLayer Smart Contract Source**: [`contracts/zenith_runner.py`](./contracts/zenith_runner.py)
- **Active Contract Address**: [`0x6F76F389BF3Cb94EF3F9A2EBefDa5EE5A83372DE`](https://explorer-studio.genlayer.com/address/0x6F76F389BF3Cb94EF3F9A2EBefDa5EE5A83372DE)
- **Network Name**: `GenLayer Studio`
- **Chain ID**: `61999` (`0xf22f`)
- **RPC URL**: `https://studio.genlayer.com/api`
- **Block Explorer**: [https://explorer-studio.genlayer.com/](https://explorer-studio.genlayer.com/)
- **Native Currency**: `GEN`
- **Session Fee**: `0.00 GEN` (Zero Fee Arena)

---

## 🧠 Smart Contract Architecture (`contracts/zenith_runner.py`)

The smart contract is written in Python following the official GenLayer Intelligent Contract specification (`py-genlayer`).

### 1. Replay Protection & Session Authorization (`authorize_game_session`)
- **Zero Fee Session**: Requires `>= 0.00 GEN` session fee for accessible, seamless onboarding.
- **Identity Enforcement**: Caller identity is derived exclusively from `gl.message.sender` (never trusted from client parameters).
- **Session Nonce**: Generates a single-use session nonce formatted as `<pilot_address>:<session_id>`.
- **State Storage**: Tracks cumulative game sessions and registers pilots in `self.pilots: TreeMap[Address, dict]`.

### 2. Anti-Cheat Consensus & Score Validation (`submit_high_score`)
Browser-supplied scores and timestamps are never trusted. The contract enforces structured evidence validation across multiple layers:

#### Evidence Format
```python
submit_high_score(
    session_nonce: str,          # Single-use nonce from authorize_game_session
    score: int,                  # Run score claimed by pilot
    crystals_collected: int,     # Number of crystals collected
    duration_seconds: int        # Duration of game session in seconds
)
```

#### Deterministic Invariant Checks (Fast Pre-Consensus Reject)
- `score` bounded in `[0, 5000]`.
- `crystals_collected` bounded in `[0, 500]`.
- `duration_seconds` bounded in `[3, 3600]`.
- **Hard Physics Ceiling**: `score <= crystals_collected * 20` (each crystal can award at most 20 points).
- **Spawn Timing Limit**: `duration_seconds >= crystals_collected * 2` (minimum delay between crystal spawns).
- **Zero-Crystal Invariant**: If `crystals_collected == 0`, `score` must be `0`.
- **Replay Protection**: Verifies `session_nonce` has not been consumed; marks `self.used_nonces[session_nonce] = True`.

#### Non-Deterministic LLM Consensus Primitive
```python
def validate_score_evidence():
    prompt = (
        "You are an anti-cheat validator for Zenith Runner, a 2D space runner game.\n"
        f"Score: {score}, Crystals: {crystals_collected}, Duration: {duration_seconds}s\n"
        "Evaluate whether this run is PHYSICALLY PLAUSIBLE (VALID) or CHEATING (INVALID).\n"
        "Respond with JSON: {\"verdict\":\"VALID\"|\"INVALID\",\"reason\":\"...\"}"
    )
    return gl.exec_prompt(prompt)

raw_consensus = gl.eq_principle.prompt_comparative(
    validate_score_evidence,
    principle="Validators must agree on the 'verdict' field value ('VALID' or 'INVALID')."
)
```
- **Deterministic State Writes**: Persistent player scores, high scores, and leaderboard rankings are updated **only** on the deterministic path after a `"VALID"` consensus decision is confirmed.
- Any consensus indeterminate state, `"INVALID"` verdict, or parsing failure triggers a hard transaction revert, ensuring points can never be awarded on failed runs.

### 3. Authoritative Daily Check-in (`daily_checkin`)
- **Fee Requirement**: Requires `>= 0.00 GEN`.
- **Authoritative Time Source**: Fetches UTC time from an external authoritative source (`worldtimeapi.org/api/timezone/UTC`) inside a non-deterministic block evaluated via `gl.eq_principle.strict_eq`.
- **Untrusted Client Protection**: Client date hint is compared against the authoritative UTC date. Any discrepancy (or client clock manipulation) immediately causes rejection.
- **Streak & Duplicate Enforcement**: Prevents multiple check-ins on the same calendar day based on authoritative state `last_checkin == authoritative_date`.

---

## ⚡ Frontend & Transaction Lifecycle (`src/services/genlayerService.ts`)

### Lifecycle States
1. `wallet_pending`: Prompting MetaMask / Web3 wallet signature.
2. `chain_pending`: Transaction broadcasted to GenLayer RPC.
3. `finalizing`: Awaiting GenLayer validator consensus (`TransactionStatus.FINALIZED`).
4. `finalized_success`: Execution result is `FINISHED_WITH_RETURN` and verified by reading authoritative contract state.
5. `finalized_error`: Execution result is `FINISHED_WITH_ERROR` or consensus rejected; displays contract revert reason.
6. `unknown`: Timeout or RPC disruption. Displays transaction hash and block explorer link; prevents duplicate submission.

### Elimination of Silent Fallbacks
- All silent fallbacks have been removed. If a wallet rejection, consensus failure, or RPC timeout occurs, the UI explicitly reports the error or unknown state without writing false local data.
- **Demo Mode Separation**: Local test simulation is explicitly tagged as `DEMO` in the UI and leaderboard. Real on-chain data is tagged as `✓ VERIFIED`.
- **Dual-ABI Compatibility**: Automatically resolves and parses both standard ZenithRunnerContract ABIs and live GenLayer Studio contract endpoints (`get_player_score`, `get_player_territories`, `get_leaderboard`, `execute_ai_turn`).

---

## 🧪 Test Suite & Verification Results

All tests run cleanly and offline using deterministic mocking.

### 1. Smart Contract Tests (`contracts/test_zenith_runner.py`)
```bash
python -m unittest contracts/test_zenith_runner.py
```
**19 Passing Tests**:
- `test_authorize_session_fails_with_insufficient_fee`
- `test_authorize_session_success_and_nonce_issuance`
- `test_replay_attack_rejected`
- `test_nonce_belonging_to_another_pilot_rejected`
- `test_submit_high_score_fails_with_insufficient_fee`
- `test_negative_score_rejected`
- `test_score_exceeding_max_ceiling_rejected`
- `test_score_without_crystals_rejected`
- `test_score_exceeding_crystal_multiplier_rejected`
- `test_duration_shorter_than_spawn_delay_rejected`
- `test_anti_cheat_consensus_valid_updates_state`
- `test_anti_cheat_consensus_invalid_rejects_and_preserves_state`
- `test_anti_cheat_consensus_indeterminate_or_malformed_rejects`
- `test_daily_checkin_fails_with_insufficient_fee`
- `test_daily_checkin_success_with_matching_authoritative_date`
- `test_daily_checkin_rejects_untrusted_client_date`
- `test_daily_checkin_rejects_duplicate_checkin_same_day`
- `test_view_leaderboard_sorting`
- `test_view_contract_stats`

### 2. Frontend & Transaction Service Tests (`src/__tests__/genlayerService.test.ts`)
```bash
npx vitest run
```
**31 Passing Tests**:
- Progress & lifecycle state mapping (wallet_pending, finalizing, finalized_success, finalized_error, unknown).
- `executeContractAuthorizeSession`: lifecycle sequence, nonce parsing, wallet denial rejection, finality error, timeout handling.
- `executeContractSubmitHighScore`: authoritative profile read on success, consensus rejection handling, indeterminate consensus (`NOT_VOTED`), replayed nonce rejection, physics ceiling violation rejection, insufficient fee rejection, timeout handling.
- `executeContractDailyCheckIn`: authoritative date verification, duplicate check-in rejection, client date mismatch rejection, insufficient fee rejection, check-in timeout handling.
- `getPilotProfileOnChain`: successful profile deserialization, graceful RPC error handling.
- `getLeaderboardOnChain`: chain source annotation, network failure resilience.
- `checkContractExists`: bytecode presence check, missing contract detection, 404/network resilience.
- `executeContractDeploy`: in-app deployment lifecycle, dynamic address persistence, rejection & failure handling.

### Total Tests: 50 Passing (100% Pass Rate)

---

## 🚀 Local Development & Build Commands

### Prerequisites
- Node.js v18+ & npm
- Python 3.10+

### Run All Tests
```bash
npm test
```
*(Executes both 31 Vitest tests and 19 Python contract tests).*

### Run Code Quality Check (ESLint)
```bash
npm run lint
```
*(Zero errors, zero warnings).*

### Build Production Bundle
```bash
npm run build
```
*(TypeScript type-checking + Vite production bundling).*

### Run Development Server
```bash
npm run dev
```
*(Accessible at `http://localhost:5173/`).*

---

## 📦 Deployment Instructions (GenLayer Studio)

### Active Live Contract
The contract is live and deployed on **GenLayer Studio**:
- **Address**: `0x6F76F389BF3Cb94EF3F9A2EBefDa5EE5A83372DE`
- **Explorer**: [https://explorer-studio.genlayer.com/address/0x6F76F389BF3Cb94EF3F9A2EBefDa5EE5A83372DE](https://explorer-studio.genlayer.com/address/0x6F76F389BF3Cb94EF3F9A2EBefDa5EE5A83372DE)

### Option A: In-App 1-Click Deployment (If Deploying a Fresh Contract)
1. Launch the web app (`npm run dev`) and connect your MetaMask wallet configured for **GenLayer Studio** (Chain ID `61999`, RPC `https://studio.genlayer.com/api`).
2. If deploying to a new address, click **"🚀 Deploy Zenith Contract"** in the deployment banner.
3. Confirm the transaction in MetaMask. The app will submit the contract code, wait for validator consensus, and automatically persist the newly deployed contract address in your session.

### Option B: Node CLI Deployment Script
```bash
node scripts/deploy.js <YOUR_PRIVATE_KEY>
# Or:
GENLAYER_PRIVATE_KEY=<YOUR_PRIVATE_KEY> node scripts/deploy.js
```
The script compiles `contracts/zenith_runner.py`, deploys it to GenLayer Studio via `genlayer-js`, waits for finality, and prints the contract address and explorer URL.
