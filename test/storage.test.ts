import { expect } from "chai";
import fs from "fs";
import path from "path";
import { homedir } from "os";
import { JsonRpcProvider, ethers } from "ethers";
import { runCommand, runCommandAs, projectRoot } from "./util.js";

describe("Ocean CLI Persistent Storage", function () {
  this.timeout(200000);

  const ALICE_KEY =
    "0xc594c6e5def4bab63ac29eed19a134c130388f74f019bc74b8f4389df2837a58";
  const BOB_KEY =
    "0xef4b441145c1d0f3b4bc6d61d29f5c6e502359481152f869247c7a4244d45209";

  let alice: ethers.Wallet;
  let bob: ethers.Wallet;
  let accessListAddress: string;
  let bucketId: string;
  const fileName = "alice-bob.txt";
  const tempFilePath = path.join(projectRoot, fileName);

  before(async function () {
    process.env.PRIVATE_KEY = ALICE_KEY;
    process.env.RPC = "http://127.0.0.1:8545";
    process.env.NODE_URL = "http://127.0.0.1:8001";
    process.env.ADDRESS_FILE = `${homedir()}/.ocean/ocean-contracts/artifacts/address.json`;

    const provider = new JsonRpcProvider(process.env.RPC);
    alice = new ethers.Wallet(ALICE_KEY, provider);
    bob = new ethers.Wallet(BOB_KEY, provider);

    fs.writeFileSync(tempFilePath, "hello from alice");
  });

  after(function () {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  });

  it("should create an access list and add Alice and Bob", async function () {
    const createOutput = await runCommand(
      `npm run cli createAccessList StorageTestACL STACL`
    );
    expect(createOutput).to.include("Access list created successfully");
    const addressMatch = createOutput.match(
      /Contract address: (0x[a-fA-F0-9]{40})/
    );
    if (!addressMatch) {
      throw new Error("Could not extract access list address");
    }
    accessListAddress = addressMatch[1];

    const addOutput = await runCommand(
      `npm run cli addToAccessList ${accessListAddress} ${alice.address},${bob.address}`
    );
    expect(addOutput).to.include("Successfully added");
  });

  it("should create a bucket gated by the access list", async function () {
    const output = await runCommand(
      `npm run cli createBucket ${accessListAddress}`
    );
    expect(output).to.include("Bucket created.");
    const idMatch = output.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
    );
    if (!idMatch) {
      throw new Error("Could not extract bucketId from output");
    }
    bucketId = idMatch[0];
    expect(output.toLowerCase()).to.include(alice.address.toLowerCase());
  });

  it("Alice should upload a file to the bucket", async function () {
    const output = await runCommand(
      `npm run cli addFileToBucket ${bucketId} ${tempFilePath}`
    );
    expect(output).to.include(fileName);
    expect(output).to.include("size:");
  });

  it("Alice should list files and see the uploaded file", async function () {
    const output = await runCommand(
      `npm run cli listFilesInBucket ${bucketId}`
    );
    expect(output).to.include(fileName);
  });

  it("Alice should list her buckets and see the new one", async function () {
    const output = await runCommand(`npm run cli listBuckets`);
    expect(output).to.include(bucketId);
    expect(output.toLowerCase()).to.include(alice.address.toLowerCase());
  });

  it("Alice should get the file-object descriptor", async function () {
    const output = await runCommand(
      `npm run cli getFileObject ${bucketId} ${fileName}`
    );
    expect(output).to.include('"type": "nodePersistentStorage"');
    expect(output).to.include(bucketId);
    expect(output).to.include(fileName);
  });

  it("Bob (on the ACL) should list files in the bucket", async function () {
    const output = await runCommandAs(
      BOB_KEY,
      `npm run cli listFilesInBucket ${bucketId}`
    );
    expect(output).to.include(fileName);
  });

  it("Alice should delete the file from the bucket", async function () {
    const output = await runCommand(
      `npm run cli deleteFile ${bucketId} ${fileName}`
    );
    expect(output).to.match(/deleted|success/i);

    const listOutput = await runCommand(
      `npm run cli listFilesInBucket ${bucketId}`
    );
    expect(listOutput).to.not.include(fileName);
  });
});
