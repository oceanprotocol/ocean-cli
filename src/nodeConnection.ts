import chalk from "chalk";
import { ProviderInstance, isP2pUri, NodeStatus } from "@oceanprotocol/lib";

/**
 * Ocean Node selection and libp2p transport lifecycle.
 *
 * The active node lives in `process.env.NODE_URL`, which stays the single source of
 * truth: `Commands` (its constructor) and `getMetadataURI()` re-read that variable on
 * every use, so mutating it switches every subsequent command with no other wiring.
 *
 * libp2p is *transport*, not a connection to one node: every P2P call in ocean.js takes
 * a `nodeUri` and dials that peer on demand (direct dial for a full multiaddr, DHT
 * lookup for a bare peer id). So one libp2p node serves any number of Ocean nodes and
 * switching between them never restarts or stops it.
 */

// Default Ocean bootstrap nodes (must be included explicitly since passing
// bootstrapPeers to setupP2P replaces the built-in defaults)
const OCEAN_BOOTSTRAP_PEERS = [
  "/dns4/bootstrap1.oncompute.ai/tcp/9001/ws/p2p/16Uiu2HAmLhRDqfufZiQnxvQs2XHhd6hwkLSPfjAQg1gH8wgRixiP",
  "/dns4/bootstrap2.oncompute.ai/tcp/9001/ws/p2p/16Uiu2HAmHwzeVw7RpGopjZe6qNBJbzDDBdqtrSk7Gcx1emYsfgL4",
  "/dns4/bootstrap3.oncompute.ai/tcp/9001/ws/p2p/16Uiu2HAmBKSeEP3v4tYEPsZsZv9VELinyMCsrVTJW9BvQeFXx28U",
  "/dns4/bootstrap4.oncompute.ai/tcp/9001/ws/p2p/16Uiu2HAmSTVTArioKm2wVcyeASHYEsnx2ZNq467Z4GMDU4ErEPom",
];

// A plain HTTP request to a node is quick; a P2P dial may need a DHT lookup first
// (ocean.js defaults dhtLookupTimeout to 60s), so it gets a longer leash.
const HTTP_STATUS_TIMEOUT_MS = 10_000;
const P2P_STATUS_TIMEOUT_MS = 30_000;

let p2pReady: Promise<void> | null = null;
let p2pFailure: Error | null = null;

function p2pDisabled(): boolean {
  return process.env.DISABLE_P2P === "true";
}

/** True when the given URI is a full multiaddr (as opposed to a bare peer id). */
function isFullMultiaddr(nodeUrl: string): boolean {
  return nodeUrl.startsWith("/") && nodeUrl.includes("/p2p/");
}

/**
 * Bootstrap peers for the libp2p node: the initial node (so a local node given as a
 * bare peer id is dialable via the localhost convention), any BOOTSTRAP_PEERS, and the
 * Ocean defaults.
 */
function buildBootstrapPeers(initialNodeUrl?: string): string[] {
  const extra = process.env.BOOTSTRAP_PEERS?.split(",").filter(Boolean) || [];
  const localPeer =
    initialNodeUrl && isP2pUri(initialNodeUrl)
      ? isFullMultiaddr(initialNodeUrl)
        ? [initialNodeUrl]
        : [`/ip4/127.0.0.1/tcp/9001/ws/p2p/${initialNodeUrl}`]
      : [];
  return [...localPeer, ...extra, ...OCEAN_BOOTSTRAP_PEERS];
}

/**
 * Start the shared libp2p node. Called once at startup and deliberately *not* awaited:
 * connecting to bootstrap peers and warming the DHT takes seconds, and that should
 * happen while the user reads the prompt rather than on their first P2P command. Any
 * P2P-bound path awaits `ensureP2PReady()` before dialing.
 *
 * No-op when DISABLE_P2P=true or when libp2p is already up.
 */
export function startP2P(initialNodeUrl?: string): void {
  if (p2pDisabled() || p2pReady) return;
  if (ProviderInstance.getLibp2pNode()) {
    p2pReady = Promise.resolve();
    return;
  }

  const bootstrapPeers = buildBootstrapPeers(initialNodeUrl);
  console.log(
    chalk.cyan(`Starting libp2p (${bootstrapPeers.length} bootstrap peers)...`)
  );

  // The promise is stored, not awaited, so it MUST swallow its own rejection here:
  // an unhandled rejection on a fire-and-forget promise would take the process down.
  // The failure is remembered and re-surfaced to whoever awaits ensureP2PReady().
  p2pReady = ProviderInstance.setupP2P({
    bootstrapPeers,
    libp2p: {
      connectionGater: {
        // Allow localhost connections / local nodes
        denyDialMultiaddr: () => false,
      },
    },
  } as any).then(
    () => {
      console.log(chalk.cyan("libp2p node started."));
    },
    (error) => {
      p2pFailure = error instanceof Error ? error : new Error(String(error));
      console.error(
        chalk.yellow(`libp2p failed to start: ${p2pFailure.message}`)
      );
    }
  );
}

/**
 * Await the shared libp2p node before making a P2P call. Throws with a clear reason
 * when P2P is unavailable, so callers can report it instead of timing out.
 */
export async function ensureP2PReady(): Promise<void> {
  if (p2pDisabled()) {
    throw new Error("P2P transport is disabled (DISABLE_P2P=true)");
  }
  // Pass the active node so a lazy start (one-shot run against a P2P node) still gets
  // the localhost multiaddr for a bare peer id in its bootstrap list — without it a
  // node on this machine could only be found through the DHT.
  if (!p2pReady) startP2P(getCurrentNodeUrl());
  await p2pReady;
  if (p2pFailure) {
    throw new Error(`libp2p is not running: ${p2pFailure.message}`);
  }
}

/**
 * Stop the shared libp2p node when the CLI is finished (see index.ts).
 *
 * Returns true when libp2p had been started, because stopping it is *not* enough to
 * let the process end: it leaves a `MessagePort` behind that keeps the event loop
 * alive even after a clean `stop()` (verified with `process.getActiveResourcesInfo()`
 * — `stop()` itself completes in ~2ms and reports status "stopped"). The caller must
 * therefore exit explicitly when this returns true.
 */
export async function stopP2P(waitForStartMs = 15_000): Promise<boolean> {
  const pending = p2pReady;
  p2pReady = null;
  if (!pending && !ProviderInstance.getLibp2pNode()) return false;

  if (pending) {
    // A start still in flight has no node to stop yet, and stopping "nothing" would
    // leave it to come up *after* cleanup and hold the process open forever. So wait
    // for it — but boundedly, since a start dialing unreachable bootstrap peers must
    // not stall exit. (startP2P's promise handles its own rejection, so this is safe
    // to await.)
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      pending,
      new Promise((resolve) => {
        timer = setTimeout(resolve, waitForStartMs);
      }),
    ]);
    clearTimeout(timer);
    // Belt and braces for the timed-out case: stop whatever the start eventually
    // produces, so a slow start delays exit instead of preventing it.
    pending
      .then(() => ProviderInstance.getLibp2pNode()?.stop())
      .catch(() => undefined);
  }

  const node = ProviderInstance.getLibp2pNode();
  if (node) {
    try {
      await node.stop();
    } catch (error) {
      // Shutting down is best effort — never turn it into a command failure.
      console.error(
        chalk.yellow(`libp2p did not stop cleanly: ${error?.message ?? error}`)
      );
    }
  }
  return true;
}

/** The active Ocean Node, or "" when none has been set yet. */
export function getCurrentNodeUrl(): string {
  return process.env.NODE_URL || "";
}

/** Make `nodeUrl` the active Ocean Node for every subsequent command. */
export function setCurrentNodeUrl(nodeUrl: string): void {
  process.env.NODE_URL = nodeUrl;
}

/** Whether a node is currently selected (gates most commands, see cli.ts). */
export function hasNode(): boolean {
  return getCurrentNodeUrl().length > 0;
}

/**
 * Health-check a candidate node without touching any existing state. Over HTTP this is
 * a plain status request; over P2P the on-demand dial *is* the reachability check.
 * Returns the node status (for display), or null when the node cannot be reached.
 */
export async function validateNode(
  nodeUrl: string
): Promise<NodeStatus | null> {
  try {
    let timeout = HTTP_STATUS_TIMEOUT_MS;
    if (isP2pUri(nodeUrl)) {
      await ensureP2PReady();
      timeout = P2P_STATUS_TIMEOUT_MS;
      if (!isFullMultiaddr(nodeUrl)) {
        console.log(chalk.cyan(`Looking up peer ${nodeUrl.slice(0, 12)}...`));
      }
    }
    const status = await ProviderInstance.getNodeStatus(
      nodeUrl,
      AbortSignal.timeout(timeout)
    );
    return status || null;
  } catch (error) {
    console.error(
      chalk.yellow(
        `Could not get status of ${nodeUrl}: ${error?.message ?? error}`
      )
    );
    return null;
  }
}

/** Chain ids the node serves, as reported by its status (provider + indexer). */
export function nodeChainIds(status: NodeStatus): string[] {
  const ids = [
    ...(status.provider || []).map((p) => String(p.chainId)),
    ...(status.indexer || []).map((i) => String(i.chainId)),
  ];
  return [...new Set(ids)];
}
