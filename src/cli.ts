import { Command } from "commander";
import { Commands } from "./commands.js";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import chalk from "chalk";
import { stdin as input, stdout } from "node:process";
import { createInterface } from "readline/promises";
import { getAddress } from "ethers";
import {
  unitsToAmount,
  isP2pUri,
  ServiceStatusNumber,
  ServiceRestartParams,
} from "@oceanprotocol/lib";
import {
  parseComputeInput,
  toBoolean,
  parseSubsidyProviders,
  resolveJobId,
} from "./helpers.js";
import {
  getCurrentNodeUrl,
  getCurrentEnvId,
  hasNode,
  nodeChainIds,
  nodeSubsidyInfo,
  setCurrentNode,
  startP2P,
  validateNode,
} from "./nodeConnection.js";
import {
  buildParamsFromFlags,
  hasSearchFlags,
  SearchFlags,
} from "./searchResourcesHelpers.js";
import { interactiveResourceSearch } from "./searchResourcesFlow.js";
import {
  loadRegistry,
  getActiveChainId,
  getSigner,
  parseRpcEnv,
  getDefaultChainId,
  setDefaultChainId,
  resolveDefaultChain,
  hasChain,
  listChains,
  addChain,
  removeChain,
  clearConfigCache,
  redactRpcUrl,
} from "./rpcRegistry.js";
import {
  loadComputeSpec,
  loadServiceSpec,
  ComputeFileInputs,
  ServiceFileInputs,
} from "./jobSpec.js";
import {
  initConfig,
  configFilePath,
  configPathProblem,
  configFileStatus,
  readConfigFile,
  isEnvProvided,
  originalEnvValue,
  wasHydrated,
  CONFIG_KEYS,
  findConfigKey,
  describeSetting,
  parseConfigValue,
  toEnvString,
  setFileValue,
  deleteFileValue,
  updateConfigFile,
  listFavouriteNodes,
  addFavouriteNode,
  removeFavouriteNode,
  resolveFavouriteRef,
  normalizeNodeRef,
  listSubsidyProviders,
  listAllSubsidyProviders,
  addSubsidyProvider,
  removeSubsidyProvider,
  toggleSubsidyProvider,
} from "./configStore.js";

// Commands usable before any Ocean Node is selected. Everything else is refused by the
// preAction gate below until `setNode` succeeds. Canonical names only — aliases
// (useNode, currentNode, h) resolve to these.
const NODE_FREE_COMMANDS = new Set([
  "setNode",
  "setNodeEnv",
  "getNode",
  "help",
  // A network-wide DHT search — a natural way to *find* a node to select, so it must work
  // before `setNode` picks one.
  "searchComputeResources",
  // Chain/RPC management is independent of the node and must work before one is chosen.
  "addChain",
  "removeChain",
  "listChains",
  "setChain",
  "getChain",
  // Configuration file commands — node-free, edit only the local config file.
  "getConfig",
  "setConfig",
  "unsetConfig",
  // Favourite-node commands — node-free, edit only the local config file.
  "addFavouriteNode",
  "listFavouriteNodes",
  "removeFavouriteNode",
  // Saved subsidy-provider commands — node-free, edit only the local config file.
  "addSubsidyProvider",
  "listSubsidyProviders",
  "removeSubsidyProvider",
  "toggleSubsidyProvider",
  // Query one subsidy-provider contract directly by address. Works with just --chainId (no
  // node needed); when --chainId is omitted it infers the chain from the active node, so it
  // must be reachable before a node is picked too.
  "getSubsidyStatus",
]);

// Commands that must work on a fresh install, before any RPC (or signer) is configured:
// they are how the first chain / setting gets into the config file. Matched against the
// raw argv[0], so this lists canonical names AND aliases.
// The keys getConfig/setConfig/unsetConfig accept by name, for the shared "unknown
// key" error (the per-command rejections of individual keys live in each action).
function knownConfigKeyError(key: string): Error {
  return new Error(
    `Unknown config key "${key}". Known keys: ${[
      ...CONFIG_KEYS.map((k) => k.key),
      "rpc",
      "defaultChainId",
      "favouriteNodes",
      "subsidyProviders",
    ].join(", ")}.`,
  );
}

const CONFIG_BOOTSTRAP_COMMANDS = new Set([
  "addChain",
  "addRpc",
  "listChains",
  "getRpcs",
  "chains",
  "getConfig",
  "showConfig",
  "setConfig",
  "unsetConfig",
  "addFavouriteNode",
  "addFavoriteNode",
  "listFavouriteNodes",
  "listFavoriteNodes",
  "favourites",
  "favorites",
  "removeFavouriteNode",
  "removeFavoriteNode",
  "addSubsidyProvider",
  "addSubsidy",
  "listSubsidyProviders",
  "listSubsidy",
  "removeSubsidyProvider",
  "removeSubsidy",
  "toggleSubsidyProvider",
  "toggleSubsidy",
]);

// Topic grouping for the help listing. Purely presentational: it only changes how the command
// list is printed (`help`, bare `--help`, and the no-arg startup banner), never behavior. Names
// are canonical (aliases are looked up and shown from each command). `assertHelpGroupsCoverAll`
// keeps this in lockstep with the registered commands, so adding a command without grouping it
// fails at startup rather than dropping it silently from help.
interface HelpSubgroup {
  subheading: string;
  commands: string[];
}
interface HelpGroup {
  heading: string;
  commands?: string[];
  subgroups?: HelpSubgroup[];
}
const HELP_GROUPS: HelpGroup[] = [
  {
    heading: "Node & session",
    commands: [
      "setNode",
      "setNodeEnv",
      "getNode",
      "addFavouriteNode",
      "listFavouriteNodes",
      "removeFavouriteNode",
      "help",
    ],
  },
  {
    heading: "Discover compute providers",
    commands: ["searchComputeResources", "getComputeEnvironments"],
  },
  {
    heading: "Chains & RPC",
    commands: ["addChain", "removeChain", "listChains", "setChain", "getChain"],
  },
  {
    heading: "Configuration",
    commands: ["getConfig", "setConfig", "unsetConfig"],
  },
  {
    heading: "Assets — publish, edit, consume",
    commands: [
      "publish",
      "publishAlgo",
      "editAsset",
      "allowAlgo",
      "getDDO",
      "download",
    ],
  },
  {
    heading: "Compute",
    subgroups: [
      {
        subheading: "Jobs (C2D)",
        commands: [
          "startCompute",
          "startFreeCompute",
          "getJobStatus",
          "computeStreamableLogs",
          "downloadJobResults",
          "stopCompute",
        ],
      },
      {
        subheading: "Services on demand",
        commands: [
          "getServiceTemplates",
          "startService",
          "getServiceStatus",
          "getServices",
          "serviceLogs",
          "extendService",
          "restartService",
          "stopService",
        ],
      },
    ],
  },
  {
    heading: "Tokens & auth",
    commands: ["mintOcean", "generateAuthToken", "invalidateAuthToken"],
  },
  {
    heading: "Escrow payments",
    commands: [
      "depositEscrow",
      "getUserFundsEscrow",
      "withdrawFromEscrow",
      "authorizeEscrow",
      "getAuthorizationsEscrow",
      "getEscrowInfo",
    ],
  },
  {
    heading: "Access lists",
    commands: [
      "createAccessList",
      "addToAccessList",
      "checkAccessList",
      "removeFromAccessList",
    ],
  },
  {
    heading: "Subsidy providers",
    commands: [
      "getNodeSubsidyProviders",
      "getNodeSubsidyStatus",
      "getSubsidyStatus",
      "addSubsidyProvider",
      "listSubsidyProviders",
      "removeSubsidyProvider",
      "toggleSubsidyProvider",
    ],
  },
  {
    heading: "Persistent storage (buckets)",
    commands: [
      "createBucket",
      "addFileToBucket",
      "listBuckets",
      "listFilesInBucket",
      "getFileObject",
      "deleteFile",
    ],
  },
  { heading: "Admin", commands: ["downloadNodeLogs"] },
];

// Every command name mentioned across all groups/subgroups, in listing order.
function groupedCommandNames(): string[] {
  const names: string[] = [];
  for (const g of HELP_GROUPS) {
    for (const n of g.commands ?? []) names.push(n);
    for (const s of g.subgroups ?? []) names.push(...s.commands);
  }
  return names;
}

// Fail fast if the groups drift from the registered commands: a command in no group (would
// vanish from help), one grouped twice, or a group naming a command that no longer exists.
function assertHelpGroupsCoverAll(program: Command): void {
  const grouped = groupedCommandNames();
  const dupes = [
    ...new Set(grouped.filter((n, i) => grouped.indexOf(n) !== i)),
  ];
  const registered = program.commands.map((c) => c.name());
  const missing = registered.filter((n) => !grouped.includes(n));
  const unknown = grouped.filter((n) => !registered.includes(n));
  const problems: string[] = [];
  if (dupes.length)
    problems.push(`listed in more than one group: ${dupes.join(", ")}`);
  if (missing.length)
    problems.push(`not in any help group: ${missing.join(", ")}`);
  if (unknown.length)
    problems.push(`grouped but not registered: ${unknown.join(", ")}`);
  if (problems.length) {
    throw new Error(`Help groups out of sync — ${problems.join("; ")}`);
  }
}

// Render the topic-grouped command listing used by `help` and the startup banner.
export function formatGroupedHelp(program: Command): string {
  const byName = new Map(program.commands.map((c) => [c.name(), c] as const));
  const line = (name: string): string => {
    const cmd = byName.get(name);
    const aliases = cmd?.aliases() ?? [];
    const label = aliases.length ? `${name} (${aliases.join(", ")})` : name;
    const desc = cmd?.description() ?? "";
    const gap = label.length < 38 ? " ".repeat(38 - label.length) : "  ";
    return `  ${label}${gap}${desc}`;
  };

  const out: string[] = [
    chalk.bold(`Ocean CLI v${pkg.version} — commands`),
    "",
  ];
  for (const group of HELP_GROUPS) {
    out.push(chalk.cyan.bold(group.heading));
    for (const n of group.commands ?? []) out.push(line(n));
    for (const sub of group.subgroups ?? []) {
      out.push(chalk.cyan(`  ${sub.subheading}:`));
      for (const n of sub.commands) out.push(line(n));
    }
    out.push("");
  }
  out.push(
    chalk.gray(
      "Both positional args and named options work for every command. Add -h/--help after a command for its options, e.g.  publish --help",
    ),
  );
  return out.join("\n");
}

// Single source of truth for the CLI version: read it from package.json instead
// of hardcoding, so it can't drift. `../package.json` resolves from both src/
// (dev via tsx) and dist/ (published), since both sit one level below the root.
const pkg = createRequire(import.meta.url)("../package.json");

// Print the subsidy-provider info a node advertises in its status (shared by getNode and
// getNodeSubsidyProviders). `indent` lets getNode nest it under the node summary.
function printSubsidyInfo(
  info: { providers: Record<string, string[]>; filter: boolean },
  indent = "  ",
): void {
  const chains = Object.keys(info.providers).filter(
    (c) => (info.providers[c]?.length ?? 0) > 0,
  );
  if (chains.length === 0) {
    console.log(
      chalk.yellow(`${indent}Subsidy providers: none advertised by this node.`),
    );
  } else {
    console.log(`${indent}Subsidy providers:`);
    for (const c of chains.sort()) {
      console.log(`${indent}  chain ${c}: ${info.providers[c].join(", ")}`);
    }
  }
  console.log(
    `${indent}Subsidy provider filter (whitelist enforced): ${
      info.filter ? "on" : "off"
    }`,
  );
}

// Print one chain's saved subsidy providers (used by listSubsidyProviders / getConfig).
// Each entry shows its 1-based number, an [on]/[off] status tag, the address, and the
// description on its own indented line.
function printSubsidyProviderChain(
  chainId: number,
  list: { address: string; enabled: boolean; description?: string }[],
): void {
  console.log(chalk.bold(`Subsidy providers — chain ${chainId}:`));
  list.forEach((entry, i) => {
    const tag = entry.enabled
      ? chalk.green("[on] ")
      : chalk.gray("[off]");
    console.log(`  ${i + 1}. ${tag} ${entry.address}`);
    if (entry.description) {
      console.log(chalk.gray(`       ${entry.description}`));
    }
  });
}

// Parse a CLI JSON array-of-strings option (e.g. --cmd '["python","app.py"]').
// Returns the array, or throws with a clear message for the action to surface.
function parseJsonStringArray(name: string, value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be a JSON array, e.g. '["a","b"]'`);
  }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  return parsed as string[];
}

// Parse a comma-separated port list, validating each is an integer 1-65535.
function parsePorts(value: string): number[] {
  return value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const n = parseInt(p, 10);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`Invalid port "${p}" (must be an integer 1-65535)`);
      }
      return n;
    });
}

const FROM_JSON_DESCRIPTION =
  "Read all parameters from a JSON file (see README: 'Start from a JSON file'). " +
  "Named options passed alongside override the file; positional arguments are not allowed with it.";

// --from-json takes every value from the file; a positional next to it is almost
// certainly a mistake, so refuse instead of guessing which one wins.
function rejectPositionalsWithFromJson(
  commandName: string,
  positionals: unknown[],
): void {
  if (positionals.some((p) => p !== undefined)) {
    throw new Error(
      `${commandName}: positional arguments cannot be combined with --from-json. ` +
        "Put the values in the JSON file, or override single values with named options (e.g. --env, --accept).",
    );
  }
}

// Commander collector for a repeatable `--resource name:amount` option.
function collectResource(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

// Options declared with an optional value (e.g. "-s, --services [serviceIds]") are set to the
// boolean `true` when the flag is passed with no value. Coerce any non-string to undefined so a
// bare flag falls through to the positional / file value instead of becoming `true` (which would
// later blow up on `.split(...)` or be forwarded as a bogus output location).
function optStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Run the interactive resource-search wizard, but only when we have a TTY — a wizard with
// no stdin would hang. In a non-interactive context, tell the user to pass filter flags.
async function runResourceWizard(chainId: number) {
  if (!input.isTTY) {
    throw new Error(
      "searchComputeResources needs either filter flags (e.g. --cpu 4 --paid) or an " +
        "interactive terminal for the wizard. Run with --help to see the flags.",
    );
  }
  return interactiveResourceSearch(chainId);
}

// Thin wrapper over the RPC registry: seed it from the `RPC` env, resolve the single
// active (default) chain, and return that chain's memoized signer. For legacy
// single-URL users the chainId is still discovered by probing getNetwork() and nothing
// about their behavior changes; multi-URL/JSON-map users get a FallbackProvider.
async function initializeSigner() {
  loadRegistry();
  // Lenient: the real default when there is one, else any registered chain purely to
  // obtain a signer for chain-agnostic commands (plan §"Default chain" step 4).
  const chainId = await getActiveChainId();
  const signer = await getSigner(chainId);
  return { signer, chainId };
}

// Resolve the chain for a chain-explicit command (category c): the `--chainId` flag →
// the default chain → a clear error. Validates the flag is a registered positive integer.
function resolveChainId(flag?: string | number): number {
  if (flag !== undefined && flag !== null && `${flag}`.trim() !== "") {
    const id = Number(flag);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(
        `Invalid --chainId "${flag}": must be a positive integer.`,
      );
    }
    if (!hasChain(id)) {
      throw new Error(
        `Chain ${id} is not configured. Configured chains: ${
          listChains()
            .map((c) => c.chainId)
            .join(", ") || "none"
        }. Add it with 'addChain <chainId> <rpcUrl>'.`,
      );
    }
    return id;
  }
  const def = getDefaultChainId();
  if (def !== undefined) return def;
  throw new Error(
    `No chain specified and no default chain is set. Pass --chainId <id>, or run 'setChain <id>'. Configured chains: ${
      listChains()
        .map((c) => c.chainId)
        .join(", ") || "none"
    }.`,
  );
}

// Route a chain-explicit command's Commands instance onto the resolved chain. Returns the
// resolved chainId, or null (already logged) when resolution/switch fails so the action bails.
async function routeExplicit(
  commands: Commands,
  flag?: string | number,
): Promise<number | null> {
  try {
    const target = resolveChainId(flag);
    await commands.useChain(target);
    return target;
  } catch (e) {
    console.error(chalk.red((e as Error).message));
    return null;
  }
}

// A node/env selection is saved to the config file, but an env var set by the user still
// wins on the next start — say so instead of letting the saved value look ignored later.
function warnIfEnvShadows(envVar: string, saved: string): void {
  const original = originalEnvValue(envVar);
  if (isEnvProvided(envVar) && original !== saved) {
    console.log(
      chalk.yellow(
        `Saved to ${configFilePath()}, but ${envVar} is set in your environment (${original}) ` +
          `and will take precedence on the next start.`,
      ),
    );
  }
}

export async function createCLI() {
  // A pure help/version invocation must work with no configuration at all (a
  // globally installed binary is expected to answer `--help`/`--version`
  // without credentials). Detect it from argv and skip both env validation and
  // the P2P bootstrap in that case; every real command still validates below.
  const argv = process.argv.slice(2);
  const isHelpOrVersion =
    argv.includes("--help") ||
    argv.includes("-h") ||
    argv.includes("--version") ||
    argv.includes("-V") ||
    argv[0] === "help" ||
    argv[0] === "h";

  // Load the config file and hydrate process.env from it BEFORE any validation, and
  // before ocean.js ConfigHelper can read ADDRESS_FILE. Pure local I/O; never throws.
  // On a pure help/version run the one-time legacy rpc.json import is skipped so
  // `ocean-cli --help` never writes a file (hydration itself has no side effects).
  initConfig(!isHelpOrVersion);

  const isBootstrap = argv.length > 0 && CONFIG_BOOTSTRAP_COMMANDS.has(argv[0]);
  // Bare interactive start (no command, REPL mode): let the user in so they can addChain.
  const isBareLoopStart =
    argv.length === 0 && process.env.AVOID_LOOP_RUN !== "true";
  // Node-switch commands (setNode / setNodeEnv) replace the active node, so they must be
  // able to run even when the *current* saved node is a P2P URI under DISABLE_P2P (they are
  // the fix), and the startup reachability probe of the node they are about to drop is moot.
  const isNodeSwitch = ["setNode", "useNode", "setNodeEnv", "useNodeEnv"].includes(
    argv[0],
  );
  // getSubsidyStatus reads one provider contract on-chain via RPC and never touches the saved
  // node, so it must run even under the DISABLE_P2P + saved-P2P-node contradiction below (that
  // deadlock only affects node-using commands) and needs no startup reachability probe.
  const isNodeFreeRpcCommand = [
    "getSubsidyStatus",
    "getSubsidyProviderStatus",
  ].includes(argv[0]);

  if (!isHelpOrVersion) {
    const pathProblem = configPathProblem();
    if (pathProblem) {
      console.error(chalk.red(pathProblem));
      process.exit(1);
    }
    if (
      !isBootstrap &&
      !isBareLoopStart &&
      !process.env.MNEMONIC &&
      !process.env.PRIVATE_KEY
    ) {
      console.error(
        chalk.red("Have you forgot to set MNEMONIC or PRIVATE_KEY?"),
      );
      process.exit(1);
    }
    const fileHasChains =
      Object.keys(readConfigFile().rpc ?? {}).length > 0;
    if (!process.env.RPC && !fileHasChains) {
      if (isBootstrap || isBareLoopStart) {
        console.log(
          chalk.yellow(
            "No RPC configured yet. Add one with `addChain <chainId> <rpcUrl>` (it is saved to the config file).",
          ),
        );
      } else {
        console.error(chalk.red("Have you forgot to set env RPC?"));
        console.error(
          chalk.yellow(
            "Set RPC, or save one to the config file with: addChain <chainId> <rpcUrl>",
          ),
        );
        process.exit(1);
      }
    }
    // Validate the RPC shape (single URL or JSON map keyed by chainId) up front, so a
    // malformed value fails fast with a clear, example-bearing message instead of deep
    // inside the first command. Pure parse — no providers built, no network touched.
    if (process.env.RPC) {
      try {
        parseRpcEnv(process.env.RPC);
      } catch (e) {
        console.error(chalk.red((e as Error).message));
        process.exit(1);
      }
    }
  }

  // NODE_URL is optional: without it the CLI still starts, but only the commands in
  // NODE_FREE_COMMANDS are accepted until `setNode` picks a node (see the gate below).
  if (!isHelpOrVersion) {
    // A saved P2P node plus DISABLE_P2P is a contradiction: no node-using command could
    // reach it. Exit for those — but NOT for the config/bootstrap commands, a bare REPL
    // start, or a node-switch command, which are the ways to escape the deadlock
    // (`unsetConfig nodeUrl`, or `setNode <http-url>` to replace the P2P node). Blocking
    // them too would leave hand-editing the JSON as the user's only recourse.
    if (
      !isBootstrap &&
      !isBareLoopStart &&
      !isNodeSwitch &&
      !isNodeFreeRpcCommand &&
      process.env.DISABLE_P2P === "true" &&
      isP2pUri(getCurrentNodeUrl())
    ) {
      const src = (v: string) => (wasHydrated(v) ? "config file" : "environment");
      console.error(
        chalk.red(
          `The node (${getCurrentNodeUrl()}, from ${src("NODE_URL")}) is a P2P URI but P2P is disabled ` +
            `(DISABLE_P2P=true, from ${src("DISABLE_P2P")}) — no command could reach it. ` +
            `Change one of them (e.g. 'unsetConfig nodeUrl' or 'setNode <http-url>').`,
        ),
      );
      process.exit(1);
    }

    // Eager, non-blocking: libp2p warms up (bootstrap dials + DHT) while the user reads
    // the prompt, so a later switch to a P2P node doesn't pay that cost interactively.
    //
    // Only in loop mode. A one-shot run has no "later command" to warm up for, and
    // starting a libp2p node it never uses would just delay its exit — the process
    // cannot end until the node is up and stopped again. One-shot runs that *do* target
    // a P2P node still get it: validateNode() -> ensureP2PReady() starts it on demand.
    if (process.env.AVOID_LOOP_RUN !== "true") {
      startP2P(process.env.NODE_URL);
    }

    if (hasNode() && !isBootstrap && !isNodeSwitch && !isNodeFreeRpcCommand) {
      // Confirms the startup node is reachable before the user types anything. For a
      // P2P node the status call dials the peer, which is what the old wait-for-peer
      // polling loop used to do. Skipped for config/bootstrap and node-switch commands:
      // they do not use the saved node (a node-switch is about to replace it), so probing
      // it is wasted work and, under DISABLE_P2P + a P2P node, a misleading error.
      const status = await validateNode(getCurrentNodeUrl());
      if (status) {
        console.log(
          chalk.green(
            `Using node ${getCurrentNodeUrl()} (version ${status.version})` +
              (wasHydrated("NODE_URL") ? " [from config file]" : ""),
          ),
        );
      } else {
        console.error(
          chalk.red(
            `Node ${getCurrentNodeUrl()} is not reachable. Commands may fail.`,
          ),
        );
      }
    } else if (!hasNode()) {
      console.log(
        chalk.yellow(
          "No Ocean Node configured. Run `setNode <nodeUrl>` to choose one — " +
            `only ${[...NODE_FREE_COMMANDS].join(", ")} are available until then.`,
        ),
      );
    }
  }

  const program = new Command();

  program
    .name("ocean-cli")
    .description("CLI tool to interact with Ocean Protocol")
    .version(pkg.version)
    .helpOption("-h, --help", "Display help for command");

  // Every command except the node-free ones needs an Ocean Node. A single preAction
  // hook on the root program runs before *any* subcommand action, so this covers both
  // the REPL loop and one-shot mode without touching 40 action bodies.
  //
  // A plain Error (not a CommanderError) is thrown on purpose: in loop mode index.ts
  // reports it in red and keeps the REPL alive; in one-shot mode main() reports it and
  // exits 1, so scripts see a non-zero status.
  program.hook("preAction", (_thisCommand, actionCommand) => {
    // actionCommand.name() is the canonical name, so aliases resolve for free.
    if (!hasNode() && !NODE_FREE_COMMANDS.has(actionCommand.name())) {
      throw new Error(
        `No Ocean Node set. Run \`setNode <nodeUrl>\` first ` +
          `(available now: ${[...NODE_FREE_COMMANDS].join(", ")}).`,
      );
    }
  });

  // Custom help command to support legacy "h" invocation. Prints the topic-grouped listing.
  program
    .command("help")
    .alias("h")
    .description("Display help for all commands")
    .action(() => {
      console.log(formatGroupedHelp(program));
    });

  // setNode command. The switch itself never touches the RPC/signer: choosing a node is
  // independent of them and must work even when the RPC is slow or wrong. The RPC is
  // consulted only afterwards, under a timeout, to warn about a chain mismatch.
  program
    .command("setNode")
    .alias("useNode")
    .description(
      "Sets / switches the Ocean Node used by subsequent commands, without restarting (saved to the config file)",
    )
    .argument(
      "[nodeUrl]",
      "HTTP(S) URL, peer id, full multiaddr, or a favourite number from listFavouriteNodes",
    )
    .option("-n, --node <nodeUrl>", "Ocean Node to use")
    .action(async (nodeUrl, options) => {
      let target = options.node || nodeUrl;
      if (!target) {
        throw new Error(
          "A node is required. Pass it positionally or with --node (URL / peer id / multiaddr).",
        );
      }
      // `setNode 2` selects favourite #2 from listFavouriteNodes. A node URL / peer id is
      // never all digits, so this cannot shadow a real node reference.
      if (/^\d+$/.test(target)) {
        const favourites = listFavouriteNodes();
        const idx = resolveFavouriteRef(target, favourites);
        if (idx < 0) {
          throw new Error(
            `No favourite node #${target}. Run listFavouriteNodes to see the saved ones ` +
              `(${favourites.length} saved).`,
          );
        }
        target = favourites[idx].node;
        console.log(chalk.cyan(`Favourite #${idx + 1}: ${target}`));
      }
      const previous = getCurrentNodeUrl();
      if (target === previous) {
        console.log(chalk.green(`Node ${target} is already the active one.`));
        return;
      }

      const status = await validateNode(target);
      if (!status) {
        console.error(
          chalk.red(
            previous
              ? `Cannot reach ${target}. Keeping current node: ${previous}`
              : `Cannot reach ${target}. Still no node set.`,
          ),
        );
        return;
      }

      // The node changed (equal targets returned early above), so any env remembered by
      // setNodeEnv belonged to the previous node and no longer applies — set the node and
      // clear the env id in one write so a failure can't leave a mismatched pair.
      const saved = setCurrentNode(target, null);
      warnIfEnvShadows("NODE_URL", target);
      if (saved) {
        console.log(
          chalk.green(`Using node: ${target} (version ${status.version})`),
        );
      } else {
        // setCurrentNode applied the switch to this session but could not persist it
        // (updateConfigFile already said why) — don't report it as a saved selection.
        console.log(
          chalk.yellow(
            `Using node (this session only): ${target} (version ${status.version}) — ` +
              "could not save it to the config file, so it won't be remembered after a restart.",
          ),
        );
      }

      // chainId comes from RPC, not from the node, so the two can disagree. The switch
      // is already committed at this point, so this is a courtesy warning only — bound
      // it so an unresponsive RPC cannot leave the command hanging.
      const chainIds = nodeChainIds(status);
      if (chainIds.length > 0) {
        let timer: NodeJS.Timeout | undefined;
        try {
          const { chainId } = await Promise.race([
            initializeSigner(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error("RPC timeout")), 5000);
            }),
          ]);
          if (!chainIds.includes(String(chainId))) {
            console.log(
              chalk.yellow(
                `Warning: this node serves chain(s) ${chainIds.join(", ")} but RPC is on chain ${chainId}. Commands may fail.`,
              ),
            );
          }
        } catch {
          // A bad/slow RPC must not make a successful node switch look like a failure.
        } finally {
          // Leaving the loser pending would keep the event loop alive for 5s.
          clearTimeout(timer);
        }
      }
    });

  // setNodeEnv command: paste a search result's "node|env" token to select BOTH the Ocean Node
  // and the compute environment for subsequent compute commands in one step. Mirrors setNode
  // (validate then switch the node) and additionally remembers the env id.
  program
    .command("setNodeEnv")
    .alias("useNodeEnv")
    .description(
      "Select both an Ocean Node and a compute environment from a search result's 'node|env' token (saved to the config file)",
    )
    .argument(
      "<nodeEnv>",
      "A 'node|env' token from a searchComputeResources result (node URL/peer id, a '|', then the env id)",
    )
    .action(async (nodeEnv) => {
      // Tolerate a pasted "Node+env: <node>|<env>" line, not just the bare token.
      const raw = nodeEnv.replace(/^\s*Node\+env:\s*/i, "").trim();
      const sep = raw.indexOf("|");
      if (sep <= 0 || sep === raw.length - 1) {
        console.error(
          chalk.red(
            "Expected a 'node|env' token (node, a '|', then the compute env id), e.g. 16Uiu2…|0xabc…-0xdef…",
          ),
        );
        return;
      }
      const target = raw.slice(0, sep).trim();
      const envId = raw.slice(sep + 1).trim();

      const status = await validateNode(target);
      if (!status) {
        const previous = getCurrentNodeUrl();
        console.error(
          chalk.red(
            previous
              ? `Cannot reach ${target}. Keeping current node: ${previous} (env unchanged)`
              : `Cannot reach ${target}. Still no node set.`,
          ),
        );
        return;
      }

      // Persist node + env id together in one write (no mismatched pair on partial failure).
      const saved = setCurrentNode(target, envId);
      warnIfEnvShadows("NODE_URL", target);
      warnIfEnvShadows("COMPUTE_ENV_ID", envId);
      if (saved) {
        console.log(
          chalk.green(
            `Using node: ${target} (version ${status.version})\nUsing compute env: ${envId}`,
          ),
        );
      } else {
        // Applied to this session but not persisted (updateConfigFile already said why) —
        // don't report it as a saved selection.
        console.log(
          chalk.yellow(
            `Using node (this session only): ${target} (version ${status.version})\n` +
              `Using compute env (this session only): ${envId}\n` +
              "Could not save this selection to the config file, so it won't be remembered after a restart.",
          ),
        );
      }
      console.log(
        chalk.yellow(
          "startCompute / startFreeCompute will use this env by default (override with --env).",
        ),
      );
    });

  // getNode command
  program
    .command("getNode")
    .alias("currentNode")
    .description("Shows the Ocean Node currently in use")
    .action(async () => {
      const current = getCurrentNodeUrl();
      if (!current) {
        console.log(
          chalk.yellow(
            "No Ocean Node set. Run `setNode <nodeUrl>` to pick one.",
          ),
        );
        return;
      }
      console.log(`Current Ocean Node: ${current}`);
      const envId = getCurrentEnvId();
      if (envId) {
        console.log(`Selected compute env: ${envId}`);
      }
      // Best effort: a node that is down must not fail the command.
      const status = await validateNode(current);
      if (status) {
        const nodeChains = nodeChainIds(status);
        console.log(
          `Version: ${status.version}, chain(s): ${nodeChains.join(", ") || "none"}`,
        );
        // Cross-reference the node's served chains with the RPC registry, surfacing any
        // chain the node serves but for which no RPC is configured (commands would fail).
        try {
          loadRegistry();
          const missing = nodeChains.filter((c) => !hasChain(Number(c)));
          const configured = nodeChains.filter((c) => hasChain(Number(c)));
          if (configured.length) {
            console.log(
              chalk.green(
                `  RPC configured for chain(s): ${configured.join(", ")}`,
              ),
            );
          }
          if (missing.length) {
            console.log(
              chalk.yellow(
                `  No RPC configured for node chain(s): ${missing.join(
                  ", ",
                )} — add one with 'addChain <chainId> <rpcUrl>'.`,
              ),
            );
          }
        } catch {
          // RPC not configured / unavailable — the node info above is still useful.
        }
        printSubsidyInfo(nodeSubsidyInfo(status));
      } else {
        console.log(chalk.yellow("Node is not reachable right now."));
      }
    });

  // getNodeSubsidyProviders command — show the subsidy-provider contracts the current node
  // advertises per chain (and whether it enforces a whitelist on user-supplied ones).
  // Node-dependent (deliberately NOT in NODE_FREE_COMMANDS): the preAction gate refuses it
  // until a node is set. Implemented inline like getNode — no signer/Commands needed.
  program
    .command("getNodeSubsidyProviders")
    .alias("subsidyProviders")
    .description(
      "Show the subsidy-provider contracts the current Ocean Node supports (per chain)",
    )
    .action(async () => {
      const current = getCurrentNodeUrl();
      if (!current) {
        console.log(
          chalk.yellow(
            "No Ocean Node set. Run `setNode <nodeUrl>` to pick one.",
          ),
        );
        return;
      }
      const status = await validateNode(current);
      if (!status) {
        console.log(chalk.yellow("Node is not reachable right now."));
        return;
      }
      console.log(`Ocean Node: ${current}`);
      printSubsidyInfo(nodeSubsidyInfo(status));
    });

  // getNodeSubsidyStatus command — read-only, provider-agnostic subsidy report for a token on a
  // chain: kind, per-window buckets (limit/used/remaining), claimable-now amount, contract
  // balance, eligibility, and (with --node/--jobType/--amount) a quote. Provider addresses are
  // discovered from the node; --subsidy only narrows to a subset the node advertises.
  program
    .command("getNodeSubsidyStatus")
    .alias("subsidyStatus")
    .description(
      "Show subsidy limits / remaining credit for a token from the node's subsidy providers",
    )
    .argument("[token]", "Token address to report limits/credit for (or use --token)")
    .option("-t, --token <token>", "Token address to report limits/credit for")
    .option(
      "--chainId <chainId>",
      "Subsidy/escrow chain (default: active chain)",
    )
    .option(
      "--subsidy <list>",
      "Narrow to specific node-advertised provider contract(s) (comma-separated); else all the node lists",
    )
    .option(
      "--node <urlOrPeerId>",
      "Ocean Node to query for providers (URL / peer id / multiaddr); default: active node. Its on-chain address is used for isNodeAllowed / quoteSubsidy",
    )
    .option(
      "--jobType <type>",
      "Job type for isJobTypeSubsidized / quoteSubsidy (compute | service | none)",
    )
    .option(
      "--amount <value>",
      "Job amount to quote a subsidy for, in natural token units (e.g. 1.5). Needs --jobType (uses the queried node's address).",
    )
    .action(async (token, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.getNodeSubsidyStatus(token || options.token, {
        subsidy: options.subsidy,
        node: options.node,
        jobType: options.jobType,
        amount: options.amount,
      });
    });

  // getSubsidyStatus command — read-only report for ONE subsidy-provider contract the caller
  // names directly (by address), independent of the node's advertised list. Node-free: it needs
  // only an RPC for the provider's chain. The chain is resolved as --chainId / positional chainId
  // → the chain your saved subsidy providers (addSubsidyProvider / listSubsidyProviders) record
  // this provider on → error asking for a chainId (required when the provider is not saved).
  program
    .command("getSubsidyStatus")
    .alias("getSubsidyProviderStatus")
    .description(
      "Show limits / remaining credit for one subsidy-provider contract (by address) for a token",
    )
    .argument("<subsidyProviderAddress>", "Subsidy-provider contract address")
    .argument("<tokenAddress>", "Token address to report limits/credit for")
    .argument(
      "[chainId]",
      "Chain the provider lives on (required when it is not in your saved subsidy providers)",
    )
    .option(
      "--chainId <chainId>",
      "Chain the provider lives on (overrides the positional chainId; inferred from your saved subsidy providers when omitted)",
    )
    .option(
      "--node <urlOrPeerId>",
      "Ocean Node whose on-chain address is used for the isNodeAllowed line / quote (URL / peer id / multiaddr); default: active node",
    )
    .option(
      "--jobType <type>",
      "Job type for isJobTypeSubsidized / quoteSubsidy (compute | service | none)",
    )
    .option(
      "--amount <value>",
      "Job amount to quote a subsidy for, in natural token units (e.g. 1.5). Needs --jobType and a node address.",
    )
    .action(async (subsidyProviderAddress, tokenAddress, chainId, options) => {
      const { signer, chainId: defaultChainId } = await initializeSigner();
      const commands = new Commands(signer, defaultChainId);
      await commands.getSubsidyProviderStatus(subsidyProviderAddress, tokenAddress, {
        chainId: options.chainId || chainId,
        node: options.node,
        jobType: options.jobType,
        amount: options.amount,
      });
    });

  // ---------------------------------------------------------------------------
  // Saved subsidy-provider commands (node-free — see NODE_FREE_COMMANDS). They edit only
  // the local config file: no signer, no node, no RPC, so they run on a completely fresh
  // install. chainId is a required explicit argument (no registry default) so they stay
  // RPC-free. Enabled entries are merged with the node's own providers by startCompute /
  // startService / extendService when --subsidyProviders is omitted.
  // ---------------------------------------------------------------------------
  const requireSubsidyChainId = (raw: unknown): number => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(
        "A chain id is required: addSubsidyProvider <chainId> <address> [description].",
      );
    }
    return id;
  };

  program
    .command("addSubsidyProvider")
    .alias("addSubsidy")
    .description(
      "Save a subsidy-provider contract for a chain (enabled by default), with an optional description",
    )
    .argument("[chainId]", "Chain id the provider lives on")
    .argument("[address]", "Subsidy-provider contract address")
    .argument("[description...]", "Optional free-text description")
    .option("-c, --chainId <id>", "Chain id")
    .option("-a, --address <address>", "Subsidy-provider contract address")
    .option("-d, --description <text>", "Optional description")
    .action(async (chainIdArg, addressArg, descriptionArgs, options) => {
      const chainId = requireSubsidyChainId(options.chainId ?? chainIdArg);
      const addressArgValue = options.address || addressArg;
      if (!addressArgValue) {
        throw new Error("A subsidy-provider address is required.");
      }
      let address: string;
      try {
        address = getAddress(String(addressArgValue).trim());
      } catch {
        throw new Error(`"${addressArgValue}" is not a valid EVM address.`);
      }
      const description =
        options.description ?? (descriptionArgs ?? []).join(" ");
      const { result, index, enabled, saved } = addSubsidyProvider(
        chainId,
        address,
        description,
      );
      if (!saved) {
        console.error(
          chalk.red("Subsidy provider was not saved (see the warning above)."),
        );
        return;
      }
      const descr = description ? ` — ${description}` : "";
      if (result === "added") {
        console.log(
          chalk.green(
            `Saved subsidy provider #${index + 1} on chain ${chainId}: ${address}${descr}${
              enabled ? "" : " (disabled)"
            }`,
          ),
        );
      } else if (result === "updated") {
        console.log(
          chalk.green(
            `Updated the description of subsidy provider #${
              index + 1
            } on chain ${chainId}: ${address} — ${description}`,
          ),
        );
      } else {
        console.log(
          `Subsidy provider #${index + 1} already saved on chain ${chainId}: ${address}${
            enabled ? "" : " (disabled)"
          }`,
        );
      }
      if (result !== "unchanged") {
        console.log(
          chalk.gray(
            `Toggle it with: toggleSubsidyProvider ${chainId} ${index + 1}`,
          ),
        );
      }
    });

  program
    .command("listSubsidyProviders")
    .alias("listSubsidy")
    .description(
      "List your saved subsidy providers (all chains, or one). These are merged with the node's own providers at compute/service time.",
    )
    .argument("[chainId]", "Show only this chain")
    .option("-c, --chainId <id>", "Show only this chain")
    .action(async (chainIdArg, options) => {
      const only = options.chainId ?? chainIdArg;
      if (only !== undefined) {
        const id = Number(only);
        if (!Number.isInteger(id) || id <= 0) {
          throw new Error(`"${only}" is not a valid chain id.`);
        }
        const list = listSubsidyProviders(id);
        if (list.length === 0) {
          console.log(
            chalk.yellow(
              `No subsidy providers saved for chain ${id}. Add one with \`addSubsidyProvider ${id} <address>\`.`,
            ),
          );
          return;
        }
        printSubsidyProviderChain(id, list);
      } else {
        const all = listAllSubsidyProviders();
        const chainIds = Object.keys(all);
        if (chainIds.length === 0) {
          console.log(
            chalk.yellow(
              "No subsidy providers saved. Add one with `addSubsidyProvider <chainId> <address>`.",
            ),
          );
          return;
        }
        for (const cid of chainIds
          .map((c) => Number(c))
          .sort((a, b) => a - b)) {
          printSubsidyProviderChain(cid, all[String(cid)]);
        }
      }
      console.log(
        chalk.gray(
          "Use `toggleSubsidyProvider <chainId> <number|address>` to enable/disable, `removeSubsidyProvider <chainId> <number|address>` to delete. Enabled entries are used automatically by startCompute / startService unless you pass --subsidyProviders.",
        ),
      );
    });

  program
    .command("removeSubsidyProvider")
    .alias("removeSubsidy")
    .description(
      "Remove a saved subsidy provider from a chain (by its number or by address)",
    )
    .argument("[chainId]", "Chain id")
    .argument("[ref]", "Subsidy number (from listSubsidyProviders) or the address")
    .option("-c, --chainId <id>", "Chain id")
    .option("-r, --ref <ref>", "Subsidy number or address")
    .action(async (chainIdArg, refArg, options) => {
      const chainId = requireSubsidyChainId(options.chainId ?? chainIdArg);
      const ref = options.ref || refArg;
      if (!ref) {
        throw new Error(
          "Pass a subsidy number (see listSubsidyProviders) or the provider address.",
        );
      }
      const { removed, saved } = removeSubsidyProvider(chainId, String(ref));
      if (removed === null) {
        console.error(
          chalk.red(
            `No saved subsidy provider matches "${ref}" on chain ${chainId}. Run listSubsidyProviders ${chainId} to see them.`,
          ),
        );
        return;
      }
      if (!saved) {
        console.error(
          chalk.red(
            "Subsidy provider was not removed (see the warning above).",
          ),
        );
        return;
      }
      console.log(
        chalk.green(
          `Removed subsidy provider on chain ${chainId}: ${removed.address}${
            removed.description ? ` — ${removed.description}` : ""
          }`,
        ),
      );
    });

  program
    .command("toggleSubsidyProvider")
    .alias("toggleSubsidy")
    .description(
      "Enable or disable a saved subsidy provider (toggles when no state is given)",
    )
    .argument("[chainId]", "Chain id")
    .argument("[ref]", "Subsidy number (from listSubsidyProviders) or the address")
    .argument("[state]", "on | off (omit to flip the current state)")
    .option("-c, --chainId <id>", "Chain id")
    .option("-r, --ref <ref>", "Subsidy number or address")
    .option("-s, --state <state>", "on | off")
    .action(async (chainIdArg, refArg, stateArg, options) => {
      const chainId = requireSubsidyChainId(options.chainId ?? chainIdArg);
      const ref = options.ref || refArg;
      if (!ref) {
        throw new Error(
          "Pass a subsidy number (see listSubsidyProviders) or the provider address.",
        );
      }
      const rawState = options.state ?? stateArg;
      let state: boolean | undefined;
      if (rawState === undefined || String(rawState).trim() === "") {
        state = undefined;
      } else {
        const s = String(rawState).trim().toLowerCase();
        if (["on", "true", "1", "enable", "enabled"].includes(s)) state = true;
        else if (["off", "false", "0", "disable", "disabled"].includes(s))
          state = false;
        else throw new Error(`State must be on or off (got "${rawState}").`);
      }
      const { entry, enabled, saved } = toggleSubsidyProvider(
        chainId,
        String(ref),
        state,
      );
      if (entry === null) {
        console.error(
          chalk.red(
            `No saved subsidy provider matches "${ref}" on chain ${chainId}. Run listSubsidyProviders ${chainId} to see them.`,
          ),
        );
        return;
      }
      if (!saved) {
        console.error(
          chalk.red(
            "Subsidy provider was not updated (see the warning above).",
          ),
        );
        return;
      }
      if (enabled) {
        console.log(
          chalk.green(
            `Enabled subsidy provider on chain ${chainId}: ${entry.address}`,
          ),
        );
      } else {
        console.log(
          chalk.yellow(
            `Disabled subsidy provider on chain ${chainId}: ${entry.address}`,
          ),
        );
      }
      console.log(
        chalk.gray(
          "Enabled entries are used by startCompute / startService unless you pass --subsidyProviders.",
        ),
      );
    });

  // ---------------------------------------------------------------------------
  // Chain / RPC management (node-free — see NODE_FREE_COMMANDS). Implemented directly
  // here, mirroring setNode/getNode: the registry is the single source of truth and no
  // signer/Commands instance is needed. Errors are plain Error so the gate/REPL render
  // them in red and stay alive.
  // ---------------------------------------------------------------------------
  const configuredChainList = (): string =>
    listChains()
      .map((c) => c.chainId)
      .join(", ") || "none";

  program
    .command("addChain")
    .alias("addRpc")
    .description(
      "Register an RPC chain at runtime (verifies each URL serves the chain; persists)",
    )
    .argument("[chainId]", "Chain id the URL(s) serve")
    .argument("[rpcUrl...]", "One or more RPC URLs for that chain")
    .option("-c, --chainId <chainId>", "Chain id the URL(s) serve")
    .option("-u, --url <rpcUrl...>", "One or more RPC URLs for that chain")
    .action(async (chainIdArg, rpcUrlArgs, options) => {
      loadRegistry();
      const id = Number(options.chainId || chainIdArg);
      const urls: string[] =
        options.url && options.url.length ? options.url : rpcUrlArgs;
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(
          `A valid chain id is required. Pass it positionally or with --chainId (got "${chainIdArg ?? ""}").`,
        );
      }
      if (!urls || urls.length === 0) {
        throw new Error(
          "At least one RPC URL is required. Pass it positionally or with --url.",
        );
      }
      try {
        await addChain(id, urls);
        console.log(
          chalk.green(
            `Chain ${id} registered with ${urls.length} URL(s). Configured chains: ${configuredChainList()}.`,
          ),
        );
      } catch (e) {
        console.error(chalk.red((e as Error).message));
      }
    });

  program
    .command("removeChain")
    .alias("removeRpc")
    .description("Unregister an RPC chain (persists)")
    .argument("[chainId]", "Chain id to remove")
    .option("-c, --chainId <chainId>", "Chain id to remove")
    .action(async (chainIdArg, options) => {
      loadRegistry();
      const id = Number(options.chainId || chainIdArg);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(
          `A valid chain id is required. Pass it positionally or with --chainId (got "${chainIdArg ?? ""}").`,
        );
      }
      try {
        removeChain(id);
        console.log(
          chalk.green(
            `Chain ${id} removed. Configured chains: ${configuredChainList()}.`,
          ),
        );
      } catch (e) {
        console.error(chalk.red((e as Error).message));
      }
    });

  program
    .command("listChains")
    .alias("getRpcs")
    .alias("chains")
    .description("List configured RPC chains, their URLs, and the default")
    .action(async () => {
      loadRegistry();
      // A legacy single-URL RPC isn't registered until its chainId is probed; do that
      // (best effort) so it shows up here without needing to run a signing command first.
      await getActiveChainId().catch(() => undefined);
      const chains = listChains();
      if (chains.length === 0) {
        console.log(chalk.yellow("No RPC chains configured."));
        return;
      }
      // Best-effort: cross-reference the node's served chains, if a node is set.
      let nodeChains: number[] = [];
      const current = getCurrentNodeUrl();
      if (current) {
        const status = await validateNode(current);
        if (status) nodeChains = nodeChainIds(status).map((c) => Number(c));
      }
      const def = resolveDefaultChain(nodeChains);
      console.log(chalk.bold("Configured RPC chains:"));
      for (const { chainId, urls } of chains) {
        const marks: string[] = [];
        if (chainId === def) marks.push(chalk.green("default"));
        if (nodeChains.includes(chainId)) marks.push("served by node");
        const suffix = marks.length ? `  [${marks.join(", ")}]` : "";
        console.log(`  ${chainId}${suffix}`);
        for (const u of urls) console.log(`      ${u}`);
      }
      const nodeMissing = nodeChains.filter((c) => !hasChain(c));
      if (nodeMissing.length) {
        console.log(
          chalk.yellow(
            `Node serves chain(s) with no configured RPC: ${nodeMissing.join(", ")}.`,
          ),
        );
      }
      if (def === undefined) {
        console.log(
          chalk.yellow(
            "No default chain set — chain-explicit commands need --chainId. Set one with 'setChain <chainId>'.",
          ),
        );
      }
    });

  program
    .command("setChain")
    .alias("useChain")
    .description(
      "Set the default (active) chain (must be registered; persists)",
    )
    .argument("[chainId]", "Chain id to make default")
    .option("-c, --chainId <chainId>", "Chain id to make default")
    .action(async (chainIdArg, options) => {
      loadRegistry();
      const id = Number(options.chainId || chainIdArg);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(
          `A valid chain id is required. Pass it positionally or with --chainId (got "${chainIdArg ?? ""}").`,
        );
      }
      try {
        setDefaultChainId(id);
        console.log(chalk.green(`Default chain is now ${id}.`));
      } catch (e) {
        console.error(chalk.red((e as Error).message));
      }
    });

  program
    .command("getChain")
    .alias("currentChain")
    .description("Show the current default (active) chain")
    .action(async () => {
      loadRegistry();
      await getActiveChainId().catch(() => undefined);
      const def = getDefaultChainId();
      if (def !== undefined) {
        console.log(`Default chain: ${def}`);
      } else {
        console.log(
          chalk.yellow(
            `No default chain set. Configured chains: ${configuredChainList()}. Set one with 'setChain <chainId>'.`,
          ),
        );
      }
    });

  // ----- Configuration file commands (getConfig / setConfig / unsetConfig) -----

  // The chain ids that the env RPC var defines (empty on a parse error or a legacy URL).
  const envRpcChainIds = (): Set<number> => {
    const out = new Set<number>();
    if (!process.env.RPC) return out;
    try {
      const parsed = parseRpcEnv(process.env.RPC);
      for (const cid of parsed.chains.keys()) out.add(cid);
    } catch {
      /* a malformed env RPC is reported elsewhere; treat as no env chains here */
    }
    return out;
  };

  const favouriteSummaryLine = (): string => {
    const n = listFavouriteNodes().length;
    const label = "favouriteNodes".padEnd(26);
    if (n === 0) return `  ${label}(none)`;
    return `  ${label}${`${n} saved (run listFavouriteNodes)`.padEnd(32)}${chalk.gray("[file]")}`;
  };

  const subsidySummaryLine = (): string => {
    const all = listAllSubsidyProviders();
    const chains = Object.keys(all);
    const total = chains.reduce((sum, c) => sum + all[c].length, 0);
    const label = "subsidyProviders".padEnd(26);
    if (total === 0) return `  ${label}(none)`;
    return `  ${label}${`${total} saved on ${chains.length} chain(s) (run listSubsidyProviders)`.padEnd(32)}${chalk.gray("[file]")}`;
  };

  // Print every chain's saved subsidy providers (for `getConfig subsidyProviders`).
  const printAllSubsidyProviders = (): void => {
    const all = listAllSubsidyProviders();
    const chains = Object.keys(all)
      .map((c) => Number(c))
      .sort((a, b) => a - b);
    if (chains.length === 0) {
      console.log(chalk.yellow("No subsidy providers saved."));
      return;
    }
    for (const cid of chains) printSubsidyProviderChain(cid, all[String(cid)]);
  };

  // One setting line (+ an optional "config file has: … (overridden by env)" line).
  const renderSettingLines = (entry: typeof CONFIG_KEYS[number]): string[] => {
    const file = readConfigFile();
    const view = describeSetting(entry, file);
    const key = entry.key.padEnd(26);
    const lines: string[] = [];
    if (view.source === "env") {
      const value = (view.value ?? "").padEnd(32);
      lines.push(`  ${key}${value}${chalk.gray(`[env ${entry.env}]`)}`);
      if (view.fileValue !== undefined) {
        lines.push(
          chalk.yellow(
            `  ${" ".repeat(26)}config file has: ${view.fileValue} (overridden by env)`,
          ),
        );
      }
    } else if (view.source === "file") {
      const value = (view.value ?? "").padEnd(32);
      lines.push(`  ${key}${value}${chalk.gray("[file]")}`);
    } else {
      lines.push(
        `  ${key}${"(not set)".padEnd(32)}${chalk.gray(`[default: ${entry.defaultLabel}]`)}`,
      );
    }
    return lines;
  };

  const renderRpcSection = (file: ReturnType<typeof readConfigFile>): string[] => {
    const out: string[] = ["  rpc"];
    try {
      loadRegistry();
    } catch {
      /* a malformed env RPC is reported at startup; show what we can */
    }
    const chains = (() => {
      try {
        return listChains();
      } catch {
        return [];
      }
    })();
    const fileRpcKeys = new Set(Object.keys(file.rpc ?? {}));
    const envChains = envRpcChainIds();
    if (chains.length === 0) {
      // A legacy single env URL has no probed chainId yet.
      if (process.env.RPC && envChains.size === 0) {
        out.push(
          `      ${"(chain not probed yet)".padEnd(24)}${redactRpcUrl(process.env.RPC)}  ${chalk.gray("[env RPC]")}`,
        );
      } else {
        out.push("      (none)");
      }
      return out;
    }
    for (const { chainId, urls } of chains) {
      const fromFile =
        fileRpcKeys.has(String(chainId)) && !envChains.has(chainId);
      const tag = chalk.gray(fromFile ? "[file]" : "[env RPC]");
      out.push(
        `      ${String(chainId).padEnd(6)}${urls.map(redactRpcUrl).join(", ")}  ${tag}`,
      );
    }
    return out;
  };

  const renderDefaultChainLine = (
    file: ReturnType<typeof readConfigFile>,
  ): string => {
    const def = getDefaultChainId();
    const label = "defaultChainId".padEnd(26);
    if (def === undefined) return `  ${label}${"(not set)"}`;
    let tag: string;
    if (process.env.CHAIN_ID && Number(process.env.CHAIN_ID) === def) {
      tag = "[env CHAIN_ID]";
    } else if (file.defaultChainId === def) {
      tag = "[file]";
    } else {
      tag = "[auto: only configured chain]";
    }
    return `  ${label}${String(def).padEnd(32)}${chalk.gray(tag)}`;
  };

  const signerLine = (): string => {
    if (process.env.PRIVATE_KEY) {
      return "Signer: PRIVATE_KEY is set in the environment (never stored in the config file).";
    }
    if (process.env.MNEMONIC) {
      return "Signer: MNEMONIC is set in the environment (never stored in the config file).";
    }
    return chalk.yellow(
      "Signer: no PRIVATE_KEY or MNEMONIC in the environment.",
    );
  };

  program
    .command("getConfig")
    .alias("showConfig")
    .description(
      "Show the config file location and every setting with its source (env / file / default)",
    )
    .argument("[key]", "Show a single setting (e.g. nodeUrl, indexing.maxRetries)")
    .option("-k, --key <key>", "Show a single setting")
    .action(async (keyArg, options) => {
      const file = readConfigFile();
      const key = options.key || keyArg;
      if (key) {
        if (key === "rpc") {
          for (const line of renderRpcSection(file)) console.log(line);
          return;
        }
        if (key === "defaultChainId") {
          // Load the registry first so getDefaultChainId() reflects the saved/resolved
          // default (the full getConfig path gets this via renderRpcSection()).
          try {
            loadRegistry();
          } catch {
            /* a malformed env RPC is reported at startup; show what we can */
          }
          console.log(renderDefaultChainLine(file));
          return;
        }
        if (key === "favouriteNodes") {
          console.log(favouriteSummaryLine());
          return;
        }
        if (key === "subsidyProviders") {
          printAllSubsidyProviders();
          return;
        }
        const entry = findConfigKey(key);
        if (!entry) {
          throw knownConfigKeyError(key);
        }
        for (const line of renderSettingLines(entry)) console.log(line);
        return;
      }

      const status = configFileStatus();
      const statusSuffix =
        status === "ok"
          ? "(exists)"
          : status === "missing"
            ? "(not created yet — it is written the first time a setting is saved)"
            : status === "corrupt"
              ? "(INVALID JSON — ignored)"
              : "(unreadable — ignored)";
      const fromEnv = process.env.OCEANCLI_CONFIG_PATH
        ? " [from OCEANCLI_CONFIG_PATH]"
        : "";
      console.log(`Config file: ${configFilePath()} ${statusSuffix}${fromEnv}`);
      for (const entry of CONFIG_KEYS) {
        for (const line of renderSettingLines(entry)) console.log(line);
      }
      for (const line of renderRpcSection(file)) console.log(line);
      console.log(renderDefaultChainLine(file));
      console.log(favouriteSummaryLine());
      console.log(subsidySummaryLine());
      console.log(signerLine());
    });

  program
    .command("setConfig")
    .description("Set a setting in the config file (saved immediately)")
    .argument("[key]", "Setting name, e.g. indexing.maxRetries (env-var names work too)")
    .argument("[value...]", "New value (lists are comma-separated)")
    .option("-k, --key <key>", "Setting name")
    .option("-v, --value <value>", "New value")
    .action(async (keyArg, valueArgs, options) => {
      const key = options.key || keyArg;
      const value =
        options.value ?? ((valueArgs as string[] | undefined) ?? []).join(" ");
      if (!key || !value || value.trim().length === 0) {
        throw new Error(
          "Usage: setConfig <key> <value>. Run getConfig to list the keys.",
        );
      }
      const lk = key.toLowerCase();
      if (lk === "privatekey" || lk === "private_key" || lk === "mnemonic") {
        throw new Error(
          "Signer secrets are never stored in the config file. Set PRIVATE_KEY (or MNEMONIC) in your environment.",
        );
      }
      if (key === "rpc" || key === "RPC") {
        throw new Error(
          "RPC endpoints are managed with addChain / removeChain (they verify the URL serves the chain).",
        );
      }
      if (key === "defaultChainId" || key === "CHAIN_ID") {
        throw new Error("Use setChain <chainId> to change the default chain.");
      }
      if (key === "favouriteNodes") {
        throw new Error(
          "Favourite nodes are managed with addFavouriteNode / removeFavouriteNode.",
        );
      }
      if (key === "subsidyProviders" || key === "SubsidyProviders") {
        throw new Error(
          "Subsidy providers are managed with addSubsidyProvider / removeSubsidyProvider / toggleSubsidyProvider.",
        );
      }
      const entry = findConfigKey(key);
      if (!entry) {
        throw knownConfigKeyError(key);
      }
      if (!entry.settable) {
        throw new Error(
          `${entry.key} is changed with ${entry.setHint} (it validates the node first).`,
        );
      }
      let parsed = parseConfigValue(entry, value);
      if (entry.key === "addressFile") {
        parsed = path.resolve(parsed as string);
        if (!fs.existsSync(parsed as string)) {
          throw new Error(`File not found: ${parsed}`);
        }
      }
      if (entry.key === "disableP2P" && parsed === true && isP2pUri(getCurrentNodeUrl())) {
        throw new Error(
          "The current node is a P2P URI — it would be unreachable with P2P disabled. Switch to an HTTP node first (setNode).",
        );
      }
      const ok = updateConfigFile((f) => setFileValue(f, entry.key, parsed));
      const envStr = toEnvString(entry, parsed);
      if (isEnvProvided(entry.env)) {
        warnIfEnvShadows(entry.env, envStr);
      } else if (!entry.nextStart) {
        // "Next start" keys (disableP2P / bootstrapPeers / avoidLoopRun) are read once
        // at startup; mutating the live session would e.g. break P2P mid-REPL while
        // libp2p is still running. Persist them to the file only — they take effect
        // on the next start (the note below says so).
        process.env[entry.env] = envStr;
      }
      if (entry.key === "addressFile") clearConfigCache();
      if (ok) {
        console.log(
          chalk.green(
            `${entry.key} = ${envStr} (saved to ${configFilePath()})`,
          ),
        );
        if (entry.nextStart) {
          console.log(
            chalk.yellow("This setting takes effect the next time the CLI starts."),
          );
        }
      }
    });

  program
    .command("unsetConfig")
    .description("Remove a setting from the config file (falls back to env / default)")
    .argument("[key]", "Setting name")
    .option("-k, --key <key>", "Setting name")
    .action(async (keyArg, options) => {
      const key = options.key || keyArg;
      if (!key) {
        throw new Error(
          "Usage: unsetConfig <key>. Run getConfig to list the keys.",
        );
      }
      if (key === "rpc" || key === "RPC") {
        throw new Error("Use removeChain <chainId> to remove an RPC chain.");
      }
      if (key === "defaultChainId" || key === "CHAIN_ID") {
        throw new Error("Use setChain <chainId> to change the default chain.");
      }
      if (key === "favouriteNodes") {
        throw new Error(
          "Use removeFavouriteNode <node|number> to remove a favourite node.",
        );
      }
      if (key === "subsidyProviders" || key === "SubsidyProviders") {
        throw new Error(
          "Use removeSubsidyProvider <chainId> <number|address> to remove a saved subsidy provider.",
        );
      }
      const entry = findConfigKey(key);
      if (!entry) {
        throw knownConfigKeyError(key);
      }
      const removed = updateConfigFile((f) => {
        deleteFileValue(f, entry.key);
        if (entry.key === "nodeUrl") delete f.computeEnvId;
      });
      if (!isEnvProvided(entry.env)) {
        delete process.env[entry.env];
        // Clearing nodeUrl also drops the remembered compute env — but not if the
        // user's environment set COMPUTE_ENV_ID (that stays in effect).
        if (entry.key === "nodeUrl" && !isEnvProvided("COMPUTE_ENV_ID")) {
          delete process.env.COMPUTE_ENV_ID;
        }
      } else {
        console.log(
          chalk.yellow(
            `${entry.env} is still set in your environment and stays in effect.`,
          ),
        );
      }
      if (entry.key === "addressFile") clearConfigCache();
      if (removed) {
        console.log(chalk.green(`${entry.key} removed from ${configFilePath()}.`));
      } else {
        // updateConfigFile already warned why it could not write; don't claim a
        // persistent removal. The session env change above still applies.
        console.log(
          chalk.yellow(
            `${entry.key} cleared for this session only — the config file was not updated.`,
          ),
        );
      }
      if (entry.key === "nodeUrl" && !hasNode()) {
        console.log(
          chalk.yellow("No Ocean Node set. Run `setNode <nodeUrl>` to pick one."),
        );
      }
    });

  // ----- Favourite-node commands -----

  program
    .command("addFavouriteNode")
    .alias("addFavoriteNode")
    .description(
      "Save a node (URL or peer id) to your favourite nodes, with an optional description",
    )
    .argument(
      "[node]",
      "HTTP(S) URL, peer id or multiaddr (default: the node currently in use)",
    )
    .argument("[description...]", "Optional free-text description")
    .option("-n, --node <node>", "Node to save")
    .option("-d, --description <text>", "Optional description")
    .action(async (nodeArg, descriptionArgs, options) => {
      let node = options.node || nodeArg || getCurrentNodeUrl();
      if (!node) {
        throw new Error(
          "A node is required. Pass a URL / peer id, or select a node first with setNode.",
        );
      }
      const description =
        options.description ??
        ((descriptionArgs as string[] | undefined) ?? []).join(" ");
      node = normalizeNodeRef(node);
      const isHttp = (() => {
        try {
          const u = new URL(node);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      })();
      if (/^\d+$/.test(node) || (!isHttp && !isP2pUri(node))) {
        throw new Error(
          `"${node}" is not a node reference. Use an http(s) URL, a peer id, or a multiaddr.`,
        );
      }
      const { result, index, saved } = addFavouriteNode(node, description);
      if (!saved) {
        console.error(
          chalk.red("Favourite node was not saved (see the warning above)."),
        );
        return;
      }
      if (result === "added") {
        console.log(
          chalk.green(
            `Saved favourite #${index + 1}: ${node}${description ? ` — ${description}` : ""}`,
          ),
        );
      } else if (result === "updated") {
        console.log(
          chalk.green(
            `Updated the description of favourite #${index + 1}: ${node} — ${description}`,
          ),
        );
      } else {
        console.log(`Favourite #${index + 1} already saved: ${node}`);
      }
      if (result === "added" || result === "updated") {
        console.log(chalk.gray(`Switch to it any time with: setNode ${index + 1}`));
      }
    });

  program
    .command("listFavouriteNodes")
    .alias("listFavoriteNodes")
    .alias("favourites")
    .alias("favorites")
    .description("List your saved favourite nodes (use the number with setNode)")
    .action(async () => {
      const list = listFavouriteNodes();
      if (list.length === 0) {
        console.log(
          chalk.yellow(
            "No favourite nodes saved. Add one with `addFavouriteNode <nodeUrl|peerId> [description]`.",
          ),
        );
        return;
      }
      console.log(chalk.bold("Favourite nodes:"));
      const current = normalizeNodeRef(getCurrentNodeUrl() || "");
      list.forEach((entry, i) => {
        const isCurrent =
          current.length > 0 && normalizeNodeRef(entry.node) === current;
        const marker = isCurrent ? ` ${chalk.green("[current]")}` : "";
        console.log(`  ${i + 1}. ${entry.node}${marker}`);
        if (entry.description) {
          console.log(chalk.gray(`       ${entry.description}`));
        }
      });
      console.log(
        chalk.gray(
          "Use `setNode <number>` to switch, `removeFavouriteNode <number|node>` to delete.",
        ),
      );
    });

  program
    .command("removeFavouriteNode")
    .alias("removeFavoriteNode")
    .description(
      "Remove a node from your favourite nodes (by its number or by URL / peer id)",
    )
    .argument(
      "[node]",
      "Favourite number (from listFavouriteNodes) or the node URL / peer id",
    )
    .option("-n, --node <node>", "Favourite number or node")
    .action(async (nodeArg, options) => {
      const ref = options.node || nodeArg;
      if (!ref) {
        throw new Error(
          "Pass a favourite number (see listFavouriteNodes) or the node URL / peer id.",
        );
      }
      const { removed, saved } = removeFavouriteNode(String(ref));
      if (removed === null) {
        console.error(
          chalk.red(
            `No favourite node matches "${ref}". Run listFavouriteNodes to see the saved ones.`,
          ),
        );
        return;
      }
      if (!saved) {
        console.error(
          chalk.red("Favourite node was not removed (see the warning above)."),
        );
        return;
      }
      console.log(
        chalk.green(
          `Removed favourite: ${removed.node}${removed.description ? ` — ${removed.description}` : ""}`,
        ),
      );
    });

  // getDDO command
  program
    .command("getDDO")
    .description("Gets DDO for an asset using the asset did")
    .argument("[did]", "The asset DID")
    .option("-d, --did <did>", "The asset DID")
    .action(async (did, options) => {
      const assetDid = options.did || did;
      if (!assetDid) {
        throw new Error("A DID is required. Pass it positionally or with --did.");
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getDDO([null, assetDid]);
    });

  // publish command
  program
    .command("publish")
    .description("Publishes a new asset with access service or compute service")
    .argument("[metadataFile]", "Path to metadata file")
    .option("-f, --file <metadataFile>", "Path to metadata file")
    .option("-e, --encrypt [boolean]", "Encrypt DDO", true)
    .action(async (metadataFile, options) => {
      const file = options.file || metadataFile;
      if (!file) {
        throw new Error(
          "A metadata file is required. Pass it positionally or with --file.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.publish([null, file, options.encrypt.toString()]);
    });

  // publishAlgo command
  program
    .command("publishAlgo")
    .description("Publishes a new algorithm")
    .argument("[metadataFile]", "Path to metadata file")
    .option("-f, --file <metadataFile>", "Path to metadata file")
    .option("-e, --encrypt [boolean]", "Encrypt DDO", true)
    .action(async (metadataFile, options) => {
      const file = options.file || metadataFile;
      if (!file) {
        throw new Error(
          "A metadata file is required. Pass it positionally or with --file.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.publishAlgo([null, file, options.encrypt.toString()]);
    });

  // editAsset command (alias "edit" for backwards compatibility)
  program
    .command("editAsset")
    .alias("edit")
    .description("Updates DDO using the metadata items in the file")
    .argument("[datasetDid]", "Dataset DID")
    .argument("[metadataFile]", "Updated metadata file")
    .option("-d, --did <datasetDid>", "Dataset DID")
    .option("-f, --file <metadataFile>", "Updated metadata file")
    .option("-e, --encrypt [boolean]", "Encrypt DDO", true)
    .action(async (datasetDid, metadataFile, options) => {
      const dsDid = options.did || datasetDid;
      const file = options.file || metadataFile;
      if (!dsDid || !file) {
        throw new Error(
          "A dataset DID and metadata file are required. Pass them positionally or with --did / --file.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.editAsset([null, dsDid, file, options.encrypt.toString()]);
    });

  // download command
  program
    .command("download")
    .description("Downloads an asset into specified folder")
    .argument("[did]", "The asset DID")
    .argument("[folder]", "Destination folder", ".")
    .argument("[serviceId]", "Service ID (optional)")
    .option("-d, --did <did>", "The asset DID")
    .option("-f, --folder [folder]", "Destination folder", ".")
    .option("-s, --service <serviceId>", "Service ID")
    .action(async (did, folder, serviceId, options) => {
      const assetDid = options.did || did;
      const destFolder = options.folder || folder || ".";
      const svcId = options.service || serviceId;
      if (!assetDid) {
        throw new Error("A DID is required. Pass it positionally or with --did.");
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.download([null, assetDid, destFolder, svcId]);
    });

  // allowAlgo command
  program
    .command("allowAlgo")
    .description("Approves an algorithm to run on a dataset")
    .argument("[datasetDid]", "Dataset DID")
    .argument("[algoDid]", "Algorithm DID")
    .option("-d, --dataset <datasetDid>", "Dataset DID")
    .option("-a, --algo <algoDid>", "Algorithm DID")
    .option("-e, --encrypt [boolean]", "Encrypt DDO", true)
    .action(async (datasetDid, algoDid, options) => {
      const dsDid = options.dataset || datasetDid;
      const aDid = options.algo || algoDid;
      if (!dsDid || !aDid) {
        throw new Error(
          "A dataset DID and algorithm DID are required. Pass them positionally or with --dataset / --algo.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.allowAlgo([null, dsDid, aDid, options.encrypt.toString()]);
    });

  // startCompute command
  program
    .command("startCompute")
    .description("Starts a compute job")
    .argument(
      "[datasetDids]",
      'Dataset DIDs (comma-separated), an empty array for none, OR a JSON ComputeAsset object/array with a fileObject (raw datasets, no DID). Mixed input must be valid JSON, e.g. \'["did:op:abc",{"fileObject":{...}}]\'',
    )
    .argument(
      "[algoDid]",
      "Algorithm DID, OR a JSON ComputeAlgorithm object with a fileObject and meta (raw algorithm, no DID)",
    )
    .argument(
      "[computeEnvId]",
      "Compute environment ID (optional if one was selected via setNodeEnv). If omitted, pass the later values (maxJobDuration, paymentToken, resources, ...) as named options rather than positionally, since they would otherwise fill this slot.",
    )
    .argument("[maxJobDuration]", "maxJobDuration for compute job")
    .argument("[paymentToken]", "Payment token for compute")
    .argument("[resources]", "Resources of compute environment stringified")
    .argument(
      "[output]",
      "Output backend to save job results to. Supported types include S3, FTP, URL, Arweave, etc. Defaults to node local disk if omitted.",
    )
    .argument(
      "[serviceIds]",
      "Service IDs (comma-separated; positional mapping with datasetDIDs)",
    )
    .argument("[algoServiceId]", "Algorithm Service ID (optional)")
    .option(
      "-d, --datasets <datasetDids>",
      "Dataset DIDs (comma-separated), an empty array for none, OR a JSON ComputeAsset object/array with a fileObject (raw datasets, no DID)",
    )
    .option(
      "-a, --algo <algoDid>",
      "Algorithm DID, OR a JSON ComputeAlgorithm object with a fileObject and meta (raw algorithm, no DID)",
    )
    .option("-e, --env <computeEnvId>", "Compute environment ID")
    .option("--maxJobDuration <maxJobDuration>", "Compute maxJobDuration")
    .option("-t, --token <paymentToken>", "Compute payment token")
    .option(
      "-s, --services [serviceIds]",
      "Service IDs (comma-separated; positional mapping with datasetDIDs)",
    )
    .option(
      "-x, --algo-service [algoServiceId]",
      "Algorithm Service ID (optional)",
    )
    .option("--resources <resources>", "Compute resources")
    .option(
      "--accept [boolean]",
      "Auto-confirm payment for compute job (true/false)",
      toBoolean,
    )
    .option(
      "--chainId <chainId>",
      "Payment/escrow chain for the job (defaults to the active chain). Each dataset/algorithm is still ordered on its own DDO chain.",
    )
    .option(
      "-o, --output [output]",
      "Output backend to save job results to. Supported types include S3, FTP, URL, Arweave, etc. Defaults to node local disk if omitted.",
    )
    .option(
      "--subsidyProviders <list>",
      "Subsidy provider contract addresses (comma-separated) to claim against. Omit to use the node's defaults; pass 'none' (or empty) to explicitly claim with no subsidy.",
    )
    .option("--from-json <path>", FROM_JSON_DESCRIPTION)
    .action(
      async (
        datasetDids,
        algoDid,
        computeEnvId,
        maxJobDuration,
        paymentToken,
        resources,
        output,
        serviceIds,
        algoServiceId,
        options,
      ) => {
        let file: ComputeFileInputs | undefined;
        if (options.fromJson !== undefined) {
          rejectPositionalsWithFromJson("startCompute", [
            datasetDids,
            algoDid,
            computeEnvId,
            maxJobDuration,
            paymentToken,
            resources,
            output,
            serviceIds,
            algoServiceId,
          ]);
          // Throws a plain Error listing every problem; nothing has touched the network yet.
          file = loadComputeSpec(options.fromJson, { free: false });
        }

        // Precedence: named option > positional > JSON file > (env only) setNodeEnv.
        const dsDids = options.datasets || datasetDids || file?.dsDids;
        const aDid = options.algo || algoDid || file?.aDid;
        const envId =
          options.env || computeEnvId || file?.envId || getCurrentEnvId();
        const jobDuration =
          options.maxJobDuration || maxJobDuration || file?.jobDuration;
        const token = options.token || paymentToken || file?.token;
        const res = options.resources || resources || file?.res;
        const outputLocation =
          optStr(options.output) ?? output ?? file?.outputLocation;
        const svcIds =
          optStr(options.services) ?? serviceIds ?? file?.svcIds ?? "";
        const algoSvcId =
          optStr(options.algoService) ?? algoServiceId ?? file?.algoSvcId ?? "";

        if (file && !envId) {
          throw new Error(
            'No compute environment: set "env" in the JSON file, pass --env <id>, or select one with setNodeEnv.',
          );
        }

        // A compute env id is never a bare number, so a numeric positional here almost
        // always means the user omitted the env (relying on setNodeEnv) and let the next
        // value — maxJobDuration — shift up into this slot. Catch that early with an
        // actionable message instead of failing later with a misleading env error.
        if (!options.env && computeEnvId && /^\d+$/.test(computeEnvId.trim())) {
          console.error(
            chalk.red(
              `"${computeEnvId}" looks like maxJobDuration, not a compute environment ID. ` +
                "If you meant to use the env selected via setNodeEnv, pass the remaining values as named options " +
                "(--maxJobDuration, --token, --resources). Otherwise provide the environment ID explicitly (--env <id>).",
            ),
          );
          return;
        }
        if (!dsDids || !aDid || !envId || !jobDuration || !token || !res) {
          console.error(chalk.red("Missing required arguments"));
          // process.exit(1);
          return;
        }

        // Count datasets with the same tokenizer the resolver uses. Splitting
        // the raw string on "," breaks every JSON form (a single
        // '[{"fileObject":{...}}]' contains commas), which made this check
        // reject valid input.
        const dsCount = parseComputeInput(dsDids).length;

        // Empty entries are kept: they are positional placeholders, so
        // `svc0,,svc2` is three slots, not two.
        const svArr = svcIds
          ? svcIds.split(",").map((s) => s.trim())
          : undefined;

        // Optional check: serviceIds must match length if provided
        if (svArr && svArr.length !== dsCount) {
          console.error(
            chalk.red(
              `Length mismatch: datasets=${dsCount} vs serviceIds=${svArr.length}. ` +
                "If serviceIds is provided, it must match the dataset count (positional 1–1).",
            ),
          );
          return;
        }

        // Tri-state: undefined (node default) | [] (no subsidy) | [addr,...].
        // Validate up front so a malformed address is rejected before compute
        // initialization and the payment prompt.
        let subsidyProviders: string[] | undefined;
        try {
          subsidyProviders =
            options.subsidyProviders !== undefined
              ? parseSubsidyProviders(options.subsidyProviders)
              : file?.subsidyProviders;
        } catch (e) {
          console.error(
            chalk.red(`Invalid --subsidyProviders: ${(e as Error).message}`),
          );
          return;
        }

        const { signer, chainId } = await initializeSigner();
        const commands = new Commands(signer, chainId);

        // Payment/escrow chain (category d): `--chainId` → default → error. Independent
        // of where the assets live — each asset is ordered on its own DDO chain inside
        // the compute methods.
        let paymentChainId: number;
        try {
          paymentChainId = resolveChainId(options.chainId ?? file?.chainId);
        } catch (e) {
          console.error(chalk.red((e as Error).message));
          return;
        }

        // With no explicit --subsidyProviders flag, merge the user's enabled saved
        // providers for the payment chain with the node's advertised set (prints a note
        // naming any it adds, before the payment prompt). A no-op when the flag was
        // explicit or no enabled saved providers exist.
        subsidyProviders = await commands.resolveJobSubsidyProviders(
          subsidyProviders,
          paymentChainId,
        );

        const initArgs = [
          null,
          dsDids,
          aDid,
          envId,
          jobDuration,
          token,
          res,
          outputLocation,
          svcIds,
          algoSvcId,
        ];
        const initResp = await commands.initializeCompute(
          initArgs,
          paymentChainId,
        );

        if (!initResp) {
          console.error(chalk.red("Initialization failed. Aborting."));
          return;
        }

        console.log(chalk.yellow("\n--- Payment Details ---"));
        console.log(JSON.stringify(initResp, null, 2));
        // The payment token lives on the payment chain, which may differ from the active
        // chain — read its decimals with that chain's signer, not the default one.
        const paymentSigner = await commands.signerFor(paymentChainId);
        const amount = await unitsToAmount(
          paymentSigner,
          initResp.payment.token,
          initResp.payment.amount.toString(),
        );

        // Subsidy providers may pre-fund part or all of the lock, so show the whole
        // price and what the payer actually funds. The same figure is handed to
        // computeStart below, so what is confirmed here is what gets deposited.
        const lockUnits = BigInt(initResp.payment.amount.toString());
        const prefundedUnits = await commands.computePrefundedUnits(
          subsidyProviders,
          lockUnits,
        );
        const toAmount = (units: bigint) =>
          unitsToAmount(paymentSigner, initResp.payment.token, units.toString());
        const youPay = await toAmount(lockUnits - prefundedUnits);
        console.log(chalk.yellow(`  total job cost: ${amount}`));
        if (prefundedUnits > 0n) {
          console.log(
            chalk.green(
              `  prepaid subsidy covers: ${await toAmount(prefundedUnits)}`,
            ),
          );
        }
        console.log(chalk.yellow(`  you pay: ${youPay}`));

        const proceed = options.accept ?? file?.accept;
        if (!proceed) {
          if (!process.stdin.isTTY) {
            console.error(
              chalk.red(
                'Cannot prompt for confirmation (non-TTY). Use "--accept true" to skip.',
              ),
            );
            process.exit(1);
          }
          const rl = createInterface({ input, output: stdout });
          const confirmation = await rl.question(
            `\nProceed with starting the compute job? Total cost ${amount}, you pay ${youPay}, in tokens from address ${initResp.payment.token} (y/n): `,
          );
          rl.close();
          if (
            confirmation.toLowerCase() !== "y" &&
            confirmation.toLowerCase() !== "yes"
          ) {
            console.log(chalk.red("Compute job canceled by user."));
            return;
          }
        } else {
          console.log(chalk.cyan("Auto-confirm enabled with --yes flag."));
        }

        const computeArgs = [
          null,
          dsDids,
          aDid,
          envId,
          JSON.stringify(initResp),
          jobDuration,
          token,
          res,
          outputLocation,
          svcIds,
          algoSvcId,
        ];

        const started = await commands.computeStart(
          computeArgs,
          paymentChainId,
          subsidyProviders,
          prefundedUnits,
        );
        if (started) {
          console.log(chalk.green("Compute job started successfully."));
        }
      },
    );

  // startFreeCompute command
  program
    .command("startFreeCompute")
    .description("Starts a FREE compute job")
    .argument(
      "[datasetDids]",
      'Dataset DIDs (comma-separated), an empty array for none, OR a JSON ComputeAsset object/array with a fileObject (raw datasets, no DID). Mixed input must be valid JSON, e.g. \'["did:op:abc",{"fileObject":{...}}]\'',
    )
    .argument(
      "[algoDid]",
      "Algorithm DID, OR a JSON ComputeAlgorithm object with a fileObject and meta (raw algorithm, no DID)",
    )
    .argument(
      "[computeEnvId]",
      "Compute environment ID (optional if one was selected via setNodeEnv)",
    )
    .argument(
      "[output]",
      "Output backend to save job results to. Supported types include S3, FTP, URL, Arweave, etc. Defaults to node local disk if omitted.",
    )
    .argument(
      "[serviceIds]",
      "Service IDs (comma-separated; positional mapping with datasetDIDs)",
    )
    .argument("[algoServiceId]", "Algorithm Service ID (optional)")
    .option(
      "-d, --datasets <datasetDids>",
      "Dataset DIDs (comma-separated), an empty array for none, OR a JSON ComputeAsset object/array with a fileObject (raw datasets, no DID)",
    )
    .option(
      "-a, --algo <algoDid>",
      "Algorithm DID, OR a JSON ComputeAlgorithm object with a fileObject and meta (raw algorithm, no DID)",
    )
    .option("-e, --env <computeEnvId>", "Compute environment ID")
    .option(
      "-o, --output [output]",
      "Output backend to save job results to. Supported types include S3, FTP, URL, Arweave, etc. Defaults to node local disk if omitted.",
    )
    .option(
      "-s, --services [serviceIds]",
      "Service IDs (comma-separated; positional mapping with datasetDIDs)",
    )
    .option(
      "-x, --algo-service [algoServiceId]",
      "Algorithm Service ID (optional)",
    )
    .option(
      "--chainId <chainId>",
      "Chain to sign the free compute request on (defaults to the active chain). A free env does no ordering or payment.",
    )
    .option("--from-json <path>", FROM_JSON_DESCRIPTION)
    .action(
      async (
        datasetDids,
        algoDid,
        computeEnvId,
        output,
        serviceIds,
        algoServiceId,
        options,
      ) => {
        let file: ComputeFileInputs | undefined;
        if (options.fromJson !== undefined) {
          rejectPositionalsWithFromJson("startFreeCompute", [
            datasetDids,
            algoDid,
            computeEnvId,
            output,
            serviceIds,
            algoServiceId,
          ]);
          file = loadComputeSpec(options.fromJson, { free: true });
        }

        const dsDids = options.datasets || datasetDids || file?.dsDids;
        const aDid = options.algo || algoDid || file?.aDid;
        // Fall back to the env remembered by setNodeEnv when none is given explicitly.
        const envId =
          options.env || computeEnvId || file?.envId || getCurrentEnvId();
        const outputLocation =
          optStr(options.output) ?? output ?? file?.outputLocation;
        const svcIds =
          optStr(options.services) ?? serviceIds ?? file?.svcIds ?? "";
        const algoSvcId =
          optStr(options.algoService) ?? algoServiceId ?? file?.algoSvcId ?? "";

        if (file && !envId) {
          throw new Error(
            'No compute environment: set "env" in the JSON file, pass --env <id>, or select one with setNodeEnv.',
          );
        }

        if (!dsDids || !aDid || !envId) {
          console.error(chalk.red("Missing required arguments"));
          // process.exit(1);
          return;
        }

        // Count datasets with the same tokenizer the resolver uses. Splitting
        // the raw string on "," breaks every JSON form (a single
        // '[{"fileObject":{...}}]' contains commas), which made this check
        // reject valid input.
        const dsCount = parseComputeInput(dsDids).length;

        // Empty entries are kept: they are positional placeholders, so
        // `svc0,,svc2` is three slots, not two.
        const svArr = svcIds
          ? svcIds.split(",").map((s) => s.trim())
          : undefined;

        // Optional check: serviceIds must match length if provided
        if (svArr && svArr.length !== dsCount) {
          console.error(
            chalk.red(
              `Length mismatch: datasets=${dsCount} vs serviceIds=${svArr.length}. ` +
                "If serviceIds is provided, it must match the dataset count (positional 1–1).",
            ),
          );
          return;
        }
        const { signer, chainId } = await initializeSigner();
        const commands = new Commands(signer, chainId);
        // Free compute is single-chain signing only (no ordering/escrow): route the
        // signer onto `--chainId` → default, exactly like a category (c) command.
        if (
          (await routeExplicit(commands, options.chainId ?? file?.chainId)) ===
          null
        )
          return;
        await commands.freeComputeStart([
          null,
          dsDids,
          aDid,
          envId,
          outputLocation,
          svcIds,
          algoSvcId,
        ]);
      },
    );

  // getComputeEnvironments command
  program
    .command("getComputeEnvironments")
    .alias("getC2DEnvs")
    .argument(
      "[node]",
      "Optional Ocean Node URL or peer id to query (defaults to NODE_URL)",
    )
    .option("-n, --node <node>", "Ocean Node URL or peer id to query")
    .description("Gets the existing compute environments")
    .action(async (node, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getComputeEnvironments(options.node || node);
    });

  // computeStreamableLogs command
  program
    .command("computeStreamableLogs")
    .description("Gets the existing compute streamable logs")
    .argument("[jobId]", "Job ID")
    .option("-j, --job <jobId>", "Job ID")
    .action(async (jobId, options) => {
      const args = jobId || options.job;
      if (!args) {
        throw new Error(
          "A job ID is required. Pass it positionally or with --job.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.computeStreamableLogs([args]);
    });

  // stopCompute command
  program
    .command("stopCompute")
    .description("Stops a compute job")
    .argument("[jobId]", "Job ID (a leading dataset DID is accepted but ignored)")
    .argument("[legacyArg1]", "Ignored (legacy dataset DID / agreement positional)")
    .argument("[legacyArg2]", "Ignored (legacy agreement positional)")
    .option("-j, --job <jobId>", "Job ID")
    .action(async (pos1, pos2, pos3, options) => {
      const jobId = resolveJobId(pos1, pos2, pos3, options);
      if (!jobId) {
        throw new Error(
          "A job ID is required. Pass it positionally or with --job.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.computeStop([null, jobId]);
    });

  // getJobStatus command
  program
    .command("getJobStatus")
    .description("Displays the compute job status")
    .argument("[jobId]", "Job ID (a leading dataset DID is accepted but ignored)")
    .argument("[legacyArg1]", "Ignored (legacy dataset DID / agreement positional)")
    .argument("[legacyArg2]", "Ignored (legacy agreement positional)")
    .option("-j, --job <jobId>", "Job ID")
    .action(async (pos1, pos2, pos3, options) => {
      const jobId = resolveJobId(pos1, pos2, pos3, options);
      if (!jobId) {
        throw new Error(
          "A job ID is required. Pass it positionally or with --job.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getJobStatus([null, jobId]);
    });

  // downloadJobResults command
  program
    .command("downloadJobResults")
    .description("Downloads compute job results")
    .argument("<jobId>", "Job ID")
    .argument("<resultIndex>", "Result index", parseInt)
    .argument("[destinationFolder]", "Destination folder", ".")
    .action(async (jobId, resultIndex, destinationFolder) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.downloadJobResults([
        null,
        jobId,
        resultIndex,
        destinationFolder,
      ]);
    });

  // =========================================================================
  // Service-on-Demand commands
  // =========================================================================

  // getServiceTemplates command
  program
    .command("getServiceTemplates")
    .alias("serviceTemplates")
    .description(
      "Lists the node's Service-on-Demand templates and compatible environments",
    )
    .argument(
      "[node]",
      "Optional Ocean Node URL or peer id to query (defaults to NODE_URL)",
    )
    .option("-n, --node <node>", "Ocean Node URL or peer id to query")
    .action(async (node, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getServiceTemplates(options.node || node);
    });

  // startService command
  program
    .command("startService")
    .description(
      "Starts an on-demand service (long-running container) on a compute environment, paid via escrow",
    )
    .argument(
      "[computeEnvId]",
      "Compute environment ID (must have services enabled)",
    )
    .argument("[duration]", "Requested duration in seconds", parseInt)
    .argument("[paymentToken]", "Payment token address")
    .option("-e, --env <computeEnvId>", "Compute environment ID")
    .option(
      "--template <templateId>",
      "Start from an operator-published template",
    )
    .option(
      "-i, --image <image>",
      "Container image (alternative to --template)",
    )
    .option(
      "--tag <tag>",
      "Image tag (mutually exclusive with --checksum/--dockerfile)",
    )
    .option("--checksum <sha256>", "Image digest, e.g. sha256:<64 hex>")
    .option(
      "--dockerfile <path>",
      "Path to a local Dockerfile (node must allow image builds)",
    )
    .option(
      "--additional-docker-files <path>",
      "Path to JSON file of {filename: content} used with --dockerfile",
    )
    .option(
      "--cmd <json>",
      'Docker CMD override as JSON array, e.g. \'["python","app.py"]\'',
    )
    .option("--entrypoint <json>", "Docker ENTRYPOINT override as JSON array")
    .option(
      "-p, --ports <ports>",
      "Comma-separated container ports to expose, e.g. 8888,8080",
    )
    .option(
      "-r, --resources <resources>",
      'Stringified JSON [{"id":"cpu","amount":1},...]; defaults to template requirements',
    )
    .option(
      "-u, --user-data <json>",
      "JSON object of container env vars (encrypted to the node; never logged)",
    )
    .option(
      "--user-data-file <path>",
      "Path to JSON file with container env vars",
    )
    .option(
      "--accept [boolean]",
      "Auto-confirm payment (true/false)",
      toBoolean,
    )
    .option(
      "--wait [boolean]",
      "Poll until Running or failure (default true)",
      toBoolean,
      true,
    )
    .option(
      "--timeout <seconds>",
      "Max seconds to wait for Running (default 600)",
      parseInt,
    )
    .option(
      "--chainId <chainId>",
      "Payment/escrow chain (default: active chain); must be one the env prices on",
    )
    .option(
      "--subsidyProviders <list>",
      "Subsidy provider contract addresses (comma-separated) to claim against. Omit for node defaults; 'none' (or empty) for no subsidy.",
    )
    .option("--from-json <path>", FROM_JSON_DESCRIPTION)
    .action(async (computeEnvId, duration, paymentToken, options, command) => {
      let file: ServiceFileInputs | undefined;
      if (options.fromJson !== undefined) {
        rejectPositionalsWithFromJson("startService", [
          computeEnvId,
          duration,
          paymentToken,
        ]);
        file = loadServiceSpec(options.fromJson);

        // Mutually exclusive groups: a command-line option replaces the whole group
        // from the file, so "--image x" can override a file that names a template.
        // --template / --image switch the container source outright, so they also drop
        // every file-supplied image modifier (tag, checksum, dockerfile, extra docker
        // files, cmd, entrypoint, ports). Otherwise those would silently re-apply on top
        // of the new source (e.g. the old image's tag/cmd layered onto the new template).
        if (options.template !== undefined || options.image !== undefined) {
          file.templateId = undefined;
          file.image = undefined;
          file.tag = undefined;
          file.checksum = undefined;
          file.dockerfilePath = undefined;
          file.additionalDockerFiles = undefined;
          file.additionalDockerFilesPath = undefined;
          file.cmd = undefined;
          file.entrypoint = undefined;
          file.ports = undefined;
        }
        if (
          options.tag !== undefined ||
          options.checksum !== undefined ||
          options.dockerfile !== undefined
        ) {
          file.tag = undefined;
          file.checksum = undefined;
          file.dockerfilePath = undefined;
        }
        if (options.additionalDockerFiles !== undefined) {
          file.additionalDockerFiles = undefined;
          file.additionalDockerFilesPath = undefined;
        }
        if (
          options.userData !== undefined ||
          options.userDataFile !== undefined
        ) {
          file.userDataInline = undefined;
          file.userDataFilePath = undefined;
        }
      }

      const envId = options.env || computeEnvId || file?.envId;
      const serviceDuration = duration ?? file?.duration;
      const token = paymentToken || file?.paymentToken;
      const templateId = options.template ?? file?.templateId;
      const image = options.image ?? file?.image;

      if (!envId || !serviceDuration || !token) {
        console.error(
          chalk.red(
            "Missing required arguments: <computeEnvId> <duration> <paymentToken> (or pass --from-json <file>)",
          ),
        );
        return;
      }
      if (!Number.isInteger(serviceDuration) || serviceDuration <= 0) {
        console.error(
          chalk.red("Duration must be a positive integer number of seconds."),
        );
        return;
      }
      if (templateId && image) {
        console.error(
          chalk.red("Provide either --template or --image, not both."),
        );
        return;
      }

      let ports: number[] | undefined;
      let cmd: string[] | undefined;
      let entrypoint: string[] | undefined;
      let subsidyProviders: string[] | undefined;
      try {
        if (options.ports) ports = parsePorts(options.ports);
        if (options.cmd) cmd = parseJsonStringArray("--cmd", options.cmd);
        if (options.entrypoint)
          entrypoint = parseJsonStringArray("--entrypoint", options.entrypoint);
        subsidyProviders =
          options.subsidyProviders !== undefined
            ? parseSubsidyProviders(options.subsidyProviders)
            : file?.subsidyProviders;
      } catch (e) {
        console.error(chalk.red((e as Error).message));
        return;
      }

      // --wait has a Commander default (true), so options.wait is always set. Only let it
      // beat the file when the user actually typed it.
      const waitFromCli = command.getOptionValueSource("wait") === "cli";

      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      // Services are single-chain: --chainId (→ file → default) is the payment/escrow chain, and
      // must be registered here; startService additionally checks it is one the env prices on.
      const servicePaymentChainId = await routeExplicit(
        commands,
        options.chainId ?? file?.chainId,
      );
      if (servicePaymentChainId === null) return;
      // Merge enabled saved subsidy providers for the payment chain when no explicit flag
      // was given (no-op otherwise); prints a note before any deposit/authorize.
      subsidyProviders = await commands.resolveJobSubsidyProviders(
        subsidyProviders,
        servicePaymentChainId,
      );
      await commands.startService({
        envId,
        duration: serviceDuration,
        paymentToken: token,
        templateId,
        image,
        tag: options.tag ?? file?.tag,
        checksum: options.checksum ?? file?.checksum,
        dockerfilePath: options.dockerfile ?? file?.dockerfilePath,
        additionalDockerFilesPath:
          options.additionalDockerFiles ?? file?.additionalDockerFilesPath,
        additionalDockerFiles: file?.additionalDockerFiles,
        cmd: cmd ?? file?.cmd,
        entrypoint: entrypoint ?? file?.entrypoint,
        ports: ports ?? file?.ports,
        resources: options.resources ?? file?.resources,
        userDataInline: options.userData ?? file?.userDataInline,
        userDataFilePath: options.userDataFile ?? file?.userDataFilePath,
        accept: options.accept ?? file?.accept,
        wait: waitFromCli ? options.wait : (file?.wait ?? options.wait),
        timeout: options.timeout ?? file?.timeout,
        subsidyProviders,
      });
    });

  // getServiceStatus command (caller-owned, full detail)
  program
    .command("getServiceStatus")
    .alias("myServices")
    .description("Shows status + endpoints of YOUR on-demand service(s)")
    .argument("[serviceId]", "Service ID; omit to list all your services")
    .option("-s, --service <serviceId>", "Service ID")
    .option("-v, --verbose [boolean]", "Dump full job objects", toBoolean)
    .action(async (serviceId, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getServiceStatus(
        options.service || serviceId,
        options.verbose,
      );
    });

  // getServices command (SERVICES_LIST — node-wide, all owners)
  program
    .command("getServices")
    .alias("listServices")
    .description(
      "Lists on-demand services across ALL owners on the node (docker spec hidden)",
    )
    .argument(
      "[node]",
      "Optional Ocean Node URL or peer id to query (defaults to NODE_URL)",
    )
    .option("-n, --node <node>", "Ocean Node URL or peer id to query")
    .option(
      "--status <status>",
      "Filter by a single service status number (e.g. 40 for Running)",
      parseInt,
    )
    .option(
      "--include-all [boolean]",
      "Include all statuses, not just active reservations",
      toBoolean,
    )
    .option(
      "--from <timestamp>",
      "Only services created at/after this time (ISO string or Unix timestamp)",
    )
    .option("-v, --verbose [boolean]", "Dump full job objects", toBoolean)
    .action(async (node, options) => {
      if (
        options.status !== undefined &&
        ServiceStatusNumber[options.status] === undefined
      ) {
        console.error(
          chalk.red(
            `Unknown --status ${options.status}. Valid values: 10,11,12,13,14,15,20,30,40,50,70,75,99`,
          ),
        );
        return;
      }
      const filters: {
        status?: number;
        includeAllStatuses?: boolean;
        fromTimestamp?: string;
      } = {};
      if (options.status !== undefined) filters.status = options.status;
      if (options.includeAll !== undefined)
        filters.includeAllStatuses = options.includeAll;
      if (options.from !== undefined) filters.fromTimestamp = options.from;

      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getServices(
        options.node || node,
        filters,
        options.verbose,
      );
    });

  // serviceLogs command (streamable logs)
  program
    .command("serviceLogs")
    .alias("computeServiceLogs")
    .description("Streams live logs from an on-demand service's container")
    .argument("[serviceId]", "Service ID")
    .option("-s, --service <serviceId>", "Service ID")
    .option(
      "--since <since>",
      "Only logs since this time — Unix seconds or a relative duration like 30s / 2h",
    )
    .action(async (serviceId, options) => {
      const id = options.service || serviceId;
      if (!id) {
        throw new Error(
          "A service ID is required. Pass it positionally or with --service.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.serviceLogs(id, options.since);
    });

  // extendService command
  program
    .command("extendService")
    .description(
      "Extends a running on-demand service's expiry (paid via escrow)",
    )
    .argument("[serviceId]", "Service ID")
    .argument(
      "[additionalDuration]",
      "Additional duration in seconds",
      parseInt,
    )
    .argument(
      "[paymentToken]",
      "Payment token (defaults to the token used at start)",
    )
    .option("-s, --service <serviceId>", "Service ID")
    .option(
      "--duration <additionalDuration>",
      "Additional duration in seconds",
      parseInt,
    )
    .option("-t, --token [paymentToken]", "Payment token")
    .option(
      "--accept [boolean]",
      "Auto-confirm payment (true/false)",
      toBoolean,
    )
    .option(
      "--chainId <chainId>",
      "Payment/escrow chain (default: active chain)",
    )
    .option(
      "--subsidyProviders <list>",
      "Subsidy provider contract addresses (comma-separated) to claim against. Omit for node defaults; 'none' (or empty) for no subsidy.",
    )
    .action(async (serviceId, additionalDuration, paymentToken, options) => {
      const id = options.service || serviceId;
      const addl = options.duration || additionalDuration;
      const token = options.token || paymentToken;
      if (!id || !addl) {
        throw new Error(
          "A service ID and additional duration are required. Pass them positionally or with --service / --duration.",
        );
      }
      if (!Number.isInteger(addl) || addl <= 0) {
        throw new Error(
          "additionalDuration must be a positive integer number of seconds.",
        );
      }
      let subsidyProviders: string[] | undefined;
      try {
        subsidyProviders = parseSubsidyProviders(options.subsidyProviders);
      } catch (e) {
        console.error(
          chalk.red(`Invalid --subsidyProviders: ${(e as Error).message}`),
        );
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const extendPaymentChainId = await routeExplicit(commands, options.chainId);
      if (extendPaymentChainId === null) return;
      // Merge enabled saved subsidy providers for the payment chain when no explicit flag
      // was given (no-op otherwise).
      subsidyProviders = await commands.resolveJobSubsidyProviders(
        subsidyProviders,
        extendPaymentChainId,
      );
      await commands.extendService(
        id,
        addl,
        token,
        options.accept,
        subsidyProviders,
      );
    });

  // restartService command
  program
    .command("restartService")
    .description(
      "Restarts a running service (same ports & expiry; no extra charge). " +
        "With no container-spec flags the container bounces unchanged (REUSE); " +
        "supplying any image-spec flag (--image/--tag/--checksum/--dockerfile/" +
        "--additional-docker-files) rebuilds it on the new spec (RESPEC, #2119)",
    )
    .argument("<serviceId>", "Service ID")
    .option(
      "-u, --user-data <json>",
      "REPLACE stored container env vars (JSON object)",
    )
    .option(
      "--user-data-file <path>",
      "Path to JSON file with replacement env vars",
    )
    .option(
      "--cmd <json>",
      "REPLACE stored Docker CMD as JSON array (#2114); empty array clears it",
    )
    .option(
      "--entrypoint <json>",
      "REPLACE stored Docker ENTRYPOINT as JSON array (#2114)",
    )
    .option(
      "--image <image>",
      "RESPEC: rebuild on this container image (#2119)",
    )
    .option("--tag <tag>", "RESPEC: rebuild on this image tag (#2119)")
    .option("--checksum <checksum>", "RESPEC: image digest/checksum (#2119)")
    .option(
      "--dockerfile <dockerfile>",
      "RESPEC: dockerfile contents to build from (#2119)",
    )
    .option(
      "--additional-docker-files <json>",
      "RESPEC: extra build files as a JSON object { path: contents } (#2119)",
    )
    .option(
      "--wait [boolean]",
      "Poll until Running (default true)",
      toBoolean,
      true,
    )
    .option(
      "--timeout <seconds>",
      "Max seconds to wait (default 600)",
      parseInt,
    )
    .action(async (serviceId, options) => {
      if (!serviceId) {
        console.error(chalk.red("Missing required argument: <serviceId>"));
        return;
      }
      const params: ServiceRestartParams = {};
      try {
        if (options.userData) {
          const parsed = JSON.parse(options.userData);
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("--user-data must be a JSON object");
          }
          params.userData = parsed;
        } else if (options.userDataFile) {
          const parsed = JSON.parse(
            fs.readFileSync(options.userDataFile, "utf8"),
          );
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("--user-data-file must contain a JSON object");
          }
          params.userData = parsed;
        }
        if (options.cmd !== undefined)
          params.dockerCmd = parseJsonStringArray("--cmd", options.cmd);
        if (options.entrypoint !== undefined)
          params.dockerEntrypoint = parseJsonStringArray(
            "--entrypoint",
            options.entrypoint,
          );
        if (options.image !== undefined) params.image = options.image;
        if (options.tag !== undefined) params.tag = options.tag;
        if (options.checksum !== undefined) params.checksum = options.checksum;
        if (options.dockerfile !== undefined)
          params.dockerfile = options.dockerfile;
        if (options.additionalDockerFiles !== undefined) {
          const parsed = JSON.parse(options.additionalDockerFiles);
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("--additional-docker-files must be a JSON object");
          }
          params.additionalDockerFiles = parsed;
        }
      } catch (e) {
        console.error(chalk.red((e as Error).message));
        return;
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.restartService(
        serviceId,
        Object.keys(params).length > 0 ? params : undefined,
        options.wait,
        options.timeout,
      );
    });

  // stopService command
  program
    .command("stopService")
    .description("Stops an on-demand service and releases its resources")
    .argument("[serviceId]", "Service ID")
    .option("-s, --service <serviceId>", "Service ID")
    .action(async (serviceId, options) => {
      const id = options.service || serviceId;
      if (!id) {
        throw new Error(
          "A service ID is required. Pass it positionally or with --service.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.stopService(id);
    });

  // mintOcean command
  program
    .command("mintOcean")
    .description("Mints Ocean tokens")
    .option(
      "-t, --token <token>",
      "Ocean token address (overrides the chain's configured address; required on chains with no bundled Ocean token)",
    )
    .option("--chainId <chainId>", "Chain to mint on (default: active chain)")
    .action(async (options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.mintOceanTokens(options.token);
    });

  // Generate new auth token
  program
    .command("generateAuthToken")
    .description("Generate new auth token")
    .action(async () => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.generateAuthToken();
    });

  // Invalidate auth token
  program
    .command("invalidateAuthToken")
    .description("Invalidate auth token")
    .argument("[token]", "Auth token")
    .option("-t, --token <token>", "Auth token")
    .action(async (token, options) => {
      const authToken = token || options.token;
      if (!authToken) {
        throw new Error(
          "An auth token is required. Pass it positionally or with --token.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.invalidateAuthToken([authToken]);
    });

  // Escrow deposit command
  program
    .command("depositEscrow")
    .description("Deposit tokens into the escrow contract")
    .argument("[token]", "Address of the token to deposit")
    .argument("[amount]", "Amount of tokens to deposit")
    .option("-t, --token <token>", "Address of the token to deposit")
    .option("-a, --amount <amount>", "Amount of tokens to deposit")
    .option("--chainId <chainId>", "Escrow chain (default: active chain)")
    .action(async (token, amount, options) => {
      const tokenAddress = options.token || token;
      const amountToDeposit = options.amount || amount;
      if (!tokenAddress || !amountToDeposit) {
        throw new Error(
          "A token address and amount are required. Pass them positionally or with --token / --amount.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const target = await routeExplicit(commands, options.chainId);
      if (target === null) return;
      const success = await commands.depositToEscrow(
        commands.signer,
        tokenAddress,
        amountToDeposit,
        target,
      );
      if (!success) {
        console.log(chalk.red("Deposit failed"));
        return;
      }

      console.log(chalk.green("Deposit successful"));
    });

  // Check escrow deposited balance
  program
    .command("getUserFundsEscrow")
    .description("Get deposited token amount in escrow for user")
    .argument("[token]", "Address of the token to check")
    .option("-t, --token <token>", "Address of the token to check")
    .option("--chainId <chainId>", "Escrow chain (default: active chain)")
    .action(async (token, options) => {
      const tokenAddress = token || options.token;
      if (!tokenAddress) {
        throw new Error(
          "A token address is required. Pass it positionally or with --token.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.getEscrowBalance(tokenAddress);
    });

  // Withdraw from escrow
  program
    .command("withdrawFromEscrow")
    .description("Withdraw tokens from escrow")
    .argument("[token]", "Address of the token to check")
    .argument("[amount]", "Amount of tokens to withdraw")
    .option("-t, --token <token>", "Address of the token to check")
    .option("-a, --amount <amount>", "Amount of tokens to withdraw")
    .option("--chainId <chainId>", "Escrow chain (default: active chain)")
    .action(async (token, amount, options) => {
      const tokenAddress = token || options.token;
      const amountToWithdraw = amount || options.amount;
      if (!tokenAddress || !amountToWithdraw) {
        throw new Error(
          "A token address and amount are required. Pass them positionally or with --token / --amount.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.withdrawFromEscrow(tokenAddress, amountToWithdraw);
    });

  // Escrow authorization command
  program
    .command("authorizeEscrow")
    .description(
      "Authorize (or re-authorize) a payee to lock and claim funds from escrow. Re-running overwrites the existing limits (renew/shorten); pass a past --expiry to revoke",
    )
    .argument("[token]", "Address of the token to authorize")
    .argument("[payee]", "Address of the payee to authorize")
    .argument("[maxLockedAmount]", "Maximum amount that can be locked by payee")
    .argument("[maxLockSeconds]", "Maximum lock duration in seconds")
    .argument("[maxLockCounts]", "Maximum number of locks allowed")
    .option("-t, --token <token>", "Address of the token to authorize")
    .option("-p, --payee <payee>", "Address of the payee to authorize")
    .option(
      "-m, --maxLockedAmount <maxLockedAmount>",
      "Maximum amount that can be locked by payee",
    )
    .option(
      "-s, --maxLockSeconds <maxLockSeconds>",
      "Maximum lock duration in seconds",
    )
    .option(
      "-c, --maxLockCounts <maxLockCounts>",
      "Maximum number of locks allowed",
    )
    .option(
      "-e, --expiry <timestamp>",
      "Escrow v2: unix timestamp (seconds) after which the payee can no longer create/extend locks. 0 = indefinite (default). A past timestamp revokes; claim/cancel are never gated by it",
    )
    .option("--chainId <chainId>", "Escrow chain (default: active chain)")
    .action(
      async (
        token,
        payee,
        maxLockedAmount,
        maxLockSeconds,
        maxLockCounts,
        options,
      ) => {
        const { signer, chainId } = await initializeSigner();
        const commands = new Commands(signer, chainId);
        if ((await routeExplicit(commands, options.chainId)) === null) return;
        const tokenAddress = options.token || token;
        const payeeAddress = options.payee || payee;
        const maxLockedAmountValue = options.maxLockedAmount || maxLockedAmount;
        const maxLockSecondsValue = options.maxLockSeconds || maxLockSeconds;
        const maxLockCountsValue = options.maxLockCounts || maxLockCounts;

        if (
          !tokenAddress ||
          !payeeAddress ||
          !maxLockedAmountValue ||
          !maxLockSecondsValue ||
          !maxLockCountsValue
        ) {
          throw new Error(
            "token, payee, maxLockedAmount, maxLockSeconds and maxLockCounts are all required. Pass them positionally or with --token / --payee / --maxLockedAmount / --maxLockSeconds / --maxLockCounts.",
          );
        }

        const success = await commands.authorizeEscrowPayee(
          tokenAddress,
          payeeAddress,
          maxLockedAmountValue,
          maxLockSecondsValue,
          maxLockCountsValue,
          options.expiry,
        );

        if (!success) {
          console.log(chalk.red("Authorization failed"));
          return;
        }

        console.log(chalk.green("Authorization successful"));
      },
    );

  // Escrow v2 diagnostics: escrow kind/version, ERC-165 capabilities, and (with a token) the
  // sponsored bucket / enterprise fee gate.
  program
    .command("getEscrowInfo")
    .alias("escrowInfo")
    .description(
      "Show escrow capabilities for the active chain (version, kind, lock-time sponsorship, enterprise fee gate). Pass a token to also read the sponsored bucket and fee gate",
    )
    .argument(
      "[token]",
      "Optional token address to read the sponsored bucket / fee gate for",
    )
    .option("-t, --token <token>", "Optional token address")
    .option("--chainId <chainId>", "Escrow chain (default: active chain)")
    .action(async (token, options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.getEscrowInfo(options.token || token);
    });

  program
    .command("getAuthorizationsEscrow")
    .description("Get authorizations for escrow")
    .argument("[token]", "Address of the token to check")
    .argument("[payee]", "Address of the payee to check")
    .option("-t, --token <token>", "Address of the token to check")
    .option("-p, --payee <payee>", "Address of the payee to check")
    .option("--chainId <chainId>", "Escrow chain (default: active chain)")
    .action(async (token, payee, options) => {
      const tokenAddress = token || options.token;
      const payeeAddress = payee || options.payee;
      if (!tokenAddress || !payeeAddress) {
        throw new Error(
          "A token address and payee are required. Pass them positionally or with --token / --payee.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.getAuthorizationsEscrow(tokenAddress, payeeAddress);
    });

  program
    .command("createAccessList")
    .description("Create a new access list contract")
    .argument("[name]", "Name for the access list")
    .argument("[symbol]", "Symbol for the access list")
    .argument(
      "[initialUsers]",
      "Comma-separated list of initial user addresses",
      "",
    )
    .argument(
      "[transferable]",
      "Whether tokens are transferable (true/false)",
      "false",
    )
    .option("-n, --name <name>", "Name for the access list")
    .option("-s, --symbol <symbol>", "Symbol for the access list")
    .option(
      "-u, --initial-users [initialUsers]",
      "Comma-separated list of initial user addresses",
      "",
    )
    .option(
      "-t, --transferable [transferable]",
      "Whether tokens are transferable (true/false)",
      "false",
    )
    .option("--chainId <chainId>", "Chain to deploy on (default: active chain)")
    .action(async (name, symbol, initialUsers, transferable, options) => {
      const listName = options.name || name;
      const listSymbol = options.symbol || symbol;
      if (!listName || !listSymbol) {
        throw new Error(
          "A name and symbol are required. Pass them positionally or with --name / --symbol.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.createAccessList([
        listName,
        listSymbol,
        options.transferable || transferable,
        options.initialUsers || initialUsers,
      ]);
    });

  program
    .command("addToAccessList")
    .description("Add user(s) to an access list")
    .argument("[accessListAddress]", "Address of the access list contract")
    .argument("[users]", "Comma-separated list of user addresses to add")
    .option(
      "-a, --address <accessListAddress>",
      "Address of the access list contract",
    )
    .option(
      "-u, --users <users>",
      "Comma-separated list of user addresses to add",
    )
    .option("--chainId <chainId>", "Access-list chain (default: active chain)")
    .action(async (accessListAddress, users, options) => {
      const listAddress = options.address || accessListAddress;
      const listUsers = options.users || users;
      if (!listAddress || !listUsers) {
        throw new Error(
          "An access-list address and user(s) are required. Pass them positionally or with --address / --users.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.addToAccessList([listAddress, listUsers]);
    });

  program
    .command("checkAccessList")
    .description("Check if user(s) are on an access list")
    .argument("[accessListAddress]", "Address of the access list contract")
    .argument("[users]", "Comma-separated list of user addresses to check")
    .option(
      "-a, --address <accessListAddress>",
      "Address of the access list contract",
    )
    .option(
      "-u, --users <users>",
      "Comma-separated list of user addresses to check",
    )
    .option("--chainId <chainId>", "Access-list chain (default: active chain)")
    .action(async (accessListAddress, users, options) => {
      const listAddress = options.address || accessListAddress;
      const listUsers = options.users || users;
      if (!listAddress || !listUsers) {
        throw new Error(
          "An access-list address and user(s) are required. Pass them positionally or with --address / --users.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.checkAccessList([listAddress, listUsers]);
    });

  program
    .command("removeFromAccessList")
    .description("Remove user(s) from an access list")
    .argument("[accessListAddress]", "Address of the access list contract")
    .argument("[users]", "Comma-separated list of user addresses to remove")
    .option(
      "-a, --address <accessListAddress>",
      "Address of the access list contract",
    )
    .option(
      "-u, --users <users>",
      "Comma-separated list of user addresses to remove",
    )
    .option("--chainId <chainId>", "Access-list chain (default: active chain)")
    .action(async (accessListAddress, users, options) => {
      const listAddress = options.address || accessListAddress;
      const listUsers = options.users || users;
      if (!listAddress || !listUsers) {
        throw new Error(
          "An access-list address and user(s) are required. Pass them positionally or with --address / --users.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      if ((await routeExplicit(commands, options.chainId)) === null) return;
      await commands.removeFromAccessList([listAddress, listUsers]);
    });

  program
    .command("downloadNodeLogs")
    .description("Download logs from a node as an admin")
    .argument("[output]", "Output directory to save the logs")
    .argument(
      "[last]",
      "Period of time to get logs from now (in hours). Use either last or from-to",
    )
    .argument("[from]", "Start time (epoch ms) to get logs from")
    .argument("[to]", "End time (epoch ms) to get logs to")
    .argument(
      "[maxLogs]",
      "Maximum number of logs to retrieve (default: 100, max: 1000)",
    )
    .option("-o, --output <output>", "Output directory to save the logs")
    .option(
      "-l, --last [last]",
      "Period of time to get logs from now (in hours)",
    )
    .option("-f, --from [from]", "Start time (epoch ms) to get logs from")
    .option("-t, --to [to]", "End time (epoch ms) to get logs to")
    .option(
      "-m, --maxLogs [maxLogs]",
      "Maximum number of logs to retrieve (default: 100, max: 1000)",
    )
    .action(async (output, last, from, to, maxLogs, options) => {
      const outputDir = options.output || output;
      if (!outputDir) {
        throw new Error(
          "An output directory is required. Pass it positionally or with --output.",
        );
      }
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.downloadNodeLogs([
        outputDir,
        options.last || last,
        options.from || from,
        options.to || to,
        options.maxLogs || maxLogs,
      ]);
    });

  program
    .command("createBucket")
    .description(
      "Create a new persistent-storage bucket. Pass an access list to gate it; omit for owner-only access (chain inferred from RPC)",
    )
    .argument(
      "[accessListAddress]",
      "Access list contract address (0x…); omit for owner-only access",
    )
    .action(async (accessListAddress) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.createBucket([null, accessListAddress]);
    });

  program
    .command("addFileToBucket")
    .description("Upload a local file into a bucket")
    .argument("<bucketId>", "Bucket id")
    .argument("<filePath>", "Path to local file")
    .argument(
      "[fileName]",
      "Name under which to store the file (defaults to basename)",
    )
    .action(async (bucketId, filePath, fileName) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.addFileToBucket([null, bucketId, filePath, fileName]);
    });

  program
    .command("listBuckets")
    .description("List buckets owned by an address (defaults to signer)")
    .option("-o, --owner <address>", "Owner address")
    .action(async (options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.listBuckets([null, options.owner]);
    });

  program
    .command("listFilesInBucket")
    .description("List files in a bucket")
    .argument("<bucketId>", "Bucket id")
    .action(async (bucketId) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.listFilesInBucket([null, bucketId]);
    });

  program
    .command("getFileObject")
    .description("Get the file-object descriptor for a file in a bucket")
    .argument("<bucketId>", "Bucket id")
    .argument("<fileName>", "File name")
    .action(async (bucketId, fileName) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.getFileObject([null, bucketId, fileName]);
    });

  program
    .command("deleteFile")
    .description("Delete a file from a bucket")
    .argument("<bucketId>", "Bucket id")
    .argument("<fileName>", "File name")
    .action(async (bucketId, fileName) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      await commands.deleteFile([null, bucketId, fileName]);
    });

  program
    .command("searchComputeResources")
    .alias("findComputeNodes")
    .description(
      "Search the network for compute providers that can run a job with the resources you need. " +
        "Runs an interactive wizard when no filter flags are given, otherwise uses the flags.",
    )
    .option("--cpu <cores>", "CPU cores needed")
    .option("--ram <gb>", "RAM needed")
    .option("--disk <gb>", "Disk needed")
    .option("--gpu <count>", "GPU devices needed")
    .option("--gpu-model <name>", "GPU kind/description to match (e.g. A100)")
    .option(
      "--resource <name:amount>",
      "Arbitrary resource (e.g. fpga:2); repeatable",
      collectResource,
      [] as string[],
    )
    .option("--free", "Search only free compute environments")
    .option("--paid", "Search only paid compute environments")
    .option("--both", "Search both free and paid (default)")
    .option(
      "--chain <chainIds>",
      "Chain(s) to price against, comma-separated (defaults to the RPC chain)",
    )
    .option(
      "--token <addresses>",
      "Restrict to payment-token address(es), comma-separated; applied to every --chain",
    )
    .option(
      "--max-price <amount>",
      "Drop paid results costing more than this (human units)",
    )
    .option(
      "--duration <seconds>",
      "Assumed job duration for the cost estimate",
    )
    .option(
      "--order-by <key>",
      "Order results: price | freeCapacity | resources | leastBusy",
    )
    .action(async (options) => {
      const { signer, chainId } = await initializeSigner();
      const commands = new Commands(signer, chainId);
      const flags = options as SearchFlags;
      const params = hasSearchFlags(flags)
        ? buildParamsFromFlags(flags, chainId)
        : await runResourceWizard(chainId);
      await commands.searchComputeResources(params);
    });

  // Every registered command must belong to exactly one help group (see HELP_GROUPS).
  assertHelpGroupsCoverAll(program);

  return program;
}
