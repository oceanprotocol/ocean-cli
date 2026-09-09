# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


## What this project is

`ocean-cli` (npm package `@oceanprotocol/cli`, version 2.0.0; installs a `bin` named `ocean-cli`) is a TypeScript CLI that wraps the Ocean Protocol JavaScript library (`@oceanprotocol/lib`, a.k.a. ocean.js) to publish, edit, consume/download, and run compute-to-data (C2D) on assets, plus manage escrow payments, access lists, persistent-storage buckets, auth tokens, and admin node logs. It talks to an **Ocean Node** (the single service that replaced the old standalone Provider and Aquarius apps — it does metadata caching, indexing, encryption, ordering, and compute) and to an EVM chain via an RPC endpoint.

The package is pure ESM (`"type": "module"` in `package.json`). All relative imports MUST carry an explicit `.js` extension even though the source is `.ts` (e.g. `import { Commands } from "./commands.js"`). Node 22 is expected (`.nvmrc` = `22.23.1`; CI pins the same). The dev toolchain sets the floor: `eslint@10` needs `>=22.13.0` and `release-it@21` needs `>=22.21.0`, so an older 22.x will fail `npm run lint` / `npm run release` even though `engines.node` is only `>=22` (that bound is for consumers of the published package, who get `dependencies` only).

## Commands

Scripts (from `package.json`):

- `npm run build` — `npm run clean && tsc --sourceMap` (clean wipes `./dist ./doc ./.nyc_output`, then compile to `./dist`).
- `npm run build:tsc` — compile only.
- `npm run lint` — `eslint .` (ESLint 10, flat config in `eslint.config.mjs`). Custom rules: `@typescript-eslint/no-explicit-any: warn` everywhere, plus a `test/**/*.ts` override turning off `@typescript-eslint/no-unused-expressions` (chai's `expect(x).to.be.true` is a bare expression by design) and `preserve-caught-error`. Both stay enforced in `src/`.
- `npm run lint:fix` — eslint with `--fix`.
- `npm run format` — Prettier over `**/*.{js,jsx,ts,tsx}`.
- `npm run cli` — runs the CLI from source with `npx tsx src/index.ts` (no build step needed for local use).
- `npm run test` — `npm run lint && npm run test:system` (lint is part of "test").
- `npm run test:system` — `npm run mocha 'test/**/*.test.ts'`.
- `npm run mocha` — `npx tsx ./node_modules/mocha/bin/mocha.js --config=test/.mocharc.json --node-env=test --exit`. Runs mocha under `tsx`; there is no `ts-node` and no `NODE_OPTIONS` flag any more.
- `npm run release` — `release-it --non-interactive`: bumps version, builds, regenerates the changelog (`npm run changelog` = `auto-changelog -p`), commits, tags `v${version}`, pushes, and cuts a GitHub Release. Does **not** publish to npm (`release-it` config `npm.publish: false`) — pushing the tag triggers `.github/workflows/publish.yml`, which runs `npm publish` (`--tag next` for tags containing `next`, else `latest`). Mirrors `@oceanprotocol/lib`'s release flow.

Mocha config (`test/.mocharc.json`): `bail: true` (stops at first failure), `timeout: 20000`, `exit: true`. No `loader` key — TypeScript is handled by `tsx` from the `mocha` script, so nothing type-checks at test time (run `tsc` separately to catch type errors in `test/`, which the build's `include` does not cover).

### Running a single test

There is no dedicated script; call the `mocha` script directly with a path and/or `--grep`:

```bash
# one file
npm run mocha 'test/consumeFlow.test.ts'
# one test by name (title substring)
npm run mocha 'test/**/*.test.ts' --grep "Publishing"
# a single unit test file that needs NO running infra:
npm run mocha 'test/resolveComputeInputs.test.ts'
```

Because `bail` is on, a failing test aborts the rest of the run.

### Running the CLI locally

```bash
export PRIVATE_KEY="0x..."          # or MNEMONIC
export RPC="https://..."
export NODE_URL="http://127.0.0.1:8001"   # or an https node, or a libp2p peer id / multiaddr
npm run cli h                        # list commands ("h" and "help" are aliases; --help / -h also work)
npm run cli publish metadata/simpleDownloadDataset.json
```

`npm run cli` (= `npx tsx src/index.ts`) runs from source, no build. A globally installed copy (`npm i -g @oceanprotocol/cli`) exposes the same thing as the `ocean-cli` binary — `ocean-cli <command>` is equivalent to `npm run cli <command>`.

Important behavior of the entry point (`src/index.ts`): after running the command passed on argv **once**, the process enters an interactive REPL loop, printing `Enter command ('exit' | 'quit' | ESC or CTRL-C to terminate')` and reading further commands from stdin until you type `exit`/`quit`/`\q`, press **ESC** (TTY only), or hit CTRL-C. To get one-shot behavior (run and exit — required for CI and scripting) set `AVOID_LOOP_RUN=true`. In the REPL you may type either the bare command (`publish metadata/x.json`) or the full `npm run cli publish metadata/x.json` / `ocean-cli publish metadata/x.json` form (the leading prefix is stripped). Note: a pure help/version invocation (`--help`, `-h`, `--version`, `-V`, `h`, `help`) skips env-var validation and P2P bootstrap, so it works with no configuration; every other command still validates the env vars below.

### Required environment variables

Validated at startup in `createCLI()` (`src/cli.ts`), which `process.exit(1)`s with a red message if missing:

- `PRIVATE_KEY` **or** `MNEMONIC` — signer credentials (private key preferred; mnemonic via `ethers.Wallet.fromPhrase`).
- `RPC` — JSON-RPC endpoint(s). **Either** a single URL (legacy, chainId read from `provider.getNetwork()`) **or** a JSON map keyed by chainId whose values are a URL or an ordered list of URLs (e.g. `{"1":"https://…","8453":["https://a","https://b"]}`). A chain with ≥2 URLs is served by an ethers v6 `FallbackProvider` (`quorum:1`, priority = declaration order, per-backend `stallTimeout`). The shape is parsed and validated up front in `createCLI()` (a malformed value `exit(1)`s with an example); the unset message stays the test-asserted `"Have you forgot to set env RPC?"`. All RPC/provider/signer/config lifecycle lives in `src/rpcRegistry.ts` (the single source of truth, mirroring `nodeConnection.ts`); `initializeSigner()` is a thin wrapper over it. A default/active chain is resolved (`setChain`/`CHAIN_ID` → persisted default → sole configured chain → the single chain both the node serves and the registry knows → none); chain-explicit and compute commands additionally accept `--chainId` (see "CLI commands exposed" and "Compute flow"). Runtime-added chains persist to `~/.ocean/cli/rpc.json` (override with `RPC_CONFIG_FILE`); env `RPC` is merged first and wins on conflict.

### Optional environment variables

- `NODE_URL` — the **initial** Ocean Node. An `http(s)://` URL, a raw libp2p peer id, or a full `/dns4/.../p2p/...` multiaddr. **Not required to start:** without it the CLI runs in a node-less state where the `preAction` gate in `createCLI()` refuses every command except `setNode` / `getNode` / `help` (see "Node selection"). Switchable at runtime with `setNode`.
- `DISABLE_P2P` — `true` skips starting libp2p entirely. Combined with a P2P `NODE_URL` it is a fatal contradiction (`exit(1)` at startup).
- `ADDRESS_FILE` — path to a contracts `address.json`. Defaults to `${homedir}/.ocean/ocean-contracts/artifacts/address.json`. Consumed by ocean.js `ConfigHelper` for **Barge / custom-deployed** contract addresses. No longer strictly required for escrow / access-list: `ConfigHelper` falls back to the multi-chain contract set bundled with `@oceanprotocol/lib`, so those commands now work on supported public chains without a local `address.json`. `mintOcean` additionally needs an Ocean token address — from `config.oceanTokenAddress` (absent on some chains, e.g. Base) or an explicit `--token <address>` (see "Config & chain selection").
- `INDEXING_MAX_RETRIES` / `INDEXING_RETRY_INTERVAL` — how long to wait for an asset to be indexed. **Code defaults are 120 retries × 4000 ms** (`getIndexingWaitSettings()` in `helpers.ts`); the README's "100 / 3000" figures are stale.
- `AVOID_LOOP_RUN` — `true` = one-shot (no REPL loop). Unset/`false` = interactive loop.
- `BOOTSTRAP_PEERS` — comma-separated extra libp2p multiaddrs, added to the bootstrap list built in `nodeConnection.ts`.

## CLI commands exposed

All registered in `src/cli.ts` via Commander (`commander` v13). Every command supports **both** positional arguments and named options (options win: the action does `options.x || positionalArg`), so `publish metadata.json` and `publish --file metadata.json` are equivalent.

- Assets: `getDDO`, `publish`, `publishAlgo`, `editAsset` (alias `edit`), `download`, `allowAlgo`.
- Compute: `startCompute`, `startFreeCompute`, `getComputeEnvironments` (alias `getC2DEnvs`), `computeStreamableLogs`, `stopCompute`, `getJobStatus`, `downloadJobResults`.
- Tokens/auth: `mintOcean`, `generateAuthToken`, `invalidateAuthToken`.
- Escrow: `depositEscrow`, `getUserFundsEscrow`, `withdrawFromEscrow`, `authorizeEscrow`, `getAuthorizationsEscrow`.
- Access lists: `createAccessList`, `addToAccessList`, `checkAccessList`, `removeFromAccessList`.
- Persistent storage buckets: `createBucket`, `addFileToBucket`, `listBuckets`, `listFilesInBucket`, `getFileObject`, `deleteFile`.
- Admin: `downloadNodeLogs`.
- Node selection: `setNode` (alias `useNode`), `getNode` (alias `currentNode`).
- Chain/RPC management: `addChain` (alias `addRpc`), `removeChain` (alias `removeRpc`), `listChains` (aliases `getRpcs`/`chains`), `setChain` (alias `useChain`), `getChain` (alias `currentChain`). Node-free (in `NODE_FREE_COMMANDS`); implemented directly in `cli.ts` actions (no `Commands` instance), mutating the `rpcRegistry` singleton the way `setNode`/`getNode` mutate `process.env.NODE_URL`.
- `help` / `h`.

**`--chainId` routing.** Chain-explicit commands (`mintOcean`, all escrow, all access-list, and the escrow-paid `startService`/`extendService`) take a single `--chainId <id>` option: flag → default chain → error listing configured chains. Chain-implied commands (`publish`/`publishAlgo`/`editAsset`/`allowAlgo`/`download`) route to the **DDO's own `chainId`** (via `Commands.useChain` / `routeToAssetChain`). Category-agnostic commands sign on the default chain. Services are **single-chain** (no asset DDO), so `--chainId` is just the payment/escrow chain and must also be one the compute env prices on (`env.fees[chainId]`).

Per-command flags and examples are exhaustively documented in `README.md` ("Command Usage" / "Available Named Options Per Command"). A few load-bearing notes:

- `startCompute` requires `maxJobDuration` (seconds, drives payment), `paymentToken` (must be listed by the chosen compute env for the payment chain — get it from `getComputeEnvironments`, which now prints fee chains + tokens per env), and `resources` (stringified JSON like `'[{"id":"cpu","amount":3},{"id":"ram","amount":16772672536},{"id":"disk","amount":0}]'`). Optional `--chainId` is the **payment/escrow chain** (flag → default → error); each dataset/algorithm is still ordered on its own DDO chain, so a job can mix asset chains and pay on another — every chain used must be a registered RPC. `--accept true` skips the interactive payment confirmation prompt (mandatory when stdin is not a TTY). Optional `--output` is a stringified JSON remote-storage backend (S3/FTP/URL/Arweave/IPFS); omit to store results on the node's disk.
- Datasets/algorithm arguments accept a DID, a JSON `ComputeAsset`/`ComputeAlgorithm` with a `fileObject` (raw, unpublished, no datatoken order), a JSON array, mixed DID+raw entries, or the legacy `[did:a,did:b]` form. When passing JSON on the shell, single-quote it and use `-- ` to stop Commander option parsing.
- `startFreeCompute` targets a compute env with `free === true` and does no ordering/payment.

## Architecture

### Entry point and dispatch (`src/index.ts` → `src/cli.ts`)

`main()` in `index.ts` calls `createCLI()` (in `cli.ts`) to build the Commander `program`, records supported command names/aliases, prints the REPL banner, runs the initial argv command once, then loops on stdin (`runLoop`) unless `AVOID_LOOP_RUN=true`. It uses `program.exitOverride()` so Commander errors don't kill the loop.

`createCLI()` does four things: (1) validates `PRIVATE_KEY`/`MNEMONIC` and `RPC` — **unless** the invocation is a pure help/version one (`--help`/`-h`/`--version`/`-V`/`h`/`help`), which is detected from `process.argv` and skips both validation and P2P so those work with no config, (2) starts libp2p and health-checks `NODE_URL` if set (see "Transport" and "Node selection"), (3) registers the `preAction` gate that refuses non-`NODE_FREE_COMMANDS` while no node is set, (4) registers every command. Each command's `.action(...)`:

1. merges positional + option values,
2. calls the local `initializeSigner()` — builds a `JsonRpcProvider(RPC)`, a `Wallet` from `PRIVATE_KEY` (or `Wallet.fromPhrase(MNEMONIC)`), and reads `chainId` from the network,
3. constructs `new Commands(signer, chainId)`,
4. calls the matching method on that `Commands` instance.

**Args-array convention (gotcha):** `Commands` methods take a `string[]`. Most methods are 1-indexed — the action passes `[null, arg1, arg2, ...]` and the method reads `args[1]`, `args[2]`, … (the leading `null` is a legacy placeholder). But several methods are 0-indexed: `computeStreamableLogs`, `invalidateAuthToken`, `createAccessList`, `addToAccessList`, `checkAccessList`, `removeFromAccessList` read `args[0]`, `args[1]`, … Check the specific method before changing how a command builds its args array.

Signer/config wiring functions with more arguments (`depositToEscrow`, `authorizeEscrowPayee`, `withdrawFromEscrow`, `getEscrowBalance`, `getAuthorizationsEscrow`) are called with plain positional params, not the args array.

### The `Commands` class (`src/commands.ts`)

One big class holding all command logic. The constructor:

- sets `this.config = config || new ConfigHelper().getConfig(network)` — ocean.js's `ConfigHelper` maps a chainId (or name) to a network config object,
- sets `this.oceanNodeUrl = process.env.NODE_URL` and `this.config.nodeUri = this.oceanNodeUrl`,
- creates `this.aquarius = new Aquarius(this.oceanNodeUrl)` (the Ocean Node also serves the Aquarius/indexer API),
- loads `this.indexingParams` from `getIndexingWaitSettings()`.

### Config & chain selection — one mechanism (important)

**`ConfigHelper().getConfig(chainId)`** from ocean.js is the single source of both the general
publish/consume/compute config (`this.config`) **and** the contract addresses. The CLI's old
hand-rolled `getConfigByChainId()` (which parsed a Barge-only `address.json` and returned the
capitalized `Ocean`/`Escrow`/`AccessListFactory` keys) has been **deleted**. All address reads now
go through `getConfigFor(chainId)` in `src/rpcRegistry.ts` (a memoized `ConfigHelper().getConfig`
with `nodeUri` set) and use the lib's **lowercase** field names:

- `config.oceanTokenAddress` — `mintOcean` (resolved as `--token` flag → `oceanTokenAddress` → error asking for `--token`, since some chains e.g. Base have no bundled Ocean token).
- `config.escrow` — all escrow commands **and** the on-demand-service escrow path (`startService`/`extendService`, via `serviceHelpers.ts`).
- `config.accessListFactory` — `createAccessList`.

`ConfigHelper` reads `ADDRESS_FILE` when set (Barge / custom) else the multi-chain contracts bundled
with `@oceanprotocol/lib`, so these commands now work off-Barge. `requireAddress(chainId, field, label)`
in `rpcRegistry.ts` centralizes the "address missing for this chain" error.

**Multi-chain (the RPC registry).** `RPC` is now **either** a single URL (legacy, chainId probed via
`getNetwork()`) **or** a JSON map `{ "<chainId>": "url" | ["url", …] }`. `src/rpcRegistry.ts` is the
single source of truth for all RPC/provider/signer/config lifecycle (mirrors `nodeConnection.ts`):
`getProvider` builds a `JsonRpcProvider` (1 URL) or a `FallbackProvider` (`quorum:1`, priority = order,
`stallTimeout`, `staticNetwork`; ≥2 URLs), `getSigner`/`getConfigFor` are memoized per chain, and
`verifyChain` lazily checks each backend's real `eth_chainId` on first use (dropping confirmed
mismatches, keeping merely-unreachable ones for failover). Runtime-added chains persist to
`~/.ocean/cli/rpc.json` (override `RPC_CONFIG_FILE`); on load the env map is merged with that file and
**env wins**. Default (active) chain resolution: `setChain`/`CHAIN_ID` → persisted default → sole
configured chain → node∩registry. `Commands` pins the **default** chain in its constructor but routes
per command: `useChain(chainId)` re-points `this.signer`/`this.config` (safe — a fresh instance per CLI
invocation, methods run one at a time), `configFor`/`signerFor` are the per-chain accessors Phase 3
uses directly. `destroyProviders()` tears providers down on exit (next to `stopP2P`).

### ocean.js integration and helpers (`src/helpers.ts`)

`helpers.ts` is the seam between the CLI and ocean.js:

- `createAssetUtil(...)` wraps ocean.js `createAsset` (used by publish/publishAlgo and the interactive publisher). It resolves the active ERC20 template (`calculateActiveTemplateIndex` reads and `JSON.parse`s the `@oceanprotocol/contracts` `ERC20Template.json` ABI, resolved via `createRequire`/`require.resolve` so it works from any cwd — e.g. a global install — not a cwd-relative `node_modules` path), and for **Oasis Sapphire** (`config.sdk === 'oasis'`) wraps the signer with `wrapEthersSigner` from `@oasisprotocol/sapphire-ethers-v6` (`getSignerAccordingSdk`; sapphire-paratime v2 moved its ethers integration into that package, and it throws `SignerHasNoProviderError` for a provider-less signer) and deploys an allow access list before creating the asset.
- `updateAssetMetadata(...)` — used by `editAsset`, `allowAlgo`, `disallowAlgo` and the interactive publisher. It validates the DDO via `aquarius.validate`, then either `ProviderInstance.encrypt`s the DDO (flags = 2) or hexlifies raw JSON (flags = 0) depending on the `encryptDDO` flag, then calls `nft.setMetadata`.
- `handleComputeOrder(...)` — the ordering state machine used in compute: validOrder + no fees → reuse as-is; validOrder + fees → `datatoken.reuseOrder` paying only provider fees; no order → `orderAsset` (pay 1 datatoken + fees). Approves provider-fee tokens first when the fee amount > 0.
- `resolveComputeInputs(...)` + `parseComputeInput(...)` — parse the datasets/algo CLI strings (DID | JSON object | array | mixed | legacy `[did:a,did:b]`), resolve DID entries through `aquarius.waitForIndexer`, pass raw `fileObject` entries through (aligned with a `null` DDO slot), and pick `providerURI` from the first DID-based DDO's `serviceEndpoint` (else fall back to `NODE_URL`).
- `fixAndParseProviderFees(...)` — regex-based repair of the stringified provider-initialize response that is round-tripped from `initializeCompute` into `computeStart` (adds quotes to keys, DIDs, hex addresses). Fragile by design; touch carefully.
- `getIndexingWaitSettings()` — reads the `INDEXING_*` env vars.
- Signing/encryption is always done via the `Signer` and `ProviderInstance` from ocean.js; the CLI never handles raw keys beyond constructing the `ethers.Wallet`.

### Publish, edit, consume/download flows

- **Publish** (`publish`, `publishAlgo`): read a JSON DDO file, then `createAssetUtil` with `asset.indexedMetadata.nft.name/symbol` and `asset.services[0].files.files`. `--encrypt` (default `true`) controls DDO encryption. See `metadata/*.json` for the expected DDO shape.
- **Edit** (`editAsset`): resolve the DDO via `waitForIndexer`, shallow-merge the top-level keys from the update JSON into the asset, then `updateAssetMetadata`.
- **allowAlgo / disallowAlgo**: mutate `services[0].compute.publisherTrustedAlgorithms` (checks signer is the NFT owner and the service is a `compute` service; computes container + files checksums via `ProviderInstance.checkDidFiles` / `getHash`) and re-publish metadata. (`disallowAlgo` exists on `Commands` but is not registered as a CLI command.)
- **Download/consume** (`download`): resolve DDO → `orderAsset` (buys a datatoken) → `tx.wait()` → `ProviderInstance.getDownloadUrl` → `downloadFile` (streams to disk, filename from `content-disposition` when present).

### Compute flow

The `startCompute` **action in `cli.ts`** orchestrates a two-phase flow (not a single `Commands` method). It first resolves the **payment/escrow chain** with `resolveChainId(options.chainId)` (`--chainId` flag → default chain → error) and passes it as an explicit trailing param to both compute methods:

1. `commands.initializeCompute([...], paymentChainId)` — resolves inputs, fetches compute envs (`ProviderInstance.getComputeEnvironments`), matches the env by id, validates that the **payment chain** is in both `computeEnv.fees` and the RPC registry, plus paymentToken/resources/maxJobDuration (capping to `env.maxJobDuration`), and returns the provider `initializeCompute` response (payment + provider fees). Signs against the payment chain (`signerFor(paymentChainId)`).
2. Prints payment details, converts amount with `unitsToAmount`, and asks for confirmation unless `--accept true` (hard error on non-TTY).
3. `commands.computeStart([...], paymentChainId)` — **per-asset ordering**: each DID-based dataset/algorithm DDO is ordered on **its own** chain via a per-chain `{ signer, config, Datatoken }` context (`orderCtxFor(ddo.chainId)`, memoized within the call), replacing the old single `Datatoken` on the signer's one chain. Escrow funds (`EscrowContract.verifyFundsForEscrowPayment`), deposit/authorize, and `ProviderInstance.computeStart` all run on the **payment chain** (`paymentSigner` = `signerFor(paymentChainId)`), independent of where the assets live (C2D V2: all datasets passed together in `assets`; the old `additionalDatasets` param is unused). Prints `JobID` and the agreement id (`payment.lockTx`).

**Multi-chain compute (category d).** A single job may mix datasets/algorithm on different chains and pay/escrow on yet another. `--chainId` is **only** the payment chain; asset chains are always taken from each DDO, never passed by the user. `Commands.ensureComputeChainsRegistered(paymentChainId, ddos, algoDdo)` validates up front — via the pure `computeJobChainIds()` helper (`helpers.ts`) — that every chain the job touches (payment + each DID asset/algo chain) has a registered RPC, and errors listing the missing chain(s) before any paid order. In the common **single-chain** case every asset shares the payment chain, so ordering/escrow/`computeStart` are equivalent to before.

`startFreeCompute` → `freeComputeStart` calls `ProviderInstance.freeComputeStart` against a `free` env with no ordering/escrow; its `--chainId` just routes the signing chain (`routeExplicit`/`useChain`, like a category (c) command). `stopCompute`, `getJobStatus`, `downloadJobResults`, `computeStreamableLogs` are thin wrappers over the corresponding `ProviderInstance` methods. `getComputeEnvironments` additionally prints a per-env **payment summary** (fee chains + accepted tokens, via the pure `summarizeComputeEnvFees()` helper) so `--chainId`/`--paymentToken` are choosable without reading raw JSON.

### Escrow, access lists, persistent storage, auth, node logs

- **Escrow** (`EscrowContract` from ocean.js, address from `address.json`): `depositEscrow` approves then deposits; `withdrawFromEscrow` checks balance first; `authorizeEscrow` sets per-payee lock limits; `getUserFundsEscrow` / `getAuthorizationsEscrow` read state.
- **Access lists** (`AccesslistFactory` / `AccessListContract` from ocean.js): `createAccessList` deploys via the factory (address from `address.json`); membership is an ERC721 balance — `addToAccessList` mints/`batchMint`s NFTs, `checkAccessList` tests `balance > 0`, `removeFromAccessList` burns each token via `tokenOfOwnerByIndex`.
- **Persistent storage** (`ProviderInstance.*PersistentStorage*`): bucket CRUD + file upload/list/get/delete. `addFileToBucket` streams the file with a progress logger and a 30-minute (`UPLOAD_TIMEOUT_MS`) abort timeout; buckets can be gated by an access-list address.
- **Auth tokens**: `generateAuthToken` / `invalidateAuthToken` via `ProviderInstance`.
- **downloadNodeLogs** (admin): time-range or `--last N` hours; writes `<output>/logs.json`.

### Transport: HTTP vs P2P, and node selection (`src/nodeConnection.ts`)

All node lifecycle logic lives in `nodeConnection.ts`; `cli.ts` only calls into it.

**libp2p is transport, not a connection to one node.** Every ocean.js P2P call takes a `nodeUri` and dials that peer on demand (direct dial for a full multiaddr, DHT lookup for a bare peer id), so one libp2p node serves any number of Ocean nodes and switching between them never restarts or stops it.

- `startP2P(initialNodeUrl?)` — called **once at startup**, not lazily and not only for P2P `NODE_URL`s, because bootstrap dials + DHT warm-up take seconds and should overlap with the user reading the prompt. The one exception is one-shot mode (`AVOID_LOOP_RUN="true"`), where `cli.ts` skips it — there is no later command to warm up for (see the exit note at the end of this section). It is **deliberately not awaited**; the stored promise swallows its own rejection (an unhandled rejection on a fire-and-forget promise would kill the process) and remembers the failure for `ensureP2PReady()`. No-op when `DISABLE_P2P=true` or when `ProviderInstance.getLibp2pNode()` is already non-null. Bootstrap peers = the initial node if it is a P2P URI (bare peer ids get the `/ip4/127.0.0.1/tcp/9001/ws/p2p/<id>` localhost convention) + `BOOTSTRAP_PEERS` + four hard-coded Ocean bootstrap nodes (passing `bootstrapPeers` **replaces** the lib's defaults, so they must be listed explicitly).
- `ensureP2PReady()` — awaited by every P2P-bound path; throws a clear reason instead of hanging when P2P is unavailable.
- `validateNode(url)` — non-destructive health check via `ProviderInstance.getNodeStatus` under an `AbortSignal.timeout` (10 s HTTP, 30 s P2P since a bare peer id may need a DHT lookup). Over P2P the on-demand dial *is* the reachability check, which is what the old 20 s wait-for-target-peer polling loop did — that loop is gone.
- `getCurrentNodeUrl()` / `setCurrentNodeUrl()` / `hasNode()` — `process.env.NODE_URL` stays the **single source of truth**, so switching node is just mutating it: `Commands`' constructor and `getMetadataURI()` re-read it per use.

`setNode` validates first and only then mutates the env var, so a failed switch leaves everything untouched — there is nothing to roll back. The switch itself never touches the RPC/signer (node selection is independent of them and must work when the RPC is slow); `setNode` calls `initializeSigner()` only *after* committing, under a 5 s `Promise.race` timeout, purely to warn when the node does not serve the RPC's chain. CI exercises both transports (matrix `[http, p2p]`).

**libp2p keeps the process alive.** A started libp2p node holds the event loop open, and even a clean `stop()` leaves a `MessagePort` behind (confirmed with `process.getActiveResourcesInfo()`). So `index.ts` ends with `if (await stopP2P()) { await flushOutput(); process.exit(...) }` — the flush matters because a piped stdout can still hold buffered output that `process.exit()` would discard. For the same reason the eager `startP2P` is **skipped in one-shot mode** (`AVOID_LOOP_RUN=true`): a one-shot run has no later command to warm up for, and would only pay startup + shutdown cost. One-shot runs that target a P2P node still get libp2p on demand via `validateNode` → `ensureP2PReady`.

### Interactive publish wizard (currently unwired)

`Commands.start()` runs an enquirer-based guided publisher: `interactiveFlow()` (`src/interactiveFlow.ts`, figlet banner + prompts for title/description/tags/timeout/storage/pricing/chain/template) → `publishAsset()` (`src/publishAsset.ts`, builds a `4.1.0` DDO and calls `createAssetUtil` + `updateAssetMetadata`). Note: **no CLI command registers `start()`** in `cli.ts`, so this wizard is not reachable through the normal command set — it is only exercised by `test/interactivePublishFlow.ts`. Do not assume publishing goes through this path; `publish`/`publishAlgo` (file-based) is the live path.

## DDO / metadata files

Sample DDOs live in `metadata/` (e.g. `simpleDownloadDataset.json`, `simpleComputeDataset.json`, `simpleIPFSComputeDataset.json`, `jsAlgo.json`, `jsIPFSAlgo.json`, `pythonAlgo.json`, `downloadAssetPaymentUSDC.json`). These are DDO version `4.1.0` documents with `metadata`, `services[]` (a `type: "access"` or `type: "compute"` service carrying `files.files[]`, `serviceEndpoint`, `timeout`, and for compute a `compute` policy block), and an `indexedMetadata` section with `nft.name`/`nft.symbol` (read by publish) and `stats`. **Update `chainId` in these files to match your target network before publishing** (the README calls this out; samples default to `8996`, the Barge local chain). DDO types come from `@oceanprotocol/ddo-js` (`Asset`, `DDO`).

## Testing architecture

Most tests are **integration/system tests that require a running Ocean stack** (Barge): an EVM RPC (typically `http://localhost:8545`), an Ocean Node (`http://localhost:8000`/`8001`), and deployed contracts with `ADDRESS_FILE` pointing at the generated `address.json`. Patterns:

- `test/util.ts` — `runCommand` / `runCommandAs(privateKey, cmd)` shell out to the CLI via `execPromise("npm run cli ...")` from the project root; tests set `AVOID_LOOP_RUN=true` and often hard-code well-known Barge test private keys and localhost URLs inline.
- `test/setup.test.ts` — asserts `npm run cli h` help output and the env-var validation error messages.
- `test/consumeFlow.test.ts`, `paidComputeFlow.test.ts`, `escrow.test.ts`, `accessList.test.ts`, `storage.test.ts` — end-to-end flows against the live node.
- `test/http.test.ts` — hits the node HTTP API (`localhost:8001`) directly.
- `test/resolveComputeInputs.test.ts` — a **true unit test** using a fake `Aquarius`; runs with no infra.
- `test/interactivePublishFlow.ts` — the enquirer wizard (note: no `.test.ts` suffix, so it is not picked up by the `test:system` glob).

CI (`.github/workflows/ci.yml`) has three jobs: `build`, `lint`, and `test_system` (matrix over `transport: [http, p2p]`), which checks out `oceanprotocol/barge`, runs `start_ocean.sh --with-typesense`, waits for `ocean-node-1`, sets `NODE_URL` (HTTP `http://127.0.0.1:8001`, or the peer id for P2P), and runs `npm run test:system` with `AVOID_LOOP_RUN=true` and `INDEXING_RETRY_INTERVAL=4000` / `INDEXING_MAX_RETRIES=120`.

## Notable gotchas

- ESM + `.js` import extensions are mandatory; forgetting them breaks the build/runtime.
- `RPC` may be a single URL or a JSON map keyed by chainId; a chain with ≥2 URLs becomes a `FallbackProvider` (`quorum:1`). All RPC/provider/signer/config lifecycle lives in `src/rpcRegistry.ts`.
- **Chain routing is per command, not global.** Chain-agnostic commands sign on the default chain; chain-implied commands (`publish`/`publishAlgo`/`editAsset`/`allowAlgo`/`download`) route to the **DDO's `chainId`** (fixing the old publish-ignores-DDO-chainId bug); chain-explicit commands (`mintOcean` + escrow + access-list + `startService`/`extendService`) take **`--chainId`** (flag → default → error). `Commands.useChain(chainId)` re-points `this.signer`/`this.config` (mutation is safe: one fresh instance per invocation, sequential methods). **Compute is the exception** — `startCompute` genuinely needs several chains inside one call, so it does **not** use `useChain`: it takes `configFor(chainId)`/`signerFor(chainId)` explicitly per asset (each DDO's chain) and per payment (`--chainId`). `startFreeCompute` does no ordering/escrow, so it needs only one signing chain and routes its `--chainId` through `useChain`.
- **Default-chain resolution:** `setChain`/`CHAIN_ID` env → persisted default → sole configured chain → the one chain both the node serves and the registry knows. `getActiveChainId()` is the lenient variant (falls back to *any* registered chain for signing, without committing a default); `resolveChainId()`/`routeExplicit()` in `cli.ts` do the strict flag→default→error for `--chainId`.
- **Runtime chains persist** to `~/.ocean/cli/rpc.json` (`RPC_CONFIG_FILE` override); env `RPC` is merged with it and **env wins**. `addChain`/`removeChain`/`setChain` rewrite the file; all persistence I/O is defensive (a failure warns, never breaks a command).
- The five chain commands (`addChain`/`removeChain`/`listChains`/`setChain`/`getChain`) are in `NODE_FREE_COMMANDS` **and** a `HELP_GROUPS` entry — `assertHelpGroupsCoverAll` fails startup if a registered command is ungrouped.
- Contract addresses come **only** from ocean.js `ConfigHelper` (via `getConfigFor`), using lowercase keys (`escrow`/`accessListFactory`/`oceanTokenAddress`). The old CLI-local `getConfigByChainId` is gone. Addresses resolve from `ADDRESS_FILE` (Barge/custom) else the bundled multi-chain set; a chain with no address for the needed contract errors via `requireAddress`.
- The 1-indexed vs 0-indexed args-array split between `Commands` methods is easy to get wrong when adding/renaming commands.
- Running the CLI without `AVOID_LOOP_RUN=true` drops into a stdin REPL after the first command — surprising in scripts.
- `fixAndParseProviderFees` is a regex JSON patcher for the initialize→start round trip; prefer fixing the data shape over extending the regex.
- A new command is refused when no node is set unless its canonical name is added to `NODE_FREE_COMMANDS` in `cli.ts`. The gate is a single root-level `preAction` hook keyed on `actionCommand.name()` (canonical, so aliases resolve for free) and throws a **plain `Error`, not a `CommanderError`** — that is what makes `index.ts` report it in red and keep the REPL alive, while one-shot mode exits 1.
- `supportedCommands` in `index.ts` uses `command.aliases()` (plural). The old `alias()` returned only the first alias, silently making extra aliases unreachable in the REPL.
