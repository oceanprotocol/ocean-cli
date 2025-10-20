import { expect } from "chai";
import path from "path";
import fs from "fs";
import { homedir } from 'os'
import {
    ProviderInstance
} from "@oceanprotocol/lib";
import { projectRoot, runCommand } from "./util.js";



describe("Ocean CLI Paid Compute", function () {
    this.timeout(600000); // Set a longer timeout to allow the command to execute

    let computeDatasetDid: string;
    let jsAlgoDid: string;
    let computeEnvId: string;
    let resources: any;
    let computeJobId: string;
    let agreementId: string;

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

    it("should publish a compute dataset using 'npm run cli publish'", async function () {
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
            throw new Error("Could not find compute dataset did in the output");
        }

        try {
            computeDatasetDid = jsonMatch[0];
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should publish a js Algorithm using 'npm run cli publishAlgo'", async function () {
        const filePath = path.resolve(projectRoot, "metadata/jsAlgo.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(filePath)) {
            throw new Error("Metadata file not found: " + filePath);
        }

        const output = await runCommand(`npm run cli publishAlgo ${filePath}`);

        const jsonMatch = output.match(/did:op:[a-f0-9]{64}/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find algo did in the output");
        }

        try {
            jsAlgoDid = jsonMatch[0];
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should get DDO using 'npm run cli getDDO' for compute dataset", async function () {
        const output = await runCommand(`npm run cli getDDO ${computeDatasetDid}`);

        const jsonMatch = output.match(/s*([\s\S]*)/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find ddo in the output");
        }

        try {
            expect(output).to.contain(`Resolving Asset with DID: ${computeDatasetDid}`)
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should get DDO using 'npm run cli getDDO' for JS algorithm", async function () {
        const output = await runCommand(`npm run cli getDDO ${jsAlgoDid}`);

        const jsonMatch = output.match(/s*([\s\S]*)/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find ddo in the output");
        }

        try {
            expect(output).to.contain(`Resolving Asset with DID: ${jsAlgoDid}`)
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should get compute environments using 'npm run cli getComputeEnvironments'", async function () {
        const output = await runCommand(`npm run cli getComputeEnvironments`);

        const jsonMatch = output.match(/Exiting compute environments:\s*([\s\S]*)/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find compute environments in the output");
        }

        let environments;
        try {
            environments = eval(jsonMatch[1]);
        } catch (error) {
            console.error(`Extracted output: ${jsonMatch[0]} and final result: ${jsonMatch[1]}`);
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

    it("should start paid compute on compute dataset and algorithm with services id for dataset and algorithm", async function () {
        const computeEnvs = await ProviderInstance.getComputeEnvironments('http://127.0.0.1:8001');
        const env = computeEnvs[0];
        expect(env).to.be.an('object').and.to.not.be.null.and.to.not.be.undefined;

        if (!env.resources || !Array.isArray(env.resources) || env.resources.length < 2) {
            throw new Error("Compute environment resources are not available or invalid.");
        }
        resources = [
            {
                id: 'cpu',
                amount: env.resources[0]?.max !== undefined && env.resources[0]?.inUse !== undefined
                    ? env.resources[0].max - env.resources[0].inUse - 1
                    : 0
            },
            {
                id: 'ram',
                amount: env.resources[1]?.max !== undefined && env.resources[1]?.inUse !== undefined
                    ? env.resources[1].max - env.resources[1].inUse - 1000
                    : 0
            },
            {
                id: 'disk',
                amount: 0
            }
        ]
        const paymentToken = getAddresses().Ocean
        const serviceIdDataset = 'ccb398c50d6abd5b456e8d7242bd856a1767a890b537c2f8c10ba8b8a10e6025'
        const serviceIdAlgorithm = 'db164c1b981e4d2974e90e61bda121512e6909c1035c908d68933ae4cfaba6b0'
        const output = await runCommand(`npm run cli -- startCompute ${computeDatasetDid} ${jsAlgoDid} ${computeEnvId} 900 ${paymentToken} '${JSON.stringify(resources)}' ${serviceIdDataset} ${serviceIdAlgorithm} --accept true`);
        const jobIdMatch = output.match(/JobID:\s*([^\s]+)/);
        const agreementIdMatch = output.match(/Agreement ID:\s*([^\s]+)/);

        if (!jobIdMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find Job ID in the output");
        }

        if (!agreementIdMatch) {
            console.error("Raw output for finding agreement:", output);
            throw new Error("Could not find Agreement ID in the output");
        }

        computeJobId = jobIdMatch[1];
        agreementId = agreementIdMatch[1];

        expect(computeJobId).to.be.a("string");
        expect(agreementId).to.be.a("string");

        console.log(`jobId: ${computeJobId}`);
        console.log(`agreementId: ${agreementId}`);

        if (!computeJobId) {
            console.error("Job ID was empty:", output);
            throw new Error("Job ID is missing");
        }

        if (!agreementId) {
            console.error("Agreement ID was empty:", output);
            throw new Error("Agreement ID is missing");
        }
    });

    it('should delay for compute job', (done) => {
        setTimeout(() => done(), 10000)
    }).timeout(10200)

    it("should get job status", async () => {
        const output = await runCommand(`npm run cli getJobStatus ${computeDatasetDid} ${computeJobId} ''`);
        expect(output).to.contain(computeJobId);
        expect(output.toLowerCase()).to.match(/status/);
        console.log(`Job status retrieved for jobId: ${computeJobId}`);
    });

    it("should download compute job results", async () => {
        const destFolder = path.join(projectRoot, "test-results", computeJobId);
        fs.mkdirSync(destFolder, { recursive: true });

        const output = await runCommand(`npm run cli downloadJobResults ${computeJobId} 1 ${destFolder}`);

        expect(output.toLowerCase()).to.match(/download(ed)?/);

        const files = fs.readdirSync(destFolder);
        expect(files.length).to.be.greaterThan(0, "No result files downloaded");
        console.log(`Downloaded results to: ${destFolder}`);
        fs.rmSync(path.join(projectRoot, "test-results"), { recursive: true })
    });

});
