export interface Mention {
  term: string;
  source: "x" | "dexscreener" | "geckoterminal";
  weight: number;
  solanaAdjacent: boolean;
  fdvUsd?: number;
  sample?: string;
}

export interface SourceResult {
  source: Mention["source"];
  ok: boolean;
  mentions: Mention[];
  note?: string;
}
