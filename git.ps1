# Wrapper: run git in backend with project-local safe.directory (Windows).
$env:GIT_CONFIG_GLOBAL = Join-Path $PSScriptRoot ".gitconfig.local"
& git -C $PSScriptRoot @args
