// One-shot release: bump version, commit, tag, push. Pushing the v* tag
// triggers .github/workflows/release.yml, which cross-compiles the standalone
// binaries and attaches them to the GitHub Release.
//
//   bun run release            # patch bump (0.1.3 -> 0.1.4), default
//   bun run release minor      # 0.1.3 -> 0.2.0
//   bun run release major      # 0.1.3 -> 1.0.0
//   bun run release --npm      # also `npm publish` after the push
//
// npm publish needs interactive auth (device link / OTP), so it is OFF by
// default — the script prints the command for you to run instead.

import { $ } from "bun";
import { join } from "node:path";

const pkgRoot = join(import.meta.dir, "..");
const pkgPath = join(pkgRoot, "package.json");

const args = process.argv.slice(2);
const runNpm = args.includes("--npm");
const bump = (args.find((a) => !a.startsWith("--")) ?? "patch") as
  | "major"
  | "minor"
  | "patch";

if (!["major", "minor", "patch"].includes(bump)) {
  console.error(`Unknown bump "${bump}" — use patch | minor | major`);
  process.exit(1);
}

// Refuse to release from a dirty tree or off main: the tag must point at a
// reviewed, pushed commit so the binaries match what's on GitHub.
$.cwd(pkgRoot);
const status = (await $`git status --porcelain`.text()).trim();
if (status) {
  console.error("Working tree is dirty — commit or stash first:\n" + status);
  process.exit(1);
}
const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
if (branch !== "main") {
  console.error(`On branch "${branch}", expected "main".`);
  process.exit(1);
}

const raw = await Bun.file(pkgPath).text();
const current = JSON.parse(raw).version as string;
const [maj, min, pat] = current.split(".").map(Number);
const next =
  bump === "major"
    ? `${maj + 1}.0.0`
    : bump === "minor"
      ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`;
const tag = `v${next}`;

const tags = (await $`git tag`.text()).split("\n");
if (tags.includes(tag)) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

// Replace only the version line so the rest of package.json formatting is
// untouched (JSON.stringify would reorder/reflow it).
const updated = raw.replace(
  /("version":\s*")[^"]+(")/,
  `$1${next}$2`,
);
if (updated === raw) {
  console.error("Could not find version field in package.json.");
  process.exit(1);
}
await Bun.write(pkgPath, updated);

console.log(`Releasing ${current} -> ${next}`);
await $`git add package.json`;
await $`git commit -m ${`Release ${tag}`}`;
await $`git tag ${tag}`;
await $`git push origin main`;
await $`git push origin ${tag}`;

console.log(`\nPushed ${tag}. GitHub Actions is now building the binaries.`);

if (runNpm) {
  await $`npm publish`;
} else {
  console.log("\nTo publish to npm (needs device-link / OTP auth), run:");
  console.log("  npm publish");
}
