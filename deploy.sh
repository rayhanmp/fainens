#!/bin/sh
# Cross-platform entry point for the interactive deployment CLI.
exec node scripts/deploy.mjs "$@"