// src/publishAsset.ts
import { Signer, ethers } from 'ethers';
import {
  Config,
  Aquarius,
  DDO,
  Datatoken4
} from '@oceanprotocol/lib';
import { createAsset, createSapphireAsset, updateAssetMetadata } from './helpers';
import * as sapphire from '@oasisprotocol/sapphire-paratime';
import ERC20Template4 from '@oceanprotocol/contracts/artifacts/contracts/templates/ERC20Template4.sol/ERC20Template4.json';

export interface PublishAssetParams {
  title: string;
  description: string;
  author: string;
  tags: string[];
  timeout: number;
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
    console.log('Publishing asset using helper functions...');

    const aquarius = new Aquarius(config.metadataCacheUri);

    // Prepare initial metadata for the asset
    const metadata: DDO = {
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
      stats: {
        allocated: 0,
        orders: 0,
        price: {
          value: params.isCharged ? params.price : "0"
        }
      },
      services: [
        {
          id: 'access',
          type: 'access',
          description: 'Access service',
          files: '',
          datatokenAddress: '0x0', // Will be updated after creating asset
          serviceEndpoint: params.providerUrl,
          timeout: params.timeout,
        },
      ],
      nft: {
        address: "",
        name: "Ocean Data NFT",
        symbol: "OCEAN-NFT",
        state: 5,
        tokenURI: "",
        owner: "",
        created: ""
      }
    };

    // Asset URL setup based on storage type
    const assetUrl = {
      nftAddress: '0x0', // Will be updated after creating asset
      datatokenAddress: '0x0', // Will be updated after creating asset
      files: [{ type: params.storageType, url: params.assetLocation, method: 'GET' }],
    };

    let did: string;

    if (params.chainId === 23294) {
      // Oasis Sapphire
      console.log('Publishing to Oasis Sapphire network...');
      
      const wrappedSigner = sapphire.wrap(signer);
      
      const filesObject = [
        {
          url: params.assetLocation,
          contentType: 'text/plain', // Adjust this based on your asset type
          encoding: 'UTF-8'
        }
      ];

      const datatoken = new Datatoken4(
        wrappedSigner,
        ethers.utils.toUtf8Bytes(JSON.stringify(filesObject)),
        params.chainId,
        config,
        ERC20Template4.abi
      );

      did = await createSapphireAsset(
        params.title,
        'DATATOKEN', // Assuming a standard symbol for now
        wrappedSigner,
        assetUrl,
        metadata,
        params.providerUrl,
        config,
        aquarius,
        datatoken,
        params.template || 1
      );
    } else {
      // Other networks
      did = await createAsset(
        params.title,
        'DATATOKEN', // Assuming a standard symbol for now
        signer,
        assetUrl,
        metadata,
        params.providerUrl,
        config,
        aquarius,
        params.template || 1
      );
    }

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