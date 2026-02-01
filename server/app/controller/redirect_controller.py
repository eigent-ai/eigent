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

import json
from fastapi import APIRouter, Depends, Request
from fastapi_babel import _
from fastapi.responses import HTMLResponse


router = APIRouter(tags=["Redirect"])


@router.get("/redirect/callback")
def redirect_callback(code: str, request: Request):
    cookies = request.cookies
    cookies_json = json.dumps(cookies)

    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authorization successful</title>
        <style>
            body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                padding: 20px 0;
                background-color: #f4f4f9;
                color: #333;
            }}
            .container {{
                padding: 30px;
                background-color: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                max-width: 600px;
                width: 100%;
                text-align: center;
            }}
            h1 {{
                text-align: center;
            }}
            .loading {{
                margin-top: 20px;
                font-size: 16px;
                color: #666;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Authorization Successful</h1>
            <p>Redirecting to application...</p>
            <div class="loading">Please wait...</div>
        </div>
        <script>
            (function() {{
                const allCookies = {cookies_json};
                const baseUrl = "eigent://callback?code={code}";
                let finalUrl = baseUrl;
                
                // 自动跳转到应用
                window.location.href = finalUrl;
            }})();
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)
