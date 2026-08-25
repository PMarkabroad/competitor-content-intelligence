"""Loads and validates config/competitors.yaml and config/taxonomy.yaml."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"

VALID_PLATFORMS = {"instagram", "tiktok", "linkedin", "youtube"}
VALID_MARKETS = {"AU", "US", "CA"}

TAXONOMY_LISTS = ("topic_slugs", "hook_types", "formats", "cta_types")


class ConfigError(ValueError):
    """Raised when a config file fails validation."""


@dataclass
class CompetitorAccount:
    handle: str
    platform: str
    market: str
    tier: int | None
    rationale: str | None


@dataclass
class Taxonomy:
    version: str
    topic_slugs: list[str]
    hook_types: list[str]
    formats: list[str]
    cta_types: list[str]


def load_competitors(path: Path | None = None) -> list[CompetitorAccount]:
    path = path or CONFIG_DIR / "competitors.yaml"
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    accounts_raw = raw.get("accounts") or []
    accounts: list[CompetitorAccount] = []
    seen: set[tuple[str, str]] = set()

    for i, entry in enumerate(accounts_raw):
        handle = entry.get("handle")
        platform = entry.get("platform")
        market = entry.get("market")

        if not handle:
            raise ConfigError(f"competitors.yaml entry {i}: missing 'handle'")

        if platform not in VALID_PLATFORMS:
            raise ConfigError(
                f"competitors.yaml entry {i} ({handle}): platform '{platform}' "
                f"is not one of {sorted(VALID_PLATFORMS)}"
            )

        if market not in VALID_MARKETS:
            raise ConfigError(
                f"competitors.yaml entry {i} ({handle}): market '{market}' "
                f"is not one of {sorted(VALID_MARKETS)}"
            )

        key = (handle, platform)
        if key in seen:
            raise ConfigError(
                f"competitors.yaml entry {i}: duplicate handle+platform ({handle}, {platform})"
            )
        seen.add(key)

        accounts.append(
            CompetitorAccount(
                handle=handle,
                platform=platform,
                market=market,
                tier=entry.get("tier"),
                rationale=entry.get("rationale"),
            )
        )

    return accounts


def load_taxonomy(path: Path | None = None) -> Taxonomy:
    path = path or CONFIG_DIR / "taxonomy.yaml"
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    version = raw.get("version")
    if not version:
        raise ConfigError("taxonomy.yaml: missing 'version'")

    values: dict[str, list[str]] = {}
    for list_name in TAXONOMY_LISTS:
        items = raw.get(list_name) or []
        if not items:
            raise ConfigError(f"taxonomy.yaml: '{list_name}' is empty or missing")

        seen: set[str] = set()
        for item in items:
            if item in seen:
                raise ConfigError(
                    f"taxonomy.yaml: duplicate value '{item}' in '{list_name}'"
                )
            seen.add(item)

        values[list_name] = list(items)

    return Taxonomy(
        version=version,
        topic_slugs=values["topic_slugs"],
        hook_types=values["hook_types"],
        formats=values["formats"],
        cta_types=values["cta_types"],
    )
