# Tests: accept enterprise `did:ope:` DIDs in DID-extraction regexes (DDO v5)

## Summary

Enterprise assets (DDO v5) mint DIDs with the prefix `did:ope:`, not the classic
`did:op:`. Several **system tests** extracted the published DID from CLI output with a
regex hardcoded to `did:op:`:

```
/did:op:[a-f0-9]{64}/
```

That pattern does **not** match a `did:ope:` DID — after `did:op` it requires a literal
`:`, so `did:ope:…` fails and `output.match(...)` returns `null`. Any flow that publishes
an enterprise/v5 asset and feeds its DID back into a later step (consume, compute, status)
would have the extraction fail or mis-assert, instead of exercising the v5 path.

This is **test-only**. The CLI's production code is already prefix-agnostic — non-JSON
tokens are passed through to the indexer untouched, and `resolveJobId` uses
`startsWith("did:")` — so no production behavior changes here.

## Changes

- **`test/util.ts`**
  - New shared `DID_RE = /did:ope?:[a-f0-9]{64}/` — the optional `e` matches **both**
    `did:op:` and `did:ope:`, so every test extracts DIDs from one definition.
  - New `DID_RE_ANCHORED = /^did:ope?:[a-f0-9]{64}$/` — anchored form for asserting a
    string is _exactly_ a DID.
  - Both carry a comment explaining the `ope?` trick and that, with no `g` flag,
    `String.prototype.match` is stateless so a single shared instance is safe to reuse.

- **`test/consumeFlow.test.ts`**
  - Switched the four `did:op:`-hardcoded extraction sites (download dataset, compute
    dataset, JS algo, python algo) to the shared `DID_RE`.
  - The existing "publish a dataset v5" case keeps its deliberate `/did:ope:[a-f0-9]{64}/`
    assertion (the point of that case is to confirm a v5 publish yields a `did:ope:` DID),
    but now **captures** that DID into `downloadDatasetV5Did`.
  - **New case** `getDDO ... for v5 download dataset`: round-trips the captured `did:ope:`
    DID through a later command, so the enterprise-DID path is exercised end-to-end rather
    than only pattern-matched. It uses `getDDO` (metadata resolution only) rather than
    `download`, because the bundled v5 fixture carries an `SSIpolicy` credential
    requirement — a full consume would block at the SSI/policy-server gate for reasons
    unrelated to the DID fix, making such a test flaky in CI.

- **`test/paidComputeFlow.test.ts`**
  - Switched the two `did:op:`-hardcoded extraction sites (compute dataset, JS algo) to the
    shared `DID_RE`. Imports `DID_RE` from `./util.js`.

- **`test/interactivePublishFlow.ts`**
  - Extraction regex → `DID_RE`; the anchored assertion
    (`expect(publishedDid).to.match(/^did:op:…$/)`) → `DID_RE_ANCHORED`. Imports both from
    `./util.js`.

## Out of scope / not changed

- **No production code changes.** Audit confirmed the CLI is already prefix-agnostic
  (`parseComputeInput`/`resolveComputeInputs` pass DID tokens through untouched;
  `resolveJobId` uses `startsWith("did:")`). The remaining `did:op` strings in `src`
  (`helpers.ts`, `cli.ts`) are only a comment and help-text examples.
- Literal `did:op:…` strings elsewhere in tests are deliberate fixtures/inputs, not
  output-extraction regexes, and were left as-is: the fake inputs in
  `resolveComputeInputs.test.ts`, the `getDDO did:op:123` error-path inputs in
  `setup.test.ts`, and the REPL inputs in `replMenu.test.ts`.

## Testing

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npm run lint` (changed files) — 0 errors; the only warnings are pre-existing
  `no-explicit-any` in test files (`util.ts` `catch (error: any)`, `paidComputeFlow.test.ts`
  `let resources: any`), none in the changed lines.
- The touched flows are Barge system tests (`consumeFlow`, `paidComputeFlow`,
  `interactivePublishFlow`) and were **not** run here (they need a running Ocean stack);
  they compile under `tsc`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
