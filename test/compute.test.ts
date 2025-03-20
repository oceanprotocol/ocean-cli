import { expect } from "chai";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import util from "util";

const execPromise = util.promisify(exec);

describe("Ocean CLI Compute Flow", function () {
	this.timeout(300000); // 5 min timeout

	const projectRoot = path.resolve(__dirname, "..");

	let computeDatasetDid: string;
	let algoDid: string;
	const computeEnvId: string = "1";
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
		process.env.PRIVATE_KEY = "0xYOUR_PRIVATE_KEY";
		process.env.RPC = "http://127.0.0.1:8545";
		process.env.AQUARIUS_URL = "http://127.0.0.1:5000";
		process.env.PROVIDER_URL = "http://127.0.0.1:8030";
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

	it("should start a compute job", async () => {
		const output = await runCommand(
			`npm run cli startCompute -- --datasets ${computeDatasetDid} --algo ${algoDid} --env ${computeEnvId}`
		);

		const jobIdMatch = output.match(
			/Job started successfully with ID: ([a-f0-9-]+)/i
		);
		expect(jobIdMatch, "No Job ID found in output").to.not.be.null;

		jobId = jobIdMatch![1];
		console.log(`Started Compute Job ID: ${jobId}`);
	});

	it("should get the job status", async () => {
		const output = await runCommand(
			`npm run cli getJobStatus -- --dataset ${computeDatasetDid} --job ${jobId}`
		);

		expect(output).to.contain(jobId);
		expect(output).to.match(/status/i);
		console.log(`Job status output received for jobId: ${jobId}`);
	});

	it("should stop the compute job", async () => {
		const output = await runCommand(
			`npm run cli stopCompute -- --dataset ${computeDatasetDid} --job ${jobId}`
		);

		expect(output).to.contain("Compute job stopped successfully");
		console.log(`Stopped Compute Job ID: ${jobId}`);
	});
});
