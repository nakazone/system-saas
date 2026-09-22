/** Default ObraMate palette used when a tenant has not customized branding. */
export const DEFAULT_BRAND = {
  primaryColor: "#211d1a",
  accentColor: "#e8792c",
  secondaryColor: "#c1652f",
  surfaceColor: "#f7f4ee",
} as const;

export const DEFAULT_LOGO_PATH = "/assets/obramate-logo.png";

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
  logo_url: string;
  primary_color: string;
  accent_color: string;
  secondary_color: string;
  surface_color: string;
  css_vars: Record<string, string>;
};

export function buildBrandPalette(org: BrandInput): BrandPalette {
  const primary = parseHexColor(org.primaryColor) || DEFAULT_BRAND.primaryColor;
  const accent = parseHexColor(org.accentColor) || DEFAULT_BRAND.accentColor;
  const secondary = DEFAULT_BRAND.secondaryColor;
  const surface = DEFAULT_BRAND.surfaceColor;
  const logo_url = org.logoUrl || DEFAULT_LOGO_PATH;

  const css_vars: Record<string, string> = {
    // SF dashboard tokens (mapped to ObraMate)
    "--sf-navy": primary,
    "--sf-navy2": lighten(primary, 0.1),
    "--sf-navy3": lighten(primary, 0.18),
    "--sf-gold": accent,
    "--sf-gold2": lighten(accent, 0.12),
    "--sf-gold3": secondary,
    "--sf-gold4": darken(accent, 0.12),
    "--sf-gold5": darken(secondary, 0.08),
    "--sf-gold-soft": mix(accent, surface, 0.88),
    "--sf-gold-bg": surface,
    "--sf-gold-card": mix(accent, surface, 0.72),
    "--sf-bg": surface,
    "--sf-white": "#ffffff",
    "--sf-border": mix(secondary, surface, 0.55),
    "--sf-muted": mix(primary, surface, 0.45),
    // Design-system tokens
    "--color-primary": primary,
    "--color-primary-hover": darken(primary, 0.08),
    "--color-accent": accent,
    "--color-accent-hover": secondary,
    "--color-surface": "#ffffff",
    "--color-surface-secondary": surface,
    "--color-surface-tertiary": mix(accent, surface, 0.9),
    "--color-border": mix(secondary, surface, 0.55),
    "--color-text-primary": primary,
    "--primary-color": primary,
    "--primary-hover": darken(primary, 0.08),
    "--primary-light": lighten(primary, 0.14),
    "--primary-dark": darken(primary, 0.12),
    "--secondary-color": accent,
    "--secondary-hover": secondary,
    "--secondary-dark": darken(secondary, 0.1),
    "--brand": accent,
    "--brand-dark": secondary,
    "--brand-ink": primary,
    "--brand-surface": surface,
    "--brand-secondary": secondary,
    // Builder portal aliases
    "--bp-navy": primary,
    "--bp-navy-deep": darken(primary, 0.1),
    "--bp-tan": accent,
    "--bp-tan-pale": mix(accent, surface, 0.85),
  };

  return {
    name: org.name,
    logo_url,
    primary_color: primary,
    accent_color: accent,
    secondary_color: secondary,
    surface_color: surface,
    css_vars,
  };
}

export function brandPaletteToCss(palette: BrandPalette): string {
  const lines = Object.entries(palette.css_vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `:root {\n${lines}\n}\n`;
}
