import { expect } from "chai";
import { spawn } from "child_process";
import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Recurring prompt string emitted by the REPL (keep in sync with src/index.ts).
const PROMPT = "Enter command ('exit' | 'quit' | ESC or CTRL-C to terminate):\n";

/**
 * Drive the interactive REPL (menu mode) with piped stdin.
 *
 * These tests are infra-free: PRIVATE_KEY/RPC/NODE_URL point at an unreachable
 * port, so a command that actually parses and runs surfaces a "Command error"
 * (connection refused) while a command that is dropped or rejected at parse time
 * does not. AVOID_LOOP_RUN is left unset so the process enters the REPL loop.
 */
function runRepl(
  inputLines: string[],
  extraArgs: string[] = []
): Promise<{ output: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.AVOID_LOOP_RUN;
    env.PRIVATE_KEY =
      "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
    env.RPC = "http://127.0.0.1:1";
    env.NODE_URL = "http://127.0.0.1:1";

    const child = spawn("npx", ["tsx", "src/index.ts", ...extraArgs], {
      cwd: projectRoot,
      env,
    });

    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ output, code }));

    for (const line of inputLines) {
      child.stdin.write(line + "\n");
    }
    child.stdin.end();
  });
}

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
