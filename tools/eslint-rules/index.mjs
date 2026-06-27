// Local ESLint plugin: lint-level enforcement of INV-6 (no em-dashes, no en-dashes)
// across string literals, template strings, and comments. The repo-wide CI grep
// guard (tools/check-no-dashes.mjs) covers Markdown and other non-linted text.

const DASH = /[\u2014\u2013]/u; // U+2014 em dash, U+2013 en dash

/** @type {import('eslint').Rule.RuleModule} */
const noUnicodeDashes = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow the em-dash (U+2014) and en-dash (U+2013) in code, strings, and comments.',
    },
    schema: [],
    messages: {
      found:
        'Em-dash or en-dash is banned (INV-6). Use commas, parentheses, or separate sentences.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (DASH.test(comment.value)) {
            context.report({ loc: comment.loc, messageId: 'found' });
          }
        }
      },
      Literal(node) {
        if (typeof node.value === 'string' && typeof node.raw === 'string' && DASH.test(node.raw)) {
          context.report({ node, messageId: 'found' });
        }
      },
      TemplateElement(node) {
        if (DASH.test(node.value.raw)) {
          context.report({ node, messageId: 'found' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-unicode-dashes': noUnicodeDashes,
  },
};
