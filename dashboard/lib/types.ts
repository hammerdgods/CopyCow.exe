// The shapes live in the shared package so COWBOT can publish exactly the same data.
export type * from "@copycow/shared/dashboard-types";
export type { ProofEntryRow as ProofRow } from "@copycow/shared/dashboard-types";
export type { Tier, WalletKind } from "@copycow/shared/constants";
