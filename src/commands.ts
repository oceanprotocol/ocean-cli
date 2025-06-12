import fs from "fs";
import util from "util";
import {
	createAssetUtil,
	handleComputeOrder,
	updateAssetMetadata,
	downloadFile,
	isOrderable,
	getMetadataURI,
	getIndexingWaitSettings,
	IndexerWaitParams,
	fixAndParseProviderFees,
	getConfigByChainId,
} from "./helpers.js";
import {
	Aquarius,
	ComputeAlgorithm,
	ComputeJob,
	ComputeOutput,
	Config,
	ConfigHelper,
	Datatoken,
	ProviderInstance,
	amountToUnits,
	getHash,
	orderAsset,
	sendTx,
	unitsToAmount,
	EscrowContract
} from "@oceanprotocol/lib";
import { Asset } from '@oceanprotocol/ddo-js';
import { Signer, ethers } from "ethers";
import { interactiveFlow } from "./interactiveFlow.js";
import { publishAsset } from "./publishAsset.js";
import chalk from 'chalk';

export class Commands {
	public signer: Signer;
	public config: Config;
	public aquarius: Aquarius;
	public oceanNodeUrl: string;
	// optional settings for indexing wait time
	private indexingParams: IndexerWaitParams;

	constructor(signer: Signer, network: string | number, config?: Config) {
		this.signer = signer;
		this.config = config || new ConfigHelper().getConfig(network);
		this.oceanNodeUrl = process.env.NODE_URL;
		this.indexingParams = getIndexingWaitSettings();
		console.log("Using Ocean Node URL :", this.oceanNodeUrl);
		this.config.nodeUri = this.oceanNodeUrl;
		this.aquarius = new Aquarius(this.oceanNodeUrl);
	}

	public async start() {
		console.log("Starting the interactive CLI flow...\n\n");
		const data = await interactiveFlow(this.oceanNodeUrl); // Collect data via CLI
		await publishAsset(this.aquarius, data, this.signer, this.config); // Publish asset with collected data
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
		let asset;
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
			const urlAssetId = await createAssetUtil(
				asset.indexedMetadata.nft.name,
				asset.indexedMetadata.nft.symbol,
				this.signer,
				asset.services[0].files,
				asset,
				this.oceanNodeUrl,
				this.config,
				this.aquarius,
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
		let algoAsset: Asset;
		try {
			algoAsset = JSON.parse(fs.readFileSync(args[1], "utf8"));
		} catch (e) {
			console.error("Cannot read metadata from " + args[1]);
			console.error(e);
			return;
		}
		const encryptDDO = args[2] === "false" ? false : true;
		// add some more checks
		try {
			const algoDid = await createAssetUtil(
				algoAsset.indexedMetadata.nft.name,
				algoAsset.indexedMetadata.nft.symbol,
				this.signer,
				algoAsset.services[0].files,
				algoAsset,
				this.oceanNodeUrl,
				this.config,
				this.aquarius,
				encryptDDO
			);
			// add some more checks
			console.log("Algorithm published. DID:  " + algoDid);
		} catch (e) {
			console.error("Error when publishing dataset from file: " + args[1]);
			console.error(e);
			return;
		}
	}

	public async editAsset(args: string[]) {
		const asset = await this.aquarius.waitForIndexer(
			args[1],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
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
			this.oceanNodeUrl,
			this.aquarius,
			encryptDDO
		);
		console.log("Asset updated. Tx: " + JSON.stringify(updateAssetTx, null, 2));
	}

	public async getDDO(args: string[]) {
		console.log("Resolving Asset with DID: " + args[1]);
		const resolvedDDO = await this.aquarius.waitForIndexer(
			args[1],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!resolvedDDO) {
			console.error(
				"Error fetching Asset with DID: " +
				args[1] +
				".  Does this asset exists?"
			);
		} else console.log(util.inspect(resolvedDDO, false, null, true));
	}

	public async download(args: string[]) {
		const dataDdo = await this.aquarius.waitForIndexer(
			args[1],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		const datatoken = new Datatoken(
			this.signer,
			this.config.chainId,
			this.config
		);

		const tx = await orderAsset(
			dataDdo,
			this.signer,
			this.config,
			datatoken,
			this.oceanNodeUrl
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
			this.oceanNodeUrl,
			this.signer
		);
		try {
			const path = args[2] ? args[2] : ".";
			const { filename } = await downloadFile(urlDownloadUrl, path);
			console.log("File downloaded successfully:", path + "/" + filename);
		} catch (e) {
			console.log(`Download url dataset failed: ${e}`);
		}
	}

	public async initializeCompute(args: string[]) {
		const inputDatasetsString = args[1];
		let inputDatasets = [];

		if (
			inputDatasetsString.includes("[") &&
			inputDatasetsString.includes("]")
		) {
			const processedInput = inputDatasetsString
				.replaceAll("]", "")
				.replaceAll("[", "");
			if (processedInput.indexOf(",") > -1) {
				inputDatasets = processedInput.split(",");
			}
		} else {
			inputDatasets.push(inputDatasetsString);
		}

		const ddos = [];

		for (const dataset in inputDatasets) {
			const dataDdo = await this.aquarius.waitForIndexer(
				inputDatasets[dataset],
				null,
				null,
				this.indexingParams.retryInterval,
				this.indexingParams.maxRetries
			);
			if (!dataDdo) {
				console.error(
					"Error fetching DDO " + dataset[1] + ".  Does this asset exists?"
				);
				return;
			} else {
				ddos.push(dataDdo);
			}
		}
		if (
			inputDatasets.length > 0 &&
			(ddos.length <= 0 || ddos.length != inputDatasets.length)
		) {
			console.error("Not all the data ddos are available.");
			return;
		}
		let providerURI = this.oceanNodeUrl;
		if (ddos.length > 0) {
			providerURI = ddos[0].services[0].serviceEndpoint;
		}

		const algoDdo = await this.aquarius.waitForIndexer(
			args[2],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!algoDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		const computeEnvs = await ProviderInstance.getComputeEnvironments(
			this.oceanNodeUrl
		);

		if (!computeEnvs || computeEnvs.length < 1) {
			console.error(
				"Error fetching compute environments. No compute environments available."
			);
			return;
		}

		const computeEnvID = args[3];
		// NO chainId needed anymore (is not part of ComputeEnvironment spec anymore)
		// const chainComputeEnvs = computeEnvs[computeEnvID]; // was algoDdo.chainId
		let computeEnv = null; // chainComputeEnvs[0];

		if (computeEnvID && computeEnvID.length > 1) {
			for (const index in computeEnvs) {
				if (computeEnvID == computeEnvs[index].id) {
					computeEnv = computeEnvs[index];
					break;
				}
			}
		}
		if (!computeEnv || !computeEnvID) {
			console.error(
				"Error fetching compute environment. No compute environment matches id: ",
				computeEnvID
			);
			return;
		}

		const algo: ComputeAlgorithm = {
			documentId: algoDdo.id,
			serviceId: algoDdo.services[0].id,
			meta: algoDdo.metadata.algorithm,
		};

		const assets = [];
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
		const maxJobDuration = Number(args[4])
		if (!maxJobDuration) {
			console.error(
				"Error initializing Provider for the compute job using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because maxJobDuration was not provided."
			);
			return;
		}
		if (maxJobDuration < 0) {
			console.error(
				"Error initializing Provider for the compute job using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because maxJobDuration is less than 0. It should be in seconds."
			);
			return;
		}
		let supportedMaxJobDuration: number = maxJobDuration;
		if (maxJobDuration > computeEnv.maxJobDuration) {
			supportedMaxJobDuration = computeEnv.maxJobDuration;
		}
		const paymentToken = args[5]
		if (!paymentToken) {
			console.error(
				"Error initializing Provider for the compute job using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because paymentToken was not provided."
			);
			return;
		}
		const chainId = await this.signer.getChainId()
		if (!Object.keys(computeEnv.fees).includes(chainId.toString())) {
			console.error(
				"Error starting paid compute using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because chainId is not supported by compute environment. " +
				args[3] +
				". Supported chain IDs: " +
				computeEnv.fees.keys()
			);
			return;
		}
		let found: boolean = false;
		for (const fee of computeEnv.fees[chainId.toString()]) {
			if (fee.feeToken.toLowerCase() === paymentToken.toLowerCase()) {
				found = true;
				break;
			}
		}
		if (found === false) {
			console.error(
				"Error initializing Provider for the compute job using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because paymentToken is not supported by this environment " +
				args[3]
			);
			return;
		}
		const resources = args[6] // resources object should be stringified in cli when calling initializeCompute
		if (!resources) {
			console.error(
				"Error initializing Provider for the compute job using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because resources for compute were not provided."
			);
			return;
		}
		const parsedResources = JSON.parse(resources);
		const providerInitializeComputeJob =
			await ProviderInstance.initializeCompute(
				assets,
				algo,
				computeEnv.id,
				paymentToken,
				supportedMaxJobDuration,
				providerURI,
				this.signer, // V1 was this.signer.getAddress()
				parsedResources
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
		console.log(chalk.yellow('\n--- Payment Details ---'));
		console.log(JSON.stringify(providerInitializeComputeJob, null, 2));
		return providerInitializeComputeJob;

	}

	public async computeStart(args: string[]) {
		const inputDatasetsString = args[1];
		let inputDatasets = [];

		if (
			inputDatasetsString.includes("[") &&
			inputDatasetsString.includes("]")
		) {
			const processedInput = inputDatasetsString
				.replaceAll("]", "")
				.replaceAll("[", "");
			if (processedInput.indexOf(",") > -1) {
				inputDatasets = processedInput.split(",");
			}
		} else {
			inputDatasets.push(inputDatasetsString);
		}

		const ddos = [];

		for (const dataset in inputDatasets) {
			const dataDdo = await this.aquarius.waitForIndexer(
				inputDatasets[dataset],
				null,
				null,
				this.indexingParams.retryInterval,
				this.indexingParams.maxRetries
			);
			if (!dataDdo) {
				console.error(
					"Error fetching DDO " + dataset[1] + ".  Does this asset exists?"
				);
				return;
			} else {
				ddos.push(dataDdo);
			}
		}
		if (
			inputDatasets.length > 0 &&
			(ddos.length <= 0 || ddos.length != inputDatasets.length)
		) {
			console.error("Not all the data ddos are available.");
			return;
		}
		let providerURI = this.oceanNodeUrl;
		if (ddos.length > 0) {
			providerURI = ddos[0].services[0].serviceEndpoint;
		}
		const algoDdo = await this.aquarius.waitForIndexer(
			args[2],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!algoDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		const computeEnvs = await ProviderInstance.getComputeEnvironments(
			this.oceanNodeUrl
		);

		if (!computeEnvs || computeEnvs.length < 1) {
			console.error(
				"Error fetching compute environments. No compute environments available."
			);
			return;
		}
		const computeEnvID = args[3];
		// NO chainId needed anymore (is not part of ComputeEnvironment spec anymore)
		// const chainComputeEnvs = computeEnvs[computeEnvID]; // was algoDdo.chainId
		let computeEnv = null; // chainComputeEnvs[0];

		if (computeEnvID && computeEnvID.length > 1) {
			for (const index in computeEnvs) {
				if (computeEnvID == computeEnvs[index].id) {
					computeEnv = computeEnvs[index];
					break;
				}
			}
		}
		if (!computeEnv || !computeEnvID) {
			console.error(
				"Error fetching compute environment. No compute environment matches id: ",
				computeEnvID
			);
			return;
		}

		const algo: ComputeAlgorithm = {
			documentId: algoDdo.id,
			serviceId: algoDdo.services[0].id,
			meta: algoDdo.metadata.algorithm,
		};

		const assets = [];
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
		const providerInitializeComputeJob = args[4]; // provider fees + payment
		const parsedProviderInitializeComputeJob = fixAndParseProviderFees(providerInitializeComputeJob)
		console.log("Ordering algorithm: ", args[2]);
		const datatoken = new Datatoken(
			this.signer,
			(await this.signer.provider.getNetwork()).chainId,
			this.config
		);
		algo.transferTxId = await handleComputeOrder(
			parsedProviderInitializeComputeJob?.algorithm,
			algoDdo,
			this.signer,
			computeEnv.consumerAddress,
			0,
			datatoken,
			this.config,
			parsedProviderInitializeComputeJob?.algorithm?.providerFee,
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
		console.log("Ordering assets: ", args[1]);

		for (let i = 0; i < ddos.length; i++) {
			assets[i].transferTxId = await handleComputeOrder(
				parsedProviderInitializeComputeJob?.datasets[i],
				ddos[i],
				this.signer,
				computeEnv.consumerAddress,
				0,
				datatoken,
				this.config,
				parsedProviderInitializeComputeJob?.datasets[i].providerFee,
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
		// payment check
		const maxJobDuration = Number(args[5])
		if (!maxJobDuration) {
			console.error(
				"Error initializing Provider for the compute job using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because maxJobDuration was not provided."
			);
			return;
		}
		if (maxJobDuration < 0) {
			console.error(
				"Error starting paid compute using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because maxJobDuration is less than 0. It should be in seconds."
			);
			return;
		}
		let supportedMaxJobDuration: number = maxJobDuration;
		if (maxJobDuration > computeEnv.maxJobDuration) {
			supportedMaxJobDuration = computeEnv.maxJobDuration;
		}
		const chainId = await this.signer.getChainId()
		const paymentToken = args[6]
		if (!paymentToken) {
			console.error(
				"Error starting paid compute using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because paymentToken was not provided."
			);
			return;
		}
		if (!Object.keys(computeEnv.fees).includes(chainId.toString())) {
			console.error(
				"Error starting paid compute using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because chainId is not supported by compute environment. " +
				args[3] +
				". Supported chain IDs: " +
				computeEnv.fees.keys()
			);
			return;
		}
		let found: boolean = false;
		for (const fee of computeEnv.fees[chainId.toString()]) {
			if (fee.feeToken.toLowerCase() === paymentToken.toLowerCase()) {
				found = true;
				break;
			}
		}
		if (found === false) {
			console.error(
				"Error starting paid compute using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because paymentToken is not supported by this environment " +
				args[3]
			);
			return;
		}
		const resources = args[7] // resources object should be stringified in cli when calling initializeCompute
		if (!resources) {
			console.error(
				"Error starting paid compute using dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because resources for compute were not provided."
			);
			return;
		}

		const escrow = new EscrowContract(
			ethers.utils.getAddress(parsedProviderInitializeComputeJob.payment.escrowAddress),
			this.signer
		)
		console.log("Verifying payment...");
		const validationEscrow = await escrow.verifyFundsForEscrowPayment(
			paymentToken,
			computeEnv.consumerAddress,
			await unitsToAmount(this.signer, paymentToken, parsedProviderInitializeComputeJob.payment.amount),
			parsedProviderInitializeComputeJob.payment.amount.toString(),
			parsedProviderInitializeComputeJob.payment.minLockSeconds.toString(),
			'10'
		)
		if (validationEscrow.isValid === false) {
			console.error(
				"Error starting compute job dataset DID " +
				args[1] +
				" and algorithm DID " +
				args[2] +
				" because escrow funds check failed: "
				+ validationEscrow.message
			);
			return;
		}

		console.log("Starting compute job using provider: ", providerURI);

		const additionalDatasets = assets.length > 1 ? assets.slice(1) : null;
		if (assets.length > 0) {
			console.log(
				"Starting compute job on " +
				assets[0].documentId +
				" with additional datasets:" +
				(!additionalDatasets ? "none" : additionalDatasets[0].documentId)
			);
		} else {
			console.log(
				"Starting compute job on " +
				algo.documentId +
				" with additional datasets:" +
				(!additionalDatasets ? "none" : additionalDatasets[0].documentId)
			);
		}
		if (additionalDatasets !== null) {
			console.log(
				"Adding additional datasets to dataset, according to C2D V2 specs"
			);
			assets.push(additionalDatasets);
		}

		const output: ComputeOutput = {
			metadataUri: await getMetadataURI(),
		};

		const computeJobs = await ProviderInstance.computeStart(
			providerURI,
			this.signer,
			computeEnv.id,
			assets, // assets[0] // only c2d v1,
			algo,
			supportedMaxJobDuration,
			paymentToken,
			JSON.parse(resources),
			await this.signer.getChainId(),
			// additionalDatasets, only c2d v1
			output,
		);

		console.log("compute jobs: ", computeJobs);

		if (computeJobs && computeJobs[0]) {
			const { jobId, payment } = computeJobs[0];
			console.log("Compute started.  JobID: " + jobId);
			console.log("Agreement ID: " + payment.lockTx);
		} else {
			console.log("Error while starting the compute job: ", computeJobs);
		}
	}

	public async freeComputeStart(args: string[]) {
		const inputDatasetsString = args[1];
		let inputDatasets = [];

		if (
			inputDatasetsString.includes("[") &&
			inputDatasetsString.includes("]")
		) {
			const processedInput = inputDatasetsString
				.replaceAll("]", "")
				.replaceAll("[", "");
			if (processedInput.indexOf(",") > -1) {
				inputDatasets = processedInput.split(",");
			}
		} else {
			inputDatasets.push(inputDatasetsString);
		}

		const ddos = [];

		for (const dataset in inputDatasets) {
			const dataDdo = await this.aquarius.waitForIndexer(
				inputDatasets[dataset],
				null,
				null,
				this.indexingParams.retryInterval,
				this.indexingParams.maxRetries
			);
			if (!dataDdo) {
				console.error(
					"Error fetching DDO " + dataset[1] + ".  Does this asset exists?"
				);
				return;
			} else {
				ddos.push(dataDdo);
			}
		}

		if (
			inputDatasets.length > 0 &&
			(ddos.length <= 0 || ddos.length != inputDatasets.length)
		) {
			console.error("Not all the data ddos are available.");
			return;
		}
		let providerURI = this.oceanNodeUrl;
		if (ddos.length > 0) {
			providerURI = ddos[0].services[0].serviceEndpoint;
		}

		const algoDdo = await this.aquarius.waitForIndexer(
			args[2],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!algoDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		const computeEnvs = await ProviderInstance.getComputeEnvironments(
			this.oceanNodeUrl
		);

		if (!computeEnvs || computeEnvs.length < 1) {
			console.error(
				"Error fetching compute environments. No compute environments available."
			);
			return;
		}

		const mytime = new Date();
		const computeMinutes = 5;
		mytime.setMinutes(mytime.getMinutes() + computeMinutes);

		const computeEnvID = args[3];
		// NO chainId needed anymore (is not part of ComputeEnvironment spec anymore)
		// const chainComputeEnvs = computeEnvs[computeEnvID]; // was algoDdo.chainId
		let computeEnv = null; // chainComputeEnvs[0];

		if (computeEnvID && computeEnvID.length > 1) {
			for (const env of computeEnvs) {
				if (computeEnvID == env.id && env.free) {
					computeEnv = env;
					break;
				}
			}
		}

		if (!computeEnv || !computeEnvID) {
			console.error(
				"Error fetching free compute environment. No free compute environment matches id: ",
				computeEnvID
			);
			return;
		}

		const algo: ComputeAlgorithm = {
			documentId: algoDdo.id,
			serviceId: algoDdo.services[0].id,
			meta: algoDdo.metadata.algorithm,
		};

		const assets = [];
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
		const additionalDatasets = assets.length > 1 ? assets.slice(1) : null;
		if (assets.length > 0) {
			console.log(
				"Starting compute job on " +
				assets[0].documentId +
				" with additional datasets:" +
				(!additionalDatasets ? "none" : additionalDatasets[0].documentId)
			);
		} else {
			console.log(
				"Starting compute job on " +
				algo.documentId +
				" with additional datasets:" +
				(!additionalDatasets ? "none" : additionalDatasets[0].documentId)
			);
		}

		if (additionalDatasets !== null) {
			console.log(
				"Adding additional datasets to dataset, according to C2D V2 specs"
			);
			assets.push(additionalDatasets);
		}

		const output: ComputeOutput = {
			metadataUri: await getMetadataURI(),
		};

		const computeJobs = await ProviderInstance.freeComputeStart(
			providerURI,
			this.signer,
			computeEnv.id,
			assets, // assets[0] // only c2d v1,
			algo,
			null,
			output
		);

		console.log("compute jobs: ", computeJobs);

		if (computeJobs && computeJobs[0]) {
			const { jobId } = computeJobs[0];
			console.log("Compute started.  JobID: " + jobId);
		} else {
			console.log("Error while starting the compute job: ", computeJobs);
		}
	}

	public async computeStop(args: string[]) {
		const dataDdo = await this.aquarius.waitForIndexer(
			args[1],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}
		const hasAgreementId = args.length === 4;

		const jobId = args[2];
		let agreementId = null;
		if (hasAgreementId) {
			agreementId = args[3];
		}
		const jobStatus = await ProviderInstance.computeStop(
			args[1],
			await this.signer.getAddress(),
			jobId,
			this.oceanNodeUrl,
			this.signer,
			agreementId
		);
		console.log(jobStatus);
	}

	public async getComputeEnvironments() {
		const computeEnvs = await ProviderInstance.getComputeEnvironments(
			this.oceanNodeUrl
		);

		if (!computeEnvs || computeEnvs.length < 1) {
			console.error(
				"Error fetching compute environments. No compute environments available."
			);
			return;
		}

		console.log("Exiting compute environments: ", JSON.stringify(computeEnvs));
	}

	public async computeStreamableLogs(args: string[]) {
		const jobId = args[0];
		const logsResponse = await ProviderInstance.computeStreamableLogs(
			this.oceanNodeUrl,
			this.signer,
			jobId
		);
		console.log("response: ", logsResponse);

		if (!logsResponse) {
			console.error("Error fetching streamable logs. No logs available.");
			return;
		} else {
			const stream = logsResponse as ReadableStream;
			console.log("stream: ", stream);
			const text = await new Response(stream).text();
			console.log("Streamable Logs: ");
			console.log(text);
			// for await (const value of stream) {
			// 	// just print it to the console
			// 	console.log(value);
			// }
		}
		console.log("Exiting computeStreamableLogs: ", logsResponse);
	}

	public async allowAlgo(args: string[]) {
		const asset = await this.aquarius.waitForIndexer(
			args[1],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!asset) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}

		if (asset.indexedMetadata.nft.owner !== (await this.signer.getAddress())) {
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
		const algoAsset = await this.aquarius.waitForIndexer(
			args[2],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!algoAsset) {
			console.error(
				"Error fetching DDO " + args[2] + ".  Does this asset exists?"
			);
			return;
		}
		const encryptDDO = args[3] === "false" ? false : true;
		let filesChecksum;
		try {
			filesChecksum = await ProviderInstance.checkDidFiles(
				algoAsset.id,
				algoAsset.services[0].id,
				algoAsset.services[0].serviceEndpoint,
				true
			);
		} catch (e) {
			console.error("Error checking algo files: ", e);
			return;
		}

		const containerChecksum =
			algoAsset.metadata.algorithm.container.entrypoint +
			algoAsset.metadata.algorithm.container.checksum;
		const trustedAlgorithm = {
			did: algoAsset.id,
			containerSectionChecksum: getHash(containerChecksum),
			filesChecksum: filesChecksum?.[0]?.checksum,
		};
		asset.services[0].compute.publisherTrustedAlgorithms.push(trustedAlgorithm);
		try {
			const txid = await updateAssetMetadata(
				this.signer,
				asset,
				this.oceanNodeUrl,
				this.aquarius,
				encryptDDO
			);
			console.log("Successfully updated asset metadata: " + txid);
		} catch (e) {
			console.error("Error updating asset metadata: ", e);
			return;
		}
	}

	public async disallowAlgo(args: string[]) {
		const asset = await this.aquarius.waitForIndexer(
			args[1],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!asset) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}
		if (asset.indexedMetadata.nft.owner !== (await this.signer.getAddress())) {
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
			this.oceanNodeUrl,
			this.aquarius,
			encryptDDO
		);
		console.log("Asset updated " + txid);
	}

	public async getJobStatus(args: string[]) {
		// args[1] - did (for checking if data asset exists, legacy)
		// args[2] - jobId
		// args[3] - agreementId
		const hasAgreementId = args.length === 4;

		const dataDdo = await this.aquarius.waitForIndexer(
			args[1],
			null,
			null,
			this.indexingParams.retryInterval,
			this.indexingParams.maxRetries
		);
		if (!dataDdo) {
			console.error(
				"Error fetching DDO " + args[1] + ".  Does this asset exists?"
			);
			return;
		}
		const jobId = args[2];
		let agreementId = null;
		if (hasAgreementId) {
			agreementId = args[3];
		}

		const jobStatus = (await ProviderInstance.computeStatus(
			this.oceanNodeUrl,
			await this.signer.getAddress(),
			jobId,
			agreementId
		)) as ComputeJob;
		console.log(util.inspect(jobStatus, false, null, true));
	}

	public async downloadJobResults(args: string[]) {
		const jobResult = await ProviderInstance.getComputeResultUrl(
			this.oceanNodeUrl,
			this.signer,
			args[1],
			parseInt(args[2])
		);
		console.log("jobResult ", jobResult);

		try {
			const path = args[3] ? args[3] : ".";
			const { filename } = await downloadFile(
				jobResult,
				path,
				parseInt(args[2])
			);
			console.log("File downloaded successfully:", path + "/" + filename);
		} catch (e) {
			console.log(`Download url dataset failed: ${e}`);
		}
	}

	public async mintOceanTokens() {
		try {
			const config = await getConfigByChainId(Number(this.config.chainId));
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
				config?.Ocean,
				minAbi,
				this.signer
			);
			const estGasPublisher = await tokenContract.estimateGas.mint(
				await this.signer.getAddress(),
				await amountToUnits(null, null, "1000", 18)
			);
			const tx = await sendTx(
				estGasPublisher,
				this.signer,
				1,
				tokenContract.mint,
				await this.signer.getAddress(),
				amountToUnits(null, null, "1000", 18)
			);
			await tx.wait();
		} catch (error) {
			console.error("Error minting Ocean tokens:", error);
		}
	}

	public async generateAuthToken() {
		const authToken = await ProviderInstance.generateAuthToken(
			this.signer,
			this.oceanNodeUrl,
		);
		console.log(`Auth token successfully generated: ${authToken}`);
	}

	public async invalidateAuthToken(args: string[]) {
		const authToken = args[0];
		const result = await ProviderInstance.invalidateAuthToken(
			this.signer,
			authToken,
			this.oceanNodeUrl,
		);
		if (!result.success) {
			console.log('Auth token could not be invalidated');
			return;
		}

		console.log(`Auth token successfully invalidated`);
	}

	public async depositToEscrow(signer: Signer, token: string, amount: string, chainId: number) {
		try {
			const amountInUnits = await amountToUnits(signer, token, amount, 18);
			const config = await getConfigByChainId(chainId);
			const escrowAddress = config.Escrow;

			const tokenContract = new ethers.Contract(
				token,
				['function approve(address spender, uint256 amount) returns (bool)'],
				signer
			);

			const escrow = new EscrowContract(
				ethers.utils.getAddress(escrowAddress),
				signer,
				chainId
			);

			console.log('Approving token transfer...')
			const approveTx = await tokenContract.approve(escrowAddress, amountInUnits);
			await approveTx.wait();
			console.log(`Successfully approved ${amount} ${token} to escrow`);


			console.log('Depositing to escrow...')
			const depositTx = await escrow.deposit(token, amount);
			await depositTx.wait();
			return true;

		} catch (error) {
			console.error("Error depositing to escrow:", error);
			return false;
		}
	}

	// public async authorizeEscrowPayee(
	// 	escrowAddress: string,
	// 	token: string,
	// 	payee: string,
	// 	maxLockedAmount: string,
	// 	maxLockSeconds: string,
	// 	maxLockCounts: string
	// ) {
	// 	try {
	// 		const escrow = new EscrowContract(
	// 			ethers.utils.getAddress(escrowAddress),
	// 			this.signer
	// 		);

	// 		console.log("Authorizing payee...");
	// 		const authTx = await escrow.authorize(
	// 			token,
	// 			payee,
	// 			maxLockedAmount,
	// 			maxLockSeconds,
	// 			maxLockCounts
	// 		);
	// 		await authTx.wait();
	// 		console.log(`Successfully authorized payee ${payee} for token ${token}`);

	// 		return true;
	// 	} catch (error) {
	// 		console.error("Error authorizing payee:", error);
	// 		return false;
	// 	}
	// }
}
