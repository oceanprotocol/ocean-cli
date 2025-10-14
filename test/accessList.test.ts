import { expect } from "chai";
import { homedir } from 'os';
import { runCommand } from "./util.js";
import { getConfigByChainId } from "../src/helpers.js";
import { JsonRpcProvider, ethers } from "ethers";
import { AccessListContract, AccesslistFactory } from "@oceanprotocol/lib";

describe("Ocean CLI Access List", function () {
    this.timeout(120000);

    let chainConfig: any;
    let accessListAddress: string;
    let owner: ethers.Wallet;
    let testUser1: ethers.Wallet;
    let testUser2: ethers.Wallet;

    before(async function () {
        process.env.AVOID_LOOP_RUN = "true";
        process.env.PRIVATE_KEY = "0xc594c6e5def4bab63ac29eed19a134c130388f74f019bc74b8f4389df2837a58";
        process.env.RPC = "http://localhost:8545";
        process.env.NODE_URL = "http://localhost:8000";
        process.env.ADDRESS_FILE = `${homedir}/.ocean/ocean-contracts/artifacts/address.json`;

        chainConfig = await getConfigByChainId(8996);

        const provider = new JsonRpcProvider(process.env.RPC);
        owner = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        testUser1 = new ethers.Wallet('0xef4b441145c1d0f3b4bc6d61d29f5c6e502359481152f869247c7a4244d45209', provider);
        testUser2 = new ethers.Wallet('0x5d75837c166221195c8763c7f6fc5f6b8f0e8f43f9f4e0b0e7a3f7e2f9f4e3a1', provider);
    });

    describe("Create Access List", function () {
        it("should create a new access list contract", async function () {
            const name = "TestAccessList";
            const symbol = "TAL";
            const transferable = "false";

            const output = await runCommand(
                `npm run cli createAccessList ${name} ${symbol} ${transferable}`
            );

            expect(output).to.include("Access list created successfully");
            expect(output).to.include("Contract address:");

            const addressMatch = output.match(/Contract address: (0x[a-fA-F0-9]{40})/);
            if (addressMatch) {
                accessListAddress = addressMatch[1];
                console.log(`Created access list at: ${accessListAddress}`);
            } else {
                throw new Error("Could not extract access list address from output");
            }
        });

        it("should create a new access list with initial users", async function () {
            const name = "TestAccessListWithUsers";
            const symbol = "TALWU";
            const transferable = "false";
            const initialUsers = `${testUser1.address},${testUser2.address}`;

            const output = await runCommand(
                `npm run cli createAccessList ${name} ${symbol} ${transferable} ${initialUsers}`
            );

            expect(output).to.include("Access list created successfully");
            expect(output).to.include("Contract address:");
            expect(output).to.include(`Initial users: ${testUser1.address}, ${testUser2.address}`);
        });

        it("should fail to create access list without required parameters", async function () {
            try {
                await runCommand(`npm run cli createAccessList`);
                throw new Error("Should have thrown an error");
            } catch (error: any) {
                expect(error.stderr || error.message).to.satisfy((msg: string) =>
                    msg.includes("error: missing required argument") ||
                    msg.includes("Name and symbol are required")
                );
            }
        });
    });

    describe("Add Users to Access List", function () {
        it("should add a single user to the access list", async function () {
            const output = await runCommand(
                `npm run cli addToAccessList ${accessListAddress} ${testUser1.address}`
            );

            expect(output).to.include(`Successfully added user ${testUser1.address}`);
        });

        it("should add multiple users to the access list", async function () {
            const users = `${testUser2.address},${owner.address}`;

            const output = await runCommand(
                `npm run cli addToAccessList ${accessListAddress} ${users}`
            );

            expect(output).to.include("Successfully added");
            expect(output).to.include("users to access list");
        });

        it("should fail to add users without required parameters", async function () {
            try {
                await runCommand(`npm run cli addToAccessList ${accessListAddress}`);
                throw new Error("Should have thrown an error");
            } catch (error: any) {
                expect(error.stderr || error.message).to.satisfy((msg: string) =>
                    msg.includes("error: missing required argument") ||
                    msg.includes("at least one user are required")
                );
            }
        });
    });

    describe("Check Users on Access List", function () {
        it("should check if a single user is on the access list", async function () {
            const output = await runCommand(
                `npm run cli checkAccessList ${accessListAddress} ${testUser1.address}`
            );

            expect(output).to.include(testUser1.address);
            expect(output).to.satisfy((msg: string) =>
                msg.includes("Has access") || msg.includes("No access")
            );
        });

        it("should check multiple users on the access list", async function () {
            const users = `${testUser1.address},${testUser2.address}`;

            const output = await runCommand(
                `npm run cli checkAccessList ${accessListAddress} ${users}`
            );

            expect(output).to.include(testUser1.address);
            expect(output).to.include(testUser2.address);
        });

        it("should show 'Has access' for users on the list", async function () {
            const output = await runCommand(
                `npm run cli checkAccessList ${accessListAddress} ${testUser1.address}`
            );

            expect(output).to.include("Has access");
        });

        it("should verify user access using direct contract call", async function () {
            const accessList = new AccessListContract(
                accessListAddress,
                owner,
                chainConfig.chainId
            );

            const balance = await accessList.balance(testUser1.address);
            expect(Number(balance)).to.be.greaterThan(0);
        });
    });

    describe("Remove Users from Access List", function () {
        it("should remove a user from the access list by address", async function () {
            const output = await runCommand(
                `npm run cli removeFromAccessList ${accessListAddress} ${testUser1.address}`
            );

            expect(output).to.include("Successfully removed user");
            expect(output).to.include(testUser1.address);
        });

        it("should remove multiple users by addresses", async function () {
            await runCommand(
                `npm run cli addToAccessList ${accessListAddress} ${testUser1.address}`
            );

            await runCommand(
                `npm run cli addToAccessList ${accessListAddress} ${testUser2.address}`
            );

            const users = `${testUser1.address},${testUser2.address}`;

            const output = await runCommand(
                `npm run cli removeFromAccessList ${accessListAddress} ${users}`
            );

            expect(output).to.include("Successfully removed user");
        });

        it("should handle removing a user not on the access list", async function () {
            const nonExistentUser = "0x0000000000000000000000000000000000000001";

            const output = await runCommand(
                `npm run cli removeFromAccessList ${accessListAddress} ${nonExistentUser}`
            );

            expect(output).to.include("not on the access list");
        });

        it("should fail to remove with invalid address", async function () {
            const invalidAddress = "invalid-address";

            try {
                await runCommand(
                    `npm run cli removeFromAccessList ${accessListAddress} ${invalidAddress}`
                );
            } catch (error: any) {
                expect(error.stderr || error.message).to.satisfy((msg: string) =>
                    msg.includes("Error removing users") ||
                    msg.includes("error") ||
                    msg.includes("invalid address")
                );
            }
        });
    });

    describe("Access List Factory", function () {
        it("should verify access list is deployed via factory", async function () {
            const factory = new AccesslistFactory(
                chainConfig.AccessListFactory,
                owner,
                chainConfig.chainId
            );

            const isDeployed = await factory.isDeployed(accessListAddress);
            expect(isDeployed).to.be.true;
        });

        it("should verify access list is soulbound", async function () {
            const factory = new AccesslistFactory(
                chainConfig.AccessListFactory,
                owner,
                chainConfig.chainId
            );

            const isSoulbound = await factory.isSoulbound(accessListAddress);
            expect(isSoulbound).to.be.true;
        });
    });


    describe("Edge Cases", function () {
        it("should handle empty initial users list", async function () {
            const output = await runCommand(
                `npm run cli createAccessList EmptyList EL false ""`
            );

            expect(output).to.include("Access list created successfully");
            expect(output).to.include("Initial users: none");
        });

        it("should fail with invalid address format", async function () {
            try {
                await runCommand(
                    `npm run cli checkAccessList ${accessListAddress} invalid-address`
                );
            } catch (error: any) {
                expect(error.stderr || error.message).to.satisfy((msg: string) =>
                    msg.includes("Error checking access list") ||
                    msg.includes("error") ||
                    msg.includes("invalid address")
                );
            }
        });
    });

    describe("E2E Workflow", function () {
        it("should complete a full access list workflow", async function () {
            const createOutput = await runCommand(
                `npm run cli createAccessList WorkflowTest WT false`
            );
            expect(createOutput).to.include("Access list created successfully");

            const addressMatch = createOutput.match(/Contract address: (0x[a-fA-F0-9]{40})/);
            const workflowAccessList = addressMatch ? addressMatch[1] : "";

            const addOutput = await runCommand(
                `npm run cli addToAccessList ${workflowAccessList} ${testUser1.address}`
            );
            expect(addOutput).to.include("Successfully added");

            const checkOutput = await runCommand(
                `npm run cli checkAccessList ${workflowAccessList} ${testUser1.address}`
            );
            expect(checkOutput).to.include("Has access");

            const removeOutput = await runCommand(
                `npm run cli removeFromAccessList ${workflowAccessList} ${testUser1.address}`
            );
            expect(removeOutput).to.include("Successfully removed");

            const finalCheckOutput = await runCommand(
                `npm run cli checkAccessList ${workflowAccessList} ${testUser1.address}`
            );
            expect(finalCheckOutput).to.include("No access");
        });
    });
});

