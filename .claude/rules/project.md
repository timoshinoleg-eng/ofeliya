# OFELIYA release rules

- Keep `MaxBridge` fail-safe when MAX APIs are absent or late.
- Keep Vite assets relative so the game can run at a MAX subpath.
- Run `npm run build` before release and test the deployed production URL.
- Do not place bot tokens or MAX signed data in the client bundle or repository.
