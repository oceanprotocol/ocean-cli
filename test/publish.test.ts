import { expect } from "chai";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

describe("Ocean CLI Publishing", function() {
    this.timeout(20000); // Set a longer timeout to allow the command to execute

    it("should publish a dataset using 'npm run cli publish'", function(done) {
        const projectRoot = path.resolve(__dirname, "..");
        const metadataFile = path.resolve(projectRoot, "metadata/simpleDownloadDataset.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(metadataFile)) {
            done(new Error("Metadata file not found: " + metadataFile));
            return;
        }

        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        process.env.RPC = "http://127.0.0.1:8545";
        process.env.AQUARIUS_URL = "http://127.0.0.1:8000";
        process.env.PROVIDER_URL = "http://127.0.0.1:8000";
        process.env.ADDRESS_FILE = path.join(process.env.HOME || "", ".ocean/ocean-contracts/artifacts/address.json");

        exec(`npm run cli publish ${metadataFile}`, { cwd: projectRoot }, (error, stdout, stderr) => {
            console.log("stdout:", stdout);
            console.log("stderr:", stderr);

            try {
                expect(stdout).to.contain("Asset published. ID:");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });


    it("should publish a js Algorithm using 'npm run cli publishAlgo'", function(done) {
        const projectRoot = path.resolve(__dirname, "..");
        const filePath = path.resolve(projectRoot, "metadata/jsAlgo.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(filePath)) {
            done(new Error("Metadata file not found: " + filePath));
            return;
        }

        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        process.env.RPC = "http://127.0.0.1:8545";
        process.env.AQUARIUS_URL = "http://127.0.0.1:8000";
        process.env.PROVIDER_URL = "http://127.0.0.1:8000";
        process.env.ADDRESS_FILE = path.join(process.env.HOME || "", ".ocean/ocean-contracts/artifacts/address.json");

        exec(`npm run cli publishAlgo ${filePath}`, { cwd: projectRoot }, (error, stdout) => {
            try {
                expect(stdout).to.contain("Algorithm published. DID:");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });


    it("should publish a python Algorithm using 'npm run cli publishAlgo'", function(done) {
        const projectRoot = path.resolve(__dirname, "..");
        const filePath = path.resolve(projectRoot, "metadata/pythonAlgo.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(filePath)) {
            done(new Error("Metadata file not found: " + filePath));
            return;
        }

        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        process.env.RPC = "http://127.0.0.1:8545";
        process.env.AQUARIUS_URL = "http://127.0.0.1:8000";
        process.env.PROVIDER_URL = "http://127.0.0.1:8000";
        process.env.ADDRESS_FILE = path.join(process.env.HOME || "", ".ocean/ocean-contracts/artifacts/address.json");

        exec(`npm run cli publishAlgo ${filePath}`, { cwd: projectRoot }, (error, stdout) => {
            try {
                expect(stdout).to.contain("Algorithm published. DID:");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });
});
