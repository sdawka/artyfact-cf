# @artyfact/cli

`artyfact start|checkpoint|submit|status|compose`. Platform URL from `ARTYFACT_URL` (default http://localhost:5173).

The fork write token is read only from the `ARTYFACT_TOKEN` environment variable (there is no `--token` flag, since
argv is visible to other processes). It is handed to git through `GIT_CONFIG_*` environment variables for the
duration of one command, and is never written to `.artyfact.json`, `TASK_PACKET.md`, `AGENTS.md` or git config.
Set it again for each `start` and `submit`.
