#!/usr/bin/env python3
"""Find projects on Monday.com board that don't have Language Profile files"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
load_dotenv(Path(__file__).parent / ".env")

sys.path.insert(0, str(Path(__file__).parent))

from bulk_migrate_all import (
    Config,
    resolve_column_ids,
    get_board_items_with_files,
    get_all_items_with_files
)

def main():
    config = Config()
    
    print("Querying Monday.com board...")
    
    # Get column IDs
    column_map = resolve_column_ids(
        config.monday_board_id,
        config.monday_api_token,
        [config.column_title_files, config.column_title_project, config.column_title_mou_end_date]
    )
    
    print(f'\n📋 Resolved Monday columns:')
    for col_title, col_id in column_map.items():
        print(f"   • '{col_title}' → {col_id}")
    
    file_col_id = column_map[config.column_title_files]
    project_col_id = column_map[config.column_title_project]
    mou_col_id = column_map[config.column_title_mou_end_date]
    
    # Get all items from Monday
    items = get_board_items_with_files(
        config.monday_board_id,
        [file_col_id, project_col_id, mou_col_id],
        config.monday_api_token
    )
    
    print(f'\n📊 Board Statistics:')
    print(f'   Total items on board: {len(items)}')
    
    # Get items with files (matching the get_all_items_with_files logic)
    items_with_files = get_all_items_with_files(items, file_col_id, project_col_id, mou_col_id)
    print(f'   Items with valid Language Profile files: {len(items_with_files)}')
    
    # Extract project names with files
    projects_with_files = set(p[1].strip() for p in items_with_files)
    
    # Extract all unique project names (even those without files)
    all_project_names = set()
    for item in items:
        for col_val in item['column_values']:
            if col_val['id'] == project_col_id and col_val['text']:
                all_project_names.add(col_val['text'].strip())
                break
    
    all_project_names = sorted(all_project_names)
    print(f'   Total unique projects: {len(all_project_names)}')
    
    # Find projects without files
    projects_without_files = sorted(set(p for p in all_project_names if p and p not in projects_with_files))
    
    print(f'\n❌ Projects WITHOUT Language Profile files ({len(projects_without_files)}):')
    print('=' * 70)
    
    if projects_without_files:
        for i, project in enumerate(projects_without_files, 1):
            print(f'{i:2d}. {project}')
    else:
        print('(None)')
    
    print(f'\n✅ Projects WITH Language Profile files: {len(projects_with_files)}')
    print(f'❌ Projects WITHOUT Language Profile files: {len(projects_without_files)}')
    print(f'📊 Total: {len(all_project_names)}')

if __name__ == "__main__":
    main()
