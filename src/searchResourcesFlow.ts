// searchResourcesFlow.ts
//
// Enquirer-driven wizard for `searchComputeResources`. Styled like interactiveFlow.ts
// (figlet banner + chalk-green prompts). Returns a fully-formed ResourceSearchParams; all
// network work happens later in Commands.searchComputeResources.

import enquirer from "enquirer";
const { prompt } = enquirer;

import chalk from "chalk";
import figlet from "figlet";
import {
  ResourceSearchParams,
  ResourceDimension,
  ChainFilter,
  SearchMode,
  SearchOrderBy,
} from "./searchResourcesHelpers.js";

const RESOURCE_NAME_RE = /^[a-z0-9_-]+$/;

const UNIT: Record<string, string> = {
  cpu: "cores",
  ram: "GB",
  disk: "GB",
  gpu: "devices",
};

// Prompt for a strictly-positive amount for one resource.
async function askAmount(resource: string): Promise<number> {
  const { amount } = await prompt<{ amount: string }>({
    type: "input",
    name: "amount",
    message: chalk.green(
      `How much ${resource} do you need? (${UNIT[resource] ?? "units"})\n`,
    ),
    validate: (v: string) =>
      (Number(v) > 0 && Number.isFinite(Number(v))) ||
      "Enter a positive number.",
  });
  return Number(amount);
}

export async function interactiveResourceSearch(
  defaultChainId?: number,
): Promise<ResourceSearchParams> {
  console.clear();
  console.log(
    chalk.blue(figlet.textSync("Ocean CLI", { horizontalLayout: "full" })),
  );
  console.log(chalk.cyan("Search the network for compute providers.\n"));

  // 1. Which resources?
  // enquirer's default `indicator` is the plain string "✔", which renders the SAME glyph for
  // selected and unselected choices (differing only by color) — so toggling looks like it does
  // nothing on terminals where the color shift is subtle. Give it distinct on/off glyphs so the
  // selection state is unmistakable.
  const { picked } = await prompt<{ picked: string[] }>({
    type: "multiselect",
    name: "picked",
    message: chalk.green(
      "Which resources do you need? (↑/↓ to move, space to toggle, enter to confirm)\n",
    ),
    indicator: { on: "◉", off: "◯" },
    choices: [
      { name: "cpu" },
      { name: "ram" },
      { name: "disk" },
      { name: "gpu" },
      { name: "Other (type a name)" },
    ],
  } as never);

  const resources: ResourceDimension[] = [];
  for (const choice of picked) {
    if (choice === "Other (type a name)") continue;
    resources.push({ resource: choice, value: await askAmount(choice) });
  }

  // 1b. Custom resources (fpga, tpu, ...) — allow adding several.
  if (picked.includes("Other (type a name)")) {
    let addMore = true;
    while (addMore) {
      const { resource } = await prompt<{ resource: string }>({
        type: "input",
        name: "resource",
        message: chalk.green(
          "Name of the custom resource (e.g. fpga):\n",
        ),
        validate: (v: string) =>
          RESOURCE_NAME_RE.test(v.trim().toLowerCase()) ||
          "Use letters, digits, '-' or '_'.",
      });
      const name = resource.trim().toLowerCase();
      resources.push({ resource: name, value: await askAmount(name) });
      const { again } = await prompt<{ again: boolean }>({
        type: "toggle",
        name: "again",
        message: chalk.green("Add another custom resource?\n"),
        enabled: "Yes",
        disabled: "No",
      });
      addMore = again;
    }
  }

  if (resources.length === 0) {
    throw new Error("You must select at least one resource to search for.");
  }

  // 2. GPU qualifier.
  let models: Record<string, string> | undefined;
  if (resources.some((r) => r.resource === "gpu")) {
    const { gpuModel } = await prompt<{ gpuModel: string }>({
      type: "input",
      name: "gpuModel",
      message: chalk.green(
        "Any specific GPU kind or description? (e.g. A100 — leave blank for any)\n",
      ),
    });
    if (gpuModel && gpuModel.trim()) models = { gpu: gpuModel.trim() };
  }

  // 3. Free / paid / both.
  const { mode } = await prompt<{ mode: SearchMode }>({
    type: "select",
    name: "mode",
    message: chalk.green("Free environments, paid, or both?\n"),
    choices: [
      { name: "Both", value: "both" },
      { name: "Free only", value: "free" },
      { name: "Paid only", value: "paid" },
    ],
    result(value: string) {
      return this.choices.find((choice) => choice.name === value).value;
    },
  });

  let chains: ChainFilter[] | undefined;
  let maxPrice: number | undefined;
  let durationSeconds: number | undefined;

  // 4-6. Paid filters.
  if (mode === "paid" || mode === "both") {
    const OTHER = "Other (type chainId(s))";
    // Map the human-readable choice labels back to chainIds.
    const known: { name: string; id: number }[] = [
      ...(defaultChainId
        ? [{ name: `Current RPC chain (${defaultChainId})`, id: defaultChainId }]
        : []),
      { name: "Ethereum (1)", id: 1 },
      { name: "Polygon (137)", id: 137 },
      { name: "Base (8453)", id: 8453 },
      { name: "Oasis Sapphire (23294)", id: 23294 },
    ];
    const { pickedChains } = await prompt<{ pickedChains: string[] }>({
      type: "multiselect",
      name: "pickedChains",
      message: chalk.green(
        "Which chain(s) should pricing use? (space to toggle, enter to confirm)\n",
      ),
      indicator: { on: "◉", off: "◯" },
      choices: [...known.map((k) => ({ name: k.name })), { name: OTHER }],
    } as never);

    const chainIds: number[] = [];
    for (const name of pickedChains) {
      if (name === OTHER) continue;
      const hit = known.find((k) => k.name === name);
      if (hit) chainIds.push(hit.id);
    }

    // Custom chainIds — allow adding several.
    if (pickedChains.includes(OTHER)) {
      let addMore = true;
      while (addMore) {
        const { manual } = await prompt<{ manual: string }>({
          type: "input",
          name: "manual",
          message: chalk.green("Enter a chainId:\n"),
          validate: (v: string) =>
            Number.isInteger(Number(v)) || "Enter an integer chainId.",
        });
        chainIds.push(Number(manual));
        const { again } = await prompt<{ again: boolean }>({
          type: "toggle",
          name: "again",
          message: chalk.green("Add another chain?\n"),
          enabled: "Yes",
          disabled: "No",
        });
        addMore = again;
      }
    }

    // Deduplicate; fall back to the RPC chain if nothing was chosen.
    let uniqueIds = [...new Set(chainIds)];
    if (uniqueIds.length === 0) {
      if (defaultChainId === undefined) {
        throw new Error("Select at least one chain to price against.");
      }
      uniqueIds = [defaultChainId];
    }

    // Per chain, ask which payment tokens to restrict to (blank = any token on that chain).
    chains = [];
    for (const chainId of uniqueIds) {
      const { tokensIn } = await prompt<{ tokensIn: string }>({
        type: "input",
        name: "tokensIn",
        message: chalk.green(
          `Restrict chain ${chainId} to specific payment-token address(es)? (comma-separated, blank for any)\n`,
        ),
      });
      const tokens = tokensIn
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      chains.push({ chainId, tokens: tokens.length ? tokens : undefined });
    }

    const { priceIn } = await prompt<{ priceIn: string }>({
      type: "input",
      name: "priceIn",
      message: chalk.green(
        "Max acceptable estimated cost in human units? (leave blank for no cap)\n",
      ),
      validate: (v: string) =>
        v.trim() === "" || Number(v) > 0 || "Enter a positive number or leave blank.",
    });
    if (priceIn && priceIn.trim()) maxPrice = Number(priceIn);

    const { durationIn } = await prompt<{ durationIn: string }>({
      type: "input",
      name: "durationIn",
      message: chalk.green(
        "Assumed job duration in seconds for the cost estimate? (default 3600)\n",
      ),
      validate: (v: string) =>
        v.trim() === "" || Number(v) > 0 || "Enter a positive number or leave blank.",
    });
    if (durationIn && durationIn.trim()) durationSeconds = Number(durationIn);
  }

  // 7. Ordering.
  const { orderBy } = await prompt<{ orderBy: SearchOrderBy }>({
    type: "select",
    name: "orderBy",
    message: chalk.green("Order results by?\n"),
    choices: [
      ...(mode !== "free" ? [{ name: "Cheapest first", value: "price" }] : []),
      { name: "Most free capacity", value: "freeCapacity" },
      { name: "Most resources available", value: "resources" },
      { name: "Least busy (fewest jobs)", value: "leastBusy" },
    ],
    result(value: string) {
      return this.choices.find((choice) => choice.name === value).value;
    },
  });

  const params: ResourceSearchParams = {
    resources,
    models,
    mode,
    chains,
    maxPrice,
    durationSeconds,
    orderBy,
  };

  console.log("\n" + chalk.cyan("Searching with:\n"));
  console.log(chalk.yellow(JSON.stringify(params, null, 2)));
  return params;
}
