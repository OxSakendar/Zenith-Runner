/**
 * Tests for genlayerService.ts
 *
 * All GenLayer SDK calls are mocked so these run fully offline.
 * Tests verify:
 *  - Correct lifecycle states are emitted in order
 *  - FINISHED_WITH_RETURN leads to success + profile read
 *  - FINISHED_WITH_ERROR throws and emits finalized_error
 *  - Timeout leads to 'unknown' status (no success)
 *  - No silent fallback on writeContract rejection
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeTxProgress,
  type TxLifecycleStatus,
} from '../services/genlayerService';

// ── Mock genlayer-js entirely ────────────────────────────────────────────────
const {
  mockWriteContract,
  mockWaitForTransactionReceipt,
  mockReadContract,
  mockDeployContract,
  mockGetContractCode,
} = vi.hoisted(() => ({
  mockWriteContract: vi.fn(),
  mockWaitForTransactionReceipt: vi.fn(),
  mockReadContract: vi.fn(),
  mockDeployContract: vi.fn(),
  mockGetContractCode: vi.fn(),
}));

vi.mock('genlayer-js', () => ({
  createClient: vi.fn(() => ({
    writeContract: mockWriteContract,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
    readContract: mockReadContract,
    deployContract: mockDeployContract,
    getContractCode: mockGetContractCode,
  })),
  chains: {
    testnetBradbury: { id: 4221, name: 'GenLayer Testnet', nativeCurrency: { symbol: 'GEN' } },
  },
}));

vi.mock('genlayer-js/types', () => ({
  TransactionStatus: { FINALIZED: 'FINALIZED' },
  ExecutionResult: {
    FINISHED_WITH_RETURN: 'FINISHED_WITH_RETURN',
    FINISHED_WITH_ERROR: 'FINISHED_WITH_ERROR',
  },
}));

// ── Re-import module under test AFTER mocks are registered ──────────────────
// We use a dynamic import inside each test to ensure mocks are applied.
async function getService() {
  const mod = await import('../services/genlayerService');
  return mod;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const PILOT = '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;
const PROVIDER = {}; // stub provider

function makeSuccessReceipt(returnValue: object) {
  return {
    txExecutionResultName: 'FINISHED_WITH_RETURN',
    consensus_data: {
      leader_receipt: [{ result: JSON.stringify(returnValue) }],
    },
  };
}

function makeErrorReceipt(errorMsg: string) {
  return {
    txExecutionResultName: 'FINISHED_WITH_ERROR',
    consensus_data: {
      leader_receipt: [{ error: errorMsg }],
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('makeTxProgress()', () => {
  it('wallet_pending is step 1', () => {
    const p = makeTxProgress('wallet_pending');
    expect(p.step).toBe(1);
    expect(p.status).toBe('wallet_pending');
  });

  it('finalized_success is step 4', () => {
    const p = makeTxProgress('finalized_success', '0xabc');
    expect(p.step).toBe(4);
    expect(p.explorerUrl).toContain('0xabc');
  });

  it('finalized_error carries error message', () => {
    const p = makeTxProgress('finalized_error', '0xabc', 'Anti-cheat rejected');
    expect(p.step).toBe(4);
    expect(p.error).toBe('Anti-cheat rejected');
  });

  it('unknown does NOT set step to 4', () => {
    const p = makeTxProgress('unknown', '0xabc', 'timeout');
    expect(p.step).toBe(3);
    expect(p.status).toBe('unknown');
  });
});

describe('executeContractAuthorizeSession()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWriteContract.mockResolvedValue('0xdeadbeef');
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeSuccessReceipt({ session_nonce: `${PILOT}:1`, session_id: 1, status: 'AUTHORIZED' }),
    );
    mockReadContract.mockResolvedValue({
      registered: true, high_score: 0, total_score: 0, bonus_points: 0,
      total_sessions: 1, checkin_streak: 0, last_checkin: '',
    });
  });

  it('emits lifecycle steps in order on success', async () => {
    const { executeContractAuthorizeSession } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await executeContractAuthorizeSession(PILOT, PROVIDER, (p) => steps.push(p.status));
    expect(steps).toEqual(['wallet_pending', 'chain_pending', 'finalizing', 'finalized_success']);
  });

  it('returns session_nonce on FINISHED_WITH_RETURN', async () => {
    const { executeContractAuthorizeSession } = await getService();
    const result = await executeContractAuthorizeSession(PILOT, PROVIDER, () => {});
    expect(result.session_nonce).toBe(`${PILOT}:1`);
    expect(result.session_id).toBe(1);
  });

  it('throws on wallet rejection — no success emitted', async () => {
    mockWriteContract.mockRejectedValue(new Error('User denied transaction'));
    const { executeContractAuthorizeSession } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await expect(
      executeContractAuthorizeSession(PILOT, PROVIDER, (p) => steps.push(p.status)),
    ).rejects.toThrow('User denied');
    expect(steps).not.toContain('finalized_success');
  });

  it('throws and emits finalized_error on FINISHED_WITH_ERROR receipt', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeErrorReceipt('Insufficient session fee'),
    );
    const { executeContractAuthorizeSession } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await expect(
      executeContractAuthorizeSession(PILOT, PROVIDER, (p) => steps.push(p.status)),
    ).rejects.toThrow();
    expect(steps).toContain('finalized_error');
    expect(steps).not.toContain('finalized_success');
  });

  it('emits unknown status on timeout — does NOT emit success', async () => {
    // Simulate immediate timeout
    mockWaitForTransactionReceipt.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 10)),
    );
    // Override the service timeout to 1ms for the test (we mock the race condition via rejection)
    const { executeContractAuthorizeSession } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await expect(
      executeContractAuthorizeSession(PILOT, PROVIDER, (p) => steps.push(p.status)),
    ).rejects.toThrow();
    expect(steps).toContain('unknown');
    expect(steps).not.toContain('finalized_success');
  });
});

describe('executeContractSubmitHighScore()', () => {
  const NONCE = `${PILOT}:1`;
  const profileReturn = {
    registered: true, high_score: 350, total_score: 350,
    bonus_points: 0, total_sessions: 1, checkin_streak: 0, last_checkin: '',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockWriteContract.mockResolvedValue('0xscoreTx');
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeSuccessReceipt({ status: 'SUCCESS', score_added: 350, total_score: 350, high_score: 350, verdict: 'VALID' }),
    );
    mockReadContract.mockResolvedValue(profileReturn);
  });

  it('reads authoritative profile after finality on success', async () => {
    const { executeContractSubmitHighScore } = await getService();
    const result = await executeContractSubmitHighScore(
      PILOT, NONCE, 350, 18, 45, PROVIDER, () => {},
    );
    expect(result.total_score).toBe(350);
    expect(result.high_score).toBe(350);
    expect(result.profile).toMatchObject({ registered: true });
    // readContract must have been called to confirm on-chain state
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'get_pilot_profile' }),
    );
  });

  it('throws and does NOT read profile on FINISHED_WITH_ERROR', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeErrorReceipt('Score rejected by anti-cheat consensus'),
    );
    const { executeContractSubmitHighScore } = await getService();
    await expect(
      executeContractSubmitHighScore(PILOT, NONCE, 350, 18, 45, PROVIDER, () => {}),
    ).rejects.toThrow('anti-cheat');
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it('throws on indeterminate consensus (NOT_VOTED) and emits unknown status', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue({
      txExecutionResultName: 'NOT_VOTED',
      consensus_data: {},
    });
    const { executeContractSubmitHighScore } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await expect(
      executeContractSubmitHighScore(PILOT, NONCE, 350, 18, 45, PROVIDER, (p) => steps.push(p.status)),
    ).rejects.toThrow('Unexpected execution result: NOT_VOTED');
    expect(steps).toContain('unknown');
    expect(steps).not.toContain('finalized_success');
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it('throws and emits finalized_error on replayed session nonce', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeErrorReceipt("session_nonce '0x123...:1' already consumed: replay attack detected"),
    );
    const { executeContractSubmitHighScore } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await expect(
      executeContractSubmitHighScore(PILOT, NONCE, 350, 18, 45, PROVIDER, (p) => steps.push(p.status)),
    ).rejects.toThrow('replay attack detected');
    expect(steps).toContain('finalized_error');
    expect(steps).not.toContain('finalized_success');
  });

  it('throws and emits finalized_error on malformed score exceeding physics ceiling', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeErrorReceipt('score 500 exceeds hard physics ceiling (10 crystals × 20 max pts = 200)'),
    );
    const { executeContractSubmitHighScore } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await expect(
      executeContractSubmitHighScore(PILOT, NONCE, 500, 10, 25, PROVIDER, (p) => steps.push(p.status)),
    ).rejects.toThrow('physics ceiling');
    expect(steps).toContain('finalized_error');
    expect(steps).not.toContain('finalized_success');
  });

  it('throws when contract rejects with insufficient fee', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeErrorReceipt('Insufficient fee: need >= 0.01 GEN (got 0 wei)'),
    );
    const { executeContractSubmitHighScore } = await getService();
    await expect(
      executeContractSubmitHighScore(PILOT, NONCE, 100, 5, 15, PROVIDER, () => {}),
    ).rejects.toThrow('Insufficient fee');
  });

  it('handles RPC timeout with unknown status and prevents false success', async () => {
    mockWaitForTransactionReceipt.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 10)),
    );
    const { executeContractSubmitHighScore } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await expect(
      executeContractSubmitHighScore(PILOT, NONCE, 100, 5, 15, PROVIDER, (p) => steps.push(p.status)),
    ).rejects.toThrow('Score submission pending');
    expect(steps).toContain('unknown');
    expect(steps).not.toContain('finalized_success');
  });
});

describe('executeContractDailyCheckIn()', () => {
  const TODAY = '2026-10-14';
  const profileReturn = {
    registered: true, high_score: 0, total_score: 10,
    bonus_points: 10, total_sessions: 0, checkin_streak: 1, last_checkin: TODAY,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockWriteContract.mockResolvedValue('0xcheckinTx');
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeSuccessReceipt({ status: 'SUCCESS', bonus_points_awarded: 10, authoritative_date: TODAY }),
    );
    mockReadContract.mockResolvedValue(profileReturn);
  });

  it('returns authoritative_date from contract receipt', async () => {
    const { executeContractDailyCheckIn } = await getService();
    const result = await executeContractDailyCheckIn(PILOT, TODAY, PROVIDER, () => {});
    expect(result.authoritative_date).toBe(TODAY);
    expect(result.bonus_points_awarded).toBe(10);
  });

  it('throws on FINISHED_WITH_ERROR (e.g. already checked in)', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeErrorReceipt('Already checked in today'),
    );
    const { executeContractDailyCheckIn } = await getService();
    await expect(
      executeContractDailyCheckIn(PILOT, TODAY, PROVIDER, () => {}),
    ).rejects.toThrow('Already checked in');
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it('throws on FINISHED_WITH_ERROR (date mismatch)', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeErrorReceipt("Check-in date rejected: client date '2026-10-13' does not match authoritative UTC date '2026-10-14'"),
    );
    const { executeContractDailyCheckIn } = await getService();
    await expect(
      executeContractDailyCheckIn(PILOT, '2026-10-13', PROVIDER, () => {}),
    ).rejects.toThrow('authoritative UTC date');
  });

  it('throws on insufficient fee for daily check-in', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue(
      makeErrorReceipt('Insufficient fee: need >= 0.01 GEN'),
    );
    const { executeContractDailyCheckIn } = await getService();
    await expect(
      executeContractDailyCheckIn(PILOT, TODAY, PROVIDER, () => {}),
    ).rejects.toThrow('Insufficient fee');
  });

  it('emits unknown status on check-in timeout and does not award bonus points', async () => {
    mockWaitForTransactionReceipt.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 10)),
    );
    const { executeContractDailyCheckIn } = await getService();
    const steps: TxLifecycleStatus[] = [];
    await expect(
      executeContractDailyCheckIn(PILOT, TODAY, PROVIDER, (p) => steps.push(p.status)),
    ).rejects.toThrow('Check-in pending');
    expect(steps).toContain('unknown');
    expect(steps).not.toContain('finalized_success');
  });
});

describe('getPilotProfileOnChain()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns parsed profile on success', async () => {
    mockReadContract.mockResolvedValue({
      registered: true,
      address: PILOT,
      high_score: 500,
      total_score: 1200,
      bonus_points: 30,
      total_sessions: 4,
      checkin_streak: 3,
      last_checkin: '2026-10-15',
    });
    const { getPilotProfileOnChain } = await getService();
    const prof = await getPilotProfileOnChain(PILOT);
    expect(prof).not.toBeNull();
    expect(prof?.high_score).toBe(500);
    expect(prof?.total_score).toBe(1200);
    expect(prof?.checkin_streak).toBe(3);
  });

  it('returns null on readContract RPC error', async () => {
    mockReadContract.mockRejectedValue(new Error('RPC connection failed'));
    const { getPilotProfileOnChain } = await getService();
    const prof = await getPilotProfileOnChain(PILOT);
    expect(prof).toBeNull();
  });
});

describe('getLeaderboardOnChain()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null on RPC failure — no throw', async () => {
    mockReadContract.mockRejectedValue(new Error('network error'));
    const { getLeaderboardOnChain } = await getService();
    const result = await getLeaderboardOnChain(50);
    expect(result).toBeNull();
  });

  it('maps array result to chain source entries', async () => {
    mockReadContract.mockResolvedValue([
      { address: PILOT, score: 500 },
      { address: '0xother', score: 200 },
    ]);
    const { getLeaderboardOnChain } = await getService();
    const result = await getLeaderboardOnChain(50);
    expect(result).not.toBeNull();
    expect(result![0].source).toBe('chain');
    expect(result![0].score).toBe(500);
  });
});

describe('checkContractExists()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns true when getContractCode returns non-empty bytecode', async () => {
    mockGetContractCode.mockResolvedValue('0x608060405234801561001057600080fd5b50');
    const { checkContractExists } = await getService();
    const exists = await checkContractExists('0x1234567890123456789012345678901234567890');
    expect(exists).toBe(true);
  });

  it('returns false when getContractCode returns empty or null', async () => {
    mockGetContractCode.mockResolvedValue('');
    const { checkContractExists } = await getService();
    const exists = await checkContractExists('0x1234567890123456789012345678901234567890');
    expect(exists).toBe(false);
  });

  it('returns false when getContractCode throws (e.g. 404 or network error)', async () => {
    mockGetContractCode.mockRejectedValue(new Error('Contract not found'));
    const { checkContractExists } = await getService();
    const exists = await checkContractExists('0x1234567890123456789012345678901234567890');
    expect(exists).toBe(false);
  });
});

describe('executeContractDeploy()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('successful deployment updates contract address and returns result', async () => {
    const mockTxHash = '0xdeploytx123';
    const mockDeployedAddr = '0x1234567890123456789012345678901234567890' as `0x${string}`;
    mockDeployContract.mockResolvedValue(mockTxHash);
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'FINALIZED',
      txExecutionResultName: 'FINISHED_WITH_RETURN',
      data: { contract_address: mockDeployedAddr },
    });

    const progressStatuses: TxLifecycleStatus[] = [];
    const { executeContractDeploy, getContractAddress } = await getService();

    const res = await executeContractDeploy(
      PILOT,
      'class ZenithRunner: pass',
      {},
      (p) => progressStatuses.push(p.status),
    );

    expect(res.txHash).toBe(mockTxHash);
    expect(res.contractAddress).toBe(mockDeployedAddr);
    expect(getContractAddress().toLowerCase()).toBe(mockDeployedAddr.toLowerCase());
    expect(progressStatuses).toContain('wallet_pending');
    expect(progressStatuses).toContain('chain_pending');
    expect(progressStatuses).toContain('finalizing');
    expect(progressStatuses).toContain('finalized_success');
  });

  it('wallet rejection throws and does not progress to chain_pending', async () => {
    mockDeployContract.mockRejectedValue(new Error('User rejected deployment'));
    const progressStatuses: TxLifecycleStatus[] = [];
    const { executeContractDeploy } = await getService();

    await expect(
      executeContractDeploy(PILOT, 'class ZenithRunner: pass', {}, (p) =>
        progressStatuses.push(p.status),
      ),
    ).rejects.toThrow(/User rejected deployment/);

    expect(progressStatuses).toEqual(['wallet_pending']);
  });

  it('finalized with error emits finalized_error and throws', async () => {
    const mockTxHash = '0xdeploytxfail';
    mockDeployContract.mockResolvedValue(mockTxHash);
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'FINALIZED',
      txExecutionResultName: 'FINISHED_WITH_ERROR',
    });

    const progressStatuses: TxLifecycleStatus[] = [];
    const { executeContractDeploy } = await getService();

    await expect(
      executeContractDeploy(PILOT, 'class ZenithRunner: pass', {}, (p) =>
        progressStatuses.push(p.status),
      ),
    ).rejects.toThrow(/Contract deployment failed on-chain/);

    expect(progressStatuses).toContain('finalized_error');
  });
});

