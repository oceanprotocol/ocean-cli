import { Contract, Signer, getAddress, isCallException, isError } from "ethers";
import { EscrowContract } from "@oceanprotocol/lib";

type AbiEntry = {
  type?: string;
  name?: string;
  outputs?: { components?: { name?: string }[] }[];
  [key: string]: unknown;
};

/**
 * The escrow ABI as a legacy (pre-v2) deployment answers it: `getAuthorizations` returns the
 * six-field `auth` tuple, without the trailing `expiryTimestamp` Escrow v2 added. Decoding a
 * legacy reply with the seven-field ABI overruns the returned data and throws, so reads must
 * use this shape. Everything else is left as-is. Pure.
 */
export function legacyEscrowAbi<T>(abi: T[]): T[] {
  return abi.map((entry) => {
    const item = entry as AbiEntry;
    if (item?.type !== "function" || item.name !== "getAuthorizations") {
      return entry;
    }
    return {
      ...item,
      outputs: (item.outputs ?? []).map((out) => ({
        ...out,
        components: (out.components ?? []).filter(
          (c) => c.name !== "expiryTimestamp",
        ),
      })),
    } as T;
  });
}

/**
 * A legacy escrow is one with no on-chain `version()` (the call reverts or returns no data) or
 * one that reports version 1; Escrow v2 returns 2. Any other failure (RPC down, timeout) is NOT
 * taken as "legacy": decoding a v2 reply with the six-field ABI would silently misread it, so
 * when in doubt the current ABI is kept.
 */
export async function isLegacyEscrow(
  address: string,
  signer: Signer,
): Promise<boolean> {
  const probe = new Contract(
    address,
    ["function version() view returns (uint16)"],
    signer,
  );
  try {
    return Number(await probe.version()) < 2;
  } catch (error) {
    return isCallException(error) || isError(error, "BAD_DATA");
  }
}

const AUTH_FIELDS = [
  "payee",
  "maxLockedAmount",
  "currentLockedAmount",
  "maxLockSeconds",
  "maxLockCounts",
  "currentLocks",
] as const;

/**
 * A six-field legacy authorization in the v2 shape: the same values by index and by name,
 * plus `expiryTimestamp` = 0 (indefinite) as the seventh. Needed because an ethers `Result`
 * THROWS on an out-of-range index, so the usual `auth.expiryTimestamp ?? auth[6] ?? 0`
 * fallback (here and inside the lib's funds check) cannot be applied to the raw tuple. Pure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withIndefiniteExpiry(auth: any): any {
  const values: unknown[] = AUTH_FIELDS.map((_, i) => auth[i]);
  values.push(0n);
  const named: Record<string, unknown> = { expiryTimestamp: 0n };
  AUTH_FIELDS.forEach((name, i) => (named[name] = values[i]));
  return Object.assign(values, named);
}

class LegacyEscrowContract extends EscrowContract {
  async getAuthorizations(
    token: string,
    payer: string,
    payee: string,
  ): Promise<any[]> {
    const raw = await super.getAuthorizations(token, payer, payee);
    return Array.from(raw ?? []).map(withIndefiniteExpiry);
  }
}

const legacyByEscrow = new Map<string, Promise<boolean>>();

/**
 * An `EscrowContract` whose authorization reads decode with the ABI matching the deployed
 * escrow version: the six-field tuple for a legacy escrow, the lib's default ABI otherwise.
 * Legacy authorizations come back in the v2 shape with `expiryTimestamp` = 0, so every reader
 * (the CLI and the lib's own funds check) sees them as indefinite. The version probe is
 * cached per chain and address.
 */
export async function escrowContractFor(
  address: string,
  signer: Signer,
  chainId: number,
): Promise<EscrowContract> {
  const escrowAddress = getAddress(address);
  const escrow = new EscrowContract(escrowAddress, signer, chainId);
  const key = `${chainId}:${escrowAddress}`;
  let legacy = legacyByEscrow.get(key);
  if (!legacy) {
    legacy = isLegacyEscrow(escrowAddress, signer);
    legacyByEscrow.set(key, legacy);
  }
  if (!(await legacy)) return escrow;
  return new LegacyEscrowContract(
    escrowAddress,
    signer,
    chainId,
    undefined,
    legacyEscrowAbi(escrow.getDefaultAbi()),
  );
}
