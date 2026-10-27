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
  assert.deepEqual(mapped.sourceRefs[0].range, template.range);
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
});
