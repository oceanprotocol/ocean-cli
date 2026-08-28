// Silence noisy Node process warnings emitted by transitive dependencies —
// notably punycode's `DeprecationWarning` (DEP0040) and the Ed25519 Web Crypto
// `ExperimentalWarning` — which fire asynchronously and would otherwise scroll
// the interactive REPL prompt out of view. Only these two low-signal categories
// are dropped; every other warning is still printed (in Node's default format).
//
// Every process warning — however it is emitted — is ultimately dispatched
// through the `'warning'` event, whose default listener is what prints it. So we
// remove that default listener and install our own filtering one. (Overriding
// `process.emitWarning` is not enough: core emits some warnings via a reference
// captured during bootstrap, before user code runs.)
//
// This module is imported FIRST in `src/index.ts`. ESM evaluates a module's
// imports in source order before its own body, so a side-effecting import placed
// before the others installs this hook before the dependency modules that
// trigger the warnings are evaluated.

const SILENCED = new Set(["DeprecationWarning", "ExperimentalWarning"]);

process.removeAllListeners("warning");

process.on("warning", (warning: Error & { code?: string }) => {
  if (SILENCED.has(warning.name)) return;
  // Reproduce Node's default one-line format for everything else.
  const code = warning.code ? ` [${warning.code}]` : "";
  console.error(
    `(node:${process.pid})${code} ${warning.stack ?? `${warning.name}: ${warning.message}`}`,
  );
});
