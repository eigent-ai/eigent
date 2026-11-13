# Automation Session title plan

> **Status: proposal.** This plan drops the `Automation:` prefix from the
> Sessions that Automations create, so they read like any other Session in the
> sidebar. Nothing here is implemented yet.

## 1. Problem

Every Session that an Automation creates is named with a fixed prefix:

```text
✓  Automation: Test
✓  Automation: Daily inbox summary
✓  Automation: Weekly report
```

The prefix repeats on every row, pushes the real name out of the truncated
sidebar row, and is translated into a different word per language. The
Automation itself is already shown in the Space's **Automations** list, so the
Session does not need to say it again in its name. People want these Sessions
to look like regular Sessions with a title.

## 2. Where the name comes from

The name is the translation key `triggers.automation-project-name`
(`"Automation: {{name}}"`, 11 locales). It is used in three places:

| Place                                                          | When                                                  | Name today                      |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------- |
| `src/components/Trigger/TriggerDialog.tsx` (create)            | Creating an Automation makes its dedicated Session    | `Automation: <Automation name>` |
| `src/hooks/useTriggerTaskExecutor.ts` `automationProjectName`  | A run arrives and the Automation's Session is missing | `Automation: <Automation name>` |
| `src/hooks/useTriggerTaskExecutor.ts` `loadProjectFromHistory` | A run arrives for a Session only found in history     | `Automation: <last prompt>`     |

The Session name is stored as `Project.name` and syncs like any other Session
name, so whatever we write here is what every device shows.

## 3. Change

1. **New Sessions use the Automation name.** In all three places, pass the
   plain name:
   - create and executor: the Automation name (`formData.name`,
     `task.triggerName`);
   - history load: the Automation name from the trigger record when it is
     known, else the saved Session name from history, else the last prompt.
     This also fixes the third row, which names the Session after the prompt
     instead of the Automation.
2. **Remove the translation key** `triggers.automation-project-name` from all
   locales and run the locale parity check.
3. **Keep the link visible elsewhere, not in the title.** The Session header
   (or Session details) shows where it came from, using the existing
   Automation icon and name, for example "From Automation · Test". This keeps
   the information without repeating it on every sidebar row.

## 4. Existing Sessions

Sessions created before this change keep the old name unless we rename them.

| Option                    | What happens                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Leave them             | Old Sessions keep `Automation: …`; only new ones are plain. The sidebar mixes both styles for a while                                                                                                                |
| **B. Rename linked ones** | **Recommended.** For each Automation whose Session id is known, if the Session name equals the old pattern for that Automation's name in any locale, rename it to the Automation name through the normal rename path |
| C. Hide the prefix in UI  | Strip the prefix at display time. Leaves stored names unchanged, but other clients (Remote Control, history) still show it                                                                                           |

Option B only touches Sessions that are linked to an Automation (the
Automation's `project_id`) and whose name is exactly the generated one, so a
name the person edited is never changed. It runs once per device and is safe
to repeat.

## 5. Open questions

1. When someone renames an Automation, should its Session be renamed too
   (only while the Session still has the generated name)? Recommended: yes.
2. The sidebar row already shows the Automation icon after the title when the
   Session's task came from an Automation run (`SessionNavListRows`,
   `source === 'trigger'`). Keep it? Recommended: yes; it is small, sits after
   the title and does not cost title space. Show it for every Session linked
   to an Automation, not only after a run, so the row is marked from the start.

## 6. Testing

- Unit:
  - `TriggerDialog` create passes the plain Automation name to
    `createProject`.
  - `useTriggerTaskExecutor` creates a missing Session with the Automation
    name, and the history path prefers the Automation name over the prompt.
  - Option B rename: renames an exact generated name, skips an edited name,
    skips Sessions not linked to an Automation, and is idempotent.
- Locale parity check after removing the key.
- Manual, desktop app:
  1. Create an Automation named "Test". The new Session in the sidebar is
     "Test".
  2. Run it now and on schedule; the run lands in the same Session.
  3. With an old `Automation: Test` Session, restart the app; it becomes
     "Test" (option B). A Session renamed by hand keeps its name.
  4. Check another language (de, ja).
- `npm run type-check`, `npm run lint`, `git diff --check`.

## 7. Pull requests

One pull request: naming change, key removal, header line and the one-time
rename.
