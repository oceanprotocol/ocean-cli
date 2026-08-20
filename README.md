[![banner](https://raw.githubusercontent.com/oceanprotocol/art/master/github/repo-banner%402x.png)](https://oceanprotocol.com)

<h1 align="center">Ocean CLI</h1>

> CLI tool to interact with the oceanprotocol's JavaScript library to privately & securely publish, consume and run compute on data.

[![npm](https://img.shields.io/npm/v/@oceanprotocol/lib.svg)](https://www.npmjs.com/package/@oceanprotocol/lib)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-7b1173.svg?style=flat-square)](https://github.com/prettier/prettier)
[![js oceanprotocol](https://img.shields.io/badge/js-oceanprotocol-7b1173.svg)](https://github.com/oceanprotocol/eslint-config-oceanprotocol)

With the Ocean CLI tool you can:

- **Publish** data services: downloadable files or compute-to-data.
- **Edit** existing assets.
- **Consume** data services, ordering datatokens and downloading data.
- **Compute to data** on public available datasets using a published algorithm.
- **Run on-demand services**: launch long-running containers (JupyterLab, inference servers, …) on compute environments, paid via escrow.
- **Manage access control** with access lists for restricting dataset/algorithm access.
- **Handle escrow payments** for compute jobs with deposit, withdrawal, and authorization.
- **Manage authentication** with token generation and invalidation.

Ocean CLI is using ocean.js JavaScript library which is part of the [Ocean Protocol](https://oceanprotocol.com) toolset.

If you run into problems, please open up a [new issue](https://github.com/oceanprotocol/ocean-cli/issues/new?assignees=&labels=Type%3A+Bug&projects=&template=bug_report.md&title=).

- [📚 Prerequisites](#-prerequisites)
- [🏗 Installation & Usage](#-installation--usage)
- [🏛 License](#-license)

## 📚 Prerequisites

- node.js ([Install from here](https://nodejs.org/en/download/))
- A Unix based operating system (Mac or Linux)

## 🏗 Installation & Usage

### Install globally (recommended)

Install the CLI from npm to get the `ocean-cli` command available everywhere:

```bash
npm install -g @oceanprotocol/cli
```

Then invoke it directly (from any directory):

```bash
ocean-cli h                 # list commands
ocean-cli --version
ocean-cli publish metadata/simpleDownloadDataset.json
```

> `ocean-cli --help`, `ocean-cli -h`, `ocean-cli --version` and `ocean-cli h` work with **no** environment variables set. Every other command requires the env vars described below.

### From source (for contributors)

Clone and install, then run the CLI straight from TypeScript with `npm run cli` (no build step needed):

```bash
git clone https://github.com/oceanprotocol/ocean-cli.git
cd ocean-cli
npm install
npm run cli h
```

> **The command examples in this README use the `npm run cli <command>` form. If you installed globally, drop the `npm run cli` prefix and use `ocean-cli <command>` instead — the two are otherwise identical.** In interactive mode you can paste either form; a leading `npm run cli` or `ocean-cli` token is stripped automatically.

### Set up environment variables

- Set a private key(by exporting env "PRIVATE_KEY") or a mnemonic (by exporting env "MNEMONIC")

```
export PRIVATE_KEY="XXXX"
```

or

```
export MNEMONIC="XXXX"
```

- Set an RPC

```
export RPC='XXXX'
```

- Optional (but recommended), set an Ocean Node URL. Ocean Nodes infrastructure is responsible for handling assets indexing and metadata caching. It replaced old Provider and Aquarius standalone apps.

```
export NODE_URL='XXXX'
```

  `NODE_URL` is the **initial** node only. If it is not set the CLI still starts, but **only `setNode`, `getNode` and `help` are available** — every other command is refused with `No Ocean Node set` until you pick a node:

```bash
npm run cli            # starts with no node
# > setNode http://127.0.0.1:8001
# > getComputeEnvironments        # now works
```

  You can switch node at any time with [`setNode`](#setnode) without restarting the CLI. See [`getNode`](#getnode) to check which node is active.

- Optional, set DISABLE_P2P to `'true'` to skip starting the libp2p transport. In interactive mode the CLI starts libp2p at startup (in the background, so it does not delay the prompt) even when `NODE_URL` is an HTTP URL, so that a later switch to a P2P node does not have to wait for bootstrap peers and DHT warm-up. One-shot runs (`AVOID_LOOP_RUN='true'`) skip that warm-up — they have no later command to benefit from it — and start libp2p only when the node they target is a P2P one. Set this when you only ever use HTTP nodes and do not want the CLI dialing the public Ocean bootstrap nodes.

```bash
export DISABLE_P2P='true'
```

- Optional, set ADDRESS_FILE if you want to use a custom set of smart contract address

```
export ADDRESS_FILE='path-to-address-file'
```

- Optional, set INDEXING_MAX_RETRIES to the max number of retries when waiting for an asset to be indexed. Default is 120 retries max.

```bash
export INDEXING_MAX_RETRIES='120'
```

- Optional, set INDEXING_RETRY_INTERVAL to the interval (in milliseconds) for each retry when waiting for an asset to be indexed. Default is 4 seconds (4000 ms).

```bash
export INDEXING_RETRY_INTERVAL='4000'
```

- Optional, set AVOID_LOOP_RUN to `'true'` to run a single command and exit afterwards (one-shot mode — required for CI and scripting). **By default the CLI is interactive**: it runs the command you pass (if any), then keeps reading further commands from a prompt, just like a REPL. Exit the interactive loop with `exit` / `quit`, the **ESC** key, or **CTRL-C**.

```bash
export AVOID_LOOP_RUN='true'   # one-shot; unset or 'false' = interactive loop
```

- Optional, set SSI_WALLET_API, SSI_WALLET_ID, SSI_WALLET_DID to support v5 DDOs (assets using credentialSubject and SSI policy flows).

```bash
export SSI_WALLET_API="https://your-ssi-wallet.example/api"
export SSI_WALLET_ID="did:example:your-wallet-did-or-id"
export SSI_WALLET_DID="did:example"
```



### Build the TypeScript code

```
npm run build
```

### Use

List available commands

```
npm run cli h
```

E.g. run publish command

Make sure to update chainId and serviceEndpoint from the assets from `metadata` folder.

```
npm run cli publish metadata/simpleDownloadDataset.json
```

### Command Usage

The Ocean CLI supports flexible argument ordering. You can supply arguments using:
- **Positional Arguments** (traditional style): Must follow the defined order.
- **Named Options**: Can be provided in any order. These options include flags like `--did`, `--file`, etc.

#### General Format

```bash
npm run cli <command> [options] <arguments>
```

#### Help Commands

- **General help:**  
  `npm run cli --help` or `npm run cli -h` (globally: `ocean-cli --help` / `ocean-cli -h`)

- **Version:**  
  `npm run cli --version` (globally: `ocean-cli --version`)

- **Command-specific help:**  
  `npm run cli help <command>`

#### Examples

**Choosing the Ocean Node:**

<a name="setnode"></a>

- **Switch node (works inside the interactive loop, no restart needed):**  
  `npm run cli setNode http://127.0.0.1:8001`  
  Also accepts a peer id or a full multiaddr, and `--node`:  
  `npm run cli setNode --node /dns4/node.example/tcp/9001/ws/p2p/16Uiu2HAm...`  
  Alias: `useNode`.

  The node is health-checked before the switch: if it cannot be reached, the current node is kept and nothing changes.

<a name="getnode"></a>

- **Show the node in use:**  
  `npm run cli getNode` (alias `currentNode`) — prints the active node plus its version and the chain(s) it serves.

Notes when switching nodes:

- **Compute jobs live on the node that started them.** After a switch, `getJobStatus` / `downloadJobResults` query the *new* node — switch back to look up older jobs.
- **For a node on your own machine, prefer the full multiaddr** (`/ip4/127.0.0.1/tcp/9001/ws/p2p/<peerId>`) over a bare peer id: a bare id has to be found via DHT, which may not advertise localhost addresses.
- **In one-shot mode** (`AVOID_LOOP_RUN='true'`) `setNode` only validates the node and prints the result — the switch dies with the process. Use `NODE_URL` for one-shot runs.
- `chainId` still comes from `RPC`, never from the node. `setNode` warns when the node does not serve the chain your RPC is on.

---

**Get DDO:**

- **Positional:**  
  `npm run cli getDDO did:op:123`

- **Named Option:**  
  `npm run cli getDDO --did did:op:123`

---

**Publish:**

- **Positional:**  
  `npm run cli publish metadata.json`

- **Named Options:**  
  `npm run cli publish --file metadata.json`  
  With encryption disabled:  
  `npm run cli publish --file metadata.json --encrypt false`  
  (Note: `--file` and `--encrypt` can be in any order.)

---

**Publish Algorithm:**

- **Positional:**  
  `npm run cli publishAlgo algorithm.json`

- **Named Options:**  
  `npm run cli publishAlgo --file algorithm.json`  
  With encryption disabled:  
  `npm run cli publishAlgo --encrypt false --file algorithm.json`

---

**Edit Asset:**

- **Positional:**  
  `npm run cli editAsset did:op:123 metadata.json`

- **Named Options:**  
  `npm run cli editAsset --did did:op:123 --file metadata.json`  
  (The flags can be provided in any order, for example:  
  `npm run cli editAsset --file metadata.json --did did:op:123`)

---

**Download:**

- **Positional:**  
  `npm run cli download did:op:123 ./custom-folder serviceId`

- **Named Options:**  
  `npm run cli download --did did:op:123 --folder ./custom-folder --service serviceId`
  (Order of `--did` and `--folder` does not matter.)

- **Rules:**
  serviceId is optional. If omitted, the CLI defaults to the first available download service.

---

**Start Compute:**

- **Positional:**  
  `npm run cli startCompute -- did1,did2 algoDid env1 maxJobDuration paymentToken resources svc1,svc2 algoServiceId`

- **Named Options:**  
  `npm run cli startCompute --datasets did1,did2 --algo algoDid --env env1 --maxJobDuration maxJobDuration --token paymentToken --resources resources --accept true --services svc1,svc2 --algo-service algoServiceId`
  (Options can be provided in any order.)

- **Rules:**
  serviceIds and algoServiceId are optional. If omitted, the CLI defaults to the first available service.


- `maxJobDuration` is a required parameter an represents the time measured in seconds for job maximum execution, the payment is based on this maxJobDuration value, user needs to provide this.
- `paymentToken` is required and represents the address of the token that is supported by the environment for processing the compute job payment. It can be retrieved from `getComputeEnvironments` command output.
- `resources` is required and represents a stringified JSON object obtained from `getComputeEnvironments` command output. `getComputeEnvironments` command shows the available resources and the selected resources by the user need to be within the available limits.
e.g.: `'[{"id":"cpu","amount":3},{"id":"ram","amount":16772672536},{"id":"disk","amount":0}]'`
-  `--accept` option can be set to `true` or `false`. If it is set to `false` a prompt will be displayed to the user for manual accepting the payment before starting a compute job. If it is set to `true`, the compute job starts automatically, without user input.
- `output` is an optional stringified JSON object specifying a remote storage backend where job results will be uploaded. Supported types include S3, FTP, URL, Arweave, and IPFS. If omitted, results are stored on the node's local disk. e.g.: `'{"remoteStorage":{"type":"s3","s3Access":{"endpoint":"https://s3.amazonaws.com","region":"us-east-1","bucket":"my-results","objectKey":"jobs/result.tar","accessKeyId":"AKIA...","secretAccessKey":"..."}}}'`

**Raw (unpublished) datasets and algorithms:**

Instead of a DID, you can pass a full `ComputeAsset` (datasets) or `ComputeAlgorithm` (algorithm) JSON object with a `fileObject`, to run compute on raw data/algorithms that are not published as assets. Raw entries have no DID and are not ordered (no datatoken). DID-based and raw entries can be mixed within the datasets argument (the value must then be valid JSON, with DIDs quoted). JSON must be single-quoted on the shell.

- Raw algorithm against a published dataset that allows raw algorithms (`allowRawAlgorithm: true`):  
  `npm run cli startCompute -- did:op:dataset '{"fileObject":{"type":"url","url":"https://example.com/algo.py","method":"GET"},"meta":{"container":{"entrypoint":"python $ALGO","image":"oceanprotocol/algo_dockers","tag":"python-branin","checksum":"sha256:..."}}}' env1 900 paymentToken resources --accept true`
- Raw dataset(s) against a published algorithm:  
  `npm run cli startCompute -- '[{"fileObject":{"type":"url","url":"https://example.com/data.csv","method":"GET"}}]' did:op:algo env1 900 paymentToken resources --accept true`
- Mixed datasets (a published DID and a raw file):  
  `npm run cli startCompute -- '["did:op:dataset",{"fileObject":{"type":"ipfs","hash":"Qm..."}}]' did:op:algo env1 900 paymentToken resources --accept true`

---

**Start Free Compute:**

- **Positional:**  
  `npm run cli startFreeCompute did1,did2 algoDid env1`

- **Named Options:**
  `npm run cli startFreeCompute --datasets did1,did2 --algo algoDid --env env1 --services svc1,svc2 --algo-service algoServiceId`
  (Options can be provided in any order.)

  - `output` is an optional stringified JSON object specifying a remote storage backend where job results will be uploaded. Same format as `startCompute`.

- **Rules:**
  serviceIds and algoServiceId are optional. If omitted, the CLI defaults to the first available service.`
  (Options can be provided in any order.)

- `output` is an optional stringified JSON object specifying a remote storage backend where job results will be uploaded. Same format as `startCompute`.
- Like `startCompute`, the datasets and algorithm arguments accept raw `ComputeAsset`/`ComputeAlgorithm` JSON objects with a `fileObject` (no DID), and mixed DID + raw datasets. e.g.:  
  `npm run cli startFreeCompute did:op:dataset '{"fileObject":{"type":"url","url":"https://example.com/algo.py","method":"GET"},"meta":{"container":{"entrypoint":"python $ALGO","image":"oceanprotocol/algo_dockers","tag":"python-branin","checksum":"sha256:..."}}}' env1`

---

**Stop Compute:**

- **Positional:**  
  `npm run cli stopCompute did:op:123 job-123`

- **Named Options:**  
  `npm run cli stopCompute --dataset did:op:123 --job job-123`  
  (Optionally, you can also provide an agreement ID using `--agreement`.)

---

**Get Compute Environments:**

  `npm run cli getComputeEnvironments`

  Optionally pass a specific Ocean Node URL or peer id to query instead of `NODE_URL`:

  `npm run cli getComputeEnvironments <nodeUrlOrPeerId>`

---

**Get Compute Streamable Logs:**

  `npm run cli computeStreamableLogs`

---

**Get Job Status:**

- **Positional:**  
  `npm run cli getJobStatus did:op:123 job-123`

- **Named Options:**  
  `npm run cli getJobStatus --dataset did:op:123 --job job-123`  
  (Optionally, an agreement ID may be provided.)

---

**Download Job Results:**

- **Positional:**  
  `npm run cli downloadJobResults job-123 0 ./results`

- **Named Options:**  
  `npm run cli downloadJobResults --job job-123 --index 0 --folder ./results`

---

### Service-on-Demand (long-running containers)

Launch a long-running container (JupyterLab, an inference server, nginx, …) on a
compute environment. Unlike a compute job — which runs an algorithm to completion
and exits — an on-demand service stays up until it **expires**, is **stopped**, or
is **extended**, and is reachable through a forwarded port (`http://<nodeHost>:<hostPort>`).

Full happy path:

```bash
# 1. Inspect the node's templates and which environments can run them
npm run cli getServiceTemplates

# 2. Fund escrow and authorize the environment's consumer address as payee
#    (maxLockSeconds must be at least duration + 3600)
npm run cli depositEscrow 0x<token> 100
npm run cli authorizeEscrow 0x<token> 0x<envConsumerAddress> 100 90000 100

# 3a. Start from an operator template
npm run cli -- startService <envId> 3600 0x<token> --template jupyter-cpu \
  --user-data '{"JUPYTER_TOKEN":"secret"}'

# 3b. …or bring your own image (pass the tag via --tag, NOT inside --image)
npm run cli -- startService <envId> 3600 0x<token> \
  --image nginxinc/nginx-unprivileged --tag alpine --ports 8080

# 4. Inspect / manage
npm run cli getServiceStatus <serviceId>          # YOUR services, full detail
npm run cli -- getServices --status 40            # ALL owners' running services on the node (SERVICES_LIST)
npm run cli -- serviceLogs <serviceId> --since 10m
npm run cli -- extendService <serviceId> 1800 --accept true
npm run cli -- restartService <serviceId>                               # REUSE: bounce container unchanged
npm run cli -- restartService <serviceId> --cmd '["python","app.py"]'   # optional cmd/entrypoint override
npm run cli -- restartService <serviceId> --image myrepo/algo --tag v2  # RESPEC: rebuild on a new image (#2119)
npm run cli stopService <serviceId>
```

Notes:

- **Duration is in seconds.** The CLI prints an **estimated** cost for the payment
  prompt; the **authoritative** cost is computed by the node and shown as
  `Node-computed cost:` right after start.
- **Start is asynchronous.** `startService` returns immediately with a `serviceId`
  in status `Starting (10)`; the CLI then polls until `Running (40)` (unless
  `--wait false`) and prints the endpoint URL. If polling is interrupted, resume
  with `getServiceStatus <serviceId>`.
- **Escrow must be funded and authorized before start.** Escrow shortfalls do not
  fail the HTTP call — they surface as the job ending in `Error`/`*Failed` — so the
  CLI pre-verifies funds/authorization client-side and aborts early with the exact
  remediation commands.
- **Image spec:** provide at most one of `--tag`, `--checksum`, `--dockerfile`, and
  keep the tag in `--tag` (an image reference that already contains a tag makes the
  node build an invalid `image:tag:latest` reference).
- **Ports:** containers run with `CapDrop ALL` and cannot bind ports below 1024 —
  services must listen on a high container port (e.g. 8080).
- **`--user-data`** is a plain JSON object of container env vars; ocean.js encrypts
  it to the node's key. The CLI **never logs its values** (keys only).
- **`getServiceStatus` vs `getServices`:** `getServiceStatus` shows *your* services
  with full detail; `getServices` (alias `listServices`, the SERVICES_LIST command)
  lists services across *all* owners on the node, with the docker image spec
  stripped, and supports `--status` / `--include-all` / `--from` filters.
- **`restartService` has two modes (#2119):** with **no** container-spec flags the
  container bounces on its stored spec (REUSE); supplying any image-spec flag
  (`--image`, `--tag`, `--checksum`, `--dockerfile`, `--additional-docker-files`)
  rebuilds the container on the new spec (RESPEC), keeping the same ports, expiry
  and payment window at no extra charge.
- **`restartService --cmd/--entrypoint`** replace the stored command/entrypoint on
  the recreated container (an empty array clears them); omit to reuse the stored
  configuration.

---

**Mint Ocean:**

- **Positional:**  
  `npm run cli mintOcean`  
  (No arguments are required for this command.)

---

**Generate Auth Token:**

  `npm run cli generateAuthToken`  
  (No arguments are required for this command.)

---

**Invalidate Auth Token:**

- **Positional:**  
  `npm run cli invalidateAuthToken myAuthToken123`

- **Named Option:**  
  `npm run cli invalidateAuthToken --token myAuthToken123`

---

**Deposit to Escrow:**

- **Positional:**  
  `npm run cli depositEscrow 0x1234...tokenAddress 100`

- **Named Options:**  
  `npm run cli depositEscrow --token 0x1234...tokenAddress --amount 100`

---

**Get User Funds in Escrow:**

- **Positional:**  
  `npm run cli getUserFundsEscrow 0x1234...tokenAddress`

- **Named Option:**  
  `npm run cli getUserFundsEscrow --token 0x1234...tokenAddress`

---

**Withdraw from Escrow:**

- **Positional:**  
  `npm run cli withdrawFromEscrow 0x1234...tokenAddress 50`

- **Named Options:**  
  `npm run cli withdrawFromEscrow --token 0x1234...tokenAddress --amount 50`

---

**Authorize Escrow Payee:**

- **Positional:**  
  `npm run cli authorizeEscrow 0x1234...tokenAddress 0x5678...payeeAddress 1000 3600 10`

- **Named Options:**  
  `npm run cli authorizeEscrow --token 0x1234...tokenAddress --payee 0x5678...payeeAddress --maxLockedAmount 1000 --maxLockSeconds 3600 --maxLockCounts 10`

- Arguments:
  - `token`: Address of the token to authorize
  - `payee`: Address of the payee to authorize
  - `maxLockedAmount`: Maximum amount that can be locked by payee
  - `maxLockSeconds`: Maximum lock duration in seconds
  - `maxLockCounts`: Maximum number of locks allowed

---

**Get Escrow Authorizations:**

- **Positional:**  
  `npm run cli getAuthorizationsEscrow 0x1234...tokenAddress 0x5678...payeeAddress`

- **Named Options:**  
  `npm run cli getAuthorizationsEscrow --token 0x1234...tokenAddress --payee 0x5678...payeeAddress`

---

**Create Access List:**

- **Positional:**  
  `npm run cli createAccessList "My Access List" "MAL" "0xUser1,0xUser2" false`

- **Named Options:**  
  `npm run cli createAccessList --name "My Access List" --symbol "MAL" --initial-users "0xUser1,0xUser2" --transferable false`

- Arguments:
  - `name`: Name for the access list
  - `symbol`: Symbol for the access list
  - `initialUsers`: Comma-separated list of initial user addresses (optional)
  - `transferable`: Whether tokens are transferable (true/false, optional, default: `false`)

---

**Add to Access List:**

- **Positional:**  
  `npm run cli addToAccessList 0x1234...accessListAddress "0xUser1,0xUser2"`

- **Named Options:**  
  `npm run cli addToAccessList --address 0x1234...accessListAddress --users "0xUser1,0xUser2"`

---

**Check Access List:**

- **Positional:**  
  `npm run cli checkAccessList 0x1234...accessListAddress "0xUser1,0xUser2"`

- **Named Options:**  
  `npm run cli checkAccessList --address 0x1234...accessListAddress --users "0xUser1,0xUser2"`

---

**Remove from Access List:**

- **Positional:**  
  `npm run cli removeFromAccessList 0x1234...accessListAddress "0xUser1,0xUser2"`

- **Named Options:**  
  `npm run cli removeFromAccessList --address 0x1234...accessListAddress --users "0xUser1,0xUser2"`

---

**Allow Algorithm on Dataset:**

- **Positional:**  
  `npm run cli allowAlgo did:op:dataset did:op:algo`

- **With named option:**  
  `npm run cli allowAlgo did:op:dataset did:op:algo --encrypt true`

- The dataset and algorithm DIDs are required positional arguments (`--dataset` / `--algo` may override them, but the positionals must still be supplied). `--encrypt` toggles DDO encryption (default: `true`).

- Approves an algorithm to run on a compute-enabled dataset (signer must be the dataset NFT owner).

---

**Create Bucket:**

  `npm run cli createBucket`

- Creates a new persistent-storage bucket on the node. Pass an access-list contract address to gate it; omit for owner-only access:

  `npm run cli createBucket 0x1234...accessListAddress`

---

**Add File to Bucket:**

  `npm run cli addFileToBucket <bucketId> ./path/to/file.csv`

- Optionally pass a name to store the file under (defaults to the file's basename):

  `npm run cli addFileToBucket <bucketId> ./path/to/file.csv results.csv`

---

**List Buckets:**

  `npm run cli listBuckets`

- Lists buckets owned by the signer, or by a specific owner:

  `npm run cli listBuckets --owner 0x1234...ownerAddress`

---

**List Files in Bucket:**

  `npm run cli listFilesInBucket <bucketId>`

---

**Get File Object:**

  `npm run cli getFileObject <bucketId> <fileName>`

- Returns the file-object descriptor for a file in a bucket.

---

**Delete File:**

  `npm run cli deleteFile <bucketId> <fileName>`

---

**Download Node Logs (admin):**

- **Positional:**  
  `npm run cli downloadNodeLogs ./logs 24`

- **Named Options:**  
  `npm run cli downloadNodeLogs --output ./logs --last 24`

- Downloads node logs into `<output>/logs.json`. Use either `last` (hours from now) **or** a `from`/`to` epoch-ms range. `maxLogs` caps the number of entries (default: 100, max: 1000). Requires admin privileges on the node.

---

#### Available Named Options Per Command

- **setNode** (alias `useNode`)**:**  
  `<nodeUrl>` (Positional. HTTP(S) URL, peer id or full multiaddr)  
  `-n, --node <nodeUrl>` (Same as the positional)

- **getNode** (alias `currentNode`)**:** no arguments

- **getDDO:**  
  `-d, --did <did>`

- **publish:**  
  `-f, --file <metadataFile>`  
  `-e, --encrypt [boolean]` (Default: `true`)

- **publishAlgo:**  
  `-f, --file <metadataFile>`  
  `-e, --encrypt [boolean]` (Default: `true`)

- **editAsset:**  
  `-d, --did <datasetDid>`  
  `-f, --file <metadataFile>`  
  `-e, --encrypt [boolean]` (Default: `true`)

- **download:**  
  `-d, --did <did>`  
  `-f, --folder [destinationFolder]` (Default: `.`)
  `-s, --service <serviceId>` (Optional, target a specific service)

- **allowAlgo:**  
  `-d, --dataset <datasetDid>`  
  `-a, --algo <algoDid>`  
  `-e, --encrypt [boolean]` (Default: `true`)


- **startCompute:**
  `-d, --datasets <datasetDids>`
  `-a, --algo <algoDid>`
  `-e, --env <computeEnvId>`
  `--init <initializeResponse>`
  `--maxJobDuration <maxJobDuration>`
  `-t, --token <paymentToken>`
  `--resources <resources>`
  `--amountToDeposit <amountToDeposit>` (Id `''`, it will fallback to initialize compute payment amount.)
  `-o, --output [output]` (Optional. Stringified JSON object specifying a remote storage backend for job results.)
  `-s, --services [serviceIds]` (Optional, comma-separated; must match datasetDids length, positional 1–1)
  `-x, --algo-service [algoServiceId]` (Optional, override algorithm service)

- **startFreeCompute:**  
  `-d, --datasets <datasetDids>`  
  `-a, --algo <algoDid>`  
  `-e, --env <computeEnvId>`
  `-o, --output [output]` (Optional. Stringified JSON object specifying a remote storage backend for job results.)
  `-s, --services [serviceIds]` (Optional, comma-separated; must match datasetDids length, positional 1–1)
  `-x, --algo-service [algoServiceId]` (Optional, override algorithm service)

- **getComputeEnvironments:**  
  `-n, --node [node]` (Optional. Ocean Node URL or peer id to query; defaults to `NODE_URL`)

- **computeStreamableLogs:**  

- **stopCompute:**  
  `-d, --dataset <datasetDid>`  
  `-j, --job <jobId>`  
  `-a, --agreement [agreementId]`

- **getJobStatus:**  
  `-d, --dataset <datasetDid>`  
  `-j, --job <jobId>`  
  `-a, --agreement [agreementId]`

- **downloadJobResults:**  
  `-j, --job <jobId>`  
  `-i, --index <index>`  
  `-f, --folder [destinationFolder]`

- **getServiceTemplates:** (alias `serviceTemplates`)  
  `[node]` (Optional positional. Ocean Node URL or peer id to query; defaults to `NODE_URL`)  
  `-n, --node <node>` (Optional. Same as the positional)

- **startService:**  
  `<computeEnvId>` `<duration>` (seconds) `<paymentToken>` (required positionals)  
  `--template <templateId>` (Start from an operator-published template)  
  `-i, --image <image>` (Container image — alternative to `--template`; keep the tag in `--tag`)  
  `--tag <tag>` / `--checksum <sha256>` / `--dockerfile <path>` (image spec — provide at most one)  
  `--additional-docker-files <path>` (JSON file of `{filename: content}`, used with `--dockerfile`)  
  `--cmd <json>` / `--entrypoint <json>` (Docker CMD/ENTRYPOINT override as JSON arrays)  
  `-p, --ports <ports>` (Comma-separated container ports, e.g. `8888,8080`)  
  `-r, --resources <resources>` (Stringified JSON `[{"id":"cpu","amount":1},…]`; defaults to template requirements)  
  `-u, --user-data <json>` / `--user-data-file <path>` (Container env vars; encrypted to the node, never logged)  
  `--accept [boolean]` (Auto-confirm payment)  
  `--wait [boolean]` (Poll until Running/failure; default `true`)  
  `--timeout <seconds>` (Max seconds to wait for Running; default 600)

- **getServiceStatus:** (alias `myServices`)  
  `[serviceId]` (Optional; omit to list all your services)  
  `-s, --service <serviceId>`  
  `-v, --verbose [boolean]` (Dump full job objects)

- **getServices:** (alias `listServices` — the SERVICES_LIST command, all owners)  
  `[node]` / `-n, --node <node>` (Optional Ocean Node URL or peer id; defaults to `NODE_URL`)  
  `--status <status>` (Filter by a single status number, e.g. `40` for Running)  
  `--include-all [boolean]` (Include all statuses, not just active reservations)  
  `--from <timestamp>` (Only services created at/after this ISO string or Unix timestamp)  
  `-v, --verbose [boolean]` (Dump full job objects)

- **serviceLogs:** (alias `computeServiceLogs`)  
  `<serviceId>` / `-s, --service <serviceId>`  
  `--since <since>` (Unix seconds or a relative duration like `30s` / `2h`)

- **extendService:**  
  `<serviceId>` `<additionalDuration>` (seconds) `[paymentToken]`  
  `-s, --service <serviceId>`  
  `--duration <additionalDuration>`  
  `-t, --token [paymentToken]` (defaults to the token used at start)  
  `--accept [boolean]` (Auto-confirm payment)

- **restartService:**  
  `<serviceId>`  
  `-u, --user-data <json>` / `--user-data-file <path>` (REPLACE stored env vars)  
  `--cmd <json>` / `--entrypoint <json>` (REPLACE stored Docker CMD/ENTRYPOINT; empty array clears)  
  `--image <image>` / `--tag <tag>` / `--checksum <checksum>` / `--dockerfile <dockerfile>` / `--additional-docker-files <json>` (RESPEC: rebuild the container on a new image spec; #2119)  
  `--wait [boolean]` (Poll until Running; default `true`)  
  `--timeout <seconds>` (Max seconds to wait; default 600)

- **stopService:**  
  `<serviceId>` / `-s, --service <serviceId>`

- **mintOcean:**  
  No options/arguments required.

- **generateAuthToken:**  
  No options/arguments required.

- **invalidateAuthToken:**  
  `-t, --token <token>`

- **depositEscrow:**  
  `-t, --token <token>`  
  `-a, --amount <amount>`

- **getUserFundsEscrow:**  
  `-t, --token <token>`

- **withdrawFromEscrow:**  
  `-t, --token <token>`  
  `-a, --amount <amount>`

- **authorizeEscrow:**  
  `-t, --token <token>`  
  `-p, --payee <payee>`  
  `-m, --maxLockedAmount <maxLockedAmount>`  
  `-s, --maxLockSeconds <maxLockSeconds>`  
  `-c, --maxLockCounts <maxLockCounts>`

- **getAuthorizationsEscrow:**  
  `-t, --token <token>`  
  `-p, --payee <payee>`

- **createAccessList:**  
  `-n, --name <name>`  
  `-s, --symbol <symbol>`  
  `-u, --initial-users [initialUsers]` (Default: `''`)  
  `-t, --transferable [transferable]` (Default: `false`)

- **addToAccessList:**  
  `-a, --address <accessListAddress>`  
  `-u, --users <users>`

- **checkAccessList:**  
  `-a, --address <accessListAddress>`  
  `-u, --users <users>`

- **removeFromAccessList:**  
  `-a, --address <accessListAddress>`  
  `-u, --users <users>`

- **createBucket:**  
  Positional only: `[accessListAddress]` (optional; omit for owner-only access)

- **addFileToBucket:**  
  Positional only: `<bucketId> <filePath> [fileName]`

- **listBuckets:**  
  `-o, --owner <address>` (Optional; defaults to signer)

- **listFilesInBucket:**  
  Positional only: `<bucketId>`

- **getFileObject:**  
  Positional only: `<bucketId> <fileName>`

- **deleteFile:**  
  Positional only: `<bucketId> <fileName>`

- **downloadNodeLogs:**  
  `-o, --output <output>`  
  `-l, --last [last]` (Hours from now; use either `last` or `from`/`to`)  
  `-f, --from [from]` (Start time, epoch ms)  
  `-t, --to [to]` (End time, epoch ms)  
  `-m, --maxLogs [maxLogs]` (Default: 100, max: 1000)

---

**Note:**  
- When using **named options**, you can write them in any order.  
- When relying on **positional arguments**, ensure they follow the exact order as defined by the command.

This flexible approach lets you use the style that best suits your workflow while remaining fully backwards compatible.

## 🏛 License

```
Copyright ((C)) 2025 Ocean Protocol Foundation

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
