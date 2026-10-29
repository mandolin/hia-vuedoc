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

  it("maps @lang and inline <lang> through VueDoc bridge artifacts", () => {
    const artifact = extractVueSfc(`<template>
  <!--
    @component GreetingCard
    @description Greets a <lang><zh-CN>用户</zh-CN><en>user</en></lang>.
    @lang zh-CN 问候一个用户。
    @slot actions <l><zh-CN>操作区域</zh-CN><en>action area</en></l>
  -->
  <section><slot name="actions" /></section>
</template>`, { path: "src/GreetingCard.vue" });
    const htmDoc = vueDocToHtmlExtraction(artifact);
    const hia = vueDocToHiaDocument(artifact);
    const component = hia.symbols.find((symbol) => symbol.kind === "html-component");
    const slot = hia.symbols.find((symbol) => symbol.kind === "html-slot");

    assert.ok(artifact.locales.includes("zh-CN"));
    assert.ok(htmDoc.locales.includes("zh-CN"));
    assert.ok(hia.locales.includes("zh-CN"));
    assert.equal(component.i18n.fields.description.localizedText["zh-CN"], "问候一个用户。");
    assert.equal(component.i18n.fields.description.localizedText.en, "Greets a user.");
    assert.equal(slot.i18n.fields.description.localizedText["zh-CN"], "操作区域");
    assert.equal(slot.i18n.fields.description.localizedText.en, "action area");
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
    // <lang><zh-CN>CSS工件/profile按已确认迁移配对升级；HTM与Vue自己的身份保持。</zh-CN><en>CSS artifact/profile upgrade as the approved pair; HTML and Vue identities stay unchanged.</en></lang>
    assert.equal(cssDoc.contractVersion, "1.0.0");
    assert.equal(cssDoc.profile.version, "1.0.0");
    assert.equal(htmDoc.contractVersion, "0.1.0-draft");
    assert.equal(hia.schemaVersion, "0.2.0");
    assert.equal(docMap.contract, "doc-source-map");
    assert.equal(docMap.contractVersion, "1.1.0");
    assert.equal(hia.metadata.docSourceMaps[0].contractVersion, docMap.contractVersion);
    assert.ok(docMap.sourceMaps.length >= 2);
    // <lang><zh-CN>本仓实际夹具的 CSS 符号都来自 style 注释；按块归属后仍须链接到已产出的样式文件。</zh-CN><en>The real fixture's CSS symbols all originate from style annotations and must still link to the emitted style file after block-based routing.</en></lang>
    const styleSymbols = artifact.symbols.filter((symbol) => symbol.kind.startsWith("css-"));
    const styleStage = docMap.chains[0].stages.find((stage) => stage.to === "artifact:vue-style:compiled");
    assert.equal(styleSymbols.length, 2);
    assert.ok(styleSymbols.every((symbol) => symbol.annotation?.source?.blockType === "style"));
    assert.ok(styleSymbols.every((symbol) => {
      const entry = docMap.entries.find((item) => item.symbolId === symbol.id);
      return entry?.artifactRefs[0]?.artifactId === "artifact:vue-style:compiled" && styleStage?.linkage.includes(entry.id);
    }));
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
      const mapDescriptor = result.artifacts.find((item) => item.kind === "doc-source-map");
      const hiaDescriptor = result.artifacts.find((item) => item.kind === "hia-document");
      const map = JSON.parse(await fs.readFile(path.join(outputDirectory, mapDescriptor.path), "utf8"));
      const document = JSON.parse(await fs.readFile(path.join(outputDirectory, hiaDescriptor.path), "utf8"));
      assert.equal(mapDescriptor.contractVersion, "1.1.0");
      assert.equal(mapDescriptor.contractVersion, map.contractVersion);
      assert.equal(document.metadata.docSourceMaps[0].contractVersion, map.contractVersion);
    } finally {
      await fs.rm(outputDirectory, { recursive: true, force: true });
    }
  });

  /** @lang zh-CN 关闭源码映射时，结果和三个桥接产物不得留下指向未发布 JSON 的链接。 @lang en Disabling the source map leaves no link to unpublished JSON in the result or three bridge artifacts. */
  it("omits source-map references when emission is disabled", async () => {
    const outputDirectory = path.join(repositoryRoot, "fixtures", "doc-source-map", "vue-sfc", "producer-no-map-out");
    await fs.rm(outputDirectory, { recursive: true, force: true });

    try {
      const result = await vuedocProducer.produce({
        workspaceRoot: repositoryRoot,
        outputDirectory,
        inputs: [{ kind: "vue-sfc", path: fixturePath, language: "vue" }],
        options: { emitDocSourceMap: false, sourcesContentPolicy: "none", writeResultManifest: true }
      });
      assert.equal(result.status, "success");
      assert.equal(result.artifacts.some((artifact) => artifact.kind === "doc-source-map"), false);

      // <lang><zh-CN>按实际清单路径读取桥接工件，确认元数据与文件引用同时关闭。</zh-CN><en>Read bridge artifacts from actual manifest paths and verify both metadata and file links are absent.</en></lang>
      const findArtifact = async (kind) => JSON.parse(await fs.readFile(path.join(outputDirectory, result.artifacts.find((item) => item.kind === kind).path), "utf8"));
      const hia = await findArtifact("hia-document");
      const html = await findArtifact("htmdoc-extraction");
      const css = await findArtifact("cssdoc-extraction");
      assert.deepEqual(hia.metadata.docSourceMaps, []);
      assert.equal(html.sourceMap.href, null);
      assert.equal(css.sourceMap.href, null);
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
