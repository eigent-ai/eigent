class UserException(Exception):
    def __init__(self, code: int, description: str):
        self.code = code
        self.description = description


class TokenException(Exception):
    def __init__(self, code: int, text: str):
        self.code = code
        self.text = text


class NoPermissionException(Exception):
    def __init__(self, text: str):
        self.text = text


class ProgramException(Exception):
    def __init__(self, text: str):
        self.text = text
