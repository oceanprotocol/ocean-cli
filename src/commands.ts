import fs from "fs";
import {
	createAsset,
	handleComputeOrder,
	orderAsset,
	updateAssetMetadata,
} from "./helpers";
import {
	Aquarius,
	Asset,
	ComputeAlgorithm,
	ComputeAsset,
	ComputeJob,
	Config,
	ConfigHelper,
	DDO,
	Datatoken,
	ProviderInstance,
	downloadFile,
	getHash,
} from "@oceanprotocol/lib";
import { Signer } from "ethers";

export class Commands {
	public signer: Signer;
	public config: Config;
	public aquarius: Aquarius;
	public providerUrl: string;

	constructor(signer: Signer, network?: string | number, config?: Config) {
		this.signer = signer;
		this.config = config || new ConfigHelper().getConfig(network || "unknown");
		this.aquarius = new Aquarius(this.config.metadataCacheUri);
		this.providerUrl = this.config.providerUri;
	}
	// utils
	public async sleep(ms: number) {
		return new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	// commands
	public async publish(args: string[]) {
		console.log("start publishing");
		let asset: Asset;
		try {
			asset = JSON.parse(fs.readFileSync(args[1], "utf8"));
		} catch (e) {
			console.error("Cannot read metadata from " + args[1]);
			console.error(e);
			return;
		}
		try {
			// add some more checks
			const urlAssetId = await createAsset(
				asset.nft.name,
				asset.nft.symbol,
				this.signer,
				asset.services[0].files,
				asset,
				this.providerUrl,
				this.config.nftFactoryAddress,
				this.aquarius
			);
			console.log("Asset published. ID:  " + urlAssetId);
		} catch (e) {
			console.error("Error when publishing dataset from file: " + args[1]);
			console.error(e);
			return;
		}
	}

	public async publishAlgo(args: string[]) {
		let algoAsset;
		try {
			algoAsset = JSON.parse(fs.readFileSync(args[1], "utf8"));
		} catch (e) {
			console.error("Cannot read metadata from " + args[1]);
			console.error(e);
			return;
		}

		// add some more checks
		const algoDid = await createAsset(
			algoAsset.nft.name,
			algoAsset.nft.symbol,
			this.signer,
			algoAsset.services[0].files,
			algoAsset,
			this.providerUrl,
			this.config.nftFactoryAddress,
			this.aquarius
		);
		// add some more checks
		console.log("Algorithm published. DID:  " + algoDid);
	}

	public async getDDO(args: string[]) {
		console.log("Resolving Asset with DID :" + args[1]);
		const resolvedDDO = await this.aquarius.waitForAqua(args[1]);
		if (!resolvedDDO) {
			console.error(
				"Error fetching Asset with DID: " +
					args[1] +
					".  Does this asset exists?"
			);
		} else console.log(resolvedDDO);
	}

	public async download(args: string[]) {
		const dataDdo = await this.aquarius.waitForAqua(args[1]);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		const datatoken = new Datatoken(this.signer, this.config.chainId);

		const orderTx = await orderAsset(
			dataDdo.id,
			dataDdo.services[0].datatokenAddress,
			await this.signer.getAddress(),
			dataDdo.services[0].id,
			0,
			datatoken,
			this.providerUrl
		);

		if (!orderTx) {
			console.error(
				"Error ordering access for " +
					args[1] +
					".  Do you have enought tokens?"
			);
			return;
		}

		const urlDownloadUrl = await ProviderInstance.getDownloadUrl(
			dataDdo.id,
			dataDdo.services[0].id,
			0,
			orderTx.transactionHash,
			this.providerUrl,
			this.signer
		);
		try {
			await downloadFile(urlDownloadUrl);
		} catch (e) {
			console.log(`Download url dataset failed: ${e}`);
		}
	}

	public async compute(args: string[]) {
		const output = {};
		const dataDdo = await this.aquarius.waitForAqua(args[1]);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		const algoDdo = await this.aquarius.waitForAqua(args[2]);
		if (!algoDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		// get compute environments
		const computeEnvs = await ProviderInstance.getComputeEnvironments(
			this.providerUrl
		);

		const datatoken = new Datatoken(
			this.signer,
			(await this.signer.provider.getNetwork()).chainId
		);

		// let's have 5 minute of compute access
		const mytime = new Date();
		const computeMinutes = 5;
		mytime.setMinutes(mytime.getMinutes() + computeMinutes);
		const computeValidUntil = Math.floor(mytime.getTime() / 1000);

		const computeEnv = computeEnvs[dataDdo.chainId][0];

		const assets: ComputeAsset[] = [
			{
				documentId: dataDdo.id,
				serviceId: dataDdo.services[0].id,
			},
		];
		const dtAddressArray = [dataDdo.services[0].datatokenAddress];
		const algo: ComputeAlgorithm = {
			documentId: algoDdo.id,
			serviceId: algoDdo.services[0].id,
		};

		const providerInitializeComputeJob =
			await ProviderInstance.initializeCompute(
				assets,
				algo,
				computeEnv.id,
				computeValidUntil,
				this.providerUrl,
				await this.signer.getAddress()
			);
		if (
			!providerInitializeComputeJob ||
			"error" in providerInitializeComputeJob.algorithm
		) {
			console.error(
				"Error initializing Provider for the compute job using dataset DID " +
					args[1] +
					" and algorithm DID " +
					args[2]
			);
			return;
		}

		algo.transferTxId = await handleComputeOrder(
			providerInitializeComputeJob.algorithm,
			algoDdo.services[0].datatokenAddress,
			this.signer,
			computeEnv.consumerAddress,
			0,
			datatoken,
			this.config
		);
		if (!algo.transferTxId) {
			console.error(
				"Error ordering compute for algorithm with DID: " +
					args[2] +
					".  Do you have enought tokens?"
			);
			return;
		}

		for (let i = 0; i < providerInitializeComputeJob.datasets.length; i++) {
			assets[i].transferTxId = await handleComputeOrder(
				providerInitializeComputeJob.datasets[i],
				dtAddressArray[i],
				this.signer,
				computeEnv.consumerAddress,
				0,
				datatoken,
				this.config
			);
			if (!assets[i].transferTxId) {
				console.error(
					"Error ordering dataset with DID: " +
						args[1] +
						".  Do you have enought tokens?"
				);
				return;
			}
		}

		const computeJobs = await ProviderInstance.computeStart(
			this.providerUrl,
			this.signer,
			computeEnv.id,
			assets[0],
			algo
		);
		const { jobId } = computeJobs[0];
		console.log("Compute started.  JobID: " + jobId);
	}

	public async getCompute(args: string[]) {
		const jobStatus = (await ProviderInstance.computeStatus(
			this.providerUrl,
			await this.signer.getAddress(),
			args[2],
			args[1]
		)) as ComputeJob;
		console.log(jobStatus);
	}

	public async allowAlgo(args: string[]) {
		const asset = await this.aquarius.waitForAqua(args[1]);
		if (!asset) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		if (asset.nft.owner !== (await this.signer.getAddress())) {
			console.error(
				"You are not the owner of this asset, and there for you cannot update it."
			);
			return;
		}

		if (asset.services[0].type !== "compute") {
			console.error(
				"Error getting computeService for " +
					args[1] +
					".  Does this asset has an computeService?"
			);
			return;
		}
		const algoAsset = await this.aquarius.waitForAqua(args[2]);
		if (!algoAsset) {
			console.error(
				"Error fetching DDO " + args[2] + ".  Does this asset exists?"
			);
			return;
		}

		const filesChecksum = await ProviderInstance.checkDidFiles(
			algoAsset.id,
			algoAsset.services[0].id,
			algoAsset.services[0].serviceEndpoint,
			true
		);

		const containerChecksum =
			algoAsset.metadata.algorithm.container.entrypoint +
			algoAsset.metadata.algorithm.container.checksum;
		const trustedAlgorithm = {
			did: algoAsset.id,
			containerSectionChecksum: getHash(containerChecksum),
			filesChecksum: filesChecksum?.[0]?.checksum,
		};
		asset.services[0].compute.publisherTrustedAlgorithms.push(trustedAlgorithm);
		const txid = await updateAssetMetadata(
			this.signer,
			asset,
			this.providerUrl,
			this.aquarius
		);
		console.log("Asset updated " + txid);
	}

	// public async disallowAlgo(args: string[]) {
	// 	const ddo = await this.ocean.assets.resolve(args[1]);
	// 	if (!ddo) {
	// 		console.error(
	// 			"Error resolving " + args[1] + ".  Does this asset exists?"
	// 		);
	// 		return;
	// 	}
	// 	if (
	// 		ddo.publicKey[0].owner.toLowerCase() !==
	// 		this.account.getId().toLowerCase()
	// 	) {
	// 		console.error(
	// 			"You are not the owner of this asset, and there for you cannot update it."
	// 		);
	// 		return;
	// 	}
	// 	const computeService = await this.ocean.assets.getServiceByType(
	// 		args[1],
	// 		"compute"
	// 	);
	// 	if (!computeService) {
	// 		console.error(
	// 			"Error getting computeService for " +
	// 				args[1] +
	// 				".  Does this asset has an computeService?"
	// 		);
	// 		return;
	// 	}
	// 	const algoDdo = await this.ocean.assets.resolve(args[2]);
	// 	const newDdo = await this.ocean.compute.removeTrustedAlgorithmFromAsset(
	// 		ddo,
	// 		computeService.index,
	// 		algoDdo.id
	// 	);
	// 	const txid = await this.ocean.onChainMetadata.update(
	// 		ddo.id,
	// 		newDdo,
	// 		this.account.getId()
	// 	);
	// 	console.log("Asset updated");
	// }

	public async editAsset(args: string[]) {
		const asset = await this.aquarius.waitForAqua(args[1]);
		if (!asset) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}
		let updateJson;
		try {
			updateJson = JSON.parse(fs.readFileSync(args[1], "utf8"));
		} catch (e) {
			console.error("Cannot read metadata from " + args[1]);
			console.error(e);
			return;
		}
		// Get keys and values
		const keys = Object.keys(updateJson);

		for (const key in keys) {
			asset[key] = updateJson[key];
		}

		const updateAssetTx = await updateAssetMetadata(
			this.signer,
			asset,
			this.providerUrl,
			this.aquarius
		);
		console.log("Asset updated " + updateAssetTx);
	}
}
