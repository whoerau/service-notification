# AGENTS.md

## Implementation Notes

Use implementation notes only for software or programming projects, and only when
the work creates meaningful implementation reasoning to preserve. Typical
qualifying work includes complex feature implementation, debugging, refactoring,
architecture changes, integration work, API or data-model changes, and other
non-trivial code or configuration changes.

Do not create or update implementation notes for non-programming tasks,
including general Q&A, research, writing, translation, summaries, browsing,
simple terminal requests, image/document/presentation/spreadsheet work unrelated
to software implementation, or global Codex/AGENTS configuration edits. For
these tasks, do not create a `note/` folder or `implementation-notes.md` unless
the user explicitly asks for that artifact.

When implementation notes apply, keep a running notes file for the current
programming project.

The notes file must be created at:

```text
<PROJECT_ROOT>/note/implementation-notes.md
```

`<PROJECT_ROOT>` means the root directory of the programming project being
implemented, preferably the Git repository root. It does not mean the location of
the global `AGENTS.md`, the Codex config directory, the user's home directory,
or a temporary/projectless workspace unless that directory is the actual software
project root. If there is no clear programming project root, skip implementation
notes.

Create the `note/` folder if it does not already exist.

Write `note/implementation-notes.md` in Chinese by default, unless the user
explicitly requests another language or the project convention clearly requires
another language.

Inside the notes file, organize entries by date. Use a date heading such as
`## YYYY-MM-DD`. If there are multiple distinct notes under the same date, split
them with lower-level time headings such as `### HH:mm - Topic`, using the
user's local time when known.

Update `note/implementation-notes.md` as you work, not only at the end, but only
when there is meaningful design or problem-solving context to preserve.

The purpose of this file is to document the high-level reasoning path behind
complex design decisions and complex problem solving. It should help a future
maintainer understand what problem was encountered, what approaches were
considered or tried, what happened, why the final decision was chosen, and what
tradeoffs or risks remain.

For each note, prefer this shape:

- problem or design question
- relevant context or constraint
- approaches considered or attempted
- result of those attempts, including what failed or was rejected
- final decision and rationale
- remaining tradeoffs, risks, limitations, or follow-up work

Do not use this file as a step-by-step activity log, changelog, command log, or
transcript of routine edits. Do not record ordinary file changes, simple
refactors, tests run, formatting changes, obvious implementation steps, or minor
fixes unless they are part of a complex design decision or problem-solving
process.

If an entry would only say what changed, omit it. Only add a note when it
explains why something was done, what was difficult, what was tried, or what
future maintainers should understand.

When implementation notes were created or updated during the task, review
`note/implementation-notes.md` before finishing and make sure it accurately
reflects the final implementation.

## Markdown Documentation Updates

After making code changes, check whether any related Markdown documentation
should be updated.

Update the corresponding `.md` files in the same task when the code change
affects behavior, public APIs, configuration, environment variables, setup
instructions, CLI usage, deployment, architecture, troubleshooting, or
user-facing workflows.

Do not update documentation just for internal-only edits that do not change how
the project is understood, used, configured, or maintained. When documentation
is relevant, keep it concise and consistent with the actual implementation.

## Commit Messages

Use Conventional Commits with a scope unless the repository defines a stricter
convention:

```text
type(scope): subject
```

For breaking changes, use:

```text
type(scope)!: subject
```

Common types:

- `fix`
- `feat`
- `refactor`
- `docs`
- `test`
- `chore`

Use a concise subject that starts lowercase and describes the final change. Keep
the first line under 72 characters when practical. Use an existing module,
package, feature, or service name as the scope. Avoid vague scopes such as
`misc`, `updates`, or `changes`.

Examples:

```text
fix(instagram): wait for iiiLab form hydration
test(instagram): add live iiiLab parser cases
fix(download): remux HLS streams to MP4
refactor(handlers): migrate handlers to Scrapling architecture
docs(readme): refresh project README
feat(api)!: remove legacy response field
```

Avoid unscoped title-case messages such as:

```text
Stabilize Instagram iiiLab parsing
Improve iiiLab timeout diagnostics
```

## CodeGraph Usage

For programming or codebase-related work, use CodeGraph when it is available for
the current repository and the task benefits from graph-aware context. Treat it
as a source of architectural and dependency insight, not as a replacement for
reading the source, checking diffs, or running tests.

Use CodeGraph at the start of non-trivial code work before making implementation
assumptions:

- Start with `codegraph_context` for architecture questions, unfamiliar code,
  feature work, bug investigation, and broad task scoping. It usually provides
  the best first-pass view of entry points, related symbols, and key snippets.
- Use `codegraph_files` when repository layout or language boundaries are
  unclear.
- Use `codegraph_status` only when the index state is uncertain, stale, missing,
  or behaving unexpectedly.

Deepen the graph query according to the question:

- Use `codegraph_search` to find candidate symbols, then `codegraph_node` for one
  symbol's signature, location, callers, callees, and source.
- Use `codegraph_trace` when the task asks how execution flows from one symbol or
  layer to another.
- Use `codegraph_callers` and `codegraph_callees` for focused dependency checks
  around a known symbol.
- Use `codegraph_explore` for several related symbols or files together instead
  of repeatedly opening many individual nodes.

Before non-trivial edits, use graph impact analysis:

- Use `codegraph_impact` before changing shared functions, exported types,
  classes, APIs, route handlers, storage models, framework hooks, or behavior
  that may affect multiple modules.
- Prefer upstream impact checks to learn what depends on the target; use
  downstream checks when changing assumptions about dependencies the target
  calls.
- For renames, moves, extractions, splits, or structural refactors, use graph
  results to identify definitions and references, then verify with text search
  and tests.

After meaningful code changes, rerun the relevant CodeGraph query when it helps
confirm the updated flow or blast radius. Summarize the graph-informed risk
together with local verification such as tests, type checks, linters, or manual
checks.

If CodeGraph is unavailable, unindexed, stale, or too costly to refresh for the
task, continue with normal local tools and mention the fallback briefly. Do not
block the task solely because CodeGraph cannot be used, and do not overuse
CodeGraph for obvious tiny edits where source inspection is sufficient.
