import { expect } from "chai";
import {
  parseAuthTokenOptions,
  DEFAULT_AUTH_TOKEN_TTL_SECONDS,
} from "../src/helpers.js";

/**
 * Infra-free unit tests for the pure `parseAuthTokenOptions` helper that turns
 * the raw `generateAuthToken` CLI flags into the ocean.js `AuthTokenOptions`.
 * No network, no node, no signer — just the parsing/clamping rules.
 */
describe("parseAuthTokenOptions (pure)", function () {
  const nowish = (ms: number) => Math.abs(ms - Date.now()) < 5000;

  it("defaults to a 1h lifetime when nothing is passed", function () {
    const o = parseAuthTokenOptions({});
    expect(nowish(o.validUntil - DEFAULT_AUTH_TOKEN_TTL_SECONDS * 1000)).to.be
      .true;
    expect(o.audience).to.equal(undefined);
    expect(o.scope).to.equal(undefined);
    expect(o.allowUnverifiedIssuer).to.equal(undefined);
  });

  it("honors an explicit --ttl (seconds)", function () {
    const o = parseAuthTokenOptions({ ttl: "900" });
    expect(nowish(o.validUntil - 900 * 1000)).to.be.true;
  });

  it("--valid-until overrides --ttl and is taken verbatim", function () {
    const abs = Date.now() + 2 * 3600 * 1000; // a clearly-future epoch-ms
    const o = parseAuthTokenOptions({ ttl: "900", validUntil: String(abs) });
    expect(o.validUntil).to.equal(abs);
  });

  it("clamps only the DEFAULT lifetime to the node cap", function () {
    const o = parseAuthTokenOptions({}, 600); // cap 10 min < 1h default
    expect(nowish(o.validUntil - 600 * 1000)).to.be.true;
  });

  it("does NOT clamp an explicit --ttl (lib surfaces the cap error)", function () {
    const o = parseAuthTokenOptions({ ttl: "7200" }, 600);
    expect(nowish(o.validUntil - 7200 * 1000)).to.be.true;
  });

  it("parses an audience peerId list", function () {
    const o = parseAuthTokenOptions({ audience: "peerA, peerB ,peerC" });
    expect(o.audience).to.deep.equal(["peerA", "peerB", "peerC"]);
  });

  it("maps audience 'any' (any case) to the unrestricted sentinel", function () {
    expect(parseAuthTokenOptions({ audience: "any" }).audience).to.equal("any");
    expect(parseAuthTokenOptions({ audience: "ANY" }).audience).to.equal("any");
  });

  it("parses a scope command list", function () {
    const o = parseAuthTokenOptions({ scope: "download, getDDO" });
    expect(o.scope).to.deep.equal(["download", "getDDO"]);
  });

  it("passes allowUnverifiedIssuer through only when truthy", function () {
    expect(
      parseAuthTokenOptions({ allowUnverifiedIssuer: true }).allowUnverifiedIssuer,
    ).to.equal(true);
    expect(parseAuthTokenOptions({}).allowUnverifiedIssuer).to.equal(undefined);
  });

  it("rejects a non-positive / non-integer --valid-until", function () {
    expect(() => parseAuthTokenOptions({ validUntil: "0" })).to.throw(
      "--valid-until",
    );
    expect(() => parseAuthTokenOptions({ validUntil: "-5" })).to.throw(
      "--valid-until",
    );
    expect(() => parseAuthTokenOptions({ validUntil: "abc" })).to.throw(
      "--valid-until",
    );
  });

  it("rejects a non-positive --ttl", function () {
    expect(() => parseAuthTokenOptions({ ttl: "0" })).to.throw("--ttl");
    expect(() => parseAuthTokenOptions({ ttl: "nope" })).to.throw("--ttl");
  });

  it("rejects a --valid-until in the past (seconds-vs-ms footgun)", function () {
    // ~epoch seconds for a current date ⇒ a 1970 ms date
    expect(() => parseAuthTokenOptions({ validUntil: "1793456789" })).to.throw(
      /future/i,
    );
    expect(() =>
      parseAuthTokenOptions({ validUntil: String(Date.now() - 1000) }),
    ).to.throw(/future/i);
  });

  it("falls back to the default when ttl/validUntil are blank/whitespace", function () {
    for (const raw of [
      { ttl: "" },
      { ttl: "   " },
      { validUntil: "" },
    ]) {
      const o = parseAuthTokenOptions(raw);
      expect(nowish(o.validUntil - DEFAULT_AUTH_TOKEN_TTL_SECONDS * 1000)).to.be
        .true;
    }
  });

  it("invalid --valid-until throws even when a valid --ttl is present (no silent fallthrough)", function () {
    expect(() =>
      parseAuthTokenOptions({ validUntil: "abc", ttl: "900" }),
    ).to.throw("--valid-until");
  });

  it("accepts numeric (non-string) ttl and validUntil inputs", function () {
    expect(nowish(parseAuthTokenOptions({ ttl: 900 }).validUntil - 900 * 1000))
      .to.be.true;
    const abs = Date.now() + 10 * 60 * 1000;
    expect(parseAuthTokenOptions({ validUntil: abs }).validUntil).to.equal(abs);
  });

  it("leaves audience/scope undefined for blank input (never an empty array)", function () {
    const o = parseAuthTokenOptions({ audience: "  ", scope: "" });
    expect(o.audience).to.equal(undefined);
    expect(o.scope).to.equal(undefined);
  });

  it("throws when audience/scope are only separators (empty after filtering)", function () {
    expect(() => parseAuthTokenOptions({ audience: " , " })).to.throw(
      "--audience",
    );
    expect(() => parseAuthTokenOptions({ scope: ",," })).to.throw("--scope");
  });

  it("clamp only triggers for the default and only when cap is shorter", function () {
    // cap >= default: no clamp
    expect(
      nowish(
        parseAuthTokenOptions({}, 7200).validUntil -
          DEFAULT_AUTH_TOKEN_TTL_SECONDS * 1000,
      ),
    ).to.be.true;
    // cap 0 / undefined: ignored
    expect(
      nowish(
        parseAuthTokenOptions({}, 0).validUntil -
          DEFAULT_AUTH_TOKEN_TTL_SECONDS * 1000,
      ),
    ).to.be.true;
    // explicit ttl is never clamped even below cap
    expect(nowish(parseAuthTokenOptions({ ttl: "3600" }, 600).validUntil - 3600 * 1000))
      .to.be.true;
  });

  it("always produces an integer validUntil", function () {
    expect(Number.isInteger(parseAuthTokenOptions({ ttl: "0.5" }).validUntil)).to
      .be.true;
  });

  it("builds a fully-populated options object", function () {
    const abs = Date.now() + 60_000;
    const o = parseAuthTokenOptions({
      validUntil: String(abs),
      audience: "peerA,peerB",
      scope: "download",
      allowUnverifiedIssuer: true,
    });
    expect(o).to.deep.equal({
      validUntil: abs,
      audience: ["peerA", "peerB"],
      scope: ["download"],
      allowUnverifiedIssuer: true,
    });
  });
});
