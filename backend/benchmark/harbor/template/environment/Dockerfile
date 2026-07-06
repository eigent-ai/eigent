FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-lc"]

# System dependencies
RUN apt-get update && apt-get install -y \
    sudo git curl \
    && rm -rf /var/lib/apt/lists/*

# Set up directories
RUN mkdir -p /tests /logs/verifier /solution /workspace

WORKDIR /workspace
