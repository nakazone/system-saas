export type CsvParseResult = {
  headers: string[];
  rows: string[][];
};

/** Minimal RFC4180-ish CSV parser (quoted fields, commas, newlines). */
export function parseCsv(text: string): CsvParseResult {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field.trim());
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field.trim());
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = rows[0]!.map((h) => h.trim());
  return { headers, rows: rows.slice(1) };
}

export const MAX_CSV_ROWS = 5000;

export type ImportEntityType = "customers" | "leads";

export type ColumnMapping = Record<string, string>; // field -> csv header name

export type MappedRow = {
  line: number;
  data: Record<string, string>;
  errors: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cell(row: string[], headers: string[], headerName: string | undefined): string {
  if (!headerName) return "";
  const idx = headers.findIndex((h) => h === headerName);
  if (idx < 0) return "";
  return (row[idx] ?? "").trim();
}

export function mapRows(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping,
  entity: ImportEntityType,
): MappedRow[] {
  return rows.map((row, i) => {
    const data: Record<string, string> = {};
    for (const [field, headerName] of Object.entries(mapping)) {
      data[field] = cell(row, headers, headerName);
    }
    const errors: string[] = [];
    const line = i + 2; // 1-based + header

    if (!data.name) errors.push("name is required");
    if (data.email && !EMAIL_RE.test(data.email)) errors.push("invalid email");
    if (entity === "customers") {
      // property fields optional except when any address part present
      const hasAddr = Boolean(data.line1 || data.city || data.state || data.postalCode);
      if (hasAddr && !data.line1) errors.push("line1 required when address provided");
    }
    if (data.phone && data.phone.length > 40) errors.push("phone too long");

    return { line, data, errors };
  });
}

export function suggestMapping(headers: string[], entity: ImportEntityType): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (...candidates: string[]) => {
    for (const c of candidates) {
      const idx = lower.findIndex((h) => h === c || h.includes(c));
      if (idx >= 0) return headers[idx]!;
    }
    return "";
  };

  const base: ColumnMapping = {
    name: find("name", "full name", "customer", "lead"),
    email: find("email", "e-mail"),
    phone: find("phone", "mobile", "tel"),
    notes: find("notes", "note", "comments"),
  };

  if (entity === "customers") {
    return {
      ...base,
      company: find("company", "business"),
      label: find("label", "property label", "site"),
      line1: find("address", "line1", "street", "address1"),
      line2: find("line2", "address2", "apt", "suite"),
      city: find("city"),
      state: find("state", "province", "region"),
      postalCode: find("postal", "zip", "postalcode", "zipcode"),
      country: find("country"),
    };
  }

  return {
    ...base,
    source: find("source", "origin", "channel"),
  };
}
