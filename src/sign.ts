import { base64url, importJWK, JWTPayload, jwtVerify, SignJWT } from "jose";
import axios from 'axios';
import { ethers } from "ethers";

async function verifyCredential(jws: string, issuerPublicKey: string) {
  const publicKeyBuffer = Buffer.from(issuerPublicKey.substring(2), "hex");
  const xBuffer = publicKeyBuffer.slice(1, 33);
  const yBuffer = publicKeyBuffer.slice(33, 65);

  const x = base64url.encode(xBuffer as any as Uint8Array);
  const y = base64url.encode(yBuffer as any as Uint8Array);

  // Construct the JWK for verification
  const publicJwk = {
    kty: "EC",
    crv: "secp256k1",
    x: x,
    y: y,
    alg: "ES256K",
    use: "sig",
  };

  const key = await importJWK(publicJwk, "ES256K");

  try {
    const { payload } = await jwtVerify(jws, key);
    console.log("JWT Verified passed");
    return payload;
  } catch (error) {
    console.error("Local verification failed:", error);
    throw error;
  }
}

//TODO still not working
// async function verifyCredentialWithWalt(jws: string) {
//   const waltIdVerifierApi = process.env.WALT_ID_VERIFIER_API || "http://localhost:7003/openid4vc/verify";
//   try {
//     const response = await axios.post(waltIdVerifierApi, { jws });
//     if (response.data.verified) {
//       console.log("JWT Verified by Walt:", response.data);
//       return response.data.payload;
//     } else {
//       throw new Error("JWT verification failed with Walt");
//     }
//   } catch (error) {
//     console.error("Error verifying with Walt:", error);
//     throw error;
//   }
// }

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
  const d = base64url.encode(privateKeyBuffer as any as Uint8Array);
  const x = base64url.encode(xBuffer as any as Uint8Array);
  const y = base64url.encode(yBuffer as any as Uint8Array);

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
  const header = { alg: "ES256K" }
  await verifyCredential(jws, publicKeyHex)

  return { jws, header, issuer: publicKeyHex }
}

async function signCredentialWithWalt(verifiableCredential) {
  const issuerKey = {
    "type": "jwk",
    "jwk": {
      "kty": process.env.ISSUER_KTY,
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
    const header = { alg: process.env.ISSUER_KTY }
    //await verifyCredentialWithWalt(jws)
    return { jws, header, issuer: issuerDid }
  } catch (error) {
    console.error('Error signing credential with Walt:', error);
    throw error;
  }
}



export async function signVC(vc) {
  console.log(process.env.SSI)
  if (process.env.SSI) {
    console.log("Signing with Walt.id...");
    return signCredentialWithWalt(vc)
  } else {
    console.log("Signing locally with keypair...");
    return signCredential(vc)
  }
}


