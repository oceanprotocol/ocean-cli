import { Command, CommanderError } from "commander";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "readline/promises";
import { createCLI } from './cli.js';

let program
const supportedCommands: string[] = []

/**
 * Make Commander throw instead of calling process.exit on errors / help /
 * version. This must be applied to every subcommand, not just the root program:
 * a subcommand parse error (e.g. a missing required argument) is raised by the
 * subcommand itself, which would otherwise kill the whole REPL process.
 */
function enableExitOverride(cmd: Command): void {
	cmd.exitOverride()
	for (const sub of cmd.commands) enableExitOverride(sub)
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
 * Strip an optional leading `npm run cli` prefix so that a pasted example
 * command behaves identically to the bare command form.
 */
function stripNpmPrefix(tokens: string[]): string[] {
	if (tokens[0] === "npm" && tokens[1] === "run" && tokens[2] === "cli") {
		return tokens.slice(3)
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
		console.log(`Invalid option: ${commandName}. Type 'help' to see the available commands.`)
		return
	}

	try {
		await program.parseAsync(tokens, { from: "user" })
	} catch (error) {
		// CommanderError (missing/excess args, unknown option, help, version) is
		// already reported by commander itself — don't double-print it.
		if (!(error instanceof CommanderError)) {
			console.error("Command error:", error?.message ?? error)
		}
	}
}

const PROMPT = "Enter command ('exit' | 'quit' or CTRL-C to terminate):\n"

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
	rl.setPrompt(PROMPT)
	rl.prompt()

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

	rl.close()
}

async function main() {
	try {
		program = await createCLI();
		for (const command of program.commands) {
			supportedCommands.push(command.name())
			const alias = command.alias()
			if (alias) supportedCommands.push(alias)
		}

		// Handle help flag without initializing signer, and exit so it prints
		// once (not again via parseAsync/runLoop below).
		if (process.argv.includes('--help') || process.argv.includes('-h')) {
			program.outputHelp();
			return;
		}

		if (process.env.AVOID_LOOP_RUN === 'true') {
			// one shot
			await program.parseAsync(process.argv);
			return
		}

		// In loop mode, commander must throw (not exit) on any error so a bad
		// command never terminates the REPL.
		enableExitOverride(program)

		// Run the initial command passed on argv once (if any), surfacing errors.
		const initialTokens = process.argv.slice(2)
		if (initialTokens.length > 0) {
			await runTokens(initialTokens)
		}

		// Then loop on stdin until the user exits or input is exhausted.
		await runLoop()

	} catch (error) {
		console.error('Program Error:', error.message);
		process.exit(1);
	}
}

main();
