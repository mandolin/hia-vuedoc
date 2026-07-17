import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractVueSfc, compileVueSfc } from "../packages/vue-sfc-extractor/src/index.mjs";
import { vueDocToCssExtraction, vueDocToHiaDocument, vueDocToHtmlExtraction } from "../packages/vue-sfc-bridge/src/index.mjs";
import { createVueSfcDocSourceMap } from "../packages/vue-sfc-doc-source-map/src/index.mjs";
import { vuedocProducer } from "../packages/vuedoc-producer/src/index.mjs";
import {
  loadVueDocRunnerConfig,
  runVueDocRunner,
  VUEDOC_RUNNER_CONFIG_CONTRACT,
  VUEDOC_RUNNER_CONFIG_VERSION
} from "../packages/vuedoc-runner/src/index.mjs";

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
    const exposedApi = artifact.symbols.find((symbol) => symbol.kind === "vue-exposed-api" && symbol.name === "formatUserLabel");
    assert.equal(exposedApi?.metadata.macro, "defineExpose");
    assert.equal(exposedApi?.metadata.localName, "formatUserLabel");
    assert.equal(exposedApi?.source.rangeSource, "vue-compiler-macro");
    assert.equal(artifact.metadata.scriptSetup.defineExpose[0].name, "formatUserLabel");
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

  it("runs the VueDoc producer adapter from a documentation producer request", async () => {
    const outputDirectory = path.join(repositoryRoot, "fixtures", "doc-source-map", "vue-sfc", "producer-out");
    await fs.rm(outputDirectory, { recursive: true, force: true });

    try {
      const result = await vuedocProducer.produce({
        workspaceRoot: repositoryRoot,
        outputDirectory,
        inputs: [
          {
            kind: "vue-sfc",
            path: fixturePath,
            language: "vue"
          }
        ],
        options: {
          emitDocSourceMap: true,
          sourcesContentPolicy: "none",
          writeResultManifest: true
        }
      });

      assert.equal(result.contract, "documentation-producer-result");
      assert.equal(result.status, "success");
      assert.ok(result.artifacts.some((artifact) => artifact.kind === "vuedoc-extraction"));
      assert.ok(result.artifacts.some((artifact) => artifact.kind === "htmdoc-extraction"));
      assert.ok(result.artifacts.some((artifact) => artifact.kind === "cssdoc-extraction"));
      assert.ok(result.artifacts.some((artifact) => artifact.kind === "doc-source-map"));
      assert.ok(await fileExists(path.join(outputDirectory, "vuedoc.producer-result.json")));
    } finally {
      await fs.rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("runs the standalone VueDoc runner from config and CLI surfaces", async () => {
    const outputDirectory = path.join(repositoryRoot, "fixtures", "doc-source-map", "vue-sfc", "runner-out");
    const configPath = path.join(repositoryRoot, "vuedoc-runner.fixture.config.json");
    await fs.rm(outputDirectory, { recursive: true, force: true });

    try {
      await fs.writeFile(configPath, `${JSON.stringify({
        contract: VUEDOC_RUNNER_CONFIG_CONTRACT,
        contractVersion: VUEDOC_RUNNER_CONFIG_VERSION,
        workspaceRoot: ".",
        outputDirectory: "fixtures/doc-source-map/vue-sfc/runner-out",
        inputs: [
          {
            kind: "vue-sfc",
            path: fixturePath,
            language: "vue"
          }
        ],
        options: {
          emitDocSourceMap: true,
          sourcesContentPolicy: "none",
          writeResultManifest: true
        }
      }, null, 2)}\n`, "utf8");

      const config = await loadVueDocRunnerConfig(configPath);
      const result = await runVueDocRunner(config);
      assert.equal(result.status, "success");
      assert.ok(result.artifacts.some((artifact) => artifact.kind === "hia-document"));
      assert.ok(await fileExists(path.join(outputDirectory, "vuedoc.producer-result.json")));

      await fs.rm(outputDirectory, { recursive: true, force: true });
      const cliResult = spawnSync(process.execPath, [
        path.join(repositoryRoot, "packages", "vuedoc-runner", "src", "cli.mjs"),
        "--config",
        configPath
      ], {
        cwd: repositoryRoot,
        encoding: "utf8"
      });
      assert.equal(cliResult.status, 0, cliResult.stderr);
      assert.match(cliResult.stdout, /"status": "success"/);
      assert.ok(await fileExists(path.join(outputDirectory, "vuedoc.producer-result.json")));
    } finally {
      await fs.rm(outputDirectory, { recursive: true, force: true });
      await fs.rm(configPath, { force: true });
    }
  });
});

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
