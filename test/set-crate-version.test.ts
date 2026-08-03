// @vitest-environment node
/**
 * The release workflow runs this script on every tag, so the case that broke
 * v0.6.0 - the manifest already carrying the version being released - has to
 * stay covered.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT_SOURCE = join(REPO, "scripts", "set-crate-version.mjs");

const MANIFEST = `[package]
name = "mermaid-local-editor"
version = "0.6.0"
description = "A local, cross-platform Mermaid diagram editor"
authors = ["4ltena"]
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["devtools"] }
tauri-plugin-dialog = "2"
`;

let workspace: string;

/** A throwaway copy of the repo layout the script expects. */
function setup(manifest = MANIFEST): void {
  workspace = mkdtempSync(join(tmpdir(), "set-crate-version-"));
  mkdirSync(join(workspace, "scripts"));
  mkdirSync(join(workspace, "src-tauri"));
  writeFileSync(
    join(workspace, "scripts", "set-crate-version.mjs"),
    readFileSync(SCRIPT_SOURCE, "utf8"),
  );
  writeFileSync(join(workspace, "src-tauri", "Cargo.toml"), manifest);
}

function run(version: string): { status: number; stderr: string } {
  try {
    execFileSync(
      process.execPath,
      [join(workspace, "scripts", "set-crate-version.mjs"), version],
      { stdio: "pipe", encoding: "utf8" },
    );
    return { status: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? 1, stderr: failure.stderr ?? "" };
  }
}

function manifest(): string {
  return readFileSync(join(workspace, "src-tauri", "Cargo.toml"), "utf8");
}

beforeEach(() => setup());
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe("set-crate-version", () => {
  it("rewrites the [package] version", () => {
    expect(run("1.2.3").status).toBe(0);
    expect(manifest()).toContain('version = "1.2.3"');
  });

  it("succeeds when the manifest already holds that version", () => {
    // The v0.6.0 release failed here: the replacement was a no-op and the
    // script reported it as a missing version line.
    const result = run("0.6.0");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(manifest()).toContain('version = "0.6.0"');
  });

  it("leaves dependency versions alone", () => {
    run("1.2.3");
    expect(manifest()).toContain('tauri = { version = "2", features = ["devtools"] }');
    expect(manifest()).toContain('tauri-plugin-dialog = "2"');
  });

  it("accepts a prerelease or build suffix", () => {
    expect(run("1.2.3-rc.1").status).toBe(0);
    expect(manifest()).toContain('version = "1.2.3-rc.1"');
  });

  it("rejects a value that is not a version", () => {
    for (const bad of ["", "latest", "v1.2.3", "1.2"]) {
      setup();
      const result = run(bad);
      expect(result.status, bad).toBe(1);
      expect(manifest()).toContain('version = "0.6.0"');
    }
  });

  it("fails when [package] has no version line", () => {
    setup('[package]\nname = "x"\nedition = "2021"\n');
    const result = run("1.2.3");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no version line");
  });

  it("fails when there is no [package] section", () => {
    setup('[dependencies]\ntauri = "2"\n');
    const result = run("1.2.3");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no [package] section");
  });
});
