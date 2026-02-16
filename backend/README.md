```bash
uv run uvicorn main:api --port 5001
```

### CORS

CORS is restricted to avoid allowing arbitrary origins. Configure allowed browser origins in `~/.eigent/.env`:

- **`CORS_ORIGINS`** (optional): Comma-separated list of origins, e.g. `http://localhost:5173,http://localhost:3000`. In development, if unset, common localhost origins are allowed; in production, no origins are allowed until you set this.

i18n operation process: https://github.com/Anbarryprojects/fastapi-babel

```bash

pybabel extract -F babel.cfg -o messages.pot . --ignore-pot-creation-date  # Extract multilingual strings from code to messages.pot file
pybabel init -i messages.pot -d lang -l zh_CN   # Generate Chinese language pack, can only be generated initially, subsequent execution will cause overwrite
pybabel compile -d lang -l zh_CN                # Compile language pack


pybabel update -i messages.pot -d lang
# -i messages.pot: Specify the input file as the generated .pot file
# -d translations: Specify the translation directory, which typically contains .po files for each language
# -l zh: Specify the language code
```

```bash
# regular search
\berror\b(?!\])
```
