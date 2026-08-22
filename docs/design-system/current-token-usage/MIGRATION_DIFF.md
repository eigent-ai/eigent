# Current token migration diff

Generated from `design-system-enhancement` at `9c9208beb34f` on 2026-08-22T12:55:25.721Z.

This report is generated evidence, not an automatic codemod. High-confidence
mappings may be migrated mechanically after focused visual tests exist. Manual
mappings require component-intent review.

## Summary

| Measure | Count |
| --- | ---: |
| Production source files scanned | 567 |
| CSS variable references | 186 |
| Unique CSS variables | 77 |
| Existing semantic utility references | 3067 |
| Arbitrary geometry references | 296 |
| Manual token references | 54 |
| Removed Tailwind 4 utility references | 0 |

## CSS token migration queue

| Current token | References | Files | Proposed destination | Confidence | Action |
| --- | ---: | ---: | --- | --- | --- |
| `--fontSize-sm` | 6 | 2 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--lineHeight-14` | 6 | 3 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-black-30` | 4 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-primary-4` | 4 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--scrollbar-thumb` | 4 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--scrollbar-size` | 2 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--shadow-soft` | 2 | 2 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--sidebar-width-icon` | 2 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--borderRadius-lg` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-amber-300` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-black-10` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-black-100` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-blue-300` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-emerald-300` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-fuchsia-300` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-indigo-300` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-neon-default` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-orange-300` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-red-300` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-white-10` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--colors-yellow-300` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--gap` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--initial-height` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--lift` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--offset` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--radix-dropdown-menu-content-available-height` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--radix-popover-trigger-width` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--radix-select-trigger-height` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--radix-select-trigger-width` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--review-code-font` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--sweep-duration` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |
| `--word-gradient` | 1 | 1 | Manual semantic-role review | manual | Resolve intent at each call site |

## Tailwind 4 removed-utility queue

| Current class | Replacement | References | Files |
| --- | --- | ---: | ---: |
| None | — | 0 | 0 |

## Migration rule

Do not replace every legacy alias with the same new token. Resolve the call
site as Accent, Neutral, Ink, Hairline, Feedback, Category, or an approved
pattern exception; then migrate the component recipe and its states together.
