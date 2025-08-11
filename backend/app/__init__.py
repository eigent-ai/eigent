from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


api = FastAPI()
api.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)
