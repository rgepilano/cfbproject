"""Apply a SQL file with the admin login from .env. Usage: python apply_sql.py ../db/roles.sql"""
import sys
from pathlib import Path

from db import connect

if __name__ == "__main__":
    statements = Path(sys.argv[1]).read_text()
    with connect(read_only=False) as conn:
        conn.execute(statements)
    print(f"Applied {sys.argv[1]}")
