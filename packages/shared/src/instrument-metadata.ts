import { z } from "zod";

const key = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
type Venue = {
  id: string;
  name: string;
  aliases: string[];
};
// Exchange aliases, not broker integrations or a predefined instrument catalogue.
const venues: Venue[] = [
  {
    id: "XAMS",
    name: "Euronext Amsterdam",
    aliases: ["AMS", "AEB", "Amsterdam"],
  },
  {
    id: "XPAR",
    name: "Euronext Paris",
    aliases: ["PAR", "SBF", "Paris"],
  },
  {
    id: "XBRU",
    name: "Euronext Brussels",
    aliases: ["BRU", "ENEXT.BE", "Brussels"],
  },
  {
    id: "XLIS",
    name: "Euronext Lisbon",
    aliases: ["LIS", "Lisbon"],
  },
  {
    id: "XETR",
    name: "Xetra",
    aliases: ["GER", "XETRA", "IBIS", "IBIS2"],
  },
  {
    id: "XFRA",
    name: "Frankfurt",
    aliases: ["FRA", "FWB", "FWB2"],
  },
  {
    id: "XLON",
    name: "London Stock Exchange",
    aliases: ["LSE", "LSEETF", "London"],
  },
  {
    id: "XMIL",
    name: "Borsa Italiana",
    aliases: ["MIL", "BVME", "BVME.ETF", "Milan"],
  },
  {
    id: "XSWX",
    name: "SIX Swiss Exchange",
    aliases: ["EBS", "SWX", "SIX"],
  },
  {
    id: "XNAS",
    name: "Nasdaq",
    aliases: ["NMS", "NGM", "NCM", "NASDAQ", "ISLAND", "XNGS", "XNMS", "XNCM"],
  },
  { id: "XNYS", name: "New York Stock Exchange", aliases: ["NYQ", "NYSE"] },
  { id: "XASE", name: "NYSE American", aliases: ["ASE", "AMEX"] },
  { id: "ARCX", name: "NYSE Arca", aliases: ["PCX", "ARCA"] },
  {
    id: "XTSE",
    name: "Toronto Stock Exchange",
    aliases: ["TOR", "TSX"],
  },
  {
    id: "XASX",
    name: "Australian Securities Exchange",
    aliases: ["ASX"],
  },
  {
    id: "XTKS",
    name: "Tokyo Stock Exchange",
    aliases: ["JPX", "Tokyo"],
  },
  {
    id: "XHKG",
    name: "Hong Kong Stock Exchange",
    aliases: ["HKG", "Hong Kong"],
  },
  { id: "XHAN", name: "Hanover", aliases: ["HAN"] },
  { id: "XHAM", name: "Hamburg", aliases: ["HAM"] },
  {
    id: "YAHOO:CXE",
    name: "Cboe Europe (CXE)",
    aliases: ["CXE"],
  },
  {
    id: "YAHOO:DXE",
    name: "Cboe Europe (DXE)",
    aliases: ["DXE"],
  },
];

export function findVenue(value: string): Venue | null {
  const normalized = key(value);
  return normalized
    ? (venues.find((venue) =>
        [venue.id, venue.name, ...venue.aliases].some(
          (alias) => key(alias) === normalized,
        ),
      ) ?? null)
    : null;
}
export type InstrumentListing = {
  symbol: string;
  name: string;
  currency: string;
  assetType: string;
  exchange: string;
  mic?: string;
  exchangeName?: string | null;
  isin?: string | null;
};
export function listingVenue(
  listing: Pick<
    InstrumentListing,
    "assetType" | "exchange" | "mic" | "exchangeName"
  >,
): Venue | null {
  if (listing.assetType === "CRYPTO") return null;
  return (
    findVenue(listing.mic ?? "") ||
    findVenue(listing.exchange) ||
    findVenue(listing.exchangeName ?? "")
  );
}
function looksLikeIsin(value: string) {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value.trim().toUpperCase());
}
export function validIsin(value: string) {
  const isin = value.trim().toUpperCase();
  if (!looksLikeIsin(isin)) return false;
  const digits = [...isin]
    .map((char) =>
      /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char,
    )
    .join("");
  let sum = 0;
  for (
    let i = digits.length - 1, double = false;
    i >= 0;
    i--, double = !double
  ) {
    let digit = Number(digits[i]);
    if (double) digit *= 2;
    sum += digit > 9 ? digit - 9 : digit;
  }
  return sum % 10 === 0;
}
export const isinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(validIsin, "INVALID_ISIN");
