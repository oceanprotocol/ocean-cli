import { expect } from "chai";
import { getAddress } from "ethers";
import { mergeSavedSubsidyProviders } from "../src/helpers.js";

/**
 * Infra-free unit tests for the pure subsidy-merge helper (§6.6). No network, no config
 * file — just the rules that decide what the compute/service flow sends the node.
 */
describe("mergeSavedSubsidyProviders (pure)", function () {
  const CHAIN = 8453;
  // Lowercase inputs on purpose — the helper normalizes to EIP-55.
  const A = "0x1111111111111111111111111111111111111111";
  const B = "0x2222222222222222222222222222222222222222";
  const C = "0x3333333333333333333333333333333333333333";
  const cs = (a: string) => getAddress(a);

  it("passes an explicit list through unchanged (flag wins)", function () {
    const m = mergeSavedSubsidyProviders(
      [cs(A)],
      CHAIN,
      { [String(CHAIN)]: [B] },
      false,
      [C],
    );
    expect(m.effective).to.deep.equal([cs(A)]);
    expect(m.added).to.deep.equal([]);
    expect(m.droppedByFilter).to.deep.equal([]);
  });

  it("passes an explicit empty list (none) through unchanged", function () {
    const m = mergeSavedSubsidyProviders([], CHAIN, undefined, false, [A]);
    expect(m.effective).to.deep.equal([]);
  });

  it("returns undefined when there are no enabled saved providers", function () {
    const m = mergeSavedSubsidyProviders(
      undefined,
      CHAIN,
      { [String(CHAIN)]: [A] },
      false,
      [],
    );
    expect(m.effective).to.equal(undefined);
    expect(m.added).to.deep.equal([]);
  });

  it("filter off: adds a saved provider the node does not advertise", function () {
    const m = mergeSavedSubsidyProviders(
      undefined,
      CHAIN,
      { [String(CHAIN)]: [A] },
      false,
      [B],
    );
    expect(m.effective).to.deep.equal([cs(A), cs(B)]); // advertised first, then added
    expect(m.added).to.deep.equal([cs(B)]);
    expect(m.droppedByFilter).to.deep.equal([]);
  });

  it("filter off: returns undefined when every saved provider is already advertised", function () {
    const m = mergeSavedSubsidyProviders(
      undefined,
      CHAIN,
      { [String(CHAIN)]: [A, B] },
      false,
      [A],
    );
    expect(m.effective).to.equal(undefined);
    expect(m.added).to.deep.equal([]);
  });

  it("filter on: drops a saved provider the node does not advertise", function () {
    const m = mergeSavedSubsidyProviders(
      undefined,
      CHAIN,
      { [String(CHAIN)]: [A] },
      true,
      [B],
    );
    expect(m.effective).to.equal(undefined); // nothing added under a filter
    expect(m.added).to.deep.equal([]);
    expect(m.droppedByFilter).to.deep.equal([cs(B)]);
  });

  it("filter on: no change when the saved provider is already advertised", function () {
    const m = mergeSavedSubsidyProviders(
      undefined,
      CHAIN,
      { [String(CHAIN)]: [A, B] },
      true,
      [A],
    );
    expect(m.effective).to.equal(undefined);
    expect(m.added).to.deep.equal([]);
    expect(m.droppedByFilter).to.deep.equal([]);
  });

  it("normalizes advertised and saved addresses to EIP-55 and dedupes case-insensitively", function () {
    // Addresses WITH letters, so the checksum casing actually differs from the input
    // (the all-digit A/B/C above never exercise getAddress normalization).
    const advLower = "0xabc0000000000000000000000000000000000001";
    const advUpper = "0xABC0000000000000000000000000000000000001";
    const savedLower = "0xdef0000000000000000000000000000000000002";
    const savedUpper = "0xDEF0000000000000000000000000000000000002";
    const m = mergeSavedSubsidyProviders(
      undefined,
      CHAIN,
      { [String(CHAIN)]: [advUpper] }, // node advertises it in a different casing
      false,
      [savedLower, savedUpper], // same saved provider twice, different casing
    );
    // Checksummed, advertised first, the duplicate saved entry collapsed to one.
    expect(m.effective).to.deep.equal([cs(advLower), cs(savedLower)]);
    expect(cs(advLower)).to.not.equal(advLower); // proves normalization changed the input
    expect(m.added).to.deep.equal([cs(savedLower)]);
  });
});
