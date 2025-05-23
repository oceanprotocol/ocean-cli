// src/publishAsset.ts
import { Signer } from 'ethers';
import {
  Config,
  Aquarius,
} from '@oceanprotocol/lib';
import { createAssetUtil, updateAssetMetadata } from './helpers.js';
import { Asset } from '@oceanprotocol/ddo-js';

export interface PublishAssetParams {
  title: string;
  description: string;
  author: string;
  tags: string[];
  timeout: string;
  storageType: 'ipfs' | 'arweave' | 'url';
  assetLocation: string;
  isCharged: boolean;
  token?: 'OCEAN' | 'H2O';
  price?: string;
  chainId: number;
  template?: number;
  providerUrl: string;
}

export async function publishAsset(params: PublishAssetParams, signer: Signer, config: Config) {
  try {
    const aquarius = new Aquarius(config.oceanNodeUri);

    // Prepare initial metadata for the asset
    const metadata: Asset = {
      '@context': ['https://w3id.org/did/v1'],
      id: '', // Will be updated after creating asset
      version: '4.1.0',
      chainId: params.chainId,
      nftAddress: '0x0', // Will be updated after creating asset
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
      indexedMetadata: {
        stats: [{
          datatokenAddress: '0x0',
          name: 'Ocean Data NFT',
          symbol: 'OCEAN-NFT',
          serviceId: 'access',
          orders: 0,
          prices: [{
            type: 'fixedrate',
            contract: '0x0',
            price: params.isCharged ? Number(params.price).toString() : '0'
          }]
        }],
        nft: {
          address: "",
          name: "Ocean Data NFT",
          symbol: "OCEAN-NFT",
          state: 5,
          tokenURI: "",
          owner: "",
          created: ""
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
          timeout: Number(params.timeout),
        },
      ],
    };

    // Asset URL setup based on storage type
    const assetUrl = {
      nftAddress: '0x0', // Will be updated after creating asset
      datatokenAddress: '0x0', // Will be updated after creating asset
      files: [{ type: params.storageType, url: params.assetLocation, method: 'GET' }],
    };

    // Other networks
    const did = await createAssetUtil(
      params.title,
      'OCEAN-NFT',
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