from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import os
import httpx
from pydantic import BaseModel
import base64
import json
from app.component.environment import env


class OAuthAdapter(ABC):
    @abstractmethod
    def get_authorize_url(self, state: Optional[str] = None) -> Optional[str]:
        pass

    @abstractmethod
    def fetch_token(self, code: Optional[str]) -> Optional[Dict[str, Any]]:
        pass


class SlackOAuthAdapter(OAuthAdapter):
    def __init__(self, redirect_uri: Optional[str] = None):
        self.client_id = env("SLACK_CLIENT_ID", "your_client_id")
        self.client_secret = env("SLACK_CLIENT_SECRET", "your_client_secret")
        self.redirect_uri = redirect_uri or env("SLACK_REDIRECT_URI", "https://localhost/api/oauth/slack/callback")
        self.scope = env("SLACK_SCOPE", "chat:write,channels:read,channels:join,groups:read,im:write")

    def get_authorize_url(self, state: Optional[str] = None) -> Optional[str]:
        url = (
            f"https://slack.com/oauth/v2/authorize?client_id={self.client_id}"
            f"&scope={self.scope}"
            f"&redirect_uri={self.redirect_uri}"
        )
        if state:
            url += f"&state={state}"
        return url

    def fetch_token(self, code: Optional[str]) -> Optional[Dict[str, Any]]:
        if not code:
            return None
        token_url = "https://slack.com/api/oauth.v2.access"
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "redirect_uri": self.redirect_uri,
        }
        with httpx.Client() as client:
            resp = client.post(token_url, data=data)
            return resp.json()


class NotionOAuthAdapter(OAuthAdapter):
    def __init__(self, redirect_uri: Optional[str] = None):
        self.client_id = env("NOTION_CLIENT_ID", "your_notion_client_id")
        self.client_secret = env("NOTION_CLIENT_SECRET", "your_notion_client_secret")
        self.redirect_uri = redirect_uri or env("NOTION_REDIRECT_URI", "https://localhost/api/oauth/notion/callback")
        self.scope = env("NOTION_SCOPE", "")  # Notion目前scope可为空

    def get_authorize_url(self, state: Optional[str] = None) -> Optional[str]:
        url = (
            f"https://api.notion.com/v1/oauth/authorize?client_id={self.client_id}"
            f"&owner=user"
            f"&response_type=code"
            f"&redirect_uri={self.redirect_uri}"
        )
        if state:
            url += f"&state={state}"
        return url

    def fetch_token(self, code: Optional[str]) -> Optional[Dict[str, Any]]:
        if not code:
            return None
        token_url = "https://api.notion.com/v1/oauth/token"

        basic_auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        headers = {
            "Authorization": f"Basic {basic_auth}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        data = {"grant_type": "authorization_code", "code": code, "redirect_uri": self.redirect_uri}
        with httpx.Client() as client:
            resp = client.post(token_url, headers=headers, json=data)
            return resp.json()


class XOAuthAdapter(OAuthAdapter):
    def __init__(self, redirect_uri: Optional[str] = None):
        self.client_id = env("X_CLIENT_ID", "your_x_client_id")
        self.client_secret = env("X_CLIENT_SECRET", "your_x_client_secret")
        self.redirect_uri = redirect_uri or env("X_REDIRECT_URI", "https://localhost/api/oauth/x/callback")
        self.scope = env("X_SCOPE", "tweet.read users.read offline.access")

    def get_authorize_url(
        self, state: Optional[str] = None, code_challenge: Optional[str] = None, code_challenge_method: str = "plain"
    ) -> Optional[str]:
        # code_challenge建议由外部生成并传入，PKCE安全
        url = (
            f"https://twitter.com/i/oauth2/authorize?response_type=code"
            f"&client_id={self.client_id}"
            f"&redirect_uri={self.redirect_uri}"
            f"&scope={self.scope.replace(' ', '%20')}"
            f"&state={state or ''}"
        )
        if code_challenge:
            url += f"&code_challenge={code_challenge}&code_challenge_method={code_challenge_method}"
        return url

    def fetch_token(self, code: Optional[str], code_verifier: Optional[str] = None) -> Optional[Dict[str, Any]]:
        if not code:
            return None
        token_url = "https://api.twitter.com/2/oauth2/token"
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
        }
        if code_verifier:
            data["code_verifier"] = code_verifier
        with httpx.Client() as client:
            resp = client.post(token_url, headers=headers, data=data)
            return resp.json()


class GoogleSuiteOAuthAdapter(OAuthAdapter):
    def __init__(self, redirect_uri: Optional[str] = None):
        self.client_id = env("GOOGLE_SUITE_CLIENT_ID", "your_google_suite_client_id")
        self.client_secret = env("GOOGLE_SUITE_CLIENT_SECRET", "your_google_suite_client_secret")
        self.redirect_uri = redirect_uri or env(
            "GOOGLE_SUITE_REDIRECT_URI", "https://localhost/api/oauth/google_suite/callback"
        )
        self.scope = env(
            "GOOGLE_SUITE_SCOPE", "openid email profile https://www.googleapis.com/auth/drive.metadata.readonly"
        )

    def get_authorize_url(self, state: Optional[str] = None) -> Optional[str]:
        url = (
            f"https://accounts.google.com/o/oauth2/v2/auth?"
            f"client_id={self.client_id}"
            f"&redirect_uri={self.redirect_uri}"
            f"&response_type=code"
            f"&scope={self.scope.replace(' ', '%20')}"
            f"&access_type=offline"
            f"&include_granted_scopes=true"
        )
        if state:
            url += f"&state={state}"
        return url

    def fetch_token(self, code: Optional[str]) -> Optional[Dict[str, Any]]:
        if not code:
            return None
        token_url = "https://oauth2.googleapis.com/token"
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        data = {
            "code": code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code",
        }
        with httpx.Client() as client:
            resp = client.post(token_url, headers=headers, data=data)
            return resp.json()


class EXAOAuthAdapter(OAuthAdapter):
    def get_authorize_url(self, state: Optional[str] = None) -> Optional[str]:
        # TODO: 实现EXA search授权URL生成
        return None

    def fetch_token(self, code: Optional[str]) -> Optional[Dict[str, Any]]:
        # TODO: 实现EXA search用code换token
        return None


# 工厂方法
OAUTH_ADAPTERS = {
    "slack": SlackOAuthAdapter,
    "notion": NotionOAuthAdapter,
    "x": XOAuthAdapter,
    "twitter": XOAuthAdapter,
    "googlesuite": GoogleSuiteOAuthAdapter,
}


def get_oauth_adapter(app_name: str, redirect_uri: Optional[str] = None) -> OAuthAdapter:
    adapter_cls = OAUTH_ADAPTERS.get(app_name.lower())
    if not adapter_cls:
        raise ValueError(f"不支持的OAuth应用: {app_name}")
    if app_name.lower() == "slack":
        return adapter_cls(redirect_uri=redirect_uri)
    if app_name.lower() == "notion":
        return adapter_cls(redirect_uri=redirect_uri)
    if app_name.lower() == "x" or app_name.lower() == "twitter":
        return adapter_cls(redirect_uri=redirect_uri)
    return adapter_cls()


class OauthCallbackPayload(BaseModel):
    code: str
    state: Optional[str] = None
