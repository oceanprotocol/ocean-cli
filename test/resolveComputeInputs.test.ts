import { expect } from "chai";
import { Aquarius } from "@oceanprotocol/lib";
import {
  resolveComputeInputs,
  IndexerWaitParams,
} from "../src/helpers.js";

// A fake Aquarius whose waitForIndexer returns a deterministic DDO per DID,
// so the resolver can be exercised without a live indexer.
function makeAquarius(known?: Set<string>): Aquarius {
  return {
    waitForIndexer: async (did: string) => {
      if (known && !known.has(did)) return null;
      return {
        id: did,
        services: [
          {
            id: `service-${did}`,
            serviceEndpoint: `http://provider-for-${did}`,
          },
        ],
        metadata: { algorithm: { container: { image: "img" } } },
      };
    },
  } as unknown as Aquarius;
}

const indexingParams: IndexerWaitParams = {
  maxRetries: 1,
  retryInterval: 1,
};
const FALLBACK = "http://node-fallback";

const RAW_DATASET = {
  fileObject: { type: "url", url: "https://example.com/data.csv", method: "GET" },
};
const RAW_ALGO = {
  fileObject: { type: "url", url: "https://example.com/algo.py", method: "GET" },
  meta: { container: { image: "oceanprotocol/algo_dockers" } },
};

describe("resolveComputeInputs", function () {
  it("resolves a single dataset DID and a single algorithm DID", async function () {
    const res = await resolveComputeInputs(
      "did:op:dataset1",
      "did:op:algo1",
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res).to.not.equal(null);
    expect(res.assets).to.have.length(1);
    expect(res.assets[0].documentId).to.equal("did:op:dataset1");
    expect(res.ddos[0]).to.not.equal(null);
    expect(res.algoDdo).to.not.equal(null);
    expect(res.algo.documentId).to.equal("did:op:algo1");
    expect(res.algo.meta).to.not.equal(undefined);
    expect(res.providerURI).to.equal("http://provider-for-did:op:dataset1");
  });

  it("supports the legacy unquoted [did:a,did:b] datasets form", async function () {
    const res = await resolveComputeInputs(
      "[did:op:a,did:op:b]",
      "did:op:algo1",
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res.assets).to.have.length(2);
    expect(res.assets.map((a) => a.documentId)).to.deep.equal([
      "did:op:a",
      "did:op:b",
    ]);
    expect(res.ddos.every((d) => d !== null)).to.equal(true);
  });

  it("supports the legacy unbracketed comma-separated DIDs form", async function () {
    const res = await resolveComputeInputs(
      "did:op:a,did:op:b",
      "did:op:algo1",
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res.assets).to.have.length(2);
    expect(res.assets.map((a) => a.documentId)).to.deep.equal([
      "did:op:a",
      "did:op:b",
    ]);
    expect(res.ddos.every((d) => d !== null)).to.equal(true);
  });

  it("treats a JSON object datasets arg as a raw asset (no DDO, fallback provider)", async function () {
    const res = await resolveComputeInputs(
      JSON.stringify(RAW_DATASET),
      "did:op:algo1",
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res.assets).to.have.length(1);
    expect(res.assets[0].fileObject).to.not.equal(undefined);
    expect(res.assets[0].documentId).to.equal("");
    expect(res.ddos[0]).to.equal(null);
    expect(res.providerURI).to.equal(FALLBACK);
  });

  it("handles a mixed JSON array of a DID and a raw asset, keeping index alignment", async function () {
    const res = await resolveComputeInputs(
      JSON.stringify(["did:op:dataset1", RAW_DATASET]),
      "did:op:algo1",
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res.assets).to.have.length(2);
    expect(res.ddos[0]).to.not.equal(null);
    expect(res.ddos[1]).to.equal(null);
    expect(res.assets[1].fileObject).to.not.equal(undefined);
    // providerURI derives from the first DID-based DDO
    expect(res.providerURI).to.equal("http://provider-for-did:op:dataset1");
  });

  it("picks the provider from the first DID even when a raw asset comes first", async function () {
    const res = await resolveComputeInputs(
      JSON.stringify([RAW_DATASET, "did:op:dataset1"]),
      "did:op:algo1",
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res.ddos[0]).to.equal(null);
    expect(res.ddos[1]).to.not.equal(null);
    expect(res.providerURI).to.equal("http://provider-for-did:op:dataset1");
  });

  it("treats a JSON object algorithm arg as a raw algorithm (algoDdo null)", async function () {
    const res = await resolveComputeInputs(
      "did:op:dataset1",
      JSON.stringify(RAW_ALGO),
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res.algoDdo).to.equal(null);
    expect(res.algo.fileObject).to.not.equal(undefined);
    expect(res.algo.meta).to.not.equal(undefined);
  });

  it("returns an empty asset list for an empty array, using fallback provider", async function () {
    const res = await resolveComputeInputs(
      "[]",
      "did:op:algo1",
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res.assets).to.have.length(0);
    expect(res.providerURI).to.equal(FALLBACK);
  });

  it("fails (returns null) when a raw dataset object lacks a fileObject", async function () {
    const res = await resolveComputeInputs(
      JSON.stringify({ documentId: "x" }),
      "did:op:algo1",
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res).to.equal(null);
  });

  it("fails (returns null) when a raw algorithm object lacks a fileObject", async function () {
    const res = await resolveComputeInputs(
      "did:op:dataset1",
      JSON.stringify({ meta: { container: {} } }),
      makeAquarius(),
      indexingParams,
      FALLBACK
    );
    expect(res).to.equal(null);
  });

  it("fails (returns null) when a dataset DID cannot be resolved", async function () {
    const res = await resolveComputeInputs(
      "did:op:missing",
      "did:op:algo1",
      makeAquarius(new Set(["did:op:algo1"])),
      indexingParams,
      FALLBACK
    );
    expect(res).to.equal(null);
  });
});
