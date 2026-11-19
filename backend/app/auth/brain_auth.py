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

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from fastapi import HTTPException, Request

from app.auth.interface import IAuthProvider, NoneAuth


@dataclass(frozen=True)
class BrainAuthContext:
    user_id: str
    tenant_id: str
    authorization_present: bool
    token_scheme: str | None = None


_auth_provider: IAuthProvider = NoneAuth()


def set_brain_auth_provider(provider: IAuthProvider) -> None:
    global _auth_provider
    _auth_provider = provider


@contextmanager
def with_brain_auth_provider(provider: IAuthProvider) -> Iterator[None]:
    previous = get_brain_auth_provider()
    set_brain_auth_provider(provider)
    try:
        yield
    finally:
        set_brain_auth_provider(previous)


def get_brain_auth_provider() -> IAuthProvider:
    return _auth_provider


async def get_brain_auth_context(request: Request) -> BrainAuthContext:
    """
    Bridge auth dependency for Brain routes.

    Local Brain still uses NoneAuth, but every non-health route now has a
    stable auth hook and request.state.brain_auth for future JWT/API-key
    verification without changing controller call sites again.
    """

    authorization = request.headers.get("authorization")
    token_scheme = None
    if authorization:
        token_scheme = authorization.split(" ", 1)[0].lower()

    provider = get_brain_auth_provider()
    identity = await provider.authenticate(
        {
            "headers": dict(request.headers),
            "state": getattr(request, "state", None),
            "authorization_present": bool(authorization),
        }
    )
    if not identity.get("user_id") and not isinstance(provider, NoneAuth):
        raise HTTPException(
            status_code=401,
            detail={
                "code": "brain_auth_required",
                "message": "Brain authentication did not resolve a user.",
            },
        )
    context = BrainAuthContext(
        user_id=identity.get("user_id") or "local",
        tenant_id=identity.get("tenant_id") or "default",
        authorization_present=bool(authorization),
        token_scheme=token_scheme,
    )
    request.state.brain_auth = context
    return context
