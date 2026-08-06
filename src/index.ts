#!/usr/bin/env node
import "./warnings.js";
import { Command, CommanderError } from "commander";
import chalk from "chalk";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "readline/promises";
import { createCLI } from './cli.js';
import { stopP2P } from './nodeConnection.js';

let program: Command
const supportedCommands: string[] = []

/**
 * Prepare commander for REPL use: make it throw instead of calling process.exit
 * on errors / help / version, and colorize its own error output (e.g. "missing
 * required argument"). Both must be applied to every subcommand, not just the
 * root program: a subcommand parse error is raised and written by the subcommand
 * itself, which would otherwise kill the REPL and print an uncolored message.
 */
function configureForLoop(cmd: Command): void {
	cmd.exitOverride()
	cmd.configureOutput({
		outputError: (str, write) => write(chalk.red(str)),
	})
	for (const sub of cmd.commands) configureForLoop(sub)
}

/**
 * Split a command line into tokens while honoring single/double quotes, so that
 * JSON arguments (e.g. startCompute resources/datasets) survive intact. Runs of
 * whitespace collapse and produce no empty tokens.
 */
function tokenize(line: string): string[] {
	const tokens: string[] = []
	let current = ""
	let quote: string | null = null
	let hasContent = false

	for (const ch of line) {
		if (quote) {
			if (ch === quote) {
				quote = null
			} else {
				current += ch
			}
		} else if (ch === '"' || ch === "'") {
			quote = ch
			hasContent = true
		} else if (ch === " " || ch === "\t") {
			if (hasContent) {
				tokens.push(current)
				current = ""
				hasContent = false
			}
		} else {
			current += ch
			hasContent = true
		}
	}
	if (hasContent) tokens.push(current)
	return tokens
}

/**
 * Strip an optional leading `npm run cli` or `ocean-cli` prefix so that a pasted
 * example command (from either the contributor docs or the global-install docs)
 * behaves identically to the bare command form.
 */
function stripNpmPrefix(tokens: string[]): string[] {
	if (tokens[0] === "npm" && tokens[1] === "run" && tokens[2] === "cli") {
		return tokens.slice(3)
	}
	if (tokens[0] === "ocean-cli") {
		return tokens.slice(1)
	}
	return tokens
}

/**
 * Run a single already-tokenized command through commander. `from: 'user'`
 * tells commander the tokens are raw user args (no node/script prefix), so bare
 * start and initial-command start behave identically. Errors never terminate the
 * REPL: commander parse errors / help / version already write their own output,
 * so only unexpected runtime (action) errors are surfaced here.
 */
async function runTokens(tokens: string[]): Promise<void> {
	if (tokens.length === 0) return

	// Let commander handle option-style tokens (e.g. --help, --version); only
	// reject unknown command names.
	const commandName = tokens[0]
	if (!commandName.startsWith("-") && !supportedCommands.includes(commandName)) {
		console.log(chalk.red(`Invalid option: ${commandName}. Type 'help' to see the available commands.`))
		return
	}

	try {
		await program.parseAsync(tokens, { from: "user" })
	} catch (error) {
		// CommanderError (missing/excess args, unknown option, help, version) is
		// already reported by commander itself — don't double-print it.
		if (!(error instanceof CommanderError)) {
			console.error(chalk.red(`Command error: ${error?.message ?? error}`))
		}
	}
}

const PROMPT = "Enter command ('exit' | 'quit' | ESC or CTRL-C to terminate):\n"

/**
 * Tab-completion for the command name (the first token only). readline completes
 * to the longest common prefix of the matches, or lists them when there is more
 * than one. Returns all known commands when the line is still empty.
 */
function completer(line: string): [string[], string] {
	// Only complete the command name, not its arguments.
	if (line.includes(" ")) return [[], line]
	const hits = supportedCommands.filter((name) => name.startsWith(line)).sort()
	return [hits, line]
}

/**
 * Read commands from stdin until the user exits or input is exhausted (EOF).
 *
 * A single persistent readline interface is consumed via its async iterator so
 * that backpressure is respected and no buffered lines are dropped — creating a
 * fresh interface per prompt silently discards piped input beyond the first
 * line. The interface is paused around command execution so it never competes
 * for stdin with an interface a command opens itself (e.g. the payment
 * confirmation prompt in cli.ts).
 */
async function runLoop(): Promise<void> {
	const rl = createInterface({ input, output, completer })

	// On a TTY, let the Escape key exit the REPL (Ctrl-C already terminates via
	// SIGINT; `exit`/`quit`/`\q`/EOF still work). readline already emits keypress
	// events on the input stream in terminal mode, so a listener is enough — no
	// raw-mode juggling. Guarded by isTTY so piped stdin (tests, scripts) is
	// unaffected.
	const onKeypress = (_str: string, key?: { name?: string }): void => {
		if (key?.name === "escape") {
			output.write("\n")
			rl.close()
		}
	}
	if (input.isTTY) input.on("keypress", onKeypress)

	rl.setPrompt(PROMPT)
	rl.prompt()

	try {
		for await (const rawLine of rl) {
			const line = rawLine.trim()

			if (line === "quit" || line === "exit" || line === "\\q") {
				break
			}

			// Empty input: re-prompt instead of busy-waiting or dropping the session.
			if (line === "") {
				rl.prompt()
				continue
			}

			const tokens = stripNpmPrefix(tokenize(line))
			rl.pause()
			await runTokens(tokens)
			rl.resume()
			rl.prompt()
		}
	} finally {
		if (input.isTTY) input.off("keypress", onKeypress)
		rl.close()
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
					if (stream.writableLength === 0) return resolve()
					stream.write("", () => resolve())
				})
		)
	)
}

async function main(): Promise<void> {
	try {
		program = await createCLI();
		for (const command of program.commands) {
			supportedCommands.push(command.name())
			// aliases() (plural): alias() would only ever return the first one.
			const aliases = command.aliases()
			supportedCommands.push(...aliases)
		}

		// Handle help/version flags without initializing a signer, and exit so
		// they print once and never drop into the REPL below. createCLI() already
		// skips env validation for these invocations. The bare positional forms
		// `help`/`h` are treated the same as `--help` (print and exit) to match
		// createCLI()'s configuration-free behavior; `help <command>` still routes
		// to the registered help command below.
		const cmdTokens = process.argv.slice(2);
		const isBareHelp =
			cmdTokens.length === 1 && (cmdTokens[0] === 'help' || cmdTokens[0] === 'h');
		if (process.argv.includes('--help') || process.argv.includes('-h') || isBareHelp) {
			program.outputHelp();
			return;
		}
		if (process.argv.includes('--version') || process.argv.includes('-V')) {
			console.log(program.version());
			return;
		}

		if (process.env.AVOID_LOOP_RUN === 'true') {
			// one shot
			await program.parseAsync(process.argv);
			return
		}

		// In loop mode, commander must throw (not exit) on any error so a bad
		// command never terminates the REPL, and its errors are colorized.
		configureForLoop(program)

		// Run the initial command passed on argv once (if any), surfacing errors.
		// When started with no command at all, show the help menu up front so the
		// user sees what's available instead of facing a bare prompt.
		const initialTokens = process.argv.slice(2)
		if (initialTokens.length > 0) {
			await runTokens(initialTokens)
		} else {
			console.log(program.helpInformation())
		}

		// Then loop on stdin until the user exits or input is exhausted.
		await runLoop()

	} catch (error) {
		console.error(chalk.red(`Program Error: ${error.message}`));
		// Flush before exiting: process.exit() discards whatever a piped stdout/stderr
		// still has buffered, which could swallow the message just written. Exiting
		// here (rather than falling through to the finally) keeps failures immediate —
		// the process is going away, so libp2p needs no orderly shutdown.
		await flushOutput()
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
			await flushOutput()
			process.exit(process.exitCode ?? 0)
		}
	}
}

main();
