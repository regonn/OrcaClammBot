import candleData from "./candleSticks.json";
import * as tf from "@tensorflow/tfjs-node";
import { Ohlc } from "./999-functions";
import { TRAIN_TICKS_WINDOW, targetToken } from "./000-config";

async function trainModel(
  trainX: number[][],
  trainY: number[]
): Promise<tf.LayersModel> {
  const tensorX = tf.tensor2d(trainX);
  const tensorY = tf.tensor1d(trainY);

  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      inputShape: [tensorX.shape[1]],
      units: 64,
      activation: "relu",
    })
  );
  model.add(tf.layers.dense({ units: 32, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({
    optimizer: tf.train.adam(),
    loss: tf.losses.meanSquaredError,
  });

  await model.fit(tensorX, tensorY, {
    batchSize: 32,
    epochs: 500,
    shuffle: true,
    verbose: 1,
  });

  return model;
}

function preprocessData(candleData: Ohlc[]): {
  trainX: number[][];
  trainY: number[];
} {
  const trainX: number[][] = [];
  const trainY: number[] = [];

  const volatilities = candleData.map(
    (candle) =>
      (Number(candle.high) - Number(candle.low)) /
      Math.pow(10, targetToken.decimals)
  );
  const windowSize = TRAIN_TICKS_WINDOW;

  for (let i = 0; i < candleData.length - windowSize - 1; i++) {
    const window = volatilities.slice(i, i + windowSize);
    const next = volatilities[i + windowSize];
    trainX.push(window);
    trainY.push(next);
  }

  return { trainX, trainY };
}

async function main() {
  const { trainX, trainY } = preprocessData(candleData as Ohlc[]);

  console.log("Training model...");
  const model = await trainModel(trainX, trainY);
  console.log("Model trained.");
  await model.save("file://./model");
}

main();
