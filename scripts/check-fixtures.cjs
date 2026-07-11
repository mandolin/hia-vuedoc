const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "doc-source-map", "vue-sfc");
const distRoot = path.join(fixtureRoot, "dist");

const expectedFiles = [
  "ProfileCard.template.js",
  "ProfileCard.template.js.map",
  "ProfileCard.script.js",
  "ProfileCard.style.css",
  "ProfileCard.style.css.map",
  "ProfileCard.vuedoc.json",
  "ProfileCard.htmdoc.json",
  "ProfileCard.cssdoc.json",
  "ProfileCard.docmap.json",
  "ProfileCard.hia.json"
];

function main() {
  for (const file of expectedFiles) {
    assert.ok(fs.existsSync(path.join(distRoot, file)), `Missing fixture artifact: ${file}`);
  }

  const vueDoc = readJson("ProfileCard.vuedoc.json");
  assert.equal(vueDoc.contract, "hia-vuedoc-extraction");
  assert.equal(vueDoc.contractVersion, "0.1.0-draft");
  assert.equal(vueDoc.blocks.length, 3);
  assert.ok(vueDoc.symbols.some((symbol) => symbol.kind === "vue-component" && symbol.name === "ProfileCard"));
  assert.ok(vueDoc.symbols.some((symbol) => symbol.kind === "html-slot" && symbol.name === "actions"));
  assert.ok(vueDoc.symbols.some((symbol) => symbol.kind === "css-selector" && symbol.name === ".profile-card"));
  assert.ok(vueDoc.symbols.some((symbol) => symbol.kind === "vue-exposed-api" && symbol.name === "formatUserLabel"));

  const htmDoc = readJson("ProfileCard.htmdoc.json");
  assert.equal(htmDoc.contract, "hia-htmdoc-extraction");
  assert.ok(htmDoc.symbols.some((symbol) => symbol.kind === "html-component" && symbol.name === "ProfileCard"));
  assert.ok(htmDoc.symbols.some((symbol) => symbol.kind === "html-slot" && symbol.name === "actions"));

  const cssDoc = readJson("ProfileCard.cssdoc.json");
  assert.equal(cssDoc.contract, "hia-cssdoc-extraction");
  assert.ok(cssDoc.symbols.some((symbol) => symbol.kind === "css-selector" && symbol.name === ".profile-card"));
  assert.ok(cssDoc.symbols.some((symbol) => symbol.kind === "css-custom-property" && symbol.name === "--profile-card-accent"));

  const docMap = readJson("ProfileCard.docmap.json");
  assert.equal(docMap.contract, "doc-source-map");
  assert.equal(docMap.privacy.sourcesContentPolicy, "none");
  assert.ok(docMap.sourceMaps.some((sourceMap) => sourceMap.path === "ProfileCard.template.js.map"));
  assert.ok(docMap.sourceMaps.some((sourceMap) => sourceMap.path === "ProfileCard.style.css.map"));
  assert.ok(docMap.entries.some((entry) => entry.symbolKind === "vue-component"));
  assert.ok(docMap.entries.some((entry) => entry.artifactRefs[0].artifactId === "artifact:vue-style:compiled"));

  const hia = readJson("ProfileCard.hia.json");
  assert.equal(hia.schemaVersion, "0.2.0");
  assert.ok(hia.symbols.some((symbol) => symbol.kind === "html-component" && symbol.name === "ProfileCard"));
  assert.ok(hia.metadata.docSourceMaps[0].path.endsWith("ProfileCard.docmap.json"));

  expectNoUnsafePaths(vueDoc, docMap, hia);
  expectNoUnexpectedSourcesContent(fixtureRoot);
  expectNoLocalPathLeakage(fixtureRoot);
  console.log("VueDoc fixture check passed.");
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(distRoot, name), "utf8"));
}

function expectNoUnsafePaths(...values) {
  const paths = [];
  for (const value of values) {
    collectPathValues(value, paths);
  }
  for (const value of paths) {
    assert.equal(path.isAbsolute(value), false, `Path must not be absolute: ${value}`);
    assert.equal(value.startsWith("\\\\"), false, `Path must not be UNC: ${value}`);
    assert.equal(value.split(/[\\/]/).includes(".."), false, `Path must not escape workspace: ${value}`);
  }
}

function collectPathValues(value, result) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathValues(item, result);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if ((key === "path" || key.endsWith("Path")) && typeof item === "string") {
      result.push(item);
    } else {
      collectPathValues(item, result);
    }
  }
}

function expectNoUnexpectedSourcesContent(directory) {
  for (const filePath of listFiles(directory)) {
    const content = fs.readFileSync(filePath, "utf8");
    assert.equal(/"sourcesContent"\s*:/.test(content), false, `sourcesContent must not be emitted: ${path.relative(root, filePath)}`);
  }
}

function expectNoLocalPathLeakage(directory) {
  const forbidden = [
    "K:\\Project",
    "Github_mandolin",
    "HIA-Documentation-Sys"
  ];
  for (const filePath of listFiles(directory)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const marker of forbidden) {
      assert.equal(content.includes(marker), false, `Local path leakage in ${path.relative(root, filePath).replaceAll("\\", "/")}: ${marker}`);
    }
  }
}

function listFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(entryPath));
    } else {
      result.push(entryPath);
    }
  }
  return result;
}

main();
