# Use a Python image with uv pre-installed
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# Install the project into `/app`
WORKDIR /app

# Install Git and build dependencies (required for git-based dependencies and Rust packages like tiktoken)
RUN apt-get update -o Acquire::Retries=3 && apt-get install -y --no-install-recommends \
    git \
    curl \
    build-essential \
    gcc \
    python3-dev \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && rm -rf /var/lib/apt/lists/*

# Add Rust to PATH
ENV PATH="/root/.cargo/bin:$PATH"

# Disable bytecode transfer during compilation to avoid EMFILE during build on low nofile limits
ENV UV_COMPILE_BYTECODE=0

# Copy from the cache instead of linking since it's a mounted volume
ENV UV_LINK_MODE=copy

ENV UV_PYTHON_INSTALL_MIRROR=https://registry.npmmirror.com/-/binary/python-build-standalone

ARG database_url
ENV database_url=$database_url

# Copy dependency files first
COPY server/pyproject.toml server/uv.lock ./

# Install the project's dependencies
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-install-project --no-dev

# Then, add the rest of the project source code and install it
# Installing separately from its dependencies allows optimal layer caching
COPY server/ /app

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev

RUN uv run pybabel extract -F babel.cfg -o messages.pot .  && \
    uv run pybabel init -i messages.pot -d lang -l zh_CN  && \
    uv run pybabel compile -d lang -l zh_CN


# Install netcat for database connectivity check
RUN apt-get update -o Acquire::Retries=3 && apt-get install -y --no-install-recommends curl netcat-openbsd && rm -rf /var/lib/apt/lists/*

# Place executables in the environment at the front of the path
ENV PATH="/app/.venv/bin:$PATH"

# Copy and make the start script executable
COPY server/start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

# Make Celery scripts executable
RUN sed -i 's/\r$//' /app/app/celery/worker/start && chmod +x /app/app/celery/worker/start
RUN sed -i 's/\r$//' /app/app/celery/beat/start && chmod +x /app/app/celery/beat/start

# Reset the entrypoint, don't invoke `uv`
ENTRYPOINT []

EXPOSE 5678

# Use the start script
CMD ["/app/start.sh"]
