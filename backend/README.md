```bash
uv run uvicorn main:api --port 5001
```

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
