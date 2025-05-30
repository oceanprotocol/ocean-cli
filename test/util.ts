import { exec } from "child_process";
import path from "path";
import util from "util";

import { dirname } from 'path'
import { fileURLToPath } from 'url'


export const execPromise = util.promisify(exec);

export const __filename = fileURLToPath(import.meta.url)
export const __dirname = dirname(__filename)


export const projectRoot = path.resolve(__dirname, "..");
export const runCommand = async (command: string): Promise<string> => {
        console.log(`\n[CMD]: ${command}`);
        try {
            const { stdout } = await execPromise(command, { cwd: projectRoot });
            console.log(`[OUTPUT]:\n${stdout}`);
            return stdout;
        } catch (error: any) {
            console.error(`[ERROR]:\n${error.stderr || error.message}`);
            throw error;
        }
};