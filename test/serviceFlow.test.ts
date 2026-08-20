import { expect } from "chai";
import fs from "fs";
import { homedir } from "os";
import { runCommand } from "./util.js";

/**
 * Service-on-Demand (Service-on-Demand) end-to-end flow.
 *
 * Requires a running Ocean stack (barge) whose node has the services feature
 * enabled (ocean-node v4+ / PR #1402): at least one service template and a
 * compute environment with `features.services !== false`. On a stock node with
 * no services support the whole lifecycle skips cleanly (`skipLifecycle`).
 *
 * Deviation from the plan: rather than launching a heavy model template (the
 * bundled templates download multi-GB models from Hugging Face — minutes long
 * and flaky in CI), the lifecycle uses a tiny, cache-friendly custom image
 * (nginx-unprivileged:alpine, listening on the high port 8080 — services can't
 * bind ports < 1024 because of `CapDrop ALL`). `getServiceTemplates` is still
 * asserted separately so template parsing is covered.
 */
describe("Ocean CLI Service-on-Demand", function () {
  this.timeout(600000);

  process.env.AVOID_LOOP_RUN = "true";

  // Lightweight image split into image + tag (the node builds `image:tag`; a tag
  // baked into the image field yields a Docker "invalid reference format").
  const IMAGE = "nginxinc/nginx-unprivileged";
  const TAG = "alpine";
  const CONTAINER_PORT = 8080;
  // Bounded by the escrow authorization ceiling, NOT by what the node would allow.
  // The node locks funds for getMinLockTime(duration) = duration + claimDurationTimeout
  // (3600 by default) and refuses to start when that exceeds the authorization's
  // maxLockSeconds ("No valid escrow auths found(maxLockSeconds too low)").
  // paidComputeFlow runs before this suite and, via ocean.js
  // verifyFundsForEscrowPayment, auto-creates the authorization for this same
  // (payer, token, node) at maxJobDuration + queueMaxWaitTime + 3600 = 4500s — and
  // ocean.js sends no tx for a payee that is already authorized, so the
  // authorizeEscrow call below CANNOT raise that ceiling. Keep duration + 3600
  // comfortably under it.
  const START_DURATION = 600; // seconds
  const EXTEND_DURATION = 60; // seconds

  let skipLifecycle = false;
  let template: any;
  let servicesEnv: any;
  let oceanToken: string;
  let serviceId: string;

  const getAddresses = () => {
    const data = JSON.parse(
      fs.readFileSync(
        process.env.ADDRESS_FILE ||
          `${homedir()}/.ocean/ocean-contracts/artifacts/address.json`,
        "utf8"
      )
    );
    return data.development;
  };

  const parseTrailingArray = (output: string, prefix: string): any[] | null => {
    const re = new RegExp(`${prefix}\\s*(\\[[\\s\\S]*\\])`);
    const m = output.match(re);
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  };

  before(function () {
    process.env.PRIVATE_KEY =
      process.env.PRIVATE_KEY ||
      "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
    process.env.RPC = process.env.RPC || "http://localhost:8545";
    process.env.NODE_URL = process.env.NODE_URL || "http://localhost:8001";
    process.env.ADDRESS_FILE =
      process.env.ADDRESS_FILE ||
      `${homedir()}/.ocean/ocean-contracts/artifacts/address.json`;
    oceanToken = getAddresses().Ocean;
  });

  it("lists service templates with 'getServiceTemplates'", async function () {
    const output = await runCommand(`npm run cli getServiceTemplates`);

    if (output.includes("no Service-on-Demand templates")) {
      console.log("Node has no service templates — skipping lifecycle.");
      skipLifecycle = true;
      this.skip();
      return;
    }

    const templates = parseTrailingArray(output, "Service templates:");
    expect(templates, "could not parse 'Service templates:' output").to.be.an(
      "array"
    ).that.is.not.empty;
    template = templates[0];
    expect(template).to.have.property("id").that.is.a("string");
    // Operator secrets must never leak: only env-var KEYS are exposed.
    expect(template).to.not.have.property("envVars");
    expect(output).to.not.match(/JUPYTER_TOKEN\s*[:=]/i);
  });

  it("finds a compute environment with services enabled", async function () {
    if (skipLifecycle) this.skip();
    const output = await runCommand(`npm run cli getComputeEnvironments`);
    const envs = parseTrailingArray(output, "Existing compute environments:");
    expect(envs, "could not parse compute environments").to.be.an("array").that
      .is.not.empty;
    servicesEnv = (envs || []).find((e: any) => e?.features?.services !== false);
    if (!servicesEnv) {
      console.log("No services-enabled environment — skipping lifecycle.");
      skipLifecycle = true;
      this.skip();
      return;
    }
    expect(servicesEnv).to.have.property("consumerAddress").that.is.a("string");
    console.log(`Using services env: ${servicesEnv.id}`);
  });

  it("funds escrow (deposit + authorize the env consumer)", async function () {
    if (skipLifecycle) this.skip();

    // Best-effort mint — the well-known key may not be the token minter, in
    // which case the account is expected to be pre-funded on barge.
    try {
      await runCommand(`npm run cli mintOcean`);
    } catch {
      /* tolerate: account may already hold Ocean */
    }

    const deposit = await runCommand(
      `npm run cli depositEscrow ${oceanToken} 500`
    );
    expect(deposit.toLowerCase()).to.match(/deposit/);

    // Authorize the env's consumerAddress as payee. maxLockSeconds must exceed
    // duration + 3600; maxLockCounts covers start + extends. This is a no-op when
    // an authorization already exists (ocean.js sends no tx for a known payee), so
    // the values below are a floor for a fresh chain, not a guarantee.
    try {
      const auth = await runCommand(
        `npm run cli authorizeEscrow ${oceanToken} ${servicesEnv.consumerAddress} 500 90000 100`
      );
      // "Authorization failed" also contains "authoriz" — match the outcome, not the word.
      expect(auth).to.match(/Successfully authorized|already authorized/i);
    } catch (e) {
      console.log("authorizeEscrow non-fatal (may already be authorized):", e);
    }

    // Always echo the authorization actually in force: it caps START_DURATION
    // (the node needs maxLockSeconds >= duration + 3600) and every later failure
    // in this suite is read against it.
    const auths = await runCommand(
      `npm run cli getAuthorizationsEscrow ${oceanToken} ${servicesEnv.consumerAddress}`
    );
    const ceiling = auths.match(/Max lock seconds:\s*(\d+)/);
    if (ceiling) {
      const maxLockSeconds = Number(ceiling[1]);
      expect(
        maxLockSeconds,
        `escrow authorization allows only ${maxLockSeconds}s of lock time; ` +
          `START_DURATION ${START_DURATION}s needs ${START_DURATION + 3600}s`
      ).to.be.at.least(START_DURATION + 3600);
    }
  });

  it("starts a service and reaches Running with an endpoint", async function () {
    if (skipLifecycle) this.skip();
    const output = await runCommand(
      `npm run cli -- startService ${servicesEnv.id} ${START_DURATION} ${oceanToken} ` +
        `--image ${IMAGE} --tag ${TAG} --ports ${CONTAINER_PORT} ` +
        `--accept true --wait true --timeout 480`
    );

    const idMatch = output.match(/ServiceID:\s*([^\s]+)/);
    expect(idMatch, "could not find 'ServiceID:' in output").to.not.be.null;
    serviceId = idMatch![1];
    expect(serviceId).to.be.a("string").with.length.greaterThan(0);

    expect(output, "service never reached Running").to.match(/\[Running\]|Running \(40\)/);
    expect(output, "no endpoint URL printed").to.match(/http:\/\//);
    console.log(`Service running: ${serviceId}`);
  });

  it("shows the service via getServiceStatus (single + list)", async function () {
    if (skipLifecycle) this.skip();

    const single = await runCommand(`npm run cli getServiceStatus ${serviceId}`);
    expect(single).to.contain(serviceId);
    expect(single).to.match(/http:\/\//);
    expect(single).to.not.contain("userData");

    const all = await runCommand(`npm run cli getServiceStatus`);
    expect(all).to.contain(serviceId);
  });

  it("lists the service via getServices (SERVICES_LIST) without docker spec", async function () {
    if (skipLifecycle) this.skip();

    const output = await runCommand(`npm run cli getServices`);
    const jobs = parseTrailingArray(output, "Services list:");
    expect(jobs, "could not parse 'Services list:'").to.be.an("array");
    const ours = (jobs || []).find((j: any) => j.serviceId === serviceId);
    expect(ours, "our service not present in getServices").to.exist;
    // ServiceJobListed strips the sensitive image-spec fields.
    for (const j of jobs || []) {
      expect(j).to.not.have.property("dockerCmd");
      expect(j).to.not.have.property("dockerEntrypoint");
      expect(j).to.not.have.property("dockerfile");
    }

    const filtered = await runCommand(`npm run cli -- getServices --status 40`);
    const running = parseTrailingArray(filtered, "Services list:");
    expect(running, "could not parse filtered 'Services list:'").to.be.an(
      "array"
    );
    expect(
      (running || []).some((j: any) => j.serviceId === serviceId)
    ).to.equal(true);
  });

  it("fetches service logs (lenient)", async function () {
    if (skipLifecycle) this.skip();
    // Logs may be empty or unavailable for a freshly started container; only
    // assert the command runs and produces a recognizable line.
    const output = await runCommand(
      `npm run cli -- serviceLogs ${serviceId} --since 10m`
    );
    expect(output).to.match(/Service Logs:|No logs available/);
  });

  it("extends the service expiry with extendService", async function () {
    if (skipLifecycle) this.skip();
    const output = await runCommand(
      `npm run cli -- extendService ${serviceId} ${EXTEND_DURATION} --accept true`
    );
    expect(output).to.match(/extended/i);
    expect(output).to.match(/extendPayments:\s*[1-9]/);
  });

  it("restarts the container with restartService", async function () {
    if (skipLifecycle) this.skip();
    const output = await runCommand(
      `npm run cli -- restartService ${serviceId} --wait true --timeout 300`
    );
    expect(output).to.match(/restarting/i);
    expect(output).to.match(/\[Running\]|Running \(40\)/);
  });

  it("stops the service with stopService", async function () {
    if (skipLifecycle) this.skip();
    const output = await runCommand(`npm run cli stopService ${serviceId}`);
    expect(output).to.match(/Stopped \(70\)|stopped/i);
  });

  after(async function () {
    // Best-effort teardown if a mid-flow failure left the service running.
    if (skipLifecycle || !serviceId) return;
    try {
      await runCommand(`npm run cli stopService ${serviceId}`);
    } catch {
      /* already stopped or gone */
    }
  });
});
