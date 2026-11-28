import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import { ethers } from "ethers";
import type { Config } from "@oceanprotocol/lib";
import { Commands } from "../src/commands.js";
import {
  addSubsidyProvider,
  __resetConfigStoreForTests,
} from "../src/configStore.js";

/**
 * Infra-free unit tests for Commands.resolveJobSubsidyProviders (§6.6 — the thin wrapper
 * that reads the saved subsidy list, fetches node status and prints the merge notes). The
 * node status is injected via the method's test seam, so no network / running node is
 * needed; the pure set-math it delegates to is covered in mergeSubsidy.test.ts.
 */
type Fetcher = NonNullable<Parameters<Commands["resolveJobSubsidyProviders"]>[2]>;
type Status = Awaited<ReturnType<Fetcher>>;
const asStatus = (s: unknown): Status => s as Status;

describe("Commands.resolveJobSubsidyProviders", function () {
  const CHAIN = 8996; // a chain ocean.js ConfigHelper knows (Barge / development)
  // Canonically checksummed (letter-bearing) addresses — the merge re-checksums via
  // ethers.getAddress and defensively skips anything that is not valid EIP-55.
  const A = ethers.getAddress("0xabc0000000000000000000000000000000000001");
  const B = ethers.getAddress("0xdef0000000000000000000000000000000000002");

  let cmds: Commands;
  let tmpDir: string;
  let envBackup: Record<string, string | undefined>;

  beforeEach(function () {
    envBackup = {
      OCEANCLI_CONFIG_PATH: process.env.OCEANCLI_CONFIG_PATH,
      NODE_URL: process.env.NODE_URL,
    };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocsubm-"));
    process.env.OCEANCLI_CONFIG_PATH = path.join(tmpDir, "config.json");
    process.env.NODE_URL = "http://127.0.0.1:1";
    __resetConfigStoreForTests();
    // An explicit config bypasses ConfigHelper/network; the method never reads this.config.
    cmds = new Commands(
      new ethers.Wallet(
        "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc",
      ),
      CHAIN,
      {} as unknown as Config,
    );
  });

  afterEach(function () {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetConfigStoreForTests();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  // Capture the method's console.log notes during one call.
  async function run(
    requested: string[] | undefined,
    fetchStatus?: Fetcher,
  ): Promise<{ ret: string[] | undefined; out: string }> {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    };
    try {
      const ret = await cmds.resolveJobSubsidyProviders(
        requested,
        CHAIN,
        fetchStatus,
      );
      return { ret, out: logs.join("\n") };
    } finally {
      console.log = origLog;
    }
  }

  it("returns an explicit list unchanged and never calls the node", async function () {
    let called = false;
    const { ret } = await run([A], async () => {
      called = true;
      return asStatus(null);
    });
    expect(ret).to.deep.equal([A]);
    expect(called).to.equal(false);
  });

  it("returns undefined with no saved providers and never calls the node", async function () {
    let called = false;
    const { ret } = await run(undefined, async () => {
      called = true;
      return asStatus(null);
    });
    expect(ret).to.equal(undefined);
    expect(called).to.equal(false);
  });

  it("fails soft to the node defaults when the node status is unavailable", async function () {
    addSubsidyProvider(CHAIN, A);
    const { ret, out } = await run(undefined, async () => asStatus(null));
    expect(ret).to.equal(undefined);
    expect(out).to.contain("Could not read node status");
  });

  it("merges a saved provider the node does not advertise (filter off)", async function () {
    addSubsidyProvider(CHAIN, A);
    const { ret, out } = await run(undefined, async () =>
      asStatus({ subsidyProviders: {}, subsidyProviderFilter: false }),
    );
    expect(ret).to.deep.equal([A]);
    expect(out).to.contain("Adding saved subsidy provider(s)");
    expect(out).to.contain(A);
  });

  it("uses the node defaults when every saved provider is already advertised", async function () {
    addSubsidyProvider(CHAIN, A);
    const { ret, out } = await run(undefined, async () =>
      asStatus({
        subsidyProviders: { [String(CHAIN)]: [A] },
        subsidyProviderFilter: false,
      }),
    );
    expect(ret).to.equal(undefined);
    expect(out).to.contain("already advertised");
  });

  it("drops a saved provider the node does not advertise when its filter is on", async function () {
    addSubsidyProvider(CHAIN, A);
    const { ret, out } = await run(undefined, async () =>
      asStatus({
        subsidyProviders: { [String(CHAIN)]: [B] },
        subsidyProviderFilter: true,
      }),
    );
    expect(ret).to.equal(undefined);
    expect(out).to.contain("Ignoring saved subsidy provider(s)");
  });
});
