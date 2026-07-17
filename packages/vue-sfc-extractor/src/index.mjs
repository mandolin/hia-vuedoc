import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";
import {
  VUEDOC_EXTRACTION_CONTRACT,
  VUEDOC_EXTRACTION_CONTRACT_VERSION,
  VUEDOC_PROFILE_VERSION,
  getVueDocSymbolKind,
  isVueDocTag
} from "@hia-doc/vuedoc-spec";

const DEFAULT_COMPONENT_ID = "hia-vuedoc-sfc";

export function extractVueSfc(sourceText, options = {}) {
  const sourcePath = normalizePath(options.path ?? "src/Component.vue");
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
  const symbols = createSymbols(annotations, componentName, sourcePath, scriptSetupExposes);

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

function createSymbols(annotations, componentName, sourcePath, scriptSetupExposes) {
  const componentId = `component:${componentName}`;
  const symbols = [];
  const componentAnnotation = annotations.find((annotation) => annotation.tag === "component");
  symbols.push({
    id: componentId,
    kind: "vue-component",
    bridgeKinds: ["html-component"],
    name: firstWord(componentAnnotation?.value) ?? componentName,
    summary: restWords(componentAnnotation?.value) ?? "Vue SFC component.",
    source: sourceForAnnotation(componentAnnotation, sourcePath),
    annotation: componentAnnotation ?? null,
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
    symbols.push({
      id: `${annotation.tag}:${slug(componentName)}:${slug(name)}`,
      kind,
      name,
      parentId: componentId,
      summary: restWords(annotation.value) ?? "",
      source: sourceForAnnotation(annotation, sourcePath),
      annotation,
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

function rangeFromLoc(loc) {
  return {
    start: {
      line: loc.start.line,
      column: loc.start.column + 1
    },
    end: {
      line: loc.end.line,
      column: loc.end.column + 1
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
