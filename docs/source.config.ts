import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from "fumadocs-mdx/config";
import {
  rehypeCodeDefaultOptions,
  remarkSteps,
  remarkMdxMermaid,
} from "fumadocs-core/mdx-plugins";
import { z } from "zod";

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  docs: {
    schema: frontmatterSchema.extend({
      preview: z.string().optional(),
      index: z.boolean().default(false),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema.extend({
      description: z.string().optional(),
    }),
  },
});

export default defineConfig({
  lastModifiedTime: "git",
  mdxOptions: {
    rehypeCodeOptions: {
      lazy: true,
      langs: ["ts", "js", "jsx", "tsx", "python", "bash", "sql"],
      inline: "tailing-curly-colon",
      themes: {
        light: "catppuccin-latte",
        dark: "catppuccin-mocha",
      },
      transformers: [...(rehypeCodeDefaultOptions.transformers ?? [])],
    },
    remarkCodeTabOptions: {
      parseMdx: true,
    },
    remarkNpmOptions: {
      persist: {
        id: "package-manager",
      },
    },
    remarkPlugins: [remarkSteps, remarkMdxMermaid],
  },
});
