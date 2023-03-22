import { PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

// STABLECOIN
export const usdc = {
  mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  decimals: 6,
};

// ORCA
export const targetToken = {
  mint: new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"),
  decimals: 6,
};

export const tickSpacing = 64;

export const RPC_ENDPOINT_URL =
  process.env.ANCHOR_PROVIDER_URL || "https://api.mainnet-beta.solana.com";
export const COMMITMENT = "confirmed";

export const TRAIN_TICKS_WINDOW = 10;
