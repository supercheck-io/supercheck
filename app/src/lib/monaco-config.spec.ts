import { loader } from "@monaco-editor/react";
import { dependencies } from "../../package.json";
import { PLAYGROUND_EDITOR_OPTIONS } from "./monaco-config";

jest.mock("@monaco-editor/react", () => ({ loader: { config: jest.fn() } }));

it("loads the installed Monaco runtime and enables hover with its current API", () => {
  expect(loader.config).toHaveBeenCalledWith({
    paths: { vs: `https://cdn.jsdelivr.net/npm/monaco-editor@${dependencies["monaco-editor"]}/min/vs` },
  });
  expect(PLAYGROUND_EDITOR_OPTIONS.hover).toEqual({ enabled: "on" });
});
