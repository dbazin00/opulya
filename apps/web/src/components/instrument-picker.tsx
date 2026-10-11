"use client";
import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { currencies } from "@opulya/shared";
import { Dropdown } from "./dropdown";
import { MarketDataCredit } from "./market-data-credit";
import { api, ApiError } from "@/lib/api";
import type { Asset, Instrument } from "@/lib/types";
import {
  Button,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Loading,
  Spinner,
} from "./ui";
const types = ["STOCK", "ETF", "CRYPTO", "FUND"];
type Directory = {
  items: Instrument[];
  total: number;
  ownedCount: number;
  page: number;
  hasMore: boolean;
  loading: string[];
  errors: { type: string; code: string }[];
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
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [assetType, setAssetType] = useState(
    initialType && types.includes(initialType) ? initialType : "",
  );
  const [chosenCurrency, setCurrency] = useState(currency ?? "EUR");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    const providerTimer = setTimeout(() => setSettled(search.trim()), 900);
    return () => {
      clearTimeout(timer);
      clearTimeout(providerTimer);
    };
  }, [search]);
  const catalogue = useQuery({
    queryKey: ["instrument-directory", query, chosenCurrency, assetType, page],
    queryFn: () =>
      api<Directory>(
        `instruments/directory?search=${encodeURIComponent(query)}&currency=${chosenCurrency}&page=${page}${assetType ? `&assetType=${assetType}` : ""}`,
      ),
    refetchInterval: (state) =>
      state.state.data?.loading.length ? 2000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const discovery = useQuery({
    queryKey: [
      "instrument-discovery",
      query.toUpperCase(),
      assetType,
      chosenCurrency,
    ],
    queryFn: () =>
      api<Instrument[]>("instruments/search", {
        search: query,
        ...(assetType ? { assetType } : {}),
        currency: chosenCurrency,
      }),
    enabled:
      query.length >= 3 &&
      query === search.trim() &&
      settled === query &&
      catalogue.isSuccess &&
      !catalogue.data.loading.length &&
      !catalogue.data.ownedCount &&
      catalogue.data.items.length === 0,
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
  const current = query === search.trim();
  const result = catalogue.data?.items.length
    ? catalogue.data.items
    : catalogue.data?.ownedCount
      ? []
      : (discovery.data ?? []);
  const rows = current
    ? result.filter(
        (row) =>
          (!assetType || row.assetType === assetType) &&
          row.currency === chosenCurrency,
      )
    : [];
  const searching =
    !current ||
    catalogue.isFetching ||
    discovery.isFetching ||
    (query.length >= 3 &&
      !rows.length &&
      !catalogue.data?.loading.length &&
      settled !== query);
  const directoryError = catalogue.data?.errors[0];
  return (
    <div className="instrument-picker">
      <div className="instrument-filters">
        <Field label={t("investments.assetType")}>
          {(id) => (
            <Dropdown
              id={id}
              value={assetType}
              onValueChange={(value) => {
                setAssetType(value);
                setSelected(null);
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
        <Field label={t("common.currency")}>
          {(id) => (
            <Dropdown
              id={id}
              value={chosenCurrency}
              disabled={!!currency}
              onValueChange={(value) => {
                setCurrency(value);
                setSelected(null);
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
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
              setPage(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setQuery(search.trim());
                setSettled(search.trim());
              }
            }}
          />
        )}
      </Field>
      <ErrorNotice
        error={
          save.error ||
          discovery.error ||
          catalogue.error ||
          (directoryError && new ApiError(directoryError.code, 503))
        }
      />
      {(directoryError || discovery.isError) && current && (
        <IconButton
          label={t("common.refresh")}
          busy={catalogue.isFetching || discovery.isFetching}
          onClick={() => {
            catalogue.refetch();
            if (discovery.isError) discovery.refetch();
          }}
        >
          <RefreshCw size={16} />
        </IconButton>
      )}
      {!!catalogue.data?.loading.length && (
        <Spinner
          label={t("investments.loadingCatalogue")}
          showLabel
          className="instrument-progress"
        />
      )}
      <div
        className="instrument-results"
        aria-live="polite"
        aria-busy={searching || !!catalogue.data?.loading.length}
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
                        aria-pressed={selected?.id === instrument.id}
                        className={
                          selected?.id === instrument.id ? "selected" : ""
                        }
                        onClick={() => setSelected(instrument)}
                      >
                        <span>
                          <strong>
                            {type === "CRYPTO"
                              ? instrument.name
                              : instrument.symbol}
                          </strong>
                          <span>
                            {type === "CRYPTO"
                              ? instrument.symbol.split("/")[0]
                              : instrument.name}
                          </span>
                          <small>
                            {t(`types.${type}`)}
                            {type !== "CRYPTO"
                              ? ` · ${instrument.exchange || t("common.none")}${instrument.mic ? ` · ${instrument.mic}` : ""}`
                              : ""}{" "}
                            · {instrument.currency}
                          </small>
                        </span>
                        {selected?.id === instrument.id && (
                          <Check size={18} aria-hidden />
                        )}
                      </button>
                    </li>
                  ))}
                </Fragment>
              );
            })}
          </ul>
        ) : !catalogue.data?.loading.length ? (
          <Empty
            title={t(
              catalogue.data?.ownedCount
                ? "investments.alreadyAdded"
                : "investments.noInstruments",
            )}
          />
        ) : null}
      </div>
      {catalogue.data && (
        <div className="instrument-pagination">
          <span>
            {t("investments.instrumentCount", { count: catalogue.data.total })}
          </span>
          <span>{t("investments.resultsPage", { page: page + 1 })}</span>
          <IconButton
            label={t("investments.previousResults")}
            disabled={!page || catalogue.isFetching}
            onClick={() => {
              setPage(page - 1);
              setSelected(null);
            }}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            label={t("investments.nextResults")}
            disabled={!catalogue.data.hasMore || catalogue.isFetching}
            onClick={() => {
              setPage(page + 1);
              setSelected(null);
            }}
          >
            <ChevronRight size={18} />
          </IconButton>
        </div>
      )}
      {!!rows.length && <MarketDataCredit />}
      {selected && (
        <p className="muted">
          {selected.name} ·{" "}
          {selected.assetType === "CRYPTO"
            ? t("types.CRYPTO")
            : selected.exchange}{" "}
          · {selected.currency}
        </p>
      )}
      <div className="form-footer">
        <Button
          type="button"
          disabled={!selected}
          busy={save.isPending}
          onClick={() => save.mutate()}
        >
          <Check size={16} aria-hidden />
          {t("investments.selectInstrument")}
        </Button>
      </div>
    </div>
  );
}
