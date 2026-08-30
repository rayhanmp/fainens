#!/bin/bash
# Build and push to Docker Hub

set -e

echo "=== Building images ==="

# Build frontend
docker build -t rayha/fainens-frontend:latest ./frontend

# Build backend
docker build -t rayha/fainens-backend:latest ./backend

echo "=== Pushing to Docker Hub ==="

docker push rayha/fainens-frontend:latest
docker push rayha/fainens-backend:latest

echo "=== Done! ==="
echo "On VPS, run: docker compose pull && docker compose up -d"
