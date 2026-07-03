<!--
  Thanks for contributing! Keep PRs focused. The PR TITLE must be a valid
  Conventional Commit (e.g. `fix(cache): …`) — it becomes the squash commit.
-->

## Summary

<!-- What does this change and why? Link the issue it closes. -->

Closes #

## Type of change

- [ ] 🐞 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that changes existing behavior)
- [ ] 📖 Documentation only
- [ ] 🧹 Refactor / build / CI / chore

## Checklist

- [ ] The PR title follows [Conventional Commits](https://www.conventionalcommits.org/).
- [ ] Tests added/updated — **evals-first** for any caching/normalization change
      (semantic-equal → same key; semantic-different → **never** collide).
- [ ] `npm run lint && npm run typecheck && npm run build && npm test` all pass.
- [ ] Behavior that depends on the spec cites the relevant **RFC section** in a comment.
- [ ] Docs and `CHANGELOG.md` (Unreleased) updated where user-facing.
- [ ] Public API changes are documented with TSDoc and kept minimal.
- [ ] Commits are signed off (`git commit -s`) per the DCO.

## Caching-safety impact

<!--
  If this touches cache keys, normalization, or storability: describe the
  adversarial cases you added and why a different body can never get another
  body's cached response. Write "n/a" if not applicable.
-->

## Additional notes

<!-- Screenshots, benchmarks, follow-ups, anything reviewers should know. -->
