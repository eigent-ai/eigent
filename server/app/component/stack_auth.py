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
