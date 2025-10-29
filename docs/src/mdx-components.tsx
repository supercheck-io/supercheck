import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Tab } from "fumadocs-ui/components/tabs";
import { Tabs } from "fumadocs-ui/components/tabs";
import { Callout } from "fumadocs-ui/components/callout";
import { Step } from "fumadocs-ui/components/steps";
import { Steps } from "fumadocs-ui/components/steps";

import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Callout,
    Steps,
    Step,
    Tabs,
    Tab,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    ...components,
  };
}
