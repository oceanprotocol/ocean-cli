import { expect } from "chai";
import { runRepl } from "./util.js";

// The Ocean Node exposed by Barge over HTTP. Hardcoded (as in http.test.ts) so these
// tests behave identically on both CI transport legs: the p2p leg only changes the
// NODE_URL env, the node's HTTP interface is up either way.
const LIVE_NODE = "http://127.0.0.1:8001";

describe("Ocean CLI node selection", function () {
  this.timeout(120000);

  describe("with no NODE_URL set (no infra needed)", function () {
    it("starts anyway and says which commands are available", async function () {
      const { output, code } = await runRepl(["exit"], {
        env: { NODE_URL: undefined },
      });
      expect(output).to.contain("No Ocean Node configured");
      expect(output).to.contain("setNode");
      expect(code).to.equal(0);
    });

    it("refuses a command that needs a node, without running it", async function () {
      const { output } = await runRepl(["getComputeEnvironments", "exit"], {
        env: { NODE_URL: undefined },
      });
      expect(output).to.contain("No Ocean Node set");
      // The refusal must come from the gate, not from the command being unknown.
      expect(output).to.not.contain("Invalid option");
      // "Using Ocean Node URL" is logged by the Commands constructor, so the action
      // body clearly never ran. (Weak on its own — runRepl's RPC is unreachable, so a
      // command that got past the gate would die before that log too.)
      expect(output).to.not.contain("Using Ocean Node URL");
    });

    it("still allows help and getNode", async function () {
      const { output } = await runRepl(["help", "getNode", "exit"], {
        env: { NODE_URL: undefined },
      });
      expect(output).to.contain("Usage: ocean-cli");
      // Both new commands must be discoverable from the menu.
      expect(output).to.contain("setNode");
      expect(output).to.contain("getNode");
      expect(output).to.contain("No Ocean Node set");
    });

    it("keeps the CLI node-less when setNode cannot reach the node", async function () {
      const { output } = await runRepl(
        ["setNode http://127.0.0.1:1", "getComputeEnvironments", "exit"],
        { env: { NODE_URL: undefined } }
      );
      expect(output).to.contain("Still no node set");
      // The gate is still closed: no half-switch.
      expect(output).to.contain("No Ocean Node set");
      expect(output).to.not.contain("Using Ocean Node URL");
    });

    it("accepts the useNode alias", async function () {
      const { output } = await runRepl(["useNode http://127.0.0.1:1", "exit"], {
        env: { NODE_URL: undefined },
      });
      expect(output).to.not.contain("Invalid option");
      expect(output).to.contain("Cannot reach");
    });
  });

  describe("with an unreachable NODE_URL set (no infra needed)", function () {
    it("does not gate commands — they run and fail at the network", async function () {
      const { output } = await runRepl(["getComputeEnvironments", "exit"]);
      expect(output).to.not.contain("No Ocean Node set");
      expect(output).to.contain("Command error");
    });
  });

  describe("libp2p lifecycle (no infra needed)", function () {
    it("still exits when libp2p has been started", async function () {
      // Regression guard: libp2p is started eagerly in loop mode, and a started
      // libp2p node keeps the event loop alive — even after a clean stop() it leaves
      // a MessagePort behind. Without the explicit shutdown+exit in index.ts the CLI
      // hangs forever here instead of returning to the shell.
      const { code } = await runRepl(["exit"], {
        env: { DISABLE_P2P: undefined },
      });
      expect(code).to.equal(0);
    });

    it("does not start libp2p for a one-shot HTTP run", async function () {
      // One-shot has no later command to warm up for, so paying the libp2p
      // startup/shutdown cost would only slow every scripted invocation down.
      const { output } = await runRepl([], {
        extraArgs: ["getNode"],
        env: { DISABLE_P2P: undefined, AVOID_LOOP_RUN: "true" },
      });
      expect(output).to.not.contain("Starting libp2p");
    });
  });

  describe("against a running node (requires Barge)", function () {
    it("reports the startup node and its version", async function () {
      const { output } = await runRepl(["getNode", "exit"], {
        env: { NODE_URL: LIVE_NODE },
      });
      expect(output).to.contain(`Current Ocean Node: ${LIVE_NODE}`);
      expect(output).to.contain("Version:");
    });

    it("switches from no node to a live node, opening the gate", async function () {
      const { output } = await runRepl(
        [`setNode ${LIVE_NODE}`, "getNode", "getComputeEnvironments", "exit"],
        { env: { NODE_URL: undefined } }
      );
      expect(output).to.contain(`Using node: ${LIVE_NODE}`);
      expect(output).to.contain(`Current Ocean Node: ${LIVE_NODE}`);
      // The gate opened: the command that follows the switch is no longer refused.
      // (It still fails further on — runRepl points RPC at an unreachable port — so
      // this cannot assert anything the action itself would print.)
      expect(output).to.not.contain("No Ocean Node set");
    });

    it("recognises a switch to the node already in use", async function () {
      const { output } = await runRepl([`setNode ${LIVE_NODE}`, "exit"], {
        env: { NODE_URL: LIVE_NODE },
      });
      expect(output).to.contain("already the active one");
    });

    it("keeps the current node when the new one is unreachable", async function () {
      const { output } = await runRepl(
        ["setNode http://127.0.0.1:9999", "getNode", "exit"],
        { env: { NODE_URL: LIVE_NODE } }
      );
      expect(output).to.contain(`Keeping current node: ${LIVE_NODE}`);
      expect(output).to.contain(`Current Ocean Node: ${LIVE_NODE}`);
    });
  });
});
