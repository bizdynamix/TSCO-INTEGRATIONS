import { mkdirSync, readFileSync, writeFileSync } from "fs";

const SECRET_PATH = new URL("../monday-secret.json", import.meta.url);
const API_URL = "https://api.monday.com/v2";
const API_VERSION = "2024-01";
const RATE_LIMIT_DELAY_MS = 450;

export function loadSecret() {
  return JSON.parse(readFileSync(SECRET_PATH, "utf8"));
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function delay(ms = RATE_LIMIT_DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export async function gql(token, query, variables = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();
  if (!response.ok || data.errors) {
    throw new Error(`Monday GQL error: ${JSON.stringify(data.errors ?? data)}`);
  }
  return data.data;
}

export function boardIdsFromConfig(config, override) {
  if (override) {
    return String(override)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return (config.MONDAY_BOARD_IDS ?? []).map((value) => String(value));
}