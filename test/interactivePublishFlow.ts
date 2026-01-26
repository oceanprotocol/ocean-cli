import { expect } from "chai";
import { exec } from "child_process";
import path from "path";

import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
describe("Ocean CLI Interactive Publishing", function () {
    this.timeout(120000); // Set a longer timeout to allow for user input simulation

    const projectRoot = path.resolve(__dirname, "..");
    let publishedDid: string;

    it("should publish an asset using 'npm run cli start' interactive flow", function (done) {
        process.env.PRIVATE_KEY = "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        process.env.RPC = "http://127.0.0.1:8545";
        process.env.NODE_URL = "http://127.0.0.1:8001";
        process.env.ADDRESS_FILE = path.join(process.env.HOME || "", ".ocean/ocean-contracts/artifacts/address.json");

        const child = exec(`npm run cli start`, { cwd: projectRoot });

        // Simulate user input
        const inputs = [
            "test 123\n",
            "description\n",
            "me\n",
            "test,123\n",
            "\n", // Select default (1 day)
            "\n", // Select default (IPFS)
            "QmdbaSQbGU6Wo9i5LyWWVLuU8g6WrYpWh2K4Li4QuuE8Fr\n",
            "\n", // Select default (Paid)
            "\n", // Select default (OCEAN)
            "100\n",
            "\n", // Select default (Polygon)
            "\n", // Select default (Template 2)
        ];

        let inputIndex = 0;
        let fullOutput = "";

        if (child.stdin) {
            const inputInterval = setInterval(() => {
                if (inputIndex < inputs.length) {
                    child.stdin.write(inputs[inputIndex]);
                    inputIndex++;
                } else {
                    clearInterval(inputInterval);
                    if (child.stdin) child.stdin.end();
                }
            }, 1000); // Adjust timing as needed
        }

        child.stdout?.on('data', (data) => {
            fullOutput += data.toString();
        });

        child.stderr?.on('data', (data) => {
            console.error(data.toString());
        });

        child.on('close', (code) => {
            try {
                expect(code).to.equal(0);
                expect(fullOutput).to.contain("Asset successfully published with DID:");
                expect(fullOutput).to.contain("Metadata successfully updated for DID:");

                const match = fullOutput.match(/did:op:[a-f0-9]{64}/);
                if (match) {
                    publishedDid = match[0];
                    expect(publishedDid).to.match(/^did:op:[a-f0-9]{64}$/);
                } else {
                    throw new Error("DID not found in output");
                }

                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });

    it("should get DDO using 'npm run cli getDDO' for the published asset", function (done) {
        exec(`npm run cli getDDO ${publishedDid}`, { cwd: projectRoot }, (error, stdout, stderr) => {
            if (stderr) {
                console.error(stderr);
            }
            try {
                expect(stdout).to.contain(`${publishedDid}`);
                expect(stdout).to.contain("https://w3id.org/did/v1");
                expect(stdout).to.contain("Datatoken");
                expect(stdout).to.contain("test 123"); // Asset title
                expect(stdout).to.contain("description"); // Asset description
                expect(stdout).to.contain("me"); // Author
                expect(stdout).to.contain("test"); // Tag
                expect(stdout).to.contain("123"); // Tag
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });
});