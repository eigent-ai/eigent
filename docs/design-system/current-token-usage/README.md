# Current Token and CSS Usage

This folder records what the checked-out production source uses today. It is
not a second design-system specification.

Run the scanner from the repository root:

```bash
npm run build:design-system:usage
```

The command scans production `src` files while excluding tests, specs, and
stories. It writes:

- `index.html`: review dashboard with category totals and migration targets.
- `usage-report.json`: machine-readable counts, files, and sample call sites.
- `MIGRATION_DIFF.md`: ordered legacy-to-new-token recommendations.

`CURRENT_STATE.md` and `baseline.html` provide the deeper visual and
architectural audit captured before implementation. Rebuild the scanner report
after every base-branch update and migration phase. A falling legacy count is an
acceptance signal; a new unmapped alias is a regression to classify before the
phase can close.
