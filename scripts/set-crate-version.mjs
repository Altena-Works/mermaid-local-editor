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
// scoping the replacement keeps it that way if the manifest grows.
const packageSection = /(^\[package\]\r?\n)([\s\S]*?)(?=^\[|\Z)/m;
const match = packageSection.exec(before);
if (!match) {
  console.error(`set-crate-version: no [package] section in ${MANIFEST}`);
  process.exit(1);
}

const body = match[2];
const replaced = body.replace(/^version\s*=\s*".*"$/m, `version = "${version}"`);
if (replaced === body) {
  console.error(`set-crate-version: no version line in [package] of ${MANIFEST}`);
  process.exit(1);
}

const after = before.slice(0, match.index) + match[1] + replaced + before.slice(match.index + match[0].length);
writeFileSync(MANIFEST, after);
console.log(`set-crate-version: ${MANIFEST} -> ${version}`);
