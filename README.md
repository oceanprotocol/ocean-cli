<div align="center">

[![banner](https://raw.githubusercontent.com/oceanprotocol/art/master/github/repo-banner%402x.png)](https://oceanprotocol.com)

# Ocean CLI

**Publish, consume and run compute on data from your terminal, privately and securely.**

[![npm](https://img.shields.io/npm/v/@oceanprotocol/cli.svg)](https://www.npmjs.com/package/@oceanprotocol/cli)
[![license](https://img.shields.io/npm/l/@oceanprotocol/cli.svg)](LICENSE)
[![node](https://img.shields.io/node/v/@oceanprotocol/cli.svg)](https://nodejs.org)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-7b1173.svg?style=flat-square)](https://github.com/prettier/prettier)

</div>

Ocean CLI is the command-line client for [Ocean Protocol](https://oceanprotocol.com). It talks to an **Ocean Node** (which handles indexing, metadata caching, encryption, ordering and compute) and to an EVM chain through an RPC endpoint. With it you can:

- **Publish and edit** data assets: downloadable files or compute-to-data.
- **Consume** assets: order datatokens and download data.
- **Run compute-to-data** (free or paid) on published datasets with a published or raw algorithm.
- **Run on-demand services**: long-running containers (JupyterLab, inference servers, ...) on compute environments, paid via escrow.
- **Manage escrow** payments, **access lists**, **persistent-storage buckets** and **auth tokens**.

Built on [`@oceanprotocol/lib`](https://github.com/oceanprotocol/ocean.js) (ocean.js `^9.0.0`) and [`@oceanprotocol/ddo-js`](https://github.com/oceanprotocol/ddo.js) (`^1.0.0`). Problems? Open a [new issue](https://github.com/oceanprotocol/ocean-cli/issues/new?assignees=&labels=Type%3A+Bug&projects=&template=bug_report.md&title=).

## Contents

[Requirements](#requirements) | [Install](#install) | [Quick start](#quick-start) | [Configuration](#configuration) | [How the CLI works](#how-the-cli-works) | [Nodes and chains](#nodes-and-chains) | [Command guide](#command-guide) | [Command reference](#command-reference) | [Sample metadata](#sample-metadata-files) | [Troubleshooting](#troubleshooting) | [Development](#development) | [License](#license)

## Requirements

- Node.js `>=22` ([download](https://nodejs.org/en/download/))
- Linux, macOS, or Windows via WSL
- An RPC endpoint for the chain you target
- A funded wallet (native gas token, plus datatokens / payment tokens as needed)
- An Ocean Node to talk to (HTTP(S) URL, libp2p peer id, or multiaddr)

## Install

```bash
npm install -g @oceanprotocol/cli
ocean-cli --version
ocean-cli h            # list all commands
```

`--help`, `-h`, `--version` and `h` work with no environment variables set. Every other command needs the configuration below. Contributors: see [Development](#development).

## Quick start

```bash
export PRIVATE_KEY="0x..."                  # or MNEMONIC="word1 word2 ..."
export RPC="https://your-rpc.example"
export NODE_URL="http://127.0.0.1:8001"

# Publish a sample asset (edit chainId / serviceEndpoint in the file first)
ocean-cli publish metadata/simpleDownloadDataset.json

# Download it (prints the DID on publish)
ocean-cli download did:op:123 ./downloads

# See where you can run compute
ocean-cli getComputeEnvironments
```

## Configuration

All configuration is via environment variables.

**Required**

| Variable | Description |
| --- | --- |
| `PRIVATE_KEY` or `MNEMONIC` | Signer credentials. The private key is preferred. |
| `RPC` | Either a single URL (`http://localhost:8545`) or a JSON map keyed by chainId whose values are a URL or an ordered list of URLs: `'{"1":"https://eth.example","8453":["https://a","https://b"]}'`. Two or more URLs for a chain become an ethers v6 `FallbackProvider` (`quorum: 1`, declaration order = preference). A malformed value fails at startup with the expected shape. |

**Recommended**

| Variable | Description |
| --- | --- |
| `NODE_URL` | The initial Ocean Node: HTTP(S) URL, libp2p peer id, or full multiaddr. The CLI starts without it, but then only `setNode`, `setNodeEnv`, `getNode`, `help`, `searchComputeResources` and the chain commands work; everything else fails with `No Ocean Node set` until you run `setNode`. (`searchComputeResources` runs node-free but still needs `RPC`, a signer and libp2p — it is a way to *find* a node before selecting one.) In practice, set it. |

**Optional**

| Variable | Default | Description |
| --- | --- | --- |
| `CHAIN_ID` | resolved automatically | Default (active) chain for the session. See [Nodes and chains](#nodes-and-chains). |
| `RPC_CONFIG_FILE` | `~/.ocean/cli/rpc.json` | Where runtime-added chains are persisted (same JSON-map shape, hand-editable). Env `RPC` is merged with it and **env wins** on conflict. |
| `ADDRESS_FILE` | ocean.js bundled addresses | Path to a contracts `address.json` for Barge / custom deployments. Without it, escrow, access-list and Ocean-token addresses come from the multi-chain set bundled with ocean.js. |
| `DISABLE_P2P` | unset | `true` skips libp2p. **Fatal at startup if combined with a P2P `NODE_URL`** (peer id / multiaddr). Use it only if you exclusively use HTTP nodes. `searchComputeResources` needs libp2p. |
| `BOOTSTRAP_PEERS` | unset | Comma-separated extra libp2p multiaddrs, added to the built-in Ocean bootstrap list. |
| `AVOID_LOOP_RUN` | unset | `true` = one-shot: run the command and exit (use for CI and scripts). Unset = interactive. |
| `INDEXING_MAX_RETRIES` | `120` | Max retries while waiting for an asset to be indexed. |
| `INDEXING_RETRY_INTERVAL` | `4000` | Milliseconds between indexing retries. |
| `SSI_WALLET_API`, `SSI_WALLET_ID`, `SSI_WALLET_DID` | unset | SSI wallet settings for v5 DDOs (credentialSubject / SSI policy flows). |

`mintOcean` additionally needs an Ocean token address, from the chain's configured `oceanTokenAddress` or `--token <address>` (some chains, e.g. Base, ship none).

## How the CLI works

- **Interactive vs one-shot.** By default the CLI runs the command you pass (if any) and then stays in a prompt (REPL). Leave with `exit`, `quit`, **ESC** or **CTRL-C**. In the prompt you can type the bare command or paste a full `ocean-cli ...` line. With `AVOID_LOOP_RUN=true` it runs once and exits. In one-shot mode `setNode` only validates; the switch dies with the process, so use `NODE_URL`.
- **Positional and named arguments.** Named options may come in any order and **override** the matching positional when both are given. But a **required** positional (`<x>`) must still be supplied positionally — passing only its named option fails with Commander's *missing required argument* (e.g. `publish --file metadata.json` errors; use `publish metadata.json`, and `publish metadata.json --file other.json` lets the option win). Optional positionals (`[x]`) may be omitted or supplied via their named option. A few commands (e.g. `downloadJobResults`) are positional-only.
- **JSON arguments.** Single-quote JSON on the shell and put `--` before the arguments so option parsing stops: `ocean-cli startCompute -- '["did:op:a",{"fileObject":{...}}]' did:op:algo ...`.
- **Help.** `ocean-cli h` or `ocean-cli help` prints the grouped command list (the `help` command takes no argument). For a specific command's arguments and options, add `--help` / `-h` after it: `ocean-cli publish --help`.

## Nodes and chains

**Choosing the node** (works inside the interactive prompt, no restart):

```bash
ocean-cli setNode http://127.0.0.1:8001      # alias useNode; also a peer id, multiaddr, or --node
ocean-cli getNode                            # alias currentNode: active node, version, chains served
ocean-cli setNodeEnv '16Uiu2HAm...|0xff10...-0xc92e...'   # alias useNodeEnv (quote: the token contains a '|')
```

`setNode` health-checks the node first; if unreachable, nothing changes. `setNodeEnv` takes the `Node+env:` token printed by `searchComputeResources`, switches node like `setNode` and remembers the compute env so `startCompute` / `startFreeCompute` need no `--env`. Notes:

- Compute jobs live on the node that started them; after a switch, `getJobStatus` / `downloadJobResults` query the new node.
- For a node on your own machine prefer the full multiaddr (`/ip4/127.0.0.1/tcp/9001/ws/p2p/<peerId>`); a bare peer id needs DHT lookup, which may not advertise localhost.
- `chainId` always comes from `RPC`, never from the node. `setNode` warns if the node does not serve your chain; `getNode` flags served chains with no RPC configured.

**Managing chains** (node-free; work before a node is set):

```bash
ocean-cli addChain 137 https://polygon-rpc.com [https://backup...]   # alias addRpc; each URL is verified
ocean-cli removeChain 137                                            # alias removeRpc
ocean-cli listChains                                                 # aliases getRpcs, chains
ocean-cli setChain 137                                               # alias useChain; persisted default
ocean-cli getChain                                                   # alias currentChain
```

Added chains persist to `~/.ocean/cli/rpc.json`. The active default chain is: `setChain` / `CHAIN_ID` -> persisted default -> the only configured chain. If none of those resolve, commands that target a specific chain require an explicit `--chainId`. (The display-only `listChains` additionally reports the single chain the node and your registry both know, but that intersection is not used to auto-select a chain for commands.)

**How each command picks its chain:**

| Category | Commands | Chain used |
| --- | --- | --- |
| Chain-agnostic | reads, jobs, storage, auth tokens, node/chain management | Default (or any registered) chain; node/chain management does not sign |
| DDO-implied | `publish`, `publishAlgo`, `editAsset`, `allowAlgo`, `download` | The DDO's own `chainId` |
| Explicit | `mintOcean`, all escrow, all access-list, `startService`, `extendService`, `startCompute`, `startFreeCompute` | `--chainId <id>`, else the default chain, else an error listing configured chains |

For `startCompute`, `--chainId` is the **payment/escrow** chain only; each asset is ordered on its own DDO chain, so one job can span chains. Every chain involved must be a registered RPC. For `startFreeCompute` it only selects the signing chain.

## Command guide

Each section shows the common usage; run `ocean-cli <command> --help` for every option, or see the [reference table](#command-reference).

### Assets

```bash
ocean-cli getDDO did:op:123                                  # or --did
ocean-cli publish metadata.json                              # or --file; add --encrypt false to skip DDO encryption
ocean-cli publishAlgo algorithm.json                         # same options as publish
ocean-cli editAsset did:op:123 metadata.json                 # alias edit; or --did / --file
ocean-cli download did:op:123 ./custom-folder [serviceId]    # or --did --folder --service
ocean-cli allowAlgo did:op:dataset did:op:algo               # dataset NFT owner only; --encrypt true|false
```

`download` defaults to `services[0]`; a `serviceId` not present in the DDO fails fast. For v5 DDOs (version >= 5.0.0) it first runs a provider-initialize step, and with `SSI_WALLET_API` set it performs the SSI / policy-server verification (skipped automatically when the node has no policy server).

### Compute

```bash
ocean-cli getComputeEnvironments [nodeUrlOrPeerId]           # alias getC2DEnvs; prints a payment summary per env
ocean-cli searchComputeResources --cpu 4 --ram 16 --paid --chain 8996 --order-by price   # alias findComputeNodes
ocean-cli startCompute --accept true -- did1,did2 algoDid env1 3600 0xPaymentToken '[{"id":"cpu","amount":1}]'
ocean-cli startFreeCompute did1,did2 algoDid env1
ocean-cli getJobStatus did:op:123 job-123                    # or --dataset --job [--agreement]
ocean-cli downloadJobResults job-123 0 ./results             # positional only (jobId, index, folder)
ocean-cli stopCompute did:op:123 job-123 <agreementId>       # agreementId is required
ocean-cli computeStreamableLogs <jobId>                      # or --job
```

`startCompute` details:

- `maxJobDuration` (seconds) is required and drives the payment.
- `paymentToken` is required: a token the environment accepts on the payment chain (see `getComputeEnvironments`).
- `resources` is required: stringified JSON within the environment's limits, e.g. `'[{"id":"cpu","amount":3},{"id":"ram","amount":16772672536},{"id":"disk","amount":0}]'`.
- `--accept true` auto-confirms payment (mandatory when stdin is not a TTY); `false` prompts.
- `--services` (comma-separated dataset service ids, mapped by position to the datasets) and `--algo-service` (the algorithm's service id) are optional; the first available service is used when omitted.
- `--output` is an optional stringified JSON remote-storage backend for results (S3, FTP, URL, Arweave, IPFS); omitted means results stay on the node's disk. Example: `'{"remoteStorage":{"type":"s3","s3Access":{"endpoint":"https://s3.amazonaws.com","region":"us-east-1","bucket":"my-results","objectKey":"jobs/result.tar","accessKeyId":"AKIA...","secretAccessKey":"..."}}}'`.
- `--subsidyProviders` optionally picks which subsidy providers back the escrow claim (see [Subsidy providers](#subsidy-providers)).

`startFreeCompute` takes the same dataset/algo/`--services`/`--algo-service`/`--output` arguments, targets a free environment and does no ordering or payment.

**Raw (unpublished) datasets and algorithms.** Instead of a DID, pass a full `ComputeAsset` (datasets) or `ComputeAlgorithm` JSON object with a `fileObject`. Raw entries have no DID and no datatoken order, and can be mixed with DIDs (the value must then be valid JSON, DIDs quoted). Works for both `startCompute` and `startFreeCompute`:

```bash
# Raw algorithm on a dataset that sets allowRawAlgorithm: true
ocean-cli startCompute --accept true -- did:op:dataset '{"fileObject":{"type":"url","url":"https://example.com/algo.py","method":"GET"},"meta":{"container":{"entrypoint":"python $ALGO","image":"oceanprotocol/algo_dockers","tag":"python-branin","checksum":"sha256:..."}}}' env1 900 paymentToken resources

# Raw dataset on a published algorithm
ocean-cli startCompute --accept true -- '[{"fileObject":{"type":"url","url":"https://example.com/data.csv","method":"GET"}}]' did:op:algo env1 900 paymentToken resources

# Mixed: published DID plus raw IPFS file
ocean-cli startCompute --accept true -- '["did:op:dataset",{"fileObject":{"type":"ipfs","hash":"Qm..."}}]' did:op:algo env1 900 paymentToken resources
```

**Finding a node.** `searchComputeResources` is a P2P/DHT search (needs libp2p, so not with `DISABLE_P2P=true`; works before `setNode`). Run it with no filters for an interactive wizard, or script it with flags: `--cpu --ram --disk --gpu --gpu-model --resource name:amount (repeatable) --free|--paid|--both --chain <ids> --token <addrs> --max-price --duration --order-by price|freeCapacity|resources|leastBusy`. `--chain` and `--token` take comma-separated lists; a paid env pricing on several requested chains is listed once per chain. Each match starts with a ready-to-run `setNodeEnv <node>|<env>` line. Environments that fall short of the request are filtered out, with a note on how many.

### Services on demand

An on-demand service is a long-running container that stays up until it expires, is stopped, or is extended, reachable at `http://<nodeHost>:<hostPort>`. Escrow must be funded and authorized first.

```bash
ocean-cli getServiceTemplates                              # alias serviceTemplates

# Fund escrow and authorize the env's consumer address (maxLockSeconds >= duration + 3600)
ocean-cli depositEscrow 0x<token> 100
ocean-cli authorizeEscrow 0x<token> 0x<envConsumerAddress> 100 90000 100

# From an operator template, or your own image (tag goes in --tag, not --image)
ocean-cli startService <envId> 3600 0x<token> --template jupyter-cpu --user-data '{"JUPYTER_TOKEN":"secret"}'
ocean-cli startService <envId> 3600 0x<token> --image nginxinc/nginx-unprivileged --tag alpine --ports 8080

ocean-cli getServiceStatus <serviceId>                     # alias myServices; YOUR services, full detail
ocean-cli getServices --status 40                          # alias listServices; ALL owners on the node
ocean-cli serviceLogs <serviceId> --since 10m              # alias computeServiceLogs
ocean-cli extendService <serviceId> 1800 --accept true
ocean-cli restartService <serviceId>                       # reuse stored spec
ocean-cli restartService <serviceId> --image myrepo/algo --tag v2   # rebuild on a new image
ocean-cli stopService <serviceId>
```

- Duration is in seconds. The CLI prints an estimated cost; the authoritative cost is shown as `Node-computed cost:` after start.
- Start is asynchronous: it returns a `serviceId` in status `Starting (10)`, then the CLI polls until `Running (40)` (unless `--wait false`; `--timeout` defaults to 600 s). If interrupted, resume with `getServiceStatus <serviceId>`.
- Escrow shortfalls do not fail the HTTP call; they surface as the job ending in `Error`. The CLI pre-verifies funds and authorization and aborts with the exact remediation commands.
- Image spec: at most one of `--tag`, `--checksum`, `--dockerfile`. Keep the tag out of `--image`, otherwise the node builds an invalid `image:tag:latest`.
- Containers run with `CapDrop ALL` and cannot bind ports below 1024; listen on a high port such as 8080.
- `--user-data` is a JSON object of container env vars, encrypted to the node's key. Values are never logged.
- `getServiceStatus` shows your services in full; `getServices` lists all owners' services with the image spec stripped and supports `--status`, `--include-all`, `--from`.
- `restartService` with no spec flags bounces the container unchanged (REUSE). Any of `--image --tag --checksum --dockerfile --additional-docker-files` rebuilds it on the new spec (RESPEC), keeping ports, expiry and payment window at no extra charge. `--cmd` / `--entrypoint` replace the stored command (empty array clears).

### Escrow

```bash
ocean-cli depositEscrow 0xToken 100                        # or --token --amount
ocean-cli getUserFundsEscrow 0xToken
ocean-cli withdrawFromEscrow 0xToken 50
ocean-cli authorizeEscrow 0xToken 0xPayee 1000 3600 10     # token payee maxLockedAmount maxLockSeconds maxLockCounts
ocean-cli getAuthorizationsEscrow 0xToken 0xPayee
ocean-cli getEscrowInfo [0xToken]                          # alias escrowInfo; read-only capability report
```

All accept `--chainId`. `authorizeEscrow` flags: `--token --payee --maxLockedAmount --maxLockSeconds --maxLockCounts`.

**Escrow v2.** The escrow contracts support **lock-time pre-funded sponsorship** (a subsidy provider can back part or all of a lock at creation, so a fully-sponsored user can transact with no deposit) and **authorization expiry** (a payee key can be time-boxed or revoked). The CLI reflects this:

- `authorizeEscrow` takes `-e, --expiry <unixSeconds>` (`0` = indefinite, default). Re-running it **overwrites** the record (renew/shorten), and an `--expiry` in the past **revokes** it; claim and cancel are never gated by expiry, so existing locks stay claimable. Example — revoke then re-grant for 1h: `ocean-cli authorizeEscrow 0xToken 0xPayee 1000 3600 10 --expiry 1` then `... --expiry $(( $(date +%s) + 3600 ))`.
- `getAuthorizationsEscrow` prints the authorization's `expiryTimestamp`, and `getEscrowInfo [token]` reports the escrow's capabilities (version, `escrowKind`, `IEscrowLockSubsidy`/`IEscrowEnterprise` support, `maxSponsorsPerLock`) via ERC-165, plus the sponsored-bucket total and your reclaimable amount when a token is given.
- Reading state: `getUserFunds().locked` and `Current Locked Amount` now count only the payer's **own** locked funds; provider-sponsored tokens live in a separate sponsored bucket (`getEscrowInfo <token>`).

These commands require the Escrow v2 deployment; they degrade gracefully against a legacy escrow.

### Subsidy providers

Subsidy providers are on-chain contracts that sponsor part or all of a job's cost (a subsidy released back to the payer, plus an optional bonus paid to the node), subject to allow-lists, job-type restrictions and per-period caps. **The Ocean Node is the source of truth for which subsidy providers are usable** (a node may not support them at all), so the CLI reads provider addresses from the node's status, never from bundled contract addresses.

```bash
ocean-cli getSubsidyProviders                              # alias subsidyProviders; per-chain providers the node advertises
ocean-cli getSubsidyStatus 0xToken                         # alias subsidyStatus; your limits / remaining credit
```

- `getSubsidyStatus` discovers the provider contract(s) from the node, then prints each one's kind, per-window buckets (limit / used / remaining / reset), claimable amount, contract balance and your eligibility. Flags: `--token --chainId --node --jobType --amount --subsidy 0xA[,0xB]`; `--node`/`--jobType`/`--amount` together also print a subsidy quote (`{subsidy, bonus}`).
- `startCompute`, `startService` and `extendService` take `--subsidyProviders <list>`: omit for the node's defaults, `none` (or empty) to claim with **no** subsidy, or `0xA,0xB` to claim against exactly those contracts. `startFreeCompute` ignores it (a free job does no escrow claim).

### Access lists

```bash
ocean-cli createAccessList "My Access List" "MAL" "0xUser1,0xUser2" false   # name symbol [initialUsers] [transferable, default false]
ocean-cli addToAccessList 0xListAddress "0xUser1,0xUser2"
ocean-cli checkAccessList 0xListAddress "0xUser1,0xUser2"
ocean-cli removeFromAccessList 0xListAddress "0xUser1,0xUser2"
```

Named forms: `--name --symbol --initial-users --transferable`, and `--address --users`. All accept `--chainId`.

### Persistent storage

```bash
ocean-cli createBucket [accessListAddress]                 # omit for owner-only access
ocean-cli addFileToBucket <bucketId> ./file.csv [fileName] # name defaults to the file's basename
ocean-cli listBuckets [--owner 0xOwner]                    # defaults to the signer
ocean-cli listFilesInBucket <bucketId>
ocean-cli getFileObject <bucketId> <fileName>              # file-object descriptor
ocean-cli deleteFile <bucketId> <fileName>
```

### Auth tokens

```bash
ocean-cli generateAuthToken
ocean-cli invalidateAuthToken myAuthToken123               # or --token
```

### Admin

```bash
ocean-cli downloadNodeLogs ./logs 24                       # or --output ./logs --last 24
```

Writes `<output>/logs.json`. Use either `--last` (hours from now) or `--from` / `--to` (epoch ms); `--maxLogs` defaults to 100 (max 1000). Requires admin privileges on the node.

### Development and testing helpers

```bash
ocean-cli mintOcean [--token 0xOcean] [--chainId 8996]     # mint test Ocean tokens (Barge / test chains)
```

## Command reference

53 commands, as registered in `src/cli.ts`. `<x>` is required, `[x]` optional. A named option **overrides** its positional when both are passed, but a required `<x>` must still be given positionally (passing only its option fails with *missing required argument* — this affects e.g. `publish`, `startCompute`, `startFreeCompute`); optional `[x]` positionals may instead be supplied as named options. Commands with no Options entry (e.g. `downloadJobResults`) are positional-only. `<command> --help` is authoritative.

| Command | Aliases | Arguments | Options |
| --- | --- | --- | --- |
| `help` | `h` | | |
| `setNode` | `useNode` | `<nodeUrl>` | `-n, --node` |
| `setNodeEnv` | `useNodeEnv` | `<nodeEnv>` | |
| `getNode` | `currentNode` | | |
| `addChain` | `addRpc` | `<chainId> [rpcUrl...]` | `-c, --chainId`, `-u, --url` |
| `removeChain` | `removeRpc` | `<chainId>` | `-c, --chainId` |
| `listChains` | `getRpcs`, `chains` | | |
| `setChain` | `useChain` | `<chainId>` | `-c, --chainId` |
| `getChain` | `currentChain` | | |
| `getDDO` | | `<did>` | `-d, --did` |
| `publish` | | `<file>` | `-f, --file`, `-e, --encrypt [bool]` (default true) |
| `publishAlgo` | | `<file>` | `-f, --file`, `-e, --encrypt [bool]` |
| `editAsset` | `edit` | `<did> <file>` | `-d, --did`, `-f, --file`, `-e, --encrypt [bool]` |
| `download` | | `<did> [folder] [serviceId]` | `-d, --did`, `-f, --folder` (default `.`), `-s, --service` |
| `allowAlgo` | | `<datasetDid> <algoDid>` | `-d, --dataset`, `-a, --algo`, `-e, --encrypt [bool]` |
| `startCompute` | | `[datasets] [algo] [env] [maxJobDuration] [paymentToken] [resources] [output] [serviceIds] [algoServiceId]` | `-d, --datasets`, `-a, --algo`, `-e, --env`, `--maxJobDuration`, `-t, --token`, `--resources`, `--chainId`, `--accept`, `-o, --output`, `-s, --services`, `-x, --algo-service`, `--subsidyProviders` |
| `startFreeCompute` | | `[datasets] [algo] [env] [output] [serviceIds] [algoServiceId]` | `-d, --datasets`, `-a, --algo`, `-e, --env`, `-o, --output`, `-s, --services`, `-x, --algo-service`, `--chainId` |
| `getComputeEnvironments` | `getC2DEnvs` | `[node]` | `-n, --node` |
| `searchComputeResources` | `findComputeNodes` | | `--cpu --ram --disk --gpu --gpu-model --resource --free --paid --both --chain --token --max-price --duration --order-by` |
| `computeStreamableLogs` | | `<jobId>` | `-j, --job` |
| `stopCompute` | | `<datasetDid> <jobId> <agreementId>` | `-d, --dataset`, `-j, --job`, `-a, --agreement` |
| `getJobStatus` | | `<datasetDid> <jobId> [agreementId]` | `-d, --dataset`, `-j, --job`, `-a, --agreement` |
| `downloadJobResults` | | `<jobId> <index> [folder]` | |
| `getServiceTemplates` | `serviceTemplates` | `[node]` | `-n, --node` |
| `startService` | | `<computeEnvId> <duration> <paymentToken>` | `--template`, `-i, --image`, `--tag`, `--checksum`, `--dockerfile`, `--additional-docker-files`, `--cmd`, `--entrypoint`, `-p, --ports`, `-r, --resources`, `-u, --user-data`, `--user-data-file`, `--accept`, `--wait`, `--timeout`, `--chainId`, `--subsidyProviders` |
| `getServiceStatus` | `myServices` | `[serviceId]` | `-s, --service`, `-v, --verbose` |
| `getServices` | `listServices` | `[node]` | `-n, --node`, `--status`, `--include-all`, `--from`, `-v, --verbose` |
| `serviceLogs` | `computeServiceLogs` | `<serviceId>` | `-s, --service`, `--since` |
| `extendService` | | `<serviceId> <additionalDuration> [paymentToken]` | `-s, --service`, `--duration`, `-t, --token`, `--accept`, `--chainId`, `--subsidyProviders` |
| `restartService` | | `<serviceId>` | `-u, --user-data`, `--user-data-file`, `--cmd`, `--entrypoint`, `--image`, `--tag`, `--checksum`, `--dockerfile`, `--additional-docker-files`, `--wait`, `--timeout` |
| `stopService` | | `<serviceId>` | `-s, --service` |
| `mintOcean` | | | `-t, --token`, `--chainId` |
| `generateAuthToken` | | | |
| `invalidateAuthToken` | | `<token>` | `-t, --token` |
| `depositEscrow` | | `<token> <amount>` | `-t, --token`, `-a, --amount`, `--chainId` |
| `getUserFundsEscrow` | | `<token>` | `-t, --token`, `--chainId` |
| `withdrawFromEscrow` | | `<token> <amount>` | `-t, --token`, `-a, --amount`, `--chainId` |
| `authorizeEscrow` | | `<token> <payee> <maxLockedAmount> <maxLockSeconds> <maxLockCounts>` | `-t, --token`, `-p, --payee`, `-m, --maxLockedAmount`, `-s, --maxLockSeconds`, `-c, --maxLockCounts`, `-e, --expiry`, `--chainId` |
| `getAuthorizationsEscrow` | | `<token> <payee>` | `-t, --token`, `-p, --payee`, `--chainId` |
| `getEscrowInfo` | `escrowInfo` | `[token]` | `-t, --token`, `--chainId` |
| `getSubsidyProviders` | `subsidyProviders` | | `--chainId` |
| `getSubsidyStatus` | `subsidyStatus` | `[token]` | `-t, --token`, `--chainId`, `-n, --node`, `--jobType`, `-a, --amount`, `--subsidy` |
| `createAccessList` | | `<name> <symbol> [initialUsers] [transferable]` | `-n, --name`, `-s, --symbol`, `-u, --initial-users`, `-t, --transferable`, `--chainId` |
| `addToAccessList` | | `<address> <users>` | `-a, --address`, `-u, --users`, `--chainId` |
| `checkAccessList` | | `<address> <users>` | `-a, --address`, `-u, --users`, `--chainId` |
| `removeFromAccessList` | | `<address> <users>` | `-a, --address`, `-u, --users`, `--chainId` |
| `createBucket` | | `[accessListAddress]` | |
| `addFileToBucket` | | `<bucketId> <filePath> [fileName]` | |
| `listBuckets` | | | `-o, --owner` |
| `listFilesInBucket` | | `<bucketId>` | |
| `getFileObject` | | `<bucketId> <fileName>` | |
| `deleteFile` | | `<bucketId> <fileName>` | |
| `downloadNodeLogs` | | `<output> [last] [from] [to]` | `-o, --output`, `-l, --last`, `-f, --from`, `-t, --to`, `-m, --maxLogs` |

## Sample metadata files

The [`metadata/`](metadata/) folder holds ready-to-publish DDOs. They default to chain `8996` (Barge); **edit `chainId` and `serviceEndpoint` to match your network before publishing.**

| File | DDO | What it is |
| --- | --- | --- |
| `simpleDownloadDataset.json` | v4.1.0 | Dataset with an `access` service (URL file); the basic publish + download example |
| `simpleDownloadDatasetV5.json` | v5.0.0 | Same, as a v5 DDO (credentialSubject / SSI flows; see `SSI_WALLET_*`) |
| `downloadAssetPaymentUSDC.json` | v4.1.0 | Download dataset priced in USDC instead of the default token |
| `simpleComputeDataset.json` | v4.1.0 | Dataset with a `compute` service (URL file) |
| `simpleIPFSComputeDataset.json` | v4.1.0 | Compute dataset whose file is stored on IPFS |
| `jsAlgo.json` | v4.1.0 | Node.js algorithm (URL file) for compute |
| `jsAlgoV5.json` | v5.0.0 | Node.js algorithm as a v5 DDO |
| `jsIPFSAlgo.json` | v4.1.0 | Node.js algorithm stored on IPFS |
| `pythonAlgo.json` | v4.1.0 | Python algorithm (`oceanprotocol/algo_dockers` image) |

## Troubleshooting

- **`No Ocean Node set`**: `NODE_URL` is unset. Export it, or run `setNode <url>` in the interactive prompt.
- **Node unreachable**: `setNode` keeps your current node when the health check fails. Check the URL/peer id and port; for a local P2P node use the full multiaddr. Over P2P a bare peer id can take up to 30 s (DHT lookup); HTTP times out at 10 s.
- **Fails at startup with a `DISABLE_P2P` message**: `DISABLE_P2P=true` and a P2P `NODE_URL` contradict each other. Unset one.
- **Wrong chain / `chainId` errors**: the chain must be a registered RPC. Run `listChains`, then `addChain <chainId> <rpcUrl>`. `getNode` shows which chains the node serves. Pass `--chainId` on chain-explicit commands, or set a default with `setChain`. For DDO-implied commands the chain is the DDO's `chainId`, so fix it in your metadata file.
- **Escrow shortfall / service ends in `Error`**: deposit and authorize before starting (`depositEscrow`, then `authorizeEscrow` with `maxLockSeconds >= duration + 3600`). `getUserFundsEscrow` and `getAuthorizationsEscrow` show the current state.
- **Asset not indexed yet**: the CLI waits up to `INDEXING_MAX_RETRIES` x `INDEXING_RETRY_INTERVAL` (default 120 x 4 s). Raise them for slow chains.
- **Script hangs after the command**: set `AVOID_LOOP_RUN=true` for one-shot runs.
- **`mintOcean` asks for `--token`**: the chain has no bundled Ocean token address.

## Development

```bash
git clone https://github.com/oceanprotocol/ocean-cli.git
cd ocean-cli
nvm use            # .nvmrc pins Node 22.23.1 (needed for lint and release tooling)
npm install
npm run cli h      # runs from TypeScript source via tsx, no build step; same as `ocean-cli h`
npm run build
```

`npm run cli <command>` is equivalent to `ocean-cli <command>`. Tests (`npm test`) are mostly end-to-end and need a running [Barge](https://github.com/oceanprotocol/barge) stack (RPC, Ocean Node, deployed contracts). Architecture notes and contributor guidance are in [`CLAUDE.md`](CLAUDE.md). Release history: [CHANGELOG.md](CHANGELOG.md).

## License

```
Copyright (C) 2026 Ocean Protocol Foundation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
