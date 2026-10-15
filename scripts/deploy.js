import { readFileSync } from 'fs';
import { createClient, createAccount, chains } from 'genlayer-js';
import { TransactionStatus } from 'genlayer-js/types';

async function main() {
  const privateKey = process.env.GENLAYER_PRIVATE_KEY || process.argv[2];
  if (!privateKey) {
    console.log('----------------------------------------------------');
    console.log('Zenith Runner — Contract Deployment Helper');
    console.log('----------------------------------------------------');
    console.log('Usage: node scripts/deploy.js <YOUR_PRIVATE_KEY>');
    console.log('Or set GENLAYER_PRIVATE_KEY environment variable.');
    console.log('');
    console.log('NOTE: You can also deploy directly from the browser UI!');
    console.log('When connected with MetaMask, click the "Deploy Zenith Contract" button.');
    console.log('----------------------------------------------------');
    process.exit(1);
  }

  const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = createAccount(formattedKey);
  console.log(`Deployer address: ${account.address}`);

  const client = createClient({
    chain: chains.testnetBradbury,
    account,
  });

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

  const contractCode = readFileSync('./contracts/zenith_runner.py', 'utf-8');
  console.log('Deploying ZenithRunnerContract to GenLayer Testnet Bradbury (Chain 4221)...');

  const txHash = await client.deployContract({
    code: contractCode,
    args: [account.address],
    leaderOnly: false,
  });

  console.log(`Deployment transaction submitted: ${txHash}`);
  console.log('Awaiting GenLayer validator consensus & finality (approx 30-90s)...');

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
  });

  const contractAddress = receipt.data?.contract_address || receipt.recipient;
  console.log('====================================================');
  console.log('SUCCESS! Zenith Runner Contract is Live on GenLayer!');
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Explorer: https://explorer.testnet-chain.genlayer.com/address/${contractAddress}`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('Deployment error:', err);
  process.exit(1);
});
