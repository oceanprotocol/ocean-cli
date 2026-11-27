import { expect } from "chai";
import { ProviderInstance } from "@oceanprotocol/lib";

// Node status is fetched through ocean.js `getNodeStatus` (which uses the STATUS
// command over `POST /directCommand`), not a raw `fetch` to the root endpoint, so
// this is immune to the ocean-node #1622 root-endpoint rename (`nodeId`/
// `providerAddress`/`nodePublicKey`/`software` are gone; the status object exposes
// `id`/`address`/`publicKey`). It runs over the node's HTTP API, which is up in
// both CI transport legs; the P2P transport itself is exercised by the full
// system-test suite (which runs the CLI with NODE_URL set to the node's peer id).
const NODE_HTTP = "http://127.0.0.1:8001";

describe("Ocean Node status (via getNodeStatus)", function () {
  this.timeout(30_000);

  it("should return the full node status object", async () => {
    const status = await ProviderInstance.getNodeStatus(
      NODE_HTTP,
      AbortSignal.timeout(15_000),
    );

    expect(status, `node ${NODE_HTTP} should be reachable`).to.not.be.null;
    expect(status).to.have.property("id");
    expect(status).to.have.property("publicKey");
    expect(status).to.have.property("address");
    expect(status).to.have.property("version");
    expect(status).to.have.property("http");
    expect(status).to.have.property("p2p");
    expect(status).to.have.property("provider");
    expect(status).to.have.property("indexer");
    expect(status).to.have.property("supportedStorage");
    expect(status).to.have.property("uptime");
    expect(status).to.have.property("platform");
    expect(status).to.have.property("codeHash");
    expect(status).to.have.property("allowedAdmins");

    // Check if version is "0.0.1" or greater
    const [major, minor, patch] = status.version.split(".").map(Number);
    expect(major).to.be.at.least(0);
    if (major === 0) {
      expect(minor).to.be.at.least(0);
      if (minor === 0) {
        expect(patch).to.be.at.least(1);
      }
    }
  });
});

describe("getP2PPeers Endpoint", () => {
  it("should return correct status", async () => {
    const response = await fetch("http://localhost:8001/getP2PPeers");
    const responseBody = await response.json();

    expect(response.status).to.equal(200);
    expect(responseBody).to.be.an("array");
  });
});

describe("Direct Command Endpoint", () => {
  it("should return correct status", async () => {
    const response = await fetch("http://localhost:8001/logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).to.equal(400);
  });
});
