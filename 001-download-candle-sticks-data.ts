import {
  RestClient,
  TokenPriceCandlesticks,
  TokenPriceCandlesticksRequest,
  TokenPriceCandlesticksRequestArgs,
} from "@hellomoon/api";
import * as dotenv from "dotenv";
import * as fs from "fs";
import { targetToken } from "./000-config";

dotenv.config();
const client = new RestClient(process.env.HELLO_MOON_API_KEY as string);

async function main() {
  const mint: string = targetToken["mint"].toBase58();

  const args: TokenPriceCandlesticksRequestArgs = {
    mint,
    granularity: ["ONE_HOUR"],
    limit: 500,
  };
  const result = await client.send(new TokenPriceCandlesticksRequest(args));
  const tokenPriceCandleSticks: TokenPriceCandlesticks[] = result["data"];
  fs.writeFileSync(
    "candleSticks.json",
    JSON.stringify(tokenPriceCandleSticks, null, 2)
  );
}

main();
