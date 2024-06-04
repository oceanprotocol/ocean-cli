import { expect } from "chai";
import { exec } from "child_process";
import path from "path";

describe("Ocean CLI Tool", function() {
    this.timeout(20000); // Set a longer timeout to allow the command to execute

    it("should return an error message for 'npm run cli h' without MNEMONIC or PRIVATE_KEY", function(done) {
        // Ensure the command is run from the project root directory
        const projectRoot = path.resolve(__dirname, "..");

        // Unset environment variables for the test
        delete process.env.MNEMONIC;
        delete process.env.PRIVATE_KEY;
        delete process.env.RPC;

        // Log the current working directory to ensure it's correct
        console.log("Running test from directory:", projectRoot);

        exec("npm run cli h", { cwd: projectRoot }, (error, stdout, stderr) => {
            // Log the outputs for debugging
            console.log("stdout:", stdout);
            console.log("stderr:", stderr);

            // Check the stderr for the expected error message
            try {
                expect(stderr).to.contain("Have you forgot to set MNEMONIC or PRIVATE_KEY?"); // Adjust this to match the expected output
                done();
            } catch (assertionError) {
                done(assertionError);
            }
        });
    });
});
