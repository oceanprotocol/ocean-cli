import { Signer, providers } from 'ethers';
import {
  Config,
  Aquarius,
  DDO,
} from '@oceanprotocol/lib';
import { createAsset, updateAssetMetadata } from './helpers'; // Import helper functions

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
    console.log('Publishing asset using helper functions...');

    const provider = signer.provider as providers.JsonRpcProvider;
    const aquarius = new Aquarius(config.metadataCacheUri);

    // Prepare initial metadata for the asset
    const metadata: DDO = {
      '@context': ['https://w3id.org/did/v1'],
      id: '', // Will be updated after creating asset
      version: '4.1.0',
      chainId: await provider.getNetwork().then(n => n.chainId),
      nftAddress: '0x0', // Will be updated after creating asset
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
          datatokenAddress: '0x0', // Will be updated after creating asset
          serviceEndpoint: params.providerUrl,
          timeout: 0,
        },
      ],
    };

    // Asset URL setup based on storage type
    const assetUrl = {
      nftAddress: '0x0', // Will be updated after creating asset
      datatokenAddress: '0x0', // Will be updated after creating asset
      files: [{ type: 'url', url: params.assetLocation, method: 'GET' }],
    };

    // Create the asset using the helper function
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

    // Update the metadata with the asset's DID
    metadata.id = did;
    metadata.nftAddress = assetUrl.nftAddress; // Update with the correct NFT address
    metadata.services[0].datatokenAddress = assetUrl.datatokenAddress; // Update with the correct Datatoken address

    // Use the helper function to update the metadata on the NFT
    await updateAssetMetadata(
      signer,
      metadata,
      params.providerUrl,
      aquarius
    );

    console.log(`Metadata successfully updated for DID: ${did}`);
  } catch (error) {
    console.error('Error publishing asset:', error);
  }
}
