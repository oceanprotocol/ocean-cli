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

- Optional set IPFS_API_KEY and IPFS_SECRET_API_KEY if you want to publish an asset v5.0.0

```
export IPFS_API_KEY='xxx'
export IPFS_SECRET_API_KEY='xxx'
```

- Optional set issuers env if you want to sign an asset v5.0.0 with waltId (SSI ON)
WALT_ID_ISSUER_API is api of waltId
```
export WALT_ID_ISSUER_API=
```
ISSUER_ID is the DID of the issuer
```
export ISSUER_iD=
```
ISSUER_KTY is the key type, for example OKP (Octet key pair)
```
export ISSUER_KTY=
```
ISSUER_KEY_D rapresents a parameter of private key in JWK - Private RSA JWK "dp" (First Factor CRT Exponent)
```
export ISSUER_KEY_D=
```
ISSUER_KEY_CRV is the cryptographic curve used like "Ed25519"
```
export ISSUER_KEY_CRV=
```
ISSUER_KEY_KID is the key id which helps systems identify which key to use when multiple keys might be available
```
export ISSUER_KEY_KID=
```
ISSUER_KEY_X is the public key used for verifying signatures
```
export ISSUER_KEY_X=
```
SSI indicated if should sign with waltId or with web3
```
export SSI=true
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
