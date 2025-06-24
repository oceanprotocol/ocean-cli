import { expect } from "chai";
import { homedir } from 'os';
import { runCommand } from "./util.js";
import { getConfigByChainId } from "../src/helpers.js";
import { ethers } from "ethers";
import { EscrowContract } from "@oceanprotocol/lib";

describe("Ocean CLI Escrow", function () {
    this.timeout(60000); // 60 second timeout

    let chainConfig: any;
    let tokenAddress: string;
    let payee: ethers.Wallet;
    let payer: ethers.Wallet;
    let escrowAddress: string;

    before(async function () {
        process.env.AVOID_LOOP_RUN = "true";
        process.env.PRIVATE_KEY = "0xc594c6e5def4bab63ac29eed19a134c130388f74f019bc74b8f4389df2837a58";
        process.env.RPC = "http://localhost:8545";
        process.env.NODE_URL = "http://localhost:8000";
        process.env.ADDRESS_FILE = `${homedir}/.ocean/ocean-contracts/artifacts/address.json`;

        chainConfig = await getConfigByChainId(8996);
        tokenAddress = chainConfig.Ocean;
        escrowAddress = chainConfig.Escrow;

        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC);
        payer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        payee = new ethers.Wallet('0xef4b441145c1d0f3b4bc6d61d29f5c6e502359481152f869247c7a4244d45209', provider);


        await runCommand(`npm run cli -- mintOcean`);
    });

    it("should deposit tokens into escrow", async function () {
        const depositAmount = "1";

        const initialTokenBalance = await runCommand(`npm run cli getUserFundsEscrow ${tokenAddress}`);
        const initialTokenBalanceNumber = initialTokenBalance.split(`${tokenAddress}: `)[1].trim();
        const numberInitialTokenBalance = Number(initialTokenBalanceNumber);

        const output = await runCommand(
            `npm run cli depositEscrow ${tokenAddress} ${depositAmount}`
        );

        const finalTokenBalance = await runCommand(`npm run cli getUserFundsEscrow ${tokenAddress}`);
        const finalTokenBalanceNumber = finalTokenBalance.split(`${tokenAddress}: `)[1].trim();
        const numberFinalTokenBalance = Number(finalTokenBalanceNumber);

        expect(output).to.include("Deposit successful");
        expect(numberFinalTokenBalance).to.equal(Number(depositAmount) + numberInitialTokenBalance);
    });

    it("should withdraw tokens from escrow", async function () {
        const withdrawAmount = "1";
        const output = await runCommand(
            `npm run cli withdrawFromEscrow ${tokenAddress} ${withdrawAmount}`
        );

        expect(output).to.include("Successfully withdrawn");
    });

    it("should fail to deposit with invalid amount", async function () {
        const invalidAmount = "1000000000000000";

        const output = await runCommand(
            `npm run cli depositEscrow ${tokenAddress} ${invalidAmount}`
        );


        expect(output).to.include("Deposit failed");
    });

    it("should authorize a payee", async function () {
        const maxLockedAmount = "1";
        const maxLockSeconds = "3600";
        const maxLockCounts = "10";

        const output = await runCommand(
            `npm run cli authorizeEscrow ${tokenAddress} ${payee.address} ${maxLockedAmount} ${maxLockSeconds} ${maxLockCounts}`
        );

        const escrow = new EscrowContract(
            ethers.utils.getAddress(escrowAddress),
            payer,
            chainConfig.chainId
        );

        const authorizations = await escrow.getAuthorizations(
            tokenAddress,
            payer.address,
            payee.address
        );

        const maxLockedAmountFromEscrowBN = authorizations[0].maxLockedAmount;
        const maxLockedAmountFromEscrow = ethers.utils.formatEther(maxLockedAmountFromEscrowBN);

        expect(Number(maxLockedAmountFromEscrow)).to.equal(Number(maxLockedAmount));


        expect(output).to.satisfy((msg: string) =>
            msg.includes("Authorization successful") || msg.includes("already authorized")
        );
    });



    it("should fail to authorize with invalid parameters", async function () {
        const invalidAmount = "10000000000";
        const invalidDuration = "0";
        const invalidCounts = "0";

        const output = await runCommand(
            `npm run cli authorizeEscrow ${tokenAddress} ${payee.address} ${invalidAmount} ${invalidDuration} ${invalidCounts}`
        );

        expect(output).to.include("Authorization failed");
    });

    it("should get authorizations for a payee", async function () {
        const output = await runCommand(
            `npm run cli getAuthorizationsEscrow ${tokenAddress} ${payee.address}`
        );

        expect(output).to.include("Max locked amount: 1");
        expect(output).to.include("Max lock seconds: 3600");
        expect(output).to.include("Max lock counts: 10");
    });
}); 