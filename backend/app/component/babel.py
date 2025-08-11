from fastapi_babel import BabelConfigs, Babel
from pathlib import Path

babel_configs = BabelConfigs(
    ROOT_DIR=Path(__file__).parent.parent,
    BABEL_DEFAULT_LOCALE="en_US",
    BABEL_TRANSLATION_DIRECTORY="lang",
)

babel = Babel(configs=babel_configs)
