# Copilot Instructions for Ocean CLI

## Project Overview

Ocean CLI is a TypeScript-based command-line tool for interacting with Ocean Network, using Ocean Protocol's JavaScript library ([Ocean-Js](https://github.com/oceanprotocol/ocean.js)). It enables users to privately and securely publish, consume, and run compute operations.

**Key Features:**
- Publish data services (downloadable files or compute-to-data)
- Edit existing assets
- Consume data services and download data
- Compute-to-data operations on public datasets
- Manage access control with access lists
- Handle escrow payments for compute jobs
- Manage authentication with token generation

## Project Structure

```
src/
├── cli.ts              # CLI entry point and command setup
├── commands.ts         # Command implementations
├── helpers.ts          # Utility helper functions
├── index.ts            # Package exports
├── interactiveFlow.ts  # Interactive user flow handlers
├── publishAsset.ts     # Asset publishing logic
test/                   # Test suite (Mocha + Chai)
metadata/              # Sample metadata files for testing
```

## Technology Stack

- **Language:** TypeScript 5.x
- **Runtime:** Node.js (ES2020 module)
- **Testing:** Mocha + Chai
- **Linting:** ESLint with TypeScript support
- **Formatting:** Prettier
- **CLI Framework:** Commander.js
- **Crypto:** ethers.js, Ethereum wallet support
- **Ocean Protocol:** @oceanprotocol/lib, @oceanprotocol/ddo-js

## Code Style & Conventions

### TypeScript Configuration
- **Target:** ES2020
- **Module:** ES2020
- **Strict Mode:** Enabled
- **Module Resolution:** Node
- **Source Maps:** Enabled for debugging

### Coding Standards

1. **Imports & Exports:**
   - Use ES6 module syntax: `import`/`export`
   - Group imports: external libs, then internal modules
   - Use named imports when possible
   - Explicitly use `.js` extension for relative imports (ESM compatibility)

   ```typescript
   import { Command } from 'commander';
   import { Commands } from './commands.js';
   import chalk from 'chalk';
   ```

2. **Formatting:**
   - Use Prettier for code formatting
   - Line length: Follow Prettier defaults
   - Indentation: 2 spaces
   - Semicolons: Always include
   - Quotes: Single quotes preferred

3. **Naming Conventions:**
   - Classes/Types: PascalCase
   - Functions/Variables: camelCase
   - Constants: UPPER_SNAKE_CASE
   - Private methods: Prefix with `_`

4. **Async/Await:**
   - Prefer async/await over Promise.then()
   - Use try/catch for error handling
   - Always return promises from async functions

5. **Type Safety:**
   - Always provide explicit type annotations for function parameters and return types
   - Avoid `any` type; use `unknown` if necessary
   - Use interfaces for object types
   - Leverage TypeScript strict mode

   ```typescript
   async function initializeSigner(): Promise<{ signer: Signer; chainId: number }> {
     // implementation
   }
   ```

6. **Error Handling:**
   - Use chalk library for colored console output
   - Use `process.exit(code)` for CLI exit codes
   - Provide meaningful error messages to users

   ```typescript
   console.error(chalk.red("Error message"));
   process.exit(1);
   ```

## Environment Variables

Required:
- `PRIVATE_KEY` or `MNEMONIC`: Wallet credentials
- `RPC`: RPC endpoint URL
- `NODE_URL`: Ocean Node URL for indexing

Optional:
- `ADDRESS_FILE`: Path to custom smart contract addresses
- `INDEXING_MAX_RETRIES`: Max retries for asset indexing (default: 100)

## Build & Development

### Commands
```bash
npm install          # Install dependencies
npm run build        # Build TypeScript (clean + compile)
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix linting issues
npm run format       # Format code with Prettier
npm run cli          # Run CLI interactively
npm run test         # Run full test suite (lint + tests)
npm run test:system  # Run system tests only
```

### Development Workflow
1. Make changes in `src/`
2. Run `npm run lint:fix` to auto-fix style issues
3. Run `npm run test` before committing
4. Build with `npm run build` to verify TypeScript compilation

## Testing

- **Framework:** Mocha with Chai assertions
- **Location:** `test/` directory
- **Naming:** `*.test.ts` files
- **Test Configuration:** `test/.mocharc.json`
- **Node Environment:** Tests run with `NODE_OPTIONS='--experimental-require-module'`

### Test Categories
- `accessList.test.ts` - Access list functionality
- `consumeFlow.test.ts` - Data consumption workflow
- `escrow.test.ts` - Escrow payment handling
- `http.test.ts` - HTTP operations
- `paidComputeFlow.test.ts` - Paid compute workflows
- `setup.test.ts` - Setup and initialization
- `util.ts` - Test utilities

### Sample Metadata
See `metadata/` directory for example asset configurations:
- JavaScript algorithms
- IPFS-hosted algorithms
- Python algorithms
- Compute datasets
- Download datasets

## ESLint Rules

- `@typescript-eslint/no-explicit-any`: Warn (avoid `any` types)
- Recommended ESLint rules enabled
- TypeScript ESLint recommended config applied
- Prettier integration enabled

## Dependencies Overview

**Key Runtime Dependencies:**
- `@oceanprotocol/lib` - Core Ocean Protocol functionality
- `@oceanprotocol/ddo-js` - Decentralized Data Objects
- `@oceanprotocol/contracts` - Smart contract interfaces
- `ethers` - Ethereum Web3 library
- `commander` - CLI argument parsing
- `chalk` - Colored console output

## Current Branch Context

- **Current Branch:** security/add_n8n_workflow
- **Default Branch:** main
- **Main Purpose:** Security improvements with n8n workflow integration

## Best Practices

1. **CLI Design:**
   - Use Commander.js for consistent command structure
   - Provide clear help text for all commands
   - Use interactive prompts for complex flows
   - Show progress for long-running operations

2. **Wallet Management:**
   - Support both private key and mnemonic imports
   - Validate environment variables at startup
   - Use ethers.js for all cryptographic operations
   - Never log or expose private keys

3. **Error Messages:**
   - Use `chalk.red()` for errors
   - Include actionable error messages
   - Exit with appropriate status codes (0 = success, 1 = error)

4. **Code Organization:**
   - Keep CLI setup in `cli.ts`
   - Separate command logic into `commands.ts`
   - Share utilities in `helpers.ts`
   - Use modular flows for complex operations

5. **Documentation:**
   - Include JSDoc comments for exported functions
   - Document complex algorithms and workflows
   - Keep README.md updated with usage examples

## Common Patterns

### Interactive Flows
Use `readline/promises` for user input in interactive flows:
```typescript
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = createInterface({ input, output });
const answer = await rl.question('Prompt: ');
```

### Logging with Colors
```typescript
import chalk from 'chalk';

console.log(chalk.green('Success'));
console.error(chalk.red('Error'));
console.log(chalk.yellow('Warning'));
console.log(chalk.blue('Info'));
```

### Type-Safe Conversions
```typescript
import { toBoolean } from './helpers.js';
import { unitsToAmount } from '@oceanprotocol/lib';
```

## Before Committing

- [ ] Run `npm run test` - all tests pass
- [ ] Run `npm run lint:fix` - no linting errors
- [ ] Check TypeScript compilation: `npm run build`
- [ ] Verify no console.log statements left (except intentional logging)
- [ ] Update README.md if adding new features
- [ ] Add/update tests for new functionality

## Related Documentation

- [Ocean Protocol](https://oceanprotocol.com)
- [ocean.js Documentation](https://github.com/oceanprotocol/ocean.js)
- [Commander.js Guide](https://github.com/tj/commander.js)
- [ethers.js Documentation](https://docs.ethers.org/)
