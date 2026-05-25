/**
 * migrate-docs.js
 *
 * Reads Monday Doc content from US instance and recreates them in EU,
 * attached to the correct items via their files column.
 *
 * Usage:
 *   node scripts/migrate-docs.js [--dry-run]
 */

import { gql, loadSecret, delay } from "./lib.js";

const secret = loadSecret();
const US_TOKEN = secret.MONDAY_API_TOKEN_US;
const EU_TOKEN = secret.MONDAY_API_TOKEN_EU;

const DRY_RUN = process.argv.includes("--dry-run");

// Docs to migrate: US doc object_id → EU item + column to attach to
const DOCS_TO_MIGRATE = [
  {
    us_doc_object_id: "18254911267",
    us_item_name: "Follow Up Reminder",
    eu_item_id: "2900836564",
    eu_col_id: "file_mm35e8c1",
  },
  {
    us_doc_object_id: "18254910811",
    us_item_name: "Contract to Clients",
    eu_item_id: "2900832412",
    eu_col_id: "file_mm35e8c1",
  },
];

async function fetchDocInfo(token, objectId) {
  // Get internal id + name + blocks from object_id
  const data = await gql(token, `
    query ($ids: [ID!]) {
      docs(object_ids: $ids) {
        id object_id name
        blocks { id type content }
      }
    }
  `, { ids: [objectId] });

  const doc = data.docs?.[0];
  if (!doc) throw new Error(`Doc ${objectId} not found in US`);
  return doc;
}

// Convert Monday doc block delta content to plain markdown
function blocksToMarkdown(blocks) {
  if (!blocks?.length) return "";
  const lines = [];
  for (const block of blocks) {
    try {
      const content = typeof block.content === "string" ? JSON.parse(block.content) : block.content;
      const delta = content?.delta ?? content?.ops ?? [];
      const text = delta
        .map((op) => {
          if (typeof op.insert === "string") return op.insert;
          if (op.insert?.text) return op.insert.text;
          return "";
        })
        .join("")
        .replace(/\n$/, "");
      if (text.trim()) lines.push(text);
    } catch {
      // skip unparseable blocks
    }
  }
  return lines.join("\n\n") || "";
}

async function exportDocMarkdown(token, docId) {
  // Kept for future use — currently falls back to blocksToMarkdown
  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": "2025-01",
    },
    body: JSON.stringify({
      query: `query ($docId: ID!) {
        export_markdown_from_doc(docId: $docId) { success markdown error }
      }`,
      variables: { docId: String(docId) },
    }),
  });
  const data = await response.json();
  if (!response.ok || data.errors) {
    throw new Error(`Export failed: ${JSON.stringify(data.errors ?? data)}`);
  }
  const result = data.data?.export_markdown_from_doc;
  if (!result?.success) throw new Error(`Export not successful: ${result?.error ?? "unknown"}`);
  return result.markdown ?? "";
}

async function createDocInWorkspace(token, workspaceId, name) {
  const data = await gql(token, `
    mutation ($wsId: ID!, $name: String!) {
      create_doc(location: { workspace: { workspace_id: $wsId, name: $name, kind: public } }) {
        id object_id url
      }
    }
  `, { wsId: String(workspaceId), name });

  return data.create_doc;
}

async function addMarkdownToDoc(token, docId, markdown) {
  const data = await gql(token, `
    mutation ($docId: ID!, $markdown: String!) {
      add_content_to_doc_from_markdown(docId: $docId, markdown: $markdown) {
        success block_ids error
      }
    }
  `, { docId: String(docId), markdown });

  const result = data.add_content_to_doc_from_markdown;
  if (!result?.success) throw new Error(`Add content failed: ${result?.error ?? "unknown"}`);
  return result;
}

async function run() {
  const workspaceId = secret.MONDAY_WORKSPACE_ID_EU;
  console.log(`\n=== Monday Doc Migration ${DRY_RUN ? "(DRY RUN)" : "(LIVE)"} ===\n`);
  console.log(`EU workspace: ${workspaceId}`);

  for (const entry of DOCS_TO_MIGRATE) {
    console.log(`\n── "${entry.us_item_name}" (US doc ${entry.us_doc_object_id}) ──`);

    // 1. Fetch doc info from US (need internal id for export)
    console.log(`  Fetching doc from US...`);
    let doc;
    try {
      doc = await fetchDocInfo(US_TOKEN, entry.us_doc_object_id);
    } catch (err) {
      console.error(`  ✗ Failed to fetch: ${err.message}`);
      continue;
    }
    console.log(`  Doc: "${doc.name}" (internal id: ${doc.id})`);
    await delay();

    // 2. Convert blocks to markdown
    let markdown = blocksToMarkdown(doc.blocks);
    if (!markdown.trim()) {
      console.log(`  No content in blocks — will create titled doc`);
      markdown = `# ${entry.us_item_name}`;
    } else {
      console.log(`  Content: ${markdown.length} chars from ${doc.blocks.length} block(s)`);
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] Would create EU doc "${doc.name || entry.us_item_name}" in workspace ${workspaceId}`);
      console.log(`  [dry-run] Markdown preview: ${markdown.slice(0, 120)}...`);
      continue;
    }

    // 3. Create doc in EU workspace
    console.log(`  Creating doc in EU workspace...`);
    let euDoc;
    try {
      euDoc = await createDocInWorkspace(EU_TOKEN, workspaceId, doc.name || entry.us_item_name);
    } catch (err) {
      console.error(`  ✗ Failed to create EU doc: ${err.message}`);
      continue;
    }
    console.log(`  ✓ EU doc created: ${euDoc.url} (id: ${euDoc.id})`);
    await delay();

    // 4. Add content
    if (markdown.trim()) {
      console.log(`  Adding content...`);
      try {
        const result = await addMarkdownToDoc(EU_TOKEN, euDoc.id, markdown);
        console.log(`  ✓ ${result.block_ids?.length ?? 0} blocks added`);
      } catch (err) {
        console.warn(`  ⚠ Add content failed: ${err.message}`);
      }
      await delay();
    }

    console.log(`  → Attach this doc to EU item ${entry.eu_item_id} manually in Monday UI`);
  }

  console.log("\n=== Done ===\n");
}

run().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
