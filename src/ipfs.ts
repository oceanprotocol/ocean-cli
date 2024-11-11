import pinataSDK from '@pinata/sdk';

const ipfsApiKey = process.env.IPFS_API_KEY;
const ipfsSecretApiKey = process.env.IPFS_SECRET_API_KEY;
export async function uploadToIPFS(data: any): Promise<string> {
  try {
    if (!(ipfsApiKey && ipfsSecretApiKey)) {
      console.error("ERROR: SET IPFS_API_KEY and IPFS_SECRET_API_KEY");
    }
    const pinata = new pinataSDK(ipfsApiKey, ipfsSecretApiKey);
    const result = await pinata.pinJSONToIPFS(data);
    return result.IpfsHash; // This is the IPFS CID
  } catch (error) {
    console.log("error:", error)
    throw new Error('Failed to upload data to Pinata');
  }
}
