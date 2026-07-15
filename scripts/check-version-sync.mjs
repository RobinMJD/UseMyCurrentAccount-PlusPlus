import { readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const pkg = readJson("package.json");
const manifest = readJson("public/manifest.json");
const readme = readFileSync("README.md", "utf8");
const manifestTest = readFileSync("tests/manifest.test.ts", "utf8");
const expected = pkg.version;

const values = {
  manifest: manifest.version,
  "README current version": readme.match(/Current version:\s*\*\*v([^*]+)\*\*/)?.[1],
  "manifest test": manifestTest.match(/manifest\.version\)\.toBe\("([^"]+)"\)/)?.[1]
};

const mismatches = Object.entries(values).filter(([, value]) => value !== expected);
if (mismatches.length) {
  throw new Error(
    `Version mismatch; package=${expected}; ${mismatches.map(([name, value]) => `${name}=${value || "missing"}`).join(", ")}`
  );
}

const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith("v") && tag.slice(1) !== expected) {
  throw new Error(`Tag/version mismatch: tag=${tag.slice(1)}, package=${expected}`);
}

console.log(`UseMyCurrentAccount++ version ${expected} is synchronized.`);
