import { createWriteStream, readFileSync, readdirSync } from "fs";
import { basename } from "path";
import { pipeline } from "stream/promises";
import { ensureDir, gql, loadSecret, writeJson } from "./lib.js";

const ATTACHMENTS_DIR = new URL("../data/attachments/", import.meta.url);
const MANIFEST_PATH = new URL("../data/download-manifest.json", import.meta.url);
const DATA_DIR = new URL("../data/", import.meta.url);

function exportedBoardFiles() {
  return readdirSync(DATA_DIR.pathname)
    .filter((name) => /^board-\d+\.json$/.test(name))
    .map((name) => new URL(`../data/${name}`, import.meta.url));
}

function safeName(name) {
  return String(name ?? "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function downloadFile(entry) {
  if (!entry.asset_id) {
    return { ...entry, status: "skipped", reason: "Unsupported file type without asset ID" };
  }

  const { MONDAY_API_TOKEN_US } = loadSecret();
  const assetData = await gql(
    MONDAY_API_TOKEN_US,
    `query($ids: [ID!]!) {
      assets(ids: $ids) {
        id
        public_url
        url
        name
      }
    }`,
    { ids: [String(entry.asset_id)] },
  );

  const asset = assetData?.assets?.[0];
  const resolvedUrl = asset?.public_url ?? asset?.url ?? entry.url ?? null;

  if (!entry.url) {
    if (!resolvedUrl) {
      return { ...entry, status: "skipped", reason: "Missing URL" };
    }
  }

  const boardDir = new URL(`../data/attachments/${entry.board_id}/`, import.meta.url);
  ensureDir(boardDir.pathname);
  const filename = safeName(entry.name || asset?.name || basename(new URL(resolvedUrl).pathname) || `${entry.asset_id}`);
  const destination = new URL(`../data/attachments/${entry.board_id}/${entry.asset_id ?? "unknown"}-${filename}`, import.meta.url);

  const response = await fetch(resolvedUrl);
  if (!response.ok || !response.body) {
    return { ...entry, status: "error", reason: `HTTP ${response.status}` };
  }

  await pipeline(response.body, createWriteStream(destination.pathname));
  return { ...entry, url: resolvedUrl, status: "downloaded", path: destination.pathname };
}

async function main() {
  const manifest = [];
  ensureDir(ATTACHMENTS_DIR.pathname);
  const boardFiles = exportedBoardFiles();

  if (boardFiles.length === 0) {
    throw new Error("No exported board JSON files found in data/");
  }

  for (const exportPath of boardFiles) {
    const exportData = JSON.parse(readFileSync(exportPath, "utf8"));
    const files = exportData.files ?? [];
    const boardId = exportData.board?.id ?? "unknown";

    console.log(`Downloading ${files.length} attachments for board ${boardId}`);
    for (const file of files) {
      const result = await downloadFile(file);
      manifest.push(result);
      console.log(`${result.status.toUpperCase()}: ${result.name ?? result.asset_id ?? result.item_name}`);
    }
  }

  writeJson(MANIFEST_PATH.pathname, {
    downloaded_at: new Date().toISOString(),
    files: manifest,
  });

  console.log(`Saved manifest to ${MANIFEST_PATH.pathname}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});