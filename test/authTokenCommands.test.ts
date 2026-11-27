import { expect } from "chai";
import { runRepl } from "./util.js";

/**
 * Infra-free CLI-level tests for the auth-token commands. They exercise command
 * registration (node-free vs node-gated, bootstrap env-free), the Commander
 * flag→option wiring, and the local decode path — none of which need a running
 * Ocean stack. The default runRepl env points NODE_URL/RPC at an unreachable
 * 127.0.0.1:1 (instant connection-refused) and disables P2P.
 *
 * NOTE: these run the real CLI, which imports @oceanprotocol/lib. They require
 * the v11 line that ships scoped auth tokens (decodeJwt / listScopableCommands);
 * under lib 10.1.0 the CLI fails to import, same gate as the whole feature.
 */
describe("Auth-token CLI commands (infra-free)", function () {
  this.timeout(60000);

  // A locally-built, UNSIGNED JWT (alg:none). decodeJwt only base64-decodes the
  // payload, so the signature is irrelevant for the decode path.
  const b64url = (o: unknown): string =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  // decodeJwt (jsonwebtoken) requires a string `address` claim; include it plus
  // the other base claims a real token carries.
  const makeJwt = (payload: Record<string, unknown>): string =>
    `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
      address: "0x1234567890123456789012345678901234567890",
      nonce: "1",
      createdAt: Date.now(),
      ...payload,
    })}.`;

  describe("listScopableCommands (node-free, bootstrap)", function () {
    it("runs with no node selected", async function () {
      const { output } = await runRepl(["listScopableCommands", "exit"], {
        env: { NODE_URL: undefined },
      });
      expect(output).to.match(/Scopable commands \(\d+\)/);
      expect(output).to.contain("download");
      expect(output).to.not.contain("no Ocean Node");
    });

    it("runs with no RPC/PRIVATE_KEY configured (alias scopableCommands)", async function () {
      // Driven through argv (how `ocean-cli scopableCommands` is really invoked) so the
      // credential-free startup skip applies: this pure command must run with no
      // MNEMONIC/PRIVATE_KEY/RPC at all.
      const { output } = await runRepl(["exit"], {
        extraArgs: ["scopableCommands"],
        env: { NODE_URL: undefined, RPC: undefined, PRIVATE_KEY: undefined },
      });
      expect(output).to.match(/Scopable commands \(\d+\)/);
      expect(output).to.not.contain("Have you forgot to set env RPC?");
    });
  });

  describe("decodeAuthToken (node-free, pure)", function () {
    it("decodes a token passed positionally and flags it unverified", async function () {
      const future = Date.now() + 3_600_000;
      const token = makeJwt({
        validUntil: future,
        audience: ["peerA"],
        scope: ["download"],
      });
      // Driven through argv so the credential-free startup skip applies — a local JWT
      // decode must work with no MNEMONIC/PRIVATE_KEY/RPC.
      const { output } = await runRepl(["exit"], {
        extraArgs: ["decodeAuthToken", token],
        env: { NODE_URL: undefined, RPC: undefined, PRIVATE_KEY: undefined },
      });
      expect(output).to.contain("download");
      expect(output).to.contain("signature NOT verified");
      expect(output).to.contain("Valid until:");
    });

    it("accepts --token and the decodeToken alias, and marks an expired token", async function () {
      const token = makeJwt({ validUntil: Date.now() - 1000 });
      const { output } = await runRepl(
        [`decodeToken --token ${token}`, "exit"],
        { env: { NODE_URL: undefined } },
      );
      expect(output).to.contain("(expired)");
    });

    it("errors when no token is given", async function () {
      const { output } = await runRepl(["decodeAuthToken", "exit"], {
        env: { NODE_URL: undefined },
      });
      expect(output).to.contain("An auth token is required");
    });

    it("reports an undecodable token and keeps the REPL alive", async function () {
      const { output } = await runRepl(
        ["decodeAuthToken not.a.jwt", "listScopableCommands", "exit"],
        { env: { NODE_URL: undefined } },
      );
      expect(output).to.contain("Could not decode the token");
      // The REPL survived the error and ran the next command.
      expect(output).to.match(/Scopable commands \(\d+\)/);
    });
  });

  describe("getNodeAuthTokenPolicy (node-gated)", function () {
    it("is refused when no node is selected", async function () {
      const { output } = await runRepl(["getNodeAuthTokenPolicy", "exit"], {
        env: { NODE_URL: undefined },
      });
      // Not in NODE_FREE_COMMANDS → the preAction gate refuses it with this exact
      // message. Asserting the specific text (not just "node", which the command
      // name itself contains) means an unknown-command error can't satisfy it.
      expect(output).to.contain("No Ocean Node set");
      expect(output).to.not.contain("Auth-token policy for");
    });
  });

  // NOTE: `generateAuthToken` / `getNodeAuthTokenPolicy` run `initializeSigner()`
  // first, which verifies the RPC against the chain — so they cannot be driven
  // past signer-init against the default dead RPC. The flag→option wiring and
  // the parse/validation rules are covered infra-free by
  // test/authTokenOptions.test.ts (parseAuthTokenOptions); the end-to-end mint
  // path (bare command, --ttl/--audience/--scope round-trips, over-cap error,
  // unrestricted warning) is a Barge integration follow-up needing a lib-v11
  // node.
});
