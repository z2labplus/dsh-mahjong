import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot;
const libraryDirectory = path.join(repositoryRoot, "lib");
const files = ["index.js", "client.js"];
try {
  files.push(...readdirSync(libraryDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join("lib", entry.name))
    .sort());
} catch (error) {
  process.stderr.write(`Cannot read ${libraryDirectory}: ${error.message}\n`);
  process.exit(1);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(repositoryRoot, file)], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write(`Syntax checked ${files.length} JavaScript files\n`);
