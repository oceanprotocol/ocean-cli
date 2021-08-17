import { Ocean, Account, DataTokens, Logger, Metadata } from '@oceanprotocol/lib'
import {
  Service,
  ServiceComputePrivacy,
  ServiceType
} from '@oceanprotocol/lib/dist/node/ddo/interfaces/Service'
import { SearchQuery } from '@oceanprotocol/lib/dist/node/metadatacache/MetadataCache'
import fs from 'fs'

export class Commands {
  public ocean: Ocean
  public account: Account
  constructor(ocean: Ocean, account: Account) {
    this.ocean = ocean
    this.account = account
  }

  // utils
  public async sleep(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  // commands
  public async publish(args: string[]) {
    console.log('start publishing')
    let asset
    try {
      asset = JSON.parse(
        fs.readFileSync(args[1],
          'utf8'
        )
      )
    }
    catch (e) {
      console.error("Cannot read metadata from " + args[1])
      console.error(e)
      return
    }
    const tokenAddress = await this.ocean.datatokens.create(
      '',
      this.account.getId(),
      '10000000000',
      'BBDT',
      'BBDT'
    )
    await this.ocean.datatokens.mint(tokenAddress, this.account.getId(), '1000000000')
    
    const downloadService = await this.ocean.assets.createAccessServiceAttributes(
      this.account,
      '1', // set the price in datatoken
      new Date(Date.now()).toISOString().split('.')[0] + 'Z', // publishedDate
      0 // timeout
    )
    // create compute service
    const timeout = 3600
    const cluster = this.ocean.compute.createClusterAttributes(
      'Kubernetes',
      'http://10.0.0.17/xxx'
    )
    const servers = [
      this.ocean.compute.createServerAttributes(
        '1',
        'xlsize',
        '50',
        '16',
        '0',
        '128gb',
        '160gb',
        timeout
      )
    ]
    const containers = [
      this.ocean.compute.createContainerAttributes(
        'tensorflow/tensorflow',
        'latest',
        'sha256:cb57ecfa6ebbefd8ffc7f75c0f00e57a7fa739578a429b6f72a0df19315deadc'
      )
    ]
    const provider = this.ocean.compute.createProviderAttributes(
      'Azure',
      'Compute service with 16gb ram for each node.',
      cluster,
      containers,
      servers
    )
    const origComputePrivacy: ServiceComputePrivacy = {
      allowRawAlgorithm: false,
      allowNetworkAccess: false,
      allowAllPublishedAlgorithms: false,
      publisherTrustedAlgorithms: []
    }
    const computeService = this.ocean.compute.createComputeService(
      this.account,
      '1',
      new Date(Date.now()).toISOString().split('.')[0] + 'Z', // publishedDate,
      provider,
      origComputePrivacy,
      timeout
    )

    const ddo = await this.ocean.assets.create(
      asset,
      this.account,
      [downloadService, computeService],
      tokenAddress
    )
    const storeTx = await this.ocean.onChainMetadata.publish(
      ddo.id,
      ddo,
      this.account.getId()
    )
    console.log('Asset published. ID:  ' + ddo.id)
  }

  public async publishAlgo(args: string[]) {
    let algoAsset
    try {
      algoAsset = JSON.parse(
        fs.readFileSync(args[1],
          'utf8'
        )
      )
    }
    catch (e) {
      console.error("Cannot read metadata from " + args[1])
      console.error(e)
      return
    }
    const tokenAddress = await this.ocean.datatokens.create(
      '',
      this.account.getId(),
      '10000000000',
      'BBALG',
      'BBALG'
    )
    await this.ocean.datatokens.mint(tokenAddress, this.account.getId(), '1000000000')
    
    const service1 = await this.ocean.assets.createAccessServiceAttributes(
      this.account,
      '1',
      new Date(Date.now()).toISOString().split('.')[0] + 'Z', // publishedDate,,
      0
    )
    const algorithmAsset = await this.ocean.assets.create(
      algoAsset,
      this.account,
      [service1],
      tokenAddress
    )
    const storeTx = await this.ocean.onChainMetadata.publish(
      algorithmAsset.id,
      algorithmAsset,
      this.account.getId()
    )
    console.log('Algorithm published. ID:  ' + algorithmAsset.id)
  }

  public async getDDO(args: string[]) {
    console.log('Getting DDO for :' + args[1])
    const ddo = await this.ocean.assets.resolve(args[1])
    if (!ddo) {
      console.error('Error fetching DDO ' + args[1] + '.  Does this asset exists?')
    } else console.log(ddo)
  }

  public async download(args: string[]) {
    const dataDdo = await this.ocean.assets.resolve(args[1])
    if (!dataDdo) {
      console.error('Error fetching DDO ' + args[1] + '.  Does this asset exists?')
      return
    }
    const accessService = await this.ocean.assets.getServiceByType(args[1], 'access')
    if (!accessService) {
      console.error(
        'Error getting accessService from ' +
        args[1] +
        '.  Does this asset has an accessService?'
      )
      return
    }
    const txid = await this.ocean.assets.order(
      args[1],
      'access',
      this.account.getId(),
      accessService.index
    )
    if (!txid) {
      console.error(
        'Error ordering access for ' + args[1] + '.  Do you have enought tokens?'
      )
      return
    }
    await this.ocean.assets.download(
      args[1],
      txid,
      dataDdo.dataToken,
      this.account,
      'downloads/' + args[1]
    )
  }

  public async compute(args: string[]) {
    const output = {}
    const dataDdo = await this.ocean.assets.resolve(args[1])
    if (!dataDdo) {
      console.error('Error resolving ' + args[1] + '.  Does this asset exists?')
      return
    }
    const algoDdo = await this.ocean.assets.resolve(args[2])
    if (!algoDdo) {
      console.error('Error resolving ' + args[2] + '.  Does this asset exists?')
      return
    }
    const computeService = await this.ocean.assets.getServiceByType(args[1], 'compute')
    if (!computeService) {
      console.error(
        'Error getting computeService for ' +
        args[1] +
        '.  Does this asset has an computeService?'
      )
      return
    }
    const algoService = await this.ocean.assets.getServiceByType(args[2], 'access')
    if (!algoService) {
      console.error(
        'Error getting accessService for algo ' +
        args[2] +
        '.  Does this asset has an accessService?'
      )
      return
    }

    const computeAddress = await this.ocean.compute.getComputeAddress(dataDdo.id, computeService.index)
    const order = await this.ocean.compute.orderAsset(
      this.account.getId(),
      dataDdo.id,
      computeService.index,
      algoDdo.id,
      undefined,
      null, // no marketplace fee
      computeAddress // CtD is the consumer of the dataset
    )
    if (!order) {
      console.error(
        'Error ordering compute for ' + args[1] + '.  Do you have enought tokens?'
      )
      return
    }

    // order the algorithm
    const orderalgo = await this.ocean.compute.orderAlgorithm(
      algoDdo.id,
      algoService.type,
      this.account.getId(),
      algoService.index,
      null, // no marketplace fee
      computeAddress // CtD is the consumer of the dataset
    )
    if (!orderalgo) {
      console.error('Error ordering algo ' + args[2] + '.  Do you have enought tokens?')
      return
    }
    const response = await this.ocean.compute.start(
      dataDdo.id,
      order,
      dataDdo.dataToken,
      this.account,
      algoDdo.id,
      undefined,
      output,
      `${computeService.index}`,
      computeService.type,
      orderalgo,
      algoDdo.dataToken
    )
    const { jobId } = response
    console.log('Compute started.  JobID: ' + jobId)
  }

  public async getCompute(args: string[]) {
    const response = await this.ocean.compute.status(
      this.account,
      undefined,
      args[1],
      null,
      true
    )
    console.log(response)
  }

  public async allowAlgo(args: string[]) {
    const ddo = await this.ocean.assets.resolve(args[1])
    if (!ddo) {
      console.error('Error resolving ' + args[1] + '.  Does this asset exists?')
      return
    }
    if (ddo.publicKey[0].owner.toLowerCase() !== this.account.getId().toLowerCase()) {
      console.error(
        'You are not the owner of this asset, and there for you cannot update it.'
      )
      return
    }
    const computeService = await this.ocean.assets.getServiceByType(args[1], 'compute')
    if (!computeService) {
      console.error(
        'Error getting computeService for ' +
        args[1] +
        '.  Does this asset has an computeService?'
      )
      return
    }
    const algoDdo = await this.ocean.assets.resolve(args[2])
    const newDdo = await this.ocean.compute.addTrustedAlgorithmtoAsset(
      ddo,
      computeService.index,
      algoDdo.id
    )
    const txid = await this.ocean.onChainMetadata.update(ddo.id, newDdo, this.account.getId())
    console.log('Asset updated')
  }

  public async disallowAlgo(args: string[]) {
    const ddo = await this.ocean.assets.resolve(args[1])
    if (!ddo) {
      console.error('Error resolving ' + args[1] + '.  Does this asset exists?')
      return
    }
    if (ddo.publicKey[0].owner.toLowerCase() !== this.account.getId().toLowerCase()) {
      console.error(
        'You are not the owner of this asset, and there for you cannot update it.'
      )
      return
    }
    const computeService = await this.ocean.assets.getServiceByType(args[1], 'compute')
    if (!computeService) {
      console.error(
        'Error getting computeService for ' +
        args[1] +
        '.  Does this asset has an computeService?'
      )
      return
    }
    const algoDdo = await this.ocean.assets.resolve(args[2])
    const newDdo = await this.ocean.compute.removeTrustedAlgorithmFromAsset(
      ddo,
      computeService.index,
      algoDdo.id
    )
    const txid = await this.ocean.onChainMetadata.update(ddo.id, newDdo, this.account.getId())
    console.log('Asset updated')
  }

  public async query(args: string[]) {
    // WIP
  }
}
