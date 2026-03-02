# Eigent Docs

This directory contains the Mintlify documentation for [Eigent](https://www.eigent.ai). The docs are hosted via Mintlify and configured through `docs.json`.

## Prerequisites

Install the Mintlify CLI globally:

```bash
npm install -g mintlify
```

## Preview locally

Run the dev server from inside the `docs/` directory:

```bash
cd docs
mintlify dev
```

This starts a local server at `http://localhost:3000` with hot reload on file changes.

## File structure

```
docs/
├── docs.json              # Mintlify config: theme, navigation, branding
├── images/                # Logos and favicon
├── get_started/           # Welcome, installation, quick start
├── core/                  # Concepts, workforce, tools, workers, skills
│   └── models/            # Per-model setup guides (BYOK, Gemini, Kimi, etc.)
└── troubleshooting/       # Bug reporting, support
```

## Adding a new page

1. Create a `.md` file in the appropriate section folder (e.g. `core/my-feature.md`).
2. Add a frontmatter title at the top:
   ```md
   ---
   title: "My Feature"
   description: "Short description shown in search and meta."
   ---
   ```
3. Register the page in `docs.json` under `navigation.tabs[0].groups` in the relevant group's `pages` array:
   ```json
   "/core/my-feature"
   ```
   Note: paths omit the `.md` extension and are relative to `docs/`.

## Updating an existing page

Edit the `.md` file directly. Mintlify uses standard Markdown with some extended components (callouts, cards, tabs, etc.) — see the [Mintlify docs](https://mintlify.com/docs) for available components.

## Updating navigation or config

All site-level settings live in `docs.json`:

- **Navigation order** — edit the `pages` arrays inside `navigation.tabs[0].groups`
- **Nested groups** — add an object with `group`, `icon`, and `pages` in place of a plain path string
- **Theme / colors / logo** — edit the top-level fields (`theme`, `colors`, `logo`, `favicon`)
- **Navbar links** — edit `navbar.links` and `navbar.primary`
- **Footer socials** — edit `footer.socials`

## Deployment

Docs are deployed automatically by Mintlify on every push to the connected branch. No manual deploy step is needed — merging to `main` triggers a rebuild.
