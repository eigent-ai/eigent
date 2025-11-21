from sqlmodel import Session, create_engine
from app.component.environment import env, env_or_fail
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("database")

logger.info("Initializing database engine", extra={
    "database_url_prefix": env_or_fail("database_url")[:20] + "...",
    "debug_mode": env("debug") == "on",
    "pool_size": 36
})

engine = create_engine(
    env_or_fail("database_url"),
    echo=True if env("debug") == "on" else False,
    pool_size=36,
)

logger.info("Database engine initialized successfully")


def session_make():
    logger.debug("Creating new database session")
    session = Session(engine)
    logger.debug("Database session created successfully")
    return session


def session():
    logger.debug("Creating database session context")
    with Session(engine) as session:
        logger.debug("Database session context established")
        yield session
        logger.debug("Database session context closed")
