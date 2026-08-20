import { expect } from "chai";
import { REPL_PROMPT as PROMPT, runRepl } from "./util.js";

describe("Ocean CLI interactive menu (REPL)", function () {
  this.timeout(60000);

  it("runs a single-token command on bare start", async function () {
    const { output } = await runRepl(["getComputeEnvironments", "exit"]);
    // Parsed and executed (fails at the network, not at parsing).
    expect(output).to.contain("Command error");
    expect(output).to.not.contain("Invalid option");
  });

  it("runs a multi-argument command instead of silently dropping it", async function () {
    const { output } = await runRepl(["download did:op:123 /tmp/x", "exit"]);
    expect(output).to.contain("Command error");
    expect(output).to.not.contain("Invalid option");
  });

  it("accepts a line typed with the 'npm run cli' prefix", async function () {
    const { output } = await runRepl([
      "npm run cli getComputeEnvironments",
      "exit",
    ]);
    expect(output).to.contain("Command error");
    expect(output).to.not.contain("Invalid option");
  });

  it("keeps a single-quoted JSON argument as one token", async function () {
    const { output } = await runRepl([
      `editAsset did:op:1 '{"name": "a b c"}'`,
      "exit",
    ]);
    // If quoting were mishandled the JSON would split into extra tokens and
    // Commander would reject it with "too many arguments".
    expect(output).to.not.contain("too many arguments");
    expect(output).to.contain("Command error");
  });

  it("re-prompts on empty input instead of hanging", async function () {
    const { output, code } = await runRepl(["", "", "exit"]);
    // Reaching this assertion at all means it did not hang (mocha would time out).
    expect(code).to.equal(0);
    const prompts = output.split(PROMPT).length - 1;
    expect(prompts).to.be.greaterThanOrEqual(3);
  });

  it("reports an unknown command and suggests help", async function () {
    const { output } = await runRepl(["definitelyNotACommand", "exit"]);
    expect(output).to.contain("Invalid option: definitelyNotACommand");
  });

  it("survives a command with a missing required argument", async function () {
    // getDDO requires <did>; the parse error must not terminate the REPL, and a
    // subsequent command must still run.
    const { output, code } = await runRepl([
      "getDDO",
      "definitelyNotACommand",
      "exit",
    ]);
    expect(output).to.contain("missing required argument");
    // Proof the loop kept going after the parse error:
    expect(output).to.contain("Invalid option: definitelyNotACommand");
    expect(code).to.equal(0);
  });

  it("exits cleanly on EOF when 'exit' is never typed", async function () {
    const { code } = await runRepl(["getComputeEnvironments"]);
    expect(code).to.equal(0);
  });

  it("accepts an optional node argument for getComputeEnvironments", async function () {
    const { output } = await runRepl([
      "getComputeEnvironments http://127.0.0.1:2",
      "exit",
    ]);
    expect(output).to.not.contain("too many arguments");
    expect(output).to.contain("Command error");
  });
});
