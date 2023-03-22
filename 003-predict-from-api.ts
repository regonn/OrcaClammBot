import * as tf from "@tensorflow/tfjs-node";
import { targetToken, TRAIN_TICKS_WINDOW } from "./000-config";
import {
  RestClient,
  TokenPriceCandlesticks,
  TokenPriceCandlesticksRequest,
  TokenPriceCandlesticksRequestArgs,
} from "@hellomoon/api";
import * as dotenv from "dotenv";
dotenv.config();
const client = new RestClient(process.env.HELLO_MOON_API_KEY as string);

function preprocessPredictData(input: TokenPriceCandlesticks[]): number[] {
  return input.map((candle) => {
    return (
      (Number(candle.high) - Number(candle.low)) /
      Math.pow(10, targetToken.decimals)
    );
  });
}

export async function predictPriceRange() {
  const mint: string = targetToken.mint.toBase58();
  const args: TokenPriceCandlesticksRequestArgs = {
    mint,
    granularity: ["ONE_HOUR"],
    limit: TRAIN_TICKS_WINDOW,
  };
  const result = await client.send(new TokenPriceCandlesticksRequest(args));
  const tokenPriceCandleSticks: TokenPriceCandlesticks[] = result["data"];
  const model = await tf.loadLayersModel("file://./model/model.json");
  const predictData = preprocessPredictData(tokenPriceCandleSticks);
  const predictX = tf.tensor2d([predictData]);
  const output = model.predict(predictX) as tf.Tensor;
  const volatility = (await output.array()) as number[][];
  return volatility[0][0];
}
