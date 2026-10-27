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

export function extractVueSfc(sourceText, options = {}) {
  const sourcePath = normalizePath(options.path ?? "src/Component.vue");
  const defaultLocale = normalizeLocale(options.defaultLocale) || DEFAULT_LOCALE;
  const filename = options.filename ?? sourcePath;
  const parsed = parse(sourceText, {
    filename,
    sourceMap: true
  });
  const descriptor = parsed.descriptor;
  const blocks = collectBlocks(descriptor, sourcePath);
  const annotations = blocks.flatMap((block) => extractAnnotationsFromBlock(block, sourceText));
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

function collectBlocks(descriptor, sourcePath) {
  const result = [];
  pushBlock(result, "template", descriptor.template, sourcePath, 0);
  pushBlock(result, "script", descriptor.script, sourcePath, 0);
  pushBlock(result, "scriptSetup", descriptor.scriptSetup, sourcePath, 0);
  descriptor.styles.forEach((block, index) => pushBlock(result, "style", block, sourcePath, index));
  descriptor.customBlocks.forEach((block, index) => pushBlock(result, "custom", block, sourcePath, index));
  return result;
}

function pushBlock(result, type, block, sourcePath, index) {
  if (!block) {
    return;
  }
  result.push({
    id: `block:${type}:${index}`,
    type,
    index,
    path: sourcePath,
    language: block.lang ?? languageForBlock(type),
    range: rangeFromLoc(block.loc),
    attrs: block.attrs ?? {},
    scoped: Boolean(block.scoped),
    hasSourceMap: Boolean(block.map)
  });
}

function extractAnnotationsFromBlock(block, sourceText) {
  const text = sliceRange(sourceText, block.range);
  const commentBodies = collectCommentBodies(text, block.type);
  return commentBodies.flatMap((comment) => parseAnnotationBlock(comment.body, block, comment.offset));
}

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

function sliceRange(text, range) {
  const lines = text.split(/\r?\n/);
  const startLine = Math.max(range.start.line - 1, 0);
  const endLine = Math.max(range.end.line - 1, startLine);
  return lines.slice(startLine, endLine + 1).join("\n");
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
