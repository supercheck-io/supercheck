import { formatResponseTime } from "./format-response-time";

it("shows milliseconds below one second and seconds from one second up", () => {
  expect(formatResponseTime(0)).toBe("0 ms");
  expect(formatResponseTime(360)).toBe("360 ms");
  expect(formatResponseTime(999.4)).toBe("999 ms");
  expect(formatResponseTime(1000)).toBe("1.00 s");
  expect(formatResponseTime(1250)).toBe("1.25 s");
});
