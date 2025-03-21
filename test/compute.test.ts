import { expect } from "chai";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import util from "util";

import { dirname } from "path";
import { fileURLToPath } from "url";

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function sleep(ms: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
describe("Ocean CLI Free Compute Flow", function () {
	this.timeout(300000);

	const projectRoot = path.resolve(__dirname, "..");

	let computeDatasetDid: string;
	let algoDid: string;
	let computeEnvId: string;
	let jobId: string;

	const runCommand = async (command: string): Promise<string> => {
		console.log(`\n[CMD]: ${command}`);
		try {
			const { stdout } = await execPromise(command, { cwd: projectRoot });
			console.log(`[OUTPUT]:\n${stdout}`);
			return stdout;
		} catch (error: any) {
			console.error(`[ERROR]:\n${error.stderr || error.message}`);
			throw error;
		}
	};

	before(async () => {
		process.env.PRIVATE_KEY =
			"0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
		process.env.RPC = "http://127.0.0.1:8545";
		// process.env.AQUARIUS_URL = "http://127.0.0.1:5000";
		// process.env.PROVIDER_URL = "http://127.0.0.1:8030";
		process.env.ADDRESS_FILE = path.join(
			process.env.HOME || "",
			".ocean/ocean-contracts/artifacts/address.json"
		);
		console.log("Starting compute tests ... ");
	});

	it("should publish a compute dataset", async () => {
		const metadataFile = path.resolve(
			projectRoot,
			"metadata/simpleComputeDataset.json"
		);

		if (!fs.existsSync(metadataFile)) {
			throw new Error(`Metadata file not found: ${metadataFile}`);
		}

		const output = await runCommand(`npm run cli publish ${metadataFile}`);

		const didMatch = output.match(/did:op:[a-f0-9]{64}/);
		expect(didMatch, "No DID found in output").to.not.be.null;

		computeDatasetDid = didMatch![0];
		console.log(`Published Compute Dataset DID: ${computeDatasetDid}`);
	});

	it("should publish an algorithm", async () => {
		const algoFile = path.resolve(projectRoot, "metadata/jsAlgo.json");

		if (!fs.existsSync(algoFile)) {
			throw new Error(`Algorithm metadata file not found: ${algoFile}`);
		}

		const output = await runCommand(`npm run cli publishAlgo ${algoFile}`);

		const didMatch = output.match(/did:op:[a-f0-9]{64}/);
		expect(didMatch, "No DID found in output").to.not.be.null;

		algoDid = didMatch![0];
		console.log(`Published Algorithm DID: ${algoDid}`);
	});

	it("should get compute environments", async () => {
		const output = await runCommand(`npm run cli getComputeEnvironments`);

		expect(output).to.contain("id");

		const indexOfArray = output.indexOf('[')
		console.log('output ', output)
		const cleaned = `${output.substring(indexOfArray).trim()}`

		const validJsonString = cleaned
		.replace(/'/g, '"')
		.replace(/\[Object\]/g, '{}')
		.replace(/\[Array\]/g, '[]')
		.replace(/[\r\n]+/g, '')
		.replace(/\+/g, '')
		.replace(/\s+/g, '')
		.replace(/([{,])\s*(\w+)(?=\s*:)/g, '$1"$2"');  // Add quotes around unquoted keys
		
		try {

			const environments = JSON.parse(validJsonString)
			console.log('environments ', environments)
			if(environments.length > 0) {
				for(let i = 0; i< environments.length; i++) {
					const env =  environments[i]
					console.log('environment: ', env)
					if(env.free) {
						computeEnvId = env.id
						console.log(`Fetched Compute Env ID: ${computeEnvId}`);
						break
					}
				}
			}
			expect(environments.length > 0, 'No compute environments were found')
			expect(computeEnvId, 'No free C2D environment found').to.not.be.null;
		} catch(err) {
			console.error('Unable to get compute environments')
		}
		
	});

	it("should start a free compute job", async () => {

		await sleep(9000) // wait a bit, ideally wait to index

		const output = await runCommand(
			`npm run cli startFreeCompute --datasets ${computeDatasetDid} --algo ${algoDid} --env ${computeEnvId}`
		);

		const jobIdMatch = output.match(
			/Compute started. JobID: ([a-f0-9-]+)/i
		);
		expect(jobIdMatch, "No Job ID found in output").to.not.be.null;

		const jobText = output.indexOf('Compute started. JobID:')
		const important = output.substring(jobText)
		jobId = important.replace('Compute started. JobID: ','')
		console.log(`Started Free Compute Job ID: ${jobId}`);
	});

	it("should get job status", async () => {
		const output = await runCommand(
			`npm run cli getJobStatus --dataset ${computeDatasetDid} --job ${jobId}`
		);

		expect(output).to.contain(jobId);
		expect(output.toLowerCase()).to.match(/status/);
		console.log(`Job status retrieved for jobId: ${jobId}`);
	});

	it("should fetch streamable logs", async () => {
		const output = await runCommand(
			`npm run cli computeStreamableLogs --job ${jobId}`
		);

		expect(output).to.contain(jobId);
		console.log(`Streamable logs retrieved for jobId: ${jobId}`);
	});

	it("should stop the compute job", async () => {
		const output = await runCommand(
			`npm run cli stopCompute --dataset ${computeDatasetDid} --job ${jobId}`
		);

		expect(output).to.contain("Compute job stopped successfully");
		console.log(`Stopped compute job with ID: ${jobId}`);
	});
});
