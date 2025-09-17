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

Ocean CLI is using ocean.js Javascripti library which is part of the [Ocean Protocol](https://oceanprotocol.com) toolset.

If you run into problems, please open up a [new issue](https://github.com/oceanprotocol/ocean-cli/issues/new?assignees=&labels=Type%3A+Bug&projects=&template=bug_report.md&title=).

- [📚 Prerequisites](#-prerequisites)
- [🏗 Installation & Usage](#-installation--usage)
- [🏛 License](#-license)

## 📚 Prerequisites

- node.js ([Install from here](https://nodejs.org/en/download/))
- A Unix based operating system (Mac or Linux)

## 🏗 Installation & Usage

### Clone and install

```bash
$ git clone https://github.com/oceanprotocol/ocean-cli.git
npm install
```

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

- Mandatory, Set an Ocean Node URL. Ocean Nodes infrastructure is responsible for handling assets indexing and metadata caching. It replaced old Provider and Aquarius standalone apps.

```
export NODE_URL='XXXX'
```

- Optional, set ADDRESS_FILE if you want to use a custom set of smart contract address

```
export ADDRESS_FILE='path-to-address-file'
```

- Optional, set INDEXING_MAX_RETRIES to the max number of retries when waiting for an asset to be indexed. Default is 100 retries max.

```
export INDEXING_MAX_RETRIES='100'
```

- Optional, set INDEXING_RETRY_INTERVAL to the interval (in miliseconds) for each retry when waiting for an asset to be indexed. Default is 3 seconds.

```
export INDEXING_RETRY_INTERVAL='3000'
```

- Optional, set AVOID_LOOP_RUN to 'true' to run each command and exit afterwards (usefull for CI test env and default behaviour). IF not set or set to 'false' the CLI will listen interactively for commands, until exit is manually forced 

```
export AVOID_LOOP_RUN='true/false'
```

- Optional, set SSI_WALLET_API and SSI_WALLET_ID to support v5 DDOs (assets using credentialSubject and SSI policy flows).

```
export SSI_WALLET_API="https://your-ssi-wallet.example/api"
export SSI_WALLET_ID="did:example:your-wallet-did-or-id"
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

Make sure to update chainId and serviceEnpoint from the assets from `metadata` folder.

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
  `npm run cli --help` or `npm run cli -h`

- **Command-specific help:**  
  `npm run cli help <command>`

#### Examples

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
  `npm run cli startCompute --datasets did1,did2 --algo algoDid --env env1 --maxJobDuration maxJobDuration --token paymentToken --resources resources --accept true --services svc1,svc2 ----algo-service algoServiceId`  
  (Options can be provided in any order.)

- **Rules:**  
  serviceIds and algoServiceId are optional. If omitted, the CLI defaults to the first available service.


- `maxJobDuration` is a required parameter an represents the time measured in seconds for job maximum execution, the payment is based on this maxJobDuration value, user needs to provide this.
- `paymentToken` is required and represents the address of the token that is supported by the environment for processing the compute job payment. It can be retrieved from `getComputeEnvironments` command output.
- `resources` is required and represents a stringified JSON object obtained from `getComputeEnvironments` command output. `getComputeEnvironments` command shows the available resources and the selected resources by the user need to be within the available limits.
e.g.: `'[{"id":"cpu","amount":3},{"id":"ram","amount":16772672536},{"id":"disk","amount":0}]'`
-  `--accept` option can be set to `true` or `false`. If it is set to `false` a prompt will be displayed to the user for manual accepting the payment before starting a compute job. If it is set to `true`, the compute job starts automatically, without user input.

---

**Start Free Compute:**

- **Positional:**  
  `npm run cli startFreeCompute did1,did2 algoDid env1`

- **Named Options:**  
  `npm run cli startFreeCompute --datasets did1,did2 --algo algoDid --env env1 --services svc1,svc2 ----algo-service algoServiceId`  
  (Options can be provided in any order.)

- **Rules:**  
  serviceIds and algoServiceId are optional. If omitted, the CLI defaults to the first available service.`  
  (Options can be provided in any order.)

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

**Mint Ocean:**

- **Positional:**  
  `npm run cli mintOcean`  
  (No arguments are required for this command.)

---

#### Available Named Options Per Command

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


- **startCompute:**  
  `-d, --datasets <datasetDids>`  
  `-a, --algo <algoDid>`  
  `-e, --env <computeEnvId>`
  `--init <initializeResponse>`
  `--maxJobDuration <maxJobDuration>`
  `-t, --token <paymentToken>`
  `--resources <resources>`
  `--amountToDeposit <amountToDeposit>` (Id `''`, it will fallback to initialize compute payment amount.)
  `-s, --services [serviceIds]` (Optional, comma-separated; must match datasetDids length, positional 1–1)  
  `-x, --algo-service [algoServiceId]` (Optional, override algorithm service)

- **startFreeCompute:**  
  `-d, --datasets <datasetDids>`  
  `-a, --algo <algoDid>`  
  `-e, --env <computeEnvId>`
  `-s, --services [serviceIds]` (Optional, comma-separated; must match datasetDids length, positional 1–1)  
  `-x, --algo-service [algoServiceId]` (Optional, override algorithm service)

- **getComputeEnvironments:**  

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

- **mintOcean:**  
  No options/arguments required.

---

**Note:**  
- When using **named options**, you can write them in any order.  
- When relying on **positional arguments**, ensure they follow the exact order as defined by the command.

This flexible approach lets you use the style that best suits your workflow while remaining fully backwards compatible.

## 🏛 License

```
Copyright ((C)) 2023 Ocean Protocol Foundation

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
