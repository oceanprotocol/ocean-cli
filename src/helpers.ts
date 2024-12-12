import { SHA256 } from "crypto-js";
import { ethers, Signer } from "ethers";
import fetch from "cross-fetch";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import * as path from "path";
import * as sapphire from '@oasisprotocol/sapphire-paratime';
import {
	AccesslistFactory,
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
	Datatoken4 
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

	const defaultName = !isNaN(index) && index > -1 ? `file_${index}.out` : 'file.out'
	let filename: string

	try {
		// try to get it from headers
		filename = response.headers
			.get("content-disposition")
			.match(/attachment;filename=(.+)/)[1];
	} catch {
		filename = defaultName;
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
	templateIndex: number = 1,
	macOsProviderUrl?: string,
	encryptDDO: boolean = true,
) {
	const { chainId } = await owner.provider.getNetwork();
	const nft = new Nft(owner, chainId);
	const nftFactory = new NftFactory(config.nftFactoryAddress, owner);

	let wrappedSigner
	let allowListAddress
	if(templateIndex === 4){
		// Wrap the signer for Sapphire
		wrappedSigner = sapphire.wrap(owner);

		// Create Access List Factory
		const accessListFactory = new AccesslistFactory(config.accessListFactory, wrappedSigner, chainId);

		// Create Allow List
		allowListAddress = await accessListFactory.deployAccessListContract(
			'AllowList',
			'ALLOW',
			['https://oceanprotocol.com/nft/'],
			false,
			await owner.getAddress(),
			[await owner.getAddress(), ZERO_ADDRESS]
		);
	}

	ddo.chainId = parseInt(chainId.toString(10));
	const nftParamsAsset: NftCreateData = {
		name,
		symbol,
		templateIndex,
		tokenURI: "aaa",
		transferable: true,
		owner: await owner.getAddress(),
	};
	const datatokenParams: DatatokenCreateParams = {
		templateIndex,
		cap: "100000",
		feeAmount: "0",
		paymentCollector: await owner.getAddress(),
		feeToken: ddo?.stats?.price?.tokenAddress ? ddo.stats.price.tokenAddress : config.oceanTokenAddress,	
		minter: await owner.getAddress(),
		mpFeeAddress: ZERO_ADDRESS,
	};

	let bundleNFT;
	if (!ddo.stats?.price?.value) {
		bundleNFT = await nftFactory.createNftWithDatatoken(
			nftParamsAsset,
			datatokenParams
		);
	} else if (ddo?.stats?.price?.value === "0") {
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
	ddo.services[0].files = templateIndex === 4 ? '' : await ProviderInstance.encrypt(
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

	   if(templateIndex === 4){ // Use Datatoken4 for file object
		const datatoken = new Datatoken4(
			wrappedSigner,
			ethers.utils.toUtf8Bytes(JSON.stringify(assetUrl.files)),
			chainId,
			config
		);
	
		// Set file object
		await datatoken.setFileObject(datatokenAddressAsset, await wrappedSigner.getAddress());
	
		// Set allow list for the datatoken
		await datatoken.setAllowListContract(
			datatokenAddressAsset,
			allowListAddress,
			await wrappedSigner.getAddress()
		);}

	return ddo.id;
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


// The ranges and the amount of usable IP's:

// 10.0.0.0 - 10.255.255.255 Addresses: 16,777,216
// 172.16.0.0 - 172.31.255.255 Addresses: 1,048,576
// 192.168.0.0 - 192.168.255.255 Addresses: 65,536

// check if IP is private or not
export function isPrivateIP(ip): boolean {

	const reg = /^(127\.[\d.]+|[0:]+1|localhost)$/
	const result = ip.match(reg)
	if(result!==null) {
		// is loopback address
		return true
	}
	const parts = ip.split('.');
	return parts[0] === '10' || 
	   (parts[0] === '172' && (parseInt(parts[1], 10) >= 16 && parseInt(parts[1], 10) <= 31)) || 
	   (parts[0] === '192' && parts[1] === '168');
 }

 // get public IP address using free service API
 export async function getPublicIP(): Promise<string> {

	try {
		const response = await fetch('https://api.ipify.org?format=json')
		const data = await response.json()
		if(data) {
			return data.ip
		}
	}catch(err) {
		console.error('Erro getting public IP: ',err.message)
	}
	
    return null
 }

 export async function getMetadataURI() {
	const metadataURI = process.env.AQUARIUS_URL
	const parsed = new URL(metadataURI);
	let ip = metadataURI // by default
	// has port number?
	const hasPort = parsed.port && !isNaN( Number(parsed.port))
	if(hasPort) {
		// remove the port, just get the host part
		ip = parsed.hostname
	} 
	// check if is private or loopback
	if(isPrivateIP(ip)) {
		// get public V4 ip address
		ip = await getPublicIP()
		if(!ip) {
			return metadataURI
		}
	} 
	// if we removed the port add it back
	if(hasPort) {
		ip = `http://${ip}:${parsed.port}`
	}
	return ip
 }

