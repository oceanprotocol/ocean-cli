import { exec, spawn } from "child_process";
import path from "path";
import util from "util";
import { config as chaiConfig } from "chai";

import { dirname } from 'path';
import { fileURLToPath } from 'url';


export const execPromise = util.promisify(exec);

export const __filename = fileURLToPath(import.meta.url)
export const __dirname = dirname(__filename)


export const projectRoot = path.resolve(__dirname, "..");

// Never truncate assertion diffs: CLI output is long and a 40-char truncation
// ("expected '\n> @oceanprotocol/cli@...' to match /extended/i") hides the very
// text a failure needs to be diagnosed from a CI log.
chaiConfig.truncateThreshold = 0;

/**
 * The CLI prints every failure with console.error (stderr) and only successes
 * with console.log (stdout). runCommand returns stdout — so a command that
 * exits 0 after printing an error would otherwise look like silent, empty
 * output. Always echo stderr so the reason is in the log.
 */
const logStderr = (stderr?: string) => {
    if (stderr && stderr.trim().length > 0) {
        console.error(`[STDERR]:\n${stderr}`);
    }
};
export const runCommand = async (command: string): Promise<string> => {
    console.log(`\n[CMD]: ${command}`);
    try {
        const { stdout, stderr } = await execPromise(command, { cwd: projectRoot });
        console.log(`[OUTPUT]:\n${stdout}`);
        logStderr(stderr);
        return stdout;
    } catch (error: any) {
        console.error(`[ERROR]:\n${error.stderr || error.message}`);
        throw error;
    }
};

export const runCommandAs = async (
    privateKey: string,
    command: string
): Promise<string> => {
    console.log(`\n[CMD as ${privateKey.slice(0, 6)}…]: ${command}`);
    try {
        const { stdout, stderr } = await execPromise(command, {
            cwd: projectRoot,
            env: { ...process.env, PRIVATE_KEY: privateKey },
        });
        console.log(`[OUTPUT]:\n${stdout}`);
        logStderr(stderr);
        return stdout;
    } catch (error: any) {
        console.error(`[ERROR]:\n${error.stderr || error.message}`);
        throw error;
    }
};

/** Recurring prompt string emitted by the REPL (keep in sync with src/index.ts). */
export const REPL_PROMPT =
    "Enter command ('exit' | 'quit' | ESC or CTRL-C to terminate):\n";

export interface RunReplOptions {
    /** Extra argv for the initial command run before the loop starts. */
    extraArgs?: string[];
    /**
     * Env overrides applied on top of the defaults. A key set to undefined is
     * deleted, which is how a test starts the CLI with no NODE_URL at all.
     */
    env?: Record<string, string | undefined>;
}

/**
 * Drive the interactive REPL (menu mode) with piped stdin.
 *
 * The defaults are infra-free: PRIVATE_KEY/RPC/NODE_URL point at an unreachable
 * port, so a command that actually parses and runs surfaces a "Command error"
 * (connection refused) while a command that is dropped, rejected at parse time or
 * refused by the node gate does not. AVOID_LOOP_RUN is unset so the process enters
 * the REPL loop.
 */
export const runRepl = (
    inputLines: string[],
    options: RunReplOptions = {}
): Promise<{ output: string; code: number | null }> => {
    return new Promise((resolve, reject) => {
        const env: Record<string, string | undefined> = { ...process.env };
        delete env.AVOID_LOOP_RUN;
        env.PRIVATE_KEY =
            "0x1d751ded5a32226054cd2e71261039b65afb9ee1c746d055dd699b1150a5befc";
        env.RPC = "http://127.0.0.1:1";
        env.NODE_URL = "http://127.0.0.1:1";
        // These tests must not dial the public Ocean bootstrap nodes.
        env.DISABLE_P2P = "true";

        for (const [key, value] of Object.entries(options.env || {})) {
            if (value === undefined) delete env[key];
            else env[key] = value;
        }

        const child = spawn(
            "npx",
            ["tsx", "src/index.ts", ...(options.extraArgs || [])],
            { cwd: projectRoot, env }
        );

        let output = "";
        child.stdout.on("data", (d) => (output += d.toString()));
        child.stderr.on("data", (d) => (output += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ output, code }));

        for (const line of inputLines) {
            child.stdin.write(line + "\n");
        }
        child.stdin.end();
    });
};