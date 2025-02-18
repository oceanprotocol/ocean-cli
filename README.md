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

The CLI supports the following syntax:

```bash
# Basic command format
npm run cli <command> [options] <arguments>

# Help commands
npm run cli --help                # Show general help
npm run cli -h                    # Short form for help
npm run cli help                  # Alternative help command
npm run cli help <command>        # Show command-specific help

# Publishing Commands
npm run cli publish metadata.json                    # Publish with default encryption
npm run cli publish metadata.json --encrypt false    # Publish without encryption
npm run cli publish --encrypt false metadata.json    # Same result, different order

# Algorithm Commands
npm run cli publishAlgo algo.json                    # Publish algorithm
npm run cli publishAlgo --encrypt false algo.json    # Publish unencrypted algorithm

# Asset Management
npm run cli editAsset did:op:123 metadata.json                # Edit with default encryption
npm run cli editAsset --encrypt false did:op:123 metadata.json # Edit without encryption

# Download Commands
npm run cli download did:op:123                     # Download to current directory
npm run cli download did:op:123 ./custom-folder     # Download to specific folder

# Compute Commands
npm run cli startCompute did1,did2 algoDid env1     # Start compute job
npm run cli stopCompute did:op:123 job-123          # Stop compute job
npm run cli getJobStatus did:op:123 job-123         # Check job status

# Results Download
npm run cli downloadJobResults job-123 0             # Download to current directory
npm run cli downloadJobResults job-123 0 ./results   # Download to specific folder

# Token Management
npm run cli mintOcean                               # Mint test OCEAN tokens
```

### Available Options

Commands that support the `--encrypt` option:
- `publish`
- `publishAlgo`
- `editAsset`
- `allowAlgo`

**Note**: 
- Options (like `--encrypt`) can be placed anywhere in the command
- Required arguments must maintain their order
- Optional arguments (in square brackets) can be omitted

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
