# Draft examples

If the user says “Run this every Monday at 09:00 London time,” preserve that exact recurrence:

```automation-draft
{"version":1,"kind":"automation-draft","name":"Weekly research brief","description":"Summarise new research each week.","taskPrompt":"Find research published since the previous run and prepare a cited brief.","schedule":{"text":"Every Monday at 09:00","timezone":"Europe/London"},"requiredInputs":[{"name":"Research sources","description":"Sources to monitor"}],"unresolved":[]}
```

If the user says only “Make this recurring,” leave the schedule open:

```automation-draft
{"version":1,"kind":"automation-draft","name":"Research brief","description":"Prepare a fresh research brief on each run.","taskPrompt":"Find new research since the previous run and prepare a cited brief.","schedule":null,"requiredInputs":[{"name":"Research sources","description":"Sources to monitor"}],"unresolved":["Choose a recurrence, time, and timezone"]}
```
