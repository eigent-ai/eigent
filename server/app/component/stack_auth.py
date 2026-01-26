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

import asyncio
import httpx
from app.component.environment import env_not_empty
import jwt
from app.exception.exception import UserException
from app.component import code


class StackAuth:
    _signing_key_cache = {}

    @staticmethod
    async def user_id(token: str):
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        if not kid:
            raise jwt.InvalidTokenError("Token is missing 'kid' in header")

        signed = await StackAuth.stack_signing_key(kid)
        payload = jwt.decode(
            token,
            signed.key,
            algorithms=["ES256"],
            audience=env_not_empty("stack_project_id"),
            # issuer="https://access-token.jwt-signature.stack-auth.com",
        )
        return payload["sub"]

    @staticmethod
    async def user_info(token: str):
        headers = {
            "X-Stack-Access-Type": "server",
            "X-Stack-Project-Id": env_not_empty("stack_project_id"),
            "X-Stack-Secret-Server-Key": env_not_empty("stack_secret_server_key"),
            "X-Stack-Access-Token": token,
        }
        url = "https://api.stack-auth.com/api/v1/users/me"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers)
        return response.json()

    @staticmethod
    async def stack_signing_key(kid: str):
        if kid in StackAuth._signing_key_cache:
            return StackAuth._signing_key_cache[kid]

        jwks_endpoint = (
            f"https://api.stack-auth.com/api/v1/projects/{env_not_empty('stack_project_id')}/.well-known/jwks.json"
        )
        loop = asyncio.get_running_loop()
        jwks_client = jwt.PyJWKClient(jwks_endpoint)

        try:
            signing_key = await loop.run_in_executor(None, jwks_client.get_signing_key, kid)
            StackAuth._signing_key_cache[kid] = signing_key
            return signing_key
        except jwt.exceptions.PyJWKClientError as e:
            raise UserException(code.token_invalid, str(e))
