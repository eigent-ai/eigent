from pathlib import Path
from app.component.babel import babel_configs, babel
import re, os
from fastapi_babel.middleware import Babel, LANGUAGES_PATTERN
from pydantic_i18n import JsonLoader, PydanticI18n


def get_language(lang_code: str | None = None):
    """Ported from fastapi_babel.middleware.BabelMiddleware.get_language
    Applies an available language.

    To apply an available language it will be searched in the language folder for an available one
    and will also priotize the one with the highest quality value. The Fallback language will be the
    taken from the BABEL_DEFAULT_LOCALE var.

        Args:
            babel (Babel): Request scoped Babel instance
            lang_code (str): The Value of the Accept-Language Header.

        Returns:
            str: The language that should be used.
    """

    if not lang_code:
        return babel.config.BABEL_DEFAULT_LOCALE

    matches = re.finditer(LANGUAGES_PATTERN, lang_code)
    languages = [
        (f"{m.group(1)}{f'_{m.group(2)}' if m.group(2) else ''}", m.group(3) or "")
        for m in matches
    ]
    languages = sorted(
        languages, key=lambda x: x[1], reverse=True
    )  # sort the priority, no priority comes last
    translation_directory = Path(babel.config.BABEL_TRANSLATION_DIRECTORY)
    translation_files = [i.name for i in translation_directory.iterdir()]
    explicit_priority = None

    for lang, quality in languages:
        if lang in translation_files:
            if (
                not quality
            ):  # languages without quality value having the highest priority 1
                return lang

            elif (
                not explicit_priority
            ):  # set language with explicit priority <= priority 1
                explicit_priority = lang

    # Return language with explicit priority or default value
    return (
        explicit_priority if explicit_priority else babel_configs.BABEL_DEFAULT_LOCALE
    )


loader = JsonLoader(os.path.dirname(__file__) + "/translations")
trans = PydanticI18n(loader)
