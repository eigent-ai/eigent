# Animation improvement plans

| Plan                                          | Title                                       | Severity | Status |
| --------------------------------------------- | ------------------------------------------- | -------- | ------ |
| [001](./001-smooth-current-timeline-event.md) | Smooth and focus the current timeline event | HIGH     | DONE   |

## Recommended execution order

1. Execute plan 001. It combines the related current-state, text hierarchy,
   stable identity, entry/layout motion, and reduced-motion changes in the
   Normal timeline so one implementation does not undermine another.

## Dependencies

- Plan 001 has no external dependency and must remain frontend-only.
