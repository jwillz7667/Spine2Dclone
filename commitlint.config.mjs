// Conventional Commits enforcement (handoff conventions, conformance-and-ci WP-V.10).
// Run by CI on PR titles and commits; one logical change per commit.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'body-max-line-length': [0],
  },
};
