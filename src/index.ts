import { ethers } from "ethers";
import { Commands } from "./commands";

if (!process.env.MNEMONIC) {
	console.error("Have you forgot to set env MNEMONIC?");
	process.exit(0);
}
if (!process.env.RPC) {
	console.error("Have you forgot to set env RPC?");
	process.exit(0);
}

function help() {
	console.log("Available options:");
	console.log(
		"\t publish  METADATA_FILE - reads MEDATDATA_FILE and publishes a new asset with access service or compute service"
	);
	console.log(
		"\t publishAlgo  METADATA_FILE - reads MEDATDATA_FILE and publishes a new algo"
	);
	console.log("\t getDDO DID - gets DDO for an asset using the asset did");
	console.log(
		"\t download DID DESTINATION_FOLDER - downloads an asset into downloads/DESTINATION_FOLDER"
	);
	console.log(
		"\t allowAlgo DATASET_DID ALGO_DID - approves an algorithm to run on a dataset"
	);
	console.log(
		"\t disallowAlgo DATASET_DID ALGO_DID - removes an approved algorithm from the dataset approved algos"
	);
	console.log(
		"\t startCompute DATASET_DID ALGO_DID - starts a compute job on the mentioned dataset using the inputed algorithm's id"
	);

	console.log(
		"\t stopCompute JOB_ID - stops the compute process for the given job id! "
	);

	console.log("\t getCompute JOB_ID - gets a compute status.");
	console.log(
		"\t editAsset DATASET_DID UPDATED_METADATA_FILE - updates DDO using the metadata items in the file."
	);
}

async function start() {
	const provider = new ethers.providers.JsonRpcProvider(process.env.RPC);
	const signer = new ethers.Wallet(process.env.MNEMONIC, provider);

	console.log("Using account: " + (await signer.getAddress()));

	const { chainId } = await signer.provider.getNetwork();
	const commands = new Commands(signer, chainId);
	const myArgs = process.argv.slice(2);
	switch (myArgs[0]) {
		case "publish":
			await commands.publish(myArgs);
			break;
		case "publishAlgo":
			await commands.publishAlgo(myArgs);
			break;
		case "getDDO":
			await commands.getDDO(myArgs);
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
			await commands.compute(myArgs);
			break;
		case "getCompute":
			await commands.getCompute(myArgs);
			break;
		case "edit":
			await commands.editAsset(myArgs);
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
