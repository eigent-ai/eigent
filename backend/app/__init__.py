from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from traceroot.integrations.fastapi import connect_fastapi



api = FastAPI()

api.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

connect_fastapi(api)
