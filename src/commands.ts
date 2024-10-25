import fs from "fs";
import os from "os";
import util from "util";
import {
	handleComputeOrder,
	updateAssetMetadata,
	downloadFile,
	isOrderable,
	createAssetV5,
	createDatatokenAndPricing,
	isVerifiableCredential,
	createAssetV4,
	getDataDownalodV4,
	getDataDownalodV5,
} from "./helpers";
import {
	Aquarius,
	Asset,
	ComputeAlgorithm,
	ComputeJob,
	Config,
	ConfigHelper,
	Datatoken,
	ProviderInstance,
	amountToUnits,
	getHash,
	orderAsset,
	sendTx,
} from "@oceanprotocol/lib";
import { Signer, ethers } from "ethers";
import { DDOVersion } from "./ddoVersions";

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
		let asset: Asset;
		try {
			asset = JSON.parse(fs.readFileSync(args[1], "utf8"));
		} catch (e) {
			console.error("Cannot read metadata from " + args[1]);
			console.error(e);
			return;
		}
		const encryptDDO = args[2] === "false" ? false : true;
		switch (asset.version) {
			case DDOVersion.V4_1_0:
			case DDOVersion.V4_3_0:
			case DDOVersion.V4_5_0:
				await createAssetV4(
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
				break;

			case DDOVersion.V5_0_0:
				await createAssetV5(
					asset.nft.name,
					asset.nft.symbol,
					this.signer,
					asset.credentialSubject.services[0].files,
					asset,
					this.providerUrl,
					this.config,
					this.aquarius,
					this.macOsProviderUrl,
					encryptDDO
				);
				break;

			default:
				console.error("Unsupported asset type or version");
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
		switch (algoAsset.version) {
			case DDOVersion.V4_1_0:
			case DDOVersion.V4_3_0:
			case DDOVersion.V4_5_0:
				await createAssetV4(
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
				break
			case DDOVersion.V5_0_0:
				await createAssetV5(
					algoAsset.nft.name,
					algoAsset.nft.symbol,
					this.signer,
					algoAsset.credentialSubject.services[0].files,
					algoAsset,
					this.providerUrl,
					this.config,
					this.aquarius,
					this.macOsProviderUrl,
					encryptDDO
				);
				break
		}
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
		} else console.log(util.inspect(resolvedDDO, false, null, true));
	}

	public async download(args: string[]) {
		const dataDdo = await this.aquarius.waitForAqua(args[1]);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		let chainId: number
		let serviceEndpoint: string
		let serviceId: string
		let did: string
		switch (dataDdo.version) {
			case DDOVersion.V4_1_0:
			case DDOVersion.V4_3_0:
			case DDOVersion.V4_5_0:
				({ chainId, serviceEndpoint, serviceId, did } = getDataDownalodV4(dataDdo));
				break;
			case DDOVersion.V5_0_0:
				({ chainId, serviceEndpoint, serviceId, did } = getDataDownalodV5(dataDdo));
				break;

			default:
				console.error("Unsupported asset type or version");
				return;
		}

		const providerURI =
			this.macOsProviderUrl && chainId === 8996
				? this.macOsProviderUrl
				: serviceEndpoint;
		console.log("Downloading asset using provider: ", providerURI);
		const datatoken = new Datatoken(this.signer, this.config.chainId);

		//TODO update in oceanJs also for v5 (add credentialSubject)
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
			did,
			serviceId,
			0,
			orderTx.transactionHash,
			providerURI,
			this.signer
		);
		console.log("urlDownloadUrl", urlDownloadUrl)
		try {
			const path = args[2] ? args[2] : '.';
			const { filename } = await downloadFile(urlDownloadUrl, path);
			console.log("File downloaded successfully:", path + "/" + filename);
		} catch (e) {
			console.log(`Download url dataset failed: ${e}`);
		}
		return
	}

	public async computeStart(args: string[]) {
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

		const ddos = [];

		for (const dataset in inputDatasets) {
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

		let chainId
		let serviceEndpoint
		if (isVerifiableCredential(ddos[0])) {
			chainId = (ddos[0] as any).credentialSubject.chainId
			serviceEndpoint = (ddos[0] as any).credentialSubject.services[0].serviceEndpoint
		} else {
			chainId = ddos[0].chainId
			serviceEndpoint = ddos[0].services[0].serviceEndpoint
		}
		const providerURI =
			this.macOsProviderUrl && chainId === 8996
				? this.macOsProviderUrl
				: serviceEndpoint;

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
		let algoChainId
		let algoId
		let algoServiceId
		let algoMetadataAlgoritm
		if (isVerifiableCredential(algoDdo)) {
			algoChainId = (algoDdo as any).credentialSubject.chainId
			algoId = (algoDdo as any).credentialSubject.id
			algoServiceId = (algoDdo as any).credentialSubject.services[0].id
			algoMetadataAlgoritm = (algoDdo as any).credentialSubject.metadata.algorithm
		} else {
			algoChainId = algoDdo.chainId
			algoId = algoDdo.id
			algoServiceId = algoDdo.services[0].id
			algoMetadataAlgoritm = algoDdo.metadata.algorithm
		}
		const chainComputeEnvs = computeEnvs[algoChainId];
		let computeEnv = chainComputeEnvs[0];

		if (computeEnvID && computeEnvID.length > 1) {
			for (const index in chainComputeEnvs) {
				if (computeEnvID == chainComputeEnvs[index].id) {
					computeEnv = chainComputeEnvs[index];
					continue;
				}
			}
		}

		const algo: ComputeAlgorithm = {
			documentId: algoId,
			serviceId: algoServiceId,
			meta: algoMetadataAlgoritm
		};

		const assets = [];
		for (const dataDdo in ddos) {
			let serviceId
			let id
			if (isVerifiableCredential(ddos[dataDdo])) {
				serviceId = ddos[dataDdo].credentialSubject.services[0].id
				id = ddos[dataDdo].credentialSubject.id
			} else {
				serviceId = ddos[dataDdo].services[0].id
				id = ddos[dataDdo].id
			}
			const canStartCompute = isOrderable(
				ddos[dataDdo],
				serviceId,
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
				documentId: id,
				serviceId: serviceId,
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
			const { jobId, agreementId } = computeJobs[0];
			console.log("Compute started.  JobID: " + jobId);
			console.log("Agreement ID: " + agreementId);
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
		const hasAgreementId = args.length === 4;

		const jobId = args[2]
		let agreementId = null;
		if (hasAgreementId) {
			agreementId = args[3];
		}

		const providerURI =
			this.macOsProviderUrl && dataDdo.chainId === 8996
				? this.macOsProviderUrl
				: dataDdo.services[0].serviceEndpoint;

		const jobStatus = await ProviderInstance.computeStop(
			args[1],
			await this.signer.getAddress(),
			jobId,
			providerURI,
			this.signer,
			agreementId
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
		const assetOwner = asset.nft.owner
		let serviceType
		if (isVerifiableCredential(asset)) {
			serviceType = (asset as any).credentialSubject.services[0].type
		} else {
			serviceType = asset.services[0].type
		}
		if (assetOwner !== (await this.signer.getAddress())) {
			console.error(
				"You are not the owner of this asset, and there for you cannot update it."
			);
			return;
		}

		if (serviceType !== "compute") {
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
		let filesChecksum
		let serviceId
		let serviceEndpoint
		let containerChecksum
		let did
		try {
			if (isVerifiableCredential(algoAsset)) {
				did = (algoAsset as any).credentialSubject.id
				serviceId = (algoAsset as any).credentialSubject.services[0].id
				serviceEndpoint = (algoAsset as any).credentialSubject.services[0].serviceEndpoint
				containerChecksum =
					(algoAsset as any).credentialSubject.metadata.algorithm.container.entrypoint +
					(algoAsset as any).credentialSubject.metadata.algorithm.container.checksum;
			} else {
				did = algoAsset.id
				serviceId = algoAsset.services[0].id
				serviceEndpoint = algoAsset.services[0].serviceEndpoint
				containerChecksum =
					algoAsset.metadata.algorithm.container.entrypoint +
					algoAsset.metadata.algorithm.container.checksum;
			}
			filesChecksum = await ProviderInstance.checkDidFiles(
				did,
				serviceId,
				serviceEndpoint,
				true
			);

		} catch (e) {
			console.error("Error checking algo files: ", e);
			return;
		}


		const trustedAlgorithm = {
			did: did,
			containerSectionChecksum: getHash(containerChecksum),
			filesChecksum: filesChecksum?.[0]?.checksum,
		};
		if (isVerifiableCredential(asset)) {
			asset.services[0].compute.publisherTrustedAlgorithms.push(trustedAlgorithm);
		} else {
			(asset as any).credentialSubject.services[0].compute.publisherTrustedAlgorithms.push(trustedAlgorithm);
		}

		try {
			const txid = await updateAssetMetadata(
				this.signer,
				asset,
				this.providerUrl,
				this.aquarius,
				this.macOsProviderUrl,
				encryptDDO
			);
			console.log("Successfully updated asset metadata: " + txid);
		} catch (e) {
			console.error("Error updating asset metadata: ", e);
			return;
		}
	}

	public async disallowAlgo(args: string[]) {
		const asset = await this.aquarius.waitForAqua(args[1]);
		if (!asset) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}
		const nftOwner = asset.nft.owner
		let serviceType
		let publisherTrustedAlgorithms
		if (isVerifiableCredential(asset)) {
			serviceType = (asset as any).credentialSubject.services[0].type
			publisherTrustedAlgorithms = (asset as any).credentialSubject.services[0].compute.publisherTrustedAlgorithms
		} else {
			serviceType = asset.services[0].type
			publisherTrustedAlgorithms = asset.services[0].compute.publisherTrustedAlgorithms

		}
		if (nftOwner !== (await this.signer.getAddress())) {
			console.error(
				"You are not the owner of this asset, and there for you cannot update it."
			);
			return;
		}
		if (serviceType !== "compute") {
			console.error(
				"Error getting computeService for " +
				args[1] +
				".  Does this asset has an computeService?"
			);
			return;
		}
		if (!publisherTrustedAlgorithms) {
			console.error(
				" " + args[1] + ".  Does this asset has an computeService?"
			);
			return;
		}
		const encryptDDO = args[3] === "false" ? false : true;
		if (isVerifiableCredential(asset)) {
			const indexToDelete =
				(asset as any).credentialSubject.services[0].compute.publisherTrustedAlgorithms.findIndex(
					(item) => item.did === args[2]
				);

			if (indexToDelete !== -1) {
				(asset as any).credentialSubject.services[0].compute.publisherTrustedAlgorithms.splice(
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
		} else {
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
		// args[1] - did (for checking if data asset exists, legacy)
		// args[2] - jobId
		// args[3] - agreementId
		const hasAgreementId = args.length === 4;

		const dataDdo = await this.aquarius.waitForAqua(args[1]);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}
		const jobId = args[2]
		let agreementId = null;
		if (hasAgreementId) {
			agreementId = args[3];
		}
		const providerURI =
			this.macOsProviderUrl && dataDdo.chainId === 8996
				? this.macOsProviderUrl
				: dataDdo.services[0].serviceEndpoint;

		const jobStatus = (await ProviderInstance.computeStatus(
			providerURI,
			await this.signer.getAddress(),
			jobId,
			agreementId
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
			const path = args[3] ? args[3] : '.';
			const { filename } = await downloadFile(jobResult, path, parseInt(args[2]));
			console.log("File downloaded successfully:", path + "/" + filename);
		} catch (e) {
			console.log(`Download url dataset failed: ${e}`);
		}
	}

	public async mintOceanTokens() {
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

	public async addService(args: string[]) {
		const asset = await this.aquarius.waitForAqua(args[1]);
		if (!asset) {
			console.error("Error fetching DDO " + args[1] + ".  Does this asset exists?");
			return;
		}
		let service;
		try {
			service = JSON.parse(fs.readFileSync(args[2], "utf8"));
		} catch (e) {
			console.error("Cannot read service data from" + args[2]);
			console.error(e);
			return;
		}

		const price = parseInt(args[3]) || 0

		const { datatokenAddress } = await createDatatokenAndPricing(
			asset,
			this.signer,
			this.config,
			price
		)
		service.files.datatokenAddress = datatokenAddress;
		service.datatokenAddress = datatokenAddress;
		service.serviceEndpoint = this.providerUrl;
		if ((asset as any).credentialSubject) {
			service.files.nftAddress = (asset as any).credentialSubject.nftAddress;
			service.files = await ProviderInstance.encrypt(
				service.files,
				(asset as any).credentialSubject.chainId,
				this.providerUrl
			);
			(asset as any).credentialSubject.services.push(service)
		} else {
			service.files.nftAddress = asset.nftAddress;
			service.files = await ProviderInstance.encrypt(
				service.files,
				asset.chainId,
				this.providerUrl
			);
			asset.services.push(service)
		}

		await updateAssetMetadata(
			this.signer,
			asset,
			this.providerUrl,
			this.aquarius,
			this.macOsProviderUrl,
		);

		console.log("Service added");
	}
}
