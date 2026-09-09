#!/usr/bin/env node
import "./warnings.js";
import { Command, CommanderError } from "commander";
import chalk from "chalk";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "readline/promises";
import { createCLI, formatGroupedHelp } from "./cli.js";
import { stopP2P } from "./nodeConnection.js";

let program: Command;
const supportedCommands: string[] = [];

/**
 * Prepare commander for REPL use: make it throw instead of calling process.exit
 * on errors / help / version, and colorize its own error output (e.g. "missing
 * required argument"). Both must be applied to every subcommand, not just the
 * root program: a subcommand parse error is raised and written by the subcommand
 * itself, which would otherwise kill the REPL and print an uncolored message.
 */
function configureForLoop(cmd: Command): void {
  cmd.exitOverride();
  cmd.configureOutput({
    outputError: (str, write) => write(chalk.red(str)),
  });
  for (const sub of cmd.commands) configureForLoop(sub);
}

/**
 * Split a command line into tokens while honoring single/double quotes, so that
 * JSON arguments (e.g. startCompute resources/datasets) survive intact. Runs of
 * whitespace collapse and produce no empty tokens.
 */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let hasContent = false;

  for (const ch of line) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
    } else if (ch === " " || ch === "\t") {
      if (hasContent) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
    } else {
      current += ch;
      hasContent = true;
    }
  }
  if (hasContent) tokens.push(current);
  return tokens;
}

/**
 * Strip an optional leading `npm run cli` or `ocean-cli` prefix so that a pasted
 * example command (from either the contributor docs or the global-install docs)
 * behaves identically to the bare command form.
 */
function stripNpmPrefix(tokens: string[]): string[] {
  if (tokens[0] === "npm" && tokens[1] === "run" && tokens[2] === "cli") {
    return tokens.slice(3);
  }
  if (tokens[0] === "ocean-cli") {
    return tokens.slice(1);
  }
  return tokens;
}

/**
 * Run a single already-tokenized command through commander. `from: 'user'`
 * tells commander the tokens are raw user args (no node/script prefix), so bare
 * start and initial-command start behave identically. Errors never terminate the
 * REPL: commander parse errors / help / version already write their own output,
 * so only unexpected runtime (action) errors are surfaced here.
 */
async function runTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;

  // Let commander handle option-style tokens (e.g. --help, --version); only
  // reject unknown command names.
  const commandName = tokens[0];
  if (
    !commandName.startsWith("-") &&
    !supportedCommands.includes(commandName)
  ) {
    console.log(
      chalk.red(
        `Invalid option: ${commandName}. Type 'help' to see the available commands.`,
      ),
    );
    return;
  }

  try {
    await program.parseAsync(tokens, { from: "user" });
  } catch (error) {
    // CommanderError (missing/excess args, unknown option, help, version) is
    // already reported by commander itself — don't double-print it.
    if (!(error instanceof CommanderError)) {
      console.error(chalk.red(`Command error: ${error?.message ?? error}`));
    }
  }
}

const PROMPT =
  "Enter command ('exit' | 'quit' | ESC or CTRL-C to terminate):\n";

/**
 * Discard whatever the user typed while a command was running and no prompt was visible.
 *
 * A command can run for a long time (a DHT search, a chain call, an interactive enquirer
 * wizard), during which the REPL's readline is paused and the terminal buffers every
 * keystroke. Left in place, that blind type-ahead is delivered to the REPL the moment it
 * resumes — so an impatient key-mash, an up-arrow+enter recalling the previous command, or a
 * line an enquirer wizard fed back re-runs a command the user never meant to submit (e.g.
 * re-launching the search wizard). Draining first makes every command one the user actually
 * saw the prompt for and typed.
 *
 * Must be async: on a TTY, buffered input is delivered through asynchronous `data` events, not
 * synchronous `read()` — a `read()` loop returns null and drains nothing. So we briefly put
 * the stream in flowing mode, swallow whatever `data` arrives, then pause again.
 *
 * TTY-only: piped stdin (tests, scripts) is never drained, so scripted input is untouched.
 */
const INPUT_FLUSH_MS = 80;
async function discardBufferedInput(): Promise<void> {
  if (!input.isTTY) return;
  await new Promise<void>((resolve) => {
    const onData = (): void => {
      /* swallow buffered keystrokes */
    };
    input.on("data", onData);
    input.resume();
    setTimeout(() => {
      input.pause();
      input.off("data", onData);
      resolve();
    }, INPUT_FLUSH_MS);
  });
}

/**
 * Tab-completion for the command name (the first token only). readline completes
 * to the longest common prefix of the matches, or lists them when there is more
 * than one. Returns all known commands when the line is still empty.
 */
function completer(line: string): [string[], string] {
  // Only complete the command name, not its arguments.
  if (line.includes(" ")) return [[], line];
  const hits = supportedCommands.filter((name) => name.startsWith(line)).sort();
  return [hits, line];
}

/**
 * Read commands from stdin until the user exits or input is exhausted (EOF).
 *
 * Two shapes, because an interactive terminal and a pipe have opposite needs:
 *
 * - Interactive (TTY): a fresh readline interface per prompt, fully closed around command
 *   execution. This matters because a command may open its OWN stdin reader — notably the
 *   enquirer search wizard — and a persistent readline keeps its `data`/`keypress` listeners
 *   attached even when paused, so it competes for keystrokes and captures blind type-ahead (or
 *   a line the wizard fed back) into its queue, which then replays as a command. Closing it
 *   first gives the command exclusive stdin; the async flush after runs with no reader
 *   attached, so anything typed blind is actually discarded instead of re-run.
 * - Piped (scripts/tests): a single persistent interface consumed via its async iterator, so
 *   backpressure is respected and no buffered line is dropped — recreating per prompt would
 *   silently discard piped input beyond the first line. No drain (there is no blind wait).
 */
async function runLoop(): Promise<void> {
  if (input.isTTY) {
    await runInteractiveLoop();
  } else {
    await runPipedLoop();
  }
}

/** REPL for an interactive terminal. See runLoop for why the interface is recreated per line. */
async function runInteractiveLoop(): Promise<void> {
  // Drop any type-ahead buffered while the initial argv command ran (before any readline
  // existed), so a blind key-mash during a slow first command doesn't replay as a command.
  await discardBufferedInput();

  // Command history is carried across prompts even though the interface is recreated each
  // time: readline references (does not copy) this array as its history and mutates it in
  // place on each committed line, so passing the same array back preserves ↑/↓ recall.
  let history: string[] = [];

  for (;;) {
    const rl = createInterface({ input, output, completer, history });
    // Escape exits the REPL (Ctrl-C terminates via SIGINT; `exit`/`quit`/`\q`/EOF also work).
    const onKeypress = (_str: string, key?: { name?: string }): void => {
      if (key?.name === "escape") {
        output.write("\n");
        rl.close();
      }
    };
    input.on("keypress", onKeypress);
    rl.setPrompt(PROMPT);
    rl.prompt();

    // Resolve on the first line, or null when the interface closes (EOF or Escape).
    const rawLine = await new Promise<string | null>((resolve) => {
      rl.once("line", (l) => resolve(l));
      rl.once("close", () => resolve(null));
    });
    // Re-capture the history array in case readline swapped in a new one (it normally mutates
    // the passed array in place, but this keeps recall correct regardless).
    history = (rl as unknown as { history?: string[] }).history ?? history;
    input.off("keypress", onKeypress);
    rl.close();

    if (rawLine === null) break; // EOF or Escape
    const line = rawLine.trim();
    if (line === "quit" || line === "exit" || line === "\\q") break;
    if (line === "") continue;

    const tokens = stripNpmPrefix(tokenize(line));
    // The interface is closed, so a command's own prompt (the enquirer wizard) and the flush
    // below both get exclusive, un-intercepted stdin.
    await runTokens(tokens);
    await discardBufferedInput();
  }
}

/** REPL for piped stdin (scripts/tests). Persistent interface; see runLoop. */
async function runPipedLoop(): Promise<void> {
  const rl = createInterface({ input, output, completer });
  rl.setPrompt(PROMPT);
  rl.prompt();
  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (line === "quit" || line === "exit" || line === "\\q") break;
      if (line === "") {
        rl.prompt();
        continue;
      }
      const tokens = stripNpmPrefix(tokenize(line));
      rl.pause();
      await runTokens(tokens);
      rl.resume();
      rl.prompt();
    }
  } finally {
    rl.close();
  }
}

/**
 * Wait until everything written to stdout/stderr has actually been handed over, so a
 * forced process.exit() cannot truncate it. Writing an empty chunk queues the callback
 * behind any pending writes on the stream.
 */
async function flushOutput(): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.writableLength === 0) return resolve();
          stream.write("", () => resolve());
        }),
    ),
  );
}

async function main(): Promise<void> {
  try {
    program = await createCLI();
    for (const command of program.commands) {
      supportedCommands.push(command.name());
      // aliases() (plural): alias() would only ever return the first one.
      const aliases = command.aliases();
      supportedCommands.push(...aliases);
    }

    // Handle help/version flags without initializing a signer, and exit so
    // they print once and never drop into the REPL below. createCLI() already
    // skips env validation for these invocations. The bare positional forms
    // `help`/`h` are treated the same as `--help` (print and exit) to match
    // createCLI()'s configuration-free behavior; `help <command>` still routes
    // to the registered help command below.
    const cmdTokens = process.argv.slice(2);
    const isBareHelp =
      cmdTokens.length === 1 &&
      (cmdTokens[0] === "help" || cmdTokens[0] === "h");
    if (
      process.argv.includes("--help") ||
      process.argv.includes("-h") ||
      isBareHelp
    ) {
      console.log(formatGroupedHelp(program));
      return;
    }
    if (process.argv.includes("--version") || process.argv.includes("-V")) {
      console.log(program.version());
      return;
    }

    if (process.env.AVOID_LOOP_RUN === "true") {
      // one shot
      await program.parseAsync(process.argv);
      return;
    }

    // In loop mode, commander must throw (not exit) on any error so a bad
    // command never terminates the REPL, and its errors are colorized.
    configureForLoop(program);

    // Run the initial command passed on argv once (if any), surfacing errors.
    // When started with no command at all, show the help menu up front so the
    // user sees what's available instead of facing a bare prompt.
    const initialTokens = process.argv.slice(2);
    if (initialTokens.length > 0) {
      await runTokens(initialTokens);
    } else {
      console.log(formatGroupedHelp(program));
    }

    // Then loop on stdin until the user exits or input is exhausted.
    await runLoop();
  } catch (error) {
    console.error(chalk.red(`Program Error: ${error.message}`));
    // Flush before exiting: process.exit() discards whatever a piped stdout/stderr
    // still has buffered, which could swallow the message just written. Exiting
    // here (rather than falling through to the finally) keeps failures immediate —
    // the process is going away, so libp2p needs no orderly shutdown.
    await flushOutput();
    process.exit(1);
  } finally {
    // Once libp2p has started the process can no longer end on its own: stopping
    // it cleanly still leaves a MessagePort holding the event loop open. So stop
    // it and, if it had been running, exit explicitly — after draining stdout,
    // since a piped stdout (tests, scripts) can still hold buffered output that
    // process.exit() would discard. Reached on every non-throwing path out of the
    // try above; when nothing was started, Node exits on its own and drains the
    // streams as part of that.
    if (await stopP2P()) {
      await flushOutput();
      process.exit(process.exitCode ?? 0);
    }
  }
}

main();
