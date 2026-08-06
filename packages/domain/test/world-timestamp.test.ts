import { describe, expect, it } from "vitest";

import {
  advanceWorldTimestamp,
  createWorldTimestamp,
} from "../src/index.js";

describe("WorldTimestamp", () => {
  it("advances deterministically across day boundaries", () => {
    const start = createWorldTimestamp(1, 23 * 60 + 50);
    const result = advanceWorldTimestamp(start, 20);

    expect(result).toEqual({ day: 2, minuteOfDay: 10 });
  });

  it("rejects invalid minute ranges", () => {
    expect(() => createWorldTimestamp(1, 1440)).toThrow(RangeError);
  });
});
