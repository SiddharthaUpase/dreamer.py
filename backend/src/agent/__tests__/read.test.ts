import { createTools, isImagePath, getMimeType } from "../tools";
import type { SandboxInstance } from "@blaxel/core";

// ===== Mock sandbox =====
function createMockSandbox() {
  return {
    process: {
      exec: jest.fn(),
      get: jest.fn(),
    },
    fs: {
      readBinary: jest.fn(),
    },
  } as unknown as SandboxInstance & {
    process: { exec: jest.Mock; get: jest.Mock };
    fs: { readBinary: jest.Mock };
  };
}

function getReadTool(sandbox: ReturnType<typeof createMockSandbox>) {
  const tools = createTools(sandbox as unknown as SandboxInstance);
  return tools.find((t) => t.name === "read")!;
}

// ===== Helper function tests =====

describe("isImagePath", () => {
  it("returns true for image extensions", () => {
    expect(isImagePath("/app/photo.png")).toBe(true);
    expect(isImagePath("/app/photo.jpg")).toBe(true);
    expect(isImagePath("/app/photo.jpeg")).toBe(true);
    expect(isImagePath("/app/photo.gif")).toBe(true);
    expect(isImagePath("/app/photo.webp")).toBe(true);
    expect(isImagePath("/app/photo.bmp")).toBe(true);
    expect(isImagePath("/app/photo.tiff")).toBe(true);
  });

  it("returns true regardless of case", () => {
    expect(isImagePath("/app/photo.PNG")).toBe(true);
    expect(isImagePath("/app/photo.JPG")).toBe(true);
  });

  it("returns false for non-image extensions", () => {
    expect(isImagePath("/app/file.ts")).toBe(false);
    expect(isImagePath("/app/file.txt")).toBe(false);
    expect(isImagePath("/app/file.json")).toBe(false);
    expect(isImagePath("/app/file.css")).toBe(false);
  });

  it("returns false for files with no extension", () => {
    expect(isImagePath("/app/Makefile")).toBe(false);
  });
});

describe("getMimeType", () => {
  it("returns correct MIME types", () => {
    expect(getMimeType("/app/photo.png")).toBe("image/png");
    expect(getMimeType("/app/photo.jpg")).toBe("image/jpeg");
    expect(getMimeType("/app/photo.jpeg")).toBe("image/jpeg");
    expect(getMimeType("/app/photo.gif")).toBe("image/gif");
    expect(getMimeType("/app/photo.webp")).toBe("image/webp");
  });

  it("defaults to image/png for unknown extensions", () => {
    expect(getMimeType("/app/file.xyz")).toBe("image/png");
  });
});

// ===== read tool tests =====

describe("read tool", () => {
  let sandbox: ReturnType<typeof createMockSandbox>;
  let read: ReturnType<typeof getReadTool>;

  beforeEach(() => {
    sandbox = createMockSandbox();
    read = getReadTool(sandbox);
  });

  describe("text files", () => {
    it("reads a file with cat -n", async () => {
      sandbox.process.exec.mockResolvedValue({
        exitCode: 0,
        stdout: "     1\timport React from 'react';\n     2\t\n",
        stderr: "",
      });

      const result = await read.invoke({ path: "/app/src/App.tsx" });
      expect(sandbox.process.exec).toHaveBeenCalledWith({
        command: 'cat -n "/app/src/App.tsx"',
        waitForCompletion: true,
      });
      expect(result).toContain("import React");
    });

    it("reads with offset using tail", async () => {
      sandbox.process.exec.mockResolvedValue({ exitCode: 0, stdout: "    10\tline ten\n", stderr: "" });
      await read.invoke({ path: "/app/file.ts", offset: 10 });
      expect(sandbox.process.exec).toHaveBeenCalledWith({
        command: 'cat -n "/app/file.ts" | tail -n +10',
        waitForCompletion: true,
      });
    });

    it("reads with limit using head", async () => {
      sandbox.process.exec.mockResolvedValue({ exitCode: 0, stdout: "     1\tfirst\n", stderr: "" });
      await read.invoke({ path: "/app/file.ts", limit: 20 });
      expect(sandbox.process.exec).toHaveBeenCalledWith({
        command: 'cat -n "/app/file.ts" | head -n 20',
        waitForCompletion: true,
      });
    });

    it("reads with offset and limit", async () => {
      sandbox.process.exec.mockResolvedValue({ exitCode: 0, stdout: "     5\tline five\n", stderr: "" });
      await read.invoke({ path: "/app/file.ts", offset: 5, limit: 10 });
      expect(sandbox.process.exec).toHaveBeenCalledWith({
        command: 'cat -n "/app/file.ts" | tail -n +5 | head -n 10',
        waitForCompletion: true,
      });
    });

    it("returns error when file does not exist", async () => {
      sandbox.process.exec.mockResolvedValue({
        exitCode: 1, stdout: "", stderr: "cat: /app/nope.ts: No such file or directory",
      });
      const result = await read.invoke({ path: "/app/nope.ts" });
      expect(result).toContain("Error");
      expect(result).toContain("No such file or directory");
    });
  });

  describe("image files", () => {
    it("returns JSON with __image marker and base64 data", async () => {
      const fakeData = Buffer.from("fake-png-data");
      const fakeBlob = new Blob([fakeData]);
      sandbox.fs.readBinary.mockResolvedValue(fakeBlob);

      const result = await read.invoke({ path: "/app/screenshot.png" });

      expect(typeof result).toBe("string");
      const parsed = JSON.parse(result as string);
      expect(parsed.__image).toBe(true);
      expect(parsed.path).toBe("/app/screenshot.png");
      expect(parsed.mimeType).toBe("image/png");
      expect(parsed.base64).toBe(fakeData.toString("base64"));
      expect(parsed.size).toBe(fakeData.length);
    });

    it("returns correct MIME type for jpg", async () => {
      const fakeData = Buffer.from("fake-jpg-data");
      sandbox.fs.readBinary.mockResolvedValue(new Blob([fakeData]));

      const result = await read.invoke({ path: "/app/photo.jpg" });
      const parsed = JSON.parse(result as string);
      expect(parsed.__image).toBe(true);
      expect(parsed.mimeType).toBe("image/jpeg");
    });

    it("returns error string when readBinary fails", async () => {
      sandbox.fs.readBinary.mockRejectedValue(new Error("File not found"));

      const result = await read.invoke({ path: "/app/missing.png" });
      expect(typeof result).toBe("string");
      expect(result).toContain("Error reading image");
      expect(result).toContain("File not found");
    });

    it("rejects images over 10MB", async () => {
      const largeData = Buffer.alloc(11 * 1024 * 1024); // 11MB
      sandbox.fs.readBinary.mockResolvedValue(new Blob([largeData]));

      const result = await read.invoke({ path: "/app/huge.png" });
      expect(typeof result).toBe("string");
      expect(result).toContain("Too large");
      expect(result).toContain("max 10MB");
    });
  });
});
