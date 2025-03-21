import { sleep } from '@oceanprotocol/lib';
import {createInterface} from "readline";
import { createCLI } from './cli.js';


let program
let exit = false
async function waitForCommands() {
  const command = await readLine("Enter command:\n")
  console.log('Got command:', command)
  if(command === "quit" || command === "exit") {
	exit = true
  }
  const commandSplitted: string[] = command.split(" ")
  if(commandSplitted.length < 1) {
	console.log("Invalid command, missing one or more arguments!")
	return
  }
  if(commandSplitted.length>=3) {
	if(commandSplitted[0] === "npm" && commandSplitted[1] === "run" && commandSplitted[2] === "cli") {
		commandSplitted.splice(0,3)
		console.log("cleaned command:", commandSplitted.join(" "))
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
		
		console.log("Type 'exit' or 'quit' to terminate process")
		// Handle help command without initializing signer
		if (process.argv.includes('--help') || process.argv.includes('-h')) {
			program.outputHelp();
			process.exit(0);
		}

		await program.parseAsync(process.argv);
		do {
			await waitForCommands()
		}while(!exit)
		

	} catch (error) {
		console.error('Error:', error.message);
		exit = true
		process.exit(1);
	}
}

main();
