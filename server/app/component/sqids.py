from sqids import Sqids

sqids = Sqids(min_length=10)


def encode_user_id(user_id: int) -> str:
    return sqids.encode([user_id])


def decode_user_id(user_id: str) -> int:
    return sqids.decode(user_id)
