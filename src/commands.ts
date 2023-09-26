import fs from "fs";
import os from "os";
import util from "util";
import {
	createAsset,
	handleComputeOrder,
	updateAssetMetadata,
	downloadFile,
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
	amountToUnits,
	getHash,
	orderAsset,
	sendTx,
} from "@oceanprotocol/lib";
import { Signer, ethers } from "ethers";

export class Commands {
	public signer: Signer;
	public config: Config;
	public aquarius: Aquarius;
	public providerUrl: string;

	constructor(signer: Signer, network: string | number, config?: Config) {
		this.signer = signer;
		this.config = config || new ConfigHelper().getConfig(network);
		this.providerUrl = process.env.PROVIDER_URL || this.config.providerUri;
		process.env.CUSTOM_PROVIDER_URL =
			this.config.chainId === 8996 && os.type() === "Darwin"
				? "http://127.0.0.1:8030"
				: null;
		console.log("Using Provider :", this.providerUrl);
		process.env.CUSTOM_PROVIDER_URL &&
			console.log(" -> MacOS provider url :", process.env.CUSTOM_PROVIDER_URL);
		this.config.metadataCacheUri =
			this.config.chainId === 8996 && os.type() === "Darwin"
				? "http://127.0.0.1:5000"
				: null;
		this.aquarius = new Aquarius(
			process.env.AQUARIUS_URL || this.config.metadataCacheUri
		);
		console.log(
			"Using Aquarius :",
			process.env.AQUARIUS_URL || this.config.metadataCacheUri
		);
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
				this.config,
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
			this.config,
			this.aquarius
		);
		// add some more checks
		console.log("Algorithm published. DID:  " + algoDid);
	}

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

		const tx = await orderAsset(
			dataDdo,
			this.signer,
			this.config,
			datatoken,
			process.env.CUSTOM_PROVIDER_URL || this.providerUrl
		);

		if (!tx) {
			console.error(
				"Error ordering access for " +
					args[1] +
					".  Do you have enought tokens?"
			);
			return;
		}

		const orderTx = await tx.wait();

		const urlDownloadUrl = await ProviderInstance.getDownloadUrl(
			dataDdo.id,
			dataDdo.services[0].id,
			0,
			orderTx.transactionHash,
			process.env.CUSTOM_PROVIDER_URL || this.providerUrl,
			this.signer
		);
		try {
			const { filename } = await downloadFile(urlDownloadUrl, args[2]);
			console.log("File downloaded successfully:", args[2] + "/" + filename);
		} catch (e) {
			console.log(`Download url dataset failed: ${e}`);
		}
	}

	public async computeStart(args: string[]) {
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

		const computeEnvs = await ProviderInstance.getComputeEnvironments(
			process.env.CUSTOM_PROVIDER_URL || this.providerUrl
		);

		const datatoken = new Datatoken(
			this.signer,
			(await this.signer.provider.getNetwork()).chainId
		);

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
				process.env.CUSTOM_PROVIDER_URL || this.providerUrl,
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
			algoDdo,
			this.signer,
			computeEnv.consumerAddress,
			0,
			datatoken,
			this.config,
			providerInitializeComputeJob?.algorithm?.providerFee,
			process.env.CUSTOM_PROVIDER_URL || this.providerUrl
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
				dataDdo,
				this.signer,
				computeEnv.consumerAddress,
				0,
				datatoken,
				this.config,
				providerInitializeComputeJob?.datasets[i].providerFee,
				process.env.CUSTOM_PROVIDER_URL || this.providerUrl
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
		console.log("Starting compute job ...");
		const computeJobs = await ProviderInstance.computeStart(
			process.env.CUSTOM_PROVIDER_URL || this.providerUrl,
			this.signer,
			computeEnv.id,
			assets[0],
			algo
		);
		const { jobId } = computeJobs[0];
		console.log("Compute started.  JobID: " + jobId);
	}

	public async computeStop(args: string[]) {
		const jobStatus = await ProviderInstance.computeStop(
			args[1],
			await this.signer.getAddress(),
			args[2],
			process.env.CUSTOM_PROVIDER_URL || this.providerUrl,
			this.signer
		);
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

	public async disallowAlgo(args: string[]) {
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
		if (asset.services[0].compute.publisherTrustedAlgorithms) {
			console.error(
				" " + args[1] + ".  Does this asset has an computeService?"
			);
			return;
		}
		const indexToDelete =
			asset.services[0].compute.publisherTrustedAlgorithms.findIndex(
				(item) => item.did === args[2]
			);

		if (indexToDelete !== -1) {
			asset.services[0].compute.publisherTrustedAlgorithms.splice(
				indexToDelete,
				1
			);
		} else {
			console.error(
				" " +
					args[2] +
					".  is not allowed by the publisher to run on " +
					args[1]
			);
			return;
		}

		const txid = await updateAssetMetadata(
			this.signer,
			asset,
			this.providerUrl,
			this.aquarius
		);
		console.log("Asset updated " + txid);
	}

	public async getJobStatus(args: string[]) {
		const jobStatus = (await ProviderInstance.computeStatus(
			this.providerUrl,
			await this.signer.getAddress(),
			args[2],
			args[1]
		)) as ComputeJob;
		console.log(util.inspect(jobStatus, false, null, true));
	}

	public async downloadJobResults(args: string[]) {
		const jobResult = await ProviderInstance.getComputeResultUrl(
			this.providerUrl,
			this.signer,
			args[1],
			parseInt(args[2])
		);
		console.log("jobResult ", jobResult);
		try {
			const { filename } = await downloadFile(jobResult, args[3]);
			console.log("File downloaded successfully:", args[3] + "/" + filename);
		} catch (e) {
			console.log(`Download url dataset failed: ${e}`);
		}
	}

	public async mintOceanTokens(args: string[]) {
		const minAbi = [
			{
				constant: false,
				inputs: [
					{ name: "to", type: "address" },
					{ name: "value", type: "uint256" },
				],
				name: "mint",
				outputs: [{ name: "", type: "bool" }],
				payable: false,
				stateMutability: "nonpayable",
				type: "function",
			},
		];

		const tokenContract = new ethers.Contract(
			this.config.oceanTokenAddress,
			minAbi,
			this.signer
		);
		const estGasPublisher = await tokenContract.estimateGas.mint(
			this.signer.getAddress(),
			amountToUnits(null, null, "1000", 18)
		);
		await sendTx(
			estGasPublisher,
			this.signer,
			1,
			tokenContract.mint,
			await this.signer.getAddress(),
			amountToUnits(null, null, "1000", 18)
		);
	}
}
