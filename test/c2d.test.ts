import { expect } from "chai";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

describe("C2D Tests", function() {
    this.timeout(60000); // Set a longer timeout to allow the command to execute

    let computeDatasetDid: string;
    let jsAlgoDid: string;
    let pythonAlgoDid: string;

    const projectRoot = path.resolve(__dirname, "..");

    it("should publish a compute dataset using 'npm run cli publish'", function(done) {
        const metadataFile = path.resolve(projectRoot, "metadata/simpleComputeDataset.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(metadataFile)) {
            done(new Error("Metadata file not found: " + metadataFile));
            return;
        }

        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        process.env.RPC = "http://127.0.0.1:8545";
        process.env.AQUARIUS_URL = "http://127.0.0.1:8001";
        process.env.PROVIDER_URL = "http://127.0.0.1:8001";
        process.env.ADDRESS_FILE = path.join(process.env.HOME || "", ".ocean/ocean-contracts/artifacts/address.json");

        exec(`npm run cli publish ${metadataFile}`, { cwd: projectRoot }, (error, stdout) => {
            try {
                const match = stdout.match(/did:op:[a-f0-9]{64}/);
                if (match) {
                    computeDatasetDid = match[0];
                }
                expect(stdout).to.contain("Asset published. ID:");
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });

    it("should publish a js Algorithm using 'npm run cli publishAlgo'", function(done) {
        const filePath = path.resolve(projectRoot, "metadata/jsAlgo.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(filePath)) {
            done(new Error("Metadata file not found: " + filePath));
            return;
        }

        exec(`npm run cli publishAlgo ${filePath}`, { cwd: projectRoot }, (error, stdout) => {
            try {
                expect(stdout).to.contain("Algorithm published. DID:");
                const match = stdout.match(/did:op:[a-f0-9]{64}/);
                if (match) {
                    jsAlgoDid = match[0];
                }
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });

    it("should publish a python Algorithm using 'npm run cli publishAlgo'", function(done) {
        const filePath = path.resolve(projectRoot, "metadata/pythonAlgo.json");

        // Ensure the metadata file exists
        if (!fs.existsSync(filePath)) {
            done(new Error("Metadata file not found: " + filePath));
            return;
        }

        exec(`npm run cli publishAlgo ${filePath}`, { cwd: projectRoot }, (error, stdout) => {
            try {
                expect(stdout).to.contain("Algorithm published. DID:");
                const match = stdout.match(/did:op:[a-f0-9]{64}/);
                if (match) {
                    pythonAlgoDid = match[0];
                }
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });
    
    it("should get DDO using 'npm run cli getDDO' for compute dataset", function(done) {
        exec(`npm run cli getDDO ${computeDatasetDid}`, { cwd: projectRoot }, (error, stdout) => {
            expect(stdout).to.contain(`${computeDatasetDid}`);
            expect(stdout).to.contain("https://w3id.org/did/v1");
            expect(stdout).to.contain("Datatoken");
            done()
        });
    });
  
    it("should get DDO using 'npm run cli getDDO' for JS algorithm", function(done) {
        exec(`npm run cli getDDO ${jsAlgoDid}`, { cwd: projectRoot }, (error, stdout) => {
            expect(stdout).to.contain(`${jsAlgoDid}`);
            expect(stdout).to.contain("https://w3id.org/did/v1");
            expect(stdout).to.contain("Datatoken");
            done()
        });
    });
      
    it("should get DDO using 'npm run cli getDDO' for python algorithm", function(done) {
        exec(`npm run cli getDDO ${pythonAlgoDid}`, { cwd: projectRoot }, (error, stdout) => {
            expect(stdout).to.contain(`${pythonAlgoDid}`);
            expect(stdout).to.contain("https://w3id.org/did/v1");
            expect(stdout).to.contain("Datatoken");
            done()
        });
    });

    it("should allow Python algorithm to run on the compute dataset", function(done) {
        exec(`npm run cli allowAlgo ${computeDatasetDid} ${pythonAlgoDid}`, { cwd: projectRoot }, (error, stdout) => {
            console.log('running: ', `npm run cli allowAlgo ${computeDatasetDid} ${pythonAlgoDid}`)
            console.log("stdout", stdout)
            expect(stdout).to.contain("Successfully updated asset metadata:");
            done()
        });
    });

    it("should start compute job with Python algorithm running on the compute dataset", function(done) {
        this.timeout(60000);
        const computeDatasetArray = JSON.stringify([computeDatasetDid]);
        exec(`npm run cli startCompute ${computeDatasetArray} ${pythonAlgoDid} 0`, { cwd: projectRoot }, (error, stdout) => {
            expect(stdout).to.contain("Starting compute job using provider");
            expect(stdout).to.contain("Ordering algorithm");
            expect(stdout).to.contain(pythonAlgoDid);
            expect(stdout).to.contain("Ordering asset with DID");
            expect(stdout).to.contain(computeDatasetDid);
            expect(stdout).to.contain("Starting compute job on");
            expect(stdout).to.contain("Consumer");
            expect(stdout).to.contain("JobID");
            expect(stdout).to.contain("Agreement ID");
            done()
        });
    });
});
