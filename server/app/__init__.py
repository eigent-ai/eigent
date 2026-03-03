# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi_pagination import add_pagination
from fastapi_limiter import FastAPILimiter
from app.component.environment import env_or_fail
from redis import asyncio as aioredis
import logging

logger = logging.getLogger("server_app")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup/shutdown events."""
    # Startup: Initialize rate limiter with Redis
    redis_url = env_or_fail("redis_url")
    redis_connection = aioredis.from_url(redis_url, encoding="utf-8", decode_responses=True)
    await FastAPILimiter.init(redis_connection)
    logger.info("FastAPI Limiter initialized with Redis")
    
    yield
    
    # Shutdown: Close Redis connection
    await FastAPILimiter.close()
    logger.info("FastAPI Limiter closed")

# Add lifespan for ratelimiter setup
api = FastAPI(
  swagger_ui_parameters={"persistAuthorization": True},
  lifespan=lifespan
)
add_pagination(api)
