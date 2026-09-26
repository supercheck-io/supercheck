import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Mermaid } from "./components/mdx/mermaid";
import { DiagramEmbed } from "./components/mdx/diagram-embed";
import { APIPage } from "./components/api-page";
import * as icons from "lucide-react";

// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...(icons as unknown as MDXComponents),
    ...defaultMdxComponents,
    Callout,
    Steps,
    Step,
    Tabs,
    Tab,
    Cards,
    Card,
    Accordion,
    Accordions,
    Mermaid,
    DiagramEmbed,
    APIPage,
    ...components,
  };
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
