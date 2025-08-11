from app import api
from app.component.babel import babel_configs
from fastapi_babel import BabelMiddleware


api.add_middleware(BabelMiddleware, babel_configs=babel_configs)
