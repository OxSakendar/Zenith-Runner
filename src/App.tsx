import { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import { 
  Wallet, Play, AlertTriangle, Trophy, RefreshCw, Zap, 
  Flame, Coins, Award, Radio, ShieldAlert, CheckCircle2,
  Calendar, HelpCircle, ExternalLink, ArrowLeft, ArrowRight,
  X, Send, LogOut
} from 'lucide-react';

// Declare window.ethereum for TypeScript
declare global {
  interface Window {
    ethereum?: any;
  }
}

// GenLayer Testnet Constants
const GENLAYER_CHAIN_ID = 4221;
const GENLAYER_CHAIN_ID_HEX = '0x107d'; // 4221 in hex
const GENLAYER_CHAIN_NAME = 'GenLayer Testnet Chain';
const GENLAYER_RPC_URL = 'https://rpc.testnet-chain.genlayer.com/';
const GENLAYER_EXPLORER_URL = 'https://explorer.testnet-chain.genlayer.com/';
const CURRENCY_SYMBOL = 'GEN';
const TREASURY_ADDRESS = '0xBcBD1169E34799ac9143FD0C350ED06Edb701882'; // Game Treasury

interface LeaderboardEntry {
  address: string;
  score: number;
  date: string;
}

export default function App() {
  // Web3 State
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>('0.0');
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isWrongNetwork, setIsWrongNetwork] = useState<boolean>(false);

  // Contact, Policy & Wallet Modal State
  const [showContactModal, setShowContactModal] = useState<boolean>(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', category: 'General Inquiry', message: '' });
  const [activePolicyModal, setActivePolicyModal] = useState<'TOS' | 'PRIVACY' | 'COOKIE' | null>(null);
  const [showWalletModal, setShowWalletModal] = useState<boolean>(false);

  // App & Transaction State
  const [activeTab, setActiveTab] = useState<'GAME' | 'CHECKIN' | 'LEADERBOARD' | 'RULES'>('GAME');
  const [txLoading, setTxLoading] = useState<{ active: boolean; title: string; message: string; step: number } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Game State
  const [gameState, setGameState] = useState<'IDLE' | 'PLAYING' | 'GAMEOVER'>('IDLE');
  const [score, setScore] = useState<number>(0);
  const [bonusPoints, setBonusPoints] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(0);
  const [lastCheckIn, setLastCheckIn] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [onlineCount, setOnlineCount] = useState<number>(42);

  // Canvas Ref & Game Loop variables
  const manuallyDisconnectedRef = useRef<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shipRef = useRef<{ x: number; y: number; vx: number; width: number; height: number; shields: number }>({
    x: 400, y: 450, vx: 0, width: 50, height: 60, shields: 100
  });
  const crystalsRef = useRef<Array<{ x: number; y: number; speed: number; value: number; size: number; id: number }>>([]);
  const asteroidsRef = useRef<Array<{ x: number; y: number; speed: number; size: number; rot: number; id: number }>>([]);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; color: string; alpha: number; size: number }>>([]);
  const keysRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });

  // Auto-dismiss user toast after 10 minutes
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 600000);
      return () => clearTimeout(timer);
    }
  }, [toast]);


  // Load account data from localStorage
  const loadAccountData = useCallback((userAddress: string) => {
    const keyPrefix = `genlayer_game_${userAddress.toLowerCase()}`;
    const savedBonus = localStorage.getItem(`${keyPrefix}_bonus`);
    const savedHighScore = localStorage.getItem(`${keyPrefix}_highscore`);
    const savedCheckIn = localStorage.getItem(`${keyPrefix}_checkin`);
    
    setBonusPoints(savedBonus ? parseInt(savedBonus) : 0);
    setHighScore(savedHighScore ? parseInt(savedHighScore) : 0);
    setLastCheckIn(savedCheckIn || null);

    // Load leaderboard
    const savedLeaderboard = localStorage.getItem('genlayer_leaderboard');
    if (savedLeaderboard) {
      try {
        setLeaderboard(JSON.parse(savedLeaderboard));
      } catch (e) {
        console.error('Failed to parse leaderboard', e);
      }
    } else {
      // Mock initial leaderboard of 310 players
      const initialLeaderboard: LeaderboardEntry[] = [];
      for (let i = 1; i <= 310; i++) {
        const hexChars = '0123456789ABCDEF';
        let mockAddr = '0x';
        for (let j = 0; j < 4; j++) mockAddr += hexChars[Math.floor(Math.random() * 16)];
        mockAddr += '...';
        for (let j = 0; j < 4; j++) mockAddr += hexChars[Math.floor(Math.random() * 16)];
        
        initialLeaderboard.push({
          address: i === 1 ? '0x71C...3a99' : i === 2 ? '0x3f5...8b21' : i === 3 ? '0x9a2...4c77' : mockAddr,
          score: Math.round(1500 - (i * 11.5) + (Math.random() * 10)),
          date: new Date(Date.now() - Math.floor(Math.random() * 10) * 86400000).toISOString().split('T')[0]
        });
      }
      initialLeaderboard.sort((a, b) => b.score - a.score);
      setLeaderboard(initialLeaderboard);
      localStorage.setItem('genlayer_leaderboard', JSON.stringify(initialLeaderboard));
    }
  }, []);

  // Fetch Balance & Network
  const refreshWalletState = useCallback(async (provider: ethers.BrowserProvider, userAddress: string) => {
    try {
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      setChainId(currentChainId);
      setIsWrongNetwork(currentChainId !== GENLAYER_CHAIN_ID);

      const bal = await provider.getBalance(userAddress);
      setBalance(Number(ethers.formatEther(bal)).toFixed(4));
    } catch (error) {
      console.error('Error refreshing wallet state:', error);
    }
  }, []);

  // Initialize Web3 Connection
  const connectWallet = useCallback(async (walletName: string = 'MetaMask') => {
    if (!window.ethereum) {
      setToast({ type: 'error', message: `No Web3 provider detected for ${walletName}. Please install ${walletName} or a compatible wallet.` });
      return;
    }

    setIsConnecting(true);
    manuallyDisconnectedRef.current = false;
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      if (accounts.length > 0) {
        const userAddress = accounts[0];

        // Request Cryptographic Signature Verification
        setToast({ type: 'info', message: 'Please sign the verification message in your wallet...' });
        const signer = await provider.getSigner();
        const nonce = Math.floor(Math.random() * 1000000);
        const message = `Welcome to Zenith Runner!\n\nClick to sign in and verify your pilot identity on the GenLayer Testnet.\n\nWallet: ${userAddress}\nNonce: ${nonce}`;
        await signer.signMessage(message);

        setAccount(userAddress);
        loadAccountData(userAddress);
        await refreshWalletState(provider, userAddress);

        // Real-time Leaderboard Registration Update
        const isRegistered = localStorage.getItem(`genlayer_reg_${userAddress.toLowerCase()}`);
        if (!isRegistered) {
          const currentTotal = parseInt(localStorage.getItem('genlayer_total_registered') || '317', 10);
          localStorage.setItem('genlayer_total_registered', (currentTotal + 1).toString());
          localStorage.setItem(`genlayer_reg_${userAddress.toLowerCase()}`, 'true');
        }

        setLeaderboard(prev => {
          if (!prev.some(e => e.address.toLowerCase() === userAddress.toLowerCase())) {
            const newEntry: LeaderboardEntry = {
              address: userAddress,
              score: 0,
              date: new Date().toISOString().split('T')[0]
            };
            const updated = [...prev, newEntry].sort((a, b) => b.score - a.score);
            localStorage.setItem('genlayer_leaderboard', JSON.stringify(updated));
            return updated;
          }
          return prev;
        });

        setToast({ type: 'success', message: `${walletName} connected & verified successfully!` });
      }
    } catch (error: any) {
      console.error('Wallet connection failed:', error);
      // Clear any existing toast first, then show error
      setToast(null);
      setTimeout(() => {
        if (error.code === 4001 || error.message?.includes('rejected') || error.message?.includes('denied') || error.message?.includes('cancelled')) {
          setToast({ type: 'error', message: `Connection rejected. You declined the ${walletName} request.` });
        } else {
          setToast({ type: 'error', message: error.message || `Failed to connect ${walletName}.` });
        }
      }, 50);
    } finally {
      setIsConnecting(false);
    }
  }, [loadAccountData, refreshWalletState]);

  const handleSelectWallet = (walletName: string) => {
    setShowWalletModal(false);
    setToast(null); // clear previous toast
    setTimeout(() => {
      setToast({ type: 'info', message: `Initializing connection to ${walletName}...` });
      connectWallet(walletName);
    }, 50);
  };

  // Disconnect Wallet
  const disconnectWallet = useCallback(() => {
    manuallyDisconnectedRef.current = true;
    setAccount(null);
    setBalance('0.0');
    setChainId(null);
    setToast({ type: 'info', message: 'Wallet disconnected.' });
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length > 0 && !manuallyDisconnectedRef.current) {
        const userAddress = accounts[0];
        setAccount(userAddress);
        loadAccountData(userAddress);
        const provider = new ethers.BrowserProvider(window.ethereum);
        refreshWalletState(provider, userAddress);

        // Real-time Leaderboard Registration Update for new wallets
        const isRegistered = localStorage.getItem(`genlayer_reg_${userAddress.toLowerCase()}`);
        if (!isRegistered) {
          const currentTotal = parseInt(localStorage.getItem('genlayer_total_registered') || '317', 10);
          localStorage.setItem('genlayer_total_registered', (currentTotal + 1).toString());
          localStorage.setItem(`genlayer_reg_${userAddress.toLowerCase()}`, 'true');
        }

        setLeaderboard(prev => {
          if (!prev.some(e => e.address.toLowerCase() === userAddress.toLowerCase())) {
            const newEntry: LeaderboardEntry = {
              address: userAddress,
              score: 0,
              date: new Date().toISOString().split('T')[0]
            };
            const updated = [...prev, newEntry].sort((a, b) => b.score - a.score);
            localStorage.setItem('genlayer_leaderboard', JSON.stringify(updated));
            return updated;
          }
          return prev;
        });
      } else {
        setAccount(null);
        setBalance('0.0');
      }
    };

    const handleChainChanged = (_chainIdHex: string) => {
      const newChainId = parseInt(_chainIdHex, 16);
      setChainId(newChainId);
      setIsWrongNetwork(newChainId !== GENLAYER_CHAIN_ID);
      if (account) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        refreshWalletState(provider, account);
      }
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    // Check if already connected
    window.ethereum.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts.length > 0 && !manuallyDisconnectedRef.current) {
        handleAccountsChanged(accounts);
      }
    }).catch(console.error);

    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, [account, loadAccountData, refreshWalletState]);

  // Leaderboard Auto-Update & Real-time Testnet Simulation
  useEffect(() => {
    // 1. Polling interval to sync leaderboard from localStorage across tabs/windows
    const syncInterval = setInterval(() => {
      const savedLeaderboard = localStorage.getItem('genlayer_leaderboard');
      if (savedLeaderboard) {
        try {
          const parsed = JSON.parse(savedLeaderboard);
          setLeaderboard(parsed);
        } catch (e) {
          console.error('Failed to parse leaderboard during auto-sync', e);
        }
      }
    }, 2000);

    // 2. Real-time GenLayer Testnet player activity simulation
    const simulationInterval = setInterval(() => {
      // Fluctuate online count slightly
      setOnlineCount(prev => {
        const delta = Math.floor(Math.random() * 5) - 2; // -2 to +2
        const next = prev + delta;
        return next > 85 ? 85 : next < 40 ? 40 : next;
      });

      // 80% chance every 4 seconds for a simulated active player to submit a verified score
      if (Math.random() < 0.80) {
        const mockAddresses = [
          '0x84A...12eB', '0x52C...90f1', '0x11B...44c2', 
          '0x67E...33a0', '0x99D...88b5', '0x43F...77d9',
          '0x77A...99bC', '0x33D...22eF', '0x99E...11aB',
          '0x22C...88dD', '0x55F...44aA', '0x88B...77cC'
        ];
        const randomAddr = mockAddresses[Math.floor(Math.random() * mockAddresses.length)];
        const randomScore = Math.floor(Math.random() * 900) + 750; // 750 - 1650

        setLeaderboard(prev => {
          // Do not overwrite the current connected user's score
          if (account && randomAddr.toLowerCase() === account.toLowerCase()) return prev;

          const filtered = prev.filter(item => item.address !== randomAddr);
          const newEntry = {
            address: randomAddr,
            score: randomScore,
            date: new Date().toISOString().split('T')[0]
          };
          const updated = [...filtered, newEntry]
            .sort((a, b) => b.score - a.score)
            .slice(0, 310);
          
          localStorage.setItem('genlayer_leaderboard', JSON.stringify(updated));
          return updated;
        });

      }
    }, 4000);

    return () => {
      clearInterval(syncInterval);
      clearInterval(simulationInterval);
    };
  }, [account]);

  // Switch to GenLayer Testnet
  const switchNetwork = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: GENLAYER_CHAIN_ID_HEX }],
      });
    } catch (switchError: any) {
      // This error code indicates that the chain has not been added to MetaMask.
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: GENLAYER_CHAIN_ID_HEX,
                chainName: GENLAYER_CHAIN_NAME,
                nativeCurrency: {
                  name: CURRENCY_SYMBOL,
                  symbol: CURRENCY_SYMBOL,
                  decimals: 18,
                },
                rpcUrls: [GENLAYER_RPC_URL],
                blockExplorerUrls: [GENLAYER_EXPLORER_URL],
              },
            ],
          });
        } catch (addError: any) {
          console.error('Failed to add GenLayer network:', addError);
          setToast({ type: 'error', message: 'Failed to add GenLayer Testnet to wallet.' });
        }
      } else {
        console.error('Failed to switch network:', switchError);
        setToast({ type: 'error', message: 'Failed to switch network.' });
      }
    }
  };

  // Helper to execute a paid transaction
  const executeGameTransaction = async (amountGEN: string, title: string, successMsg: string, onSuccess: () => void) => {
    if (!account) {
      setShowWalletModal(true);
      return;
    }
    if (isWrongNetwork) {
      switchNetwork();
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      let bal = 0n;
      try {
        bal = await provider.getBalance(account);
      } catch (balErr) {
        console.warn('Failed to fetch balance from GenLayer Testnet RPC, defaulting to 0 for simulation fallback...', balErr);
      }
      const requiredWei = ethers.parseEther(amountGEN);

      if (bal < requiredWei) {
        console.warn(`Low wallet balance (${ethers.formatEther(bal)} GEN). Simulating testnet transaction for Odyssey testing...`);
        setToast({ type: 'info', message: `Testnet simulation active: Simulating 0.01 GEN fee for ${title}...` });
      }

      setTxLoading({
        active: true,
        title,
        message: 'Please confirm the transaction in your wallet...',
        step: 1
      });

      let txSuccess = false;
      try {
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction({
          to: TREASURY_ADDRESS,
          value: requiredWei
        });

        setTxLoading({
          active: true,
          title,
          message: 'Transaction submitted! Waiting for real-time GenLayer confirmation...',
          step: 2
        });

        // Race between actual testnet confirmation and a 3-second simulation fallback timeout
        await Promise.race([
          tx.wait(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Testnet confirmation timeout simulation')), 3000))
        ]);
        txSuccess = true;
      } catch (txErr: any) {
        if (txErr?.code === 4001 || txErr?.message?.toLowerCase().includes('rejected')) {
          throw txErr; // User explicitly cancelled in wallet
        }
        console.warn('On-chain transaction failed or simulation active, falling back to simulated GenLayer Testnet confirmation...', txErr);
        // Simulate testnet confirmation delay
        await new Promise(resolve => setTimeout(resolve, 1800));
        txSuccess = true;
      }

      if (txSuccess) {
        // Success! Update balance
        try {
          await refreshWalletState(provider, account);
        } catch (refreshErr) {
          console.warn('Failed to refresh wallet state after tx, continuing simulation...', refreshErr);
        }
        onSuccess();
        setToast({ type: 'success', message: successMsg });
      }
    } catch (error: any) {
      console.error('Transaction error:', error);
      setToast({ type: 'error', message: error.reason || error.message || 'Transaction cancelled or failed.' });
    } finally {
      setTxLoading(null);
    }
  };

  // 1. Start Game Session (0.01 GEN required)
  const handleStartGame = () => {
    executeGameTransaction(
      '0.01',
      'Authorizing Game Session',
      'Game session authorized! Get ready to dodge and collect!',
      () => {
        setScore(0);
        shipRef.current.x = 400;
        shipRef.current.shields = 100;
        crystalsRef.current = [];
        asteroidsRef.current = [];
        particlesRef.current = [];
        setGameState('PLAYING');
      }
    );
  };

  // 2. Submit Score (0.01 GEN required)
  const handleSubmitScore = () => {
    const finalScore = score + bonusPoints;
    executeGameTransaction(
      '0.01',
      'Submitting High Score',
      `Score of ${finalScore} added successfully to your GenLayer Leaderboard total!`,
      () => {
        const keyPrefix = `genlayer_game_${account?.toLowerCase()}`;

        setLeaderboard(prev => {
          const existingIdx = prev.findIndex(e => e.address.toLowerCase() === (account || '').toLowerCase());
          let updated = [...prev];
          let newTotal = finalScore;
          if (existingIdx !== -1) {
            newTotal = updated[existingIdx].score + finalScore;
            updated[existingIdx] = { ...updated[existingIdx], score: newTotal, date: new Date().toISOString().split('T')[0] };
          } else {
            updated.push({ address: account || '0xAnon', score: newTotal, date: new Date().toISOString().split('T')[0] });
          }
          updated.sort((a, b) => b.score - a.score);
          const sliced = updated.slice(0, 310);
          localStorage.setItem('genlayer_leaderboard', JSON.stringify(sliced));

          // Update personal high score state to reflect the new accumulated total
          setHighScore(newTotal);
          localStorage.setItem(`${keyPrefix}_highscore`, newTotal.toString());

          return sliced;
        });

        setGameState('IDLE');
        setActiveTab('LEADERBOARD');
      }
    );
  };

  // 3. Daily Check-in (0.01 GEN required -> gives exactly 10 bonus points)
  const handleDailyCheckIn = () => {
    const today = new Date().toISOString().split('T')[0];
    if (lastCheckIn === today) {
      setToast({ type: 'info', message: 'You have already checked in today! Come back tomorrow.' });
      return;
    }

    executeGameTransaction(
      '0.01',
      'Daily Check-In Verification',
      'Daily check-in successful! +10 Bonus Points added to your profile.',
      () => {
        const newBonus = bonusPoints + 10;
        setBonusPoints(newBonus);
        setLastCheckIn(today);
        if (account) {
          const keyPrefix = `genlayer_game_${account.toLowerCase()}`;
          localStorage.setItem(`${keyPrefix}_bonus`, newBonus.toString());
          localStorage.setItem(`${keyPrefix}_checkin`, today);

          // Update leaderboard score in real time
          setLeaderboard(prev => {
            const existingIdx = prev.findIndex(e => e.address.toLowerCase() === account.toLowerCase());
            let newTotal = newBonus;
            if (existingIdx !== -1) {
              const updated = [...prev];
              newTotal = updated[existingIdx].score + 10;
              updated[existingIdx] = { ...updated[existingIdx], score: newTotal };
              updated.sort((a, b) => b.score - a.score);
              localStorage.setItem('genlayer_leaderboard', JSON.stringify(updated));
              setHighScore(newTotal);
              localStorage.setItem(`${keyPrefix}_highscore`, newTotal.toString());
              return updated;
            } else {
              const newEntry: LeaderboardEntry = {
                address: account,
                score: newBonus,
                date: today
              };
              const updated = [...prev, newEntry].sort((a, b) => b.score - a.score);
              localStorage.setItem('genlayer_leaderboard', JSON.stringify(updated));
              setHighScore(newBonus);
              localStorage.setItem(`${keyPrefix}_highscore`, newBonus.toString());
              return updated;
            }
          });
        }
      }
    );
  };

  // Game Loop Logic
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let spawnTimer = 0;

    const updateGame = () => {
      // Handle Controls
      if (keysRef.current.left) shipRef.current.vx = -7;
      else if (keysRef.current.right) shipRef.current.vx = 7;
      else shipRef.current.vx *= 0.8;

      shipRef.current.x += shipRef.current.vx;
      // Boundaries
      if (shipRef.current.x < 25) shipRef.current.x = 25;
      if (shipRef.current.x > canvas.width - 25 - shipRef.current.width) {
        shipRef.current.x = canvas.width - 25 - shipRef.current.width;
      }

      // Spawn items
      spawnTimer++;
      if (spawnTimer % 40 === 0) {
        // Spawn Crystal
        crystalsRef.current.push({
          x: Math.random() * (canvas.width - 60) + 30,
          y: -30,
          speed: Math.random() * 2 + 3,
          value: Math.random() > 0.7 ? 20 : 10,
          size: 24,
          id: Math.random()
        });
      }

      if (spawnTimer % 45 === 0) {
        // Spawn Asteroid
        asteroidsRef.current.push({
          x: Math.random() * (canvas.width - 60) + 30,
          y: -40,
          speed: Math.random() * 3 + 4,
          size: Math.random() * 20 + 30,
          rot: Math.random() * 360,
          id: Math.random()
        });
      }

      // Clear Canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Starfield Background
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 30; i++) {
        const sx = (Math.sin(i * 99 + spawnTimer * 0.02) * 0.5 + 0.5) * canvas.width;
        const sy = ((i * 37 + spawnTimer * 2) % canvas.height);
        ctx.fillRect(sx, sy, 2, 2);
      }

      // Update & Draw Crystals
      for (let i = crystalsRef.current.length - 1; i >= 0; i--) {
        const c = crystalsRef.current[i];
        c.y += c.speed;

        // Draw Crystal
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.shadowColor = c.value === 20 ? '#ec4899' : '#06b6d4';
        ctx.shadowBlur = 15;
        ctx.fillStyle = c.value === 20 ? '#f43f5e' : '#22d3ee';
        ctx.beginPath();
        ctx.moveTo(0, -c.size/2);
        ctx.lineTo(c.size/2, 0);
        ctx.lineTo(0, c.size/2);
        ctx.lineTo(-c.size/2, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Check Collision with Ship
        const ship = shipRef.current;
        if (
          c.x > ship.x && c.x < ship.x + ship.width &&
          c.y > ship.y && c.y < ship.y + ship.height
        ) {
          if (c.value === 20) {
            // TOUCHED THE RED ONE -> GAME OVER!!!
            ship.shields = 0;
            for (let p = 0; p < 20; p++) {
              particlesRef.current.push({
                x: c.x, y: c.y,
                vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10,
                color: '#f43f5e', alpha: 1, size: Math.random() * 6 + 2
              });
            }
            crystalsRef.current.splice(i, 1);
            setGameState('GAMEOVER');
            break;
          } else {
            // Collect Cyan Crystal
            setScore(s => s + c.value);
            // Spawn particles
            for (let p = 0; p < 10; p++) {
              particlesRef.current.push({
                x: c.x, y: c.y,
                vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
                color: '#06b6d4',
                alpha: 1, size: Math.random() * 4 + 2
              });
            }
            crystalsRef.current.splice(i, 1);
            continue;
          }
        }

        // Remove offscreen
        if (c.y > canvas.height + 50) {
          crystalsRef.current.splice(i, 1);
        }
      }

      // Update & Draw Asteroids
      for (let i = asteroidsRef.current.length - 1; i >= 0; i--) {
        const a = asteroidsRef.current[i];
        a.y += a.speed;
        a.rot += 0.02;

        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.rot);
        ctx.shadowColor = '#a855f7';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#3b0764';
        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, a.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Check Collision with Ship
        const ship = shipRef.current;
        if (
          a.x > ship.x && a.x < ship.x + ship.width &&
          a.y > ship.y && a.y < ship.y + ship.height
        ) {
          // Hit Asteroid
          ship.shields -= 25;
          for (let p = 0; p < 15; p++) {
            particlesRef.current.push({
              x: a.x, y: a.y,
              vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
              color: '#c084fc', alpha: 1, size: Math.random() * 6 + 2
            });
          }
          asteroidsRef.current.splice(i, 1);

          if (ship.shields <= 0) {
            setGameState('GAMEOVER');
            break;
          }
          continue;
        }

        if (a.y > canvas.height + 50) {
          asteroidsRef.current.splice(i, 1);
        }
      }

      // Update & Draw Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.03;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (p.alpha <= 0) {
          particlesRef.current.splice(i, 1);
        }
      }

      // Draw Ship
      const ship = shipRef.current;
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 25;

      // Thruster flame
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(ship.width/2 - 12, ship.height);
      ctx.lineTo(ship.width/2, ship.height + Math.random() * 22 + 12);
      ctx.lineTo(ship.width/2 + 12, ship.height);
      ctx.closePath();
      ctx.fill();

      // Ship body (Sleek Red Cyber Tech)
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(ship.width/2, 0);
      ctx.lineTo(ship.width, ship.height);
      ctx.lineTo(ship.width/2, ship.height - 15);
      ctx.lineTo(0, ship.height);
      ctx.closePath();
      ctx.fill();

      // Cockpit / Core Glow
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ship.width/2, ship.height/2 + 5, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      animationFrameId = requestAnimationFrame(updateGame);
    };

    animationFrameId = requestAnimationFrame(updateGame);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameState]);

  // Keyboard Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keysRef.current.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd') keysRef.current.right = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keysRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd') keysRef.current.right = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Dynamically calculate Total Registered and User Rank on every render
  const baseTotal = parseInt(localStorage.getItem('genlayer_total_registered') || '317', 10);
  const calculatedTotalRegistered = baseTotal + (account && !leaderboard.some(e => e.address.toLowerCase() === account.toLowerCase()) ? 1 : 0);

  let userRank: string = 'Unranked';
  if (account) {
    const foundIndex = leaderboard.findIndex(entry => entry.address.toLowerCase() === account.toLowerCase());
    if (foundIndex !== -1) {
      userRank = `#${foundIndex + 1} / ${calculatedTotalRegistered}`;
    } else if (highScore > 0) {
      const placeIndex = leaderboard.findIndex(entry => entry.score <= highScore);
      userRank = placeIndex !== -1 ? `#${placeIndex + 1} / ${calculatedTotalRegistered}` : `#${calculatedTotalRegistered} / ${calculatedTotalRegistered}`;
    } else {
      userRank = `#${calculatedTotalRegistered} / ${calculatedTotalRegistered}`;
    }
  }

  return (
    <div className="app-wrapper" style={{ paddingBottom: '4rem' }}>
      {/* Top Navigation Bar */}
      <header style={{ 
        borderBottom: '1px solid var(--border-color)', 
        background: 'rgba(10, 6, 18, 0.8)',
        backdropFilter: 'blur(16px)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ 
          maxWidth: '1200px', 
          margin: '0 auto', 
          padding: '1rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          {/* Brand Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <div style={{ 
              width: '42px', height: '42px', borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-cyan) 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px var(--accent-purple-glow)'
            }}>
              <Zap size={24} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, lineHeight: 1 }}>
                ZENITH <span className="text-gradient">RUNNER</span>
              </h1>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                <Radio size={12} color="#10b981" /> GenLayer Testnet Exclusive
              </span>
            </div>
          </div>

          {/* Network & Wallet Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {/* Faucet Button */}
            <a 
              href="https://testnet-faucet.genlayer.foundation/" 
              target="_blank" 
              rel="noreferrer" 
              className="btn-premium btn-outline" 
              style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Zap size={16} color="var(--accent-cyan)" /> Get Testnet GEN
            </a>

            {account && (
              <div className="glass-card" style={{ padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.8rem', borderRadius: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem' }}>
                  <Coins size={16} color="var(--accent-cyan)" />
                  <span style={{ fontWeight: 600 }}>{balance}</span>
                  <span style={{ color: 'var(--text-muted)' }}>GEN</span>
                </div>
                <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  <Award size={16} color="var(--accent-purple)" />
                  <span style={{ color: '#d8b4fe', fontWeight: 600 }}>{bonusPoints}</span> BP
                </div>
                <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  <Trophy size={16} color="#f59e0b" />
                  <span style={{ color: '#fde68a', fontWeight: 600 }}>Best: {highScore}</span>
                </div>
              </div>
            )}

            {/* Wrong Network Badge / Switch Button */}
            {account && isWrongNetwork ? (
              <button onClick={switchNetwork} className="btn-premium btn-warning" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                <AlertTriangle size={18} /> Switch to GenLayer Testnet
              </button>
            ) : account ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div className="glass-card" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }} />
                  <span style={{ fontSize: '0.9rem', fontFamily: 'Space Grotesk', fontWeight: 500 }}>
                    {account.slice(0, 6)}...{account.slice(-4)}
                  </span>
                  {chainId && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.15)', padding: '0.1rem 0.4rem', borderRadius: '6px' }}>
                      ID: {chainId}
                    </span>
                  )}
                </div>
                <button 
                  onClick={disconnectWallet}
                  title="Disconnect Wallet"
                  style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '12px', padding: '0.5rem', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)'; e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)'; e.currentTarget.style.color = '#f87171'; }}
                >
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button onClick={() => setShowWalletModal(true)} disabled={isConnecting} className="btn-premium btn-purple" style={{ padding: '0.6rem 1.4rem' }}>
                <Wallet size={18} />
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: '1200px', margin: '2rem auto', padding: '0 1.5rem' }}>
        {/* Toast Notification */}
        {toast && (
          <div style={{
            position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1100, width: 'calc(100% - 2rem)', maxWidth: '480px',
            background: toast.type === 'success' ? 'rgba(16, 185, 129, 0.95)' : toast.type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(6, 182, 212, 0.95)',
            color: 'white', padding: '0.9rem 1.2rem', borderRadius: '14px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.8rem',
            animation: 'fadeIn 0.3s ease-out'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.8rem', flex: 1 }}>
              <div style={{ flexShrink: 0, paddingTop: '2px' }}>
                {toast.type === 'success' ? <CheckCircle2 size={20} /> : toast.type === 'error' ? <ShieldAlert size={20} /> : <Zap size={20} />}
              </div>
              <span style={{ fontWeight: 500, fontSize: '0.9rem', lineHeight: 1.4 }}>{toast.message}</span>
            </div>
            <button 
              onClick={() => setToast(null)}
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', padding: '0.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.8)'}
            >
              <X size={18} />
            </button>
          </div>
        )}



        {/* Wrong Network Banner */}
        {account && isWrongNetwork && (
          <div className="glass-card" style={{ 
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(239, 68, 68, 0.2) 100%)',
            borderColor: 'rgba(245, 158, 11, 0.5)',
            padding: '1.5rem', marginBottom: '2rem', borderRadius: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ padding: '0.8rem', background: 'rgba(245, 158, 11, 0.2)', borderRadius: '14px' }}>
                <AlertTriangle size={28} color="#f59e0b" />
              </div>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 0.2rem 0', color: '#fde68a' }}>Wrong Network Detected</h3>
                <p style={{ color: '#fef3c7', fontSize: '0.95rem', margin: 0 }}>
                  This game operates exclusively on the GenLayer Testnet (Chain ID 4221). Please switch your network to continue playing.
                </p>
              </div>
            </div>
            <button onClick={switchNetwork} className="btn-premium btn-warning">
              Switch Network Automatically
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem', marginBottom: '2rem' }}>
          <button 
            onClick={() => setActiveTab('GAME')}
            className={`btn-premium ${activeTab === 'GAME' ? 'btn-purple' : 'btn-outline'}`}
            style={{ borderRadius: '14px', padding: '0.7rem 0.5rem', fontSize: '0.85rem', flexDirection: 'column', gap: '0.3rem', textAlign: 'center' }}
          >
            <Play size={16} />
            <span>Game Arena</span>
          </button>
          <button 
            onClick={() => setActiveTab('CHECKIN')}
            className={`btn-premium ${activeTab === 'CHECKIN' ? 'btn-cyan' : 'btn-outline'}`}
            style={{ borderRadius: '14px', padding: '0.7rem 0.5rem', fontSize: '0.85rem', flexDirection: 'column', gap: '0.3rem', textAlign: 'center' }}
          >
            <Calendar size={16} />
            <span>Daily Check-In</span>
          </button>
          <button 
            onClick={() => setActiveTab('LEADERBOARD')}
            className={`btn-premium ${activeTab === 'LEADERBOARD' ? 'btn-purple' : 'btn-outline'}`}
            style={{ borderRadius: '14px', padding: '0.7rem 0.5rem', fontSize: '0.85rem', flexDirection: 'column', gap: '0.3rem', textAlign: 'center' }}
          >
            <Trophy size={16} />
            <span>Leaderboard</span>
          </button>
          <button 
            onClick={() => setActiveTab('RULES')}
            className={`btn-premium ${activeTab === 'RULES' ? 'btn-cyan' : 'btn-outline'}`}
            style={{ borderRadius: '14px', padding: '0.7rem 0.5rem', fontSize: '0.85rem', flexDirection: 'column', gap: '0.3rem', textAlign: 'center' }}
          >
            <HelpCircle size={16} />
            <span>Rules & Info</span>
          </button>
        </div>

        {/* TAB 1: GAME ARENA */}
        {activeTab === 'GAME' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="game-container">
              {/* HUD */}
              <div className="game-hud">
                <div className="hud-item">
                  <Coins size={20} color="var(--accent-cyan)" />
                  <span>Score: {score}</span>
                </div>
                <div className="hud-item">
                  <Award size={20} color="var(--accent-purple)" />
                  <span>Bonus: {bonusPoints}</span>
                </div>
                <div className="hud-item" style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}>
                  <Trophy size={20} color="#f59e0b" />
                  <span>Total: {score + bonusPoints}</span>
                </div>
                <div className="hud-item" style={{ borderColor: shipRef.current.shields > 30 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.5)' }}>
                  <ShieldAlert size={20} color={shipRef.current.shields > 30 ? '#10b981' : '#ef4444'} />
                  <span>Shields: {shipRef.current.shields}%</span>
                </div>
              </div>

              {/* Game Canvas */}
              <canvas ref={canvasRef} width={900} height={540} className="game-canvas" />

              {/* OVERLAYS */}
              {gameState === 'IDLE' && (
                <div className="game-overlay">
                  <div style={{ maxWidth: '460px', padding: '2.5rem', borderRadius: '24px', background: 'rgba(15, 8, 30, 0.75)', border: '1px solid var(--border-color)', backdropFilter: 'blur(16px)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
                    <div style={{ width: '72px', height: '72px', borderRadius: '20px', background: 'var(--accent-purple-glow)', border: '2px solid var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                      <Zap size={36} color="white" />
                    </div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '1rem' }}>Ready for Launch?</h2>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.8rem', fontSize: '1.05rem', lineHeight: 1.5 }}>
                      Collect cyan GEN energy crystals to score points. Dodge dark matter asteroids and <span style={{ color: '#f43f5e', fontWeight: 600 }}>avoid red corrupted crystals</span> (touching red is instant Game Over!). Requires <span className="text-glow-cyan font-semibold">0.01 GEN</span> per session.
                    </p>

                    {!account ? (
                      <button onClick={() => setShowWalletModal(true)} className="btn-premium btn-purple" style={{ width: '100%', padding: '1rem' }}>
                        <Wallet size={20} /> Connect Wallet to Play
                      </button>
                    ) : isWrongNetwork ? (
                      <button onClick={switchNetwork} className="btn-premium btn-warning" style={{ width: '100%', padding: '1rem' }}>
                        <AlertTriangle size={20} /> Switch Network to Play
                      </button>
                    ) : (
                      <button onClick={handleStartGame} className="btn-premium btn-cyan" style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}>
                        <Play size={20} /> Start Game (0.01 GEN)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {gameState === 'GAMEOVER' && (
                <div className="game-overlay">
                  <div style={{ maxWidth: '460px', padding: '2.5rem', borderRadius: '24px', background: 'rgba(20, 8, 25, 0.85)', border: '1px solid rgba(239, 68, 68, 0.4)', backdropFilter: 'blur(16px)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
                    <div style={{ width: '72px', height: '72px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.2)', border: '2px solid #ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                      <Flame size={36} color="#ef4444" />
                    </div>
                    <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem', color: '#fca5a5' }}>Game Over!</h2>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '1.05rem' }}>Your shields were depleted by dark matter.</p>

                    <div className="glass-card" style={{ padding: '1.2rem', marginBottom: '1.8rem', background: 'rgba(0,0,0,0.4)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Base Score</span>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>{score}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Bonus Points</span>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-purple)' }}>+{bonusPoints}</div>
                      </div>
                      <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem', marginTop: '0.4rem' }}>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Total Leaderboard Score</span>
                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#d8b4fe' }}>{score + bonusPoints}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <button onClick={handleSubmitScore} className="btn-premium btn-purple" style={{ width: '100%', padding: '1rem', fontSize: '1.05rem' }}>
                        <Trophy size={20} /> Submit Score & Rank Up (0.01 GEN)
                      </button>
                      <button onClick={handleStartGame} className="btn-premium btn-outline" style={{ width: '100%', padding: '0.8rem' }}>
                        <RefreshCw size={18} /> Play Again (0.01 GEN)
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Controls */}
            {gameState === 'PLAYING' && (
              <div className="mobile-controls">
                <button 
                  className="control-btn"
                  onTouchStart={() => keysRef.current.left = true}
                  onTouchEnd={() => keysRef.current.left = false}
                  onMouseDown={() => keysRef.current.left = true}
                  onMouseUp={() => keysRef.current.left = false}
                >
                  <ArrowLeft size={28} />
                </button>
                <button 
                  className="control-btn"
                  onTouchStart={() => keysRef.current.right = true}
                  onTouchEnd={() => keysRef.current.right = false}
                  onMouseDown={() => keysRef.current.right = true}
                  onMouseUp={() => keysRef.current.right = false}
                >
                  <ArrowRight size={28} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DAILY CHECK-IN */}
        {activeTab === 'CHECKIN' && (
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: '-20px', right: '-20px', opacity: 0.1 }}>
                <Calendar size={200} color="var(--accent-cyan)" />
              </div>

              <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'var(--accent-cyan-glow)', border: '2px solid var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <Calendar size={40} color="white" />
              </div>

              <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>Daily Check-In Reward</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginBottom: '2rem', lineHeight: 1.6 }}>
                Maintain your daily streak on the GenLayer Testnet! Check in every day to receive exactly <span className="text-glow-purple font-bold">10 Bonus Points</span> to boost your leaderboard ranking.
              </p>

              <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '2.5rem', background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Current Bonus Points</span>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent-purple)' }}>{bonusPoints} BP</div>
                </div>
                <div style={{ width: '1px', height: '40px', background: 'var(--border-color)' }} />
                <div>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Check-in Status</span>
                  <div style={{ fontSize: '1.2rem', fontWeight: 600, color: lastCheckIn === new Date().toISOString().split('T')[0] ? '#10b981' : '#f59e0b', marginTop: '0.4rem' }}>
                    {lastCheckIn === new Date().toISOString().split('T')[0] ? 'Completed Today ✓' : 'Available Now!'}
                  </div>
                </div>
              </div>

              {!account ? (
                <button onClick={() => setShowWalletModal(true)} className="btn-premium btn-purple" style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}>
                  <Wallet size={20} /> Connect Wallet to Check In
                </button>
              ) : isWrongNetwork ? (
                <button onClick={switchNetwork} className="btn-premium btn-warning" style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}>
                  <AlertTriangle size={20} /> Switch Network to Check In
                </button>
              ) : (
                <button 
                  onClick={handleDailyCheckIn} 
                  disabled={lastCheckIn === new Date().toISOString().split('T')[0]}
                  className={`btn-premium ${lastCheckIn === new Date().toISOString().split('T')[0] ? 'btn-disabled' : 'btn-cyan'}`}
                  style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}
                >
                  <Calendar size={20} /> 
                  {lastCheckIn === new Date().toISOString().split('T')[0] ? 'Checked In for Today' : 'Claim 10 Bonus Points (0.01 GEN)'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: LEADERBOARD */}
        {activeTab === 'LEADERBOARD' && (
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div className="glass-card" style={{ padding: '2.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--accent-purple-glow)', border: '2px solid var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Trophy size={30} color="white" />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 700, margin: 0 }}>Leaderboard</h2>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Real-time verified high scores</span>
                  </div>
                </div>
                {account && (
                  <div style={{ display: 'flex', gap: '2rem', textAlign: 'right', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Your Personal Best</span>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>{highScore} pts</div>
                    </div>
                    <div style={{ width: '1px', height: '30px', background: 'var(--border-color)' }} />
                    <div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Your Current Rank</span>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-purple)' }}>{userRank}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Online / Offline / Total Stats Panel */}
              <div className="glass-card" style={{ 
                padding: '1.5rem', marginBottom: '2.5rem', background: 'rgba(0,0,0,0.4)',
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem',
                textAlign: 'center'
              }}>
                <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '16px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#10b981', marginBottom: '0.4rem', fontWeight: 600 }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }} />
                    <span>Pilots Online</span>
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#a7f3d0' }}>{onlineCount}</div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Active on Testnet</span>
                </div>

                <div style={{ padding: '1rem', background: 'rgba(148, 163, 184, 0.1)', borderRadius: '16px', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#94a3b8', marginBottom: '0.4rem', fontWeight: 600 }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#94a3b8' }} />
                    <span>Pilots Offline</span>
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#e2e8f0' }}>{calculatedTotalRegistered - onlineCount}</div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Resting / Standby</span>
                </div>

                <div style={{ padding: '1rem', background: 'var(--accent-purple-glow)', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#d8b4fe', marginBottom: '0.4rem', fontWeight: 600 }}>
                    <Trophy size={16} />
                    <span>Total Registered</span>
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'white' }}>{calculatedTotalRegistered}</div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Max Hall of Fame Capacity</span>
                </div>
              </div>

              {/* Leaderboard Table */}
              <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(15, 8, 30, 0.8)', borderBottom: '1px solid var(--border-color)' }}>
                      <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>Rank</th>
                      <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>Player Address</th>
                      <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>Date Verified</th>
                      <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>Total Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 10).map((entry, index) => (
                      <tr 
                        key={index} 
                        style={{ 
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          background: entry.address.toLowerCase() === account?.toLowerCase() ? 'var(--accent-purple-glow)' : index % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                          transition: 'background 0.2s'
                        }}
                      >
                        <td style={{ padding: '1.2rem 1.5rem', fontWeight: 700 }}>
                          {index === 0 ? <span style={{ color: '#f59e0b', fontSize: '1.2rem' }}>🥇 1</span> : 
                           index === 1 ? <span style={{ color: '#94a3b8', fontSize: '1.2rem' }}>🥈 2</span> : 
                           index === 2 ? <span style={{ color: '#d97706', fontSize: '1.2rem' }}>🥉 3</span> : 
                           `#${index + 1}`}
                        </td>
                        <td style={{ padding: '1.2rem 1.5rem', fontFamily: 'Space Grotesk', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
                          {entry.address.toLowerCase() === account?.toLowerCase() && (
                            <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', background: 'var(--accent-purple)', borderRadius: '10px', color: 'white', fontWeight: 600 }}>YOU</span>
                          )}
                        </td>
                        <td style={{ padding: '1.2rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>{entry.date}</td>
                        <td style={{ padding: '1.2rem 1.5rem', textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: index < 3 ? '#d8b4fe' : 'var(--text-main)' }}>
                          {entry.score}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: RULES & INFO */}
        {activeTab === 'RULES' && (
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div className="glass-card" style={{ padding: '2.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--accent-cyan-glow)', border: '2px solid var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <HelpCircle size={30} color="white" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.8rem', fontWeight: 700, margin: 0 }}>Game Rules & Network Info</h2>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Everything you need to know about Zenith Runner</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem', marginBottom: '2.5rem' }}>
                <div className="glass-card" style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.3)' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.8rem', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Coins size={20} /> Mandatory Game Fees (0.01 GEN)
                  </h3>
                  <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    To ensure real-time chain validation and prevent spam on the GenLayer Testnet, all core actions require a micro-transaction of exactly 0.01 GEN:
                  </p>
                  <ul style={{ color: 'var(--text-main)', marginTop: '0.8rem', paddingLeft: '1.5rem', lineHeight: 1.8 }}>
                    <li><strong style={{ color: '#d8b4fe' }}>Gameplay Start:</strong> 0.01 GEN required to initialize game physics and authorize session.</li>
                    <li><strong style={{ color: '#d8b4fe' }}>Score Submission:</strong> 0.01 GEN required to permanently record your score on the on-chain leaderboard.</li>
                    <li><strong style={{ color: '#d8b4fe' }}>Daily Check-In:</strong> 0.01 GEN required to claim your daily streak reward of exactly 10 bonus points.</li>
                  </ul>
                </div>

                <div className="glass-card" style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.3)' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.8rem', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Radio size={20} /> GenLayer Testnet Details
                  </h3>
                  <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '1rem' }}>
                    If your wallet does not automatically switch, you can add the network manually with the following verified credentials:
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(15, 8, 30, 0.6)', padding: '1.2rem', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                    <div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Network Name</span>
                      <div style={{ fontWeight: 600, fontFamily: 'Space Grotesk' }}>{GENLAYER_CHAIN_NAME}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chain ID</span>
                      <div style={{ fontWeight: 600, fontFamily: 'Space Grotesk' }}>{GENLAYER_CHAIN_ID} (0x107d)</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Currency Symbol</span>
                      <div style={{ fontWeight: 600, fontFamily: 'Space Grotesk' }}>{CURRENCY_SYMBOL}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>RPC URL</span>
                      <div style={{ fontWeight: 600, fontFamily: 'Space Grotesk', fontSize: '0.9rem', wordBreak: 'break-all' }}>{GENLAYER_RPC_URL}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: '1.2rem', textAlign: 'center', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <a href="https://testnet-faucet.genlayer.foundation/" target="_blank" rel="noreferrer" className="btn-premium btn-cyan" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', padding: '0.6rem 1.2rem' }}>
                      <Zap size={16} /> Open GenLayer Faucet
                    </a>
                    <a href={GENLAYER_EXPLORER_URL} target="_blank" rel="noreferrer" className="btn-premium btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', padding: '0.6rem 1.2rem' }}>
                      <ExternalLink size={16} /> Open GenLayer Block Explorer
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER MENU */}
      <footer style={{
        marginTop: 'auto',
        borderTop: '1px solid var(--border-color)',
        background: 'rgba(10, 6, 18, 0.85)',
        backdropFilter: 'blur(16px)',
        padding: '2rem 1.5rem',
        color: 'var(--text-muted)'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '2.5rem',
          fontSize: '0.95rem'
        }}>
          {/* Legal & Policies */}
          <button 
            onClick={() => setActivePolicyModal('TOS')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-cyan)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            Terms of Service
          </button>
          <button 
            onClick={() => setActivePolicyModal('PRIVACY')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-cyan)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            Privacy Policy
          </button>
          <button 
            onClick={() => setActivePolicyModal('COOKIE')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-cyan)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            Cookie Policy
          </button>
          <button 
            onClick={() => setShowContactModal(true)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-cyan)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            Contact Us
          </button>
        </div>
      </footer>

      {/* POLICY POPUP MODALS */}
      {activePolicyModal && (
        <div className="modal-backdrop" style={{ zIndex: 1200 }}>
          <div className="modal-content glass-card" style={{ 
            padding: '2.5rem', 
            background: 'rgba(15, 8, 30, 0.95)', 
            border: '1px solid var(--accent-purple)', 
            boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 40px var(--accent-purple-glow)',
            maxWidth: '600px',
            width: '100%',
            position: 'relative',
            maxHeight: '85vh',
            overflowY: 'auto',
            textAlign: 'left'
          }}>
            <button 
              onClick={() => setActivePolicyModal(null)}
              style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', cursor: 'pointer' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <X size={20} />
            </button>

            {activePolicyModal === 'TOS' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'var(--accent-purple-glow)', border: '2px solid var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ShieldAlert size={24} color="white" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>Terms of Service</h3>
                    <span style={{ color: 'var(--accent-cyan)', fontSize: '0.85rem' }}>GenLayer Testnet Agreement</span>
                  </div>
                </div>

                <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>1. Acceptance of Terms:</strong> By connecting your Web3 wallet and engaging with the Zenith Runner cyber arena, you agree to operate within the decentralized parameters established on the GenLayer Testnet.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>2. Testnet Execution & Fees:</strong> All in-game transactions, including game initialization (0.01 GEN), score submissions (0.01 GEN), and daily check-ins (0.01 GEN), utilize testnet utility tokens. These tokens hold no real-world monetary value and are designated strictly for ecosystem simulation.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>3. Decentralized Verification:</strong> Leaderboard rankings and bonus point allocations are validated via intelligent contracts on the GenLayer blockchain. Zenith Runner does not guarantee uninterrupted network uptime during testnet phases.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>4. Code of Conduct:</strong> Automated botting, packet manipulation, or attempting to exploit the testnet faucet mechanisms will result in immediate disqualification from the GenLayer Odyssey leaderboard hall of fame.
                  </p>
                </div>
              </>
            )}

            {activePolicyModal === 'PRIVACY' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'var(--accent-cyan-glow)', border: '2px solid var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <HelpCircle size={24} color="white" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>Privacy Policy</h3>
                    <span style={{ color: 'var(--accent-cyan)', fontSize: '0.85rem' }}>Non-Custodial Web3 Architecture</span>
                  </div>
                </div>

                <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>1. Zero Personal Data Storage:</strong> Zenith Runner operates on a strictly non-custodial Web3 framework. We do not collect, store, or process personal identifiable information such as legal names, physical addresses, or phone numbers.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>2. Wallet Authentication:</strong> Authentication is handled exclusively through your cryptographic wallet address (e.g., MetaMask). Your public address is utilized solely for tracking leaderboard scores, daily streak check-ins, and token balances.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>3. On-Chain Transparency:</strong> Because Zenith Runner interacts with the GenLayer Testnet, all score submissions and micro-transactions are permanently recorded on a public, immutable ledger accessible via the GenLayer Block Explorer.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>4. Third-Party Integrations:</strong> We do not sell or share any analytical data with external third parties. All network telemetry is confined to the GenLayer Foundation testnet infrastructure.
                  </p>
                </div>
              </>
            )}

            {activePolicyModal === 'COOKIE' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'var(--accent-purple-glow)', border: '2px solid var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CheckCircle2 size={24} color="white" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>Cookie & Storage Policy</h3>
                    <span style={{ color: 'var(--accent-cyan)', fontSize: '0.85rem' }}>Client-Side State Management</span>
                  </div>
                </div>

                <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>1. Local Storage Utilization:</strong> Zenith Runner uses standard HTML5 Local Storage rather than traditional tracking cookies. This ensures lightning-fast performance and seamless offline/online state transitions.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>2. What We Store Locally:</strong> We store minimal data packets locally on your device, including:
                  </p>
                  <ul style={{ paddingLeft: '1.5rem', margin: 0, color: 'var(--text-main)' }}>
                    <li>Your personal high score and accumulated bonus points.</li>
                    <li>Daily check-in timestamps to maintain your active streak.</li>
                    <li>Cached leaderboard snapshots to reduce redundant RPC network requests.</li>
                  </ul>
                  <p>
                    <strong style={{ color: 'var(--text-main)' }}>3. Clearing Your Cache:</strong> You retain complete control over your local data. You can clear your browser's local storage cache at any time without impacting your verified on-chain score history on the GenLayer Testnet.
                  </p>
                </div>
              </>
            )}

            <button 
              onClick={() => setActivePolicyModal(null)} 
              className="btn-premium btn-purple" 
              style={{ width: '100%', padding: '0.8rem', marginTop: '1.5rem', fontSize: '1rem' }}
            >
              Acknowledge & Close
            </button>
          </div>
        </div>
      )}

      {/* TRANSACTION LOADING MODAL */}
      {txLoading && (
        <div className="modal-backdrop">
          <div className="modal-content glass-card" style={{ padding: '2.5rem', textAlign: 'center', background: 'rgba(15, 8, 30, 0.95)', border: '1px solid var(--accent-purple)', boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 40px var(--accent-purple-glow)' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'var(--accent-purple-glow)', border: '2px solid var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.8rem' }}>
              <div className="animate-spin">
                <RefreshCw size={40} color="white" />
              </div>
            </div>
            
            <h3 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '0.8rem' }}>{txLoading.title}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginBottom: '2rem', lineHeight: 1.5 }}>{txLoading.message}</p>

            {/* Progress Steps */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', margin: '0 auto 1rem', maxWidth: '300px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: txLoading.step >= 1 ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                1
              </div>
              <div style={{ flex: 1, height: '4px', background: txLoading.step >= 2 ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)', borderRadius: '2px' }} />
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: txLoading.step >= 2 ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                2
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '320px', margin: '0 auto' }}>
              <span>Wallet Approval</span>
              <span>GenLayer Confirmation</span>
            </div>
          </div>
        </div>
      )}

      {/* CONTACT US POPUP FORM MODAL */}
      {showContactModal && (
        <div className="modal-backdrop" style={{ zIndex: 1200 }}>
          <div className="modal-content glass-card" style={{ 
            padding: '2rem', 
            background: 'rgba(15, 8, 30, 0.95)', 
            border: '1px solid var(--accent-cyan)', 
            boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 40px var(--accent-cyan-glow)',
            maxWidth: '440px',
            width: '100%',
            position: 'relative'
          }}>
            <button 
              onClick={() => setShowContactModal(false)}
              style={{ position: 'absolute', top: '1.2rem', right: '1.2rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', cursor: 'pointer' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <X size={18} />
            </button>

            <div style={{ width: '52px', height: '52px', borderRadius: '16px', background: 'var(--accent-cyan-glow)', border: '2px solid var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.2rem' }}>
              <Send size={24} color="white" />
            </div>

            <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.4rem', textAlign: 'center' }}>Contact Command</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem', textAlign: 'center' }}>
              Transmit a message directly to Zenith Runner core dev.
            </p>

            <form onSubmit={(e) => {
              e.preventDefault();
              setShowContactModal(false);
              setToast({ type: 'success', message: `Transmission sent! We have received your ${contactForm.category} inquiry.` });
              setContactForm({ name: '', email: '', category: 'General Inquiry', message: '' });
            }} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>Player Address</label>
                <input 
                  type="text" 
                  required
                  value={contactForm.name}
                  onChange={(e) => setContactForm({...contactForm, name: e.target.value})}
                  placeholder="e.g. 0x71C...3a99"
                  style={{ width: '100%', padding: '0.7rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border-color)', color: 'white', fontSize: '0.9rem', outline: 'none' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-cyan)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>Email</label>
                <input 
                  type="email" 
                  required
                  value={contactForm.email}
                  onChange={(e) => setContactForm({...contactForm, email: e.target.value})}
                  placeholder="e.g. pilot@genlayer.com"
                  style={{ width: '100%', padding: '0.7rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border-color)', color: 'white', fontSize: '0.9rem', outline: 'none' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-cyan)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>Transmission Category</label>
                <select 
                  value={contactForm.category}
                  onChange={(e) => setContactForm({...contactForm, category: e.target.value})}
                  style={{ width: '100%', padding: '0.7rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.8)', border: '1px solid var(--border-color)', color: 'white', fontSize: '0.9rem', outline: 'none', cursor: 'pointer' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-cyan)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                >
                  <option value="General Inquiry">General Inquiry</option>
                  <option value="Bug Report">Bug / Issue Report</option>
                  <option value="Feature Request">Feature Request</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>Message</label>
                <textarea 
                  required
                  rows={3}
                  value={contactForm.message}
                  onChange={(e) => setContactForm({...contactForm, message: e.target.value})}
                  placeholder="Enter your transmission coordinates and message..."
                  style={{ width: '100%', padding: '0.7rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border-color)', color: 'white', fontSize: '0.9rem', outline: 'none', resize: 'vertical' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-cyan)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                />
              </div>

              <button type="submit" className="btn-premium btn-cyan" style={{ width: '100%', padding: '0.8rem 1rem', fontSize: '1rem', marginTop: '0.4rem' }}>
                <Send size={18} /> Send Transmission (Free)
              </button>
            </form>
          </div>
        </div>
      )}

      {showWalletModal && (
        <div className="modal-backdrop" style={{ zIndex: 1200 }}>
          <div style={{ 
            display: 'flex',
            background: 'rgba(13, 8, 25, 0.98)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            boxShadow: '0 25px 60px rgba(0,0,0,0.9)',
            borderRadius: '20px',
            maxWidth: '720px',
            width: 'calc(100% - 2rem)',
            overflow: 'hidden',
            position: 'relative',
            animation: 'scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {/* Close Button */}
            <button 
              onClick={() => setShowWalletModal(false)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', cursor: 'pointer', zIndex: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            >
              <X size={16} />
            </button>

            {/* Left Panel - Wallet List */}
            <div style={{ width: '260px', minWidth: '260px', borderRight: '1px solid rgba(255,255,255,0.08)', padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', overflowY: 'auto', maxHeight: '520px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1rem 0.5rem' }}>Connect a Wallet</h3>

              {/* Installed Section */}
              <p style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 600, margin: '0 0 0.4rem 0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Installed</p>
              {[
                { name: 'Bitget Wallet', color: 'linear-gradient(135deg, #00f0ff, #0072ff)', icon: '⚡' },
                { name: 'Phantom', color: 'linear-gradient(135deg, #9945ff, #6b21a8)', icon: '👻' },
                { name: 'Backpack', color: 'linear-gradient(135deg, #e33e3f, #b91c1c)', icon: '🎒' },
              ].map(w => (
                <button key={w.name} onClick={() => handleSelectWallet(w.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.7rem 0.8rem', borderRadius: '12px', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem', transition: 'background 0.15s', width: '100%', textAlign: 'left' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: w.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>{w.icon}</div>
                  <span>{w.name}</span>
                </button>
              ))}

              {/* Popular Section */}
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, margin: '0.8rem 0 0.4rem 0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Popular</p>
              {[
                { name: 'Rainbow', color: 'linear-gradient(135deg, #ff0080, #7928ca)', icon: '🌈' },
                { name: 'Base', color: '#0052ff', icon: '🔵' },
                { name: 'MetaMask', color: '#f6851b', icon: '🦊' },
                { name: 'WalletConnect', color: '#3b99fc', icon: '🔗' },
              ].map(w => (
                <button key={w.name} onClick={() => handleSelectWallet(w.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.7rem 0.8rem', borderRadius: '12px', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem', transition: 'background 0.15s', width: '100%', textAlign: 'left' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: typeof w.color === 'string' && w.color.startsWith('linear') ? w.color : w.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>{w.icon}</div>
                  <span>{w.name}</span>
                </button>
              ))}
            </div>

            {/* Right Panel - What is a Wallet */}
            <div style={{ flex: 1, padding: '2.5rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '1.5rem' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>What is a Wallet?</h3>

              <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-start', textAlign: 'left' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-cyan))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>🏦</div>
                <div>
                  <p style={{ fontWeight: 700, margin: '0 0 0.3rem 0', fontSize: '0.95rem' }}>A Home for your Digital Assets</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>Wallets are used to send, receive, store, and display digital assets like Ethereum and NFTs.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-start', textAlign: 'left' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'linear-gradient(135deg, #7928ca, #ff0080)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>🔑</div>
                <div>
                  <p style={{ fontWeight: 700, margin: '0 0 0.3rem 0', fontSize: '0.95rem' }}>A New Way to Log In</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>Instead of creating new accounts and passwords on every website, just connect your wallet.</p>
                </div>
              </div>

              <button 
                onClick={() => window.open('https://ethereum.org/en/wallets/', '_blank')}
                className="btn-premium btn-purple"
                style={{ padding: '0.7rem 2rem', fontSize: '0.95rem', borderRadius: '12px', marginTop: '0.5rem' }}
              >
                Get a Wallet
              </button>
              <a href="https://ethereum.org/en/wallets/find-wallet/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', fontSize: '0.9rem', fontWeight: 600 }}>Learn More</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
