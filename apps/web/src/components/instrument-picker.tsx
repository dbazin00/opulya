"use client";
import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Dropdown } from "./dropdown";
import { useCurrencies } from "./providers";
import { MarketDataCredit } from "./market-data-credit";
import { AssetListing } from "./asset-listing";
import { api } from "@/lib/api";
import type { Asset, Instrument } from "@/lib/types";
import { Button, Empty, ErrorNotice, Field, IconButton, Loading } from "./ui";

const types = ["STOCK", "ETF", "CRYPTO", "FUND"] as const;
type Directory = {
  items: Instrument[];
  total: number;
  ownedCount: number;
  page: number;
  hasMore: boolean;
};

export function InstrumentPicker({
  onDone,
  currency,
  initialType,
}: {
  onDone: (asset: Asset) => void;
  currency?: string;
  initialType?: string;
}) {
  const t = useTranslations();
  const currencies = useCurrencies();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [assetType, setAssetType] = useState(
    initialType && types.some((type) => type === initialType)
      ? initialType
      : "",
  );
  const [chosenCurrency, setCurrency] = useState(
    currencies.find((value) => value === currency) ?? "EUR",
  );
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);
  const current = query === search.trim();
  const catalogue = useQuery({
    queryKey: ["instrument-directory", query, chosenCurrency, assetType, page],
    queryFn: () =>
      api<Directory>(
        `instruments/directory?search=${encodeURIComponent(query)}&currency=${chosenCurrency}&page=${page}${assetType ? `&assetType=${assetType}` : ""}`,
      ),
    enabled: query.length >= 2 && current,
    staleTime: 86400000,
    gcTime: 1800000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const save = useMutation({
    mutationFn: () => api<Asset>("assets", { instrumentId: selected!.id }),
    onSuccess: async (asset) => {
      await client.invalidateQueries();
      onDone(asset);
    },
  });
  const resetSelection = () => {
    setSelected(null);
    save.reset();
  };
  const rows =
    current && query.length >= 2
      ? (catalogue.data?.items ?? []).filter(
          (row) =>
            (!assetType || row.assetType === assetType) &&
            row.currency === chosenCurrency,
        )
      : [];
  const searching =
    search.trim().length >= 2 && (!current || catalogue.isFetching);
  return (
    <div className="instrument-picker">
      <div className="instrument-filters">
        <Field label={t("investments.assetType")}>
          {(id) => (
            <Dropdown
              id={id}
              value={assetType}
              disabled={save.isPending}
              onValueChange={(value) => {
                setAssetType(value);
                resetSelection();
                setPage(0);
              }}
            >
              <option value="">{t("common.all")}</option>
              {types.map((type) => (
                <option value={type} key={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </Dropdown>
          )}
        </Field>
        <Field label={t("listing.tradingCurrency")}>
          {(id) => (
            <Dropdown
              id={id}
              value={chosenCurrency}
              disabled={!!currency || save.isPending}
              onValueChange={(value) => {
                setCurrency(value);
                resetSelection();
                setPage(0);
              }}
            >
              {currencies.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Dropdown>
          )}
        </Field>
      </div>
      <Field label={t("investments.searchInstrument")}>
        {(id) => (
          <input
            id={id}
            type="search"
            value={search}
            maxLength={80}
            autoFocus
            disabled={save.isPending}
            onChange={(e) => {
              setSearch(e.target.value);
              resetSelection();
              setPage(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setQuery(search.trim());
              }
            }}
          />
        )}
      </Field>
      <ErrorNotice error={catalogue.error} />
      {catalogue.isError && current && (
        <IconButton
          label={t("common.refresh")}
          busy={catalogue.isFetching}
          onClick={() => {
            catalogue.refetch();
          }}
        >
          <RefreshCw size={16} />
        </IconButton>
      )}
      <div
        className="instrument-results"
        aria-live="polite"
        aria-busy={searching}
      >
        {searching && !rows.length ? (
          <Loading />
        ) : rows.length ? (
          <ul aria-label={t("investments.searchResults")}>
            {types.map((type) => {
              const group = rows.filter((row) => row.assetType === type);
              if (!group.length) return null;
              return (
                <Fragment key={type}>
                  <li className="instrument-group">
                    <h3>{t(`types.${type}`)}</h3>
                  </li>
                  {group.map((instrument) => (
                    <li key={instrument.id}>
                      <button
                        type="button"
                        disabled={save.isPending}
                        aria-pressed={selected?.id === instrument.id}
                        className={
                          selected?.id === instrument.id ? "selected" : ""
                        }
                        onClick={() => {
                          setSelected(instrument);
                          save.reset();
                        }}
                      >
                        <AssetListing listing={instrument} />
                        <Check
                          size={18}
                          aria-hidden
                          style={{
                            visibility:
                              selected?.id === instrument.id
                                ? "visible"
                                : "hidden",
                          }}
                        />
                      </button>
                    </li>
                  ))}
                </Fragment>
              );
            })}
          </ul>
        ) : (
          <Empty
            title={t(
              query.length < 2
                ? "investments.startSearch"
                : catalogue.data?.ownedCount
                  ? "investments.alreadyAdded"
                  : "investments.noInstruments",
            )}
          />
        )}
      </div>
      {query.length >= 2 && current && catalogue.data && (
        <div className="instrument-pagination">
          <span>
            {t("investments.instrumentCount", { count: catalogue.data.total })}
          </span>
          <span>{t("investments.resultsPage", { page: page + 1 })}</span>
          <IconButton
            label={t("investments.previousResults")}
            disabled={!page || catalogue.isFetching || save.isPending}
            onClick={() => {
              setPage(page - 1);
              resetSelection();
            }}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            label={t("investments.nextResults")}
            disabled={
              !catalogue.data.hasMore || catalogue.isFetching || save.isPending
            }
            onClick={() => {
              setPage(page + 1);
              resetSelection();
            }}
          >
            <ChevronRight size={18} />
          </IconButton>
        </div>
      )}
      {!!rows.length && <MarketDataCredit />}
      <ErrorNotice error={save.error} />
      <div className="form-footer">
        <Button
          type="button"
          disabled={!selected || !current || searching}
          busy={save.isPending}
          onClick={() => save.mutate()}
        >
          <Plus size={16} aria-hidden />
          {t("investments.addAsset")}
        </Button>
      </div>
    </div>
  );
}
