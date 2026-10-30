/**
 * Hardwood / LVP / laminate / refinishing: the trade ObraMate was built for.
 * Every value here is what the app used before Trade Packs existed (Phase 0: no behavior change).
 */
import type { TradePack } from "../../types.js";
import { HARDWOOD_SERVICES } from "./services.js";

export const hardwood: TradePack = {
  id: "hardwood",
  label: "Hardwood & LVP",
  services: HARDWOOD_SERVICES,
  quote: {
    tagline: "Hardwood · LVP · Refinishing",
    // Fixed customer-facing order: Supply → Installation → Sand & Finish → Add On.
    sections: [
      { key: "supply", label: "SUPPLY" },
      { key: "installation", label: "INSTALLATION" },
      { key: "sand_finish", label: "SAND & FINISH" },
      { key: "add_on", label: "ADD ON" },
    ],
  },
  phases: [
    { key: "installation", label: { "pt-BR": "Instalação", "en-US": "Installation" }, doneAtField: "installationDoneAt" },
    { key: "sand_finish", label: { "pt-BR": "Lixa", "en-US": "Sand & Finish" }, doneAtField: "sandDoneAt" },
  ],
  combinedPhaseKey: "both",
  ai: {
    companyKind: "flooring installation companies",
  },
};
