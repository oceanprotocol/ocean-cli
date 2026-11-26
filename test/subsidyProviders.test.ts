import { expect } from "chai";
import {
  parseSubsidyProviders,
  prefundedLockUnits,
  resolveSubsidyProviderAddresses,
} from "../src/helpers.js";

// Pure unit test — no infra needed. Verifies the tri-state parsing of the
// `--subsidyProviders` CLI value and EIP-55 address normalization.
describe("parseSubsidyProviders", () => {
  it("returns undefined when the flag is omitted (node default)", () => {
    expect(parseSubsidyProviders(undefined)).to.equal(undefined);
  });

  it("returns [] for 'none' (explicitly no subsidy)", () => {
    expect(parseSubsidyProviders("none")).to.deep.equal([]);
    expect(parseSubsidyProviders("NONE")).to.deep.equal([]);
  });

  it("returns [] for an empty / whitespace string", () => {
    expect(parseSubsidyProviders("")).to.deep.equal([]);
    expect(parseSubsidyProviders("   ")).to.deep.equal([]);
  });

  it("parses a single address", () => {
    const a = "0x4344d4bc29531db736378e9a3da85bf1eff0cb22";
    expect(parseSubsidyProviders(a)).to.deep.equal([
      "0x4344D4Bc29531DB736378e9A3dA85BF1eff0CB22",
    ]);
  });

  it("parses and normalizes a comma-separated list, trimming whitespace", () => {
    const raw =
      " 0x4344d4bc29531db736378e9a3da85bf1eff0cb22 , 0x0000000000000000000000000000000000000001 ";
    expect(parseSubsidyProviders(raw)).to.deep.equal([
      "0x4344D4Bc29531DB736378e9A3dA85BF1eff0CB22",
      "0x0000000000000000000000000000000000000001",
    ]);
  });

  it("throws on a malformed address", () => {
    expect(() => parseSubsidyProviders("0xnot-an-address")).to.throw();
  });
});

// Pure unit test — no infra needed. `prefundedLockUnits` reads an ocean.js
// `estimateJobSubsidy` result and returns how much of the lock is pre-funded.
describe("prefundedLockUnits", () => {
  const A = "0x4344D4Bc29531DB736378e9A3dA85BF1eff0CB22";
  const B = "0x0000000000000000000000000000000000000001";
  const C = "0x0000000000000000000000000000000000000002";
  const DECIMALS = 6;
  const LOCK = 400000n; // 0.4

  const quote = (address: string, prefunded: string, eligible = true) => ({
    address,
    subsidyKind: null,
    version: 2,
    isV2: true,
    gates: {
      imageAllowed: eligible,
      isNodeAllowed: true,
      isUserAllowed: true,
      isJobTypeSubsidized: true,
    },
    eligible,
    ...(eligible ? {} : { dropped: "image_not_allowed" as const }),
    quotes: {
      reimbursement: { subsidy: "0", bonus: "0" },
      prefunded: { subsidy: prefunded, bonus: "0" },
    },
  });

  const estimate = (
    providers: ReturnType<typeof quote>[],
    selected: string[],
    projected: string,
    maxSponsorsPerLock = 10,
  ) => ({
    providers,
    maxSponsorsPerLock,
    scenarios: {
      reimbursement: {
        mode: 0,
        selected: [],
        projectedTotalSubsidy: "0",
        meetsSubsidyNeeded: false,
        escrowNeeded: "0.4",
        escrowAvailable: "0",
        escrowShortfall: "0.4",
      },
      prefunded: {
        mode: 1,
        selected,
        projectedTotalSubsidy: projected,
        meetsSubsidyNeeded: true,
        escrowNeeded: "0",
        escrowAvailable: "0",
        escrowShortfall: "0",
      },
    },
  });

  it("uses the node-set projection when the flag is omitted (full cover)", () => {
    const e = estimate([quote(A, "0.4")], [A], "0.4");
    expect(prefundedLockUnits(e, undefined, DECIMALS, LOCK)).to.equal(LOCK);
  });

  it("returns the partial cover, leaving the rest to the payer", () => {
    const e = estimate([quote(A, "0.1")], [A], "0.1");
    expect(prefundedLockUnits(e, undefined, DECIMALS, LOCK)).to.equal(100000n);
  });

  it("returns 0 for an explicit empty list (no subsidy)", () => {
    const e = estimate([quote(A, "0.4")], [A], "0.4");
    expect(prefundedLockUnits(e, [], DECIMALS, LOCK)).to.equal(0n);
  });

  it("returns 0 when nothing is pre-funded (refund-only or no lock-subsidy escrow)", () => {
    const e = estimate([quote(A, "0")], [], "0");
    expect(prefundedLockUnits(e, undefined, DECIMALS, LOCK)).to.equal(0n);
    expect(prefundedLockUnits(e, [A], DECIMALS, LOCK)).to.equal(0n);
  });

  it("counts only the providers the user named, not the rest of the node's set", () => {
    const e = estimate([quote(A, "0.3"), quote(B, "0.1")], [A, B], "0.4");
    expect(prefundedLockUnits(e, [B], DECIMALS, LOCK)).to.equal(100000n);
    expect(
      prefundedLockUnits(e, [B.toLowerCase(), A], DECIMALS, LOCK),
    ).to.equal(LOCK);
  });

  it("ignores a named provider the estimate dropped", () => {
    const e = estimate([quote(A, "0.3", false), quote(B, "0.1")], [B], "0.1");
    expect(prefundedLockUnits(e, [A, B], DECIMALS, LOCK)).to.equal(100000n);
  });

  it("counts only the first maxSponsorsPerLock named providers", () => {
    const e = estimate(
      [quote(A, "0.1"), quote(B, "0.1"), quote(C, "0.1")],
      [A, B],
      "0.2",
      2,
    );
    expect(prefundedLockUnits(e, [A, B, C], DECIMALS, LOCK)).to.equal(200000n);
  });

  it("caps the result at the node's lock amount", () => {
    const e = estimate([quote(A, "0.9")], [A], "0.9");
    expect(prefundedLockUnits(e, undefined, DECIMALS, LOCK)).to.equal(LOCK);
    expect(prefundedLockUnits(e, [A], DECIMALS, LOCK)).to.equal(LOCK);
  });
});

// Which provider contracts `getNodeSubsidyStatus` reports on: the node's advertised list and the
// caller's `--subsidy` list, mixed according to the node's provider filter.
describe("resolveSubsidyProviderAddresses", () => {
  const CHAIN = 8453;
  const A = "0x4Fd5ECf4Af8490418462A7d80e90A0530eFb9ac5";
  const B = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const node = (list: string[]) => ({ [String(CHAIN)]: list });

  it("filter off: queries a named provider even when the node advertises none", () => {
    for (const providers of [node([]), {}, undefined]) {
      expect(
        resolveSubsidyProviderAddresses(
          CHAIN,
          providers,
          false,
          A.toLowerCase(),
        ),
      ).to.deep.equal({ addresses: [A], notAdvertised: [A], ignored: [] });
    }
  });

  it("filter off: allows named providers outside the node list and flags them", () => {
    expect(
      resolveSubsidyProviderAddresses(
        CHAIN,
        node([A]),
        false,
        `${A}, ${B},${A}`,
      ),
    ).to.deep.equal({ addresses: [A, B], notAdvertised: [B], ignored: [] });
  });

  it("filter off: no --subsidy and an empty node list errors with a --subsidy hint", () => {
    expect(() => resolveSubsidyProviderAddresses(CHAIN, node([]), false))
      .to.throw("has no subsidy providers configured on chain 8453")
      .and.to.match(/--subsidy/);
  });

  it("no --subsidy: returns the node's de-duplicated list, whatever the filter", () => {
    for (const filter of [false, true]) {
      expect(
        resolveSubsidyProviderAddresses(
          CHAIN,
          node([A.toLowerCase(), A, B]),
          filter,
          "  ",
        ),
      ).to.deep.equal({ addresses: [A, B], notAdvertised: [], ignored: [] });
    }
  });

  it("filter on: narrows --subsidy to the node list and reports the rest", () => {
    expect(
      resolveSubsidyProviderAddresses(CHAIN, node([A]), true, `${A},${B}`),
    ).to.deep.equal({ addresses: [A], notAdvertised: [], ignored: [B] });
  });

  it("filter on: errors when no named provider is advertised", () => {
    expect(() =>
      resolveSubsidyProviderAddresses(CHAIN, node([A]), true, B),
    ).to.throw("None of the --subsidy addresses are advertised");
  });

  it("filter on: an empty node list is unsupported, even with --subsidy", () => {
    expect(() =>
      resolveSubsidyProviderAddresses(CHAIN, node([]), true, A),
    ).to.throw("does not support subsidy providers on chain 8453");
  });

  it("only reads the requested chain", () => {
    expect(() => resolveSubsidyProviderAddresses(1, node([A]), false)).to.throw(
      "no subsidy providers configured on chain 1",
    );
  });

  it("throws a readable error on a malformed --subsidy address", () => {
    expect(() =>
      resolveSubsidyProviderAddresses(CHAIN, node([A]), false, "0xnope"),
    ).to.throw("Invalid --subsidy address '0xnope'");
  });
});
