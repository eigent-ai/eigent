from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import traceroot
from traceroot.integrations.fastapi import connect_fastapi


# Initialize FastAPI with title
api = FastAPI(title="Eigent Multi-Agent System API")

# Connect traceroot to FastAPI for automatic request tracking
connect_fastapi(api)

# Add CORS middleware
api.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

# Create traceroot logger for the API
api_logger = traceroot.get_logger('api')
