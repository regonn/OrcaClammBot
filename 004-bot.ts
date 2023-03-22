import {
  getBalance,
  getPrice,
  swapInToken,
  openPosition,
  getPositions,
  closePosition,
  Position,
} from "./999-functions";
import { targetToken, usdc } from "./000-config";
import { predictPriceRange } from "./003-predict-from-api";

export async function bot() {
  let positions: Position[] = await getPositions();
  if (positions.length > 0) {
    for (let position of positions) {
      if (
        position.tokenA === targetToken.mint.toBase58() &&
        position.tokenB === usdc.mint.toBase58()
      ) {
        console.log("close position", position.positionAddress);
        await closePosition(position.positionAddress);
      }
    }
  }
  let price = await getPrice();
  let balance = await getBalance();
  const targetValue = balance.target.mul(price);
  const usdcValue = balance.usdc;
  const diff = targetValue.sub(usdcValue);
  if (diff.lt(balance.usdc.mul(0.01))) {
    console.log("skip swap");
  } else {
    console.log("swap");
    if (diff.gt(0)) {
      await swapInToken(targetToken, diff.div(price).div(2));
    } else {
      await swapInToken(usdc, diff.div(2));
    }
    price = await getPrice();
    balance = await getBalance();
  }
  console.log("predict price range");
  let predictedPriceRange = await predictPriceRange();
  const targetDepositValue = balance.target.mul(0.9); // 全額だと足りない場合があるので9割で流動性提供する
  await openPosition(
    price.minus(predictedPriceRange * 0.5),
    price.add(predictedPriceRange * 0.5),
    targetDepositValue
  );
}
