// interactiveFlow.ts
import { prompt } from 'enquirer';
import { PublishAssetParams } from './publishAsset';
import chalk from 'chalk';
import figlet from 'figlet';

// Validation functions
const validateIPFS = (input: string) =>
  /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(input) || 'Invalid IPFS hash format.';
const validateArweave = (input: string) =>
  /^[a-zA-Z0-9_-]{43,}$/.test(input) || 'Invalid Arweave transaction ID format.';
const validateURL = (input: string) =>
  /^(https?:\/\/)[^\s/$.?#].[^\s]*$/.test(input) || 'Invalid URL format.';

export async function interactiveFlow(providerUrl: string): Promise<PublishAssetParams> {
  try {
    console.clear();
    console.log(
      chalk.blue(
        figlet.textSync('Ocean CLI', { horizontalLayout: 'full' })
      )
    );
    console.log(chalk.cyan('Welcome to the Ocean Protocol Asset Publisher!\n'));

    // Prompting for basic information
    const basicAnswers = await prompt<Omit<PublishAssetParams, 'isCharged' | 'chainId' | 'storageType' | 'assetLocation'>>([
      {
        type: 'input',
        name: 'title',
        message: chalk.green('What is the title of your asset?\n'),
        required: true
      },
      {
        type: 'input',
        name: 'description',
        message: chalk.green('Please provide a description of your asset:\n'),
        required: true
      },
      {
        type: 'input',
        name: 'author',
        message: chalk.green('Who is the Author of this asset?\n'),
        required: true
      },
      {
        type: 'list',
        name: 'tags',
        message: chalk.green('Please provide tags to make this asset more easily discoverable (comma separated):\n'),
        required: true
      },
      {
        type: 'select',
        name: 'timeout',
        message: chalk.green('After purchasing your asset, how long should the consumer be allowed to access it for?\n'),
        choices: [
          {name: 'Forever', value: "0"},
          {name: '1 day', value: "86400"},
          {name: '1 week', value: "604800"},
          {name: '1 month', value: "2592000"},
          {name: '1 year', value: "31536000"}
        ],
        result(value) {
          return this.choices.find(choice => choice.name === value).value;
        }
      },
    ]);

    // Storage type prompt
    const { storageType } = await prompt<{ storageType: PublishAssetParams['storageType'] }>({
      type: 'select',
      name: 'storageType',
      message: chalk.green('How is your asset stored?\n'),
      choices: [{name: 'IPFS', value: 'ipfs'}, {name: 'Arweave', value: 'arweave'}, {name: 'URL', value: 'url'}],
      result(value) {
        return this.choices.find(choice => choice.name === value).value;
      }
    });

    // Determine assetLocation message and validation based on storageType
    let assetLocationMessage = 'Please provide the location of your asset:\n';
    let validateFunction;
    if (storageType === 'ipfs') {
      assetLocationMessage = 'Please provide the IPFS hash for your asset:\n';
      validateFunction = validateIPFS;
    } else if (storageType === 'arweave') {
      assetLocationMessage = 'Please provide the Arweave transaction ID for your asset:\n';
      validateFunction = validateArweave;
    } else if (storageType === 'url') {
      assetLocationMessage = 'Please provide the URL for your asset:\n';
      validateFunction = validateURL;
    }

    // Prompt for asset location with validation
    const { assetLocation } = await prompt<{ assetLocation: string }>([
      {
        type: 'input',
        name: 'assetLocation',
        message: chalk.green(assetLocationMessage),
        validate: validateFunction,
        required: true
      },
    ]);

    // Is charged prompt
    const { isCharged } = await prompt<{ isCharged: boolean }>({
      type: 'toggle',
      name: 'isCharged',
      message: chalk.green('Will you charge for this asset?\n'),
      enabled: 'Paid',
      disabled: 'Free',
    });

    // Check if isCharged is true to ask further questions about payment
    let paymentDetails: { token?: 'OCEAN' | 'H2O'; price?: string } = {};
    if (isCharged) {
      paymentDetails = await prompt<{ token: 'OCEAN' | 'H2O'; price: string }>([
        {
          type: 'select',
          name: 'token',
          message: chalk.green('What token will you accept payments in?\n'),
          choices: ['OCEAN', 'H2O'],
        },
        {
          type: 'input',
          name: 'price',
          message: chalk.green('What is the price to access your asset?\n'),
        },
      ]);
    }

    // Chain ID prompt
    const { chainId } = await prompt<{ chainId: number }>({
      type: 'select',
      name: 'chainId',
      message: chalk.green('What network will your asset be available for purchase through?\n'),
      choices: [{name: 'Oasis Sapphire', value: 23294}, {name: 'Oasis Sapphire Testnet', value: 23295}, {name: 'Ethereum', value: 1}, {name: 'Polygon', value: 137}],
      result(value) {
        return this.choices.find(choice => choice.name === value).value;
      }
    });

    // Template prompt
    let template: number | undefined;
    if (chainId !== 23295 && chainId !== 23294) {
      const templateAnswer = await prompt<{ template: number }>({
        type: 'select',
        name: 'template',
        message: chalk.green('Which template would you like to use?\n'),
        choices: [
          { name: 'Template 1 - user can buy, sell & hold datatokens.', value: 1 },
          { name: 'Template 2 - assets are purchased with basetokens and the effective supply of datatokens is always zero.', value: 2 },
        ],
        result(value) {
          return this.choices.find(choice => choice.name === value).value;
        }
      });
      template = templateAnswer.template;
    }

    // Combine all answers
    const allAnswers: PublishAssetParams = {
      ...basicAnswers,
      storageType,
      assetLocation,
      isCharged,
      ...paymentDetails,
      chainId,
      template,
      providerUrl
    };

    console.log('\n' + chalk.cyan('Here are your responses:\n'));
    console.log(chalk.yellow(JSON.stringify(allAnswers, null, 2)));

    return allAnswers; 
  } catch (error) {
    console.error(chalk.red('An error occurred during the prompt:'), error);
    throw error;
  }
}