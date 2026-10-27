/**
 * @file
 * @lang zh-CN Vue SFC 源码范围的编译器坐标回归；验证 CRLF、非 BMP 与相邻标签边界，并保留合成回退的未知精度。
 * @lang en Compiler-coordinate regressions for Vue SFC ranges, covering CRLF, astral characters, adjacent tag boundaries, and the unknown precision of synthetic fallback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "@vue/compiler-sfc";
import { extractVueSfc } from "../packages/vue-sfc-extractor/src/index.mjs";
import { createVueSfcDocSourceMap } from "../packages/vue-sfc-doc-source-map/src/index.mjs";

/**
 * @lang zh-CN 把 UTF-16 字符串偏移换算为一基行列，作为与编译器位置独立的源码边界对照。
 * @lang en Converts a UTF-16 string offset to a one-based line and column for a source boundary independent of compiler locations.
 * @param {string} source <lang><zh-CN>原始公开合成源码。</zh-CN><en>Original public synthetic source.</en></lang>
 * @param {number} offset <lang><zh-CN>UTF-16 字符串偏移。</zh-CN><en>UTF-16 string offset.</en></lang>
 * @returns {{line:number,column:number}} <lang><zh-CN>一基行列。</zh-CN><en>One-based line and column.</en></lang>
 */
function positionAt(source, offset) {
  // <lang><zh-CN>只切到目标边界，避免非 BMP 字符按码点而非 UTF-16 单位计列。</zh-CN><en>Slice only to the target boundary to count columns in UTF-16 units rather than Unicode code points.</en></lang>
  const lines = source.slice(0, offset).split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

/** @lang zh-CN 编译器块位置应与真实内容边界一致，并经映射写入器原样保留。 @lang en Compiler block positions must match real content boundaries and survive map projection unchanged. */
test("preserves compiler SFC boundaries with CRLF, astral text and adjacent tags", async () => {
  // <lang><zh-CN>从现有公开 fixture 改造模板，保持其脚本/样式作为真实混合块输入。</zh-CN><en>Adapt the existing public fixture template while retaining its script and style as real mixed-block input.</en></lang>
  const fixture = await readFile(fileURLToPath(new URL("../fixtures/doc-source-map/vue-sfc/src/components/ProfileCard.vue", import.meta.url)), "utf8");
  const source = fixture.replace(/<template>[\s\S]*?<\/template>/, "<template><!-- @component RangeProbe 🔥 --><div>🔥</div></template>").replace(/\r\n?|\n/g, "\r\n");
  const parsed = parse(source, { filename: "src/components/ProfileCard.vue" });
  const extraction = extractVueSfc(source, { path: "src/components/ProfileCard.vue" });
  const template = extraction.blocks.find((block) => block.type === "template");
  const style = extraction.blocks.find((block) => block.type === "style");

  assert.ok(template);
  assert.ok(style);
  assert.deepEqual(template.range.start, positionAt(source, source.indexOf("<!--")));
  assert.deepEqual(template.range.end, positionAt(source, source.indexOf("</template>")));
  assert.deepEqual(template.range.start, { line: parsed.descriptor.template.loc.start.line, column: parsed.descriptor.template.loc.start.column });
  assert.deepEqual(template.range.end, { line: parsed.descriptor.template.loc.end.line, column: parsed.descriptor.template.loc.end.column });
  assert.deepEqual(style.range.start, { line: parsed.descriptor.styles[0].loc.start.line, column: parsed.descriptor.styles[0].loc.start.column });
  assert.deepEqual(style.range.end, { line: parsed.descriptor.styles[0].loc.end.line, column: parsed.descriptor.styles[0].loc.end.column });

  // <lang><zh-CN>来源映射引用与提取块共用原始边界，不重引入旧版多一列。</zh-CN><en>Source-map references share the extracted block boundary and do not reintroduce the former one-column shift.</en></lang>
  const manifest = createVueSfcDocSourceMap({
    vueArtifact: extraction,
    vueDocPath: "ProfileCard.vuedoc.json",
    htmDocPath: "ProfileCard.htmdoc.json",
    cssDocPath: "ProfileCard.cssdoc.json",
    hiaDocumentPath: "ProfileCard.hia.json",
    templatePath: "ProfileCard.template.js",
    templateMapPath: "ProfileCard.template.js.map",
    stylePath: "ProfileCard.style.css",
    styleMapPath: "ProfileCard.style.css.map"
  });
  const component = extraction.symbols.find((symbol) => symbol.kind === "vue-component");
  const mapped = manifest.entries.find((entry) => entry.symbolId === component?.id);
  assert.ok(mapped);
  assert.equal(manifest.contractVersion, "1.1.0");
  assert.deepEqual(mapped.sourceRefs[0].range, template.range);
  assert.deepEqual(mapped.sourceRefs[0].rangeConvention, { endBoundary: "exclusive", columnUnit: "utf16-code-unit" });
});

/** @lang zh-CN 无注释组件的人工点仅是回退线索，不能冒充已证实的空范围。 @lang en The artificial point for an undocumented component is a fallback hint, not a proven empty span. */
test("keeps undocumented component point as low-confidence fallback", () => {
  // <lang><zh-CN>最小组件没有文档注释，故只能保留原有低置信度占位。</zh-CN><en>A minimal component has no documentation annotation, so only the existing low-confidence placeholder remains.</en></lang>
  const extraction = extractVueSfc("<template><div/></template>", { path: "src/Empty.vue" });
  const component = extraction.symbols.find((symbol) => symbol.kind === "vue-component");
  assert.ok(component);
  assert.deepEqual(component.source.range, { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } });
  assert.equal(component.source.confidence, "low");
  assert.equal(Object.hasOwn(component.source, "rangeConvention"), false);
  const manifest = createVueSfcDocSourceMap({
    vueArtifact: extraction,
    vueDocPath: "Empty.vuedoc.json",
    htmDocPath: "Empty.htmdoc.json",
    cssDocPath: "Empty.cssdoc.json",
    hiaDocumentPath: "Empty.hia.json"
  });
  assert.deepEqual(manifest.entries[0].sourceRefs[0].rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
  assert.equal(manifest.entries[0].sourceRefs[0].rangeSource, "heuristic");
});

/** @lang zh-CN 空 SFC 的人工 1:1 点只保留未知位置，不能因起止相等而升级为已证零长声明。 @lang en An empty SFC's artificial 1:1 point remains unknown and must not become a proven zero-length declaration merely because its endpoints match. */
test("keeps an empty SFC fallback unknown instead of claiming a zero-length source range", () => {
  // <lang><zh-CN>真实提取器仍会产出组件身份，但空文件没有可证明的源码字符。</zh-CN><en>The real extractor still emits a component identity, but an empty file has no source character to prove.</en></lang>
  const extraction = extractVueSfc("", { path: "src/EmptyFile.vue" });
  const manifest = createVueSfcDocSourceMap({
    vueArtifact: extraction,
    vueDocPath: "EmptyFile.vuedoc.json",
    htmDocPath: "EmptyFile.htmdoc.json",
    cssDocPath: "EmptyFile.cssdoc.json",
    hiaDocumentPath: "EmptyFile.hia.json"
  });
  const reference = manifest.entries[0]?.sourceRefs[0];
  assert.equal(manifest.contractVersion, "1.1.0");
  assert.equal(manifest.entries.length, 1);
  assert.deepEqual(reference?.range, { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } });
  assert.deepEqual(reference?.rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
  assert.equal(reference?.confidence, "low");
});

/**
 * @lang zh-CN 仅用于本仓回归的已证 UTF-16 起点查询基准；未知约定必须排除，完整共享读取器另在跨仓证据验证。
 * @lang en A local regression oracle for proven UTF-16 start positions; unknown conventions are excluded, while the full shared reader is verified in cross-repository evidence.
 * @param {object} manifest <lang><zh-CN>真实 Vue 写入器产出的文档源码映射。</zh-CN><en>Documentation source map emitted by the real Vue writer.</en></lang>
 * @param {string} symbolId <lang><zh-CN>要查询的符号身份。</zh-CN><en>Symbol identity to query.</en></lang>
 * @param {{line:number,column:number}} position <lang><zh-CN>一基 UTF-16 候选起点。</zh-CN><en>One-based UTF-16 candidate start.</en></lang>
 * @returns {object[]} <lang><zh-CN>符合已证起点条件的映射条目。</zh-CN><en>Map entries matching a proven start.</en></lang>
 */
function entriesAtProvenUtf16Start(manifest, symbolId, position) {
  return manifest.entries.filter((entry) => entry.symbolId === symbolId && entry.sourceRefs.some((reference) =>
    ["inclusive", "exclusive"].includes(reference.rangeConvention?.endBoundary)
    && reference.rangeConvention?.columnUnit === "utf16-code-unit"
    && reference.range?.start?.line === position.line
    && reference.range?.start?.column === position.column));
}

/** @lang zh-CN 真实未闭合模板的零长 parser 引用仍可按身份查看，但不能按已知位置命中。 @lang en A native point reference from an unclosed template remains discoverable by identity but cannot match a proven position. */
test("keeps a native zero-length Vue recovery reference unverified", () => {
  // <lang><zh-CN>两个非空输入改变子元素及模板的闭合状态；注释使恢复路径确有组件引用而非人工无注释回退。</zh-CN><en>The two nonempty inputs change whether the child element and template close; the annotation yields a component reference rather than an undocumented placeholder.</en></lang>
  const recoveredSource = "<template><!-- @component Card --><div>";
  const completeSource = "<template><!-- @component Card --><div/></template>";
  const sourcePath = "src/Card.vue";
  const options = { vueDocPath: "Card.vuedoc.json", htmDocPath: "Card.htmdoc.json", cssDocPath: "Card.cssdoc.json", hiaDocumentPath: "Card.hia.json" };
  const recoveredNative = parse(recoveredSource, { filename: sourcePath, sourceMap: true });
  const recovered = extractVueSfc(recoveredSource, { path: sourcePath });
  const recoveredMap = createVueSfcDocSourceMap({ ...options, vueArtifact: recovered });
  const recoveredEntry = recoveredMap.entries.find((entry) => entry.symbolKind === "vue-component");
  const recoveredReference = recoveredEntry?.sourceRefs[0];

  // <lang><zh-CN>实际 compiler-sfc 错误恢复把模板内容压成 1:11 的零长块；写入器必须保留来源且撤销精度。</zh-CN><en>Actual compiler-sfc recovery reduces template content to a point at 1:11; the writer must retain provenance and revoke precision.</en></lang>
  assert.equal(recoveredNative.errors.length, 2);
  assert.equal(recoveredNative.descriptor.template?.content.length, 0);
  assert.deepEqual(recoveredNative.descriptor.template?.loc.start, recoveredNative.descriptor.template?.loc.end);
  assert.ok(recovered.diagnostics.some((diagnostic) => diagnostic.code === "VUE_SFC_PARSE_ERROR"));
  assert.equal(recoveredMap.contractVersion, "1.1.0");
  assert.equal(recoveredEntry?.symbolId, recovered.symbols.find((symbol) => symbol.kind === "vue-component")?.id);
  assert.deepEqual(recoveredReference?.range, { start: { line: 1, column: 11 }, end: { line: 1, column: 11 } });
  assert.deepEqual(recoveredReference?.rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
  assert.equal(recoveredReference?.rangeSource, "parser");
  assert.equal(recoveredReference?.confidence, "low");
  assert.equal(entriesAtProvenUtf16Start(recoveredMap, recoveredEntry.symbolId, { line: 1, column: 11 }).length, 0);
  assert.equal(recoveredMap.entries.filter((entry) => entry.symbolId === recoveredEntry.symbolId).length, 1);

  // <lang><zh-CN>完整模板是位置查询正控，确保回归不靠一律拒绝而通过。</zh-CN><en>The complete template is a positive position-query control so blanket rejection cannot pass the regression.</en></lang>
  const completeNative = parse(completeSource, { filename: sourcePath, sourceMap: true });
  const complete = extractVueSfc(completeSource, { path: sourcePath });
  const completeMap = createVueSfcDocSourceMap({ ...options, vueArtifact: complete });
  const completeEntry = completeMap.entries.find((entry) => entry.symbolKind === "vue-component");
  const completeReference = completeEntry?.sourceRefs[0];
  assert.deepEqual(completeNative.errors, []);
  assert.deepEqual(completeReference?.range, { start: { line: 1, column: 11 }, end: { line: 1, column: 41 } });
  assert.deepEqual(completeReference?.rangeConvention, { endBoundary: "exclusive", columnUnit: "utf16-code-unit" });
  assert.equal(entriesAtProvenUtf16Start(completeMap, completeEntry.symbolId, { line: 1, column: 11 }).length, 1);
});

/** @lang zh-CN 只把已测模板注释提升为精确坐标；脚本、样式和宏保留真实来源与未知边界。 @lang en Only the measured template annotation gets exact coordinates; script, style and macro retain their origin and unknown boundaries. */
test("declares range conventions per Vue source branch", async () => {
  // <lang><zh-CN>现有 fixture 同时包含四类分支，防止把统一 parser 标签误当成精度证明。</zh-CN><en>The existing fixture covers four branches so a shared parser label cannot stand in for precision evidence.</en></lang>
  const source = await readFile(fileURLToPath(new URL("../fixtures/doc-source-map/vue-sfc/src/components/ProfileCard.vue", import.meta.url)), "utf8");
  const extraction = extractVueSfc(source, { path: "src/ProfileCard.vue" });
  const options = { vueArtifact: extraction, vueDocPath: "ProfileCard.vuedoc.json", htmDocPath: "ProfileCard.htmdoc.json", cssDocPath: "ProfileCard.cssdoc.json", hiaDocumentPath: "ProfileCard.hia.json" };
  const manifest = createVueSfcDocSourceMap(options);
  const template = manifest.entries.find((entry) => entry.symbolKind === "html-slot");
  const script = manifest.entries.find((entry) => entry.symbolKind === "html-event");
  const style = manifest.entries.find((entry) => entry.symbolKind === "css-selector");
  const macro = manifest.entries.find((entry) => entry.symbolKind === "vue-exposed-api");

  assert.deepEqual(template?.sourceRefs[0].rangeConvention, { endBoundary: "exclusive", columnUnit: "utf16-code-unit" });
  for (const entry of [script, style, macro]) {
    assert.ok(entry);
    assert.deepEqual(entry.sourceRefs[0].rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
    assert.equal(entry.sourceRefs[0].confidence, "low");
  }
  assert.equal(macro.sourceRefs[0].rangeSource, "heuristic");
  assert.equal(macro.sourceRefs[0].rangeSourceDetail, "vue-compiler-macro");
  assert.equal(macro.sourceRefs[0].confidence, "low");
  assert.ok(manifest.entries.every((entry) => entry.sourceRefs.every((reference) => Boolean(reference.rangeConvention) === Boolean(reference.range))));

  // <lang><zh-CN>外来适配器即使复制相同模板坐标，也不能继承本提取器的实测精度。</zh-CN><en>An external adapter cannot inherit this extractor's measured precision by copying the same template coordinates.</en></lang>
  const external = structuredClone(extraction);
  external.producer.name = "external-vue-adapter";
  const externalMap = createVueSfcDocSourceMap({ ...options, vueArtifact: external });
  const externalTemplate = externalMap.entries.find((entry) => entry.symbolKind === "html-slot");
  assert.deepEqual(externalTemplate?.sourceRefs[0].rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
  assert.equal(externalTemplate?.sourceRefs[0].rangeSource, "adapter");
  assert.equal(externalTemplate?.sourceRefs[0].confidence, "low");

  // <lang><zh-CN>即使路径和块坐标未变，解析错误与未知提取版本也撤销模板精度声明。</zh-CN><en>Even with unchanged path and block coordinates, parse errors and unknown extractor versions revoke template precision.</en></lang>
  const parsedWithError = structuredClone(extraction);
  parsedWithError.diagnostics.push({ code: "VUE_SFC_PARSE_ERROR", severity: "error", message: "Synthetic parser error." });
  const errorMap = createVueSfcDocSourceMap({ ...options, vueArtifact: parsedWithError });
  assert.deepEqual(errorMap.entries.find((entry) => entry.symbolKind === "html-slot")?.sourceRefs[0].rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
  const unknownVersion = structuredClone(extraction);
  unknownVersion.contractVersion = "0.0.0-draft";
  const versionMap = createVueSfcDocSourceMap({ ...options, vueArtifact: unknownVersion });
  assert.deepEqual(versionMap.entries.find((entry) => entry.symbolKind === "html-slot")?.sourceRefs[0].rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
});
