import { Command } from 'commander';
import { Commands } from './commands';
import { ethers } from 'ethers';
import chalk from 'chalk';

async function initializeSigner() {
  if (!process.env.MNEMONIC && !process.env.PRIVATE_KEY) {
    console.error(chalk.red("Have you forgot to set MNEMONIC or PRIVATE_KEY?"));
    process.exit(1);
  }
  if (!process.env.RPC) {
    console.error(chalk.red("Have you forgot to set env RPC?"));
    process.exit(1);
  }

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
  const { signer, chainId } = await initializeSigner();
  const commands = new Commands(signer, chainId);

  const program = new Command();

  program
    .name('ocean-cli')
    .description('CLI tool to interact with Ocean Protocol')
    .version('2.0.0')
    .helpOption('-h, --help', 'Display help for command')
    .helpCommand('help [command]', 'Display help for command');

  // getDDO command
  program
    .command('getDDO')
    .description('Gets DDO for an asset using the asset did')
    .argument('<did>', 'The asset DID')
    .action(async (did) => {
      await commands.getDDO([null, did]);
    });

  // publish command
  program
    .command('publish')
    .description('Publishes a new asset with access service or compute service')
    .argument('<metadataFile>', 'Path to metadata file')
    .option('-e, --encrypt [boolean]', 'Encrypt DDO', true)
    .action(async (metadataFile, options) => {
      await commands.publish([null, metadataFile, options.encrypt.toString()]);
    });

  // publishAlgo command
  program
    .command('publishAlgo')
    .description('Publishes a new algorithm')
    .argument('<metadataFile>', 'Path to metadata file')
    .option('-e, --encrypt [boolean]', 'Encrypt DDO', true)
    .action(async (metadataFile, options) => {
      await commands.publishAlgo([null, metadataFile, options.encrypt.toString()]);
    });

  // editAsset command
  program
    .command('editAsset')
    .description('Updates DDO using the metadata items in the file')
    .argument('<datasetDid>', 'Dataset DID')
    .argument('<metadataFile>', 'Updated metadata file')
    .option('-e, --encrypt [boolean]', 'Encrypt DDO', true)
    .action(async (datasetDid, metadataFile, options) => {
      await commands.editAsset([null, datasetDid, metadataFile, options.encrypt.toString()]);
    });

  // download command
  program
    .command('download')
    .description('Downloads an asset into specified folder')
    .argument('<did>', 'The asset DID')
    .argument('[destinationFolder]', 'Destination folder', '.')
    .action(async (did, destinationFolder) => {
      await commands.download([null, did, destinationFolder]);
    });

  // allowAlgo command
  program
    .command('allowAlgo')
    .description('Approves an algorithm to run on a dataset')
    .argument('<datasetDid>', 'Dataset DID')
    .argument('<algoDid>', 'Algorithm DID')
    .option('-e, --encrypt [boolean]', 'Encrypt DDO', true)
    .action(async (datasetDid, algoDid, options) => {
      await commands.allowAlgo([null, datasetDid, algoDid, options.encrypt.toString()]);
    });

  // startCompute command
  program
    .command('startCompute')
    .description('Starts a compute job')
    .argument('<datasetDids>', 'Dataset DIDs (comma-separated)')
    .argument('<algoDid>', 'Algorithm DID')
    .argument('<computeEnvId>', 'Compute environment ID')
    .action(async (datasetDids, algoDid, computeEnvId) => {
      await commands.computeStart([null, datasetDids, algoDid, computeEnvId]);
    });

  // stopCompute command
  program
    .command('stopCompute')
    .description('Stops a compute job')
    .argument('<datasetDid>', 'Dataset DID')
    .argument('<jobId>', 'Job ID')
    .argument('[agreementId]', 'Agreement ID')
    .action(async (datasetDid, jobId, agreementId) => {
      const args = [null, datasetDid, jobId];
      if (agreementId) args.push(agreementId);
      await commands.computeStop(args);
    });

  // getJobStatus command
  program
    .command('getJobStatus')
    .description('Displays the compute job status')
    .argument('<datasetDid>', 'Dataset DID')
    .argument('<jobId>', 'Job ID')
    .argument('[agreementId]', 'Agreement ID')
    .action(async (datasetDid, jobId, agreementId) => {
      const args = [null, datasetDid, jobId];
      if (agreementId) args.push(agreementId);
      await commands.getJobStatus(args);
    });

  // downloadJobResults command
  program
    .command('downloadJobResults')
    .description('Downloads compute job results')
    .argument('<jobId>', 'Job ID')
    .argument('<resultIndex>', 'Result index')
    .argument('[destinationFolder]', 'Destination folder', '.')
    .action(async (jobId, resultIndex, destinationFolder) => {
      await commands.downloadJobResults([null, jobId, resultIndex, destinationFolder]);
    });

  // mintOcean command
  program
    .command('mintOcean')
    .description('Mints Ocean tokens')
    .action(async () => {
      await commands.mintOceanTokens();
    });

  return program;
}