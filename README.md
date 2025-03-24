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

- Set an Ocean Node URL

```
export NODE_URL='XXXX'
```

- Optional set metadataCache URL if you want to use a custom Aquarius version instead of the default one. This will not be used if you have set an Ocean Node url.

```
export AQUARIUS_URL='XXXX'
```

- Optional set Provider URL if you want to use a custom Provider version instead of the default one. This will not be used if you have set an Ocean Node url.

```
export PROVIDER_URL='XXXX'
```

- Optional set ADDRESS_FILE if you want to use a custom set of smart contract address

```
export ADDRESS_FILE='path-to-address-file'
```

- Optional set INDEXING_MAX_RETRIES to the max number of retries when waiting for an asset to be indexed. Default is 100 retries max.

```
export INDEXING_MAX_RETRIES='100'
```

- Optional set INDEXING_RETRY_INTERVAL to the interval (in miliseconds) for each retry when waiting for an asset to be indexed. Default is 3 seconds.

```
export INDEXING_RETRY_INTERVAL='3000'
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

Make sure to update chainId from the assets from `metadata` folder.

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
  `npm run cli download did:op:123 ./custom-folder`

- **Named Options:**  
  `npm run cli download --did did:op:123 --folder ./custom-folder`  
  (Order of `--did` and `--folder` does not matter.)

---

**Start Compute:**

- **Positional:**  
  `npm run cli startCompute did1,did2 algoDid env1`

- **Named Options:**  
  `npm run cli startCompute --datasets did1,did2 --algo algoDid --env env1`  
  (Options can be provided in any order.)

---

**Start Free Compute:**

- **Positional:**  
  `npm run cli startFreeCompute did1,did2 algoDid env1`

- **Named Options:**  
  `npm run cli startFreeCompute --datasets did1,did2 --algo algoDid --env env1`  
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

- **startCompute:**  
  `-d, --datasets <datasetDids>`  
  `-a, --algo <algoDid>`  
  `-e, --env <computeEnvId>`

- **startFreeCompute:**  
  `-d, --datasets <datasetDids>`  
  `-a, --algo <algoDid>`  
  `-e, --env <computeEnvId>`

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
