# Lumin Africa Migration Plan

## Phase 1: Completed
1. Identified the SC Monday workspace: `LuminAfrica - FG Partner`
2. Exported all 6 boards locally from the SC instance
3. Downloaded file assets where Monday exposed binary asset IDs
4. Generated:
   - board summary
   - automation-surface audit
   - dry-run import plan

## Phase 2: Mark Needs To Get
1. Lumin EU Monday API token
2. Lumin EU workspace ID
3. User mapping from SC users to Lumin EU users for people columns
4. Manual automation review from the SC boards:
   - automations
   - integrations
   - webhooks
   - forms/views if needed

## Phase 3: Pre-Import Prep
1. Confirm the 6 exported boards are the full migration scope
2. Confirm whether Monday Docs should be recreated manually or kept as linked content only
3. Confirm whether item history/comments must be recreated in EU or only current state
4. Review the dry-run import plan and finalize manual column handling

## Phase 4: EU Import Build
1. Fill `MONDAY_API_TOKEN_EU`
2. Fill `MONDAY_WORKSPACE_ID_EU`
3. Extend the current import scaffold from dry-run to live:
   - create boards
   - create groups
   - create columns
   - import items
   - import subitems
   - upload binary files
4. Leave people columns unmapped until user mapping is confirmed
5. Leave Monday Docs for manual recreation unless a better export path is found

## Phase 5: Validation
1. Compare SC vs EU board counts
2. Compare item counts per board
3. Compare subitem counts
4. Compare file counts
5. Spot-check sample items on each board
6. Confirm manual recreations are complete:
   - automations
   - integrations
   - webhooks
   - docs

## Phase 6: Cutover
1. Mark signs off on the EU workspace
2. Lumin tests workflows in EU
3. Rebuild remaining automations manually
4. Freeze or archive SC boards once migration is accepted

## Current Blockers
1. No EU token yet
2. No EU workspace ID yet
3. No user mapping yet
4. Automations cannot be extracted through the current Monday API surface

## Short Version For Mark
We have already extracted the SC-side Lumin workspace and built a dry-run import plan. The next step is to get EU access details, user mapping, and a manual review of the automations so we can complete the import and rebuild in the EU instance.