export type MateAiLineSpec = {
  serviceQuery: string;
  quantity: number;
  unit: string;
};

export type ParsedMateAiCommand = {
  customerQuery: string;
  items: MateAiLineSpec[];
};

export type PricingCandidate = {
  id: string;
  name: string;
  unit: string;
};

export type CustomerPricing = {
  customerType: string;
  pricingMode?: string | null;
  customPricingRates?: unknown;
};

export type PriceablePricingItem = {
  id: string;
  price?: unknown;
  priceMin?: unknown;
  priceMax?: unknown;
  partnerPrice?: unknown;
  priceContractor?: unknown;
  priceLoja?: unknown;
  priceParticular?: unknown;
  priceBuilder?: unknown;
  rateParticular?: unknown;
  rateBuilder?: unknown;
  rateContractor?: unknown;
  rateLoja?: unknown;
  defaultRate?: unknown;
  pricingItemId?: string | null;
  source?: "quote-catalog" | "pricing";
};

export type MateAiPricingSourceItem = PriceablePricingItem & {
  name: string;
  category: string;
  unit: string;
  active?: boolean;
  isVisible?: boolean;
  notes?: string | null;
  description?: string | null;
};

export type MateAiQuoteCatalogSourceItem = {
  id: string;
  name: string;
  serviceType?: string | null;
  unitType?: string | null;
  unitPrice?: unknown;
  description?: string | null;
  active?: boolean;
};

export type MateAiCatalogItem = PricingCandidate & {
  source: "quote-catalog" | "pricing";
  category: string;
  description: string | null;
  defaultRate: number;
  rateParticular: number;
  rateBuilder: number;
  rateContractor: number;
  rateLoja: number;
  pricingItemId: string | null;
};

const QUANTITY_UNIT =
  /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)\s*(sq\.?\s*ft\.?|sqft|sq_ft|square\s+feet?|ft²|p[eé]s?\s+quadrados?|linear\s*ft\.?|linear\s+feet?|lin_ft|lf|fixed|lump\s+sum|each|ea|piece(?:s)?|box(?:es)?|step(?:s)?|hour(?:s)?|hr)/giu;

const SERVICE_SYNONYMS: Record<string, string> = {
  acabamento: "finish",
  acabamentos: "finish",
  install: "installation",
  installing: "installation",
  instalacao: "installation",
  instalacoes: "installation",
  instalado: "installation",
  instalar: "installation",
  lixa: "sand",
  lixar: "sand",
  lixamento: "sand",
  sanding: "sand",
  sand: "sand",
  remover: "removal",
  remove: "removal",
  removendo: "removal",
  remocao: "removal",
  retirando: "removal",
  retirar: "removal",
  tapete: "carpet",
  carpete: "carpet",
};

const SERVICE_STOP_WORDS = new Set([
  "a", "as", "an", "and", "com", "da", "das", "de", "do", "dos", "e", "for",
  "o", "of", "os", "para", "the", "um", "uma", "with",
]);

export function normalizeMateAiText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedServiceTokens(value: string): string[] {
  return normalizeMateAiText(value)
    .split(" ")
    .filter((token) => token && !SERVICE_STOP_WORDS.has(token))
    .map((token) => SERVICE_SYNONYMS[token] || token);
}

export function normalizeMateAiUnit(value: string): string | null {
  const unit = normalizeMateAiText(value).replace(/\s+/g, " ");
  if (/^(sq ft|sqft|sq feet|square feet|square foot|ft2|ft|pe quadrado|pes quadrados?)$/.test(unit)) return "sq_ft";
  if (/^(linear ft|linear feet|linear foot|lin ft|lf)$/.test(unit)) return "linear_ft";
  if (/^(fixed|lump sum)$/.test(unit)) return "fixed";
  if (/^(each|ea|piece|pieces|unit)$/.test(unit)) return "each";
  if (/^(box|boxes)$/.test(unit)) return "box";
  if (/^(step|steps)$/.test(unit)) return "step";
  if (/^(hour|hours|hr)$/.test(unit)) return "hour";
  return null;
}

function parseQuantity(raw: string): number {
  const normalized = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".");
  return Number(normalized);
}

function customerNameFromCommand(command: string): string {
  const labeled = command.match(
    /\b(?:para|for)\s+(?:(?:o|a|the)\s+)?(?:cliente|customer|client)\s+(.+?)(?=\s+(?:com|with)\b|[,;:]|$)/i,
  );
  const fallback = labeled
    ? null
    : command.match(/\b(?:para|for)\s+(?:(?:o|a|the)\s+)?(.+?)(?=\s+(?:com|with)\b|[,;:]|$)/i);
  return String(labeled?.[1] || fallback?.[1] || "")
    .replace(/^(?:cliente|customer|client)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clauseBounds(command: string, position: number, endPosition: number): [number, number] {
  let start = 0;
  let end = command.length;
  const separators = /[,;]|\b(?:and|e)\b/giu;
  for (const match of command.matchAll(separators)) {
    const index = match.index ?? 0;
    const separator = match[0];
    if (separator === "," && /\d/.test(command[index - 1] || "") && /\d/.test(command[index + 1] || "")) {
      continue;
    }
    const separatorEnd = index + separator.length;
    if (separatorEnd <= position) start = separatorEnd;
    else if (index >= endPosition) {
      end = index;
      break;
    }
  }
  return [start, end];
}

function prefixService(raw: string): string {
  return raw
    .replace(/^.*\b(?:com|with)\b/i, "")
    .replace(/^.*\b(?:and|e)\b/i, "")
    .replace(/\b(?:cliente|customer|client)\b.*$/i, "")
    .replace(/\b(?:crie|criar|create|make|montar|monte|prepare|quote|or[cç]amento)\b/gi, " ")
    .replace(/\b(?:para|for)\s+/gi, " ")
    .replace(/\b(?:o|a|um|uma|the|of|de|do|da|dos|das)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function suffixService(raw: string): string {
  return raw
    .replace(/^\s*(?:(?:de|do|da|dos|das|of)\s+)+/i, "")
    .replace(/\s+(?:please|por favor)$/i, "")
    .trim();
}

export function parseMateAiCommand(command: string): ParsedMateAiCommand {
  const text = String(command || "").trim();
  if (!text || text.length > 500) throw new Error("command_length");

  const customerQuery = customerNameFromCommand(text);
  if (!customerQuery) throw new Error("customer_missing");

  const items: MateAiLineSpec[] = [];
  for (const match of text.matchAll(QUANTITY_UNIT)) {
    const index = match.index ?? 0;
    const quantity = parseQuantity(match[1] || "");
    const unit = normalizeMateAiUnit(match[2] || "");
    const endPosition = index + match[0].length;
    const [start, end] = clauseBounds(text, index, endPosition);
    const before = prefixService(text.slice(start, index));
    const after = suffixService(text.slice(endPosition, end));
    const serviceTokens = normalizedServiceTokens([before, after].filter(Boolean).join(" "));
    const serviceQuery = serviceTokens.join(" ");

    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) {
      throw new Error("quantity_invalid");
    }
    if (Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001) {
      throw new Error("quantity_precision");
    }
    if (!unit) throw new Error("unit_unsupported");
    if (!serviceQuery) throw new Error("service_missing");
    items.push({ serviceQuery, quantity, unit });
    if (items.length > 8) throw new Error("too_many_items");
  }

  if (!items.length) throw new Error("items_missing");
  return { customerQuery, items };
}

function normalizedUnit(value: string): string | null {
  return normalizeMateAiUnit(value);
}

export function matchPricingService<T extends PricingCandidate>(
  query: string,
  unit: string,
  candidates: T[],
): { status: "matched"; item: T } | { status: "not_found" } | { status: "ambiguous"; items: T[] } {
  const queryTokens = normalizedServiceTokens(query);
  if (!queryTokens.length) return { status: "not_found" };

  const matchingUnit = candidates.filter((item) => normalizedUnit(item.unit) === normalizedUnit(unit));
  const scored = matchingUnit
    .map((item) => {
      const itemTokens = normalizedServiceTokens(item.name);
      const exact = normalizeMateAiText(item.name) === normalizeMateAiText(query);
      const allTokensIncluded = queryTokens.every((token) => itemTokens.includes(token));
      return { item, score: exact ? 100 : allTokensIncluded ? 80 : 0 };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  if (!scored.length) return { status: "not_found" };
  const best = scored[0]!;
  const bestItems = scored.filter((candidate) => candidate.score === best.score).map((candidate) => candidate.item);
  if (bestItems.length !== 1) return { status: "ambiguous", items: bestItems.slice(0, 8) };
  return { status: "matched", item: bestItems[0]! };
}

function moneyValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const number = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(number) ? number : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function resolveCustomerUnitPrice(item: PriceablePricingItem, customer: CustomerPricing): number | null {
  const rates =
    customer.customPricingRates && typeof customer.customPricingRates === "object" && !Array.isArray(customer.customPricingRates)
      ? (customer.customPricingRates as Record<string, unknown>)
      : {};
  if (String(customer.pricingMode || "table").toLowerCase() === "custom") {
    let custom: number | null = null;
    if (item.pricingItemId && rates[item.pricingItemId] != null) {
      const value = moneyValue(rates[item.pricingItemId]);
      if (value != null && value >= 0) custom = value;
    }
    if (custom == null && rates[item.id] != null) {
      const value = moneyValue(rates[item.id]);
      if (value != null && value >= 0) custom = value;
    }
    if (custom != null && custom > 0) return Math.round(custom * 100) / 100;
  }

  const itemWithRates = item as PriceablePricingItem & Partial<MateAiCatalogItem>;
  let particular: number;
  let builder: number;
  let loja: number;
  if (itemWithRates.rateParticular != null || itemWithRates.defaultRate != null) {
    particular = firstRate(itemWithRates.rateParticular, itemWithRates.defaultRate);
    const fallback = firstRate(itemWithRates.defaultRate, particular);
    builder = firstRate(itemWithRates.rateBuilder, fallback);
    loja = firstRate(itemWithRates.rateLoja, fallback);
  } else {
    particular = firstRate(item.priceParticular, item.priceMax, item.priceMin, item.price);
    builder = firstRate(item.priceBuilder, item.partnerPrice, item.priceMin, particular);
    loja = firstRate(item.priceLoja, item.priceMin, item.price, particular);
  }

  const customerType = normalizeMateAiText(customer.customerType);
  // The Quote Builder maps both contractor and builder parties to its Builder
  // price column via pricingTypeFromParty().
  if (customerType === "builder" || customerType === "contractor") return builder;
  if (customerType === "loja") return loja;
  return particular;
}

function firstRate(...values: unknown[]): number {
  for (const value of values) {
    const parsed = moneyValue(value);
    if (parsed != null && parsed > 0) return Math.round(parsed * 100) / 100;
  }
  return 0;
}

function catalogNameKey(name: string): string {
  return String(name || "").trim().toLowerCase();
}

function catalogMoney(value: unknown): number {
  const parsed = moneyValue(value);
  return parsed != null && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

export function mergeMateAiCatalog(
  quoteCatalogRows: MateAiQuoteCatalogSourceItem[],
  pricingRows: MateAiPricingSourceItem[],
): MateAiCatalogItem[] {
  const fromPricing: MateAiCatalogItem[] = pricingRows
    .filter((row) => row && row.name && row.active !== false && row.isVisible !== false)
    .map((row) => {
      const particular = catalogMoney(row.priceParticular) || catalogMoney(row.priceMax) ||
        catalogMoney(row.priceMin) || catalogMoney(row.price);
      const builder = catalogMoney(row.priceBuilder) || catalogMoney(row.partnerPrice) ||
        catalogMoney(row.priceMin) || particular;
      const contractor = catalogMoney(row.priceContractor) || builder || particular;
      const loja = catalogMoney(row.priceLoja) || catalogMoney(row.priceMin) ||
        catalogMoney(row.price) || particular;
      return {
        id: row.id,
        name: row.name,
        unit: row.unit,
        category: row.category,
        description: String(row.notes || row.description || "").trim() || null,
        defaultRate: particular,
        rateParticular: particular,
        rateBuilder: builder,
        rateContractor: contractor,
        rateLoja: loja,
        source: "pricing" as const,
        pricingItemId: row.id,
      };
    });

  const activeQuoteRows = quoteCatalogRows.filter((row) => row && row.name && row.active !== false);
  if (!activeQuoteRows.length) return fromPricing;

  const pricingByName = new Map<string, MateAiCatalogItem>();
  for (const row of fromPricing) {
    const key = catalogNameKey(row.name);
    if (key && !pricingByName.has(key)) pricingByName.set(key, row);
  }

  const merged = activeQuoteRows.map((row): MateAiCatalogItem => {
    const key = catalogNameKey(row.name);
    const baseRate = catalogMoney(row.unitPrice);
    const quoteItem: MateAiCatalogItem = {
      id: row.id,
      name: row.name,
      unit: row.unitType || "sq_ft",
      category: row.serviceType || "",
      description: String(row.description || "").trim() || null,
      defaultRate: baseRate,
      rateParticular: baseRate,
      rateBuilder: baseRate,
      rateContractor: baseRate,
      rateLoja: baseRate,
      source: "quote-catalog",
      pricingItemId: null,
    };
    const hit = pricingByName.get(key);
    if (!hit) return quoteItem;
    return {
      ...quoteItem,
      category: hit.category || quoteItem.category,
      description: hit.description || quoteItem.description,
      defaultRate: hit.rateParticular || quoteItem.defaultRate,
      rateParticular: hit.rateParticular || quoteItem.rateParticular,
      rateBuilder: hit.rateBuilder || quoteItem.rateBuilder,
      rateContractor: hit.rateContractor || quoteItem.rateContractor,
      rateLoja: hit.rateLoja || quoteItem.rateLoja,
      pricingItemId: hit.pricingItemId,
    };
  });

  const seen = new Set(merged.map((row) => catalogNameKey(row.name)).filter(Boolean));
  for (const row of fromPricing) {
    const key = catalogNameKey(row.name);
    if (!key || seen.has(key)) continue;
    merged.push(row);
    seen.add(key);
  }
  return merged;
}
