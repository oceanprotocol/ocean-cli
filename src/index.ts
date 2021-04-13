import { Ocean, ConfigHelper } from '@oceanprotocol/lib'
import { Commands } from './commands'
import * as fs from 'fs'
import Web3 from 'web3'
import HDWalletProvider = require('../node_modules/@truffle/hdwallet-provider/dist')

if (!process.env.MNEMONIC) {
  console.error('Have you forgot to set env MNEMONIC?')
  process.exit(0)
}
if (!process.env.RPC) {
  console.error('Have you forgot to set env RPC?')
  process.exit(0)
}
if (!process.env.NETWORK) {
  console.error('Have you forgot to set env NETWORK?')
  process.exit(0)
}

const config = {
  network: process.env.NETWORK,
  mnemonic: process.env.MNEMONIC,
  rpc: process.env.RPC
}
console.log(config)
const provider = new HDWalletProvider(config.mnemonic, config.rpc)

const web3 = new Web3(provider)
const account = provider.getAddress(0)
console.log('Using account: ' + account)
const oceanconfig = new ConfigHelper().getConfig(config.network)
oceanconfig.web3Provider = web3

function help() {
  console.log('Available options:')
  console.log('\t publish  METADATA_FILE - reads MEDATDATA_FILE and publishes a new asset with access service and compute service')
  console.log('\t publishAlgo  METADATA_FILE - reads MEDATDATA_FILE and publishes a new algo')
  console.log('\t getDDO DID - gets ddo for an asset')
  console.log(
    '\t download DID DESTINATION_FOLDER - downloads an asset into downloads/DESTINATION_FOLDER'
  )
  console.log('\t allowAlgo DATA_DID ALGO_DID - approves an algo for an asset')
  console.log(
    '\t disallowAlgo DATA_DID ALGO_DID - removes an approved algo for the asset approved algos'
  )
  console.log('\t startCompute DATA_DID ALGO_DID - computes an asset')
  console.log('\t getCompute JOB_ID - gets a compute status')
}

async function start() {
  const ocean = await Ocean.getInstance(oceanconfig)
  const oceanAccounts = await ocean.accounts.list()
  const commands = new Commands(ocean, oceanAccounts[0])
  const myArgs = process.argv.slice(2)
  switch (myArgs[0]) {
    case 'publish':
      await commands.publish(myArgs)
      break
    case 'publishAlgo':
      await commands.publishAlgo(myArgs)
      break
    case 'getDDO':
      await commands.getDDO(myArgs)
      break
    case 'download':
      await commands.download(myArgs)
      break
    case 'allowAlgo':
      await commands.allowAlgo(myArgs)
      break
    case 'disallowAlgo':
      await commands.disallowAlgo(myArgs)
      break
    case 'startCompute':
      await commands.compute(myArgs)
      break
    case 'getCompute':
      await commands.getCompute(myArgs)
      break
    case 'query':
      await commands.query(myArgs)
      break
    case 'h':
      help()
      break
    default:
      console.error('did you forgot the command ? use h for help')
      break
  }
  process.exit(0)
}

start()
