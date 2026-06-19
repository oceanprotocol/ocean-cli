import { ethers, hexlify, Signer, toBeHex } from "ethers";
import fetch from "cross-fetch";
import { promises as fs, readFileSync } from "fs";
import * as path from "path";
import * as sapphire from '@oasisprotocol/sapphire-paratime';
import { Asset, DDO } from '@oceanprotocol/ddo-js';
import {
	AccesslistFactory, Aquarius,
	Nft,
	NftFactory,
	ProviderInstance,
	ZERO_ADDRESS,
	approveWei,
	ProviderComputeInitialize,
	ConsumeMarketFee,
	Datatoken,
	Config,
	orderAsset,
	getEventFromTx,
	DownloadResponse,
	ProviderFees,
	ComputeAlgorithm,
	ComputeAsset,
	LoggerInstance,
	createAsset
} from "@oceanprotocol/lib";
import { homedir } from "os";

const ERC20Template = readFileSync('./node_modules/@oceanprotocol/contracts/artifacts/contracts/templates/ERC20Template.sol/ERC20Template.json', 'utf8') as any;

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

export async function calculateActiveTemplateIndex(
	owner: Signer,
	nftContractAddress: string, // addresses.ERC721Factory,
	template: string | number
): Promise<number> {
	// is an ID number?
	const isTemplateID = typeof template === 'number'

	const factoryERC721 = new NftFactory(nftContractAddress, owner)
	const currentTokenCount = await factoryERC721.getCurrentTokenTemplateCount()
	for (let i = 1; i <= currentTokenCount; i++) {
		const tokenTemplate = await factoryERC721.getTokenTemplate(i)

		const erc20Template = new ethers.Contract(
			tokenTemplate.templateAddress,
			ERC20Template.abi,
			owner
		)

		// check for ID
		if (isTemplateID) {
			const id = await (erc20Template as ethers.Contract & { getId(): Promise<number> }).getId()
			if (tokenTemplate.isActive && id.toString() === template.toString()) {
				return i
			}
		} else if (
			tokenTemplate.isActive &&
			tokenTemplate.templateAddress === template.toString()
		) {
			return i
		}
	}
	// if nothing is found it returns -1
	return -1
}

export function getSignerAccordingSdk(signer: Signer, config: Config) {
	return config && 'sdk' in config && config.sdk === 'oasis'
		? sapphire.wrap(signer)
		: signer
}

export async function createAssetUtil(
	name: string,
	symbol: string,
	owner: Signer,
	assetUrl: any,
	ddo: DDO,
	oceanNodeUrl: string,
	config: Config,
	aquariusInstance: Aquarius,
	encryptDDO: boolean = true,
	templateIDorAddress: string | number = 1, // If string, it's template address , otherwise, it's templateId,
	providerFeeToken: string = ZERO_ADDRESS,
	accessListFactory?: string,
	allowAccessList?: string,
	denyAccessList?: string,

) {
	const isAddress = typeof templateIDorAddress === 'string'
	const isTemplateIndex = typeof templateIDorAddress === 'number'
	if (!isAddress && !isTemplateIndex) {
		throw new Error('Invalid template! Must be a "number" or a "string"')
	}
	const { chainId } = await owner.provider.getNetwork();
	const signer = getSignerAccordingSdk(owner, config);

	if (config.sdk === 'oasis') {
		// Create Access List Factory
		const accessListFactoryObj = new AccesslistFactory(config.accessListFactory, signer, Number(chainId));

		// Create Allow List
		await accessListFactoryObj.deployAccessListContract(
			'AllowList',
			'ALLOW',
			['https://oceanprotocol.com/nft/'],
			false,
			await owner.getAddress(),
			[await owner.getAddress(), ZERO_ADDRESS]
		)
		return await createAsset(name, symbol, signer, assetUrl, templateIDorAddress, ddo, encryptDDO, oceanNodeUrl, providerFeeToken, aquariusInstance, accessListFactory, allowAccessList, denyAccessList);
	}
	return await createAsset(name, symbol, signer, assetUrl, templateIDorAddress, ddo, encryptDDO, oceanNodeUrl, providerFeeToken, aquariusInstance);
}



export async function updateAssetMetadata(
	owner: Signer,
	updatedDdo: Asset,
	oceanNodeUrl: string,
	aquariusInstance: Aquarius,
	encryptDDO: boolean = true
): Promise<any> {
	const nft = new Nft(owner, Number((await owner.provider.getNetwork()).chainId));
	let flags;
	let metadata;
	const validateResult = await aquariusInstance.validate(updatedDdo, owner, oceanNodeUrl);
	if (encryptDDO) {
		const providerResponse = await ProviderInstance.encrypt(
			updatedDdo,
			updatedDdo.chainId,
			oceanNodeUrl,
			owner
		);
		metadata = await providerResponse;
		flags = 2
	}
	else {
		const stringDDO = JSON.stringify(updatedDdo);
		const bytes = Buffer.from(stringDDO);
		metadata = hexlify(bytes);
		flags = 0
	}

	const updateDdoTX = await nft.setMetadata(
		updatedDdo.nftAddress,
		await owner.getAddress(),
		0,
		oceanNodeUrl,
		"",
		toBeHex(flags),
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
	oceanNodeUrl: string,
	consumeMarkerFee?: ConsumeMarketFee
) {
	/* We do have 3 possible situations:
	   - have validOrder and no providerFees -> then order is valid, providerFees are valid, just use it in startCompute
	   - have validOrder and providerFees -> then order is valid but providerFees are not valid, we need to call reuseOrder and pay only providerFees
	   - no validOrder -> we need to call startOrder, to pay 1 DT & providerFees
	*/
	const hasProviderFees = order.providerFee && order.providerFee.providerFeeAmount
	// no need to approve if it is 0
	if (hasProviderFees && Number(order.providerFee.providerFeeAmount) > 0) {

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
		oceanNodeUrl,
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

export interface ResolvedComputeInputs {
	assets: ComputeAsset[]; // index-aligned with `ddos`
	algo: ComputeAlgorithm;
	ddos: (Asset | DDO | null)[]; // null where the asset is raw (fileObject)
	algoDdo: Asset | DDO | null; // null when the algo is raw
	providerURI: string; // first DID-based DDO endpoint, else fallback
}

// Parses a single compute input string (datasets or algo) into a list of tokens.
// Each token is either a DID string or a raw ComputeAsset/ComputeAlgorithm object.
// Supports: a bare DID, a JSON object, a JSON array of DIDs and/or objects, and the
// legacy unquoted `[did:a,did:b]` form (kept for backward compatibility).
function parseComputeInput(raw: string): (string | Record<string, unknown>)[] {
	if (raw === undefined || raw === null) return [];
	const trimmed = String(raw).trim();
	if (trimmed.length === 0) return [];
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) return parsed;
		if (parsed && typeof parsed === "object") return [parsed];
		// a JSON primitive (e.g. a quoted string) -> treat as a single DID
		return [String(parsed)];
	} catch {
		// not valid JSON: bare DID or legacy `[did:a,did:b]`
		if (trimmed.includes("[") && trimmed.includes("]")) {
			const processed = trimmed.replaceAll("]", "").replaceAll("[", "");
			if (processed.indexOf(",") > -1) {
				return processed
					.split(",")
					.map((s) => s.trim())
					.filter((s) => s.length > 0);
			}
			// `[did]` or `[]`
			const single = processed.trim();
			return single.length > 0 ? [single] : [];
		}
		return [trimmed];
	}
}

// Resolves the raw datasets/algo CLI strings into fully-built ComputeAsset[] and
// ComputeAlgorithm, plus index-aligned DDO arrays (null where the entry is raw).
// DID entries are resolved via Aquarius; raw (fileObject) entries are passed through
// untouched. Returns null (after logging) when a DID cannot be resolved.
export async function resolveComputeInputs(
	datasetsInput: string,
	algoInput: string,
	aquarius: Aquarius,
	indexingParams: IndexerWaitParams,
	fallbackProviderURI: string
): Promise<ResolvedComputeInputs | null> {
	const datasetTokens = parseComputeInput(datasetsInput);

	const assets: ComputeAsset[] = [];
	const ddos: (Asset | DDO | null)[] = [];

	for (const token of datasetTokens) {
		if (typeof token === "string") {
			const dataDdo = await aquarius.waitForIndexer(
				token,
				undefined,
				undefined,
				indexingParams.retryInterval,
				indexingParams.maxRetries
			);
			if (!dataDdo) {
				console.error(
					"Error fetching DDO " + token + ".  Does this asset exists?"
				);
				return null;
			}
			assets.push({
				documentId: dataDdo.id,
				serviceId: dataDdo.services[0].id,
			});
			ddos.push(dataDdo);
		} else if (token && typeof token === "object") {
			const rawAsset = token as unknown as ComputeAsset;
			if (!rawAsset.fileObject) {
				console.error(
					"Error: raw dataset asset must contain a 'fileObject'. Got: " +
						JSON.stringify(token)
				);
				return null;
			}
			assets.push({
				...rawAsset,
				documentId: rawAsset.documentId ?? "",
				serviceId: rawAsset.serviceId ?? "",
			});
			ddos.push(null);
		} else {
			console.error("Error: invalid dataset input entry: " + String(token));
			return null;
		}
	}

	let providerURI = fallbackProviderURI;
	const firstDdo = ddos.find((d) => d !== null);
	if (firstDdo) {
		providerURI = firstDdo.services[0].serviceEndpoint;
	}

	// Resolve the algorithm (single entry: DID or raw object)
	const algoTokens = parseComputeInput(algoInput);
	const algoToken = algoTokens.length > 0 ? algoTokens[0] : algoInput;
	let algo: ComputeAlgorithm;
	let algoDdo: Asset | DDO | null = null;

	if (typeof algoToken === "string") {
		algoDdo = await aquarius.waitForIndexer(
			algoToken,
			undefined,
			undefined,
			indexingParams.retryInterval,
			indexingParams.maxRetries
		);
		if (!algoDdo) {
			console.error(
				"Error fetching DDO " + algoToken + ".  Does this asset exists?"
			);
			return null;
		}
		algo = {
			documentId: algoDdo.id,
			serviceId: algoDdo.services[0].id,
			meta: algoDdo.metadata.algorithm,
		};
	} else if (algoToken && typeof algoToken === "object") {
		const rawAlgo = algoToken as unknown as ComputeAlgorithm;
		if (!rawAlgo.fileObject) {
			console.error(
				"Error: raw algorithm must contain a 'fileObject'. Got: " +
					JSON.stringify(algoToken)
			);
			return null;
		}
		algo = rawAlgo;
	} else {
		console.error("Error: invalid algorithm input: " + String(algoToken));
		return null;
	}

	return { assets, algo, ddos, algoDdo, providerURI };
}


// The ranges and the amount of usable IP's:

// 10.0.0.0 - 10.255.255.255 Addresses: 16,777,216
// 172.16.0.0 - 172.31.255.255 Addresses: 1,048,576
// 192.168.0.0 - 192.168.255.255 Addresses: 65,536

// check if IP is private or not
export function isPrivateIP(ip): boolean {

	const reg = /^(127\.[\d.]+|[0:]+1|localhost)$/
	const result = ip.match(reg)
	if (result !== null) {
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
		if (data) {
			return data.ip
		}
	} catch (err) {
		console.error('Erro getting public IP: ', err.message)
	}

	return null
}

export async function getMetadataURI() {
	const metadataURI = process.env.NODE_URL
	if (!metadataURI.startsWith('http')) {
		return metadataURI
	}
	const parsed = new URL(metadataURI);
	let ip = metadataURI // by default
	// has port number?
	const hasPort = parsed.port && !isNaN(Number(parsed.port))
	if (hasPort) {
		// remove the port, just get the host part
		ip = parsed.hostname
	}
	// check if is private or loopback
	if (isPrivateIP(ip)) {
		// get public V4 ip address
		ip = await getPublicIP()
		if (!ip) {
			return metadataURI
		}
	}
	// if we removed the port add it back
	if (hasPort) {
		ip = `http://${ip}:${parsed.port}`
	}
	return ip
}
// for waiting for an asset to index
export interface IndexerWaitParams {
	maxRetries: number,
	retryInterval: number
}

// defines how much time we wait for an asset to index + the interval for retries
export function getIndexingWaitSettings(): IndexerWaitParams {
	const indexingParams: IndexerWaitParams = {
		maxRetries: 120, // 120 retries
		retryInterval: 4000 // retries every 4 seconds
	}
	try {

		if (!isNaN(Number(process.env.INDEXING_RETRY_INTERVAL))) {

			indexingParams.retryInterval = Number(process.env.INDEXING_RETRY_INTERVAL)
			if (indexingParams.retryInterval < 0) {
				indexingParams.retryInterval = 4000
			}

		}
		if (!isNaN(Number(process.env.INDEXING_MAX_RETRIES))) {

			indexingParams.maxRetries = Number(process.env.INDEXING_MAX_RETRIES)
			if (indexingParams.maxRetries < 0) {
				indexingParams.maxRetries = 120
			}
		}
	} catch (err) {
		console.error('Error getting indexing wait arguments:', err)
	}

	return indexingParams
}

export function fixAndParseProviderFees(rawString: string) {
	// Remove surrounding quotes if present
	if (rawString.startsWith('"') && rawString.endsWith('"')) {
		rawString = rawString.slice(1, -1).replace(/\\"/g, '"');
	}

	const fixed = rawString
		.replace(/([{,])(\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$3":')
		.replace(/:\s*(did:[^,}\]]+)/g, ':"$1"')
		.replace(/:\s*(0x[a-fA-F0-9]+)/g, ':"$1"')
		.replace(/providerData:\s*([^,}\]]+)/g, 'providerData:"$1"')
		.replace(/:false/g, ':false')
		.replace(/:true/g, ':true');

	return JSON.parse(fixed);
}

export function toBoolean(value) {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const val = value.trim().toLowerCase();
		return val === 'true' || val === '1' || val === 'yes' || val === 'y';
	}
	return Boolean(value);
}

export async function getConfigByChainId(chainId: number) {
	const addressFilePath = process.env.ADDRESS_FILE || `${homedir}/.ocean/ocean-contracts/artifacts/address.json`;
	const addressFile = await fs.readFile(addressFilePath, 'utf8');

	const data = JSON.parse(addressFile);
	const chainConfig = Object.values(data).find((network: any) => network.chainId === chainId) as any;

	if (!chainConfig) {
		throw new Error(`Chain ${chainId} not found in address file`);
	}

	return chainConfig;
}