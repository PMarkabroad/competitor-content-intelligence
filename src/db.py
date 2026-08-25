"""Thin Supabase client wrapper for the ark-competitor-intel project.

SUPABASE_URL / SUPABASE_SERVICE_KEY must point at the ark-competitor-intel
project only. This module never touches any other Supabase project.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (see .env.example). "
            "These must point at the ark-competitor-intel project only."
        )
    return create_client(url, key)


def read_migration(filename: str = "001_initial_schema.sql") -> str:
    """Reads a migration file's SQL. Does not execute it.

    The supabase-py client has no raw-SQL execution method, so migrations
    are applied via the Supabase SQL editor or `psql` / the Supabase CLI,
    not from this codebase. See README.md for the exact command.
    """
    path = MIGRATIONS_DIR / filename
    return path.read_text(encoding="utf-8")


# --- typed insert/upsert helpers -------------------------------------------


def upsert_competitor_account(client: Client, account: dict[str, Any]) -> dict[str, Any]:
    """Upserts on (handle, platform)."""
    res = (
        client.table("competitor_accounts")
        .upsert(account, on_conflict="handle,platform")
        .execute()
    )
    return res.data


def upsert_competitor_post(client: Client, post: dict[str, Any]) -> dict[str, Any]:
    """Upserts on post_url so re-collection runs don't duplicate posts."""
    res = (
        client.table("competitor_posts")
        .upsert(post, on_conflict="post_url")
        .execute()
    )
    return res.data


def upsert_post_classification(client: Client, classification: dict[str, Any]) -> dict[str, Any]:
    """Upserts on (post_id, taxonomy_version)."""
    res = (
        client.table("post_classifications")
        .upsert(classification, on_conflict="post_id,taxonomy_version")
        .execute()
    )
    return res.data


def insert_collection_run(client: Client, run: dict[str, Any]) -> dict[str, Any]:
    res = client.table("collection_runs").insert(run).execute()
    return res.data


def update_collection_run(client: Client, run_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    res = client.table("collection_runs").update(updates).eq("id", run_id).execute()
    return res.data
