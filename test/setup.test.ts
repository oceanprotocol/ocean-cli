import { expect } from "chai";
import { exec } from "child_process";
import path from "path";

import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
describe("Ocean CLI Setup", function() {
    process.env.AVOID_LOOP_RUN = "true";
    this.timeout(20000); // Set a longer timeout to allow the command to execute

    it("should return a valid response for 'npm run cli h'", function(done) {
        // Ensure the command is run from the project root directory
        const projectRoot = path.resolve(__dirname, "..");

        // Set environment variables for the test
        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        process.env.RPC = "http://127.0.0.1:8545";

        exec("npm run cli h", { cwd: projectRoot }, (error, stdout) => {
            // Check the stdout for the expected response
            try {
                expect(stdout).to.contain("help|h");
                expect(stdout).to.contain("Display help for all commands");
                expect(stdout).to.contain("getDDO [options] <did>");
                expect(stdout).to.contain("Gets DDO for an asset using the asset did");
                expect(stdout).to.contain("publish [options] <metadataFile>");
                expect(stdout).to.contain("Publishes a new asset with access service or compute service");
                expect(stdout).to.contain("publishAlgo [options] <metadataFile>");
                expect(stdout).to.contain("Publishes a new algorithm");
                expect(stdout).to.contain("editAsset|edit [options] <datasetDid> <metadataFile>");
                expect(stdout).to.contain("Updates DDO using the metadata items in the file");
                expect(stdout).to.contain("download [options] <did> [folder]");
                expect(stdout).to.contain("Downloads an asset into specified folder");
                expect(stdout).to.contain("allowAlgo [options] <datasetDid> <algoDid>");
                expect(stdout).to.contain("Approves an algorithm to run on a dataset");
                expect(stdout).to.contain("startCompute [options] <datasetDids> <algoDid> <computeEnvId> <maxJobDuration> <paymentToken> <resources>");
                expect(stdout).to.contain("Starts a compute job");
                expect(stdout).to.contain("startFreeCompute [options] <datasetDids> <algoDid> <computeEnvId>");
                expect(stdout).to.contain("Starts a FREE compute job");
                expect(stdout).to.contain("stopCompute [options] <datasetDid> <jobId> <agreementId>");
                expect(stdout).to.contain("Stops a compute job");
                expect(stdout).to.contain("getJobStatus [options] <datasetDid> <jobId> [agreementId]");
                expect(stdout).to.contain("Displays the compute job status");
                expect(stdout).to.contain("downloadJobResults <jobId> <resultIndex> [destinationFolder]");
                expect(stdout).to.contain("Downloads compute job results");
                expect(stdout).to.contain("mintOcean");
                expect(stdout).to.contain("Mints Ocean tokens");
                expect(stdout).to.contain("getComputeEnvironments");
                expect(stdout).to.contain("Gets the existing compute environments");
                expect(stdout).to.contain("computeStreamableLogs");
                expect(stdout).to.contain("Gets the existing compute streamable logs");
                expect(stdout).to.contain("createAccessList");
                expect(stdout).to.contain("Create a new access list contract");
                expect(stdout).to.contain("addToAccessList");
                expect(stdout).to.contain("Add user(s) to an access list");
                expect(stdout).to.contain("checkAccessList");
                expect(stdout).to.contain("Check if user(s) are on an access list");
                expect(stdout).to.contain("removeFromAccessList");
                expect(stdout).to.contain("Remove user(s) from an access list");

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

        exec("npm run cli getDDO did:op:123", { cwd: projectRoot }, (error, stdout, stderr) => {
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

        exec("npm run cli getDDO did:op:123", { cwd: projectRoot }, (error, stdout, stderr) => {
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

        exec("npm run cli getDDO did:op:123", { cwd: projectRoot }, (error, stdout, stderr) => {
            try {
                expect(stderr).to.contain("Have you forgot to set MNEMONIC or PRIVATE_KEY?");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });
});
