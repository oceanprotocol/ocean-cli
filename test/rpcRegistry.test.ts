import { expect } from "chai";
import { FallbackProvider, JsonRpcProvider } from "ethers";
import fs from "fs";
import os from "os";
import path from "path";
import {
  parseRpcEnv,
  buildFallbackConfigs,
  loadRegistry,
  getProvider,
  verifyChain,
  listChains,
  hasChain,
  getDefaultChainId,
  addChain,
  removeChain,
  setDefaultChainId,
  resolveDefaultChain,
  __setChainProbeForTests,
  __resetRegistryForTests,
} from "../src/rpcRegistry.js";

// Pure unit tests — no live network. Provider construction is lazy in ethers v6, and
// the chainId verification path is exercised through an injected probe seam
// (__setChainProbeForTests), so nothing here dials an RPC.

describe("rpcRegistry — parseRpcEnv", function () {
  it("keeps a legacy single-URL string verbatim (backwards compatible)", function () {
    const parsed = parseRpcEnv("http://localhost:8545");
    expect(parsed.legacyUrl).to.equal("http://localhost:8545");
    expect(parsed.chains.size).to.equal(0);
  });

  it("rejects a malformed legacy single URL (fail-fast, not deferred)", function () {
    expect(() => parseRpcEnv("not-a-url")).to.throw(/not a valid/i);
    expect(() => parseRpcEnv("ftp://nope.example")).to.throw(/not a valid/i);
  });

  it("throws the verbatim message when RPC is unset", function () {
    expect(() => parseRpcEnv(undefined)).to.throw(
      "Have you forgot to set env RPC?",
    );
    expect(() => parseRpcEnv("   ")).to.throw("Have you forgot to set env RPC?");
  });

  it("parses a JSON map with string and array values", function () {
    const parsed = parseRpcEnv(
      '{"1":"https://eth.example","8453":["https://a.example","https://b.example"]}',
    );
    expect(parsed.legacyUrl).to.equal(undefined);
    expect([...parsed.chains.get(1)!]).to.deep.equal(["https://eth.example"]);
    expect([...parsed.chains.get(8453)!]).to.deep.equal([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("de-dupes URLs within a chain while preserving order", function () {
    const parsed = parseRpcEnv(
      '{"8996":["http://a.example","http://b.example","http://a.example"]}',
    );
    expect(parsed.chains.get(8996)).to.deep.equal([
      "http://a.example",
      "http://b.example",
    ]);
  });

  it("accepts ws(s) URLs", function () {
    const parsed = parseRpcEnv('{"1":"wss://eth.example/ws"}');
    expect(parsed.chains.get(1)).to.deep.equal(["wss://eth.example/ws"]);
  });

  it("rejects a top-level array", function () {
    expect(() => parseRpcEnv('["http://a"]')).to.throw(/not an array/i);
  });

  it("rejects an empty object", function () {
    expect(() => parseRpcEnv("{}")).to.throw(/empty/i);
  });

  it("rejects a non-integer / non-positive chainId key", function () {
    expect(() => parseRpcEnv('{"abc":"http://a.example"}')).to.throw(
      /chainId/i,
    );
    expect(() => parseRpcEnv('{"-1":"http://a.example"}')).to.throw(/chainId/i);
  });

  it("rejects an empty url array for a chain", function () {
    expect(() => parseRpcEnv('{"1":[]}')).to.throw(/empty/i);
  });

  it("rejects a non-string url entry", function () {
    expect(() => parseRpcEnv('{"1":[123]}')).to.throw(/invalid url/i);
  });

  it("rejects an invalid (non-http/ws) url", function () {
    expect(() => parseRpcEnv('{"1":"ftp://nope.example"}')).to.throw(
      /invalid url/i,
    );
    expect(() => parseRpcEnv('{"1":"not a url"}')).to.throw(/invalid url/i);
  });

  it("rejects malformed JSON that looks like JSON", function () {
    expect(() => parseRpcEnv('{"1": }')).to.throw(/could not be parsed/i);
  });
});

describe("rpcRegistry — buildFallbackConfigs", function () {
  it("uses quorum:1, ascending priorities, and a per-backend stallTimeout", function () {
    const { configs, options, network } = buildFallbackConfigs(
      ["http://a.example", "http://b.example", "http://c.example"],
      8453,
    );
    expect(options.quorum).to.equal(1);
    expect(configs.map((c) => c.priority)).to.deep.equal([0, 1, 2]);
    for (const c of configs) {
      expect(c.stallTimeout).to.be.a("number").that.is.greaterThan(0);
      expect(c.provider).to.be.instanceOf(JsonRpcProvider);
    }
    expect(Number(network.chainId)).to.equal(8453);
  });
});

describe("rpcRegistry — registry from env", function () {
  const origRpc = process.env.RPC;
  const origFile = process.env.RPC_CONFIG_FILE;
  const origChainId = process.env.CHAIN_ID;

  beforeEach(function () {
    // Isolate from a leaked persisted file / default-chain override so listChains()
    // and getDefaultChainId() assertions here are deterministic.
    process.env.RPC_CONFIG_FILE = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "rpcreg-")),
      "rpc.json",
    );
    delete process.env.CHAIN_ID;
  });

  afterEach(function () {
    __resetRegistryForTests();
    __setChainProbeForTests(null);
    if (origRpc === undefined) delete process.env.RPC;
    else process.env.RPC = origRpc;
    if (origFile === undefined) delete process.env.RPC_CONFIG_FILE;
    else process.env.RPC_CONFIG_FILE = origFile;
    if (origChainId === undefined) delete process.env.CHAIN_ID;
    else process.env.CHAIN_ID = origChainId;
  });

  it("seeds a single-chain map and marks it the default", function () {
    process.env.RPC = '{"8996":["http://localhost:8545"]}';
    loadRegistry(true);
    expect(hasChain(8996)).to.equal(true);
    expect(getDefaultChainId()).to.equal(8996);
    expect(listChains()).to.deep.equal([
      { chainId: 8996, urls: ["http://localhost:8545"] },
    ]);
  });

  it("builds a plain JsonRpcProvider for a single-URL chain", function () {
    process.env.RPC = '{"8996":["http://localhost:8545"]}';
    loadRegistry(true);
    const provider = getProvider(8996);
    expect(provider).to.be.instanceOf(JsonRpcProvider);
  });

  it("builds a FallbackProvider (quorum 1) for a multi-URL chain", function () {
    process.env.RPC =
      '{"8453":["http://a.example","http://b.example"]}';
    loadRegistry(true);
    const provider = getProvider(8453);
    expect(provider).to.be.instanceOf(FallbackProvider);
    const priorities = (provider as FallbackProvider).providerConfigs.map(
      (c) => c.priority,
    );
    expect(priorities).to.deep.equal([0, 1]);
  });

  it("does not set a default when several chains are configured", function () {
    process.env.RPC =
      '{"1":"http://a.example","8453":"http://b.example"}';
    loadRegistry(true);
    expect(getDefaultChainId()).to.equal(undefined);
    expect(listChains().map((c) => c.chainId).sort()).to.deep.equal([1, 8453]);
  });
});

describe("rpcRegistry — verifyChain (mocked probe)", function () {
  const origRpc = process.env.RPC;

  afterEach(function () {
    __resetRegistryForTests();
    __setChainProbeForTests(null);
    if (origRpc === undefined) delete process.env.RPC;
    else process.env.RPC = origRpc;
  });

  it("drops a backend that reports the wrong chainId and keeps the good one", async function () {
    process.env.RPC =
      '{"8453":["http://right.example","http://wrong.example"]}';
    loadRegistry(true);
    __setChainProbeForTests(async (url) =>
      url.includes("right") ? 8453 : 999,
    );
    await verifyChain(8453);
    expect(listChains()).to.deep.equal([
      { chainId: 8453, urls: ["http://right.example"] },
    ]);
  });

  it("hard-errors when every backend is on the wrong chain", async function () {
    process.env.RPC =
      '{"8453":["http://wrong1.example","http://wrong2.example"]}';
    loadRegistry(true);
    __setChainProbeForTests(async () => 111);
    let threw = false;
    try {
      await verifyChain(8453);
    } catch (e) {
      threw = true;
      expect((e as Error).message).to.match(/different chainId/i);
    }
    expect(threw).to.equal(true);
  });

  it("keeps an unreachable backend for runtime failover", async function () {
    process.env.RPC =
      '{"8453":["http://up.example","http://down.example"]}';
    loadRegistry(true);
    __setChainProbeForTests(async (url) => {
      if (url.includes("down")) throw new Error("ECONNREFUSED");
      return 8453;
    });
    await verifyChain(8453);
    expect(listChains()[0].urls).to.deep.equal([
      "http://up.example",
      "http://down.example",
    ]);
  });
});

describe("rpcRegistry — addChain / removeChain (mocked probe)", function () {
  const origRpc = process.env.RPC;
  const origFile = process.env.RPC_CONFIG_FILE;
  let tmpFile: string;

  beforeEach(function () {
    tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "rpcreg-")),
      "rpc.json",
    );
    process.env.RPC_CONFIG_FILE = tmpFile;
    delete process.env.CHAIN_ID;
    // Every probed URL reports the chainId embedded in its host segment `cid-<n>`.
    __setChainProbeForTests(async (url) => {
      const m = url.match(/cid-(\d+)/);
      return m ? Number(m[1]) : 8996;
    });
  });

  afterEach(function () {
    __resetRegistryForTests();
    __setChainProbeForTests(null);
    if (origRpc === undefined) delete process.env.RPC;
    else process.env.RPC = origRpc;
    if (origFile === undefined) delete process.env.RPC_CONFIG_FILE;
    else process.env.RPC_CONFIG_FILE = origFile;
  });

  it("registers a chain whose URL serves it, and persists to the config file", async function () {
    process.env.RPC = '{"8996":"http://cid-8996.example"}';
    loadRegistry(true);
    await addChain(137, ["http://cid-137.example"]);
    expect(hasChain(137)).to.equal(true);
    const written = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    expect(written["137"]).to.deep.equal(["http://cid-137.example"]);
  });

  it("rejects a URL that serves a different chain", async function () {
    process.env.RPC = '{"8996":"http://cid-8996.example"}';
    loadRegistry(true);
    let threw = false;
    try {
      await addChain(137, ["http://cid-999.example"]);
    } catch (e) {
      threw = true;
      expect((e as Error).message).to.contain("999");
    }
    expect(threw).to.equal(true);
    expect(hasChain(137)).to.equal(false);
  });

  it("refuses to remove the only configured chain, but removes one of several", async function () {
    process.env.RPC =
      '{"8996":"http://cid-8996.example","137":"http://cid-137.example"}';
    loadRegistry(true);
    removeChain(137);
    expect(hasChain(137)).to.equal(false);
    expect(hasChain(8996)).to.equal(true);
    let threw = false;
    try {
      removeChain(8996);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    expect(hasChain(8996)).to.equal(true);
  });
});

describe("rpcRegistry — persistence merge + default precedence", function () {
  const origRpc = process.env.RPC;
  const origFile = process.env.RPC_CONFIG_FILE;
  const origChainId = process.env.CHAIN_ID;
  let tmpFile: string;

  beforeEach(function () {
    tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "rpcreg-")),
      "rpc.json",
    );
    process.env.RPC_CONFIG_FILE = tmpFile;
    delete process.env.CHAIN_ID;
    __setChainProbeForTests(async (url) => {
      const m = url.match(/cid-(\d+)/);
      return m ? Number(m[1]) : 8996;
    });
  });

  afterEach(function () {
    __resetRegistryForTests();
    __setChainProbeForTests(null);
    if (origRpc === undefined) delete process.env.RPC;
    else process.env.RPC = origRpc;
    if (origFile === undefined) delete process.env.RPC_CONFIG_FILE;
    else process.env.RPC_CONFIG_FILE = origFile;
    if (origChainId === undefined) delete process.env.CHAIN_ID;
    else process.env.CHAIN_ID = origChainId;
  });

  it("merges persisted chains with env, env winning on conflict", function () {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        "8996": ["http://persisted-8996.example"],
        "137": ["http://cid-137.example"],
      }),
    );
    process.env.RPC = '{"8996":"http://env-8996.example"}';
    loadRegistry(true);
    // 137 comes only from the file; 8996 keeps the env URL (env wins).
    expect(hasChain(137)).to.equal(true);
    const c8996 = listChains().find((c) => c.chainId === 8996);
    expect(c8996?.urls).to.deep.equal(["http://env-8996.example"]);
  });

  it("honors a persisted defaultChainId when registered", function () {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        "8996": ["http://cid-8996.example"],
        "137": ["http://cid-137.example"],
        defaultChainId: 137,
      }),
    );
    process.env.RPC = '{"8996":"http://cid-8996.example"}';
    loadRegistry(true);
    expect(getDefaultChainId()).to.equal(137);
  });

  it("CHAIN_ID env wins over a persisted default", function () {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        "137": ["http://cid-137.example"],
        defaultChainId: 137,
      }),
    );
    process.env.RPC = '{"8996":"http://cid-8996.example"}';
    process.env.CHAIN_ID = "8996";
    loadRegistry(true);
    expect(getDefaultChainId()).to.equal(8996);
  });

  it("a single configured chain is the default with no other signal", function () {
    process.env.RPC = '{"8996":"http://cid-8996.example"}';
    loadRegistry(true);
    expect(getDefaultChainId()).to.equal(8996);
  });

  it("resolveDefaultChain falls back to node∩registry when exactly one matches", function () {
    process.env.RPC =
      '{"8996":"http://cid-8996.example","137":"http://cid-137.example"}';
    loadRegistry(true);
    expect(getDefaultChainId()).to.equal(undefined); // two chains, no explicit default
    expect(resolveDefaultChain([137, 999])).to.equal(137); // only 137 is both served & configured
    setDefaultChainId(8996);
    expect(resolveDefaultChain([137])).to.equal(8996); // explicit default wins
  });
});
