/** Default Senior Floors palette used when a tenant has not customized branding. */
export const DEFAULT_BRAND = {
  primaryColor: "#1a2036",
  accentColor: "#d6b598",
} as const;

function clamp(n: number, min = 0, max = 255): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function parseHexColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(raw);
  if (!m) return null;
  return `#${m[1]!.toLowerCase()}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((n) => clamp(n).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(
    A.r + (B.r - A.r) * t,
    A.g + (B.g - A.g) * t,
    A.b + (B.b - A.b) * t,
  );
}

function lighten(hex: string, t: number): string {
  return mix(hex, "#ffffff", t);
}

function darken(hex: string, t: number): string {
  return mix(hex, "#000000", t);
}

export type BrandInput = {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
};

export type BrandPalette = {
  name: string;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  css_vars: Record<string, string>;
};

export function buildBrandPalette(org: BrandInput): BrandPalette {
  const primary = parseHexColor(org.primaryColor) || DEFAULT_BRAND.primaryColor;
  const accent = parseHexColor(org.accentColor) || DEFAULT_BRAND.accentColor;

  const css_vars: Record<string, string> = {
    // SF dashboard tokens
    "--sf-navy": primary,
    "--sf-navy2": lighten(primary, 0.08),
    "--sf-navy3": lighten(primary, 0.14),
    "--sf-gold": accent,
    "--sf-gold2": lighten(accent, 0.12),
    "--sf-gold3": darken(accent, 0.08),
    "--sf-gold4": darken(accent, 0.18),
    "--sf-gold5": darken(accent, 0.28),
    "--sf-gold-soft": lighten(accent, 0.72),
    "--sf-gold-bg": lighten(accent, 0.82),
    "--sf-gold-card": lighten(accent, 0.55),
    "--sf-bg": lighten(accent, 0.88),
    "--sf-border": mix(accent, primary, 0.25),
    // Design-system tokens
    "--color-primary": primary,
    "--color-primary-hover": darken(primary, 0.1),
    "--color-accent": accent,
    "--color-accent-hover": darken(accent, 0.12),
    "--primary-color": primary,
    "--primary-hover": darken(primary, 0.1),
    "--primary-light": lighten(primary, 0.12),
    "--primary-dark": darken(primary, 0.15),
    "--secondary-color": accent,
    "--secondary-hover": darken(accent, 0.12),
    "--secondary-dark": darken(accent, 0.22),
    "--brand": primary,
    // Builder portal aliases
    "--bp-navy": primary,
    "--bp-navy-deep": darken(primary, 0.12),
    "--bp-tan": accent,
    "--bp-tan-pale": lighten(accent, 0.75),
  };

  return {
    name: org.name,
    logo_url: org.logoUrl,
    primary_color: primary,
    accent_color: accent,
    css_vars,
  };
}

export function brandPaletteToCss(palette: BrandPalette): string {
  const lines = Object.entries(palette.css_vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `:root {\n${lines}\n}\n`;
}
