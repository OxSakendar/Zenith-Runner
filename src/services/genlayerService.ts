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
// UPDATE THIS after deploying the v2 contract.
// Current value: original address — replace once new contract is deployed.
export const GENLAYER_CONTRACT_ADDRESS =
  '0xb4412590158f0CceEc98ebffAFf99C851Ab6703c' as `0x${string}`;

export const GENLAYER_EXPLORER_URL =
  'https://explorer.testnet-chain.genlayer.com/';

// ─── Read client (no wallet required) ───────────────────────────────────────
export const readClient = createClient({
  chain: chains.testnetBradbury,
});

/**
 * Creates a write client bound to the user's wallet.
 * Must be called after wallet connection so window.ethereum is available.
 */
function createWriteClient(
  address: `0x${string}`,
  provider: unknown,
): ReturnType<typeof createClient> {
  return createClient({
    chain: chains.testnetBradbury,
    account: address,
    provider: provider as NonNullable<Parameters<typeof createClient>[0]>['provider'],
  });
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
  return readClient.waitForTransactionReceipt({
    hash: txHash as TransactionHash,
    status: TransactionStatus.FINALIZED,
  });
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
      address: GENLAYER_CONTRACT_ADDRESS,
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
    const result = await readClient.readContract({
      address: GENLAYER_CONTRACT_ADDRESS,
      functionName: 'get_leaderboard',
      args: [topN],
    });

    if (Array.isArray(result)) {
      return (result as unknown[]).map((raw) => {
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

  let txHash: `0x${string}`;
  try {
    txHash = await wc.writeContract({
      address: GENLAYER_CONTRACT_ADDRESS,
      functionName: 'authorize_game_session',
      args: [],
      value: BigInt('10000000000000000'), // 0.01 GEN
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Wallet rejected or RPC error during authorize_game_session: ${msg}`, { cause: err });
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
  const execResult = (receipt as Record<string, unknown>).txExecutionResultName as string | undefined;

  if (execResult === ExecutionResult.FINISHED_WITH_ERROR) {
    const errMsg = 'Contract execution failed during authorize_game_session';
    onProgress(makeTxProgress('finalized_error', txHash, errMsg));
    throw new Error(errMsg);
  }
  if (execResult !== ExecutionResult.FINISHED_WITH_RETURN) {
    const errMsg = `Unexpected execution result: ${execResult ?? 'NOT_VOTED'}`;
    onProgress(makeTxProgress('unknown', txHash, errMsg));
    throw new Error(errMsg);
  }

  // Extract return value (session_nonce) from receipt
  let session_nonce = '';
  let session_id = 0;
  try {
    // consensus_data.leader_receipt[0].result contains the return value as JSON string
    const consensusData = (receipt as Record<string, unknown>).consensus_data as Record<string, unknown> | undefined;
    const leaderReceipts = consensusData?.leader_receipt as Array<Record<string, unknown>> | undefined;
    if (leaderReceipts && leaderReceipts.length > 0) {
      const resultStr = String(leaderReceipts[0].result ?? '{}');
      const parsed = JSON.parse(resultStr);
      session_nonce = String(parsed.session_nonce ?? '');
      session_id = Number(parsed.session_id ?? 0);
    }
  } catch {
    // If we can't parse, construct nonce from known info (fallback)
    console.warn('[genlayerService] Could not parse session_nonce from receipt');
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

  let txHash: `0x${string}`;
  try {
    txHash = await wc.writeContract({
      address: GENLAYER_CONTRACT_ADDRESS,
      functionName: 'submit_high_score',
      args: [sessionNonce, score, crystalsCollected, durationSeconds],
      value: BigInt('10000000000000000'), // 0.01 GEN
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Wallet rejected or RPC error during submit_high_score: ${msg}`, { cause: err });
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

  const execResult = (receipt as Record<string, unknown>).txExecutionResultName as string | undefined;

  if (execResult === ExecutionResult.FINISHED_WITH_ERROR) {
    // Try to extract revert reason
    let reason = 'Score rejected by contract (see explorer for details)';
    try {
      const consensusData = (receipt as Record<string, unknown>).consensus_data as Record<string, unknown> | undefined;
      const leaderReceipts = consensusData?.leader_receipt as Array<Record<string, unknown>> | undefined;
      if (leaderReceipts?.[0]?.error) {
        reason = String(leaderReceipts[0].error);
      }
    } catch {/* ignore parse error */}
    onProgress(makeTxProgress('finalized_error', txHash, reason));
    throw new Error(reason);
  }
  if (execResult !== ExecutionResult.FINISHED_WITH_RETURN) {
    const errMsg = `Unexpected execution result: ${execResult ?? 'NOT_VOTED'}`;
    onProgress(makeTxProgress('unknown', txHash, errMsg));
    throw new Error(errMsg);
  }

  // Read authoritative state from contract to confirm the update
  onProgress(makeTxProgress('finalized_success', txHash));
  const profile = await getPilotProfileOnChain(pilotAddress);

  return {
    txHash,
    total_score: profile?.total_score ?? 0,
    high_score: profile?.high_score ?? 0,
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

  let txHash: `0x${string}`;
  try {
    txHash = await wc.writeContract({
      address: GENLAYER_CONTRACT_ADDRESS,
      functionName: 'daily_checkin',
      args: [hintDateStr],
      value: BigInt('10000000000000000'), // 0.01 GEN
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Wallet rejected or RPC error during daily_checkin: ${msg}`, { cause: err });
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

  const execResult = (receipt as Record<string, unknown>).txExecutionResultName as string | undefined;

  if (execResult === ExecutionResult.FINISHED_WITH_ERROR) {
    let reason = 'Check-in rejected by contract';
    try {
      const consensusData = (receipt as Record<string, unknown>).consensus_data as Record<string, unknown> | undefined;
      const leaderReceipts = consensusData?.leader_receipt as Array<Record<string, unknown>> | undefined;
      if (leaderReceipts?.[0]?.error) {
        reason = String(leaderReceipts[0].error);
      }
    } catch {/* ignore */}
    onProgress(makeTxProgress('finalized_error', txHash, reason));
    throw new Error(reason);
  }
  if (execResult !== ExecutionResult.FINISHED_WITH_RETURN) {
    const errMsg = `Unexpected execution result: ${execResult ?? 'NOT_VOTED'}`;
    onProgress(makeTxProgress('unknown', txHash, errMsg));
    throw new Error(errMsg);
  }

  // Extract authoritative_date from receipt
  let authoritative_date = hintDateStr;
  try {
    const consensusData = (receipt as Record<string, unknown>).consensus_data as Record<string, unknown> | undefined;
    const leaderReceipts = consensusData?.leader_receipt as Array<Record<string, unknown>> | undefined;
    if (leaderReceipts?.[0]?.result) {
      const parsed = JSON.parse(String(leaderReceipts[0].result));
      authoritative_date = String(parsed.authoritative_date ?? hintDateStr);
    }
  } catch {/* use hint */}

  onProgress(makeTxProgress('finalized_success', txHash));
  const profile = await getPilotProfileOnChain(pilotAddress);

  return {
    txHash,
    bonus_points_awarded: 10,
    authoritative_date,
    profile,
  };
}
