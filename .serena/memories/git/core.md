# git server — Core

`servers/git/` = `@abhishekmcp/git` (bin `mcp-git`). Fourth server. Local Git via **isomorphic-git** (pure-JS, no native, NO git binary). ~14 tools. Published 0.1.0. Complements files.

## src/
- `config.ts` — VERSION, getConfiguredRoots (GIT_ROOTS comma/:/;-split), isWritable (GIT_WRITABLE), DEFAULT_LOG_DEPTH(50)/MAX_LOG_DEPTH(1000), MAX_DIFF_BYTES(200KB).
- `sandbox.ts` — mirrors files: setRoots/initRootsFromEnv/getRoots (realpath), `resolveRepo(p)` (validate NUL/control/len + lexical + realpath containment). Refuse no roots.
- `repo.ts` — isomorphic-git wrappers (`import git from "isomorphic-git"`, `import fs from "node:fs"`; use git.TREE/git.WORKDIR props). status (statusMatrix→staged/unstaged/untracked), log(ref/depth/filepath), searchLog, listBranches/listTags/currentBranch, readFileAtRef (resolveRef+readBlob), `computeDiff(dir, treeA, treeB)` via git.walk (skip .git, recurse trees, oid compare → add/modify/remove; patch via diff.createPatch capped MAX_DIFF_BYTES; cap 500 files), diff (HEAD..WORKDIR default / refA..WORKDIR / refA..refB), showCommit (toOid=resolveRef→expandOid; root commit lists all files as add). Writes: stage(add), unstage(resetIndex), commit(author from args or git config; helpful error if none), createBranch(branch), checkout.
- `index.ts` — ~14 tools; reads always; writes behind isWritable(); startup refuses no GIT_ROOTS (exit 1).

## Env
GIT_ROOTS (required, comma-sep), GIT_WRITABLE (1|true enables writes).

## Key facts / gotchas
- isomorphic-git: NO git.diff (hand-rolled via walk+diff lib), NO git.blame (omitted). log DOES support filepath filter natively. readCommit needs full oid → toOid() expands short oid/ref.
- Remote ops (clone/fetch/push) deferred — need http client + onAuth credentials (v2).
- Tests: test/git.test.mjs builds a real repo with isomorphic-git in setup (init/add/commit/branch), drives server over stdio; covers status/log/diff/show/read_file_at/branches/search/file_history + GIT_WRITABLE gating (stage→commit→log grows) + security (out-of-root rejected, no-roots exit 1). CI-safe (no system git). 3 test() blocks.
- First publish: new scoped pkg → manual `npm publish` bootstrap, then optionally configure trusted publishing (npmjs.com → @abhishekmcp/git → Trusted Publisher → publish.yml).
