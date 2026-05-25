/**
 * generate-automation-guide.js
 *
 * Since Monday.com's API does NOT expose automation recipe configurations,
 * this script reads the exported board data and generates a human-readable
 * automation rebuild guide for Mark — listing likely automations per board
 * based on column types, board purpose, and common Monday.com patterns.
 *
 * Usage: node scripts/generate-automation-guide.js
 * Output: reports/automation-rebuild-guide.md
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// The 6 migrated boards (export file → EU board mapping)
const MIGRATION_BOARDS = [
  { exportFile: 'board-18254909897.json', euName: 'Email Template (Files)' },
  { exportFile: 'board-18254909910.json', euName: 'Email Template (Campaigns)' },
  { exportFile: 'board-8398375595.json',  euName: 'Event RSVP Process' },
  { exportFile: 'board-8398375635.json',  euName: 'Event Planning Checklist' },
  { exportFile: 'board-8398375679.json',  euName: 'Event Planning' },
  { exportFile: 'board-8398376038.json',  euName: 'Subitems of Event Planning' },
];

/**
 * For a set of column types and titles, infer likely automation recipes.
 * Returns an array of recipe suggestion objects.
 */
function inferAutomations(boardName, columns, groups) {
  const suggestions = [];
  const colByType = {};
  for (const col of columns) {
    if (col.type === 'name') continue;
    if (!colByType[col.type]) colByType[col.type] = [];
    colByType[col.type].push(col.title);
  }

  const hasStatus   = !!colByType['status'];
  const hasPeople   = !!colByType['people'];
  const hasDate     = !!colByType['date'];
  const hasEmail    = !!colByType['email'];
  const hasSubtasks = !!colByType['subtasks'];
  const hasNumbers  = !!colByType['numbers'];

  // Status + People → notify on status change
  if (hasStatus && hasPeople) {
    const statuses = colByType['status'];
    const people   = colByType['people'];
    suggestions.push({
      trigger: `When "${statuses[0]}" changes to [specific label]`,
      action:  `Notify "${people[0]}"`,
      recipe:  'When status changes → notify person',
      priority: 'High',
    });
    if (statuses.length > 1) {
      suggestions.push({
        trigger: `When "${statuses[1]}" changes to [specific label]`,
        action:  `Notify "${people[0]}"`,
        recipe:  'When status changes → notify person',
        priority: 'Medium',
      });
    }
  }

  // Date + People → deadline approaching notification
  if (hasDate && hasPeople) {
    const dates   = colByType['date'];
    const people  = colByType['people'];
    suggestions.push({
      trigger: `When "${dates[0]}" arrives (or X days before)`,
      action:  `Notify "${people[0]}"`,
      recipe:  'When date arrives → notify person',
      priority: 'High',
    });
    suggestions.push({
      trigger: `7 days before "${dates[0]}"`,
      action:  `Notify "${people[0]}"`,
      recipe:  'When date is approaching → notify person',
      priority: 'Medium',
    });
  }

  // Date + Email → send email to registrant
  if (hasDate && hasEmail) {
    suggestions.push({
      trigger: `When "${colByType['date'][0]}" arrives`,
      action:  `Send email to "${colByType['email'][0]}"`,
      recipe:  'When date arrives → send email',
      priority: 'High',
    });
  }

  // Email column → confirmation/notification on create
  if (hasEmail) {
    suggestions.push({
      trigger: 'When item is created',
      action:  `Send confirmation email to "${colByType['email'][0]}"`,
      recipe:  'When item is created → send email (confirmation)',
      priority: 'Medium',
    });
  }

  // Status → move to group
  if (hasStatus && groups.length > 1) {
    suggestions.push({
      trigger: `When "${colByType['status'][0]}" changes to Done/Sent/Complete`,
      action:  `Move item to "${groups[groups.length - 1].title}" group`,
      recipe:  'When status changes → move item to group',
      priority: 'Medium',
    });
  }

  // Numbers (budget) + People → overspend notification
  if (hasNumbers) {
    const nums    = colByType['numbers'];
    const people  = colByType['people'];
    if (nums.length >= 2 && hasPeople) {
      suggestions.push({
        trigger: `When "${nums[0]}" exceeds "${nums[1]}"`,
        action:  `Notify "${people[0]}"`,
        recipe:  'When number exceeds another number → notify person',
        priority: 'Medium',
        note:    'Monday does not natively compare two number columns — may require a formula column workaround',
      });
    }
  }

  // Subtasks → status roll-up
  if (hasSubtasks) {
    suggestions.push({
      trigger: 'When all subitems are marked Done',
      action:  'Change parent item Status to Done',
      recipe:  'When all subitems are done → change parent status',
      priority: 'High',
    });
    suggestions.push({
      trigger: 'When parent item Status changes',
      action:  'Change all subitems Status to match',
      recipe:  'When status changes → change subitem status',
      priority: 'Low',
    });
  }

  // People → assign on creation
  if (hasPeople) {
    suggestions.push({
      trigger: 'When item is created',
      action:  `Assign item to "${colByType['people'][0]}"`,
      recipe:  'When item is created → assign person',
      priority: 'Low',
    });
  }

  return suggestions;
}

function priorityIcon(p) {
  return p === 'High' ? '🔴' : p === 'Medium' ? '🟡' : '⚪';
}

function buildBoardSection(board, euName) {
  const cols = board.columns ?? [];
  const groups = board.groups ?? [];
  const suggestions = inferAutomations(board.name, cols, groups);

  const lines = [];
  lines.push(`## ${board.name}`);
  lines.push('');
  lines.push(`**EU Board name:** ${euName}`);
  lines.push(`**Groups:** ${groups.map(g => `\`${g.title}\``).join(', ')}`);
  lines.push('');
  lines.push('### Column Schema');
  lines.push('');
  lines.push('| Type | Title |');
  lines.push('|------|-------|');
  for (const col of cols) {
    if (col.type !== 'name') {
      lines.push(`| \`${col.type}\` | ${col.title} |`);
    }
  }
  lines.push('');

  if (suggestions.length === 0) {
    lines.push('### Automations');
    lines.push('');
    lines.push('_No automation patterns detected for this board (simple file repository — likely no automations needed)._');
  } else {
    lines.push('### Suggested Automations to Rebuild');
    lines.push('');
    lines.push('> ⚠️ **Mark — please verify these against the US board\'s Automation settings**');
    lines.push('> (Board menu → Automations) before rebuilding in EU.');
    lines.push('');
    lines.push('| Priority | Trigger | Action | Monday Recipe |');
    lines.push('|----------|---------|--------|---------------|');
    for (const s of suggestions) {
      const noteCell = s.note ? ` _(${s.note})_` : '';
      lines.push(`| ${priorityIcon(s.priority)} ${s.priority} | ${s.trigger} | ${s.action}${noteCell} | \`${s.recipe}\` |`);
    }
  }
  lines.push('');
  lines.push('### Steps to Rebuild in EU');
  lines.push('');
  lines.push('1. Open the board in EU workspace 5927902');
  lines.push('2. Click the board name → **Automate** (or Board menu → Automations)');
  lines.push('3. Click **+ Add automation** and search by recipe name above');
  lines.push('4. Configure the trigger column, values, and notification recipients');
  lines.push('5. Test with a dummy item before going live');
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

// Load all board data
const boards = [];
for (const { exportFile, euName } of MIGRATION_BOARDS) {
  const filePath = join(ROOT, 'data', exportFile);
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    // Exported format: { board: {id, name, ...}, groups: [...], columns: [...], items: [...] }
    const board = {
      id:      raw.board?.id,
      name:    raw.board?.name,
      columns: raw.columns ?? [],
      groups:  raw.groups  ?? [],
      items:   raw.items   ?? [],
    };
    boards.push({ board, euName });
  } catch (e) {
    console.warn(`⚠️  Could not read ${exportFile}: ${e.message}`);
  }
}

// Build the document
const lines = [];
lines.push('# Automation Rebuild Guide — Lumen Africa EU Workspace');
lines.push('');
lines.push(`_Generated: ${new Date().toISOString().slice(0,10)}_`);
lines.push('');
lines.push('## Purpose');
lines.push('');
lines.push('Monday.com\'s API **does not expose automation recipe configurations** — there is no');
lines.push('programmatic way to read or copy automations between accounts or datacenters.');
lines.push('');
lines.push('This guide was generated from the **exported board schemas** of the 6 migrated boards.');
lines.push('It lists the most likely automation patterns for each board based on:');
lines.push('- Column types present (status, date, people, email, subtasks, numbers)');
lines.push('- Group structure');
lines.push('- Board purpose and naming');
lines.push('');
lines.push('**⚠️ Important:** These are *inferred* suggestions, not extracted recipes.');
lines.push('Mark must compare these against the live US board automations before rebuilding in EU.');
lines.push('');
lines.push('## How to Check US Automations');
lines.push('');
lines.push('For each board in the US workspace (`seed-company-squad.monday.com`):');
lines.push('1. Open the board');
lines.push('2. Click the board name (top left) → **Automations**');
lines.push('3. Screenshot or note each active automation recipe');
lines.push('4. Compare against the suggestions below');
lines.push('5. Rebuild in the EU board using the same recipe');
lines.push('');
lines.push('## Priority Legend');
lines.push('');
lines.push('| Icon | Priority | Description |');
lines.push('|------|----------|-------------|');
lines.push('| 🔴 | High | Likely active — directly relates to core workflow |');
lines.push('| 🟡 | Medium | Probable — common pattern for this column combination |');
lines.push('| ⚪ | Low | Optional — nice-to-have or speculative |');
lines.push('');
lines.push('---');
lines.push('');

for (const { board, euName } of boards) {
  lines.push(buildBoardSection(board, euName));
}

lines.push('## General Monday.com Automation Reference');
lines.push('');
lines.push('Common recipes used in Lumen Africa\'s boards:');
lines.push('');
lines.push('| Recipe | Monday search term |');
lines.push('|--------|--------------------|');
lines.push('| When status changes → notify person | "When status changes, notify someone" |');
lines.push('| When date arrives → notify person | "When date arrives, notify someone" |');
lines.push('| When date is approaching → notify | "When date is approaching, notify someone" |');
lines.push('| When item is created → notify | "When an item is created, notify someone" |');
lines.push('| When status changes → move item | "When status changes, move item to group" |');
lines.push('| When all subitems done → update parent | "When all subitems are done, change parent status" |');
lines.push('| When date arrives → send email | "When date arrives, send email" |');
lines.push('');
lines.push('## EU Workspace Reference');
lines.push('');
lines.push('- **Workspace ID:** 5927902');
lines.push('- **Account:** Luminafrica NPC (EU datacenter)');
lines.push('- **URL:** `https://luminafrica.monday.com` (or your EU subdomain)');
lines.push('');
lines.push('People column values will remain empty until the SC → EU user mapping is confirmed.');
lines.push('Rebuild automations with placeholders and update recipients once users are in EU.');

const outputPath = join(ROOT, 'reports', 'automation-rebuild-guide.md');
writeFileSync(outputPath, lines.join('\n'), 'utf8');
console.log(`✅ Automation rebuild guide written to: reports/automation-rebuild-guide.md`);
console.log(`   Boards covered: ${boards.length}`);
console.log(`   Total automation suggestions: ${boards.reduce((sum, { board }) => {
  const cols = board.columns ?? [];
  const groups = board.groups ?? [];
  return sum + inferAutomations(board.name, cols, groups).length;
}, 0)}`);
