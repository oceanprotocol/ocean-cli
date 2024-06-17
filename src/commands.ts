import fs from "fs";
import os from "os";
import util from "util";
import {
	createAsset,
	handleComputeOrder,
	updateAssetMetadata,
	downloadFile,
	isOrderable,
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
	public macOsProviderUrl: string;

	constructor(signer: Signer, network: string | number, config?: Config) {
		this.signer = signer;
		this.config = config || new ConfigHelper().getConfig(network);
		this.providerUrl = process.env.PROVIDER_URL || this.config.providerUri;
		if (
			!process.env.PROVIDER_URL &&
			this.config.chainId === 8996 &&
			os.type() === "Darwin"
		) {
			this.macOsProviderUrl = "http://127.0.0.1:8030";
		}
		console.log("Using Provider :", this.providerUrl);
		this.macOsProviderUrl &&
			console.log(" -> MacOS provider url :", this.macOsProviderUrl);
		if (
			!process.env.AQUARIUS_URL &&
			this.config.chainId === 8996 &&
			os.type() === "Darwin"
		) {
			this.config.metadataCacheUri = "http://127.0.0.1:5000";
		}
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
		const encryptDDO = args[2] === "false" ? false : true;
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
				this.aquarius,
				this.macOsProviderUrl,
				encryptDDO
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
		const encryptDDO = args[2] === "false" ? false : true;
		// add some more checks
		const algoDid = await createAsset(
			algoAsset.nft.name,
			algoAsset.nft.symbol,
			this.signer,
			algoAsset.services[0].files,
			algoAsset,
			this.providerUrl,
			this.config,
			this.aquarius,
			this.macOsProviderUrl,
			encryptDDO
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
		const encryptDDO = args[3] === "false" ? false : true;
		let updateJson;
		try {
			updateJson = JSON.parse(fs.readFileSync(args[2], "utf8"));
		} catch (e) {
			console.error("Cannot read metadata from " + args[2]);
			console.error(e);
			return;
		}
		// Get keys and values
		const keys = Object.keys(updateJson);

		for (const key of keys) {
			asset[key] = updateJson[key];
		}

		const updateAssetTx = await updateAssetMetadata(
			this.signer,
			asset,
			this.providerUrl,
			this.aquarius,
			this.macOsProviderUrl,
			encryptDDO
		);
		console.log("Asset updated. Tx: " + JSON.stringify(updateAssetTx, null, 2));
	}

	public async getDDO(args: string[]) {
		console.log("Resolving Asset with DID: " + args[1]);
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

		const providerURI =
			this.macOsProviderUrl && dataDdo.chainId === 8996
				? this.macOsProviderUrl
				: dataDdo.services[0].serviceEndpoint;
		console.log("Downloading asset using provider: ", providerURI);
		const datatoken = new Datatoken(this.signer, this.config.chainId);

		const tx = await orderAsset(
			dataDdo,
			this.signer,
			this.config,
			datatoken,
			providerURI
		);

		if (!tx) {
			console.error(
				"Error ordering access for " + args[1] + ".  Do you have enough tokens?"
			);
			return;
		}

		const orderTx = await tx.wait();

		const urlDownloadUrl = await ProviderInstance.getDownloadUrl(
			dataDdo.id,
			dataDdo.services[0].id,
			0,
			orderTx.transactionHash,
			providerURI,
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
		const inputDatasetsString = args[1];
		let inputDatasets = [];

		if (
			inputDatasetsString.includes("[") ||
			inputDatasetsString.includes("]")
		) {
			const processedInput = inputDatasetsString
				.replaceAll("]", "")
				.replaceAll("[", "");
			inputDatasets = processedInput.split(",");
		} else {
			inputDatasets.push(inputDatasetsString);
		}

		var ddos = [];

		for (var dataset in inputDatasets) {
			const dataDdo = await this.aquarius.waitForAqua(inputDatasets[dataset]);
			if (!dataDdo) {
				console.error(
					"Error fetching DDO " + dataset[1] + ".  Does this asset exists?"
				);
				return;
			} else {
				ddos.push(dataDdo);
			}
		}
		if (ddos.length <= 0 || ddos.length != inputDatasets.length) {
			console.error("Not all the data ddos are available.");
			return;
		}
		const providerURI =
			this.macOsProviderUrl && ddos[0].chainId === 8996
				? this.macOsProviderUrl
				: ddos[0].services[0].serviceEndpoint;

		const algoDdo = await this.aquarius.waitForAqua(args[2]);
		if (!algoDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		const computeEnvs = await ProviderInstance.getComputeEnvironments(
			this.macOsProviderUrl || this.providerUrl
		);

		const datatoken = new Datatoken(
			this.signer,
			(await this.signer.provider.getNetwork()).chainId
		);

		const mytime = new Date();
		const computeMinutes = 5;
		mytime.setMinutes(mytime.getMinutes() + computeMinutes);
		const computeValidUntil = Math.floor(mytime.getTime() / 1000);

		const computeEnvID = args[3];
		const chainComputeEnvs = computeEnvs[algoDdo.chainId];
		var computeEnv = chainComputeEnvs[0];

		if (computeEnvID && computeEnvID.length > 1) {
			for (const index in chainComputeEnvs) {
				if (computeEnvID == chainComputeEnvs[index].id) {
					computeEnv = chainComputeEnvs[index];
					continue;
				}
			}
		}

		const algo: ComputeAlgorithm = {
			documentId: algoDdo.id,
			serviceId: algoDdo.services[0].id,
		};

		var assets = [];
		for (const dataDdo in ddos) {
			const canStartCompute = isOrderable(
				ddos[dataDdo],
				ddos[dataDdo].services[0].id,
				algo,
				algoDdo
			);
			if (!canStartCompute) {
				console.error(
					"Error Cannot start compute job using the datasets DIDs & algorithm DID provided"
				);
				return;
			}
			assets.push({
				documentId: ddos[dataDdo].id,
				serviceId: ddos[dataDdo].services[0].id,
			});
		}

		console.log("Starting compute job using provider: ", providerURI);
		const providerInitializeComputeJob =
			await ProviderInstance.initializeCompute(
				assets,
				algo,
				computeEnv.id,
				computeValidUntil,
				providerURI,
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

		console.log("Ordering algorithm: ", args[2]);
		algo.transferTxId = await handleComputeOrder(
			providerInitializeComputeJob.algorithm,
			algoDdo,
			this.signer,
			computeEnv.consumerAddress,
			0,
			datatoken,
			this.config,
			providerInitializeComputeJob?.algorithm?.providerFee,
			providerURI
		);
		if (!algo.transferTxId) {
			console.error(
				"Error ordering compute for algorithm with DID: " +
					args[2] +
					".  Do you have enough tokens?"
			);
			return;
		}

		for (let i = 0; i < ddos.length; i++) {
			assets[i].transferTxId = await handleComputeOrder(
				providerInitializeComputeJob.datasets[i],
				ddos[i],
				this.signer,
				computeEnv.consumerAddress,
				0,
				datatoken,
				this.config,
				providerInitializeComputeJob?.datasets[i].providerFee,
				providerURI
			);
			if (!assets[i].transferTxId) {
				console.error(
					"Error ordering dataset with DID: " +
						assets[i] +
						".  Do you have enough tokens?"
				);
				return;
			}
		}

		const additionalDatasets = assets.length > 1 ? assets.slice(1) : null;
		console.log(
			"Starting compute job on " +
				assets[0].documentId +
				" with additional datasets:" +
				(!additionalDatasets ? "none" : additionalDatasets[0].documentId)
		);
		const computeJobs = await ProviderInstance.computeStart(
			providerURI,
			this.signer,
			computeEnv.id,
			assets[0],
			algo,
			null,
			additionalDatasets
		);
		if (computeJobs && computeJobs[0]) {
			const { jobId } = computeJobs[0];
			console.log("Compute started.  JobID: " + jobId);
		} else {
			console.log("Error while starting the compute job: ", computeJobs);
		}
	}

	public async computeStop(args: string[]) {
		const dataDdo = await this.aquarius.waitForAqua(args[1]);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}
		const providerURI =
			this.macOsProviderUrl && dataDdo.chainId === 8996
				? this.macOsProviderUrl
				: dataDdo.services[0].serviceEndpoint;

		const jobStatus = await ProviderInstance.computeStop(
			args[1],
			await this.signer.getAddress(),
			args[2],
			providerURI,
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
		const encryptDDO = args[3] === "false" ? false : true;
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
			this.aquarius,
			this.macOsProviderUrl,
			encryptDDO
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
		const encryptDDO = args[3] === "false" ? false : true;
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
			this.aquarius,
			this.macOsProviderUrl,
			encryptDDO
		);
		console.log("Asset updated " + txid);
	}

	public async getJobStatus(args: string[]) {
		const dataDdo = await this.aquarius.waitForAqua(args[1]);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}
		const providerURI =
			this.macOsProviderUrl && dataDdo.chainId === 8996
				? this.macOsProviderUrl
				: dataDdo.services[0].serviceEndpoint;

		const jobStatus = (await ProviderInstance.computeStatus(
			providerURI,
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
