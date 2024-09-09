import { Signer, providers } from 'ethers';
import {
  Config,
  Aquarius,
  DDO,
} from '@oceanprotocol/lib';
import { createAsset } from './helpers'; // Import the helper function

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
  try {
    console.log('Publishing asset using helper function...');

    const provider = signer.provider as providers.JsonRpcProvider;
    const aquarius = new Aquarius(config.metadataCacheUri);

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
        tags: params.tags
      },
      stats: {
        allocated: "0",
        orders: "0",
        price: {
          value: "0"
        }
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

    // Asset URL setup based on storage type
    const assetUrl = {
      nftAddress: '0x0',
      datatokenAddress: '0x0',
      files: [{ type: 'url', url: params.assetLocation, method: 'GET' }],
    };

    // Call the helper function to create the asset
    const did = await createAsset(
      params.title,
      'DATATOKEN', // Assuming a standard symbol for now
      signer,
      assetUrl,
      metadata,
      params.providerUrl,
      config,
      aquarius
    );

    console.log(`Asset successfully published with DID: ${did}`);
  } catch (error) {
    console.error('Error publishing asset:', error);
  }
}
