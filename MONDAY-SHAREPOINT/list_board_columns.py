#!/usr/bin/env python3

from monday_to_sharepoint_drytest_onefile import Config, get_board_columns
import sys

if __name__ == "__main__":
    config = Config()
    try:
        config.validate()
    except Exception as e:
        print(f"Config error: {e}")
        sys.exit(1)

    cols = get_board_columns(config.monday_board_id, config.monday_api_token)
    print(f"Board ID: {config.monday_board_id}\nColumns:")
    for c in cols:
        print(f"  - title: '{c['title']}'  id: {c['id']}  type: {c['type']}")
