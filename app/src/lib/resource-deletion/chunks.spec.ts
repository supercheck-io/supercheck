import { chunk, selectInChunks, DB_CHUNK } from "./chunks";

it("splits values into bounded chunks", () => {
  const sizes = chunk(Array.from({ length: DB_CHUNK * 2 + 1 }, (_, i) => i)).map(part => part.length);
  expect(sizes).toEqual([DB_CHUNK, DB_CHUNK, 1]);
  expect(chunk([])).toEqual([]);
});

it("queries each chunk once and merges rows by id", async () => {
  const query = jest.fn(async (values: string[]) => values.map(id => ({ id: id.slice(0, 1) })));
  const rows = await selectInChunks(Array.from({ length: DB_CHUNK + 1 }, () => "a"), query);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls.every(([values]) => values.length <= DB_CHUNK)).toBe(true);
  expect(rows).toEqual([{ id: "a" }]);
});
