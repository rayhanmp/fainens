# PowerShell entry point for the interactive deployment CLI.
node (Join-Path $PSScriptRoot 'scripts/deploy.mjs') @args
exit $LASTEXITCODE