import { expect } from "chai";
import { homedir } from 'os';
import { runCommand } from "./util.js";
import { getConfigByChainId } from "../src/helpers.js";

describe("Ocean CLI Escrow", function () {
    this.timeout(60000); // 60 second timeout

    let chainConfig: any;
    let tokenAddress: string;

    before(async function () {
        process.env.AVOID_LOOP_RUN = "true";
        process.env.PRIVATE_KEY = "0xc594c6e5def4bab63ac29eed19a134c130388f74f019bc74b8f4389df2837a58";
        process.env.RPC = "http://localhost:8545";
        process.env.NODE_URL = "http://localhost:8000";
        process.env.ADDRESS_FILE = `${homedir}/.ocean/ocean-contracts/artifacts/address.json`;

        chainConfig = await getConfigByChainId(8996);
        tokenAddress = chainConfig.Ocean;

        await runCommand(`npm run cli -- mintOcean`);
    });

    it("should deposit tokens into escrow", async function () {
        const depositAmount = "1";

        const output = await runCommand(
            `npm run cli depositEscrow ${tokenAddress} ${depositAmount}`
        );


        expect(output).to.include("Deposit successful");
    });

    // it("should authorize a payee", async function () {
    //     const maxLockedAmount = "1000000000000000000"; // 1 token
    //     const maxLockSeconds = "3600"; // 1 hour
    //     const maxLockCounts = "10";

    //     const output = await runCommand(
    //         `npm run cli authorizeEscrow ${escrowAddress} ${tokenAddress} ${payeeAddress} ${maxLockedAmount} ${maxLockSeconds} ${maxLockCounts}`
    //     );

    //     expect(output).to.include("Authorization successful");
    // });

    it("should fail to deposit with invalid amount", async function () {
        const invalidAmount = "10000000";

        const output = await runCommand(
            `npm run cli depositEscrow ${tokenAddress} ${invalidAmount}`
        );

        expect(output).to.include("Deposit failed");
    });

    // it("should fail to authorize with invalid parameters", async function () {
    //     const invalidAmount = "0";
    //     const invalidDuration = "0";
    //     const invalidCounts = "0";

    //     const output = await runCommand(
    //         `npm run cli authorizeEscrow ${escrowAddress} ${tokenAddress} ${payeeAddress} ${invalidAmount} ${invalidDuration} ${invalidCounts}`
    //     );

    //     expect(output).to.include("Authorization failed");
    // });
}); 