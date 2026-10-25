"use client";
import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { assetTypes, priceRefreshInterval } from "@opulya/shared";
import { api } from "@/lib/api";
import type { Asset, Portfolio } from "@/lib/types";
import { useVisible } from "@/lib/use-visible";
import { QuoteStatus } from "./quote-status";
import { Dropdown } from "./dropdown";
import { InstrumentPicker } from "./instrument-picker";
import { MarketDataCredit } from "./market-data-credit";
import { AssetListing, ListingDetails } from "./asset-listing";
import { useCurrencies } from "./providers";
import {
  Button,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Loading,
  Modal,
  Money,
} from "./ui";

export function AssetsView() {
  const t = useTranslations();
  const currencies = useCurrencies();
  const locale = useLocale();
  const visible = useVisible();
  const [currency, setCurrency] = useState("EUR");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Asset>();
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`assets/${deleting!.id}`, {}, "DELETE"),
    onSuccess: async () => {
      await client.invalidateQueries();
      setDeleting(undefined);
    },
  });
  const loaded = useRef(false);
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api<Asset[]>("assets"),
  });
  const prices = useQuery({
    queryKey: ["asset-prices"],
    queryFn: () => {
      const background = loaded.current;
      loaded.current = true;
      return api<Portfolio["quotes"]>("assets/prices", undefined, "POST", {
        background,
      });
    },
    enabled: !!assets.data?.length && visible,
    refetchInterval: priceRefreshInterval(visible, true),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const query = search.trim().toLocaleLowerCase(locale);
  const rows = (assets.data ?? [])
    .filter(
      (a) =>
        a.currency === currency &&
        (!type || a.assetType === type) &&
        `${a.name} ${a.symbol}`.toLocaleLowerCase(locale).includes(query),
    )
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  return (
    <>
      <div className="asset-controls">
        <Field label={t("assets.search")}>
          {(id) => (
            <input
              id={id}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("common.currency")}>
          {(id) => (
            <Dropdown id={id} value={currency} onValueChange={setCurrency}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Dropdown>
          )}
        </Field>
        <Field label={t("investments.assetType")}>
          {(id) => (
            <Dropdown id={id} value={type} onValueChange={setType}>
              <option value="">{t("common.all")}</option>
              {assetTypes.map((a) => (
                <option key={a} value={a}>
                  {t(`types.${a}`)}
                </option>
              ))}
            </Dropdown>
          )}
        </Field>
        <Button onClick={() => setAdding(true)}>
          <Plus size={17} />
          {t("investments.addAsset")}
        </Button>
      </div>
      <p className="asset-schedule muted">{t("assets.schedule")}</p>
      <ErrorNotice error={assets.error || prices.error} />
      {assets.isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty
          title={t(assets.data?.length ? "assets.noMatches" : "assets.empty")}
        />
      ) : (
        <>
          <div className="asset-list-head" aria-hidden="true">
            <span>{t("assets.asset")}</span>
            <span>{t("assets.unitPrice")}</span>
            <span>{t("assets.priceDate")}</span>
          </div>
          <ul className="asset-list" aria-label={t("assets.title")}>
            {rows.map((asset) => {
              const status = prices.data?.find((q) => q.assetId === asset.id);
              const quote = status?.quote;
              const pending = !quote && prices.isLoading;
              return (
                <li
                  className="asset-row"
                  key={asset.id}
                  data-asset-id={asset.id}
                >
                  <div className="asset-identity">
                    <AssetListing listing={asset} />
                    <ListingDetails listing={asset} />
                  </div>
                  <div className="asset-price">
                    <span className="asset-mobile-label">
                      {t("assets.unitPrice")}
                    </span>
                    <Money
                      value={quote?.price}
                      maximumFractionDigits={8}
                      currency={asset.currency}
                      placeholder={
                        pending ? t("investments.fetchingPrice") : undefined
                      }
                    />
                  </div>
                  <div className="asset-price-date">
                    <QuoteStatus
                      showTimeLabel={false}
                      quote={quote ?? null}
                      error={status?.error ?? null}
                      loading={pending}
                    />
                    {asset.canDelete && (
                      <IconButton
                        label={t("assets.deleteNamed", { name: asset.name })}
                        onClick={() => {
                          remove.reset();
                          setDeleting(asset);
                        }}
                      >
                        <Trash2 size={17} />
                      </IconButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <MarketDataCredit />
        </>
      )}
      <Modal
        title={t("assets.deleteTitle")}
        open={!!deleting}
        onClose={() => {
          if (!remove.isPending) {
            setDeleting(undefined);
            remove.reset();
          }
        }}
        description={
          deleting
            ? t("assets.deleteDescription", { name: deleting.name })
            : undefined
        }
      >
        <ErrorNotice error={remove.error} />
        <div className="form-footer">
          <Button
            className="secondary"
            disabled={remove.isPending}
            onClick={() => setDeleting(undefined)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            className="danger"
            busy={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 size={17} />
            {t("common.delete")}
          </Button>
        </div>
      </Modal>
      <Modal
        title={t("investments.addAsset")}
        open={adding}
        onClose={() => setAdding(false)}
      >
        {adding && (
          <InstrumentPicker
            currency={currency}
            initialType={type || undefined}
            onDone={() => setAdding(false)}
          />
        )}
      </Modal>
    </>
  );
}
