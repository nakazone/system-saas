import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/** Runs mate-wake.js in a minimal browser stand-in and returns window.MateWake. */
function loadWake(): { parse: (t: string) => string | null; supported: boolean } {
  const code = readFileSync(new URL("../crm/public/mate-wake.js", import.meta.url), "utf8");
  const store = new Map<string, string>();
  const win: Record<string, unknown> = {
    SpeechRecognition: function () {},
    addEventListener: () => {},
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
  };
  const ctx = {
    window: win,
    localStorage: win.localStorage,
    location: { pathname: "/dashboard" },
    navigator: {},
    document: { readyState: "loading", addEventListener: () => {}, hidden: false, documentElement: { lang: "pt-BR" } },
    setTimeout,
    clearTimeout,
  };
  runInNewContext(code, ctx);
  return win.MateWake as { parse: (t: string) => string | null; supported: boolean };
}

describe('"Ei, Mate" spotting', () => {
  const wake = loadWake();

  it("hears the call with the request in the same breath", () => {
    expect(wake.parse("Ei, Mate, cheguei na obra")).toBe("cheguei na obra");
    expect(wake.parse("hey mate what do I have tomorrow")).toBe("what do I have tomorrow");
    expect(wake.parse("Oye Mate, terminé")).toBe("terminé");
  });

  it("hears the call alone (then it beeps and listens)", () => {
    expect(wake.parse("Ei Mate")).toBe("");
    expect(wake.parse("ei matte")).toBe("");
  });

  it("takes common mishearings at the start", () => {
    expect(wake.parse("é mate lança a diária do Lucas")).toBe("lança a diária do Lucas");
  });

  it("ignores talk that only mentions mate in the middle", () => {
    expect(wake.parse("vou tomar um chimarrão e mate gelado")).toBeNull();
    expect(wake.parse("o material chegou")).toBeNull();
  });
});
