import { expect } from "chai";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import https from "https";

import { projectRoot, runCommand } from "./util.js";

describe("Ocean CLI Publishing", function () {
    this.timeout(200000); // Set a longer timeout to allow the command to execute

    let downloadDatasetDid: string;
    let downloadDatasetV5Did: string;
    let computeDatasetDid: string;
    let jsAlgoDid: string;
    let jsAlgoV5Did: string;
    let pythonAlgoDid: string;


    // Function to compute hash of a file
    const computeFileHash = (filePath: string): string => {
        const fileBuffer = fs.readFileSync(filePath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    };

    const downloadFile = async (url: string, dest: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(() => resolve());
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        });
    };


    it("should publish a dataset using 'npm run cli publish'", async function () {
        const metadataFile = path.resolve(projectRoot, "metadata/simpleDownloadDataset.json");

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
            throw new Error("Could not find did in the output");
        }

        try {
            downloadDatasetDid = jsonMatch[0];
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }

    });

    it("should publish a dataset v5 using 'npm run cli publish'", async function () {
        const metadataFile = path.resolve(projectRoot, "metadata/simpleDownloadDatasetV5.json");

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
        const jsonMatch = output.match(/did:ope:[a-f0-9]{64}/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find did in the output");
        }

        try {
            downloadDatasetV5Did = jsonMatch[0];
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }

    });

    it("should publish a compute dataset using 'npm run cli publish'", async function () {
        const metadataFile = path.resolve(projectRoot, "metadata/simpleComputeDataset.json");
        // Ensure the metadata file exists
        if (!fs.existsSync(metadataFile)) {
            throw new Error("Metadata file not found: " + metadataFile);
        }

        const output = await runCommand(`npm run cli publish ${metadataFile}`);

        const jsonMatch = output.match(/did:op:[a-f0-9]{64}/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find did in the output");
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
            throw new Error("Could not find did in the output");
        }

        try {
            jsAlgoDid = jsonMatch[0];
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should publish a js Algorithm V5 using 'npm run cli publishAlgo'", async function () {
        const filePath = path.resolve(projectRoot, "metadata/jsAlgoV5.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(filePath)) {
            throw new Error("Metadata file not found: " + filePath);
        }

        const output = await runCommand(`npm run cli publishAlgo ${filePath}`);
        const jsonMatch = output.match(/did:ope:[a-f0-9]{64}/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find did in the output");
        }

        try {
            jsAlgoV5Did = jsonMatch[0];
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should publish a python Algorithm using 'npm run cli publishAlgo'", async function () {
        const filePath = path.resolve(projectRoot, "metadata/pythonAlgo.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(filePath)) {
            throw new Error("Metadata file not found: " + filePath);
        }

        const output = await runCommand(`npm run cli publishAlgo ${filePath}`);
        const jsonMatch = output.match(/did:op:[a-f0-9]{64}/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find did in the output");
        }

        try {
            pythonAlgoDid = jsonMatch[0];
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should get DDO using 'npm run cli getDDO' for download dataset", async function () {

        const output = await runCommand(`npm run cli getDDO ${downloadDatasetDid}`);

        const jsonMatch = output.match(/s*([\s\S]*)/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find ddo in the output");
        }

        try {
            expect(output).to.contain(`Resolving Asset with DID: ${downloadDatasetDid}`)
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should get DDO V5 using 'npm run cli getDDO' for download dataset", async function () {

        const output = await runCommand(`npm run cli getDDO ${downloadDatasetV5Did}`);

        const jsonMatch = output.match(/s*([\s\S]*)/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find ddo in the output");
        }

        try {
            expect(output).to.contain(`Resolving Asset with DID: ${downloadDatasetV5Did}`)
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


    it("should get DDO using 'npm run cli getDDO' for JS algorithm V5", async function () {
        const output = await runCommand(`npm run cli getDDO ${jsAlgoV5Did}`);

        const jsonMatch = output.match(/s*([\s\S]*)/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find ddo in the output");
        }

        try {
            expect(output).to.contain(`Resolving Asset with DID: ${jsAlgoV5Did}`)
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should get DDO using 'npm run cli getDDO' for python algorithm", async function () {
        const output = await runCommand(`npm run cli getDDO ${pythonAlgoDid}`);

        const jsonMatch = output.match(/s*([\s\S]*)/);
        if (!jsonMatch) {
            console.error("Raw output:", output);
            throw new Error("Could not find ddo in the output");
        }

        try {
            expect(output).to.contain(`Resolving Asset with DID: ${pythonAlgoDid}`)
        } catch (error) {
            console.error("Extracted output:", jsonMatch[0]);
            throw new Error("Failed to parse the extracted output:\n" + error);
        }
    });

    it("should download the download dataset", async function () {
        this.timeout(10000); // Increase timeout if needed
        const output = await runCommand(`npm run cli download ${downloadDatasetDid} .`);

        expect(output).to.contain("File downloaded successfully");

        // Path to the downloaded file
        const downloadedFilePath = './LICENSE';

        // Verify the downloaded file content hash matches the original file hash
        const downloadedFileHash = computeFileHash(downloadedFilePath);
        const originalFilePath = './metadata/LICENSE';

        await downloadFile("https://raw.githubusercontent.com/oceanprotocol/ocean-node/refs/heads/main/LICENSE", originalFilePath);
        const originalFileHash = computeFileHash(originalFilePath);

        expect(downloadedFileHash).to.equal(originalFileHash);

        // Clean up downloaded original file
        fs.unlinkSync(originalFilePath);

    });
});
