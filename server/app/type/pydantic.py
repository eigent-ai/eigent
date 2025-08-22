from typing import Annotated, Literal
from pydantic import HttpUrl
from pydantic.functional_serializers import PlainSerializer

HttpUrlStr = Annotated[HttpUrl | Literal[""], PlainSerializer(str)]
