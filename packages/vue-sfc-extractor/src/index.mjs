/**
 * @file
 * @lang zh-CN 从 Vue 单文件组件提取文档语义与编译输出；注释仅从编译器确认的块内容读取。
 * @lang en Extracts documentation and compiled output from Vue single-file components; reads annotations only from compiler-confirmed block content.
 */
import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";
import {
  VUEDOC_EXTRACTION_CONTRACT,
  VUEDOC_EXTRACTION_CONTRACT_VERSION,
  VUEDOC_PROFILE_VERSION,
  getVueDocSymbolKind,
  isVueDocTag
} from "@hia-doc/vuedoc-spec";

const DEFAULT_COMPONENT_ID = "hia-vuedoc-sfc";
const DEFAULT_LOCALE = "en";
const HIA_TEXT_I18N_MODEL = "hia-text-i18n";
const HIA_TEXT_I18N_MODEL_VERSION = "0.2.0";

/**
 * @lang zh-CN 提取单文件组件的块、注释和符号；块位置按 Vue 编译器的 UTF-16 源码偏移截取，解析错误保留为诊断。
 * @lang en Extracts SFC blocks, annotations and symbols; slices block content by Vue compiler UTF-16 source offsets and retains parse errors as diagnostics.
 * @param {string} sourceText <lang><zh-CN>原始 Vue 源码，未经预处理。</zh-CN><en>Original, unpreprocessed Vue source.</en></lang>
 * @param {{path?:string,filename?:string,defaultLocale?:string}} [options] <lang><zh-CN>相对来源路径、可选编译器文件名和默认语言。</zh-CN><en>Relative source path, optional compiler filename and default locale.</en></lang>
 * @returns {object} <lang><zh-CN>不嵌入源码正文的 VueDoc 提取工件；无文档注释时仍保留组件身份。</zh-CN><en>VueDoc extraction artifact without embedded source body; retains component identity when no documentation comment exists.</en></lang>
 * @throws {Error} <lang><zh-CN>来源路径不安全或编译器无法处理输入时抛出；普通解析错误写入 diagnostics。</zh-CN><en>Throws for an unsafe source path or compiler failure; ordinary parse errors go to diagnostics.</en></lang>
 */
export function extractVueSfc(sourceText, options = {}) {
  const sourcePath = normalizePath(options.path ?? "src/Component.vue");
  const defaultLocale = normalizeLocale(options.defaultLocale) || DEFAULT_LOCALE;
  const filename = options.filename ?? sourcePath;
  const parsed = parse(sourceText, {
    filename,
    sourceMap: true
  });
  const descriptor = parsed.descriptor;
  // <lang><zh-CN>内部记录同时保留公开块形状与编译器原始内容偏移；偏移不进入提取工件。</zh-CN><en>Internal records retain both the public block shape and compiler content offsets; offsets do not enter the extraction artifact.</en></lang>
  const blockRecords = collectBlocks(descriptor, sourcePath);
  const blocks = blockRecords.map((record) => record.block);
  // <lang><zh-CN>只扫描原始源码中每块的半开内容切片，避免同一行闭合标签后的外部注释越界归属。</zh-CN><en>Scan only each block's half-open content slice in the original source, excluding same-line comments after its closing tag.</en></lang>
  const annotations = blockRecords.flatMap((record) => extractAnnotationsFromBlock(
    record.block,
    sourceText.slice(record.contentStartOffset, record.contentEndOffset)
  ));
  const componentName = findComponentName(annotations) ?? componentNameFromPath(sourcePath);
  const scriptSetupExposes = collectScriptSetupExposes(descriptor.scriptSetup, sourcePath);
  const symbols = createSymbols(annotations, componentName, sourcePath, scriptSetupExposes, { defaultLocale });

  return {
    contract: VUEDOC_EXTRACTION_CONTRACT,
    contractVersion: VUEDOC_EXTRACTION_CONTRACT_VERSION,
    producer: {
      name: "@hia-doc/vue-sfc-extractor",
      version: "0.0.0",
      compiler: "@vue/compiler-sfc"
    },
    profile: {
      name: "vuedoc",
      version: VUEDOC_PROFILE_VERSION
    },
    defaultLocale,
    locales: collectLocales([defaultLocale, ...symbols.flatMap((symbol) => symbol.i18n?.locales ?? [])]),
    source: {
      kind: "vue-sfc",
      path: sourcePath,
      sourcesContentPolicy: "none"
    },
    blocks,
    annotations,
    symbols,
    diagnostics: [
      ...parsed.errors.map((error) => ({
        code: "VUE_SFC_PARSE_ERROR",
        severity: "error",
        message: String(error.message ?? error),
        path: sourcePath
      }))
    ],
    metadata: {
      framework: "vue",
      sfc: {
        hasTemplate: Boolean(descriptor.template),
        hasScript: Boolean(descriptor.script),
        hasScriptSetup: Boolean(descriptor.scriptSetup),
        styleCount: descriptor.styles.length,
        customBlockCount: descriptor.customBlocks.length
      },
      scriptSetup: {
        defineExpose: scriptSetupExposes
      }
    }
  };
}

export function compileVueSfc(sourceText, options = {}) {
  const sourcePath = normalizePath(options.path ?? "src/Component.vue");
  const parsed = parse(sourceText, {
    filename: sourcePath,
    sourceMap: true
  });
  const descriptor = parsed.descriptor;
  const id = options.id ?? DEFAULT_COMPONENT_ID;
  const outputs = [];

  if (descriptor.template) {
    const result = compileTemplate({
      id,
      filename: sourcePath,
      source: descriptor.template.content,
      inMap: descriptor.template.map,
      compilerOptions: {
        mode: "module"
      }
    });
    outputs.push({
      kind: "template-render",
      language: "javascript",
      content: result.code,
      map: sanitizeSourceMap(result.map),
      errors: result.errors ?? [],
      tips: result.tips ?? []
    });
  }

  if (descriptor.script || descriptor.scriptSetup) {
    const result = compileScript(descriptor, {
      id,
      genDefaultAs: "__default__"
    });
    outputs.push({
      kind: "script",
      language: "javascript",
      content: result.content,
      map: sanitizeSourceMap(result.map ?? descriptor.scriptSetup?.map ?? descriptor.script?.map),
      errors: []
    });
  }

  for (const [index, style] of descriptor.styles.entries()) {
    const result = compileStyle({
      id,
      filename: sourcePath,
      source: style.content,
      scoped: style.scoped,
      modules: Boolean(style.module),
      inMap: style.map,
      sourceMap: true
    });
    outputs.push({
      kind: "style",
      language: style.lang ?? "css",
      index,
      scoped: style.scoped,
      content: result.code,
      map: sanitizeSourceMap(result.map),
      errors: result.errors ?? []
    });
  }

  return {
    descriptor,
    errors: parsed.errors,
    outputs
  };
}

/**
 * @lang zh-CN 按编译器块顺序收集公开块与仅内部使用的内容偏移，不改变提取工件 schema。
 * @lang en Collects public blocks and internal-only content offsets in compiler order without changing the extraction schema.
 * @param {object} descriptor <lang><zh-CN>Vue 编译器的单文件组件描述符。</zh-CN><en>Vue compiler SFC descriptor.</en></lang>
 * @param {string} sourcePath <lang><zh-CN>安全的相对来源路径。</zh-CN><en>Safe relative source path.</en></lang>
 * @returns {object[]} <lang><zh-CN>公开块和半开 UTF-16 源码偏移记录。</zh-CN><en>Records pairing public blocks with half-open UTF-16 source offsets.</en></lang>
 */
function collectBlocks(descriptor, sourcePath) {
  const result = [];
  pushBlock(result, "template", descriptor.template, sourcePath, 0);
  pushBlock(result, "script", descriptor.script, sourcePath, 0);
  pushBlock(result, "scriptSetup", descriptor.scriptSetup, sourcePath, 0);
  descriptor.styles.forEach((block, index) => pushBlock(result, "style", block, sourcePath, index));
  descriptor.customBlocks.forEach((block, index) => pushBlock(result, "custom", block, sourcePath, index));
  return result;
}

/**
 * @lang zh-CN 仅在编译器确有该块时追加记录；内容边界直接来自 loc offset。
 * @lang en Appends a record only for an existing compiler block, taking content bounds directly from loc offsets.
 */
function pushBlock(result, type, block, sourcePath, index) {
  if (!block) {
    return;
  }
  result.push({
    block: {
      id: `block:${type}:${index}`,
      type,
      index,
      path: sourcePath,
      language: block.lang ?? languageForBlock(type),
      range: rangeFromLoc(block.loc),
      attrs: block.attrs ?? {},
      scoped: Boolean(block.scoped),
      hasSourceMap: Boolean(block.map)
    },
    // <lang><zh-CN>Vue 的 loc offset 是原始 JS 字符串的 UTF-16 半开内容边界，空块两端相同。</zh-CN><en>Vue loc offsets are half-open UTF-16 content bounds in the original JS string, equal for an empty block.</en></lang>
    contentStartOffset: block.loc.start.offset,
    contentEndOffset: block.loc.end.offset
  });
}

/**
 * @lang zh-CN 从单个编译器确认的块内容解析注释，不扫描同一行的相邻块或外部文本。
 * @lang en Parses annotations from one compiler-confirmed block body without scanning adjacent blocks or outside text on the same line.
 * @param {object} block <lang><zh-CN>公开块身份与来源范围。</zh-CN><en>Public block identity and source range.</en></lang>
 * @param {string} blockContent <lang><zh-CN>原始源码中的精确块内容切片。</zh-CN><en>Exact block-content slice from the original source.</en></lang>
 * @returns {object[]} <lang><zh-CN>仅属于该块的注释。</zh-CN><en>Annotations belonging only to that block.</en></lang>
 */
function extractAnnotationsFromBlock(block, blockContent) {
  const commentBodies = collectCommentBodies(blockContent, block.type);
  return commentBodies.flatMap((comment) => parseAnnotationBlock(comment.body, block, comment.offset));
}

/**
 * @lang zh-CN 在单个块的精确内容中找注释，返回相对该内容零基 UTF-16 的注释起点。
 * @lang en Finds comments within exact content of one block, returning zero-based UTF-16 starts relative to that content.
 * @param {string} text <lang><zh-CN>编译器块内容。</zh-CN><en>Compiler block content.</en></lang>
 * @param {string} blockType <lang><zh-CN>决定模板或脚本/样式注释格式的块类型。</zh-CN><en>Block type selecting template or script/style comment syntax.</en></lang>
 * @returns {{body:string,offset:number}[]} <lang><zh-CN>注释正文及块内容内起点。</zh-CN><en>Comment bodies and starts within block content.</en></lang>
 */
function collectCommentBodies(text, blockType) {
  const patterns = blockType === "template"
    ? [/<!--([\s\S]*?)-->/g]
    : [/\/\*([\s\S]*?)\*\//g, /\/\/\s?(@[^\n]+)/g];
  const bodies = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      bodies.push({
        body: match[1],
        offset: match.index ?? 0
      });
    }
  }
  return bodies;
}

/**
 * @lang zh-CN 把一条块内注释拆成文档标签；来源 offset 是注释起点，不是文件绝对坐标。
 * @lang en Parses one in-block comment into documentation tags; source offset points to the comment within the block, not an absolute file coordinate.
 * @param {string} body <lang><zh-CN>注释正文。</zh-CN><en>Comment body.</en></lang>
 * @param {object} block <lang><zh-CN>归属块的身份和源码范围。</zh-CN><en>Owning block identity and source range.</en></lang>
 * @param {number} offset <lang><zh-CN>零基 UTF-16 块内容内注释起点。</zh-CN><en>Zero-based UTF-16 comment start within block content.</en></lang>
 * @returns {object[]} <lang><zh-CN>该注释中的有效 VueDoc 标签。</zh-CN><en>Valid VueDoc tags in the comment.</en></lang>
 */
function parseAnnotationBlock(body, block, offset) {
  const annotations = [];
  const normalized = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .join("\n");
  const tagPattern = /@([a-zA-Z][\w-]*)(?:\s+([^\n]*))?/g;
  for (const match of normalized.matchAll(tagPattern)) {
    const tag = match[1].toLowerCase();
    if (!isVueDocTag(tag)) {
      continue;
    }
    annotations.push({
      tag,
      value: (match[2] ?? "").trim(),
      source: {
        blockId: block.id,
        blockType: block.type,
        path: block.path,
        range: block.range,
        offset
      }
    });
  }
  return annotations;
}

function createSymbols(annotations, componentName, sourcePath, scriptSetupExposes, options) {
  const componentId = `component:${componentName}`;
  const symbols = [];
  const componentAnnotation = annotations.find((annotation) => annotation.tag === "component");
  const componentSummary = descriptionForComponent(annotations, componentAnnotation) ?? "Vue SFC component.";
  const componentI18n = createDescriptionI18n(componentSummary, annotations, options.defaultLocale, "vuedoc.component");
  symbols.push({
    id: componentId,
    kind: "vue-component",
    bridgeKinds: ["html-component"],
    name: firstWord(componentAnnotation?.value) ?? componentName,
    summary: componentI18n?.fields.description?.defaultText ?? componentSummary,
    source: sourceForAnnotation(componentAnnotation, sourcePath),
    annotation: componentAnnotation ?? null,
    ...(componentI18n ? { i18n: componentI18n } : {}),
    metadata: {
      bridgeTargets: ["htmdoc", "cssdoc", "jsdoc"],
      componentName
    }
  });

  for (const annotation of annotations) {
    if (annotation.tag === "component") {
      continue;
    }
    const name = firstWord(annotation.value) ?? annotation.tag;
    const kind = getVueDocSymbolKind(annotation.tag);
    if (!kind) {
      continue;
    }
    const summary = restWords(annotation.value) ?? "";
    const i18n = createDescriptionI18n(summary, [], options.defaultLocale, `vuedoc.${annotation.tag}`);
    symbols.push({
      id: `${annotation.tag}:${slug(componentName)}:${slug(name)}`,
      kind,
      name,
      parentId: componentId,
      summary: i18n?.fields.description?.defaultText ?? summary,
      source: sourceForAnnotation(annotation, sourcePath),
      annotation,
      ...(i18n ? { i18n } : {}),
      metadata: {
        bridgeTargets: bridgeTargetsForKind(kind),
        vueTag: annotation.tag
      }
    });
  }

  const existingExposeNames = new Set(symbols.filter((symbol) => symbol.kind === "vue-exposed-api").map((symbol) => symbol.name));
  for (const exposed of scriptSetupExposes) {
    if (existingExposeNames.has(exposed.name)) {
      continue;
    }
    symbols.push({
      id: `expose:${slug(componentName)}:${slug(exposed.name)}`,
      kind: "vue-exposed-api",
      name: exposed.name,
      parentId: componentId,
      summary: `Exposed by defineExpose().`,
      source: {
        path: sourcePath,
        range: exposed.source.range,
        rangeSource: "vue-compiler-macro",
        confidence: "high"
      },
      annotation: null,
      metadata: {
        bridgeTargets: ["jsdoc", "tsdoc"],
        vueTag: "expose",
        macro: "defineExpose",
        localName: exposed.localName
      }
    });
  }

  return symbols;
}

function descriptionForComponent(annotations, componentAnnotation) {
  const description = annotations.find((annotation) => annotation.tag === "description");
  return description?.value || restWords(componentAnnotation?.value);
}

// 中文：把 VueDoc 的 `@lang` 与 inline `<lang>/<l>` 规整成 HIA field-level i18n。
// English: Normalizes VueDoc `@lang` and inline `<lang>/<l>` into HIA field-level i18n.
function createDescriptionI18n(defaultText, annotations, defaultLocale, source) {
  const blocks = collectLangBlocks(annotations, "description", source);
  const segments = parseInlineSegments(defaultText, "description");
  if (blocks.length === 0 && segments.length === 0) {
    return null;
  }

  const field = createTextField({
    fieldPath: "description",
    kind: "text",
    defaultLocale,
    defaultText,
    blocks,
    segments,
    source
  });

  return {
    enabled: true,
    model: HIA_TEXT_I18N_MODEL,
    modelVersion: HIA_TEXT_I18N_MODEL_VERSION,
    defaultLocale,
    locales: collectLocales([defaultLocale, ...Object.keys(field.localizedText)]),
    fields: {
      description: field
    }
  };
}

function collectLangBlocks(annotations, fieldPath, source) {
  return annotations
    .filter((annotation) => annotation.tag === "lang")
    .map((annotation) => parseLangBlock(annotation.value, fieldPath, source))
    .filter(Boolean);
}

function parseLangBlock(value, fieldPath, source) {
  const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(String(value ?? "").trim());
  const locale = normalizeLocale(match?.[1]);
  const text = compactWhitespace(match?.[2] ?? "");
  if (!locale || !text) {
    return null;
  }
  return {
    kind: "lang-block",
    locale,
    fieldPath,
    text,
    source,
    rangeInComment: null
  };
}

function createTextField(options) {
  const localizedText = {};
  const locales = collectLocales([
    options.defaultLocale,
    ...options.blocks.map((block) => block.locale),
    ...options.segments.flatMap((segment) => Object.keys(segment.localized))
  ]);

  for (const locale of locales) {
    const block = options.blocks.find((item) => item.locale === locale);
    localizedText[locale] = block?.text ?? renderInlineText(options.defaultText, options.segments, locale, options.defaultLocale);
  }

  const defaultText = localizedText[options.defaultLocale] || firstLocalizedText(localizedText) || compactWhitespace(options.defaultText);

  return {
    fieldPath: options.fieldPath,
    kind: options.kind,
    defaultLocale: options.defaultLocale,
    defaultText,
    source: options.source,
    localizedText,
    ...(options.blocks.length > 0 ? { blocks: options.blocks } : {}),
    ...(options.segments.length > 0 ? { segments: options.segments } : {}),
    resolutions: Object.fromEntries(Object.keys(localizedText).map((locale) => [
      locale,
      {
        requestedLocale: locale,
        resolvedLocale: locale,
        fallbackChain: fallbackChain(locale, options.defaultLocale),
        usedFallback: false,
        missing: false,
        sourceKind: options.blocks.some((block) => block.locale === locale) ? "lang-block" : "default-text",
        sourceLocale: locale,
        source: options.source
      }
    ])),
    missingLocales: []
  };
}

function parseInlineSegments(text, fieldPath) {
  const sourceText = String(text ?? "");
  const segments = [];
  const pattern = /<(lang|l)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = pattern.exec(sourceText))) {
    const localized = parseInlineLocalizedValues(match[3]);
    if (Object.keys(localized).length === 0) {
      continue;
    }
    const attributes = parseAttributes(match[2]);
    segments.push({
      kind: "lang-inline",
      id: `${fieldPath}.${segments.length}`,
      key: attributes.key ?? "",
      path: attributes.path ?? "",
      fieldPath,
      raw: match[0],
      localized,
      rangeInField: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  return segments;
}

function parseInlineLocalizedValues(innerText) {
  const localized = {};
  const pattern = /<([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = pattern.exec(innerText || ""))) {
    const locale = normalizeLocale(match[1]);
    const text = compactWhitespace(match[2]);
    if (locale && text) {
      localized[locale] = text;
    }
  }
  return localized;
}

function renderInlineText(text, segments, locale, defaultLocale) {
  let rendered = compactWhitespace(text);
  for (const segment of segments) {
    rendered = rendered.replace(segment.raw, resolveInlineLocalizedText(segment.localized, locale, defaultLocale));
  }
  return rendered;
}

function resolveInlineLocalizedText(localized, locale, defaultLocale) {
  return localized[locale]
    ?? localized[getParentLocale(locale)]
    ?? localized[defaultLocale]
    ?? firstLocalizedText(localized)
    ?? "";
}

function parseAttributes(rawAttributes) {
  const attributes = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(rawAttributes || ""))) {
    attributes[match[1]] = match[2] || match[3] || "";
  }
  return attributes;
}

function collectScriptSetupExposes(scriptSetupBlock, sourcePath) {
  if (!scriptSetupBlock) {
    return [];
  }
  const exposes = [];
  for (const match of scriptSetupBlock.content.matchAll(/\bdefineExpose\s*\(\s*\{([\s\S]*?)\}\s*\)/gu)) {
    const body = match[1] ?? "";
    const bodyStart = (match.index ?? 0) + match[0].indexOf(body);
    for (const property of parseObjectExposeProperties(body)) {
      exposes.push({
        name: property.exposedName,
        localName: property.localName,
        source: {
          path: sourcePath,
          range: rangeForContentOffset(scriptSetupBlock, bodyStart + property.offset, bodyStart + property.offset + property.length),
          rangeSource: "vue-compiler-macro",
          confidence: "high"
        }
      });
    }
  }
  return exposes;
}

function parseObjectExposeProperties(body) {
  const properties = [];
  const propertyPattern = /(?:^|,)\s*([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?/gu;
  for (const match of body.matchAll(propertyPattern)) {
    const exposedName = match[1];
    const localName = match[2] ?? exposedName;
    properties.push({
      exposedName,
      localName,
      offset: (match.index ?? 0) + match[0].indexOf(exposedName),
      length: exposedName.length
    });
  }
  return properties;
}

function sourceForAnnotation(annotation, sourcePath) {
  return {
    path: annotation?.source?.path ?? sourcePath,
    range: annotation?.source?.range ?? { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
    rangeSource: "vue-sfc-parser",
    confidence: annotation ? "medium" : "low"
  };
}

function findComponentName(annotations) {
  const annotation = annotations.find((item) => item.tag === "component");
  return firstWord(annotation?.value);
}

function componentNameFromPath(sourcePath) {
  const basename = sourcePath.split("/").pop()?.replace(/\.vue$/i, "") ?? "Component";
  return basename.replace(/(^|[-_])(\w)/g, (_, _prefix, character) => character.toUpperCase());
}

function bridgeTargetsForKind(kind) {
  if (kind.startsWith("css-")) {
    return ["cssdoc"];
  }
  if (kind.startsWith("html-")) {
    return ["htmdoc"];
  }
  return ["jsdoc"];
}

function languageForBlock(type) {
  if (type === "style") {
    return "css";
  }
  if (type === "script" || type === "scriptSetup") {
    return "javascript";
  }
  return "html";
}

/**
 * @lang zh-CN 保留 Vue 编译器已提供的一基行列位置；起点与排除式终点均不再次平移。
 * @lang en Preserves the Vue compiler's one-based line and column positions without shifting its start or exclusive end again.
 * @param {{start:{line:number,column:number},end:{line:number,column:number}}} loc <lang><zh-CN>Vue SFC block 的原始位置，含 UTF-16 字符串偏移。</zh-CN><en>Original Vue SFC block location with UTF-16 string offsets.</en></lang>
 * @returns {{start:{line:number,column:number},end:{line:number,column:number}}} <lang><zh-CN>与编译器原始范围同界的 HIA 行列范围。</zh-CN><en>HIA line-column range with the compiler's original boundaries.</en></lang>
 */
function rangeFromLoc(loc) {
  // <lang><zh-CN>编译器列号已是一基；只投影字段，避免非 BMP/相邻块的边界各向后偏一列。</zh-CN><en>Compiler columns are already one-based; project fields only so astral characters and adjacent blocks do not shift one column.</en></lang>
  return {
    start: {
      line: loc.start.line,
      column: loc.start.column
    },
    end: {
      line: loc.end.line,
      column: loc.end.column
    }
  };
}

function rangeForContentOffset(block, startOffset, endOffset) {
  return {
    start: positionForContentOffset(block, startOffset),
    end: positionForContentOffset(block, endOffset)
  };
}

function positionForContentOffset(block, offset) {
  const before = block.content.slice(0, Math.max(offset, 0));
  const lines = before.split(/\r?\n/);
  const lineOffset = lines.length - 1;
  return {
    line: block.loc.start.line + lineOffset,
    column: lineOffset === 0
      ? block.loc.start.column + lines.at(-1).length + 1
      : lines.at(-1).length + 1
  };
}

function sanitizeSourceMap(map) {
  if (!map) {
    return null;
  }
  const copy = JSON.parse(JSON.stringify(map));
  delete copy.sourcesContent;
  return copy;
}

function normalizePath(value) {
  const normalized = String(value).replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe Vue SFC path: ${value}`);
  }
  return normalized;
}

function firstWord(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean)[0] || null;
}

function restWords(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" ") : null;
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "unnamed";
}

function collectLocales(values) {
  return [...new Set(values.map((value) => normalizeLocale(value)).filter(Boolean))];
}

function normalizeLocale(value) {
  const locale = String(value ?? "").trim().replace(/_/g, "-");
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : "";
}

function getParentLocale(locale) {
  return String(locale).split("-")[0] || locale;
}

function fallbackChain(locale, defaultLocale) {
  const chain = collectLocales([locale, getParentLocale(locale), defaultLocale]);
  return chain.length > 0 ? chain : [DEFAULT_LOCALE];
}

function firstLocalizedText(localizedText) {
  return Object.values(localizedText).find((text) => typeof text === "string" && text.length > 0) ?? "";
}

function compactWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
