import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import {
  CONFIG_VERSION,
  CONFIG_KEYS,
  configFilePath,
  configPathProblem,
  configFileStatus,
  readConfigFile,
  initConfig,
  isEnvProvided,
  wasHydrated,
  updateConfigFile,
  findConfigKey,
  getFileValue,
  setFileValue,
  deleteFileValue,
  parseConfigValue,
  describeSetting,
  __resetConfigStoreForTests,
  // favourites
  normalizeNodeRef,
  listFavouriteNodes,
  addFavouriteNode,
  removeFavouriteNode,
  resolveFavouriteRef,
  // subsidy
  listSubsidyProviders,
  listAllSubsidyProviders,
  enabledSubsidyProviderAddresses,
  addSubsidyProvider,
  removeSubsidyProvider,
  toggleSubsidyProvider,
  resolveSubsidyRef,
} from "../src/configStore.js";

// Infra-free unit tests for the config store. Every test gets a fresh throwaway
// config file and a reset module state; hydration writes into process.env, so all
// env vars the store touches are snapshotted and restored.

const ENV_NAMES = [
  "OCEANCLI_CONFIG_PATH",
  "RPC_CONFIG_FILE",
  "RPC",
  "CHAIN_ID",
  "HOME",
  "USERPROFILE",
  ...CONFIG_KEYS.map((k) => k.env),
];

describe("configStore", function () {
  let tmpDir: string;
  let envBackup: Record<string, string | undefined>;

  beforeEach(function () {
    envBackup = {};
    for (const name of ENV_NAMES) envBackup[name] = process.env[name];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "occfg-"));
    process.env.OCEANCLI_CONFIG_PATH = path.join(tmpDir, "config.json");
    delete process.env.RPC_CONFIG_FILE;
    __resetConfigStoreForTests();
  });

  afterEach(function () {
    for (const name of ENV_NAMES) {
      if (envBackup[name] === undefined) delete process.env[name];
      else process.env[name] = envBackup[name];
    }
    __resetConfigStoreForTests();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  const write = (obj: unknown) =>
    fs.writeFileSync(process.env.OCEANCLI_CONFIG_PATH!, JSON.stringify(obj));
  const read = () =>
    JSON.parse(fs.readFileSync(process.env.OCEANCLI_CONFIG_PATH!, "utf-8"));

  // ------------------------------------------------------------------- paths
  describe("path resolution", function () {
    it("returns an absolute OCEANCLI_CONFIG_PATH as-is", function () {
      const abs = path.join(tmpDir, "custom.json");
      process.env.OCEANCLI_CONFIG_PATH = abs;
      expect(configFilePath()).to.equal(abs);
    });

    it("resolves a relative OCEANCLI_CONFIG_PATH against cwd", function () {
      process.env.OCEANCLI_CONFIG_PATH = "rel/config.json";
      expect(configFilePath()).to.equal(path.resolve("rel/config.json"));
    });

    it("falls back to ~/.ocean/cli/config.json when unset", function () {
      delete process.env.OCEANCLI_CONFIG_PATH;
      expect(configFilePath()).to.equal(
        path.join(os.homedir(), ".ocean", "cli", "config.json"),
      );
    });

    it("reports a directory path as a problem and refuses to write", function () {
      process.env.OCEANCLI_CONFIG_PATH = tmpDir; // a directory
      expect(configPathProblem()).to.match(/is a directory/);
      expect(updateConfigFile((f) => (f.searchTimeoutMs = 1))).to.equal(false);
    });

    it("never returns RPC_CONFIG_FILE", function () {
      delete process.env.OCEANCLI_CONFIG_PATH;
      process.env.RPC_CONFIG_FILE = "/somewhere/rpc.json";
      expect(configFilePath()).to.not.equal("/somewhere/rpc.json");
    });
  });

  // ----------------------------------------------------------------- reading
  describe("reading", function () {
    it("missing file → {} and status missing, creates nothing", function () {
      expect(readConfigFile()).to.deep.equal({});
      expect(configFileStatus()).to.equal("missing");
      expect(fs.existsSync(process.env.OCEANCLI_CONFIG_PATH!)).to.equal(false);
    });

    it("corrupt JSON → {} and status corrupt, file untouched", function () {
      fs.writeFileSync(process.env.OCEANCLI_CONFIG_PATH!, "{ not json");
      expect(readConfigFile()).to.deep.equal({});
      expect(configFileStatus()).to.equal("corrupt");
      expect(fs.readFileSync(process.env.OCEANCLI_CONFIG_PATH!, "utf-8")).to.equal(
        "{ not json",
      );
    });

    it("drops wrong-typed known keys but keeps valid ones", function () {
      write({
        version: 1,
        indexing: "x",
        disableP2P: "yes",
        searchTimeoutMs: 42,
      });
      const cfg = readConfigFile();
      expect(cfg.indexing).to.equal(undefined);
      expect(cfg.disableP2P).to.equal(undefined);
      expect(cfg.searchTimeoutMs).to.equal(42);
    });

    it("never returns a privateKey key", function () {
      write({ privateKey: "0xabc", searchTimeoutMs: 1 });
      const cfg = readConfigFile() as Record<string, unknown>;
      expect(cfg.privateKey).to.equal(undefined);
      expect(cfg.searchTimeoutMs).to.equal(1);
    });

    it("an empty file is ok with {} (not corrupt)", function () {
      fs.writeFileSync(process.env.OCEANCLI_CONFIG_PATH!, "   \n");
      expect(configFileStatus()).to.equal("ok");
      expect(readConfigFile()).to.deep.equal({});
    });
  });

  // --------------------------------------------------------------- hydration
  describe("hydration (initConfig)", function () {
    it("hydrates each type when env did not provide it", function () {
      write({
        nodeUrl: "https://n.example",
        disableP2P: true,
        indexing: { maxRetries: 5 },
        bootstrapPeers: ["a", "b"],
      });
      for (const n of [
        "NODE_URL",
        "DISABLE_P2P",
        "INDEXING_MAX_RETRIES",
        "BOOTSTRAP_PEERS",
      ])
        delete process.env[n];
      initConfig();
      expect(process.env.NODE_URL).to.equal("https://n.example");
      expect(process.env.DISABLE_P2P).to.equal("true");
      expect(process.env.INDEXING_MAX_RETRIES).to.equal("5");
      expect(process.env.BOOTSTRAP_PEERS).to.equal("a,b");
      expect(wasHydrated("NODE_URL")).to.equal(true);
    });

    it("does not overwrite an env-provided value", function () {
      write({ nodeUrl: "https://file.example" });
      process.env.NODE_URL = "https://env.example";
      initConfig();
      expect(process.env.NODE_URL).to.equal("https://env.example");
      expect(isEnvProvided("NODE_URL")).to.equal(true);
      expect(wasHydrated("NODE_URL")).to.equal(false);
    });

    it("AVOID_LOOP_RUN=false in env beats avoidLoopRun:true in the file", function () {
      write({ avoidLoopRun: true });
      process.env.AVOID_LOOP_RUN = "false";
      initConfig();
      expect(process.env.AVOID_LOOP_RUN).to.equal("false");
      expect(isEnvProvided("AVOID_LOOP_RUN")).to.equal(true);
    });

    it("never sets RPC or CHAIN_ID from the file", function () {
      write({ rpc: { "137": ["http://x"] }, defaultChainId: 137 });
      delete process.env.RPC;
      delete process.env.CHAIN_ID;
      initConfig();
      expect(process.env.RPC).to.equal(undefined);
      expect(process.env.CHAIN_ID).to.equal(undefined);
    });

    it("does not hydrate computeEnvId when env NODE_URL differs from the file", function () {
      write({ nodeUrl: "https://file.example", computeEnvId: "env-1" });
      process.env.NODE_URL = "https://other.example";
      delete process.env.COMPUTE_ENV_ID;
      initConfig();
      expect(process.env.COMPUTE_ENV_ID).to.equal(undefined);
    });

    it("hydrates computeEnvId when NODE_URL came from the file", function () {
      write({ nodeUrl: "https://file.example", computeEnvId: "env-1" });
      delete process.env.NODE_URL;
      delete process.env.COMPUTE_ENV_ID;
      initConfig();
      expect(process.env.NODE_URL).to.equal("https://file.example");
      expect(process.env.COMPUTE_ENV_ID).to.equal("env-1");
    });

    it("initConfig twice is a no-op the second time", function () {
      write({ nodeUrl: "https://n.example" });
      delete process.env.NODE_URL;
      initConfig();
      process.env.NODE_URL = "https://changed.example";
      initConfig(); // must not re-hydrate
      expect(process.env.NODE_URL).to.equal("https://changed.example");
    });
  });

  // ----------------------------------------------------------------- writing
  describe("writing (updateConfigFile)", function () {
    it("creates the dir + file, content parses, version is 1", function () {
      const ok = updateConfigFile((f) => (f.searchTimeoutMs = 10));
      expect(ok).to.equal(true);
      const j = read();
      expect(j.searchTimeoutMs).to.equal(10);
      expect(j.version).to.equal(CONFIG_VERSION);
    });

    it("writes the file with mode 0600", function () {
      if (process.platform === "win32") this.skip();
      updateConfigFile((f) => (f.searchTimeoutMs = 10));
      const mode = fs.statSync(process.env.OCEANCLI_CONFIG_PATH!).mode & 0o777;
      expect(mode).to.equal(0o600);
    });

    it("leaves no *.tmp file behind", function () {
      updateConfigFile((f) => (f.searchTimeoutMs = 10));
      const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes(".tmp"));
      expect(leftovers).to.deep.equal([]);
    });

    it("preserves unknown top-level keys on update", function () {
      write({ version: 1, somethingCustom: { a: 1 } });
      updateConfigFile((f) => (f.searchTimeoutMs = 10));
      const j = read();
      expect(j.somethingCustom).to.deep.equal({ a: 1 });
      expect(j.searchTimeoutMs).to.equal(10);
    });

    it("re-reads disk before patching (external change survives)", function () {
      updateConfigFile((f) => (f.searchTimeoutMs = 10));
      // external process writes another key
      const j = read();
      j.disableP2P = true;
      fs.writeFileSync(process.env.OCEANCLI_CONFIG_PATH!, JSON.stringify(j));
      updateConfigFile((f) => (f.searchTimeoutMs = 20));
      const after = read();
      expect(after.disableP2P).to.equal(true);
      expect(after.searchTimeoutMs).to.equal(20);
    });

    it("a no-op mutator does not rewrite the file", function () {
      updateConfigFile((f) => (f.searchTimeoutMs = 10));
      const before = fs.statSync(process.env.OCEANCLI_CONFIG_PATH!).mtimeMs;
      const content = fs.readFileSync(process.env.OCEANCLI_CONFIG_PATH!, "utf-8");
      const ok = updateConfigFile(() => {
        /* nothing */
      });
      expect(ok).to.equal(true);
      expect(fs.readFileSync(process.env.OCEANCLI_CONFIG_PATH!, "utf-8")).to.equal(
        content,
      );
      expect(fs.statSync(process.env.OCEANCLI_CONFIG_PATH!).mtimeMs).to.equal(before);
    });

    it("backs up a corrupt file and writes fresh valid JSON", function () {
      fs.writeFileSync(process.env.OCEANCLI_CONFIG_PATH!, "{ broken");
      updateConfigFile((f) => (f.searchTimeoutMs = 10));
      const backups = fs
        .readdirSync(tmpDir)
        .filter((f) => f.includes("config.json.corrupt-"));
      expect(backups.length).to.equal(1);
      expect(fs.readFileSync(path.join(tmpDir, backups[0]), "utf-8")).to.equal(
        "{ broken",
      );
      expect(read().searchTimeoutMs).to.equal(10);
    });

    it("drops a privateKey the mutator tries to add", function () {
      updateConfigFile((f) => {
        (f as Record<string, unknown>).privateKey = "0xabc";
        f.searchTimeoutMs = 10;
      });
      const j = read();
      expect(j.privateKey).to.equal(undefined);
      expect(j.searchTimeoutMs).to.equal(10);
    });
  });

  // ----------------------------------------------------------- value helpers
  describe("value helpers", function () {
    it("parseConfigValue accepts and rejects per type", function () {
      const bool = findConfigKey("disableP2P")!;
      expect(parseConfigValue(bool, "yes")).to.equal(true);
      expect(parseConfigValue(bool, "0")).to.equal(false);
      expect(() => parseConfigValue(bool, "maybe")).to.throw(/true or false/);

      const int = findConfigKey("indexing.maxRetries")!;
      expect(parseConfigValue(int, "5")).to.equal(5);
      expect(() => parseConfigValue(int, "-1")).to.throw(/integer/);
      expect(() => parseConfigValue(int, "1.5")).to.throw(/integer/);
      expect(() => parseConfigValue(int, "abc")).to.throw(/integer/);

      const search = findConfigKey("searchTimeoutMs")!;
      expect(() => parseConfigValue(search, "0")).to.throw(/>= 1/);

      const list = findConfigKey("bootstrapPeers")!;
      expect(parseConfigValue(list, "a, b ,c")).to.deep.equal(["a", "b", "c"]);
      expect(() => parseConfigValue(list, " , ")).to.throw(/at least one/);
    });

    it("setFileValue / deleteFileValue handle dotted keys", function () {
      const f = {} as Record<string, unknown>;
      setFileValue(f, "indexing.maxRetries", 5);
      expect((f.indexing as Record<string, unknown>).maxRetries).to.equal(5);
      expect(getFileValue(f, "indexing.maxRetries")).to.equal(5);
      deleteFileValue(f, "indexing.maxRetries");
      expect(f.indexing).to.equal(undefined); // parent removed when empty
    });

    it("findConfigKey finds by key and by env-var name", function () {
      expect(findConfigKey("indexing.maxRetries")?.env).to.equal(
        "INDEXING_MAX_RETRIES",
      );
      expect(findConfigKey("INDEXING_MAX_RETRIES")?.key).to.equal(
        "indexing.maxRetries",
      );
      expect(findConfigKey("nope")).to.equal(undefined);
    });

    it("describeSetting reports env/file/default sources", function () {
      write({ searchTimeoutMs: 5 });
      __resetConfigStoreForTests();
      delete process.env.SEARCH_TIMEOUT_MS;
      initConfig();
      const file = readConfigFile();
      const entry = findConfigKey("searchTimeoutMs")!;
      // hydrated → env-provided is false, source is file
      const view = describeSetting(entry, file);
      expect(view.source).to.equal("file");
      expect(view.value).to.equal("5");
    });
  });

  // -------------------------------------------------------------- favourites
  describe("favourite nodes", function () {
    it("adds a first favourite with no description key", function () {
      const r = addFavouriteNode("https://n.example");
      expect(r.result).to.equal("added");
      expect(r.index).to.equal(0);
      expect(r.saved).to.equal(true);
      expect(read().favouriteNodes).to.deep.equal([{ node: "https://n.example" }]);
    });

    it("re-adding the same node is unchanged and keeps the description", function () {
      addFavouriteNode("https://n.example", "my node");
      const r = addFavouriteNode("https://n.example");
      expect(r.result).to.equal("unchanged");
      expect(listFavouriteNodes()).to.have.length(1);
      expect(listFavouriteNodes()[0].description).to.equal("my node");
    });

    it("re-adding with a new description updates it", function () {
      addFavouriteNode("https://n.example", "old");
      const r = addFavouriteNode("https://n.example", "new");
      expect(r.result).to.equal("updated");
      expect(listFavouriteNodes()[0].description).to.equal("new");
    });

    it("normalizes trailing slashes for http(s)", function () {
      addFavouriteNode("https://n.example/");
      const r = addFavouriteNode("https://n.example");
      expect(r.result).to.equal("unchanged");
      expect(listFavouriteNodes()).to.have.length(1);
      expect(normalizeNodeRef("https://n.example/")).to.equal("https://n.example");
    });

    it("resolveFavouriteRef by number and by node", function () {
      addFavouriteNode("https://a.example");
      addFavouriteNode("https://b.example");
      const list = listFavouriteNodes();
      expect(resolveFavouriteRef("2", list)).to.equal(1);
      expect(resolveFavouriteRef("0", list)).to.equal(-1);
      expect(resolveFavouriteRef("99", list)).to.equal(-1);
      expect(resolveFavouriteRef("https://b.example", list)).to.equal(1);
      expect(resolveFavouriteRef("https://zzz.example", list)).to.equal(-1);
    });

    it("removes by number, by node, deletes the key when empty", function () {
      addFavouriteNode("https://a.example");
      addFavouriteNode("https://b.example");
      expect(removeFavouriteNode("1").removed?.node).to.equal("https://a.example");
      expect(removeFavouriteNode("https://b.example").removed?.node).to.equal(
        "https://b.example",
      );
      expect(read().favouriteNodes).to.equal(undefined);
    });

    it("an unknown ref returns removed:null and leaves the file byte-identical", function () {
      addFavouriteNode("https://a.example");
      const before = fs.readFileSync(process.env.OCEANCLI_CONFIG_PATH!, "utf-8");
      const r = removeFavouriteNode("9");
      expect(r.removed).to.equal(null);
      expect(fs.readFileSync(process.env.OCEANCLI_CONFIG_PATH!, "utf-8")).to.equal(
        before,
      );
    });

    it("malformed entries are filtered on read", function () {
      write({ favouriteNodes: [{ node: "" }, 5, { node: "https://ok.example" }] });
      expect(listFavouriteNodes()).to.deep.equal([{ node: "https://ok.example" }]);
      write({ favouriteNodes: "x" });
      expect(listFavouriteNodes()).to.deep.equal([]);
    });

    it("adding a favourite preserves other config keys", function () {
      updateConfigFile((f) => (f.searchTimeoutMs = 7));
      addFavouriteNode("https://n.example");
      const j = read();
      expect(j.searchTimeoutMs).to.equal(7);
      expect(j.favouriteNodes).to.have.length(1);
    });

    // Regression: the mutators must index the SAME sanitized list the user sees, not
    // the raw file. A hand-edited invalid entry before the target used to shift the
    // numbering (remove #1 hit the wrong entry) and could throw a TypeError.
    it("remove/add index the sanitized list, never the raw malformed entries", function () {
      write({
        favouriteNodes: [{ node: "" }, 5, { node: "https://ok.example" }],
      });
      // The user sees only the valid entry as #1, so removing #1 must hit it.
      expect(listFavouriteNodes()).to.deep.equal([{ node: "https://ok.example" }]);
      const r = removeFavouriteNode("1");
      expect(r.removed?.node).to.equal("https://ok.example");
      expect(read().favouriteNodes).to.equal(undefined);
    });

    it("adding onto a file with malformed favourites does not throw and cleans them", function () {
      write({ favouriteNodes: [null, { node: 5 }, { node: "https://keep.example" }] });
      const r = addFavouriteNode("https://new.example");
      expect(r.result).to.equal("added");
      expect(listFavouriteNodes().map((e) => e.node)).to.deep.equal([
        "https://keep.example",
        "https://new.example",
      ]);
    });
  });

  // --------------------------------------------------------- subsidy providers
  describe("subsidy providers", function () {
    const A = "0xAbC0000000000000000000000000000000000001";
    const B = "0xDeF0000000000000000000000000000000000002";

    it("adds a first provider enabled by default, no description key", function () {
      const r = addSubsidyProvider(8453, A);
      expect(r.result).to.equal("added");
      expect(r.index).to.equal(0);
      expect(r.enabled).to.equal(true);
      expect(read().subsidyProviders["8453"]).to.deep.equal([
        { address: A, enabled: true },
      ]);
    });

    it("re-adding the same address (diff casing) is unchanged, keeps enabled", function () {
      addSubsidyProvider(8453, A);
      toggleSubsidyProvider(8453, "1", false);
      const r = addSubsidyProvider(8453, A.toLowerCase());
      expect(r.result).to.equal("unchanged");
      expect(listSubsidyProviders(8453)).to.have.length(1);
      expect(listSubsidyProviders(8453)[0].enabled).to.equal(false);
    });

    it("re-adding with a new description updates it, enabled untouched", function () {
      addSubsidyProvider(8453, A, "old");
      const r = addSubsidyProvider(8453, A, "new");
      expect(r.result).to.equal("updated");
      expect(listSubsidyProviders(8453)[0].description).to.equal("new");
    });

    it("providers are per-chain", function () {
      addSubsidyProvider(8453, A);
      addSubsidyProvider(1, A);
      const map = listAllSubsidyProviders();
      expect(Object.keys(map).sort()).to.deep.equal(["1", "8453"]);
      expect(map["1"]).to.have.length(1);
      expect(map["8453"]).to.have.length(1);
    });

    it("enabledSubsidyProviderAddresses returns only enabled, deduped, in order", function () {
      addSubsidyProvider(8453, A);
      addSubsidyProvider(8453, B);
      expect(enabledSubsidyProviderAddresses(8453)).to.deep.equal([A, B]);
      toggleSubsidyProvider(8453, "1", false);
      expect(enabledSubsidyProviderAddresses(8453)).to.deep.equal([B]);
    });

    it("toggle flips, sets, and reports no match", function () {
      addSubsidyProvider(8453, A);
      expect(toggleSubsidyProvider(8453, "1").enabled).to.equal(false);
      expect(toggleSubsidyProvider(8453, A, false).enabled).to.equal(false);
      expect(toggleSubsidyProvider(8453, "9").entry).to.equal(null);
    });

    it("resolveSubsidyRef by number and by address", function () {
      addSubsidyProvider(8453, A);
      addSubsidyProvider(8453, B);
      const list = listSubsidyProviders(8453);
      expect(resolveSubsidyRef("2", list)).to.equal(1);
      expect(resolveSubsidyRef("0", list)).to.equal(-1);
      expect(resolveSubsidyRef("99", list)).to.equal(-1);
      expect(resolveSubsidyRef(B.toLowerCase(), list)).to.equal(1);
      expect(resolveSubsidyRef("0x9999999999999999999999999999999999999999", list)).to.equal(
        -1,
      );
    });

    it("removes by number/address, deletes empty chain then the map", function () {
      addSubsidyProvider(8453, A);
      addSubsidyProvider(8453, B);
      expect(removeSubsidyProvider(8453, "1").removed?.address).to.equal(A);
      expect(removeSubsidyProvider(8453, B).removed?.address).to.equal(B);
      expect(read().subsidyProviders).to.equal(undefined);
    });

    it("unknown ref → removed:null, file byte-identical", function () {
      addSubsidyProvider(8453, A);
      const before = fs.readFileSync(process.env.OCEANCLI_CONFIG_PATH!, "utf-8");
      expect(removeSubsidyProvider(8453, "9").removed).to.equal(null);
      expect(fs.readFileSync(process.env.OCEANCLI_CONFIG_PATH!, "utf-8")).to.equal(
        before,
      );
    });

    it("malformed file filters entries and coerces enabled", function () {
      write({
        subsidyProviders: {
          "8453": [{ address: "" }, 5, { address: "0xOk", enabled: "yes" }],
        },
      });
      const list = listSubsidyProviders(8453);
      expect(list).to.deep.equal([{ address: "0xOk", enabled: true }]);
      write({ subsidyProviders: "x" });
      expect(listAllSubsidyProviders()).to.deep.equal({});
    });

    it("adding a provider preserves other keys and other chains", function () {
      updateConfigFile((f) => (f.searchTimeoutMs = 3));
      addSubsidyProvider(1, A);
      addSubsidyProvider(8453, B);
      const j = read();
      expect(j.searchTimeoutMs).to.equal(3);
      expect(j.subsidyProviders["1"]).to.have.length(1);
      expect(j.subsidyProviders["8453"]).to.have.length(1);
    });

    // Regression: toggle/remove resolve a by-address or by-number ref against the
    // sanitized list, so a hand-edited malformed entry (e.g. the number 7, which has
    // no `.address`) can neither crash nor shift the numbering.
    it("toggle/remove index the sanitized list and never throw on malformed entries", function () {
      write({
        subsidyProviders: {
          "8453": [{ address: "" }, 7, { address: A, enabled: false }],
        },
      });
      expect(listSubsidyProviders(8453).map((e) => e.address)).to.deep.equal([A]);
      // By-address ref used to iterate the raw list and throw on the bare `7`.
      const t = toggleSubsidyProvider(8453, A);
      expect(t.entry?.address).to.equal(A);
      expect(t.enabled).to.equal(true); // was false, flipped
      const rem = removeSubsidyProvider(8453, "1");
      expect(rem.removed?.address).to.equal(A);
      expect(read().subsidyProviders).to.equal(undefined);
    });
  });

  // ------------------------------------------------------------ legacy import
  describe("legacy rpc.json import", function () {
    let home: string;
    beforeEach(function () {
      home = fs.mkdtempSync(path.join(os.tmpdir(), "ochome-"));
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      delete process.env.OCEANCLI_CONFIG_PATH;
      __resetConfigStoreForTests();
    });
    afterEach(function () {
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });

    const writeRpcJson = (obj: unknown) => {
      const dir = path.join(home, ".ocean", "cli");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "rpc.json"), JSON.stringify(obj));
    };

    it("imports rpc.json into a new config.json, leaves rpc.json in place", function () {
      writeRpcJson({ "137": ["http://x"], "8996": "http://y", defaultChainId: 137 });
      initConfig();
      const cfgPath = path.join(home, ".ocean", "cli", "config.json");
      expect(fs.existsSync(cfgPath)).to.equal(true);
      const j = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      expect(j.rpc["137"]).to.deep.equal(["http://x"]);
      expect(j.rpc["8996"]).to.deep.equal(["http://y"]);
      expect(j.defaultChainId).to.equal(137);
      expect(fs.existsSync(path.join(home, ".ocean", "cli", "rpc.json"))).to.equal(
        true,
      );
    });

    it("does not import when config.json already exists", function () {
      const dir = path.join(home, ".ocean", "cli");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "config.json"),
        JSON.stringify({ version: 1, searchTimeoutMs: 9 }),
      );
      writeRpcJson({ "137": ["http://x"] });
      initConfig();
      const j = JSON.parse(
        fs.readFileSync(path.join(dir, "config.json"), "utf-8"),
      );
      expect(j.rpc).to.equal(undefined);
      expect(j.searchTimeoutMs).to.equal(9);
    });

    it("does not import when OCEANCLI_CONFIG_PATH is set", function () {
      const custom = path.join(home, "custom.json");
      process.env.OCEANCLI_CONFIG_PATH = custom;
      writeRpcJson({ "137": ["http://x"] });
      initConfig();
      expect(fs.existsSync(custom)).to.equal(false);
    });
  });
});
