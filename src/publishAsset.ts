// publishAsset.ts

import { Signer, providers, ethers } from 'ethers';
import {
  Config,
  Nft,
  NftFactory,
  DatatokenCreateParams,
  Aquarius,
  ProviderInstance,
  getEventFromTx,
  Files,
  DDO,
} from '@oceanprotocol/lib';

export interface PublishAssetParams {
  title: string;
  description: string;
  author: string;
  tags: string[];
  accessDuration: string;
  storageType: 'IPFS' | 'Arweave' | 'URL';
  assetLocation: string;
  isCharged: 'Paid' | 'Free';
  token?: 'OCEAN' | 'H2O';
  price?: string;
  network: 'Oasis Sapphire' | 'Ethereum' | 'Polygon';
  template?: string;
  providerUrl: string;
}

export async function publishAsset(params: PublishAssetParams, signer: Signer, config: Config) {
  // Load configuration
  const provider = signer.provider as providers.JsonRpcProvider;
  const aquarius = new Aquarius(config.metadataCacheUri);
  
  // Set the asset files information
  const assetFiles: Files = {
    nftAddress: '0x0',
    datatokenAddress: '0x0',
    files: [{ type: 'url', url: params.assetLocation, method: 'GET' }],
  };

  // Prepare metadata for the asset
  const metadata: DDO = {
    '@context': ['https://w3id.org/did/v1'],
    id: '',
    version: '4.1.0',
    chainId: await provider.getNetwork().then(n => n.chainId),
    nftAddress: '0x0',
    metadata: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      type: 'dataset',
      name: params.title,
      description: params.description,
      author: params.author,
      license: 'MIT',
      tags: params.tags,
      additionalInformation: {
        accessDuration: params.accessDuration,
        isCharged: params.isCharged,
        token: params.token,
        price: params.price,
      },
    },
    services: [
      {
        id: 'access',
        type: 'access',
        description: 'Access service',
        files: '',
        datatokenAddress: '0x0',
        serviceEndpoint: params.providerUrl,
        timeout: 0,
      },
    ],
  };

  // Create NFT and Datatoken
  const nftFactory = new NftFactory(config.erc721FactoryAddress, signer);
  const nftCreateData = {
    name: params.title,
    symbol: 'DATATOKEN',
    templateIndex: 1,
    tokenURI: '',
    transferable: true,
    owner: await signer.getAddress(),
  };

  const datatokenCreateParams: DatatokenCreateParams = {
    templateIndex: 1,
    cap: '100000',
    feeAmount: '0',
    paymentCollector: ethers.constants.AddressZero,
    feeToken: ethers.constants.AddressZero,
    minter: await signer.getAddress(),
    mpFeeAddress: ethers.constants.AddressZero,
  };

  const nftWithDatatoken = await nftFactory.createNftWithDatatoken(
    nftCreateData,
    datatokenCreateParams
  );
  const nftCreatedEvent = getEventFromTx(await nftWithDatatoken.wait(), 'NFTCreated');
  const datatokenCreatedEvent = getEventFromTx(await nftWithDatatoken.wait(), 'TokenCreated');

  // Set addresses in the asset files and metadata
  assetFiles.nftAddress = nftCreatedEvent.args.newTokenAddress;
  assetFiles.datatokenAddress = datatokenCreatedEvent.args.newTokenAddress;
  metadata.nftAddress = nftCreatedEvent.args.newTokenAddress;

  // Encrypt the files using provider
  metadata.services[0].files = await ProviderInstance.encrypt(
    assetFiles,
    metadata.chainId,
    params.providerUrl
  );

  // Validate metadata
  const validation = await aquarius.validate(metadata);
  if (!validation.valid) {
    throw new Error('Invalid asset metadata');
  }

  // Set metadata on the NFT
  const nft = new Nft(signer, metadata.chainId);
  await nft.setMetadata(
    metadata.nftAddress,
    await signer.getAddress(),
    0,
    params.providerUrl,
    '',
    ethers.utils.hexlify(2),
    metadata,
    validation.hash
  );

  console.log(`Asset published with DID: ${metadata.id}`);
}
