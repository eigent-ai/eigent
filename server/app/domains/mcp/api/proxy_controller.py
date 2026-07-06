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

from fastapi import APIRouter, Depends
from exa_py import Exa
from loguru import logger
from app.shared.auth.user_auth import key_must
from app.core.environment import env_not_empty
from app.model.mcp.proxy import ExaSearch
from typing import Any, cast
import requests

from app.model.user.key import Key

router = APIRouter(prefix="/proxy", tags=["Mcp Servers"])


@router.post("/exa")
def exa_search(search: ExaSearch, key: Key = Depends(key_must)):
    EXA_API_KEY = env_not_empty("EXA_API_KEY")
    try:
        exa = Exa(EXA_API_KEY)

        if search.num_results is not None and not 0 < search.num_results <= 100:
            raise ValueError("num_results must be between 1 and 100")

        if search.include_text is not None:
            if len(search.include_text) > 1:
                raise ValueError("include_text can only contain 1 string")
            if len(search.include_text[0].split()) > 5:
                raise ValueError("include_text string cannot be longer than 5 words")

        if search.exclude_text is not None:
            if len(search.exclude_text) > 1:
                raise ValueError("exclude_text can only contain 1 string")
            if len(search.exclude_text[0].split()) > 5:
                raise ValueError("exclude_text string cannot be longer than 5 words")

        if search.text:
            results = cast(
                dict[str, Any],
                exa.search_and_contents(
                    query=search.query,
                    type=search.search_type,
                    category=search.category,
                    num_results=search.num_results,
                    include_text=search.include_text,
                    exclude_text=search.exclude_text,
                    use_autoprompt=search.use_autoprompt,
                    text=True,
                ),
            )
        else:
            results = cast(
                dict[str, Any],
                exa.search(
                    query=search.query,
                    type=search.search_type,
                    category=search.category,
                    num_results=search.num_results,
                    include_text=search.include_text,
                    exclude_text=search.exclude_text,
                    use_autoprompt=search.use_autoprompt,
                ),
            )

        return results

    except Exception as e:
        return {"error": f"Exa search failed: {e!s}"}


@router.get("/google")
def google_search(query: str, search_type: str = "web", key: Key = Depends(key_must)):
    GOOGLE_API_KEY = env_not_empty("GOOGLE_API_KEY")
    SEARCH_ENGINE_ID = env_not_empty("SEARCH_ENGINE_ID")

    start_page_idx = 1
    search_language = "en"
    num_result_pages = 10
    base_url = (
        f"https://www.googleapis.com/customsearch/v1?"
        f"key={GOOGLE_API_KEY}&cx={SEARCH_ENGINE_ID}&q={query}&start="
        f"{start_page_idx}&lr={search_language}&num={num_result_pages}"
    )

    if search_type == "image":
        url = base_url + "&searchType=image"
    else:
        url = base_url

    responses = []
    try:
        result = requests.get(url)
        data = result.json()

        if "items" in data:
            search_items = data.get("items")
            for i, search_item in enumerate(search_items, start=1):
                if search_type == "image":
                    title = search_item.get("title")
                    image_url = search_item.get("link")
                    display_link = search_item.get("displayLink")
                    image_info = search_item.get("image", {})
                    context_url = image_info.get("contextLink", "")
                    width = image_info.get("width")
                    height = image_info.get("height")
                    response = {
                        "result_id": i,
                        "title": title,
                        "image_url": image_url,
                        "display_link": display_link,
                        "context_url": context_url,
                    }
                    if width:
                        response["width"] = int(width)
                    if height:
                        response["height"] = int(height)
                    responses.append(response)
                else:
                    if "pagemap" not in search_item:
                        continue
                    if "metatags" not in search_item["pagemap"]:
                        continue
                    if "og:description" in search_item["pagemap"]["metatags"][0]:
                        long_description = search_item["pagemap"]["metatags"][0]["og:description"]
                    else:
                        long_description = "N/A"
                    title = search_item.get("title")
                    snippet = search_item.get("snippet")
                    link = search_item.get("link")
                    response = {
                        "result_id": i,
                        "title": title,
                        "description": snippet,
                        "long_description": long_description,
                        "url": link,
                    }
                    responses.append(response)
        else:
            error_info = data.get("error", {})
            logger.error(f"Google search failed - API response: {error_info}")
            responses.append({"error": f"Google search failed - API response: {error_info}"})

    except Exception as e:
        responses.append({"error": f"google search failed: {e!s}"})
    return responses
