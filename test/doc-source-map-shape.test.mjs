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

/** @lang zh-CN 脚本中的事件注释应链接到实际脚本生成阶段及脚本产物。 @lang en An event annotation in a script block must link to the actual script stage and artifact. */
test("links script-block event annotations to the compiled script", () => {
  // <lang><zh-CN>事件注释来自 script setup，而模板只负责呈现点击处理器。</zh-CN><en>The event annotation originates in script setup, while the template only renders the click handler.</en></lang>
  const vueArtifact = extractVueSfc('<template><button @click="emit(\'save\')">Save</button></template><script setup>/** @event save Saved. */\nconst emit = defineEmits(["save"]);</script>', { path: "src/EventCard.vue" });
  const manifest = createVueSfcDocSourceMap({
    vueArtifact,
    vueDocPath: "EventCard.vuedoc.json",
    htmDocPath: "EventCard.htmdoc.json",
    cssDocPath: "EventCard.cssdoc.json",
    hiaDocumentPath: "EventCard.hia.json",
    templatePath: "EventCard.template.js",
    scriptPath: "EventCard.script.js"
  });
  const event = manifest.entries.find((entry) => entry.symbolKind === "html-event");
  const templateStage = manifest.chains[0].stages.find((stage) => stage.to === "artifact:vue-template:render");
  const scriptStage = manifest.chains[0].stages.find((stage) => stage.to === "artifact:vue-script:compiled");
  assert.ok(event);
  assert.equal(vueArtifact.symbols.find((symbol) => symbol.id === event.symbolId)?.annotation?.source?.blockType, "scriptSetup");
  assert.equal(templateStage.linkage.includes(event.id), false);
  assert.equal(scriptStage.linkage.includes(event.id), true);
  assert.equal(event.artifactRefs[0].artifactId, "artifact:vue-script:compiled");
});

/** @lang zh-CN 脚本产物缺失时，脚本注释不能退向模板或样式产物。 @lang en When the script output is absent, script annotations must not fall back to template or style artifacts. */
test("keeps all script-block annotation kinds on the extraction artifact when script output is absent", () => {
  // <lang><zh-CN>故意混合事件、插槽与 CSS 标签，验证产物选择按来源块而非语义类别。</zh-CN><en>Mix event, slot and CSS tags to prove artifact selection follows the source block rather than semantic kind.</en></lang>
  const source = `<template><button>Save</button></template><script setup>/**
 * @event save Saved.
 * @slot extra Extra content.
 * @selector .script-only Script annotation.
 */
const emit = defineEmits(["save"]);</script><style>.card{color:blue}</style>`;
  const vueArtifact = extractVueSfc(source, { path: "src/EventCard.vue" });
  const options = {
    vueArtifact,
    vueDocPath: "EventCard.vuedoc.json",
    htmDocPath: "EventCard.htmdoc.json",
    cssDocPath: "EventCard.cssdoc.json",
    hiaDocumentPath: "EventCard.hia.json",
    templatePath: "EventCard.template.js",
    stylePath: "EventCard.style.css"
  };
  /** @lang zh-CN 从本合成输入选取三种脚本块注释条目。 @lang en Selects the three script-block annotation entries from this synthetic input. */
  const scriptEntries = (manifest) => manifest.entries.filter((entry) => ["html-event", "html-slot", "css-selector"].includes(entry.symbolKind));
  const withScript = createVueSfcDocSourceMap({ ...options, scriptPath: "EventCard.script.js" });
  const scriptStage = withScript.chains[0].stages.find((stage) => stage.to === "artifact:vue-script:compiled");
  assert.equal(scriptEntries(withScript).length, 3);
  assert.ok(scriptEntries(withScript).every((entry) => scriptStage.linkage.includes(entry.id) && entry.artifactRefs[0].artifactId === "artifact:vue-script:compiled"));

  // <lang><zh-CN>缺少脚本输出时只保留已存在的提取工件，并且其它生成边不冒领这三条来源。</zh-CN><en>Without a script output, retain only the existing extraction artifact; other generated stages must not claim these three origins.</en></lang>
  const withoutScript = createVueSfcDocSourceMap(options);
  const generatedStages = withoutScript.chains[0].stages.filter((stage) => ["artifact:vue-template:render", "artifact:vue-style:compiled"].includes(stage.to));
  assert.equal(withoutScript.chains[0].stages.some((stage) => stage.to === "artifact:vue-script:compiled"), false);
  assert.ok(scriptEntries(withoutScript).every((entry) => entry.artifactRefs[0].artifactId === "artifact:vuedoc:extraction"));
  assert.ok(scriptEntries(withoutScript).every((entry) => generatedStages.every((stage) => !stage.linkage.includes(entry.id))));
});

/** @lang zh-CN 外部生产者声明不可作为公开映射的原样来源明细。 @lang en An external producer claim must not be copied verbatim into public map provenance. */
test("does not expose an external producer path in provenance detail", () => {
  // <lang><zh-CN>模拟外来提取件把私有绝对路径放进自报名称；映射只能给出固定安全类别。</zh-CN><en>Simulate a foreign artifact with a private absolute path as its claimed name; the map may emit only a fixed safe category.</en></lang>
  const vueArtifact = extractVueSfc("<template><!-- @component EventCard --><div/></template>", { path: "src/EventCard.vue" });
  vueArtifact.producer.name = "C:/private/alice/adapter";
  const manifest = createVueSfcDocSourceMap({
    vueArtifact,
    vueDocPath: "EventCard.vuedoc.json",
    htmDocPath: "EventCard.htmdoc.json",
    cssDocPath: "EventCard.cssdoc.json",
    hiaDocumentPath: "EventCard.hia.json"
  });
  assert.equal(manifest.entries[0].sourceRefs[0].rangeSource, "adapter");
  assert.equal(manifest.entries[0].sourceRefs[0].rangeSourceDetail, "external-vue-artifact");
  assert.equal(JSON.stringify(manifest).includes("C:/private/alice/adapter"), false);

  // <lang><zh-CN>即使输入冒用本地生产者身份，未知来源标签也不可原样透传。</zh-CN><en>An unknown origin label must remain bounded even when the input claims the local producer identity.</en></lang>
  vueArtifact.producer.name = "@hia-doc/vue-sfc-extractor";
  vueArtifact.symbols[0].source.rangeSource = "C:/private/alice/range-scanner";
  const claimedLocal = createVueSfcDocSourceMap({
    vueArtifact,
    vueDocPath: "EventCard.vuedoc.json",
    htmDocPath: "EventCard.htmdoc.json",
    cssDocPath: "EventCard.cssdoc.json",
    hiaDocumentPath: "EventCard.hia.json"
  });
  assert.equal(claimedLocal.entries[0].sourceRefs[0].rangeSourceDetail, "unrecognized-vue-source");
  assert.equal(JSON.stringify(claimedLocal).includes("C:/private/alice/range-scanner"), false);
});
