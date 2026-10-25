import type { InvestmentEntry, LedgerTransaction } from "@opulya/shared";
export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  locale: "en" | "hr";
  timeZone: string;
  processingRestrictedAt?: string | null;
}
export interface Account {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "INVESTMENT";
  currency: string;
  initialBalance: string;
  currentBalance: string;
  archivedAt: string | null;
  canDelete: boolean;
  canChangeInvestmentType: boolean;
}
export interface Category {
  id: string;
  name: string | null;
  defaultKey: string | null;
  parentId: string | null;
  type: "INCOME" | "EXPENSE";
  archivedAt?: string | null;
  _count?: { transactions: number; budgets?: number };
}
export interface Transaction extends LedgerTransaction {
  sourceBalanceAfter?: string | null;
  destinationBalanceAfter?: string | null;
  isOpeningBalance?: boolean;
  investmentActivityId?: string | null;
  currency: string;
  categoryId: string | null;
  description: string | null;
}
export interface Asset {
  canDelete?: boolean;
  sourceSymbol?: string | null;
  exchangeName?: string | null;
  mic?: string;
  isin?: string | null;
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  assetType: string;
  instrumentId?: string | null;
}
export type EditableInvestment = InvestmentEntry & {
  sourceAccountId: string | null;
};
export interface Instrument {
  id: string;
  name: string;
  symbol: string;
  assetType: string;
  exchange: string;
  exchangeName?: string | null;
  mic: string;
  currency: string;
  isin: string | null;
}
export interface Flow {
  income: string;
  expenses: string;
  net: string;
}
export interface Analytics extends Flow {
  month: string;
  days: (Flow & { date: string; count: number })[];
  trends: (Flow & { month: string; balance: string })[];
  distribution: {
    id: string;
    name: string | null;
    defaultKey: string | null;
    hasChildren: boolean;
    amount: string;
  }[];
  direct: string;
  parent: Category | null;
  accounts: (Flow & { id: string; name: string })[];
}
export interface Overview {
  accounts: Account[];
  cash: string;
  investments: string | null;
  netWorth: string | null;
  incomplete: boolean;
  stale: boolean;
  currency: string;
}
export interface History extends Flow {
  account: Account;
  opening: string;
  closing: string;
  entries: {
    id: string;
    timestamp: string;
    delta: string;
    balanceAfter: string;
    kind: string;
    type: string;
    transaction: Transaction | InvestmentEntry;
    funding: {
      amount: string;
      sourceAccountId: string;
      destinationAccountId: string;
      sourceAccountName: string;
      destinationAccountName: string;
    } | null;
  }[];
}
export interface Portfolio {
  account: Account;
  cashBalance: string;
  holdingsValue: string | null;
  totalValue: string | null;
  totalFees: string;
  dividends: string;
  realizedGain: string;
  assets: Asset[];
  quotes: {
    assetId: string;
    quote: {
      kind?: "QUOTE";
      price: string;
      marketAt: string | null;
      fetchedAt: string;
      stale: boolean;
      delayed: boolean;
      provider?: string;
      delayMinutes?: number | null;
      marketState?: string | null;
    } | null;
    error: string | null;
  }[];
  positions: {
    assetId: string;
    quantity: string;
    costBasis: string;
    averageCost: string;
    totalInvested: string;
    currentPrice: string | null;
    marketValue: string | null;
    unrealizedGain: string | null;
    realizedGain: string;
    returnPercent: string | null;
    fees: string;
    dividends: string;
  }[];
}
