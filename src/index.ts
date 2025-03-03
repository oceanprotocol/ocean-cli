import { createCLI } from './cli';

async function main() {
	try {
		const program = await createCLI();
		
		// Handle help command without initializing signer
		if (process.argv.includes('--help') || process.argv.includes('-h')) {
			program.outputHelp();
			process.exit(0);
		}

		await program.parseAsync(process.argv);
	} catch (error) {
		console.error('Error:', error.message);
		process.exit(1);
	}
}

main();
