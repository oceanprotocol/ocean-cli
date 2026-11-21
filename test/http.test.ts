import { expect } from "chai";
import { startP2P, stopP2P, validateNode } from "../src/nodeConnection.js";

// Node status is fetched through ocean.js `getNodeStatus` (the CLI's own
// `validateNode` wrapper), not a raw `fetch` to the root endpoint. That call
// uses the STATUS command over whichever transport NODE_URL names, so this test
// covers both the HTTP and P2P CI legs, and is immune to the ocean-node #1622
// root-endpoint rename (`nodeId`/`providerAddress`/`nodePublicKey`/`software`
// are gone; the status object exposes `id`/`address`/`publicKey`).
const NODE_URL = process.env.NODE_URL || "http://127.0.0.1:8001";
const IS_P2P = !NODE_URL.startsWith("http");

describe("Ocean Node status (via getNodeStatus)", function () {
  this.timeout(60_000);

  before(() => {
    // validateNode awaits ensureP2PReady() for P2P URIs, so P2P must be started.
    if (IS_P2P) {
      startP2P(NODE_URL);
    }
  });

  after(async () => {
    await stopP2P();
  });

  it("should return the full node status object", async () => {
    const status = await validateNode(NODE_URL);

    expect(status, `node ${NODE_URL} should be reachable`).to.not.be.null;
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
