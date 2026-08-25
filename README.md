# Ark Abroad — Competitor Content Intelligence

Tier 1 competitor content collection and classification. Public metrics and
caption text only — no video download, no transcription.

## Setup

1. Create a Python 3.11+ virtualenv and install dependencies:

   ```
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and fill in real values:

   ```
   SUPABASE_URL=            # ark-competitor-intel project only
   SUPABASE_SERVICE_KEY=    # ark-competitor-intel project only
   APIFY_TOKEN=
   ANTHROPIC_API_KEY=
   ```

   **`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` must point at the dedicated
   `ark-competitor-intel` Supabase project — never any other project on the
   account.**

3. Apply the migration. `supabase-py` has no raw-SQL execution method, so run
   it via the Supabase CLI or SQL editor:

   ```
   supabase db execute --file migrations/001_initial_schema.sql
   ```

   (or paste the file contents into the Supabase project's SQL editor).

4. Fill in `config/competitors.yaml` with real accounts (6-8 per market),
   and adjust `config/taxonomy.yaml` if needed.

## Project layout

- `config/competitors.yaml` — accounts to track
- `config/taxonomy.yaml` — classification taxonomy, versioned
- `migrations/` — SQL migrations
- `src/db.py` — Supabase client + typed insert/upsert helpers
- `src/config.py` — loads and validates the two YAML config files

Collection and classification pipeline code is added in later prompts.
