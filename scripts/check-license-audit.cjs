const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const lockPath = path.join(root, "package-lock.json");
const forbiddenLicensePattern = /\b(AGPL|GPL|LGPL|SSPL|BUSL|BSL)\b/i;
const allowedMissingLicensePackages = new Set([
  "@hia-doc/vuedoc-spec",
  "@hia-doc/vue-sfc-bridge",
  "@hia-doc/vue-sfc-doc-source-map",
  "@hia-doc/vue-sfc-extractor"
]);

function main() {
  assert.ok(fs.existsSync(lockPath), "package-lock.json is required for license audit.");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const packages = lock.packages ?? {};
  const compilerSfc = readPackageJson("node_modules/@vue/compiler-sfc/package.json");
  assert.equal(compilerSfc.license, "MIT", "@vue/compiler-sfc must stay MIT licensed.");

  for (const name of Object.keys(packages)) {
    if (!name.startsWith("node_modules/")) {
      continue;
    }
    const packageJson = readPackageJson(path.join(name, "package.json"));
    const license = packageJson.license;
    if (!license && !allowedMissingLicensePackages.has(packageJson.name)) {
      throw new Error(`Missing license metadata for ${name}`);
    }
    if (typeof license === "string") {
      assert.equal(forbiddenLicensePattern.test(license), false, `Forbidden license detected for ${name}: ${license}`);
    }
  }

  console.log("VueDoc dependency license audit passed.");
}

main();

function readPackageJson(relativePath) {
  const filePath = path.join(root, relativePath);
  assert.ok(fs.existsSync(filePath), `Missing package metadata: ${relativePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
