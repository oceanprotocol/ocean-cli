import { expect } from "chai";
import { parseSubsidyProviders } from "../src/helpers.js";

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
