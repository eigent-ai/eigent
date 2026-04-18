# Legacy To V2 Token Mapping

This document maps existing CSS variables to the new semantic token model:

`element.tone.emphasis.state`

## Task Lifecycle Mapping

| Legacy Token | New Token | Notes |
| --- | --- | --- |
| `--badge-running-surface` | `bg.status-running.subtle.default` | Running badge/card background |
| `--badge-running-surface-foreground` | `text.status-running.strong.default` | Running text/icon foreground |
| `--badge-splitting-surface` | `bg.status-splitting.subtle.default` | Splitting status |
| `--badge-splitting-surface-foreground` | `text.status-splitting.strong.default` | Splitting text/icon |
| `--badge-paused-surface` | `bg.status-paused.subtle.default` | Pause status |
| `--badge-paused-surface-foreground` | `text.status-paused.strong.default` | Pause text/icon |
| `--badge-error-surface` | `bg.status-error.subtle.default` | Error status |
| `--badge-error-surface-foreground` | `text.status-error.strong.default` | Error text/icon |
| `--badge-complete-surface` | `bg.status-completed.subtle.default` | Completed status |
| `--badge-complete-surface-foreground` | `text.status-completed.strong.default` | Completed text/icon |
| `--task-fill-running` | `bg.status-running.subtle.default` | Task row/card running |
| `--task-fill-success` | `bg.status-completed.subtle.default` | Task row/card completed |
| `--task-fill-warning` | `bg.status-blocked.subtle.default` | Used by blocked/reassigning flows |
| `--task-fill-error` | `bg.status-error.subtle.default` | Task row/card failed |
| `--task-border-focus-success` | `border.status-completed.default.focus` | Focus ring/border for success |
| `--task-border-focus-warning` | `border.status-blocked.default.focus` | Focus ring/border for warning |
| `--task-border-focus-error` | `border.status-error.default.focus` | Focus ring/border for error |

## Generic Semantic Mapping

| Legacy Token | New Token | Notes |
| --- | --- | --- |
| `--surface-success` | `bg.status-completed.subtle.default` | |
| `--surface-information` | `bg.status-splitting.subtle.default` | Info is used for splitting state in chat/task UIs |
| `--surface-warning` | `bg.status-pending.subtle.default` | |
| `--surface-cuation` | `bg.status-error.subtle.default` | Legacy spelling retained; migrate naming |
| `--text-success` | `text.status-completed.strong.default` | |
| `--text-information` | `text.status-splitting.strong.default` | |
| `--text-warning` | `text.status-pending.strong.default` | |
| `--text-cuation` | `text.status-error.strong.default` | |
| `--border-success` | `border.status-completed.default.default` | |
| `--border-information` | `border.status-splitting.default.default` | |
| `--border-warning` | `border.status-pending.default.default` | |
| `--border-cuation` | `border.status-error.default.default` | |
| `--icon-success` | `icon.status-completed.default.default` | |
| `--icon-information` | `icon.status-splitting.default.default` | |
| `--icon-warning` | `icon.status-pending.default.default` | |
| `--icon-cuation` | `icon.status-error.default.default` | |

## Recommended Status Selection

When mapping runtime status to tokens:

- `running` -> `status-running`
- `splitting` -> `status-splitting`
- `pending`/`waiting` -> `status-pending`
- `reassigning` -> `status-reassigning`
- `failed`/`error` -> `status-error`
- `completed` -> `status-completed`
- `blocked` -> `status-blocked`
- `paused` -> `status-paused`
- `skipped` -> `status-skipped`
- `cancelled` -> `status-cancelled`

## Migration Order

1. Introduce `--ds-*` semantic tokens.
2. Add/maintain aliases for legacy tokens.
3. Migrate component aliases to `--ds-*`.
4. Replace legacy token usage in components.
5. Remove legacy aliases after migration completion.
