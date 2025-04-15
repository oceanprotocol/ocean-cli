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

	const waitForJobCompletion = async (
		datasetDid,
		jobId,
		maxWaitMs = 120000,
		pollIntervalMs = 5000
	) => {
		const start = Date.now();
		while (Date.now() - start < maxWaitMs) {
			const output = await runCommand(
				`npm run cli getJobStatus --dataset ${datasetDid} --job ${jobId}`
			);
			console.log(`Job status cmd output : ${output}`);

			const jsonMatch = output.match(/\[\s*{[\s\S]*}\s*\]/);
			if (!jsonMatch) {
				console.warn("Could not find JSON array in output, will retry...");
				await new Promise((res) => setTimeout(res, pollIntervalMs));
				continue;
			}

			let jobs;
			try {
				const jsonStr = jsonMatch[0]
					.replace(/([{,]\s*)'([^']+?)'\s*:/g, '$1"$2":')
					.replace(/:\s*'([^']*?)'/g, ': "$1"');

				jobs = JSON.parse(jsonStr);
			} catch (e) {
				console.warn("Failed to parse job status JSON, will retry...");
				await new Promise((res) => setTimeout(res, pollIntervalMs));
				continue;
			}

			if (Array.isArray(jobs) && jobs.length > 0) {
				const job = jobs[0];
				if (
					(typeof job.statusText === "string" &&
						job.statusText.toLowerCase().includes("finished")) ||
					job.status === 70
				) {
					console.log("Job is finished!");
					return job;
				}
			}

			await new Promise((res) => setTimeout(res, pollIntervalMs));
		}
		throw new Error(
			`Job ${jobId} did not finish within ${maxWaitMs / 1000} seconds`
		);
	};
	it("should download compute job results", async () => {
		const job = await waitForJobCompletion(
			computeDatasetDid,
			jobId,
			180000,
			7000
		);
		console.log("Job details:", job);

		const destFolder = path.join(projectRoot, "test-results", jobId);
		fs.mkdirSync(destFolder, { recursive: true });

		const output = await runCommand(
			`npm run cli downloadJobResults ${jobId} 1 ${destFolder}`
		);

		expect(output.toLowerCase()).to.match(/download(ed)?/);

		// const files = fs.readdirSync(destFolder);
		// expect(files.length).to.be.greaterThan(0, "No result files downloaded");
		// console.log(`Downloaded results to: ${destFolder}`);
	});
});
