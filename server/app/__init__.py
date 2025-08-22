from fastapi import FastAPI
from fastapi_pagination import add_pagination

api = FastAPI(swagger_ui_parameters={"persistAuthorization": True})
add_pagination(api)
