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

		const jsonMatch = output.match(/Exiting compute environments:\s*([\s\S]*)/);
		if (!jsonMatch) {
			console.error("Raw output:", output);
			throw new Error("Could not find compute environments in the output");
		}

		let environments;
		try {
			environments = eval(`(${jsonMatch[1]})`);
		} catch (error) {
			console.error("Extracted output:", jsonMatch[1]);
			throw new Error("Failed to parse the extracted output:\n" + error);
		}

		expect(environments).to.be.an("array").that.is.not.empty;

		const firstEnv = environments[0];

		expect(firstEnv).to.have.property("id").that.is.a("string");
		expect(firstEnv).to.have.property("consumerAddress").that.is.a("string");
		expect(firstEnv).to.have.property("resources").that.is.an("array");

		computeEnvId = firstEnv.id;
		console.log(`Fetched Compute Env ID: ${computeEnvId}`);
	});

	it("should start a free compute job", async () => {
		const output = await runCommand(
			`npm run cli startFreeCompute --datasets ${computeDatasetDid} --algo ${algoDid} --env ${computeEnvId}`
		);

		const jobIdMatch = output.match(
			/Compute started\.\s+JobID:\s+(0x[a-f0-9-]+)/i
		);
		expect(jobIdMatch, "No Job ID found in output").to.not.be.null;

		jobId = jobIdMatch![1];
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
