import { expect } from "chai";
import { exec } from "child_process";
import path from "path";

describe("Ocean CLI Setup", function() {
    this.timeout(20000); // Set a longer timeout to allow the command to execute

    it("should return a valid response for 'npm run cli h' with MNEMONIC and PRIVATE_KEY", function(done) {
        // Ensure the command is run from the project root directory
        const projectRoot = path.resolve(__dirname, "..");

        // Set environment variables for the test
        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        process.env.RPC = "http://127.0.0.1:8545";

        exec("npm run cli h", { cwd: projectRoot }, (error, stdout) => {
            // Check the stdout for the expected response
            try {
                expect(stdout).to.contain("Available options:");
                expect(stdout).to.contain("getDDO DID");
                expect(stdout).to.contain("publish METADATA_FILE ENCRYPT_DDO");
                expect(stdout).to.contain("publishAlgo METADATA_FILE ENCRYPT_DDO");
                expect(stdout).to.contain("editAsset DATASET_DID UPDATED_METADATA_FILE ENCRYPT_DDO");
                expect(stdout).to.contain("download DID DESTINATION_FOLDER");
                expect(stdout).to.contain("allowAlgo DATASET_DID ALGO_DID ENCRYPT_DDO");
                expect(stdout).to.contain("disallowAlgo DATASET_DID ALGO_DID ENCRYPT_DDO");
                expect(stdout).to.contain("startCompute [DATASET_DIDs] ALGO_DID COMPUTE_ENV_ID");
                expect(stdout).to.contain("stopCompute DATASET_DID JOB_ID");
                expect(stdout).to.contain("getJobStatus DATASET_DID JOB_ID");
                expect(stdout).to.contain("getJobResults DATASET_DID JOB_ID");
                expect(stdout).to.contain("downloadJobResults JOB_ID RESULT_INDEX DESTINATION_FOLDER");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });

    // Additional comprehensive tests
    it("should return an error message when only MNEMONIC is set", function(done) {
        const projectRoot = path.resolve(__dirname, "..");
        process.env.MNEMONIC = "your-valid-mnemonic-here";
        delete process.env.PRIVATE_KEY;
        delete process.env.RPC;

        exec("npm run cli h", { cwd: projectRoot }, (error, stdout, stderr) => {
            try {
                expect(stderr).to.contain("Have you forgot to set env RPC?");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });

    it("should return an error message when only PRIVATE_KEY is set", function(done) {
        const projectRoot = path.resolve(__dirname, "..");
        delete process.env.MNEMONIC;
        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        delete process.env.RPC;

        exec("npm run cli h", { cwd: projectRoot }, (error, stdout, stderr) => {
            try {
                expect(stderr).to.contain("Have you forgot to set env RPC?");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });

    it("should return an error message when only RPC is set", function(done) {
        const projectRoot = path.resolve(__dirname, "..");
        delete process.env.MNEMONIC;
        delete process.env.PRIVATE_KEY;
        process.env.RPC = "http://127.0.0.1:8545";

        exec("npm run cli h", { cwd: projectRoot }, (error, stdout, stderr) => {
            try {
                expect(stderr).to.contain("Have you forgot to set MNEMONIC or PRIVATE_KEY?");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });
});
