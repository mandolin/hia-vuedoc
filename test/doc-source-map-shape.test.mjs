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
  const vueArtifact = extractVueSfc("<template><div /></template><script setup>const name = 'public';</script><style>.card { color: blue; }</style>", { path: "src/Card.vue" });
  const manifest = createVueSfcDocSourceMap({ vueArtifact, vueDocPath: "Card.vuedoc.json", htmDocPath: "Card.htmdoc.json", cssDocPath: "Card.cssdoc.json", hiaDocumentPath: "Card.hia.json", templatePath: "Card.template.js", templateMapPath: "Card.template.js.map", scriptPath: "Card.script.js", scriptMapPath: "Card.script.js.map", stylePath: "Card.style.css", styleMapPath: "Card.style.css.map" });
  assert.equal(manifest.sourceMaps.length, 3);
  for (const map of manifest.sourceMaps) assert.ok(Array.isArray(map.mapsTo));
  for (const entry of manifest.entries) {
    if (Object.hasOwn(entry, "annotation")) assert.ok(entry.annotation && typeof entry.annotation === "object");
    for (const ref of entry.artifactRefs) if (Object.hasOwn(ref, "selector")) assert.ok(typeof ref.selector === "string" && ref.selector.length > 0);
  }
});
