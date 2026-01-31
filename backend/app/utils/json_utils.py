import json
from typing import Union, List, Dict

def ensure_json_string(content: Union[str, Dict, List]) -> str:
    """
    Ensure the content is a valid JSON string.
    If it's a dict or list, dump it to a JSON string.
    If it's already a string, try to parse it to validate it, then re-dump it to ensure consistent formatting.
    Raises json.JSONDecodeError if validation fails.
    """
    if not isinstance(content, str):
        return json.dumps(content)
    
    # It's a string, validate it
    json_obj = json.loads(content)
    return json.dumps(json_obj)
