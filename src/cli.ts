import { Command } from "commander";
import { Commands } from "./commands.js";
import { JsonRpcProvider, Signer, ethers } from "ethers";
import fs from "fs";
import { createRequire } from "module";
import chalk from "chalk";
import { stdin as input, stdout } from "node:process";
import { createInterface } from "readline/promises";
import {
  unitsToAmount,
  ProviderInstance,
  isP2pUri,
  ServiceStatusNumber,
  ServiceRestartParams,
} from "@oceanprotocol/lib";
import { toBoolean } from "./helpers.js";

// Single source of truth for the CLI version: read it from package.json instead
// of hardcoding, so it can't drift. `../package.json` resolves from both src/
// (dev via tsx) and dist/ (published), since both sit one level below the root.
const pkg = createRequire(import.meta.url)("../package.json");

// Parse a CLI JSON array-of-strings option (e.g. --cmd '["python","app.py"]').
// Returns the array, or throws with a clear message for the action to surface.
function parseJsonStringArray(name: string, value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be a JSON array, e.g. '["a","b"]'`);
  }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  return parsed as string[];
}

// Parse a comma-separated port list, validating each is an integer 1-65535.
function parsePorts(value: string): number[] {
  return value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const n = parseInt(p, 10);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`Invalid port "${p}" (must be an integer 1-65535)`);
      }
      return n;
    });
}

async function initializeSigner() {
  const provider = new JsonRpcProvider(process.env.RPC);
  let signer: Signer;

  if (process.env.PRIVATE_KEY) {
    signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  } else {
    signer = ethers.Wallet.fromPhrase(process.env.MNEMONIC, provider);
  }

  const { chainId } = await signer.provider.getNetwork();
  return { signer, chainId: Number(chainId) };
}

export async function createCLI() {
  // A pure help/version invocation must work with no configuration at all (a
  // globally installed binary is expected to answer `--help`/`--version`
  // without credentials). Detect it from argv and skip both env validation and
  // the P2P bootstrap in that case; every real command still validates below.
  const argv = process.argv.slice(2);
  const isHelpOrVersion =
    argv.includes("--help") ||
    argv.includes("-h") ||
    argv.includes("--version") ||
    argv.includes("-V") ||
    argv[0] === "help" ||
    argv[0] === "h";

  if (!isHelpOrVersion) {
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
  }

  if (!isHelpOrVersion && process.env.NODE_URL && isP2pUri(process.env.NODE_URL)) {
    const extra = process.env.BOOTSTRAP_PEERS?.split(",").filter(Boolean) || [];

    // Default Ocean bootstrap nodes (must be included explicitly since passing
    // bootstrapPeers to setupP2P replaces the built-in defaults)
    const oceanDefaults = [
      "/dns4/bootstrap1.oncompute.ai/tcp/9001/ws/p2p/16Uiu2HAmLhRDqfufZiQnxvQs2XHhd6hwkLSPfjAQg1gH8wgRixiP",
      "/dns4/bootstrap2.oncompute.ai/tcp/9001/ws/p2p/16Uiu2HAmHwzeVw7RpGopjZe6qNBJbzDDBdqtrSk7Gcx1emYsfgL4",
      "/dns4/bootstrap3.oncompute.ai/tcp/9001/ws/p2p/16Uiu2HAmBKSeEP3v4tYEPsZsZv9VELinyMCsrVTJW9BvQeFXx28U",
      "/dns4/bootstrap4.oncompute.ai/tcp/9001/ws/p2p/16Uiu2HAmSTVTArioKm2wVcyeASHYEsnx2ZNq467Z4GMDU4ErEPom",
    ];

    const nodeUrl = process.env.NODE_URL;
    const isFullMultiaddr =
      nodeUrl.startsWith("/") && nodeUrl.includes("/p2p/");
    const localPeer = isFullMultiaddr
      ? [nodeUrl]
      : [`/ip4/127.0.0.1/tcp/9001/ws/p2p/${nodeUrl}`];
    const bootstrapPeers = [...localPeer, ...extra, ...oceanDefaults];
    console.log(chalk.cyan("P2P mode detected. Initializing libp2p..."));
    console.log(chalk.cyan(`Bootstrap peers: ${bootstrapPeers.length}`));

    for (const peer of localPeer) {
      console.log(chalk.cyan(`  Local: ${peer}`));
    }
    // Allow localhost connections / local nodes
    await ProviderInstance.setupP2P({
      bootstrapPeers,
      libp2p: {
        connectionGater: {
          denyDialMultiaddr: () => false,
        },
      },
    } as any);
    console.log(
      chalk.cyan("libp2p node started. Waiting for peer connections...")
    );

    // Wait for the TARGET peer (the one in NODE_URL) to be connected,
    // not just any bootstrap peer — otherwise signed commands fail with
    // "Cannot reach peer ...".
    const targetPeerId = isFullMultiaddr
      ? nodeUrl.split("/p2p/").pop()!
      : nodeUrl;
    const maxWait = 20_000;
    const interval = 500;
    let waited = 0;
    const libp2p = (ProviderInstance as any).p2pProvider?.libp2pNode;
    const isTargetConnected = () =>
      (libp2p?.getPeers() ?? []).some(
        (p: { toString(): string }) => p.toString() === targetPeerId
      );
    while (waited < maxWait) {
      if (isTargetConnected()) {
        const total = libp2p?.getConnections()?.length ?? 0;
        console.log(
          chalk.green(
            `Connected to target peer ${targetPeerId.slice(0, 12)}… in ${waited}ms (total peers: ${total})`
          )
        );
        break;
      }
      await new Promise((r) => setTimeout(r, interval));
      waited += interval;
      if (waited % 3000 === 0) {
        const total = libp2p?.getConnections()?.length ?? 0;
        console.log(
          chalk.yellow(
            `  Waiting for target peer ${targetPeerId.slice(0, 12)}… (${waited / 1000}s, ${total} other peer(s))`
          )
        );
      }
    }
    if (!isTargetConnected()) {
      console.error(
        chalk.red(
          `Target peer ${targetPeerId} not reachable after ${maxWait / 1000}s. Commands will fail.`
        )
      );
    }
  }

  const program = new Command();

  program
    .name("ocean-cli")
    .description("CLI tool to interact with Ocean Protocol")
    .version(pkg.version)
    .helpOption("-h, --help", "Display help for command");

  // Custom help command to support legacy "h" invocation.
  // Note: We use console.log(program.helpInformation()) to print the full help output.
  program
    .command("help")
    .alias("h")
    .description("Display help for all commands")
    .action(() => {
      console.log(program.helpInformation());
    });

  // getDDO command
  program
    .command("getDDO")
    .description("Gets DDO for an asset using the asset did")
    .argument("<did>", "The asset DID")
    .option("-d, --did <did>", "The asset DID")
    .action(async (did, options) => {
      const assetDid = options.did || did;
      if (!assetDid) {
        console.error(chalk.red("DID is required"));
        // process.exit(1);
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getDDO([null, assetDid]);
    });

  // publish command
  program
    .command("publish")
    .description("Publishes a new asset with access service or compute service")
    .argument("<metadataFile>", "Path to metadata file")
    .option("-f, --file <metadataFile>", "Path to metadata file")
    .option("-e, --encrypt [boolean]", "Encrypt DDO", true)
    .action(async (metadataFile, options) => {
      const file = options.file || metadataFile;
      if (!file) {
        console.error(chalk.red("Metadata file is required"));
        // process.exit(1);
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.publish([null, file, options.encrypt.toString()]);
    });

  // publishAlgo command
  program
    .command("publishAlgo")
    .description("Publishes a new algorithm")
    .argument("<metadataFile>", "Path to metadata file")
    .option("-f, --file <metadataFile>", "Path to metadata file")
    .option("-e, --encrypt [boolean]", "Encrypt DDO", true)
    .action(async (metadataFile, options) => {
      const file = options.file || metadataFile;
      if (!file) {
        console.error(chalk.red("Metadata file is required"));
        // process.exit(1);
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.publishAlgo([null, file, options.encrypt.toString()]);
    });

  // editAsset command (alias "edit" for backwards compatibility)
  program
    .command("editAsset")
    .alias("edit")
    .description("Updates DDO using the metadata items in the file")
    .argument("<datasetDid>", "Dataset DID")
    .argument("<metadataFile>", "Updated metadata file")
    .option("-d, --did <datasetDid>", "Dataset DID")
    .option("-f, --file <metadataFile>", "Updated metadata file")
    .option("-e, --encrypt [boolean]", "Encrypt DDO", true)
    .action(async (datasetDid, metadataFile, options) => {
      const dsDid = options.did || datasetDid;
      const file = options.file || metadataFile;
      if (!dsDid || !file) {
        console.error(chalk.red("Dataset DID and metadata file are required"));
        // process.exit(1);
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.editAsset([null, dsDid, file, options.encrypt.toString()]);
    });

  // download command
  program
    .command("download")
    .description("Downloads an asset into specified folder")
    .argument("<did>", "The asset DID")
    .argument("[folder]", "Destination folder", ".")
    .argument("[serviceId]", "Service ID (optional)")
    .option("-d, --did <did>", "The asset DID")
    .option("-f, --folder [folder]", "Destination folder", ".")
    .option("-s, --service <serviceId>", "Service ID")
    .action(async (did, folder, serviceId, options) => {
      const assetDid = options.did || did;
      const destFolder = options.folder || folder || '.';
      const svcId = options.service || serviceId;
      if (!assetDid) {
        console.error(chalk.red("DID is required"));
        // process.exit(1);
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.download([null, assetDid, destFolder, svcId]);
    });

  // allowAlgo command
  program
    .command("allowAlgo")
    .description("Approves an algorithm to run on a dataset")
    .argument("<datasetDid>", "Dataset DID")
    .argument("<algoDid>", "Algorithm DID")
    .option("-d, --dataset <datasetDid>", "Dataset DID")
    .option("-a, --algo <algoDid>", "Algorithm DID")
    .option("-e, --encrypt [boolean]", "Encrypt DDO", true)
    .action(async (datasetDid, algoDid, options) => {
      const dsDid = options.dataset || datasetDid;
      const aDid = options.algo || algoDid;
      if (!dsDid || !aDid) {
        console.error(chalk.red("Dataset DID and Algorithm DID are required"));
        // process.exit(1);
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.allowAlgo([null, dsDid, aDid, options.encrypt.toString()]);
    });

  // startCompute command
  program
    .command("startCompute")
    .description("Starts a compute job")
    .argument(
      "<datasetDids>",
      "Dataset DIDs (comma-separated), an empty array for none, OR a JSON ComputeAsset object/array with a fileObject (raw datasets, no DID). Mixed input must be valid JSON, e.g. '[\"did:op:abc\",{\"fileObject\":{...}}]'"
    )
    .argument(
      "<algoDid>",
      "Algorithm DID, OR a JSON ComputeAlgorithm object with a fileObject and meta (raw algorithm, no DID)"
    )
    .argument("<computeEnvId>", "Compute environment ID")
    .argument("<maxJobDuration>", "maxJobDuration for compute job")
    .argument("<paymentToken>", "Payment token for compute")
    .argument("<resources>", "Resources of compute environment stringified")
    .argument(
      "[output]",
      "Output backend to save job results to. Supported types include S3, FTP, URL, Arweave, etc. Defaults to node local disk if omitted."
    )
    .argument("[serviceIds]", "Service IDs (comma-separated; positional mapping with datasetDIDs)")
    .argument("[algoServiceId]", "Algorithm Service ID (optional)")
    .option(
      "-d, --datasets <datasetDids>",
      "Dataset DIDs (comma-separated), an empty array for none, OR a JSON ComputeAsset object/array with a fileObject (raw datasets, no DID)"
    )
    .option(
      "-a, --algo <algoDid>",
      "Algorithm DID, OR a JSON ComputeAlgorithm object with a fileObject and meta (raw algorithm, no DID)"
    )
    .option("-e, --env <computeEnvId>", "Compute environment ID")
    .option("--maxJobDuration <maxJobDuration>", "Compute maxJobDuration")
    .option("-t, --token <paymentToken>", "Compute payment token")
    .option("-s, --services [serviceIds]", "Service IDs (comma-separated; positional mapping with datasetDIDs)")
    .option("-x, --algo-service [algoServiceId]", "Algorithm Service ID (optional)")
    .option("--resources <resources>", "Compute resources")
    .option("--accept [boolean]", "Auto-confirm payment for compute job (true/false)", toBoolean)
    .option(
      "-o, --output [output]",
      "Output backend to save job results to. Supported types include S3, FTP, URL, Arweave, etc. Defaults to node local disk if omitted."
    )
    .action(async (datasetDids, algoDid, computeEnvId, maxJobDuration, paymentToken, resources, output, serviceIds, algoServiceId, options) => {
        const dsDids = options.datasets || datasetDids;
        const aDid = options.algo || algoDid;
        const envId = options.env || computeEnvId;
        const jobDuration = options.maxJobDuration || maxJobDuration;
        const token = options.token || paymentToken;
        const res = options.resources || resources;
        const outputLocation = options.output || output;
      const svcIds = options.services ?? serviceIds ?? '';
      const algoSvcId = options.algoService ?? algoServiceId ?? '';
        if (!dsDids || !aDid || !envId || !jobDuration || !token || !res) {
        console.error(chalk.red('Missing required arguments'));
          // process.exit(1);
        return
      }

      const dsArr =
        dsDids === '[]'
          ? []
          : dsDids.split(',').map(s => s.trim()).filter(Boolean);

      const svArr = svcIds
        ? svcIds.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      // Optional check: serviceIds must match length if provided
      if (svArr && svArr.length !== dsArr.length) {
        console.error(
          chalk.red(
            `Length mismatch: datasetDids=${dsArr.length} vs serviceIds=${svArr.length}. ` +
            'If serviceIds is provided, it must match datasetDids length (positional 1–1).'
          )
        );
          return;
        }
        const { signer, chainId } = await initializeSigner();
        const commands = new Commands(signer, chainId);

      const initArgs = [null, dsDids, aDid, envId, jobDuration, token, res, outputLocation, svcIds, algoSvcId];
      console.log('initArgs:', initArgs);
        const initResp = await commands.initializeCompute(initArgs);

        if (!initResp) {
          console.error(chalk.red("Initialization failed. Aborting."));
          return;
        }

        console.log(chalk.yellow("\n--- Payment Details ---"));
        console.log(JSON.stringify(initResp, null, 2));
        const amount = await unitsToAmount(
          signer,
          initResp.payment.token,
          initResp.payment.amount.toString()
        );

        const proceed = options.accept;
        if (!proceed) {
          if (!process.stdin.isTTY) {
            console.error(
              chalk.red(
                'Cannot prompt for confirmation (non-TTY). Use "--accept true" to skip.'
              )
            );
            process.exit(1);
          }
          const rl = createInterface({ input, output: stdout });
          const confirmation = await rl.question(
            `\nProceed with payment for starting compute job at price ${amount} in tokens from address ${initResp.payment.token}? (y/n): `
          );
          rl.close();
          if (
            confirmation.toLowerCase() !== "y" &&
            confirmation.toLowerCase() !== "yes"
          ) {
            console.log(chalk.red("Compute job canceled by user."));
            return;
          }
        } else {
          console.log(chalk.cyan("Auto-confirm enabled with --yes flag."));
        }

      const computeArgs = [null, dsDids, aDid, envId, JSON.stringify(initResp), jobDuration, token, res, outputLocation, svcIds, algoSvcId];

        await commands.computeStart(computeArgs);
        console.log(chalk.green("Compute job started successfully."));
      }
    );

  // startFreeCompute command
  program
    .command("startFreeCompute")
    .description("Starts a FREE compute job")
    .argument(
      "<datasetDids>",
      "Dataset DIDs (comma-separated), an empty array for none, OR a JSON ComputeAsset object/array with a fileObject (raw datasets, no DID). Mixed input must be valid JSON, e.g. '[\"did:op:abc\",{\"fileObject\":{...}}]'"
    )
    .argument(
      "<algoDid>",
      "Algorithm DID, OR a JSON ComputeAlgorithm object with a fileObject and meta (raw algorithm, no DID)"
    )
    .argument("<computeEnvId>", "Compute environment ID")
    .argument(
      "[output]",
      "Output backend to save job results to. Supported types include S3, FTP, URL, Arweave, etc. Defaults to node local disk if omitted."
    )
    .argument("[serviceIds]", "Service IDs (comma-separated; positional mapping with datasetDIDs)")
    .argument("[algoServiceId]", "Algorithm Service ID (optional)")
    .option(
      "-d, --datasets <datasetDids>",
      "Dataset DIDs (comma-separated), an empty array for none, OR a JSON ComputeAsset object/array with a fileObject (raw datasets, no DID)"
    )
    .option(
      "-a, --algo <algoDid>",
      "Algorithm DID, OR a JSON ComputeAlgorithm object with a fileObject and meta (raw algorithm, no DID)"
    )
    .option("-e, --env <computeEnvId>", "Compute environment ID")
    .option(
      "-o, --output [output]",
      "Output backend to save job results to. Supported types include S3, FTP, URL, Arweave, etc. Defaults to node local disk if omitted."
    )
    .option("-s, --services [serviceIds]", "Service IDs (comma-separated; positional mapping with datasetDIDs)")
    .option("-x, --algo-service [algoServiceId]", "Algorithm Service ID (optional)")
    .action(async (datasetDids, algoDid, computeEnvId, output, serviceIds, algoServiceId, options) => {
      const dsDids = options.datasets || datasetDids;
      const aDid = options.algo || algoDid;
      const envId = options.env || computeEnvId;
      const outputLocation = options.output || output;
      const svcIds = options.services ?? serviceIds ?? '';
      const algoSvcId = options.algoService ?? algoServiceId ?? '';

      if (!dsDids || !aDid || !envId) {
        console.error(chalk.red("Missing required arguments"));
        // process.exit(1);
        return
      }

      const dsArr =
        dsDids === '[]'
          ? []
          : dsDids.split(',').map(s => s.trim()).filter(Boolean);

      const svArr = svcIds
        ? svcIds.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      // Optional check: serviceIds must match length if provided
      if (svArr && svArr.length !== dsArr.length) {
        console.error(
          chalk.red(
            `Length mismatch: datasetDids=${dsArr.length} vs serviceIds=${svArr.length}. ` +
            'If serviceIds is provided, it must match datasetDids length (positional 1–1).'
          )
        );
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.freeComputeStart([null, dsDids, aDid, envId, outputLocation, svcIds, algoSvcId]);
    });

  // getComputeEnvironments command
  program
    .command("getComputeEnvironments")
    .alias("getC2DEnvs")
    .argument(
      "[node]",
      "Optional Ocean Node URL or peer id to query (defaults to NODE_URL)"
    )
    .option("-n, --node <node>", "Ocean Node URL or peer id to query")
    .description("Gets the existing compute environments")
    .action(async (node, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getComputeEnvironments(options.node || node);
    });

  // computeStreamableLogs command
  program
    .command("computeStreamableLogs")
    .description("Gets the existing compute streamable logs")
    .argument("<jobId>", "Job ID")
    .option("-j, --job <jobId>", "Job ID")
    .action(async (jobId, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const args = jobId || options.job;
      await commands.computeStreamableLogs([args]);
    });

  // stopCompute command
  program
    .command("stopCompute")
    .description("Stops a compute job")
    .argument("<datasetDid>", "Dataset DID")
    .argument("<jobId>", "Job ID")
    .argument("<agreementId>", "Agreement ID")
    .option("-d, --dataset <datasetDid>", "Dataset DID")
    .option("-j, --job <jobId>", "Job ID")
    .option("-a, --agreement [agreementId]", "Agreement ID")
    .action(async (datasetDid, jobId, agreementId, options) => {
      const dsDid = options.dataset || datasetDid;
      const jId = options.job || jobId;
      const agrId = options.agreement || agreementId;
      if (!dsDid || !jId) {
        console.error(chalk.red("Dataset DID and Job ID are required"));
        // process.exit(1);
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const args = [null, dsDid, jId];
      if (agrId) args.push(agrId);
      await commands.computeStop(args);
    });

  // getJobStatus command
  program
    .command("getJobStatus")
    .description("Displays the compute job status")
    .argument("<datasetDid>", "Dataset DID")
    .argument("<jobId>", "Job ID")
    .argument("[agreementId]", "Agreement ID")
    .option("-d, --dataset <datasetDid>", "Dataset DID")
    .option("-j, --job <jobId>", "Job ID")
    .option("-a, --agreement [agreementId]", "Agreement ID")
    .action(async (datasetDid, jobId, agreementId, options) => {
      const dsDid = options.dataset || datasetDid;
      const jId = options.job || jobId;
      const agrId = options.agreement || agreementId;
      if (!dsDid || !jId) {
        console.error(chalk.red("Dataset DID and Job ID are required"));
        // process.exit(1);
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const args = [null, dsDid, jId];
      if (agrId) args.push(agrId);
      await commands.getJobStatus(args);
    });

  // downloadJobResults command
  program
    .command("downloadJobResults")
    .description("Downloads compute job results")
    .argument("<jobId>", "Job ID")
    .argument("<resultIndex>", "Result index", parseInt)
    .argument("[destinationFolder]", "Destination folder", ".")
    .action(async (jobId, resultIndex, destinationFolder) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.downloadJobResults([
        null,
        jobId,
        resultIndex,
        destinationFolder,
      ]);
    });

  // =========================================================================
  // Service-on-Demand commands
  // =========================================================================

  // getServiceTemplates command
  program
    .command("getServiceTemplates")
    .alias("serviceTemplates")
    .description(
      "Lists the node's Service-on-Demand templates and compatible environments"
    )
    .argument(
      "[node]",
      "Optional Ocean Node URL or peer id to query (defaults to NODE_URL)"
    )
    .option("-n, --node <node>", "Ocean Node URL or peer id to query")
    .action(async (node, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getServiceTemplates(options.node || node);
    });

  // startService command
  program
    .command("startService")
    .description(
      "Starts an on-demand service (long-running container) on a compute environment, paid via escrow"
    )
    .argument("<computeEnvId>", "Compute environment ID (must have services enabled)")
    .argument("<duration>", "Requested duration in seconds", parseInt)
    .argument("<paymentToken>", "Payment token address")
    .option("--template <templateId>", "Start from an operator-published template")
    .option("-i, --image <image>", "Container image (alternative to --template)")
    .option("--tag <tag>", "Image tag (mutually exclusive with --checksum/--dockerfile)")
    .option("--checksum <sha256>", "Image digest, e.g. sha256:<64 hex>")
    .option("--dockerfile <path>", "Path to a local Dockerfile (node must allow image builds)")
    .option(
      "--additional-docker-files <path>",
      "Path to JSON file of {filename: content} used with --dockerfile"
    )
    .option("--cmd <json>", 'Docker CMD override as JSON array, e.g. \'["python","app.py"]\'')
    .option("--entrypoint <json>", "Docker ENTRYPOINT override as JSON array")
    .option("-p, --ports <ports>", "Comma-separated container ports to expose, e.g. 8888,8080")
    .option(
      "-r, --resources <resources>",
      'Stringified JSON [{"id":"cpu","amount":1},...]; defaults to template requirements'
    )
    .option(
      "-u, --user-data <json>",
      "JSON object of container env vars (encrypted to the node; never logged)"
    )
    .option("--user-data-file <path>", "Path to JSON file with container env vars")
    .option("--accept [boolean]", "Auto-confirm payment (true/false)", toBoolean)
    .option("--wait [boolean]", "Poll until Running or failure (default true)", toBoolean, true)
    .option("--timeout <seconds>", "Max seconds to wait for Running (default 600)", parseInt)
    .action(async (computeEnvId, duration, paymentToken, options) => {
      const envId = options.env || computeEnvId;
      const token = paymentToken;
      if (!envId || !duration || !token) {
        console.error(chalk.red("Missing required arguments: <computeEnvId> <duration> <paymentToken>"));
        return;
      }
      if (!Number.isInteger(duration) || duration <= 0) {
        console.error(chalk.red("Duration must be a positive integer number of seconds."));
        return;
      }
      if (options.template && options.image) {
        console.error(chalk.red("Provide either --template or --image, not both."));
        return;
      }

      let ports: number[] | undefined;
      let cmd: string[] | undefined;
      let entrypoint: string[] | undefined;
      try {
        if (options.ports) ports = parsePorts(options.ports);
        if (options.cmd) cmd = parseJsonStringArray("--cmd", options.cmd);
        if (options.entrypoint)
          entrypoint = parseJsonStringArray("--entrypoint", options.entrypoint);
      } catch (e) {
        console.error(chalk.red((e as Error).message));
        return;
      }

      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.startService({
        envId,
        duration,
        paymentToken: token,
        templateId: options.template,
        image: options.image,
        tag: options.tag,
        checksum: options.checksum,
        dockerfilePath: options.dockerfile,
        additionalDockerFilesPath: options.additionalDockerFiles,
        cmd,
        entrypoint,
        ports,
        resources: options.resources,
        userDataInline: options.userData,
        userDataFilePath: options.userDataFile,
        accept: options.accept,
        wait: options.wait,
        timeout: options.timeout,
      });
    });

  // getServiceStatus command (caller-owned, full detail)
  program
    .command("getServiceStatus")
    .alias("myServices")
    .description("Shows status + endpoints of YOUR on-demand service(s)")
    .argument("[serviceId]", "Service ID; omit to list all your services")
    .option("-s, --service <serviceId>", "Service ID")
    .option("-v, --verbose [boolean]", "Dump full job objects", toBoolean)
    .action(async (serviceId, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getServiceStatus(options.service || serviceId, options.verbose);
    });

  // getServices command (SERVICES_LIST — node-wide, all owners)
  program
    .command("getServices")
    .alias("listServices")
    .description(
      "Lists on-demand services across ALL owners on the node (docker spec hidden)"
    )
    .argument(
      "[node]",
      "Optional Ocean Node URL or peer id to query (defaults to NODE_URL)"
    )
    .option("-n, --node <node>", "Ocean Node URL or peer id to query")
    .option(
      "--status <status>",
      "Filter by a single service status number (e.g. 40 for Running)",
      parseInt
    )
    .option("--include-all [boolean]", "Include all statuses, not just active reservations", toBoolean)
    .option("--from <timestamp>", "Only services created at/after this time (ISO string or Unix timestamp)")
    .option("-v, --verbose [boolean]", "Dump full job objects", toBoolean)
    .action(async (node, options) => {
      if (
        options.status !== undefined &&
        ServiceStatusNumber[options.status] === undefined
      ) {
        console.error(
          chalk.red(
            `Unknown --status ${options.status}. Valid values: 10,11,12,13,14,15,20,30,40,50,70,75,99`
          )
        );
        return;
      }
      const filters: {
        status?: number;
        includeAllStatuses?: boolean;
        fromTimestamp?: string;
      } = {};
      if (options.status !== undefined) filters.status = options.status;
      if (options.includeAll !== undefined)
        filters.includeAllStatuses = options.includeAll;
      if (options.from !== undefined) filters.fromTimestamp = options.from;

      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getServices(options.node || node, filters, options.verbose);
    });

  // serviceLogs command (streamable logs)
  program
    .command("serviceLogs")
    .alias("computeServiceLogs")
    .description("Streams live logs from an on-demand service's container")
    .argument("<serviceId>", "Service ID")
    .option("-s, --service <serviceId>", "Service ID")
    .option(
      "--since <since>",
      "Only logs since this time — Unix seconds or a relative duration like 30s / 2h"
    )
    .action(async (serviceId, options) => {
      const id = options.service || serviceId;
      if (!id) {
        console.error(chalk.red("Missing required argument: <serviceId>"));
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.serviceLogs(id, options.since);
    });

  // extendService command
  program
    .command("extendService")
    .description("Extends a running on-demand service's expiry (paid via escrow)")
    .argument("<serviceId>", "Service ID")
    .argument("<additionalDuration>", "Additional duration in seconds", parseInt)
    .argument("[paymentToken]", "Payment token (defaults to the token used at start)")
    .option("-s, --service <serviceId>", "Service ID")
    .option("--duration <additionalDuration>", "Additional duration in seconds", parseInt)
    .option("-t, --token [paymentToken]", "Payment token")
    .option("--accept [boolean]", "Auto-confirm payment (true/false)", toBoolean)
    .action(async (serviceId, additionalDuration, paymentToken, options) => {
      const id = options.service || serviceId;
      const addl = options.duration || additionalDuration;
      const token = options.token || paymentToken;
      if (!id || !addl) {
        console.error(chalk.red("Missing required arguments: <serviceId> <additionalDuration>"));
        return;
      }
      if (!Number.isInteger(addl) || addl <= 0) {
        console.error(chalk.red("additionalDuration must be a positive integer number of seconds."));
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.extendService(id, addl, token, options.accept);
    });

  // restartService command
  program
    .command("restartService")
    .description(
      "Restarts a running service (same ports & expiry; no extra charge). " +
        "With no container-spec flags the container bounces unchanged (REUSE); " +
        "supplying any image-spec flag (--image/--tag/--checksum/--dockerfile/" +
        "--additional-docker-files) rebuilds it on the new spec (RESPEC, #2119)"
    )
    .argument("<serviceId>", "Service ID")
    .option("-u, --user-data <json>", "REPLACE stored container env vars (JSON object)")
    .option("--user-data-file <path>", "Path to JSON file with replacement env vars")
    .option("--cmd <json>", "REPLACE stored Docker CMD as JSON array (#2114); empty array clears it")
    .option("--entrypoint <json>", "REPLACE stored Docker ENTRYPOINT as JSON array (#2114)")
    .option("--image <image>", "RESPEC: rebuild on this container image (#2119)")
    .option("--tag <tag>", "RESPEC: rebuild on this image tag (#2119)")
    .option("--checksum <checksum>", "RESPEC: image digest/checksum (#2119)")
    .option("--dockerfile <dockerfile>", "RESPEC: dockerfile contents to build from (#2119)")
    .option(
      "--additional-docker-files <json>",
      "RESPEC: extra build files as a JSON object { path: contents } (#2119)"
    )
    .option("--wait [boolean]", "Poll until Running (default true)", toBoolean, true)
    .option("--timeout <seconds>", "Max seconds to wait (default 600)", parseInt)
    .action(async (serviceId, options) => {
      if (!serviceId) {
        console.error(chalk.red("Missing required argument: <serviceId>"));
        return;
      }
      const params: ServiceRestartParams = {};
      try {
        if (options.userData) {
          const parsed = JSON.parse(options.userData);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("--user-data must be a JSON object");
          }
          params.userData = parsed;
        } else if (options.userDataFile) {
          const parsed = JSON.parse(fs.readFileSync(options.userDataFile, "utf8"));
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("--user-data-file must contain a JSON object");
          }
          params.userData = parsed;
        }
        if (options.cmd !== undefined)
          params.dockerCmd = parseJsonStringArray("--cmd", options.cmd);
        if (options.entrypoint !== undefined)
          params.dockerEntrypoint = parseJsonStringArray("--entrypoint", options.entrypoint);
        if (options.image !== undefined) params.image = options.image;
        if (options.tag !== undefined) params.tag = options.tag;
        if (options.checksum !== undefined) params.checksum = options.checksum;
        if (options.dockerfile !== undefined) params.dockerfile = options.dockerfile;
        if (options.additionalDockerFiles !== undefined) {
          const parsed = JSON.parse(options.additionalDockerFiles);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("--additional-docker-files must be a JSON object");
          }
          params.additionalDockerFiles = parsed;
        }
      } catch (e) {
        console.error(chalk.red((e as Error).message));
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.restartService(
        serviceId,
        Object.keys(params).length > 0 ? params : undefined,
        options.wait,
        options.timeout
      );
    });

  // stopService command
  program
    .command("stopService")
    .description("Stops an on-demand service and releases its resources")
    .argument("<serviceId>", "Service ID")
    .option("-s, --service <serviceId>", "Service ID")
    .action(async (serviceId, options) => {
      const id = options.service || serviceId;
      if (!id) {
        console.error(chalk.red("Missing required argument: <serviceId>"));
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.stopService(id);
    });

  // mintOcean command
  program
    .command("mintOcean")
    .description("Mints Ocean tokens")
    .action(async () => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.mintOceanTokens();
    });

  // Generate new auth token
  program
    .command("generateAuthToken")
    .description("Generate new auth token")
    .action(async () => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.generateAuthToken();
    });

  // Invalidate auth token
  program
    .command("invalidateAuthToken")
    .description("Invalidate auth token")
    .argument("<token>", "Auth token")
    .option("-t, --token <token>", "Auth token")
    .action(async (token, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.invalidateAuthToken([token || options.token]);
    });

  // Escrow deposit command
  program
    .command("depositEscrow")
    .description("Deposit tokens into the escrow contract")
    .argument("<token>", "Address of the token to deposit")
    .argument("<amount>", "Amount of tokens to deposit")
    .option("-t, --token <token>", "Address of the token to deposit")
    .option("-a, --amount <amount>", "Amount of tokens to deposit")
    .action(async (token, amount, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const tokenAddress = options.token || token;
      const amountToDeposit = options.amount || amount;
      const success = await commands.depositToEscrow(
        signer,
        tokenAddress,
        amountToDeposit,
        chainId
      );
      if (!success) {
        console.log(chalk.red("Deposit failed"));
        return;
      }

      console.log(chalk.green("Deposit successful"));
    });

  // Check escrow deposited balance
  program
    .command("getUserFundsEscrow")
    .description("Get deposited token amount in escrow for user")
    .argument("<token>", "Address of the token to check")
    .option("-t, --token <token>", "Address of the token to check")
    .action(async (token, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getEscrowBalance(token || options.token);
    });

  // Withdraw from escrow
  program
    .command("withdrawFromEscrow")
    .description("Withdraw tokens from escrow")
    .argument("<token>", "Address of the token to check")
    .argument("<amount>", "Amount of tokens to withdraw")
    .option("-t, --token <token>", "Address of the token to check")
    .option("-a, --amount <amount>", "Amount of tokens to withdraw")
    .action(async (token, amount, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.withdrawFromEscrow(token || options.token, amount);
    });

  // Escrow authorization command
  program
    .command("authorizeEscrow")
    .description("Authorize a payee to lock and claim funds from escrow")
    .argument("<token>", "Address of the token to authorize")
    .argument("<payee>", "Address of the payee to authorize")
    .argument("<maxLockedAmount>", "Maximum amount that can be locked by payee")
    .argument("<maxLockSeconds>", "Maximum lock duration in seconds")
    .argument("<maxLockCounts>", "Maximum number of locks allowed")
    .option("-t, --token <token>", "Address of the token to authorize")
    .option("-p, --payee <payee>", "Address of the payee to authorize")
    .option(
      "-m, --maxLockedAmount <maxLockedAmount>",
      "Maximum amount that can be locked by payee"
    )
    .option(
      "-s, --maxLockSeconds <maxLockSeconds>",
      "Maximum lock duration in seconds"
    )
    .option(
      "-c, --maxLockCounts <maxLockCounts>",
      "Maximum number of locks allowed"
    )
    .action(
      async (
        token,
        payee,
        maxLockedAmount,
        maxLockSeconds,
        maxLockCounts,
        options
      ) => {
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
          maxLockCountsValue
        );

        if (!success) {
          console.log(chalk.red("Authorization failed"));
          return;
        }

        console.log(chalk.green("Authorization successful"));
      }
    );

  program
    .command("getAuthorizationsEscrow")
    .description("Get authorizations for escrow")
    .argument("<token>", "Address of the token to check")
    .argument("<payee>", "Address of the payee to check")
    .option("-t, --token <token>", "Address of the token to check")
    .option("-p, --payee <payee>", "Address of the payee to check")
    .action(async (token, payee, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getAuthorizationsEscrow(
        token || options.token,
        payee || options.payee
      );
    });

  program
    .command("createAccessList")
    .description("Create a new access list contract")
    .argument("<name>", "Name for the access list")
    .argument("<symbol>", "Symbol for the access list")
    .argument(
      "[initialUsers]",
      "Comma-separated list of initial user addresses",
      ""
    )
    .argument(
      "[transferable]",
      "Whether tokens are transferable (true/false)",
      "false"
    )
    .option("-n, --name <name>", "Name for the access list")
    .option("-s, --symbol <symbol>", "Symbol for the access list")
    .option(
      "-u, --initial-users [initialUsers]",
      "Comma-separated list of initial user addresses",
      ""
    )
    .option(
      "-t, --transferable [transferable]",
      "Whether tokens are transferable (true/false)",
      "false"
    )
    .action(async (name, symbol, initialUsers, transferable, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.createAccessList([
        options.name || name,
        options.symbol || symbol,
        options.transferable || transferable,
        options.initialUsers || initialUsers,
      ]);
    });

  program
    .command("addToAccessList")
    .description("Add user(s) to an access list")
    .argument("<accessListAddress>", "Address of the access list contract")
    .argument("<users>", "Comma-separated list of user addresses to add")
    .option(
      "-a, --address <accessListAddress>",
      "Address of the access list contract"
    )
    .option(
      "-u, --users <users>",
      "Comma-separated list of user addresses to add"
    )
    .action(async (accessListAddress, users, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.addToAccessList([
        options.address || accessListAddress,
        options.users || users,
      ]);
    });

  program
    .command("checkAccessList")
    .description("Check if user(s) are on an access list")
    .argument("<accessListAddress>", "Address of the access list contract")
    .argument("<users>", "Comma-separated list of user addresses to check")
    .option(
      "-a, --address <accessListAddress>",
      "Address of the access list contract"
    )
    .option(
      "-u, --users <users>",
      "Comma-separated list of user addresses to check"
    )
    .action(async (accessListAddress, users, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.checkAccessList([
        options.address || accessListAddress,
        options.users || users,
      ]);
    });

  program
    .command("removeFromAccessList")
    .description("Remove user(s) from an access list")
    .argument("<accessListAddress>", "Address of the access list contract")
    .argument("<users>", "Comma-separated list of user addresses to remove")
    .option(
      "-a, --address <accessListAddress>",
      "Address of the access list contract"
    )
    .option(
      "-u, --users <users>",
      "Comma-separated list of user addresses to remove"
    )
    .action(async (accessListAddress, users, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.removeFromAccessList([
        options.address || accessListAddress,
        options.users || users,
      ]);
    });

  program
    .command("downloadNodeLogs")
    .description("Download logs from a node as an admin")
    .argument("<output>", "Output directory to save the logs")
    .argument(
      "[last]",
      "Period of time to get logs from now (in hours). Use either last or from-to"
    )
    .argument("[from]", "Start time (epoch ms) to get logs from")
    .argument("[to]", "End time (epoch ms) to get logs to")
    .argument(
      "[maxLogs]",
      "Maximum number of logs to retrieve (default: 100, max: 1000)"
    )
    .option("-o, --output <output>", "Output directory to save the logs")
    .option(
      "-l, --last [last]",
      "Period of time to get logs from now (in hours)"
    )
    .option("-f, --from [from]", "Start time (epoch ms) to get logs from")
    .option("-t, --to [to]", "End time (epoch ms) to get logs to")
    .option(
      "-m, --maxLogs [maxLogs]",
      "Maximum number of logs to retrieve (default: 100, max: 1000)"
    )
    .action(async (output, last, from, to, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.downloadNodeLogs([
        options.output || output,
        options.last || last,
        options.from || from,
        options.to || to,
        options.maxLogs,
      ]);
    });

  program
    .command("createBucket")
    .description("Create a new persistent-storage bucket. Pass an access list to gate it; omit for owner-only access (chain inferred from RPC)")
    .argument("[accessListAddress]", "Access list contract address (0x…); omit for owner-only access")
    .action(async (accessListAddress) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.createBucket([null, accessListAddress]);
    });

  program
    .command("addFileToBucket")
    .description("Upload a local file into a bucket")
    .argument("<bucketId>", "Bucket id")
    .argument("<filePath>", "Path to local file")
    .argument("[fileName]", "Name under which to store the file (defaults to basename)")
    .action(async (bucketId, filePath, fileName) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.addFileToBucket([null, bucketId, filePath, fileName]);
    });

  program
    .command("listBuckets")
    .description("List buckets owned by an address (defaults to signer)")
    .option("-o, --owner <address>", "Owner address")
    .action(async (options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.listBuckets([null, options.owner]);
    });

  program
    .command("listFilesInBucket")
    .description("List files in a bucket")
    .argument("<bucketId>", "Bucket id")
    .action(async (bucketId) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.listFilesInBucket([null, bucketId]);
    });

  program
    .command("getFileObject")
    .description("Get the file-object descriptor for a file in a bucket")
    .argument("<bucketId>", "Bucket id")
    .argument("<fileName>", "File name")
    .action(async (bucketId, fileName) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getFileObject([null, bucketId, fileName]);
    });

  program
    .command("deleteFile")
    .description("Delete a file from a bucket")
    .argument("<bucketId>", "Bucket id")
    .argument("<fileName>", "File name")
    .action(async (bucketId, fileName) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.deleteFile([null, bucketId, fileName]);
    });

  return program;
}
