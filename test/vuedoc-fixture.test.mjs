import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractVueSfc, compileVueSfc } from "../packages/vue-sfc-extractor/src/index.mjs";
import { vueDocToCssExtraction, vueDocToHiaDocument, vueDocToHtmlExtraction } from "../packages/vue-sfc-bridge/src/index.mjs";
import { createVueSfcDocSourceMap } from "../packages/vue-sfc-doc-source-map/src/index.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = "fixtures/doc-source-map/vue-sfc/src/components/ProfileCard.vue";

describe("Vue SFC bridge", () => {
  it("extracts VueDoc annotations from template, script setup and style blocks", async () => {
    const sourceText = await fs.readFile(path.join(repositoryRoot, fixturePath), "utf8");
    const artifact = extractVueSfc(sourceText, { path: fixturePath });

    assert.equal(artifact.contract, "hia-vuedoc-extraction");
    assert.equal(artifact.blocks.length, 3);
    assert.ok(artifact.symbols.some((symbol) => symbol.kind === "vue-component" && symbol.name === "ProfileCard"));
    assert.ok(artifact.symbols.some((symbol) => symbol.kind === "html-slot" && symbol.name === "actions"));
    assert.ok(artifact.symbols.some((symbol) => symbol.kind === "css-custom-property" && symbol.name === "--profile-card-accent"));
    assert.ok(artifact.symbols.some((symbol) => symbol.kind === "vue-exposed-api" && symbol.name === "formatUserLabel"));
  });

  it("uses the official Vue compiler to produce template and style source maps", async () => {
    const sourceText = await fs.readFile(path.join(repositoryRoot, fixturePath), "utf8");
    const compiled = compileVueSfc(sourceText, { path: fixturePath, id: "profile-card" });

    const template = compiled.outputs.find((output) => output.kind === "template-render");
    const style = compiled.outputs.find((output) => output.kind === "style");
    assert.ok(template?.content.includes("render"));
    assert.ok(template?.map);
    assert.ok(style?.content.includes(".profile-card"));
    assert.ok(style?.map);
  });

  it("bridges VueDoc extraction to HTMDoc, CSSDoc, HIA document and doc-source-map artifacts", async () => {
    const sourceText = await fs.readFile(path.join(repositoryRoot, fixturePath), "utf8");
    const artifact = extractVueSfc(sourceText, { path: fixturePath });
    const htmDoc = vueDocToHtmlExtraction(artifact, { docSourceMapPath: "ProfileCard.docmap.json" });
    const cssDoc = vueDocToCssExtraction(artifact, { docSourceMapPath: "ProfileCard.docmap.json" });
    const hia = vueDocToHiaDocument(artifact, { docSourceMapPath: "ProfileCard.docmap.json" });
    const docMap = createVueSfcDocSourceMap({
      vueArtifact: artifact,
      vueDocPath: "ProfileCard.vuedoc.json",
      htmDocPath: "ProfileCard.htmdoc.json",
      cssDocPath: "ProfileCard.cssdoc.json",
      hiaDocumentPath: "ProfileCard.hia.json",
      templatePath: "ProfileCard.template.js",
      templateMapPath: "ProfileCard.template.js.map",
      stylePath: "ProfileCard.style.css",
      styleMapPath: "ProfileCard.style.css.map"
    });

    assert.equal(htmDoc.contract, "hia-htmdoc-extraction");
    assert.equal(cssDoc.contract, "hia-cssdoc-extraction");
    assert.equal(hia.schemaVersion, "0.2.0");
    assert.equal(docMap.contract, "doc-source-map");
    assert.ok(docMap.sourceMaps.length >= 2);
  });
});
