# Git (backend)

Отдельный репозиторий только для `backend/`.

## Быстрые команды

```powershell
.\git.ps1 status
.\git.ps1 add .
.\git.ps1 commit -m "описание изменений"
.\git.ps1 restore path/to/file
.\git.ps1 restore .
.\git.ps1 log --oneline -10
```

`git.ps1` подставляет локальный `.gitconfig.local` (обход `safe.directory` на Windows без правки глобального git config).

Имя автора коммитов задаётся в `.gitconfig.local` — при желании замените `user.name` / `user.email`.

## Remote

Сейчас: `origin` → `https://github.com/AI-psycho-bot/nest-server.git` (ветка `main`).

Файлы `.env` и временные `tmp_*` в `.gitignore` — не коммитятся.
