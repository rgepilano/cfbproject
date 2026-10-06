from pathlib import Path

import numpy as np
import pandas as pd
import psycopg
from dotenv import load_dotenv
from psycopg import sql

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

ANALYTICS = "analytics"
WRITE_ROLE = "cfb_scoring"


def connect(read_only: bool = True) -> psycopg.Connection:
    # Connection settings come from PG* environment variables loaded from .env
    conn = psycopg.connect()
    conn.read_only = read_only
    return conn


def _use_write_role(cur: psycopg.Cursor) -> None:
    """Write as cfb_scoring when possible so new tables inherit the web role's SELECT grant."""
    cur.execute("SELECT current_user <> %(r)s AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %(r)s) "
                "AND pg_has_role(current_user, %(r)s, 'MEMBER')", {"r": WRITE_ROLE})
    if cur.fetchone()[0]:
        cur.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(WRITE_ROLE)))


def query(sql_text: str, params: dict | None = None) -> pd.DataFrame:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql_text, params)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def table_exists(name: str, schema: str = ANALYTICS) -> bool:
    df = query("SELECT to_regclass(%(t)s) IS NOT NULL AS ok", {"t": f"{schema}.{name}"})
    return bool(df.ok.iloc[0])


def execute(statement, params: dict | None = None) -> None:
    with connect(read_only=False) as conn, conn.cursor() as cur:
        _use_write_role(cur)
        cur.execute(statement, params)


def _pg_type(s: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(s):
        return "boolean"
    if pd.api.types.is_integer_dtype(s):
        return "bigint"
    if pd.api.types.is_float_dtype(s):
        return "double precision"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "timestamptz"
    return "text"


def write_table(df: pd.DataFrame, name: str, indexes: list[list[str]] | None = None,
                schema: str = ANALYTICS) -> None:
    """Replace <schema>.<name> with the contents of df in one transaction."""
    table = sql.Identifier(schema, name)
    cols = sql.SQL(", ").join(
        sql.SQL("{} {}").format(sql.Identifier(c), sql.SQL(_pg_type(df[c]))) for c in df.columns)
    rows = df.astype(object).where(df.notna(), None)
    with connect(read_only=False) as conn, conn.cursor() as cur:
        _use_write_role(cur)
        # Skip CREATE SCHEMA when it exists; the scoring role has no database-level CREATE privilege.
        cur.execute("SELECT to_regnamespace(%s) IS NULL", (schema,))
        if cur.fetchone()[0]:
            cur.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        cur.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(table))
        cur.execute(sql.SQL("CREATE TABLE {} ({})").format(table, cols))
        copy_sql = sql.SQL("COPY {} ({}) FROM STDIN").format(
            table, sql.SQL(", ").join(map(sql.Identifier, df.columns)))
        with cur.copy(copy_sql) as copy:
            for row in rows.itertuples(index=False, name=None):
                copy.write_row([v.item() if isinstance(v, np.generic) else v for v in row])
        for i, idx_cols in enumerate(indexes or []):
            cur.execute(sql.SQL("CREATE INDEX {} ON {} ({})").format(
                sql.Identifier(f"{name}_ix{i}"), table, sql.SQL(", ").join(map(sql.Identifier, idx_cols))))


if __name__ == "__main__":
    import sys

    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 50)
    print(query(sys.argv[1]).to_string())
