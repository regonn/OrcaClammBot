import cron from "node-cron";
import { bot } from "./004-bot";

const task = async () => {
  console.log("Bot Started");
  await bot();
  console.log("Bot Finished");
};

cron.schedule("5 * * * *", task);
