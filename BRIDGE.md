# OFELIYA project bridge

OFELIYA is a Phaser/Vite static MAX Mini App. The live MAX bot and its token
are deployed separately from the game; client changes must keep the relative
Vite asset base and the safe `MaxBridge` boundary intact.

Use the local DebiForeverProfile conventions from `C:\dev\PROTOCOL.md` and
`C:\dev\CONTEXT.md`. Before modifying gameplay or MAX integration, inspect
impact with CodeGraph. Validate releases with `npm run build` and a browser
smoke at the production subpath, not only at the Vite root.
