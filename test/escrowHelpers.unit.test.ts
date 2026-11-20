import { expect } from "chai";
import { createRequire } from "module";
import { AbiCoder, Interface } from "ethers";
import { legacyEscrowAbi, withIndefiniteExpiry } from "../src/escrowHelpers.js";
import { toTokenPrecision } from "../src/serviceHelpers.js";

// Pure unit tests — no infra needed.
const require = createRequire(import.meta.url);
const {
  abi,
} = require("@oceanprotocol/contracts/artifacts/contracts/escrow/Escrow.sol/Escrow.json");

const PAYEE = "0x4Fd5ECf4Af8490418462A7d80e90A0530eFb9ac5";
const coder = AbiCoder.defaultAbiCoder();
// What a legacy (v1) escrow returns: auth[] with six fields, no expiryTimestamp.
const legacyReply = coder.encode(
  ["tuple(address,uint256,uint256,uint256,uint256,uint256)[]"],
  [[[PAYEE, 100n, 5n, 3600n, 10n, 1n]]],
);
const v2Reply = coder.encode(
  ["tuple(address,uint256,uint256,uint256,uint256,uint256,uint256)[]"],
  [[[PAYEE, 100n, 5n, 3600n, 10n, 1n, 1234n]]],
);

describe("legacyEscrowAbi", () => {
  it("drops only expiryTimestamp from the getAuthorizations tuple", () => {
    const legacy = legacyEscrowAbi(abi);
    expect(legacy).to.have.length(abi.length);
    const fields = (list: any[]) =>
      list
        .find((e) => e.name === "getAuthorizations")
        .outputs[0].components.map((c: any) => c.name);
    expect(fields(abi)).to.include("expiryTimestamp");
    expect(fields(legacy)).to.deep.equal([
      "payee",
      "maxLockedAmount",
      "currentLockedAmount",
      "maxLockSeconds",
      "maxLockCounts",
      "currentLocks",
    ]);
    // Every other entry is passed through untouched (authorize keeps its v2 signature).
    const others = (list: any[]) =>
      list.filter((e) => e.name !== "getAuthorizations");
    expect(others(legacy)).to.deep.equal(others(abi));
  });

  it("decodes a legacy reply the default ABI cannot", () => {
    expect(() =>
      new Interface(abi).decodeFunctionResult("getAuthorizations", legacyReply),
    ).to.throw();
    const [auths] = new Interface(legacyEscrowAbi(abi)).decodeFunctionResult(
      "getAuthorizations",
      legacyReply,
    );
    expect(auths).to.have.length(1);
    expect(auths[0].payee).to.equal(PAYEE);
    expect(auths[0].maxLockedAmount).to.equal(100n);
    expect(auths[0].currentLocks).to.equal(1n);
    // The raw six-field Result throws on index 6, so the usual
    // `expiryTimestamp ?? [6] ?? 0` fallback only works on the normalized shape.
    expect(() => auths[0][6]).to.throw(RangeError);
    const auth = withIndefiniteExpiry(auths[0]);
    expect(Number(auth.expiryTimestamp ?? auth[6] ?? "0")).to.equal(0);
    expect(auth[6]).to.equal(0n);
    expect(auth).to.have.length(7);
    expect(auth.payee).to.equal(PAYEE);
    expect(auth[1]).to.equal(100n);
    expect(auth.currentLockedAmount).to.equal(5n);
    expect(auth.maxLockSeconds).to.equal(3600n);
    expect(auth.maxLockCounts).to.equal(10n);
    expect(auth.currentLocks).to.equal(1n);
  });

  it("leaves the default ABI reading a v2 reply with its expiry", () => {
    const [auths] = new Interface(abi).decodeFunctionResult(
      "getAuthorizations",
      v2Reply,
    );
    expect(auths[0].expiryTimestamp).to.equal(1234n);
  });
});

describe("toTokenPrecision", () => {
  it("trims float artifacts to the token's decimals", () => {
    expect(String(0.1 + 0.2)).to.equal("0.30000000000000004");
    expect(toTokenPrecision(0.1 + 0.2, 6)).to.equal("0.300000");
    expect(toTokenPrecision(1.0000005, 6)).to.equal("1.000001");
    expect(toTokenPrecision(12.5, 18)).to.equal("12.500000000000000000");
  });

  it("never emits exponent notation", () => {
    expect(String(1e-7)).to.equal("1e-7");
    expect(toTokenPrecision(1e-7, 6)).to.equal("0.000000");
    expect(toTokenPrecision(1e-7, 18)).to.equal("0.000000100000000000");
  });

  it("handles zero-decimal tokens and rejects bad amounts", () => {
    expect(toTokenPrecision(2.4, 0)).to.equal("2");
    expect(() => toTokenPrecision(NaN, 6)).to.throw("Invalid cost amount");
    expect(() => toTokenPrecision(-1, 6)).to.throw("Invalid cost amount");
  });
});
