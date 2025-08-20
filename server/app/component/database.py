from sqlmodel import Session, create_engine
from app.component.environment import env, env_or_fail


engine = create_engine(
    env_or_fail("database_url"),
    echo=True if env("debug") == "on" else False,
    pool_size=36,
)


def session_make():
    return Session(engine)


def session():
    with Session(engine) as session:
        yield session
