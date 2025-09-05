#!/bin/sh

# wait for database to be ready
echo "Waiting for database to be ready..."
while ! nc -z postgres 5432; do
  sleep 1
done
echo "Database is ready!"

# run database migrations
echo "Running database migrations..."
uv run alembic upgrade head

# start application
echo "Starting application..."
exec uv run uvicorn main:api --host 0.0.0.0 --port 5678