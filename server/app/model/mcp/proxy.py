from typing import Literal
from pydantic import BaseModel


class ApiKey(BaseModel):
    api_key: str


class ExaSearch(BaseModel):
    query: str
    search_type: Literal["auto", "neural", "keyword"] = "auto"
    category: (
        Literal[
            "company",
            "research paper",
            "news",
            "pdf",
            "github",
            "tweet",
            "personal site",
            "linkedin profile",
            "financial report",
        ]
        | None
    ) = None
    num_results: int = 10
    include_text: list[str] | None = None
    exclude_text: list[str] | None = None
    use_autoprompt: bool | None = True
    text: bool | None = False
