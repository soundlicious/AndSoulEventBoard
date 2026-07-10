# Security Notes

Before publishing this repository (even as private), keep these rules:

- Do not commit `.env` or any environment file containing real secrets.
- Rotate `INTERNAL_API_TOKEN` and any `LLM_API_KEY` before first remote push.
- Keep WhatsApp auth/session directories out of git (`/app/auth`, local auth folders).
- Do not commit media uploads or local DB files.

## Pre-push Checklist

1. Verify `.env` is not tracked.
2. Verify no private keys/certs are tracked (`*.pem`, `*.key`, `*.p12`, `*.crt`).
3. Verify only `.env.example` contains placeholders.
4. Regenerate tokens for deployment environment after clone.
