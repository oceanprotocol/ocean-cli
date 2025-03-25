import { sleep } from '@oceanprotocol/lib';
import {createInterface} from "readline";
import { createCLI } from './cli.js';


let program
let exit = false
const supportedCommands: string[] = [] 
async function waitForCommands() {
  const commandLine = await readLine("Enter command ('exit' | 'quit' or CTRL-C to terminate'):\n")
  let command = null
  if(commandLine === "quit" || commandLine === "exit" || commandLine === "\\q") {
	exit = true
	return
  }
  const commandSplitted: string[] = commandLine.split(" ")
  if(commandSplitted.length < 1) {
	console.log("Invalid command, missing one or more arguments!")
	return
  }
  if(commandSplitted.length>=3) {
	if(commandSplitted[0] === "npm" && commandSplitted[1] === "run" && commandSplitted[2] === "cli") {
		commandSplitted.splice(0,3)
		command = commandSplitted.join(" ")
	}
  } else if(commandSplitted.length === 1) {
	// just the command without npm run cli
	command = commandSplitted[0]
  }

  if(command && command.length > 0) {
	const args = command.split(" ")
	const commandName = args[0]
	if(!supportedCommands.includes(commandName)) {
		console.log("Invalid option: ", commandName)
		return
	} 
	try {
		await program.parseAsync(args);
	}catch(error) {
		console.log('Command error: ', error)
	}
  } 
  
}

async function readLine(question: string): Promise<string> {

    const readLine = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let answer = ""
    readLine.question(question, (it: string) => { 
    answer = it.trim()
    readLine.close()
    })
    while (answer == "") { await sleep(100)  }

    return answer

}
async function main() {
	try {
		program = await createCLI();
		for(const command of program.commands) {
			supportedCommands.push(command.name())
			supportedCommands.push(command.alias())
		}
		
		console.log("Type 'exit' or 'quit' or 'CTRL-C' to terminate process")
		// Handle help command without initializing signer
		if (process.argv.includes('--help') || process.argv.includes('-h')) {
			program.outputHelp();
		}

		if(process.env.AVOID_LOOP_RUN !== 'true') {
			do {
				program.exitOverride();
				try {
					await program.parseAsync(process.argv);
				}catch(err) {
					// silently ignore
				}
				await waitForCommands()
			}while(!exit)
		} else {
			// one shot
			await program.parseAsync(process.argv);
		}

	} catch (error) {
		console.error('Program Error:', error.message);
		exit = true
		process.exit(1);
	}
}

main();
