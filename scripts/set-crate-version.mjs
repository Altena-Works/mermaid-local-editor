// Rewrite `version` in the [package] section of src-tauri/Cargo.toml.
//
// tauri.conf.json reads the app version from package.json, which CI derives
// from the tag, but Cargo.toml has no such indirection. This keeps the crate
// version in step. Cargo refreshes Cargo.lock on the next build.
//
//   node scripts/set-crate-version.mjs 1.2.3
//
// Written as a script rather than an inline `run:` step because the release
// matrix includes a Windows runner, where the default shell is PowerShell.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MANIFEST = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "src-tauri",
  "Cargo.toml",
);

const version = (process.argv[2] ?? process.env.VERSION ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/.test(version)) {
  console.error(`set-crate-version: not a semver version: ${version || "(empty)"}`);
  process.exit(1);
}

const before = readFileSync(MANIFEST, "utf8");

// Only the [package] section; dependency versions are inline or bare, but
// scoping the replacement keeps it that way if the manifest grows. The section
// ends at the next table header or at end of input -- `(?![\s\S])` rather than
// `\Z`, which JavaScript reads as a literal Z.
const packageSection = /(^\[package\]\r?\n)([\s\S]*?)(?=^\[|(?![\s\S]))/m;
const match = packageSection.exec(before);
if (!match) {
  console.error(`set-crate-version: no [package] section in ${MANIFEST}`);
  process.exit(1);
}

const body = match[2];
// Test for the line rather than comparing before/after: re-running a release
// for the version already in the manifest is a no-op, not a failure. This is
// why the workflow also passes --allow-same-version to `npm version`.
const versionLine = /^version\s*=\s*".*"$/m;
if (!versionLine.test(body)) {
  console.error(`set-crate-version: no version line in [package] of ${MANIFEST}`);
  process.exit(1);
}
const replaced = body.replace(versionLine, `version = "${version}"`);

const after = before.slice(0, match.index) + match[1] + replaced + before.slice(match.index + match[0].length);
writeFileSync(MANIFEST, after);
console.log(`set-crate-version: ${MANIFEST} -> ${version}`);
