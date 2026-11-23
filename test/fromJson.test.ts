import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import { runRepl } from "./util.js";

describe("--from-json CLI wiring (no infra)", function () {
  this.timeout(60000);
  let tmpDir: string;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocean-cli-fromjson-"));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1 startCompute reports a missing job file", async () => {
    const { output } = await runRepl([
      "startCompute --from-json /nonexistent/job.json",
      "exit",
    ]);
    expect(output).to.contain("Command error:");
    expect(output).to.contain("Job file not found: /nonexistent/job.json");
  });

  it("2 startCompute lists every problem in the file", async () => {
    const file = path.join(tmpDir, "bad.json");
    fs.writeFileSync(file, JSON.stringify({ datasets: "x", maxJobDuraton: 5 }));
    const { output } = await runRepl([
      "startCompute --from-json " + file,
      "exit",
    ]);
    expect(output).to.contain("Invalid job file");
    expect(output).to.contain("datasets: must be an array");
    expect(output).to.contain("algorithm: required");
    expect(output).to.contain('did you mean "maxJobDuration"');
  });

  it("3 positionals cannot be combined with --from-json", async () => {
    const file = path.join(tmpDir, "ok.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        datasets: ["did:op:a"],
        algorithm: "did:op:b",
        maxJobDuration: 900,
        paymentToken: "0x0000000000000000000000000000000000000001",
        resources: [],
      }),
    );
    const { output } = await runRepl([
      "startCompute did:op:a --from-json " + file,
      "exit",
    ]);
    expect(output).to.contain(
      "positional arguments cannot be combined with --from-json",
    );
  });

  it("4 startFreeCompute accepts the --from-json=<path> form", async () => {
    const { output } = await runRepl([
      "startFreeCompute --from-json=/nonexistent/job.json",
      "exit",
    ]);
    expect(output).to.contain("Job file not found");
  });

  it("5 startService reports a missing job file", async () => {
    const { output } = await runRepl([
      "startService --from-json /nonexistent/job.json",
      "exit",
    ]);
    expect(output).to.contain("Job file not found");
  });

  it("6 one-shot mode exits with code 1", async () => {
    const { output, code } = await runRepl([], {
      extraArgs: ["startService", "--from-json", "/nonexistent/job.json"],
      env: { AVOID_LOOP_RUN: "true" },
    });
    expect(code).to.equal(1);
    expect(output).to.contain("Program Error:");
    expect(output).to.contain("Job file not found");
  });

  it("7 startService with no args still reports missing arguments", async () => {
    const { output } = await runRepl(["startService", "exit"]);
    expect(output).to.contain("Missing required arguments");
  });

  it("8 startCompute with no args still reports missing arguments", async () => {
    const { output } = await runRepl(["startCompute", "exit"]);
    expect(output).to.contain("Missing required arguments");
  });
});
