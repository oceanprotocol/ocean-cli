// src/publishAsset.ts
import { Signer } from 'ethers';
import {
  Config,
  Aquarius
} from '@oceanprotocol/lib';
import { Asset } from '@oceanprotocol/ddo-js';
import { createAssetUtil, updateAssetMetadata } from './helpers.js';

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
    const aquarius = new Aquarius(config.nodeUri);

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
        nft: {
          address: "",
          name: "Ocean Data NFT",
          symbol: "OCEAN-NFT",
          state: 5,
          tokenURI: "",
          owner: "",
          created: ""
        },
        event: undefined,
        purgatory: undefined,
        stats: [
        {
          orders: 0,
          prices: [{
            price: params.price,
            contract: '0x282d8efCe846A88B159800bd4130ad77443Fa1A1',
            token: params.token,
            type: params.isCharged === false ? 'dispenser' : 'fixedrate'
          }],
          datatokenAddress: '',
          name: 'access',
          serviceId: 'access',
          symbol: ''
      }
      ]
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
      ]
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