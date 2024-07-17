import { ethers } from "ethers";
import { Commands } from "./commands";

if (!process.env.MNEMONIC && !process.env.PRIVATE_KEY) {
	console.error("Have you forgot to set MNEMONIC or PRIVATE_KEY?");
	process.exit(0);
}
if (!process.env.RPC) {
	console.error("Have you forgot to set env RPC?");
	process.exit(0);
}

function help() {
	console.log("Available options:");

	console.log("\t getDDO DID - gets DDO for an asset using the asset did");

	console.log(
		"\t publish METADATA_FILE ENCRYPT_DDO - reads MEDATDATA_FILE and publishes a new asset with access service or compute service, if boolean ENCRYPT_DDO is false publishes DDO without encrypting. "
	);
	console.log(
		"\t publishAlgo METADATA_FILE ENCRYPT_DDO - reads MEDATDATA_FILE and publishes a new algo, if boolean ENCRYPT_DDO is false publishes DDO without encrypting. "
	);

	console.log(
		"\t editAsset DATASET_DID UPDATED_METADATA_FILE ENCRYPT_DDO- updates DDO using the metadata items in the file, if boolean ENCRYPT_DDO is false publishes DDO without encrypting."
	);

	console.log(
		"\t addService DATASET_DID SERVICE_FILE PRICE - adds a new service to the dataset, reads the service file, creates a datatoken and pricing."
	);

	console.log(
		"\t download DID DESTINATION_FOLDER - downloads an asset into downloads/DESTINATION_FOLDER"
	);
	console.log(
		"\t allowAlgo DATASET_DID ALGO_DID ENCRYPT_DDO - approves an algorithm to run on a dataset, if boolean ENCRYPT_DDO is false publishes DDO without encrypting."
	);
	console.log(
		"\t disallowAlgo DATASET_DID ALGO_DID ENCRYPT_DDO- removes an approved algorithm from the dataset approved algos, if boolean ENCRYPT_DDO is false publishes DDO without encrypting."
	);
	console.log(
		"\t startCompute [DATASET_DIDs] ALGO_DID COMPUTE_ENV_ID - starts a compute job on the selected compute environment with the datasets and the inputed algorithm. Pass the DATASET_DIDs separated by comma"
	);

	console.log(
		"\t stopCompute DATASET_DID JOB_ID - stops the compute process for the mentioned dataset with the given job id! "
	);

	console.log(
		"\t getJobStatus DATASET_DID JOB_ID - displays the compute job compute status."
	);

	console.log(
		"\t getJobResults DATASET_DID JOB_ID - displays the array containing compute results and logs files."
	);

	console.log(
		"\t downloadJobResults JOB_ID RESULT_INDEX DESTINATION_FOLDER - Downloads compute job results."
	);
}

async function start() {
	const provider = new ethers.providers.JsonRpcProvider(process.env.RPC);
	console.log("Using RPC: " + process.env.RPC);
	let signer;
	if (process.env.PRIVATE_KEY)
		signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
	else {
		signer = ethers.Wallet.fromMnemonic(process.env.MNEMONIC);
		signer = await signer.connect(provider);
	}
	console.log("Using account: " + (await signer.getAddress()));

	const { chainId } = await signer.provider.getNetwork();
	const commands = new Commands(signer, chainId);
	const myArgs = process.argv.slice(2);
	switch (myArgs[0]) {
		case "getDDO":
			await commands.getDDO(myArgs);
			break;
		case "publish":
			await commands.publish(myArgs);
			break;
		case "publishAlgo":
			await commands.publishAlgo(myArgs);
			break;
		case "edit":
			await commands.editAsset(myArgs);
			break;
		case "addService":
			await commands.addService(myArgs);
			break;
		case "download":
			await commands.download(myArgs);
			break;
		case "allowAlgo":
			await commands.allowAlgo(myArgs);
			break;
		case "disallowAlgo":
			await commands.disallowAlgo(myArgs);
			break;
		case "startCompute":
			await commands.computeStart(myArgs);
			break;
		case "stopCompute":
			await commands.computeStop(myArgs);
			break;
		case "getJobStatus":
			await commands.getJobStatus(myArgs);
			break;
			break;
		case "downloadJobResults":
			await commands.downloadJobResults(myArgs);
			break;
		case "mintOcean":
			await commands.mintOceanTokens();
			break;
		case "h":
			help();
			break;
		default:
			console.error("Not sure what command to use ? use h for help.");
			break;
	}
	process.exit(0);
}

start();
