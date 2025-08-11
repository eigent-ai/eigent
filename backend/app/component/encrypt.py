from passlib.context import CryptContext

password = CryptContext(schemes=["bcrypt"], deprecated="auto")


def password_hash(password_value: str):
    return password.hash(password_value)


def password_verify(password_value: str, password_hash: str):
    return password.verify(password_value, password_hash)
