import { expect } from "chai";
import {
  computeJobChainIds,
  summarizeComputeEnvFees,
} from "../src/helpers.js";

// Pure unit tests for the Phase 3 multi-chain-compute helpers. No infra.

describe("computeJobChainIds", () => {
  it("returns just the payment chain when there are no DID assets", () => {
    expect(computeJobChainIds(137, [null, null], null)).to.deep.equal([137]);
  });

  it("collects the payment chain plus each DID asset/algo chain, payment first", () => {
    const ddos = [{ chainId: 8996 }, { chainId: 137 }];
    const algo = { chainId: 1 };
    expect(computeJobChainIds(10, ddos, algo)).to.deep.equal([
      10, 8996, 137, 1,
    ]);
  });

  it("de-dups chains and preserves first-seen order", () => {
    const ddos = [{ chainId: 137 }, { chainId: 137 }];
    const algo = { chainId: 137 };
    // payment chain 137 seen first; the rest collapse into it
    expect(computeJobChainIds(137, ddos, algo)).to.deep.equal([137]);
  });

  it("ignores raw fileObject entries (null DDO slots) and invalid chainIds", () => {
    const ddos = [null, { chainId: 8996 }, { chainId: undefined }, undefined];
    expect(computeJobChainIds(137, ddos, null)).to.deep.equal([137, 8996]);
  });

  it("is equivalent to a single chain when every asset shares the payment chain", () => {
    const ddos = [{ chainId: 8996 }, { chainId: 8996 }];
    const algo = { chainId: 8996 };
    // single-chain back-compat: only one chain to validate/order on
    expect(computeJobChainIds(8996, ddos, algo)).to.deep.equal([8996]);
  });
});

describe("summarizeComputeEnvFees", () => {
  it("lists each fee chain with its accepted tokens", () => {
    const out = summarizeComputeEnvFees({
      id: "env-1",
      fees: {
        "8996": [{ feeToken: "0xAAA" }, { feeToken: "0xBBB" }],
        "137": [{ feeToken: "0xCCC" }],
      },
    });
    expect(out).to.contain("Env env-1");
    expect(out).to.contain("chain 8996: 0xAAA, 0xBBB");
    expect(out).to.contain("chain 137: 0xCCC");
  });

  it("marks a free env and reports no payment required", () => {
    const out = summarizeComputeEnvFees({ id: "free-env", free: {}, fees: {} });
    expect(out).to.contain("(free)");
    expect(out).to.contain("no payment required");
  });

  it("reports when a paid env advertises no fee chains", () => {
    const out = summarizeComputeEnvFees({ id: "paid-env", fees: {} });
    expect(out).to.contain("no payment chains advertised");
  });

  it("tolerates a fee entry with no listed tokens", () => {
    const out = summarizeComputeEnvFees({ id: "e", fees: { "1": [] } });
    expect(out).to.contain("chain 1: (no tokens listed)");
  });
});
