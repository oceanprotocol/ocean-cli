import { expect } from "chai";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import util from "util";
import { homedir } from 'os'

import { dirname } from 'path'
import { fileURLToPath } from 'url'
import {
	ProviderInstance
} from "@oceanprotocol/lib";

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = path.resolve(__dirname, "..");
export const runCommand = async (command: string): Promise<string> => {
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

describe("Ocean CLI Compute", function() {
    this.timeout(600000); // Set a longer timeout to allow the command to execute

    let computeDatasetDid: string;
    let jsAlgoDid: string;
    let computeEnvId: string;
    let resources: any;
    let providerInitializeResponse: any
    let computeJobId: string

    const getAddresses = () => {
        const data = JSON.parse(
            fs.readFileSync(
            process.env.ADDRESS_FILE ||
                `${homedir}/.ocean/ocean-contracts/artifacts/address.json`,
            'utf8'
            )
        )
        return data.development
    };

    it("should publish a compute dataset using 'npm run cli publish'", async function() {
        const metadataFile = path.resolve(projectRoot, "metadata/simpleComputeDataset.json");
        // Ensure the metadata file exists
        if (!fs.existsSync(metadataFile)) {
            throw new Error("Metadata file not found: " + metadataFile);
        }

        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        // Using this account: 0x529043886F21D9bc1AE0feDb751e34265a246e47
        process.env.RPC = "http://127.0.0.1:8545";
        process.env.NODE_URL = "http://127.0.0.1:8001";
        process.env.ADDRESS_FILE = path.join(process.env.HOME || "", ".ocean/ocean-contracts/artifacts/address.json");

        const output = await runCommand(`npm run cli publish ${metadataFile}`);

		const jsonMatch = output.match(/did:op:[a-f0-9]{64}/);
        if (!jsonMatch) {
			console.error("Raw output:", output);
			throw new Error("Could not find compute environments in the output");
		}

		try {
			computeDatasetDid = jsonMatch[0];
		} catch (error) {
			console.error("Extracted output:", jsonMatch[0]);
			throw new Error("Failed to parse the extracted output:\n" + error);
		}
    });

    it("should publish a js Algorithm using 'npm run cli publishAlgo'", async function() {
        const filePath = path.resolve(projectRoot, "metadata/jsAlgo.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(filePath)) {
            throw new Error("Metadata file not found: " + filePath);
        }

        const output = await runCommand(`npm run cli publishAlgo ${filePath}`);

		const jsonMatch = output.match(/did:op:[a-f0-9]{64}/);
		if (!jsonMatch) {
			console.error("Raw output:", output);
			throw new Error("Could not find compute environments in the output");
		}

        try {
			jsAlgoDid = jsonMatch[0];
		} catch (error) {
			console.error("Extracted output:", jsonMatch[0]);
			throw new Error("Failed to parse the extracted output:\n" + error);
		}
    });

    it("should get DDO using 'npm run cli getDDO' for compute dataset", async function() {
        const output = await runCommand(`npm run cli getDDO ${computeDatasetDid}`);

		const jsonMatch = output.match(/s*([\s\S]*)/);
		if (!jsonMatch) {
			console.error("Raw output:", output);
			throw new Error("Could not find compute environments in the output");
		}

        try {
            expect(output).to.contain(`Resolving Asset with DID: ${computeDatasetDid}`)
		} catch (error) {
			console.error("Extracted output:", jsonMatch[0]);
			throw new Error("Failed to parse the extracted output:\n" + error);
		}
    });

    it("should get DDO using 'npm run cli getDDO' for JS algorithm", async function() {
        const output = await runCommand(`npm run cli getDDO ${jsAlgoDid}`);

		const jsonMatch = output.match(/s*([\s\S]*)/);
		if (!jsonMatch) {
			console.error("Raw output:", output);
			throw new Error("Could not find compute environments in the output");
		}

        try {
			expect(output).to.contain(`Resolving Asset with DID: ${jsAlgoDid}`)
		} catch (error) {
			console.error("Extracted output:", jsonMatch[0]);
			throw new Error("Failed to parse the extracted output:\n" + error);
		}
    });

     it("should get compute environments using 'npm run cli getComputeEnvironments'", async function() {
        const output = await runCommand(`npm run cli getComputeEnvironments`);

		const jsonMatch = output.match(/Exiting compute environments:\s*([\s\S]*)/);
		if (!jsonMatch) {
			console.error("Raw output:", output);
			throw new Error("Could not find compute environments in the output");
		}
        const match = jsonMatch[0].match(/Exiting compute environments:\s*(.*)/s);
        const result = match ? match[1].trim() : null;
        if (!result) {
			console.error("Raw output:", output);
			throw new Error("Could not find compute environments in the output");
		}

		let environments;
		try {
			environments = eval(result);
		} catch (error) {
			console.error(`Extracted output: ${jsonMatch[0]} and final result: ${result}`);
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

    it("should initialize compute on compute dataset and algorithm", async function() {
        const computeEnvs = await ProviderInstance.getComputeEnvironments('http://127.0.0.1:8001');
        const env = computeEnvs[0];
        expect(env).to.be.an('object').and.to.not.be.null.and.to.not.be.undefined;

        console.log(`env: ${JSON.stringify(env)}`)
        resources = [
            {
                id: 'cpu',
                amount: env.resources[0].max - env.resources[0].inUse - 1 
            },
            {
                id: 'ram',
                amount: env.resources[1].max - env.resources[1].inUse - 1000
            },
            {
                id: 'disk',
                amount: 0
            }
        ]
        console.log(`resources: ${JSON.stringify(resources)}`)
        const paymentToken = getAddresses().Ocean
        const escrow = getAddresses().Escrow;
        const output = await runCommand(`npm run cli initializeCompute ${computeDatasetDid} ${jsAlgoDid} ${computeEnvId} 900 ${paymentToken} ${JSON.stringify(resources)}`);
        const jsonMatch = output.match(/initialize compute details:\s*([\s\S]*)/);
		if (!jsonMatch) {
			console.error("Raw output:", output);
			throw new Error("Could not find initialize response in the output");
		}
        const result = jsonMatch[0].split('initialize compute details:')[1]?.trim();
		try {
			providerInitializeResponse = JSON.parse(result);
		} catch (error) {
			console.error(`Extracted output: ${jsonMatch[0]} and final result: ${result}`);
			throw new Error("Failed to parse the extracted output:\n" + error);
		}
        expect(providerInitializeResponse).to.have.property("payment").that.is.an("object");
        expect(providerInitializeResponse.payment).to.have.property("escrowAddress").that.is.a("string").and.that.is.eq(escrow);
        expect(providerInitializeResponse.payment).to.have.property("token").that.is.a("string").and.that.is.eq(paymentToken);
        expect(providerInitializeResponse.payment).to.have.property("amount").that.is.a("string");
        expect(providerInitializeResponse).to.have.property("algorithm").that.is.an("object");
        expect(providerInitializeResponse.algorithm).to.have.property("providerFee").that.is.an("object");
        expect(providerInitializeResponse.algorithm.providerFee).to.have.property("providerFeeAddress").that.is.a("string");
        expect(providerInitializeResponse.algorithm.providerFee).to.have.property("providerFeeToken").that.is.a("string").and.that.is.eq(paymentToken);
        expect(providerInitializeResponse.algorithm.providerFee).to.have.property("providerFeeAmount").that.is.a("string").and.that.is.eq('0');
        expect(providerInitializeResponse.algorithm.providerFee).to.have.property("providerData").that.is.a("string");
        expect(providerInitializeResponse).to.have.property("datasets").that.is.an("array");
        expect(providerInitializeResponse.datasets[0]).to.have.property("providerFee").that.is.an("object");
        expect(providerInitializeResponse.datasets[0].providerFee).to.have.property("providerFeeAddress").that.is.a("string");
        expect(providerInitializeResponse.datasets[0].providerFee).to.have.property("providerFeeToken").that.is.a("string").and.that.is.eq(paymentToken);
        expect(providerInitializeResponse.datasets[0].providerFee).to.have.property("providerFeeAmount").that.is.a("string").and.that.is.eq('0');
        expect(providerInitializeResponse.datasets[0].providerFee).to.have.property("providerData").that.is.a("string");

    });

    it("should start paid compute on compute dataset and algorithm", async function() {
        const paymentToken = getAddresses().Ocean
        const output = await runCommand(`npm run cli startCompute ${computeDatasetDid} ${jsAlgoDid} ${computeEnvId} ${JSON.stringify(providerInitializeResponse)} 900 ${paymentToken} ${JSON.stringify(resources)} ${providerInitializeResponse.payment.amount}`);
        const jsonMatch = output.match(/JobID:\s*([\s\S]*)/);
		if (!jsonMatch) {
			console.error("Raw output:", output);
			throw new Error("Could not find start compute response in the output");
		}
        const result = jsonMatch[0].split('JobID:')[1]?.trim();
        if (!result) {
			console.error("Raw output:", output);
			throw new Error("Could not find compute job in the output");
		}
        computeJobId = result
        expect(computeJobId).to.be.a("string");
    });
    
});
