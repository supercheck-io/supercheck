import type { Row } from "@tanstack/react-table";
import { columns } from "./columns";
import type { Variable } from "./schema";

const typeColumn = columns.find((column) => "accessorKey" in column && column.accessorKey === "type")!;
const matches = (type: unknown, selected: string[]) =>
  (typeColumn.filterFn as (row: Row<Variable>, id: string, value: string[]) => boolean)(
    { getValue: () => type } as unknown as Row<Variable>,
    "type",
    selected,
  );

describe("variables type filter", () => {
  it("matches known types", () => {
    expect(matches("secret", ["secret"])).toBe(true);
    expect(matches("file", ["variable"])).toBe(false);
  });

  it.each([[undefined], [""], ["legacy"], ["constructor"]])("treats %p as a Variable, like its badge", (type) => {
    expect(matches(type, ["variable"])).toBe(true);
  });
});
