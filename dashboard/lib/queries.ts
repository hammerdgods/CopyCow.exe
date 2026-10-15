import "server-only";
import * as data from "@copycow/shared/dashboard-data";
import { db } from "./db";

// Local mode: compute every feed straight from COWBOT's database file.
export const getSummary = () => data.getSummary(db());
export const getOpenPositions = () => data.getOpenPositions(db());
export const getClosedTrades = () => data.getClosedTrades(db());
export const getPerformance = () => data.getPerformance(db());
export const getLaunches = () => data.getLaunches(db());
export const getAirdrops = () => data.getAirdrops(db());
export const getProof = (limit: number, offset: number) => data.getProof(db(), limit, offset);
export const getLogs = () => data.getLogs(db());
