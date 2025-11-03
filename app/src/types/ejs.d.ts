declare module "ejs" {
  export type RenderFileOptions = Record<string, unknown>;

  export function renderFile(
    path: string,
    data?: Record<string, unknown>,
    options?: RenderFileOptions
  ): Promise<string>;

  const ejs: {
    renderFile: typeof renderFile;
  };

  export default ejs;
}
