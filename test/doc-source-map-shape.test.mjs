/**
 * @file
 * @lang zh-CN Vue映射的列表引用和可选字段回归，覆盖未注释组件与编译脚本/样式。
 * @lang en Vue-map list-reference and optional-field regressions covering undocumented components and compiled scripts/styles.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractVueSfc } from "../packages/vue-sfc-extractor/src/index.mjs";
import { createVueSfcDocSourceMap } from "../packages/vue-sfc-doc-source-map/src/index.mjs";

test("uses mapsTo lists and omits absent annotation/selector fields", () => {
  // <lang><zh-CN>最小未注释组件触发可选annotation缺失，普通map仍必须使用引用数组。</zh-CN><en>A minimal undocumented component exercises absent optional annotations; ordinary maps must still use reference arrays.</en></lang>
  const vueArtifact = extractVueSfc("<template><div /></template><script setup>const name = 'public'; defineExpose({ name });</script><style>.card { color: blue; }</style>", { path: "src/Card.vue" });
  const manifest = createVueSfcDocSourceMap({ vueArtifact, vueDocPath: "Card.vuedoc.json", htmDocPath: "Card.htmdoc.json", cssDocPath: "Card.cssdoc.json", hiaDocumentPath: "Card.hia.json", templatePath: "Card.template.js", templateMapPath: "Card.template.js.map", scriptPath: "Card.script.js", scriptMapPath: "Card.script.js.map", stylePath: "Card.style.css", styleMapPath: "Card.style.css.map" });
  assert.equal(manifest.sourceMaps.length, 3);
  const artifactIds = new Set(manifest.artifacts.map((artifact) => artifact.id));
  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  for (const map of manifest.sourceMaps) {
    assert.ok(Array.isArray(map.mapsTo));
    assert.ok(artifactIds.has(map.mapsFrom));
    assert.ok(map.mapsTo.every((id) => sourceIds.has(id)));
  }
  for (const entry of manifest.entries) {
    if (Object.hasOwn(entry, "annotation")) assert.ok(entry.annotation && typeof entry.annotation === "object");
    for (const ref of entry.artifactRefs) if (Object.hasOwn(ref, "selector")) assert.ok(typeof ref.selector === "string" && ref.selector.length > 0);
  }
  const templateStage = manifest.chains[0].stages.find((stage) => stage.to === "artifact:vue-template:render");
  const macroEntry = manifest.entries.find((entry) => entry.symbolKind === "vue-exposed-api");
  assert.ok(templateStage);
  assert.equal(templateStage.linkage.includes(macroEntry.id), false);
});

/** @lang zh-CN 可选生成产物缺失仍须闭合引用；异源符号在单文件链中显式拒绝。 @lang en Missing optional generated artifacts must retain closed references; foreign symbols are rejected from a single-file chain. */
test("closes source and artifact references without optional outputs", () => {
  // <lang><zh-CN>不给可选生成路径，引用必须退回已存在的提取工件。</zh-CN><en>Without optional generated paths, references must fall back to the existing extraction artifact.</en></lang>
  const vueArtifact = extractVueSfc("<template><!-- @component Card --><div/></template>", { path: "src/Card.vue" });
  const options = { vueArtifact, vueDocPath: "Card.vuedoc.json", htmDocPath: "Card.htmdoc.json", cssDocPath: "Card.cssdoc.json", hiaDocumentPath: "Card.hia.json" };
  const manifest = createVueSfcDocSourceMap(options);
  const artifactIds = new Set(manifest.artifacts.map((artifact) => artifact.id));
  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  const entryIds = new Set(manifest.entries.map((entry) => entry.id));
  const mapIds = new Set(manifest.sourceMaps.map((map) => map.id));

  assert.equal(manifest.sourceMaps.length, 0);
  assert.equal(manifest.sources.length, 1);
  for (const entry of manifest.entries) {
    assert.ok(entry.sourceRefs.every((reference) => sourceIds.has(reference.sourceId)));
    assert.ok(entry.artifactRefs.every((reference) => artifactIds.has(reference.artifactId)));
  }
  for (const chain of manifest.chains) for (const stage of chain.stages) {
    assert.ok(artifactIds.has(stage.from) || sourceIds.has(stage.from));
    assert.ok(artifactIds.has(stage.to));
    assert.ok(stage.sourceMap === null || mapIds.has(stage.sourceMap));
    assert.ok(stage.linkage.every((id) => entryIds.has(id)));
  }
  assert.throws(() => createVueSfcDocSourceMap({ ...options, templateMapPath: "Card.template.js.map" }), /requires a generated target path/);

  // <lang><zh-CN>第二源码文件必须拒绝，避免悬空身份、slug 碰撞或被错误归入主源链。</zh-CN><en>A second source file must be rejected to avoid a dangling identity, slug collision or incorrect attribution to the primary chain.</en></lang>
  const foreign = structuredClone(vueArtifact);
  foreign.symbols[0].source.path = "src/External.vue";
  assert.throws(() => createVueSfcDocSourceMap({ ...options, vueArtifact: foreign }), /differs from primary source/);
  const colliding = structuredClone(vueArtifact);
  colliding.symbols[0].source.path = "src-Card.vue";
  assert.throws(() => createVueSfcDocSourceMap({ ...options, vueArtifact: colliding }), /differs from primary source/);
});
