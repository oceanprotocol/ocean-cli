import { createCLI } from './cli';

async function main() {
	try {
		const program = await createCLI();
		await program.parseAsync(process.argv);
	} catch (error) {
		console.error('Error:', error.message);
		process.exit(1);
	}
}

main();
