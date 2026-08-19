# 🌌 Zenith Runner

[![Chain: GenLayer Testnet](https://img.shields.io/badge/Chain-GenLayer%20Testnet-8A2BE2?style=for-the-badge&logo=ethereum)](https://explorer.testnet-chain.genlayer.com/)
[![React: 19.x](https://img.shields.io/badge/React-19.x-blue?style=for-the-badge&logo=react)](https://react.dev/)
[![Vite: 8.x](https://img.shields.io/badge/Vite-8.x-ffd845?style=for-the-badge&logo=vite)](https://vite.dev/)
[![TypeScript: 6.x](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)

**Zenith Runner** is a premium, high-octane decentralized space/cyber runner game built with React 19, TypeScript, Vite, and HTML5 Canvas. The game features full Web3 integration on the **GenLayer Testnet**, allowing players to verify their pilots, authorize gameplay sessions, check-in daily, and post high scores onto an on-chain leaderboard using native testnet `GEN` tokens.

---

## 🔗 Project Submission Evidence & Links

- **GitHub Repository**: [https://github.com/OxSakendar/Zenith-Runner](https://github.com/OxSakendar/Zenith-Runner)
- **GenLayer Smart Contract Source**: [`contracts/zenith_runner.py`](./contracts/zenith_runner.py)
- **GenLayer Contract Address**: `0xBcBD1169E34799ac9143FD0C350ED06Edb701882`
- **GenLayer Block Explorer**: [https://explorer.testnet-chain.genlayer.com/](https://explorer.testnet-chain.genlayer.com/)

---

## 🚀 Play & Experience

To play Zenith Runner, make sure your Web3 wallet is connected and configured for the GenLayer Testnet.

### 🚰 Faucet and Blockchain Tools

- **Testnet RPC URL**: `https://rpc.testnet-chain.genlayer.com/`
- **Chain ID**: `4221` (Hex: `0x107d`)
- **Currency Symbol**: `GEN`
- **Testnet Explorer**: [GenLayer Block Explorer](https://explorer.testnet-chain.genlayer.com/)
- **Testnet Faucet**: [GenLayer Testnet Faucet](https://testnet-faucet.genlayer.foundation/)

---

## 🐍 GenLayer Intelligent Smart Contract Source

The core Web3 logic of Zenith Runner is powered by a GenLayer Intelligent Smart Contract written in Python. The complete source code is available in the repository at [`contracts/zenith_runner.py`](./contracts/zenith_runner.py).

### Key Contract Methods:
1. `authorize_game_session(pilot_address: str)`: Authorizes flight sessions on-chain upon receipt of the **0.01 GEN** session authorization fee.
2. `submit_high_score(pilot_address: str, score: int, timestamp: str)`: Validates and accumulates pilot high scores on the global GenLayer leaderboard.
3. `daily_checkin(pilot_address: str, date_str: str)`: Enforces 24-hour daily check-in verification, tracks check-in streaks, and rewards **+10 Bonus Points (BP)**.
4. `get_pilot_profile(pilot_address: str)`: Queries pilot statistics including total score, sessions played, streak count, and high score.
5. `get_leaderboard(top_n: int)`: Fetches top global pilot rankings sorted by total verified points.

---

## 🎮 Gameplay & Mechanics

Pilot a sleek red cyber-fighter through a hazardous starfield filled with energy crystals and dangerous space debris.

### 🕹️ Controls

- **Desktop/Keyboard**: Use `Arrow Left` / `Arrow Right` or `A` / `D` keys to fly.
- **Mobile/Touch Devices**: Hold down the on-screen left and right arrow buttons to navigate.

### 🪐 In-Game Entities

- **Cyan Energy Crystals (💎)**: Collect these to gain +10 or +20 points towards your Base Score.
- **Dark Matter Asteroids (☄️)**: Colliding with these damages your shield core by **25%**.
- **Red Corrupted Crystals (🔴)**: Avoid at all costs. Touching a red crystal leads to an **instant Game Over**.

---

## ⛓️ GenLayer Web3 Mechanics

Zenith Runner leverages micro-transactions of exactly **0.01 GEN** to validate critical pilot activities, prevent spam, and secure the leaderboard:

| Action | Fee (GEN) | Reward / Outcome |
| :--- | :--- | :--- |
| **Authorize Game** | `0.01 GEN` | Starts the physics loop and authorizes a single flight session. |
| **Submit High Score** | `0.01 GEN` | Permanently records and accumulates your score on the public leaderboard. |
| **Daily Check-In** | `0.01 GEN` | Verifies your active streak and claims **+10 Bonus Points (BP)**. |

> [!NOTE]
> If your wallet has low `GEN` balance, the client includes an automated testnet fallback simulation to ensure developers and testers can experience the gameplay loop smoothly.

---

## 💎 Features

- **Decentralized Verification & Signing**: Prompts users to sign a cryptographic verification message upon connection to verify pilot identity securely.
- **Multi-Wallet Support**: Custom connection modal optimized for MetaMask, Bitget Wallet, Phantom, Backpack, Base, Rainbow, and WalletConnect.
- **Real-Time Leaderboard**: Built-in mock testnet active pilot activity simulation (up to 310 concurrent pilots) to test dynamic ranking calculations in real-time.
- **Client-Side Syncing**: Real-time cross-tab updates using HTML5 Local Storage syncing for high scores, daily streaks, and cached leaderboard snapshots.
- **Privacy & Storage Modals**: Built-in interactive modals detailing transparent Terms of Service, non-custodial Privacy Policies, and Cookie Policies.

---

## 🛠️ Architecture & Tech Stack

- **Frontend Library**: React 19.x & TypeScript
- **Build Tool**: Vite 8.x
- **Styling**: Premium custom CSS (using CSS custom properties, glassmorphism filters, neon glow shadows, and sleek transitions)
- **Graphics rendering**: HTML5 2D Canvas Context API
- **Web3 Integration**: Ethers.js v6 (for JSON-RPC interactions, transaction execution, and cryptographic signatures)
- **Smart Contract**: GenLayer Intelligent Contract (`contracts/zenith_runner.py`)
- **Icons**: Lucide React

---

## ⚙️ Local Development Setup

To run Zenith Runner locally on your machine, follow these steps:

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (v18+ recommended) and `npm` installed.

### 1. Clone & Navigate

```bash
git clone https://github.com/OxSakendar/Zenith-Runner.git
cd Zenith-Runner
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Development Server

```bash
cmd /c "npm run dev"
```

The application will be accessible at `http://localhost:5173/`.

### 4. Build for Production

To create a production-ready build:

```bash
npm run build
```

This generates a static build in the `dist` directory.

### 5. Code Quality (Linting)

Ensure code styling and guidelines are met:

```bash
npm run lint
```

---

## 📁 Repository Structure

```
ZENITH RUNNER/
├── contracts/
│   └── zenith_runner.py   # GenLayer Intelligent Smart Contract (Python)
├── public/                # Static assets
├── src/
│   ├── assets/            # Project graphics & icons
│   ├── App.css            # Component-specific styles
│   ├── App.tsx            # Main game, routing, state, and Web3 logic
│   ├── index.css          # Core design tokens, gradients, and global styling
│   └── main.tsx           # React mounting entrypoint
├── index.html             # Application shell
├── package.json           # Scripts, dependencies, and manifest
├── README.md              # Project documentation & evidence links
├── tsconfig.json          # TypeScript compiler configuration
└── vite.config.ts         # Vite bundler configuration
```

---

## 🛠️ Recent Updates (Changelog)

- **GenLayer Intelligent Contract Source Added**: Integrated `contracts/zenith_runner.py` defining full pilot verification, session authorization, daily check-in streaks, and leaderboard data structures.
- **Repository Evidence & Proof Updated**: Updated README documentation with working repository URL, GenLayer contract address, and testnet explorer tools.
- **Wallet Connection Toast Resolution**: Resolved an issue where the error toast did not refresh correctly when a user rejected the wallet connection request.
- **Enhanced Native Wallet Selection Modal**: Upgraded the wallet connection modal to a clean, native-feeling, glassmorphic selector UI.

---

## 📜 Legal & Policies

Zenith Runner is a non-custodial Web3 application. We do not store, harvest, or request personal user data. All transactions and scores are transparently recorded on the public and immutable GenLayer Testnet. For full details on the Terms of Service, Privacy Policy, or Cookie Policies, click the policy buttons in the application footer.

---
*Developed for the GenLayer Testnet Odyssey.*

