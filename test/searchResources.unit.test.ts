import { expect } from "chai";
import {
  ComputeEnvironment,
  ComputeProviderMatch,
} from "@oceanprotocol/lib";
import {
  parseResourceSpecs,
  buildParamsFromFlags,
  hasSearchFlags,
  buildRows,
  applyMaxPrice,
  filterMatches,
  orderRows,
  providerSummaryLine,
  describeRowResources,
} from "../src/searchResourcesHelpers.js";

// A fabricated compute environment builder — no network, no infra.
function makeEnv(overrides: Partial<ComputeEnvironment> = {}): ComputeEnvironment {
  return {
    id: "env-1",
    consumerAddress: "0xconsumer",
    runningJobs: 0,
    fees: {},
    resources: [
      { id: "cpu", type: "cpu", max: 8, inUse: 2 },
      { id: "ram", type: "ram", max: 32, inUse: 0 },
    ],
    ...overrides,
  } as ComputeEnvironment;
}

function makeMatch(
  nodeId: string,
  environments: ComputeEnvironment[],
): ComputeProviderMatch {
  return { node: { nodeId, multiaddress: [] }, environments } as ComputeProviderMatch;
}

describe("searchResources flag parsing", () => {
  it("parses name:amount resource specs", () => {
    expect(parseResourceSpecs(["fpga:2", "tpu:1"])).to.deep.equal([
      { resource: "fpga", value: 2 },
      { resource: "tpu", value: 1 },
    ]);
  });

  it("rejects malformed resource specs", () => {
    expect(() => parseResourceSpecs(["fpga"])).to.throw();
    expect(() => parseResourceSpecs(["fpga:0"])).to.throw();
    expect(() => parseResourceSpecs(["FP GA:2"])).to.throw();
  });

  it("hasSearchFlags is true only when a resource flag is present", () => {
    expect(hasSearchFlags({})).to.equal(false);
    expect(hasSearchFlags({ cpu: "2" })).to.equal(true);
    expect(hasSearchFlags({ resource: ["fpga:2"] })).to.equal(true);
  });

  it("builds params from flags with defaults", () => {
    const params = buildParamsFromFlags(
      { cpu: "4", gpu: "1", gpuModel: "A100" },
      137,
    );
    expect(params.resources).to.deep.equal([
      { resource: "cpu", value: 4 },
      { resource: "gpu", value: 1 },
    ]);
    expect(params.models).to.deep.equal({ gpu: "A100" });
    expect(params.mode).to.equal("both"); // default tier
    expect(params.chains).to.deep.equal([{ chainId: 137, tokens: undefined }]); // default chain = RPC chainId
    expect(params.orderBy).to.equal("price"); // default for non-free
  });

  it("parses multiple chains and applies token list to each", () => {
    const params = buildParamsFromFlags(
      { cpu: "1", chain: "8996, 137", token: "0xA,0xB" },
      1,
    );
    expect(params.chains).to.deep.equal([
      { chainId: 8996, tokens: ["0xA", "0xB"] },
      { chainId: 137, tokens: ["0xA", "0xB"] },
    ]);
  });

  it("defaults orderBy to freeCapacity for free-only searches", () => {
    const params = buildParamsFromFlags({ cpu: "1", free: true }, 1);
    expect(params.mode).to.equal("free");
    expect(params.orderBy).to.equal("freeCapacity");
  });

  it("throws when no resources are requested", () => {
    expect(() => buildParamsFromFlags({ free: true }, 1)).to.throw();
  });
});

describe("searchResources row building and ordering", () => {
  const params = {
    resources: [{ resource: "cpu", value: 2 }],
    mode: "paid" as const,
    chains: [{ chainId: 8996 }],
    durationSeconds: 60,
    orderBy: "price" as const,
  };

  it("prices paid envs and picks the cheapest token", () => {
    const env = makeEnv({
      fees: {
        "8996": [
          { feeToken: "0xTOKEN_A", prices: [{ id: "cpu", price: 3 }] },
          { feeToken: "0xTOKEN_B", prices: [{ id: "cpu", price: 1 }] },
        ],
      },
    });
    const rows = buildRows([makeMatch("nodeA", [env])], "paid", params);
    expect(rows).to.have.length(1);
    // cheapest token B: price 1 * amount 2 * ceil(60/60)=1 minute = 2
    expect(rows[0].estCost).to.equal(2);
    expect(rows[0].token).to.equal("0xTOKEN_B");
    expect(rows[0].chainId).to.equal(8996);
  });

  it("fans out one row per requested chain the env prices on", () => {
    const env = makeEnv({
      fees: {
        "8996": [{ feeToken: "0xA", prices: [{ id: "cpu", price: 5 }] }],
        "137": [{ feeToken: "0xB", prices: [{ id: "cpu", price: 1 }] }],
      },
    });
    const multi = {
      ...params,
      chains: [{ chainId: 8996 }, { chainId: 137 }],
    };
    const rows = buildRows([makeMatch("n", [env])], "paid", multi);
    // One row per chain (same env, compared side by side), in requested-chain order.
    expect(rows).to.have.length(2);
    expect(rows[0].chainId).to.equal(8996);
    expect(rows[0].estCost).to.equal(10); // 5 * 2 * 1
    expect(rows[0].token).to.equal("0xA");
    expect(rows[1].chainId).to.equal(137);
    expect(rows[1].estCost).to.equal(2); // 1 * 2 * 1
    expect(rows[1].token).to.equal("0xB");
    // Ordering by price then interleaves them across envs as usual.
    const ordered = orderRows(rows, "price");
    expect(ordered[0].chainId).to.equal(137); // cheapest first
  });

  it("emits a single unpriced row when the env prices on no requested chain", () => {
    const env = makeEnv({
      id: "elsewhere",
      fees: { "8453": [{ feeToken: "0xB", prices: [{ id: "cpu", price: 1 }] }] },
    });
    const rows = buildRows([makeMatch("n", [env])], "paid", {
      ...params,
      chains: [{ chainId: 8996 }, { chainId: 137 }],
    });
    expect(rows).to.have.length(1);
    expect(rows[0].estCost).to.equal(null);
    expect(rows[0].pricedOnChains).to.deep.equal(["8453"]); // surfaced for the "prices elsewhere" hint
  });

  it("honors a per-chain token filter when pricing", () => {
    const env = makeEnv({
      fees: {
        "8996": [
          { feeToken: "0xCHEAP", prices: [{ id: "cpu", price: 1 }] },
          { feeToken: "0xWANT", prices: [{ id: "cpu", price: 4 }] },
        ],
      },
    });
    const filtered = {
      ...params,
      chains: [{ chainId: 8996, tokens: ["0xwant"] }], // case-insensitive
    };
    const rows = buildRows([makeMatch("n", [env])], "paid", filtered);
    // 0xCHEAP is excluded by the filter, so 0xWANT wins: 4 * 2 * 1 = 8
    expect(rows[0].estCost).to.equal(8);
    expect(rows[0].token).to.equal("0xWANT");
  });

  it("leaves estCost null when the env cannot be priced", () => {
    const rows = buildRows([makeMatch("nodeA", [makeEnv()])], "paid", params);
    expect(rows[0].estCost).to.equal(null);
  });

  it("applyMaxPrice drops unpriced and over-cap rows", () => {
    const cheap = makeEnv({
      id: "cheap",
      fees: { "8996": [{ feeToken: "0xT", prices: [{ id: "cpu", price: 1 }] }] },
    });
    const dear = makeEnv({
      id: "dear",
      fees: { "8996": [{ feeToken: "0xT", prices: [{ id: "cpu", price: 100 }] }] },
    });
    const rows = buildRows(
      [makeMatch("n1", [cheap]), makeMatch("n2", [dear])],
      "paid",
      params,
    );
    const kept = applyMaxPrice(rows, 10);
    expect(kept.map((r) => r.env.id)).to.deep.equal(["cheap"]);
  });

  it("orders by price ascending with unpriced last", () => {
    const priced = makeEnv({
      id: "priced",
      fees: { "8996": [{ feeToken: "0xT", prices: [{ id: "cpu", price: 5 }] }] },
    });
    const rows = buildRows(
      [makeMatch("n1", [makeEnv({ id: "free-of-price" })]), makeMatch("n2", [priced])],
      "paid",
      params,
    );
    const ordered = orderRows(rows, "price");
    expect(ordered[0].env.id).to.equal("priced");
    expect(ordered[1].estCost).to.equal(null);
  });

  it("orders by leastBusy", () => {
    const busy = makeEnv({ id: "busy", runningJobs: 5 });
    const idle = makeEnv({ id: "idle", runningJobs: 0 });
    const rows = buildRows(
      [makeMatch("n1", [busy]), makeMatch("n2", [idle])],
      "paid",
      params,
    );
    const ordered = orderRows(rows, "leastBusy");
    expect(ordered[0].env.id).to.equal("idle");
  });

  it("matches gpu family ids like gpu-0 and emits a summary line", () => {
    const env = makeEnv({
      id: "gpu-env",
      resources: [{ id: "gpu-0", type: "gpu", max: 4, inUse: 1, description: "A100" }],
    });
    const gpuParams = {
      resources: [{ resource: "gpu", value: 2 }],
      mode: "paid" as const,
      chains: [{ chainId: 8996 }],
      orderBy: "resources" as const,
    };
    const rows = buildRows([makeMatch("gpuNode", [env])], "paid", gpuParams);
    expect(rows[0].availableResources).to.equal(3); // max 4 - inUse 1
    expect(providerSummaryLine(rows[0])).to.contain("env=gpu-env");
    expect(providerSummaryLine(rows[0])).to.contain("tier=paid");
    // A GPU description is surfaced; the generic "fungible" kind is not.
    expect(describeRowResources(rows[0], gpuParams)).to.contain("(A100)");
  });

  it("records accepted tokens per requested chain and all priced chains", () => {
    const env = makeEnv({
      fees: {
        "8996": [
          { feeToken: "0xTOKEN_A", prices: [{ id: "cpu", price: 1 }] },
          { feeToken: "0xTOKEN_B", prices: [{ id: "cpu", price: 2 }] },
        ],
        "137": [{ feeToken: "0xPOLY", prices: [{ id: "cpu", price: 9 }] }],
      },
    });
    const rows = buildRows([makeMatch("n", [env])], "paid", params);
    expect(rows[0].acceptedByChain).to.deep.equal([
      { chainId: 8996, tokens: ["0xTOKEN_A", "0xTOKEN_B"] },
    ]);
    expect(rows[0].pricedOnChains).to.have.members(["8996", "137"]);
  });

  it("filterMatches drops paid envs not priceable under the per-chain token filter", () => {
    const p = { ...params, chains: [{ chainId: 8996, tokens: ["0xwant"] }] }; // case-insensitive
    const a = makeEnv({
      id: "accepts",
      fees: { "8996": [{ feeToken: "0xWANT", prices: [{ id: "cpu", price: 1 }] }] },
    });
    const b = makeEnv({
      id: "rejects",
      fees: { "8996": [{ feeToken: "0xOTHER", prices: [{ id: "cpu", price: 1 }] }] },
    });
    const rows = buildRows([makeMatch("n1", [a]), makeMatch("n2", [b])], "paid", p);
    expect(filterMatches(rows, p).map((r) => r.env.id)).to.deep.equal(["accepts"]);
    // No token filter -> both price on the requested chain, so both kept.
    const p2 = { ...params, chains: [{ chainId: 8996 }] };
    const rows2 = buildRows([makeMatch("n1", [a]), makeMatch("n2", [b])], "paid", p2);
    expect(filterMatches(rows2, p2)).to.have.length(2);
  });

  it("filterMatches drops paid envs that price on no requested chain", () => {
    const env = makeEnv({
      id: "elsewhere",
      fees: { "8453": [{ feeToken: "0xB", prices: [{ id: "cpu", price: 1 }] }] },
    });
    const p = { ...params, chains: [{ chainId: 8996 }] };
    const rows = buildRows([makeMatch("n", [env])], "paid", p);
    expect(rows).to.have.length(1); // buildRows keeps the unpriced fallback row
    expect(filterMatches(rows, p)).to.have.length(0); // ...which filterMatches then drops
  });

  it("filterMatches drops envs whose resources fall short of the request", () => {
    const enough = makeEnv({
      id: "enough",
      resources: [{ id: "cpu", type: "cpu", max: 4 }],
      fees: { "8996": [{ feeToken: "0xT", prices: [{ id: "cpu", price: 1 }] }] },
    });
    const short = makeEnv({
      id: "short",
      resources: [{ id: "cpu", type: "cpu", max: 0 }], // max 0 < requested 2
      fees: { "8996": [{ feeToken: "0xT", prices: [{ id: "cpu", price: 1 }] }] },
    });
    const rows = buildRows([makeMatch("n", [enough, short])], "paid", params);
    expect(filterMatches(rows, params).map((r) => r.env.id)).to.deep.equal([
      "enough",
    ]);
  });

  it("hides generic fungible/non-fungible kinds but keeps real descriptions", () => {
    const env = makeEnv({
      resources: [
        { id: "cpu", type: "cpu", max: 140, kind: "fungible" },
        { id: "disk", type: "disk", max: 2000, kind: "fungible" },
      ],
    });
    const p = {
      resources: [
        { resource: "cpu", value: 1 },
        { resource: "disk", value: 1 },
      ],
      mode: "paid" as const,
      chains: [{ chainId: 8996 }],
      orderBy: "resources" as const,
    };
    const rows = buildRows([makeMatch("n", [env])], "paid", p);
    const desc = describeRowResources(rows[0], p);
    expect(desc).to.not.contain("fungible");
    expect(desc).to.contain("cpu: need 1, max 140");
    expect(desc).to.contain("disk: need 1, max 2000");
  });
});
