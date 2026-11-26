import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import { runRepl } from "./util.js";

/**
 * Infra-free CLI-level tests for the unified config file: startup hydration, the
 * node-free bootstrap paths, and the getConfig / setConfig / unsetConfig / favourites /
 * subsidy commands. Every run gets its own throwaway OCEANCLI_CONFIG_PATH so nothing
 * touches the developer's real ~/.ocean/cli/config.json.
 */
describe("Ocean CLI config file (startup / hydration)", function () {
  this.timeout(60000);

  const freshConfigPath = (prefix: string): string =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), "config.json");

  it("loads RPC chains from the config file when env RPC is unset", async function () {
    const tmp = freshConfigPath("oc-filerpc-");
    fs.writeFileSync(
      tmp,
      JSON.stringify({ version: 1, rpc: { "137": ["http://127.0.0.1:2"] } }),
    );
    const { output } = await runRepl(["listChains", "exit"], {
      env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp, CHAIN_ID: undefined },
    });
    expect(output).to.contain("Configured RPC chains:");
    expect(output).to.contain("137");
    // It must NOT hit the "no RPC" startup error path.
    expect(output).to.not.contain("Have you forgot to set env RPC?");
  });

  it("lets addChain run on a fresh install with no RPC configured", async function () {
    const { output } = await runRepl(["addChain 8996 http://127.0.0.1:1", "exit"], {
      env: { RPC: undefined },
    });
    // Startup does not exit for a bootstrap command with no RPC; it prints a hint...
    expect(output).to.contain("No RPC configured yet");
    // ...and the command runs far enough to probe the (unreachable) URL.
    expect(output).to.contain("Could not reach http://127.0.0.1:1");
    expect(output).to.not.contain("Have you forgot to set env RPC?");
  });

  it("hydrates the node from the config file when env NODE_URL is unset", async function () {
    const tmp = freshConfigPath("oc-hydnode-");
    fs.writeFileSync(tmp, JSON.stringify({ nodeUrl: "http://127.0.0.1:1" }));
    const { output } = await runRepl(["getNode", "exit"], {
      env: { NODE_URL: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(output).to.contain("Current Ocean Node: http://127.0.0.1:1");
    expect(output).to.not.contain("No Ocean Node configured");
  });

  it("lets env NODE_URL win over the config file's nodeUrl", async function () {
    const tmp = freshConfigPath("oc-envwins-");
    fs.writeFileSync(tmp, JSON.stringify({ nodeUrl: "http://127.0.0.1:1" }));
    const { output } = await runRepl(["getNode", "exit"], {
      env: { NODE_URL: "http://127.0.0.1:3", OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(output).to.contain("Current Ocean Node: http://127.0.0.1:3");
    expect(output).to.not.contain("http://127.0.0.1:1");
  });
});

describe("Ocean CLI getConfig / setConfig / unsetConfig", function () {
  this.timeout(60000);

  const freshConfigPath = (prefix: string): string =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), "config.json");

  it("round-trips a setConfig value through the file and getConfig", async function () {
    const tmp = freshConfigPath("oc-setcfg-");
    const { output } = await runRepl(
      ["setConfig indexing.maxRetries 5", "getConfig indexing.maxRetries", "exit"],
      // Unset INDEXING_MAX_RETRIES (CI sets it) so the file value is the effective source —
      // otherwise getConfig correctly reports [env …] and the saved [file] value is shadowed.
      { env: { OCEANCLI_CONFIG_PATH: tmp, INDEXING_MAX_RETRIES: undefined } },
    );
    const saved = JSON.parse(fs.readFileSync(tmp, "utf-8"));
    expect(saved.indexing.maxRetries).to.equal(5);
    expect(output).to.contain("[file]");
  });

  it("rejects secrets, rpc, nodeUrl and bad values without writing anything", async function () {
    const tmp = freshConfigPath("oc-setrej-");
    const { output, code } = await runRepl(
      [
        "setConfig privateKey 0xabc",
        "setConfig rpc x",
        "setConfig nodeUrl x",
        "setConfig disableP2P maybe",
        "exit",
      ],
      { env: { OCEANCLI_CONFIG_PATH: tmp } },
    );
    expect(output).to.contain("never stored");
    expect(output).to.contain("addChain");
    expect(output).to.contain("setNode");
    expect(output).to.contain("must be true or false");
    // Every setConfig above was rejected, so nothing must have been persisted — the
    // file is never even created — and the REPL still exits cleanly.
    expect(fs.existsSync(tmp), "a rejected setConfig must not create the file").to.equal(
      false,
    );
    expect(code).to.equal(0);
  });

  it("unsetConfig removes the key from the file", async function () {
    const tmp = freshConfigPath("oc-unset-");
    fs.writeFileSync(
      tmp,
      JSON.stringify({ version: 1, searchTimeoutMs: 1234 }),
    );
    await runRepl(["unsetConfig searchTimeoutMs", "exit"], {
      env: { OCEANCLI_CONFIG_PATH: tmp, SEARCH_TIMEOUT_MS: undefined },
    });
    const saved = JSON.parse(fs.readFileSync(tmp, "utf-8"));
    expect(saved.searchTimeoutMs).to.equal(undefined);
  });
});

describe("Ocean CLI favourite nodes", function () {
  this.timeout(60000);

  const PEER = "16Uiu2HAmLhRDqfufZiQnxvQs2XHhd6hwkLSPfjAQg1gH8wgRixiP";
  const freshConfigPath = (prefix: string): string =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), "config.json");

  it("adds, lists and removes favourites on a fresh install (no RPC)", async function () {
    const tmp = freshConfigPath("oc-fav-");
    const { output } = await runRepl(
      [
        "addFavouriteNode http://127.0.0.1:1 my local node",
        `addFavouriteNode ${PEER}`,
        "listFavouriteNodes",
        "removeFavouriteNode 1",
        "favourites",
        "exit",
      ],
      { env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp } },
    );
    expect(output).to.contain("Saved favourite #1");
    expect(output).to.contain("Saved favourite #2");
    expect(output).to.contain("my local node");
    expect(output).to.contain("Removed favourite: http://127.0.0.1:1");
    const saved = JSON.parse(fs.readFileSync(tmp, "utf-8"));
    expect(saved.favouriteNodes).to.have.length(1);
    expect(saved.favouriteNodes[0].node).to.equal(PEER);
  });

  it("marks the current node as [current]", async function () {
    const { output } = await runRepl(
      ["addFavouriteNode", "listFavouriteNodes", "exit"],
      {},
    );
    expect(output).to.contain("Saved favourite #1: http://127.0.0.1:1");
    expect(output).to.contain("[current]");
  });

  it("rejects bad references and missing favourites", async function () {
    const tmp = freshConfigPath("oc-favrej-");
    const r1 = await runRepl(["addFavouriteNode not-a-node", "exit"], {
      env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(r1.output).to.contain("is not a node reference");

    const r2 = await runRepl(["addFavouriteNode", "exit"], {
      env: { RPC: undefined, NODE_URL: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(r2.output).to.contain("A node is required");

    const r3 = await runRepl(["removeFavouriteNode 7", "exit"], {
      env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(r3.output).to.contain("No favourite node matches");

    // setNode is NOT a bootstrap command, so it needs RPC set to reach the action.
    const r4 = await runRepl(["setNode 7", "exit"], {
      env: { OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(r4.output).to.contain("No favourite node #7");
  });

  it("setNode <number> resolves the favourite", async function () {
    const tmp = freshConfigPath("oc-favset-");
    fs.writeFileSync(
      tmp,
      JSON.stringify({ favouriteNodes: [{ node: "http://127.0.0.1:9" }] }),
    );
    const { output } = await runRepl(["setNode 1", "exit"], {
      env: { NODE_URL: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(output).to.contain("Favourite #1: http://127.0.0.1:9");
    expect(output).to.contain("Cannot reach http://127.0.0.1:9");
  });

  it("an unreachable setNode is not persisted to the config file", async function () {
    // setNode validates BEFORE it commits, so a node it cannot reach must leave the
    // file untouched — nothing to roll back. (setNode needs RPC, which runRepl sets.)
    const tmp = freshConfigPath("oc-setnode-fail-");
    fs.writeFileSync(tmp, JSON.stringify({ version: 1 }));
    const { output } = await runRepl(["setNode http://127.0.0.1:9", "exit"], {
      env: { NODE_URL: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(output).to.contain("Cannot reach http://127.0.0.1:9");
    const saved = JSON.parse(fs.readFileSync(tmp, "utf-8"));
    expect(saved.nodeUrl).to.equal(undefined);
  });
});

describe("Ocean CLI saved subsidy providers", function () {
  this.timeout(60000);

  // Valid checksummed addresses.
  const A = "0x1111111111111111111111111111111111111111";
  const B = "0x2222222222222222222222222222222222222222";
  const freshConfigPath = (prefix: string): string =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), "config.json");

  it("adds, lists, toggles and removes on a fresh install (no RPC)", async function () {
    const tmp = freshConfigPath("oc-sub-");
    const { output } = await runRepl(
      [
        `addSubsidyProvider 8453 ${A} OPF subsidy`,
        `addSubsidyProvider 8453 ${B}`,
        "listSubsidyProviders",
        "toggleSubsidyProvider 8453 2 off",
        "listSubsidy 8453",
        "removeSubsidyProvider 8453 1",
        "exit",
      ],
      { env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp } },
    );
    expect(output).to.contain("Saved subsidy provider #1 on chain 8453");
    expect(output).to.contain("Saved subsidy provider #2");
    expect(output).to.contain("OPF subsidy");
    expect(output).to.contain("[on]");
    expect(output).to.contain("[off]");
    expect(output).to.contain("Disabled subsidy provider on chain 8453");
    expect(output).to.contain("Removed subsidy provider on chain 8453");
    const saved = JSON.parse(fs.readFileSync(tmp, "utf-8"));
    expect(saved.subsidyProviders["8453"]).to.have.length(1);
    expect(saved.subsidyProviders["8453"][0].address).to.equal(B);
    expect(saved.subsidyProviders["8453"][0].enabled).to.equal(false);
  });

  it("toggle flips the enabled flag", async function () {
    const tmp = freshConfigPath("oc-subtog-");
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        subsidyProviders: { "8453": [{ address: A, enabled: true }] },
      }),
    );
    const r1 = await runRepl(["toggleSubsidyProvider 8453 1", "exit"], {
      env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(r1.output).to.contain("Disabled subsidy provider on chain 8453");
    const r2 = await runRepl(["toggleSubsidyProvider 8453 1", "exit"], {
      env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(r2.output).to.contain("Enabled subsidy provider on chain 8453");
  });

  it("rejects a bad address, a missing chain id, and bad refs/states", async function () {
    const tmp = freshConfigPath("oc-subrej-");
    const r1 = await runRepl(
      ["addSubsidyProvider 8453 not-an-address", "exit"],
      { env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp } },
    );
    expect(r1.output).to.contain("is not a valid EVM address");

    const r2 = await runRepl([`addSubsidyProvider`, "exit"], {
      env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(r2.output).to.contain("A chain id is required");

    const r3 = await runRepl(["removeSubsidyProvider 8453 7", "exit"], {
      env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp },
    });
    expect(r3.output).to.contain("No saved subsidy provider matches");

    fs.writeFileSync(
      tmp,
      JSON.stringify({
        subsidyProviders: { "8453": [{ address: A, enabled: true }] },
      }),
    );
    const r4 = await runRepl(
      ["toggleSubsidyProvider 8453 1 maybe", "exit"],
      { env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp } },
    );
    expect(r4.output).to.contain("State must be on or off");
  });

  it("getConfig shows the saved subsidy count and the per-chain summary", async function () {
    const tmp = freshConfigPath("oc-subcfg-");
    const { output } = await runRepl(
      [
        `addSubsidyProvider 8453 ${A}`,
        `addSubsidyProvider 8453 ${B}`,
        "getConfig",
        "getConfig subsidyProviders",
        "exit",
      ],
      { env: { RPC: undefined, OCEANCLI_CONFIG_PATH: tmp } },
    );
    expect(output).to.contain("subsidyProviders");
    // The summary line must reflect the actual count, not merely mention the key.
    expect(output).to.contain("2 saved on 1 chain(s)");
    expect(output).to.contain("Subsidy providers — chain 8453:");
  });
});
