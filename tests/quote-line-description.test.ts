import { describe, it, expect } from "vitest";
import { editorDescription } from "../src/crm/routes/customers-quotes.js";

describe("quote line description for the editor", () => {
  it("drops the name line(s) stored in front of the description", () => {
    expect(editorDescription("Baseboard", "Baseboard\nRemove and reinstall")).toBe("Remove and reinstall");
    // Older saves prepended the name again each time.
    expect(editorDescription("Baseboard", "Baseboard\nBaseboard\nBaseboard\nRemove and reinstall")).toBe("Remove and reinstall");
    expect(editorDescription("Baseboard", "Baseboard")).toBe("");
    expect(editorDescription("Baseboard", "Remove and reinstall")).toBe("Remove and reinstall");
    expect(editorDescription("", "Line one\nLine two")).toBe("Line one\nLine two");
    expect(editorDescription("Red Oak", null)).toBe("");
  });
});
