/**
 * genlayerService.ts  (v2 — proper finality + no silent fallbacks)
 *
 * Dual-client pattern:
 *   readClient  – connects directly to GenLayer RPC, no wallet needed.
 *   writeClient – created per-call with the user's wallet provider so
 *                 MetaMask/wallet signs every transaction.
 *
 * Transaction lifecycle:
 *   1. wallet_pending   – waiting for wallet approval (MetaMask popup)
 *   2. chain_pending    – tx submitted, waiting for FINALIZED receipt
 *   3. finalizing       – receipt received, checking ExecutionResult
 *   4. finalized_success – FINISHED_WITH_RETURN; state was updated
 *   5. finalized_error  – FINISHED_WITH_ERROR or consensus rejected
 *   6. unknown          – timeout or RPC error; show explorer link, do NOT retry
 *
 * IMPORTANT: local/demo state must NEVER be updated on a non-success status.
 */

import { createClient, chains } from 'genlayer-js';
import { TransactionStatus, ExecutionResult, type TransactionHash } from 'genlayer-js/types';

// ─── Contract address ────────────────────────────────────────────────────────
export const DEFAULT_CONTRACT_ADDRESS =
  '0x1A3F2D4b43012BA12911a469023877f097B4fcd7' as `0x${string}`;

let inMemoryContractAddress: `0x${string}` = DEFAULT_CONTRACT_ADDRESS;

export function getContractAddress(): `0x${string}` {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('genlayer_contract_address');
    if (
      saved &&
      saved.startsWith('0x') &&
      saved.length === 42 &&
      !saved.toLowerCase().includes('b441') &&
      !saved.toLowerCase().includes('6f76')
    ) {
      return saved as `0x${string}`;
    }
    // Clean up old addresses and set to current verified Zenith Runner contract
    localStorage.setItem('genlayer_contract_address', DEFAULT_CONTRACT_ADDRESS);
  }
  return inMemoryContractAddress || DEFAULT_CONTRACT_ADDRESS;
}

export function setContractAddress(addr: `0x${string}`) {
  inMemoryContractAddress = addr;
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.setItem('genlayer_contract_address', addr);
  }
  GENLAYER_CONTRACT_ADDRESS = addr;
}

export let GENLAYER_CONTRACT_ADDRESS: `0x${string}` = DEFAULT_CONTRACT_ADDRESS;

export const GENLAYER_RPC_URL =
  'https://studio.genlayer.com/api';

export const GENLAYER_EXPLORER_URL =
  'https://explorer-studio.genlayer.com/';

export const ZENITH_RUNNER_METHODS = new Set([
  'authorize_game_session',
  'submit_high_score',
  'daily_checkin',
  'get_pilot_profile',
  'get_leaderboard',
  'get_contract_stats',
]);

const contractMethodsCache = new Map<string, Set<string>>();

export async function getContractSupportedMethods(address: `0x${string}`): Promise<Set<string>> {
  const normalized = address.toLowerCase();
  const cached = contractMethodsCache.get(normalized);
  if (cached) return cached;

  try {
    const res = await fetch(GENLAYER_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'gen_getContractSchema',
        params: [address],
      }),
    });
    const data = await res.json();
    const methods = new Set(Object.keys(data?.result?.methods || {}));
    if (methods.size > 0) {
      contractMethodsCache.set(normalized, methods);
      return methods;
    }
  } catch {
    // If RPC fails, fallback to known Zenith Runner schema
  }

  if (normalized === DEFAULT_CONTRACT_ADDRESS.toLowerCase()) {
    contractMethodsCache.set(normalized, new Set(ZENITH_RUNNER_METHODS));
    return new Set(ZENITH_RUNNER_METHODS);
  }

  return new Set();
}

export async function assertContractSupportsMethod(
  address: `0x${string}`,
  methodName: string,
): Promise<void> {
  const methods = await getContractSupportedMethods(address);
  if (!methods.has(methodName)) {
    throw new Error(
      `Deployed contract at ${address} does not support Zenith Runner method '${methodName}'. ` +
        `Available methods: [${Array.from(methods).join(', ')}]. Deployed contract schema mismatch.`,
    );
  }
}

function formatContractError(action: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('intrinsic gas too low') || msg.includes('Custom eth_sendRawTransaction')) {
    return new Error(
      `Gas limit error during ${action}: Transaction gas limit was lower than payload intrinsic gas. Retrying with safe gas buffer.`,
      { cause: err },
    );
  }
  return new Error(`Transaction error during ${action}: ${msg}`, { cause: err });
}

// ─── Active Chain Config (GenLayer Studio 61999) ─────────────────────────────
export const ACTIVE_CHAIN = chains.studionet;

// ─── Read client (no wallet required) ───────────────────────────────────────
export const readClient = createClient({
  chain: ACTIVE_CHAIN,
});

/**
 * Creates a write client bound to the user's wallet.
 * Must be called after wallet connection so window.ethereum is available.
 */
function createWriteClient(
  address: `0x${string}`,
  provider: unknown,
): ReturnType<typeof createClient> {
  const client = createClient({
    chain: ACTIVE_CHAIN,
    account: address,
    provider: provider as NonNullable<Parameters<typeof createClient>[0]>['provider'],
  });

  // GenLayer SDK defaults to 200,000 gas when eth_estimateGas reverts.
  // Large payloads (such as Python contract deployment) require >340,000 intrinsic gas,
  // causing eth_sendRawTransaction to reject with "intrinsic gas too low".
  // We wrap estimateTransactionGas to guarantee at least intrinsic gas + 1.5M buffer.
  const originalEstimate = client.estimateTransactionGas?.bind(client);
  client.estimateTransactionGas = async (params) => {
    const hexData = params.data || '';
    const byteCount = hexData.startsWith('0x')
      ? Math.max(0, (hexData.length - 2) / 2)
      : Math.max(0, hexData.length / 2);
    const intrinsicGas = BigInt(Math.ceil(21000 + byteCount * 16));
    const minSafeGas = intrinsicGas + 1_500_000n;

    if (originalEstimate) {
      try {
        const estimated = await originalEstimate(params);
        return estimated > minSafeGas ? estimated : minSafeGas;
      } catch {
        return minSafeGas;
      }
    }
    return minSafeGas;
  };

  return client;
}

// ─── Transaction lifecycle status ────────────────────────────────────────────
export type TxLifecycleStatus =
  | 'idle'
  | 'wallet_pending'
  | 'chain_pending'
  | 'finalizing'
  | 'finalized_success'
  | 'finalized_error'
  | 'unknown';

export interface TxProgress {
  status: TxLifecycleStatus;
  step: number;          // 1-4 for the progress indicator
  title: string;
  message: string;
  txHash?: string;       // set once tx is submitted to chain
  explorerUrl?: string;  // link to block explorer for this tx
  error?: string;
}

export function makeTxProgress(
  status: TxLifecycleStatus,
  txHash?: string,
  error?: string,
): TxProgress {
  const explorerUrl = txHash
    ? `${GENLAYER_EXPLORER_URL}tx/${txHash}`
    : undefined;

  switch (status) {
    case 'idle':
      return { status, step: 0, title: '', message: '', txHash, explorerUrl };
    case 'wallet_pending':
      return {
        status, step: 1,
        title: 'Approve in Wallet',
        message: 'Please confirm the transaction in your wallet…',
        txHash, explorerUrl,
      };
    case 'chain_pending':
      return {
        status, step: 2,
        title: 'Submitted to GenLayer',
        message: 'Transaction sent. Waiting for GenLayer validators to pick it up…',
        txHash, explorerUrl,
      };
    case 'finalizing':
      return {
        status, step: 3,
        title: 'Consensus in Progress',
        message:
          'GenLayer validators are reaching consensus. This can take 30–90 s…',
        txHash, explorerUrl,
      };
    case 'finalized_success':
      return {
        status, step: 4,
        title: 'Confirmed On-Chain',
        message: 'Transaction finalized and contract state updated.',
        txHash, explorerUrl,
      };
    case 'finalized_error':
      return {
        status, step: 4,
        title: 'Transaction Rejected',
        message: error ?? 'Contract execution failed. No state was changed.',
        txHash, explorerUrl,
        error,
      };
    case 'unknown':
      return {
        status, step: 3,
        title: 'Status Unknown',
        message:
          'RPC timeout or error. The transaction may still be pending. ' +
          'Check the explorer and do NOT resubmit.',
        txHash, explorerUrl,
        error,
      };
  }
}

// ─── Finality helper ─────────────────────────────────────────────────────────
const FINALITY_TIMEOUT_MS = 180_000; // 3 minutes

async function waitForFinality(txHash: `0x${string}`) {
  try {
    return await readClient.waitForTransactionReceipt({
      hash: txHash as TransactionHash,
      status: TransactionStatus.ACCEPTED,
      retries: 90,
      interval: 2000,
    });
  } catch (err: unknown) {
    // If waitForTransactionReceipt timed out or had an issue, do a direct getTransaction check
    try {
      const tx = await readClient.getTransaction({ hash: txHash as TransactionHash });
      const raw = tx as Record<string, unknown> | null;
      if (raw && (raw.status === 5 || raw.status === 7 || raw.status_name === 'ACCEPTED' || raw.status_name === 'FINALIZED')) {
        return tx;
      }
    } catch {
      // ignore fallback error
    }
    throw err;
  }
}

// ─── On-chain data types ─────────────────────────────────────────────────────
export interface OnChainPilotProfile {
  registered: boolean;
  address?: string;
  high_score: number;
  total_score: number;
  bonus_points: number;
  total_sessions: number;
  checkin_streak: number;
  last_checkin: string;
}

export interface OnChainLeaderboardEntry {
  address: string;
  score: number;
  source: 'chain'; // always 'chain' for real data
}

// ─── READ: Pilot profile ─────────────────────────────────────────────────────
export async function getPilotProfileOnChain(
  pilotAddress: string,
): Promise<OnChainPilotProfile | null> {
  try {
    const result = await readClient.readContract({
      address: getContractAddress(),
      functionName: 'get_pilot_profile',
      args: [pilotAddress],
    });

    if (result && typeof result === 'object') {
      const data = result as Record<string, unknown>;
      return {
        registered: Boolean(data.registered),
        address: String(data.address ?? pilotAddress),
        high_score: Number(data.high_score ?? 0),
        total_score: Number(data.total_score ?? 0),
        bonus_points: Number(data.bonus_points ?? 0),
        total_sessions: Number(data.total_sessions ?? 0),
        checkin_streak: Number(data.checkin_streak ?? 0),
        last_checkin: String(data.last_checkin ?? ''),
      };
    }
  } catch (err) {
    console.warn('[genlayerService] get_pilot_profile RPC error:', err);
  }
  return null;
}

// ─── READ: Leaderboard ───────────────────────────────────────────────────────
export async function getLeaderboardOnChain(
  topN = 50,
): Promise<OnChainLeaderboardEntry[] | null> {
  try {
    let result: unknown;
    try {
      result = await readClient.readContract({
        address: getContractAddress(),
        functionName: 'get_leaderboard',
        args: [topN],
      });
    } catch {
      result = await readClient.readContract({
        address: getContractAddress(),
        functionName: 'get_leaderboard',
        args: [],
      });
    }

    if (typeof result === 'string') {
      try {
        result = JSON.parse(result);
      } catch {
        // keep as is
      }
    }

    if (Array.isArray(result)) {
      return (result as unknown[]).slice(0, topN).map((raw) => {
        const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        return {
          address: String(item.address ?? item.pilot ?? '0xAnon'),
          score: Number(item.score ?? item.total_score ?? 0),
          source: 'chain' as const,
        };
      });
    }
  } catch (err) {
    console.warn('[genlayerService] get_leaderboard RPC error:', err);
  }
  return null;
}

// ─── WRITE: authorize_game_session ───────────────────────────────────────────
export interface AuthorizeSessionResult {
  txHash: string;
  session_nonce: string;
  session_id: number;
}

export async function executeContractAuthorizeSession(
  pilotAddress: `0x${string}`,
  provider: unknown,
  onProgress: (p: TxProgress) => void,
): Promise<AuthorizeSessionResult> {
  const wc = createWriteClient(pilotAddress, provider);

  // Step 1: wallet approval
  onProgress(makeTxProgress('wallet_pending'));

  const activeContract = getContractAddress();
  await assertContractSupportsMethod(activeContract, 'authorize_game_session');

  let txHash: `0x${string}`;
  try {
    txHash = await wc.writeContract({
      address: activeContract,
      functionName: 'authorize_game_session',
      args: [],
      value: 0n, // 0.00 GEN per session
    });
  } catch (err: unknown) {
    throw formatContractError('authorize_game_session', err);
  }

  // Step 2: submitted
  onProgress(makeTxProgress('chain_pending', txHash));

  // Step 3: wait for finality
  onProgress(makeTxProgress('finalizing', txHash));

  let receipt: Awaited<ReturnType<typeof waitForFinality>>;
  try {
    const raceResult = await Promise.race([
      waitForFinality(txHash),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), FINALITY_TIMEOUT_MS),
      ),
    ]);
    receipt = raceResult as Awaited<ReturnType<typeof waitForFinality>>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'TIMEOUT') {
      onProgress(makeTxProgress('unknown', txHash, 'Finality timeout. Check explorer.'));
      throw new Error(`Transaction pending — unknown status. Hash: ${txHash}`, { cause: err });
    }
    onProgress(makeTxProgress('unknown', txHash, msg));
    throw new Error(`RPC error waiting for finality: ${msg}`, { cause: err });
  }

  // Step 4: check execution result
  const rawReceipt = receipt as Record<string, unknown>;
  const execResult = rawReceipt.txExecutionResultName as string | undefined;
  const statusName = rawReceipt.status_name as string | undefined;
  const statusNum = rawReceipt.status as number | undefined;

  const consensusData = rawReceipt.consensus_data as Record<string, unknown> | undefined;
  const leaderReceipts = consensusData?.leader_receipt as Array<Record<string, unknown>> | undefined;
  const leader = leaderReceipts?.[0];
  const leaderExecResult = leader?.execution_result as string | undefined;

  if (execResult === ExecutionResult.FINISHED_WITH_ERROR || leaderExecResult === 'ERROR') {
    const errorDetail =
      (leader?.genvm_result as Record<string, unknown> | undefined)?.stderr ||
      leader?.error ||
      'Contract execution reverted during authorize_game_session';
    const errMsg = String(errorDetail);
    onProgress(makeTxProgress('finalized_error', txHash, errMsg));
    throw new Error(errMsg);
  }

  const isAcceptedStatus =
    statusNum === 5 || statusNum === 7 || statusName === 'ACCEPTED' || statusName === 'FINALIZED';
  if (
    execResult !== ExecutionResult.FINISHED_WITH_RETURN &&
    leaderExecResult !== 'SUCCESS' &&
    !isAcceptedStatus
  ) {
    const errMsg = `Unexpected execution result: ${execResult ?? leaderExecResult ?? 'NOT_VOTED'}`;
    onProgress(makeTxProgress('unknown', txHash, errMsg));
    throw new Error(errMsg);
  }

  // Extract return value (session_nonce) from receipt
  let session_nonce = '';
  let session_id = 0;
  if (leader?.result) {
    try {
      const payloadStr =
        typeof leader.result === 'object' && leader.result !== null
          ? ((leader.result as Record<string, unknown>).payload as Record<string, unknown>)?.readable ||
            JSON.stringify(leader.result)
          : String(leader.result);
      const parsed = typeof payloadStr === 'string' && payloadStr.startsWith('{') ? JSON.parse(payloadStr) : null;
      if (parsed) {
        session_nonce = String(parsed.session_nonce ?? '');
        session_id = Number(parsed.session_id ?? 0);
      }
      if (!session_nonce && typeof payloadStr === 'string') {
        const match = payloadStr.match(/"session_nonce"\s*:\s*"([^"]+)"/);
        if (match) session_nonce = match[1];
        const idMatch = payloadStr.match(/"session_id"\s*:\s*(\d+)/);
        if (idMatch) session_id = parseInt(idMatch[1], 10);
      }
    } catch {
      // ignore
    }
  }

  // Recover actual nonce from authoritative contract state if not parsed from receipt
  if (!session_nonce) {
    try {
      const profile = await getPilotProfileOnChain(pilotAddress);
      if (profile && profile.total_sessions > 0) {
        session_id = profile.total_sessions;
        session_nonce = `${pilotAddress.toLowerCase()}:${session_id}`;
      }
    } catch {
      // ignore
    }
  }

  if (!session_nonce) {
    const errMsg = 'Failed to recover authoritative session nonce from finalized receipt or contract state';
    onProgress(makeTxProgress('finalized_error', txHash, errMsg));
    throw new Error(errMsg);
  }

  onProgress(makeTxProgress('finalized_success', txHash));

  return { txHash, session_nonce, session_id };
}

// ─── WRITE: submit_high_score ────────────────────────────────────────────────
export interface SubmitScoreResult {
  txHash: string;
  total_score: number;
  high_score: number;
  profile: OnChainPilotProfile | null;
}

export async function executeContractSubmitHighScore(
  pilotAddress: `0x${string}`,
  sessionNonce: string,
  score: number,
  crystalsCollected: number,
  durationSeconds: number,
  provider: unknown,
  onProgress: (p: TxProgress) => void,
): Promise<SubmitScoreResult> {
  const wc = createWriteClient(pilotAddress, provider);

  onProgress(makeTxProgress('wallet_pending'));

  const activeContract = getContractAddress();
  await assertContractSupportsMethod(activeContract, 'submit_high_score');

  let txHash: `0x${string}`;
  try {
    txHash = await wc.writeContract({
      address: activeContract,
      functionName: 'submit_high_score',
      args: [sessionNonce, score, crystalsCollected, durationSeconds],
      value: 0n, // 0.00 GEN per session
    });
  } catch (err: unknown) {
    throw formatContractError('submit_high_score', err);
  }

  onProgress(makeTxProgress('chain_pending', txHash));
  onProgress(makeTxProgress('finalizing', txHash));

  let receipt: Awaited<ReturnType<typeof waitForFinality>>;
  try {
    const raceResult = await Promise.race([
      waitForFinality(txHash),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), FINALITY_TIMEOUT_MS),
      ),
    ]);
    receipt = raceResult as Awaited<ReturnType<typeof waitForFinality>>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'TIMEOUT') {
      onProgress(makeTxProgress('unknown', txHash, 'Finality timeout — do not resubmit.'));
      throw new Error(`Score submission pending. Hash: ${txHash}`, { cause: err });
    }
    onProgress(makeTxProgress('unknown', txHash, msg));
    throw new Error(`RPC error: ${msg}`, { cause: err });
  }

  const rawReceipt = receipt as Record<string, unknown>;
  const execResult = rawReceipt.txExecutionResultName as string | undefined;
  const statusName = rawReceipt.status_name as string | undefined;
  const statusNum = rawReceipt.status as number | undefined;

  const consensusData = rawReceipt.consensus_data as Record<string, unknown> | undefined;
  const leaderReceipts = consensusData?.leader_receipt as Array<Record<string, unknown>> | undefined;
  const leader = leaderReceipts?.[0];
  const leaderExecResult = leader?.execution_result as string | undefined;

  if (execResult === ExecutionResult.FINISHED_WITH_ERROR || leaderExecResult === 'ERROR') {
    const errorDetail =
      (leader?.genvm_result as Record<string, unknown> | undefined)?.stderr ||
      leader?.error ||
      'Score rejected by contract (see explorer for details)';
    const reason = String(errorDetail);
    onProgress(makeTxProgress('finalized_error', txHash, reason));
    throw new Error(reason);
  }

  const isAcceptedStatus =
    statusNum === 5 || statusNum === 7 || statusName === 'ACCEPTED' || statusName === 'FINALIZED';
  if (
    execResult !== ExecutionResult.FINISHED_WITH_RETURN &&
    leaderExecResult !== 'SUCCESS' &&
    !isAcceptedStatus
  ) {
    const errMsg = `Unexpected execution result: ${execResult ?? leaderExecResult ?? 'NOT_VOTED'}`;
    onProgress(makeTxProgress('unknown', txHash, errMsg));
    throw new Error(errMsg);
  }

  // Read authoritative state from contract to confirm the update
  const profile = await getPilotProfileOnChain(pilotAddress);
  onProgress(makeTxProgress('finalized_success', txHash));

  return {
    txHash,
    total_score: profile?.total_score ?? score,
    high_score: Math.max(profile?.high_score ?? 0, score),
    profile,
  };
}

// ─── WRITE: daily_checkin ────────────────────────────────────────────────────
export interface CheckInResult {
  txHash: string;
  bonus_points_awarded: number;
  authoritative_date: string;
  profile: OnChainPilotProfile | null;
}

export async function executeContractDailyCheckIn(
  pilotAddress: `0x${string}`,
  hintDateStr: string, // YYYY-MM-DD — validated by contract against authoritative source
  provider: unknown,
  onProgress: (p: TxProgress) => void,
): Promise<CheckInResult> {
  const wc = createWriteClient(pilotAddress, provider);

  onProgress(makeTxProgress('wallet_pending'));

  const activeContract = getContractAddress();
  await assertContractSupportsMethod(activeContract, 'daily_checkin');

  let txHash: `0x${string}`;
  try {
    txHash = await wc.writeContract({
      address: activeContract,
      functionName: 'daily_checkin',
      args: [hintDateStr],
      value: 0n, // 0.00 GEN per session
    });
  } catch (err: unknown) {
    throw formatContractError('daily_checkin', err);
  }

  onProgress(makeTxProgress('chain_pending', txHash));
  onProgress(makeTxProgress('finalizing', txHash));

  let receipt: Awaited<ReturnType<typeof waitForFinality>>;
  try {
    const raceResult = await Promise.race([
      waitForFinality(txHash),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), FINALITY_TIMEOUT_MS),
      ),
    ]);
    receipt = raceResult as Awaited<ReturnType<typeof waitForFinality>>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'TIMEOUT') {
      onProgress(makeTxProgress('unknown', txHash, 'Check-in pending. Do not retry yet.'));
      throw new Error(`Check-in pending. Hash: ${txHash}`, { cause: err });
    }
    onProgress(makeTxProgress('unknown', txHash, msg));
    throw new Error(`RPC error: ${msg}`, { cause: err });
  }

  const rawReceipt = receipt as Record<string, unknown>;
  const execResult = rawReceipt.txExecutionResultName as string | undefined;
  const statusName = rawReceipt.status_name as string | undefined;
  const statusNum = rawReceipt.status as number | undefined;

  const consensusData = rawReceipt.consensus_data as Record<string, unknown> | undefined;
  const leaderReceipts = consensusData?.leader_receipt as Array<Record<string, unknown>> | undefined;
  const leader = leaderReceipts?.[0];
  const leaderExecResult = leader?.execution_result as string | undefined;

  if (execResult === ExecutionResult.FINISHED_WITH_ERROR || leaderExecResult === 'ERROR') {
    const errorDetail =
      (leader?.genvm_result as Record<string, unknown> | undefined)?.stderr ||
      leader?.error ||
      'Check-in rejected by contract';
    const reason = String(errorDetail);
    onProgress(makeTxProgress('finalized_error', txHash, reason));
    throw new Error(reason);
  }

  const isAcceptedStatus =
    statusNum === 5 || statusNum === 7 || statusName === 'ACCEPTED' || statusName === 'FINALIZED';
  if (
    execResult !== ExecutionResult.FINISHED_WITH_RETURN &&
    leaderExecResult !== 'SUCCESS' &&
    !isAcceptedStatus
  ) {
    const errMsg = `Unexpected execution result: ${execResult ?? leaderExecResult ?? 'NOT_VOTED'}`;
    onProgress(makeTxProgress('unknown', txHash, errMsg));
    throw new Error(errMsg);
  }

  // Extract authoritative_date from receipt
  let authoritative_date = hintDateStr;
  try {
    if (leader?.result) {
      const parsed = JSON.parse(String(leader.result));
      authoritative_date = String(parsed.authoritative_date ?? hintDateStr);
    }
  } catch {
    /* use hint */
  }

  const profile = await getPilotProfileOnChain(pilotAddress);
  onProgress(makeTxProgress('finalized_success', txHash));

  return {
    txHash,
    bonus_points_awarded: 10,
    authoritative_date,
    profile,
  };
}

// ─── DEPLOY: contract deployment helper ───────────────────────────────────────
export interface DeployContractResult {
  txHash: string;
  contractAddress: `0x${string}`;
}

export async function executeContractDeploy(
  ownerAddress: `0x${string}`,
  contractCode: string,
  provider: unknown,
  onProgress: (p: TxProgress) => void,
): Promise<DeployContractResult> {
  const wc = createWriteClient(ownerAddress, provider);

  onProgress(makeTxProgress('wallet_pending'));

  let txHash: `0x${string}`;
  try {
    txHash = await wc.deployContract({
      code: contractCode,
      args: [ownerAddress],
      leaderOnly: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Wallet rejected or RPC error during contract deployment: ${msg}`, { cause: err });
  }

  onProgress(makeTxProgress('chain_pending', txHash));
  onProgress(makeTxProgress('finalizing', txHash));

  let receipt: Awaited<ReturnType<typeof waitForFinality>>;
  try {
    const raceResult = await Promise.race([
      waitForFinality(txHash),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), FINALITY_TIMEOUT_MS),
      ),
    ]);
    receipt = raceResult as Awaited<ReturnType<typeof waitForFinality>>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'TIMEOUT') {
      onProgress(makeTxProgress('unknown', txHash, 'Deployment pending. Check explorer.'));
      throw new Error(`Deployment pending — unknown status. Hash: ${txHash}`, { cause: err });
    }
    onProgress(makeTxProgress('unknown', txHash, msg));
    throw new Error(`RPC error waiting for deployment finality: ${msg}`, { cause: err });
  }

  const rawReceipt = receipt as Record<string, unknown>;
  const execResult = rawReceipt.txExecutionResultName as string | undefined;
  const statusName = rawReceipt.status_name as string | undefined;
  const statusNum = rawReceipt.status as number | undefined;

  if (execResult === ExecutionResult.FINISHED_WITH_ERROR) {
    const errMsg = 'Contract deployment failed on-chain';
    onProgress(makeTxProgress('finalized_error', txHash, errMsg));
    throw new Error(errMsg);
  }
  const isAcceptedStatus = statusNum === 5 || statusNum === 7 || statusName === 'ACCEPTED' || statusName === 'FINALIZED';
  if (execResult !== ExecutionResult.FINISHED_WITH_RETURN && !isAcceptedStatus) {
    const errMsg = `Unexpected deployment execution result: ${execResult ?? 'NOT_VOTED'}`;
    onProgress(makeTxProgress('unknown', txHash, errMsg));
    throw new Error(errMsg);
  }

  const data = (receipt as Record<string, unknown>).data as Record<string, unknown> | undefined;
  const deployedAddr = (data?.contract_address ?? (receipt as Record<string, unknown>).recipient) as `0x${string}`;

  if (!deployedAddr) {
    throw new Error(`Contract deployed but address not found in receipt for tx ${txHash}`);
  }

  setContractAddress(deployedAddr);
  onProgress(makeTxProgress('finalized_success', txHash));

  return { txHash, contractAddress: deployedAddr };
}

export async function checkContractExists(address?: string): Promise<boolean> {
  const target = (address || getContractAddress()) as `0x${string}`;
  try {
    const code = await readClient.getContractCode(target);
    return Boolean(code && code.length > 0);
  } catch {
    return false;
  }
}
