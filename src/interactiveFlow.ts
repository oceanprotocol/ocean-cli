import { prompt } from 'enquirer';

interface Answers {
  title: string;
  description: string;
  author: string;
  tags: string;
  accessDuration: string;
  storageType: 'IPFS' | 'Arweave' | 'URL';
  assetLocation: string;
  isCharged: boolean;
  token?: string;
  price?: string;
  network: 'Oasis Sapphire' | 'Ethereum' | 'Polygon';
  template?: string;
  showAdvanced: boolean;
  customParameter?: string;
}

export async function interactiveFlow() {
  try {
    // Prompting for basic information
    const basicAnswers = await prompt<Answers>([
      {
        type: 'input',
        name: 'title',
        message: 'What is the title of your asset?',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Please provide a description of your asset:',
      },
      {
        type: 'input',
        name: 'author',
        message: 'Who is the Author of this asset?',
      },
      {
        type: 'input',
        name: 'tags',
        message: 'Please provide tags to make this asset more easily discoverable (comma separated):',
      },
      {
        type: 'input',
        name: 'accessDuration',
        message: 'After purchasing your asset, how long should the consumer be allowed to access it for?',
      },
    ]);

    // Prompting for technical details
    const technicalAnswers = await prompt<Answers>([
      {
        type: 'select',
        name: 'storageType',
        message: 'How is your asset stored?',
        choices: ['IPFS', 'Arweave', 'URL'],
      },
      {
        type: 'input',
        name: 'assetLocation',
        message: 'Please provide the URL / hash / txID for your asset:',
      },
      {
        type: 'confirm',
        name: 'isCharged',
        message: 'Will you charge for this asset?',
        initial: false,
      },
      {
        type: 'input',
        name: 'token',
        message: 'What token will you accept payments in?',
        skip: (answers: Answers) => !answers.isCharged,
      },
      {
        type: 'input',
        name: 'price',
        message: 'What is the price to access your asset?',
        skip: (answers: Answers) => !answers.isCharged,
      },
      {
        type: 'select',
        name: 'network',
        message: 'What network will your asset be available for purchase through?',
        choices: ['Oasis Sapphire', 'Ethereum', 'Polygon'],
        initial: 0,
      },
      {
        type: 'select',
        name: 'template',
        message: 'Which template would you like to use?',
        choices: ['Template A', 'Template B', 'Template C'],
        skip: (answers: Answers) => answers.network === 'Oasis Sapphire',
      },
    ]);

    // Prompting for advanced options
    const advancedAnswers = await prompt<Answers>([
      {
        type: 'confirm',
        name: 'showAdvanced',
        message: 'Would you like to consider all of the advanced options for your asset?',
        initial: false,
      },
      {
        type: 'input',
        name: 'customParameter',
        message: 'Please provide any user-defined parameters:',
        skip: (answers: Answers) => !answers.showAdvanced,
      },
    ]);

    // Combine all answers
    const allAnswers = { ...basicAnswers, ...technicalAnswers, ...advancedAnswers };

    console.log('\nHere are your responses:');
    console.log(allAnswers);
  } catch (error) {
    console.error('An error occurred during the prompt:', error);
  }
}