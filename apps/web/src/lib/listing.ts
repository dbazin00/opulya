import { listingVenue, type InstrumentListing } from "@opulya/shared";

export function listingExchange(
  listing: Pick<
    InstrumentListing,
    "assetType" | "exchange" | "mic" | "exchangeName"
  >,
): string | null {
  if (listing.assetType === "CRYPTO") return null;
  return (
    listingVenue(listing)?.name ||
    listing.exchangeName ||
    listing.exchange ||
    null
  );
}
