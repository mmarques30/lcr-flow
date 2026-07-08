// Mapa de Transações Típicas (33 regras) — fonte: config/Modelo de mapeamento das transações típicas.xlsx
import mapaData from "./mapa-data.json" with { type: "json" };

export type MapaRegra = {
  id: string;
  tipo: string;
  gatilho: string;
  deb: string;
  cred: string;
  hist: string;
  compl: string;
};

export const MAPA_REGRAS = mapaData as MapaRegra[];

export function formatMapaCtx(): string {
  return MAPA_REGRAS.map((r) =>
    `[${r.id}] ${r.tipo}\n  Gatilho: ${r.gatilho}\n  D: ${r.deb} | C: ${r.cred} | Hist: ${r.hist}\n  Compl: ${r.compl}`
  ).join("\n\n");
}
