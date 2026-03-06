Update all documentation files to reflect recent code changes.

For each file in this list:
- `index.html`
- `README.md`
- `CLAUDE.md`
- Every file in `docs/` (excluding `docs/historic/`)

Do the following steps:

1. **Find when the file was last updated.** Run `git log -1 --format="%H" -- <file>` to get the commit hash of the last change to that file.

2. **Get relevant changes since that commit.** Run `git log --oneline <last_commit>..HEAD` and `git diff <last_commit>..HEAD -- src/ test/ schemas/` to see what code changed since the doc was last updated. Focus on changes that are relevant to what each specific document covers (e.g., architecture.md cares about structural changes, design.md cares about UX/keybinding changes, build.md cares about build system changes, CLAUDE.md cares about all of the above, etc.).

3. **If there are relevant changes, update the document.** Read the document, identify sections that are now outdated or incomplete given the code changes, and edit them. Be precise — only update what actually changed. Do not rewrite sections that are still accurate. Preserve the existing style and formatting of each document.

4. **If a file has no relevant changes since its last update, skip it.** Say so briefly and move on.

After processing all files, give a brief summary of what was updated and what was skipped.
