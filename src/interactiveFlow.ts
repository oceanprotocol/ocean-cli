import { prompt } from 'enquirer';

interface Answers {
  title: string;
  description: string;
  author: string;
  tags: string;
  accessDuration: 'Forever' | '1 day' | '1 week' | '1 month' | '1 year';
  storageType: 'IPFS' | 'Arweave' | 'URL';
  assetLocation: string;
  isCharged: 'Paid' | 'Free';
  token?: 'OCEAN' | 'H2O';
  price?: string;
  network: 'Oasis Sapphire' | 'Ethereum' | 'Polygon';
  template?: string;
  showAdvanced: boolean;
  customParameter?: string;
}

// Validation functions
const validateIPFS = (input: string) => /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(input) || 'Invalid IPFS hash format.';
const validateArweave = (input: string) => /^[a-zA-Z0-9_-]{43,}$/.test(input) || 'Invalid Arweave transaction ID format.';
const validateURL = (input: string) => /^(https?:\/\/)[^\s/$.?#].[^\s]*$/.test(input) || 'Invalid URL format.';

export async function interactiveFlow() {
  try {
    // Prompting for basic information
    const basicAnswers = await prompt<Partial<Answers>>([
      {
        type: 'input',
        name: 'title',
        message: 'What is the title of your asset?\n',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Please provide a description of your asset:\n',
      },
      {
        type: 'input',
        name: 'author',
        message: 'Who is the Author of this asset?\n',
      },
      {
        type: 'list',
        name: 'tags',
        message: 'Please provide tags to make this asset more easily discoverable (comma separated):\n',
      },
      {
        type: 'select',
        name: 'accessDuration',
        message: 'After purchasing your asset, how long should the consumer be allowed to access it for?\n',
        choices: ['Forever', '1 day', '1 week', '1 month', '1 year'],
      },
    ]);

    // Prompting for technical details - first, get storage type
    const { storageType } = await prompt<{ storageType: Answers['storageType'] }>([
      {
        type: 'select',
        name: 'storageType',
        message: 'How is your asset stored?\n',
        choices: ['IPFS', 'Arweave', 'URL'],
      },
    ]);

    // Determine assetLocation message and validation based on storageType
    let assetLocationMessage = 'Please provide the location of your asset:\n';
    let validateFunction;
    if (storageType === 'IPFS') {
      assetLocationMessage = 'Please provide the IPFS hash for your asset:\n';
      validateFunction = validateIPFS;
    } else if (storageType === 'Arweave') {
      assetLocationMessage = 'Please provide the Arweave transaction ID for your asset:\n';
      validateFunction = validateArweave;
    } else if (storageType === 'URL') {
      assetLocationMessage = 'Please provide the URL for your asset:\n';
      validateFunction = validateURL;
    }

    // Prompt for asset location with validation
    const { assetLocation } = await prompt<{ assetLocation: string }>([
      {
        type: 'input',
        name: 'assetLocation',
        message: assetLocationMessage,
        validate: validateFunction,
      },
    ]);

    // Prompt for whether the asset is charged or free
    const { isCharged } = await prompt<{ isCharged: Answers['isCharged'] }>([
      {
        type: 'toggle',
        name: 'isCharged',
        message: 'Will you charge for this asset?\n',
        initial: 'Paid',
        enabled: 'Paid',
        disabled: 'Free',
      },
    ]);

    // Continue with further technical details, conditional prompts based on isCharged
    const paymentDetails = isCharged === 'Paid'
      ? await prompt<Partial<Answers>>([
          {
            type: 'select',
            name: 'token',
            message: 'What token will you accept payments in?\n',
            choices: ['OCEAN', 'H2O'],
          },
          {
            type: 'input',
            name: 'price',
            message: 'What is the price to access your asset?\n',
          },
        ])
      : {};

    // Prompt for network selection
    const { network } = await prompt<{ network: Answers['network'] }>([
      {
        type: 'select',
        name: 'network',
        message: 'What network will your asset be available for purchase through?\n',
        choices: ['Oasis Sapphire', 'Ethereum', 'Polygon'],
        initial: 0,
      },
    ]);

    // Conditionally prompt for template if the network is not 'Oasis Sapphire'
    const templateAnswer = network !== 'Oasis Sapphire'
      ? await prompt<Partial<Answers>>([
          {
            type: 'select',
            name: 'template',
            message: 'Which template would you like to use?\n',
            choices: ['Template A', 'Template B', 'Template C'],
          },
        ])
      : {};

    // Prompting for advanced options
    // const advancedAnswers = await prompt<Partial<Answers>>([
    //   {
    //     type: 'confirm',
    //     name: 'showAdvanced',
    //     message: 'Would you like to consider all of the advanced options for your asset?\n',
    //     initial: false,
    //   },
    //   {
    //     type: 'input',
    //     name: 'customParameter',
    //     message: 'Please provide any user-defined parameters:\n',
    //     skip: (answers: Partial<Answers>) => !answers.showAdvanced,
    //   },
    // ]);

    // Combine all answers
    const allAnswers = { 
      ...basicAnswers, 
      storageType, 
      assetLocation, 
      isCharged, 
      ...paymentDetails, 
      network, 
      ...templateAnswer
    };

    console.log('\nHere are your responses:');
    console.log(allAnswers);
  } catch (error) {
    console.error('An error occurred during the prompt:', error);
  }
}
