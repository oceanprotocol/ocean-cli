import { SHA256 } from "crypto-js";
import { ethers, Signer } from "ethers";
import fetch from "cross-fetch";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import * as path from "path";

import {
	Aquarius,
	DatatokenCreateParams,
	Nft,
	NftCreateData,
	NftFactory,
	ProviderInstance,
	ZERO_ADDRESS,
	approveWei,
	ProviderComputeInitialize,
	ConsumeMarketFee,
	Datatoken,
	Config,
	DDO,
	orderAsset,
	getEventFromTx,
	DispenserCreationParams,
	FreCreationParams,
	DownloadResponse,
	Asset,
	ProviderFees,
	ComputeAlgorithm,
	LoggerInstance,
	DispenserParams,
} from "@oceanprotocol/lib";
import { hexlify } from "ethers/lib/utils";

export async function downloadFile(
	url: string,
	downloadPath: string,
	index?: number
): Promise<DownloadResponse> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error("Response error.");
	}
	let filename: string;
	try {
		filename = response.headers
			.get("content-disposition")
			.match(/attachment;filename=(.+)/)[1];
	} catch {
		try {
			filename = url.split("/").pop();
		} catch {
			filename = `file${index}`;
		}
	}

	const filePath = path.join(downloadPath, filename);
	const data = await response.arrayBuffer();

	try {
		await fs.writeFile(filePath, Buffer.from(data));
	} catch (err) {
		throw new Error("Error while saving the file:", err.message);
	}

	return { data, filename };
}

export async function createAsset(
	name: string,
	symbol: string,
	owner: Signer,
	assetUrl: any,
	ddo: any,
	providerUrl: string,
	config: Config,
	aquariusInstance: Aquarius,
	macOsProviderUrl?: string,
	encryptDDO: boolean = true
) {
	const { chainId } = await owner.provider.getNetwork();
	const nft = new Nft(owner, chainId);
	const nftFactory = new NftFactory(config.nftFactoryAddress, owner);

	ddo.chainId = parseInt(chainId.toString(10));
	const nftParamsAsset: NftCreateData = {
		name,
		symbol,
		templateIndex: 1,
		tokenURI: "aaa",
		transferable: true,
		owner: await owner.getAddress(),
	};
	const datatokenParams: DatatokenCreateParams = {
		templateIndex: 1,
		cap: "100000",
		feeAmount: "0",
		paymentCollector: await owner.getAddress(),
		feeToken: config.oceanTokenAddress,
		minter: await owner.getAddress(),
		mpFeeAddress: ZERO_ADDRESS,
	};

	let bundleNFT;
	if (!ddo.stats.price.value) {
		bundleNFT = await nftFactory.createNftWithDatatoken(
			nftParamsAsset,
			datatokenParams
		);
	} else if (ddo.stats.price.value === "0") {
		const dispenserParams: DispenserCreationParams = {
			dispenserAddress: config.dispenserAddress,
			maxTokens: "1",
			maxBalance: "100000000",
			withMint: true,
			allowedSwapper: ZERO_ADDRESS,
		};

		bundleNFT = await nftFactory.createNftWithDatatokenWithDispenser(
			nftParamsAsset,
			datatokenParams,
			dispenserParams
		);
	} else {
		const fixedPriceParams: FreCreationParams = {
			fixedRateAddress: config.fixedRateExchangeAddress,
			baseTokenAddress: config.oceanTokenAddress,
			owner: await owner.getAddress(),
			marketFeeCollector: await owner.getAddress(),
			baseTokenDecimals: 18,
			datatokenDecimals: 18,
			fixedRate: ddo.stats.price.value,
			marketFee: "0",
			allowedConsumer: await owner.getAddress(),
			withMint: true,
		};

		bundleNFT = await nftFactory.createNftWithDatatokenWithFixedRate(
			nftParamsAsset,
			datatokenParams,
			fixedPriceParams
		);
	}

	const trxReceipt = await bundleNFT.wait();
	// events have been emitted
	const nftCreatedEvent = getEventFromTx(trxReceipt, "NFTCreated");
	const tokenCreatedEvent = getEventFromTx(trxReceipt, "TokenCreated");

	const nftAddress = nftCreatedEvent.args.newTokenAddress;
	const datatokenAddressAsset = tokenCreatedEvent.args.newTokenAddress;
	// create the files encrypted string
	assetUrl.datatokenAddress = datatokenAddressAsset;
	assetUrl.nftAddress = nftAddress;
	ddo.services[0].files = await ProviderInstance.encrypt(
		assetUrl,
		chainId,
		macOsProviderUrl || providerUrl
	);
	ddo.services[0].datatokenAddress = datatokenAddressAsset;
	ddo.services[0].serviceEndpoint = providerUrl;

	ddo.nftAddress = nftAddress;
	ddo.id =
		"did:op:" +
		SHA256(ethers.utils.getAddress(nftAddress) + chainId.toString(10));

	let metadata;
	let metadataHash;
	let flags;
	if (encryptDDO) {
		metadata = await ProviderInstance.encrypt(
			ddo,
			chainId,
			macOsProviderUrl || providerUrl
		);
		const validateResult = await aquariusInstance.validate(ddo);
		metadataHash = validateResult.hash;
		flags = 2
	} else {
		const stringDDO = JSON.stringify(ddo);
		const bytes = Buffer.from(stringDDO);
		metadata = hexlify(bytes);
		metadataHash = "0x" + createHash("sha256").update(metadata).digest("hex");
		flags = 0
	}

	await nft.setMetadata(
		nftAddress,
		await owner.getAddress(),
		0,
		providerUrl,
		"",
		ethers.utils.hexlify(flags),
		metadata,
		metadataHash
	);
	return ddo.id;
}

export async function createDatatokenAndPricing(
	ddo: Asset,
	owner: Signer,
	config: Config,
	price: number
) {
  // --------------------------------------------------
  // 1. Create Datatoken
  // --------------------------------------------------
  console.log('Creating datatoken...')

	const { chainId } = await owner.provider.getNetwork();
	if (ddo.chainId !== chainId) throw new Error(`Connected to different chain ${chainId}`);

	const nft = new Nft(owner, chainId);
  const publisherAccount = await owner.getAddress()

  const datatokenAddress = await nft.createDatatoken(
    ddo.nftAddress,
    publisherAccount,
		publisherAccount,
		publisherAccount,
    ZERO_ADDRESS,
    config.oceanTokenAddress,
    "0",
    "100000",
    "DataToken",
    "DT",
    1
  )

  console.log('Datatoken created.', datatokenAddress)

  // --------------------------------------------------
  // 2. Create Pricing
  // --------------------------------------------------
  const datatoken = new Datatoken(owner, chainId)

  let pricingTransactionReceipt;
  if (price > 0) {
		console.log(`Creating fixed rate exchange with price ${price} for datatoken ${datatokenAddress}`)

		const freParams: FreCreationParams = {
			fixedRateAddress: config.fixedRateExchangeAddress,
			baseTokenAddress: config.oceanTokenAddress,
			owner: publisherAccount,
			marketFeeCollector: publisherAccount,
			baseTokenDecimals: 18,
			datatokenDecimals: 18,
			fixedRate: ethers.utils.parseEther(price.toString()).toString(),
			marketFee: "0",
			allowedConsumer: publisherAccount,
			withMint: true,
		}

		pricingTransactionReceipt = await datatoken.createFixedRate(
			datatokenAddress,
			publisherAccount,
			freParams
		)
	} else {
		console.log(`Creating dispenser for datatoken ${datatokenAddress}`)

		const dispenserParams: DispenserParams = {
			maxTokens: ethers.utils.parseEther("1").toString(),
			maxBalance: ethers.utils.parseEther("1").toString(),
			withMint: true,
			allowedSwapper: ZERO_ADDRESS
		}

		pricingTransactionReceipt = await datatoken.createDispenser(
			datatokenAddress,
			publisherAccount,
			config.dispenserAddress,
			dispenserParams
		)
	}

	const tx = await pricingTransactionReceipt.wait()
	console.log('Pricing scheme created.')
	
  return { datatokenAddress, tx }
}

export async function updateAssetMetadata(
	owner: Signer,
	updatedDdo: DDO,
	providerUrl: string,
	aquariusInstance: Aquarius,
	macOsProviderUrl?: string,
	encryptDDO: boolean = true
) {
	const nft = new Nft(owner, (await owner.provider.getNetwork()).chainId);
	let flags;
	let metadata;
	const validateResult = await aquariusInstance.validate(updatedDdo);
	if (encryptDDO) {
		const providerResponse = await ProviderInstance.encrypt(
			updatedDdo,
			updatedDdo.chainId,
			macOsProviderUrl || providerUrl
		);
		metadata = await providerResponse;
		flags = 2
	}
	else{
		const stringDDO = JSON.stringify(updatedDdo);
		const bytes = Buffer.from(stringDDO);
		metadata = hexlify(bytes);
		flags = 0
	}
	
	const updateDdoTX = await nft.setMetadata(
		updatedDdo.nftAddress,
		await owner.getAddress(),
		0,
		providerUrl,
		"",
		ethers.utils.hexlify(flags),
		metadata,
		validateResult.hash
	);
	return updateDdoTX;
}

export async function handleComputeOrder(
	order: ProviderComputeInitialize,
	asset: Asset,
	payerAccount: Signer,
	consumerAddress: string,
	serviceIndex: number,
	datatoken: Datatoken,
	config: Config,
	providerFees: ProviderFees,
	providerUrl: string,
	consumeMarkerFee?: ConsumeMarketFee
) {
	/* We do have 3 possible situations:
       - have validOrder and no providerFees -> then order is valid, providerFees are valid, just use it in startCompute
       - have validOrder and providerFees -> then order is valid but providerFees are not valid, we need to call reuseOrder and pay only providerFees
       - no validOrder -> we need to call startOrder, to pay 1 DT & providerFees
    */
	if (order.providerFee && order.providerFee.providerFeeAmount) {
		await approveWei(
			payerAccount,
			config,
			await payerAccount.getAddress(),
			order.providerFee.providerFeeToken,
			asset.services[0].datatokenAddress,
			order.providerFee.providerFeeAmount
		);
	}
	if (order.validOrder) {
		if (!order.providerFee) return order.validOrder;
		const tx = await datatoken.reuseOrder(
			asset.services[0].datatokenAddress,
			order.validOrder,
			order.providerFee
		);
		const reusedTx = await tx.wait();
		const orderReusedTx = getEventFromTx(reusedTx, "OrderReused");
		return orderReusedTx.transactionHash;
	}
	console.log("Ordering asset with DID: ", asset.id);
	const txStartOrder = await orderAsset(
		asset,
		payerAccount,
		config,
		datatoken,
		providerUrl,
		consumerAddress,
		consumeMarkerFee,
		providerFees
	);

	if (!txStartOrder)
		return
	const tx = await txStartOrder.wait();
	const orderStartedTx = getEventFromTx(tx, "OrderStarted");

	return orderStartedTx.transactionHash;
}

export async function isOrderable(
	asset: Asset | DDO,
	serviceId: string,
	algorithm: ComputeAlgorithm,
	algorithmDDO: Asset | DDO
): Promise<boolean> {
	const datasetService = asset.services.find((s) => s.id === serviceId);
	if (!datasetService) return false;

	if (datasetService.type === "compute") {
		if (algorithm.meta) {
			if (datasetService.compute.allowRawAlgorithm) return true;
			return false;
		}
		if (algorithm.documentId) {
			const algoService = algorithmDDO.services.find(
				(s) => s.id === algorithm.serviceId
			);
			if (algoService && algoService.type === "compute") {
				if (algoService.serviceEndpoint !== datasetService.serviceEndpoint) {
					LoggerInstance.error(
						"ERROR: Both assets with compute service are not served by the same provider"
					);
					return false;
				}
			}
		}
	}
	return true;
}
