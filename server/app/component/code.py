success = 0  # success response code
error = 1  # common error response code
not_found = 4  # can't find route or data

password = 10  # account or password error
token_need = 11
token_expired = 12
token_invalid = 13
token_blocked = 14

form_error = 100  # form pydantic validate error

no_permission_error = 300  # admin no permission error
