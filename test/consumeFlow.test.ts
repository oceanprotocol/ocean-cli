import { expect } from "chai";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import https from "https";

describe("Ocean CLI Publishing", function() {
    this.timeout(180000); // Set a longer timeout to allow the command to execute

    let downloadDatasetDid: string;
    let computeDatasetDid: string;
    let jsAlgoDid: string;
    let pythonAlgoDid: string;

    const projectRoot = path.resolve(__dirname, "..");

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
    
    

    it("should publish a dataset using 'npm run cli publish'", function(done) {
        const metadataFile = path.resolve(projectRoot, "metadata/simpleDownloadDataset.json");

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
                    downloadDatasetDid = match[0];
                }
                expect(stdout).to.contain("Asset published. ID:");
                done()
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });

    it("should publish a compute dataset using 'npm run cli publish'", function(done) {
        const metadataFile = path.resolve(projectRoot, "metadata/simpleComputeDataset.json");
        // Ensure the metadata file exists
        if (!fs.existsSync(metadataFile)) {
            done(new Error("Metadata file not found: " + metadataFile));
            return;
        }

        exec(`npm run cli publish ${metadataFile}`, { cwd: projectRoot }, (error, stdout) => {
            try {
                const match = stdout.match(/did:op:[a-f0-9]{64}/);
                if (match) {
                    computeDatasetDid = match[0];
                }
                expect(stdout).to.contain("Asset published. ID:");
                done()
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
                done()
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
                done()
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });

    it("should get DDO using 'npm run cli getDDO' for download dataset", function(done) {
        exec(`npm run cli getDDO ${downloadDatasetDid}`, { cwd: projectRoot }, (error, stdout) => {
            expect(stdout).to.contain(`${downloadDatasetDid}`);
            expect(stdout).to.contain("https://w3id.org/did/v1");
            expect(stdout).to.contain("Datatoken");
            done()
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

    it("should download the download dataset", function(done) {
        this.timeout(10000); // Increase timeout if needed
    
        (async () => {
            try {
                const { stdout } = await new Promise<{ stdout: string, error: Error | null }>((resolve, reject) => {
                    exec(`npm run cli download ${downloadDatasetDid} .`, { cwd: projectRoot }, (error, stdout) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve({ stdout, error: null });
                        }
                    });
                });
    
                expect(stdout).to.contain("File downloaded successfully");
    
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
    
                done()
            } catch (err) {
                done(err);
            }
        })();
    });
    
});
