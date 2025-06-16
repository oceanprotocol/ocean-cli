import { Command } from 'commander';
import { Commands } from './commands.js';
import { ethers } from 'ethers';
import chalk from 'chalk';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'readline/promises';
import { unitsToAmount } from '@oceanprotocol/lib';
import { toBoolean } from './helpers.js';

async function initializeSigner() {

  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC);
  let signer;

  if (process.env.PRIVATE_KEY) {
    signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  } else {
    signer = ethers.Wallet.fromMnemonic(process.env.MNEMONIC);
    signer = await signer.connect(provider);
  }

  const { chainId } = await signer.provider.getNetwork();
  return { signer, chainId };
}

export async function createCLI() {

  if (!process.env.MNEMONIC && !process.env.PRIVATE_KEY) {
    console.error(chalk.red("Have you forgot to set MNEMONIC or PRIVATE_KEY?"));
    process.exit(1);
  }
  if (!process.env.RPC) {
    console.error(chalk.red("Have you forgot to set env RPC?"));
    process.exit(1);
  }

  if (!process.env.NODE_URL) {
    console.error(chalk.red("Have you forgot to set env NODE_URL?"));
    process.exit(1);
  }

  const program = new Command();

  program
    .name('ocean-cli')
    .description('CLI tool to interact with Ocean Protocol')
    .version('2.0.0')
    .helpOption('-h, --help', 'Display help for command');

  // Custom help command to support legacy "h" invocation.
  // Note: We use console.log(program.helpInformation()) to print the full help output.
  program
    .command('help')
    .alias('h')
    .description('Display help for all commands')
    .action(() => {
      console.log(program.helpInformation());
    });

  // getDDO command
  program
    .command('getDDO')
    .description('Gets DDO for an asset using the asset did')
    .argument('<did>', 'The asset DID')
    .option('-d, --did <did>', 'The asset DID')
    .action(async (did, options) => {
      const assetDid = options.did || did;
      if (!assetDid) {
        console.error(chalk.red('DID is required'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getDDO([null, assetDid]);
    });

  // publish command
  program
    .command('publish')
    .description('Publishes a new asset with access service or compute service')
    .argument('<metadataFile>', 'Path to metadata file')
    .option('-f, --file <metadataFile>', 'Path to metadata file')
    .option('-e, --encrypt [boolean]', 'Encrypt DDO', true)
    .action(async (metadataFile, options) => {
      const file = options.file || metadataFile;
      if (!file) {
        console.error(chalk.red('Metadata file is required'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.publish([null, file, options.encrypt.toString()]);
    });

  // publishAlgo command
  program
    .command('publishAlgo')
    .description('Publishes a new algorithm')
    .argument('<metadataFile>', 'Path to metadata file')
    .option('-f, --file <metadataFile>', 'Path to metadata file')
    .option('-e, --encrypt [boolean]', 'Encrypt DDO', true)
    .action(async (metadataFile, options) => {
      const file = options.file || metadataFile;
      if (!file) {
        console.error(chalk.red('Metadata file is required'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.publishAlgo([null, file, options.encrypt.toString()]);
    });

  // editAsset command (alias "edit" for backwards compatibility)
  program
    .command('editAsset')
    .alias('edit')
    .description('Updates DDO using the metadata items in the file')
    .argument('<datasetDid>', 'Dataset DID')
    .argument('<metadataFile>', 'Updated metadata file')
    .option('-d, --did <datasetDid>', 'Dataset DID')
    .option('-f, --file <metadataFile>', 'Updated metadata file')
    .option('-e, --encrypt [boolean]', 'Encrypt DDO', true)
    .action(async (datasetDid, metadataFile, options) => {
      const dsDid = options.did || datasetDid;
      const file = options.file || metadataFile;
      if (!dsDid || !file) {
        console.error(chalk.red('Dataset DID and metadata file are required'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.editAsset([null, dsDid, file, options.encrypt.toString()]);
    });

  // download command
  program
    .command('download')
    .description('Downloads an asset into specified folder')
    .argument('<did>', 'The asset DID')
    .argument('[folder]', 'Destination folder', '.')
    .option('-d, --did <did>', 'The asset DID')
    .option('-f, --folder [folder]', 'Destination folder', '.')
    .action(async (did, folder, options) => {
      const assetDid = options.did || did;
      const destFolder = options.folder || folder || '.';
      if (!assetDid) {
        console.error(chalk.red('DID is required'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.download([null, assetDid, destFolder]);
    });

  // allowAlgo command
  program
    .command('allowAlgo')
    .description('Approves an algorithm to run on a dataset')
    .argument('<datasetDid>', 'Dataset DID')
    .argument('<algoDid>', 'Algorithm DID')
    .option('-d, --dataset <datasetDid>', 'Dataset DID')
    .option('-a, --algo <algoDid>', 'Algorithm DID')
    .option('-e, --encrypt [boolean]', 'Encrypt DDO', true)
    .action(async (datasetDid, algoDid, options) => {
      const dsDid = options.dataset || datasetDid;
      const aDid = options.algo || algoDid;
      if (!dsDid || !aDid) {
        console.error(chalk.red('Dataset DID and Algorithm DID are required'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.allowAlgo([null, dsDid, aDid, options.encrypt.toString()]);
    });

  // startCompute command
  program
    .command('startCompute')
    .description('Starts a compute job')
    .argument('<datasetDids>', 'Dataset DIDs (comma-separated) OR (empty array for none)')
    .argument('<algoDid>', 'Algorithm DID')
    .argument('<computeEnvId>', 'Compute environment ID')
    .argument('<maxJobDuration>', 'maxJobDuration for compute job')
    .argument('<paymentToken>', 'Payment token for compute')
    .argument('<resources>', 'Resources of compute environment stringified')
    .option('-d, --datasets <datasetDids>', 'Dataset DIDs (comma-separated) OR (empty array for none)')
    .option('-a, --algo <algoDid>', 'Algorithm DID')
    .option('-e, --env <computeEnvId>', 'Compute environment ID')
    .option('--maxJobDuration <maxJobDuration>', 'Compute maxJobDuration')
    .option('-t, --token <paymentToken>', 'Compute payment token')
    .option('--resources <resources>', 'Compute resources')
    .option('--accept [boolean]', 'Auto-confirm payment for compute job (true/false)', toBoolean)
    .action(async (datasetDids, algoDid, computeEnvId, maxJobDuration, paymentToken, resources, options) => {
      const dsDids = options.datasets || datasetDids;
      const aDid = options.algo || algoDid;
      const envId = options.env || computeEnvId;
      const jobDuration = options.maxJobDuration || maxJobDuration;
      const token = options.token || paymentToken;
      const res = options.resources || resources;
      if (!dsDids || !aDid || !envId || !jobDuration || !token || !res) {
        console.error(chalk.red('Missing required arguments'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);

      const initArgs = [null, dsDids, aDid, envId, jobDuration, token, res];
      const initResp = await commands.initializeCompute(initArgs);

      if (!initResp) {
        console.error(chalk.red('Initialization failed. Aborting.'));
        return;
      }

      console.log(chalk.yellow('\n--- Payment Details ---'));
      console.log(JSON.stringify(initResp, null, 2));
      const amount = await unitsToAmount(signer, initResp.payment.token, initResp.payment.amount.toString());

      const proceed = options.accept;
      if (!proceed) {
        if (!process.stdin.isTTY) {
          console.error(chalk.red('Cannot prompt for confirmation (non-TTY). Use "--accept true" to skip.'));
          process.exit(1);
        }
        const rl = createInterface({ input, output });
        const confirmation = await rl.question(`\nProceed with payment for starting compute job at price ${amount} in tokens from address ${initResp.payment.token}? (y/n): `);
        rl.close();
        if (confirmation.toLowerCase() !== 'y' && confirmation.toLowerCase() !== 'yes') {
          console.log(chalk.red('Compute job canceled by user.'));
          return;
        }
      } else {
        console.log(chalk.cyan('Auto-confirm enabled with --yes flag.'));
      }

      const computeArgs = [null, dsDids, aDid, envId, JSON.stringify(initResp), jobDuration, token, res];

      await commands.computeStart(computeArgs);
      console.log(chalk.green('Compute job started successfully.'));
    });

  // startFreeCompute command
  program
    .command('startFreeCompute')
    .description('Starts a FREE compute job')
    .argument('<datasetDids>', 'Dataset DIDs (comma-separated) OR (empty array for none)')
    .argument('<algoDid>', 'Algorithm DID')
    .argument('<computeEnvId>', 'Compute environment ID')
    .option('-d, --datasets <datasetDids>', 'Dataset DIDs (comma-separated) OR (empty array for none)')
    .option('-a, --algo <algoDid>', 'Algorithm DID')
    .option('-e, --env <computeEnvId>', 'Compute environment ID')
    .action(async (datasetDids, algoDid, computeEnvId, options) => {
      const dsDids = options.datasets || datasetDids;
      const aDid = options.algo || algoDid;
      const envId = options.env || computeEnvId;
      if (!dsDids || !aDid || !envId) {
        console.error(chalk.red('Missing required arguments'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.freeComputeStart([null, dsDids, aDid, envId]);
    });

  // getComputeEnvironments command
  program
    .command('getComputeEnvironments')
    .alias('getC2DEnvs')
    .description('Gets the existing compute environments')
    .action(async () => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getComputeEnvironments();
    });

  // startFreeCompute command
  program
    .command('computeStreamableLogs')
    .description('Gets the existing compute streamable logs')
    .argument('<jobId>', 'Job ID')
    .option('-j, --job <jobId>', 'Job ID')
    .action(async (jobId, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const args = jobId || options.job
      await commands.computeStreamableLogs([args]);
    });

  // stopCompute command
  program
    .command('stopCompute')
    .description('Stops a compute job')
    .argument('<datasetDid>', 'Dataset DID')
    .argument('<jobId>', 'Job ID')
    .argument('<agreementId>', 'Agreement ID')
    .option('-d, --dataset <datasetDid>', 'Dataset DID')
    .option('-j, --job <jobId>', 'Job ID')
    .option('-a, --agreement [agreementId]', 'Agreement ID')
    .action(async (datasetDid, jobId, agreementId, options) => {
      const dsDid = options.dataset || datasetDid;
      const jId = options.job || jobId;
      const agrId = options.agreement || agreementId;
      if (!dsDid || !jId) {
        console.error(chalk.red('Dataset DID and Job ID are required'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const args = [null, dsDid, jId];
      if (agrId) args.push(agrId);
      await commands.computeStop(args);
    });

  // getJobStatus command
  program
    .command('getJobStatus')
    .description('Displays the compute job status')
    .argument('<datasetDid>', 'Dataset DID')
    .argument('<jobId>', 'Job ID')
    .argument('<agreementId>', 'Agreement ID')
    .option('-d, --dataset <datasetDid>', 'Dataset DID')
    .option('-j, --job <jobId>', 'Job ID')
    .option('-a, --agreement [agreementId]', 'Agreement ID')
    .action(async (datasetDid, jobId, agreementId, options) => {
      const dsDid = options.dataset || datasetDid;
      const jId = options.job || jobId;
      const agrId = options.agreement || agreementId;
      if (!dsDid || !jId) {
        console.error(chalk.red('Dataset DID and Job ID are required'));
        // process.exit(1);
        return
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const args = [null, dsDid, jId];
      if (agrId) args.push(agrId);
      await commands.getJobStatus(args);
    });

  // downloadJobResults command
  program
    .command('downloadJobResults')
    .description('Downloads compute job results')
    .argument('<jobId>', 'Job ID')
    .argument('<resultIndex>', 'Result index', parseInt)
    .argument('[destinationFolder]', 'Destination folder', '.')
    .action(async (jobId, resultIndex, destinationFolder) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.downloadJobResults([null, jobId, resultIndex, destinationFolder]);
    });

  // mintOcean command
  program
    .command('mintOcean')
    .description('Mints Ocean tokens')
    .action(async () => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.mintOceanTokens();
    });

  // Generate new auth token
  program
    .command('generateAuthToken')
    .description('Generate new auth token')
    .action(async () => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.generateAuthToken();
    });


  // Invalidate auth token
  program
    .command('invalidateAuthToken')
    .description('Invalidate auth token')
    .argument('<token>', 'Auth token')
    .option('-t, --token <token>', 'Auth token')
    .action(async (token, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.invalidateAuthToken([token || options.token]);
    });

  // Escrow deposit command
  program
    .command('depositEscrow')
    .description('Deposit tokens into the escrow contract')
    .argument('<token>', 'Address of the token to deposit')
    .argument('<amount>', 'Amount of tokens to deposit')
    .option('-t, --token <token>', 'Address of the token to deposit')
    .option('-a, --amount <amount>', 'Amount of tokens to deposit')
    .action(async (token, amount, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const tokenAddress = options.token || token;
      const amountToDeposit = options.amount || amount;
      const success = await commands.depositToEscrow(signer, tokenAddress, amountToDeposit, chainId);
      if (!success) {
        console.log(chalk.red('Deposit failed'));
        return;
      }

      console.log(chalk.green('Deposit successful'));
    });

  // Escrow authorization command
  program
    .command('authorizeEscrow')
    .description('Authorize a payee to lock and claim funds from escrow')
    .argument('<token>', 'Address of the token to authorize')
    .argument('<payee>', 'Address of the payee to authorize')
    .argument('<maxLockedAmount>', 'Maximum amount that can be locked by payee')
    .argument('<maxLockSeconds>', 'Maximum lock duration in seconds')
    .argument('<maxLockCounts>', 'Maximum number of locks allowed')
    .option('-t, --token <token>', 'Address of the token to authorize')
    .option('-p, --payee <payee>', 'Address of the payee to authorize')
    .option('-m, --maxLockedAmount <maxLockedAmount>', 'Maximum amount that can be locked by payee')
    .option('-s, --maxLockSeconds <maxLockSeconds>', 'Maximum lock duration in seconds')
    .option('-c, --maxLockCounts <maxLockCounts>', 'Maximum number of locks allowed')
    .action(async (token, payee, maxLockedAmount, maxLockSeconds, maxLockCounts, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const tokenAddress = options.token || token;
      const payeeAddress = options.payee || payee;
      const maxLockedAmountValue = options.maxLockedAmount || maxLockedAmount;
      const maxLockSecondsValue = options.maxLockSeconds || maxLockSeconds;
      const maxLockCountsValue = options.maxLockCounts || maxLockCounts;

      const success = await commands.authorizeEscrowPayee(
        tokenAddress,
        payeeAddress,
        maxLockedAmountValue,
        maxLockSecondsValue,
        maxLockCountsValue,
      );

      if (!success) {
        console.log(chalk.red('Authorization failed'));
        return;
      }

      console.log(chalk.green('Authorization successful'));
    });

  return program;
}