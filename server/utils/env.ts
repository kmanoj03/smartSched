import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const ENV_CANDIDATES = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "server/.env"),
  resolve(__dirname, ".env"),
  resolve(__dirname, "../.env")
];

export const loadEnv = (): void => {
  const envPath = ENV_CANDIDATES.find((candidate) => existsSync(candidate));

  if (envPath) {
    dotenv.config({ path: envPath });
    return;
  }

  dotenv.config();
};
