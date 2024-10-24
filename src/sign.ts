import { base64url, importJWK, JWTPayload, SignJWT } from "jose";
import axios from 'axios';
import { ethers } from "ethers";

async function signCredential(verifiableCredential) {
  const privateKeyHex = process.env.PRIVATE_KEY;

  if (!privateKeyHex) {
    console.log("No Private Key found");
    return { jwt: null, method: null };
  }

  // Initialize wallet using ethers.js
  const wallet = new ethers.Wallet(privateKeyHex);

  // Get the private key as Buffer (strip '0x' prefix)
  const privateKeyBuffer = Buffer.from(privateKeyHex.substring(2), 'hex');

  // Get the uncompressed public key (strip '0x' prefix if necessary)
  const publicKeyHex = wallet._signingKey().publicKey;
  const publicKeyBuffer = Buffer.from(publicKeyHex.substring(2), 'hex');

  // Extract x and y coordinates from the public key buffer
  const xBuffer = publicKeyBuffer.slice(1, 33); // skip the 0x04 prefix
  const yBuffer = publicKeyBuffer.slice(33, 65);

  // Base64url-encode the values
  const d = base64url.encode(privateKeyBuffer);
  const x = base64url.encode(xBuffer);
  const y = base64url.encode(yBuffer);

  // Construct the JWK
  const privateJwk = {
    kty: 'EC',
    crv: 'secp256k1',
    d: d,
    x: x,
    y: y,
    alg: 'ES256K',
    use: 'sig',
  };

  const key = await importJWK(privateJwk, 'ES256K');

  const jws = await new SignJWT(verifiableCredential as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'ES256K' })
    .setIssuedAt()
    .setIssuer(publicKeyHex)
    .sign(key);

  return { jws, method: "key" }
}

async function signCredentialWithWalt(verifiableCredential) {
  const issuerKey = {
    "type": "jwk",
    "jwk": {
      "kty": "OKP",
      "d": process.env.ISSUER_KEY_D,
      "crv": process.env.ISSUER_KEY_CRV,
      "kid": process.env.ISSUER_KEY_KID,
      "x": process.env.ISSUER_KEY_X
    }
  };

  const issuerDid = process.env.ISSUER_ID
  const waltIdIssuerApi = process.env.WALT_ID_ISSUER_API || "http://localhost:7002/raw/jwt/sign"
  try {
    const response = await axios.post(waltIdIssuerApi, {
      credentialData: verifiableCredential,
      issuerDid: issuerDid,
      issuerKey: issuerKey,
      subjectDid: verifiableCredential.credentialSubject.id
    });
    const jws = response.data;
    return { jws, method: "waltId" }
  } catch (error) {
    console.error('Error signing credential with Walt:', error);
    throw error;
  }
}

export async function signVC(vc) {
  if (process.env.SSI) {
    console.log("Signing with Walt.id...");
    return signCredentialWithWalt(vc)
  } else {
    console.log("Signing locally with keypair...");
    return signCredential(vc)
  }
}


