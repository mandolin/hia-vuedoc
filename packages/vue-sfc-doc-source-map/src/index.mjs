/** @file @lang zh-CN Vue单文件组件的文档语义映射，列表引用和可选字段遵守中性契约。 @lang en Vue single-file-component documentation maps with list references and optional fields following the neutral contract. */
import { VUEDOC_EXTRACTION_CONTRACT, VUEDOC_EXTRACTION_CONTRACT_VERSION } from "@hia-doc/vuedoc-spec";

/** @lang zh-CN 当前 Vue 写入器的文档源码映射契约身份；包版本独立。 @lang en Current Vue writer's documentation source-map contract identity, independent of the package version. */
export const VUE_SFC_DOC_SOURCE_MAP_CONTRACT_VERSION = "1.1.0";

/** @lang zh-CN 实测模板块的排除终点和 UTF-16 列。 @lang en Measured template-block exclusive end and UTF-16 columns. */
const TEMPLATE_RANGE_CONVENTION = Object.freeze({ endBoundary: "exclusive", columnUnit: "utf16-code-unit" });

/** @lang zh-CN 未测分支与人工占位只保留来源线索。 @lang en Unmeasured branches and artificial placeholders retain provenance only. */
const UNKNOWN_RANGE_CONVENTION = Object.freeze({ endBoundary: "unknown", columnUnit: "unknown" });

/**
 * @lang zh-CN 从已提取 Vue 工件创建 `doc-source-map@1.1.0`；仅实测模板块声明精确范围，不读取普通 map 或源码正文。
 * @lang en Creates `doc-source-map@1.1.0` from an extracted Vue artifact; only measured template blocks get exact ranges, without reading ordinary maps or source bodies.
 * @param {object} options <lang><zh-CN>Vue工件、各文档路径及可选template/script/style和map路径。</zh-CN><en>Vue artifact, documentation paths and optional template/script/style/map paths.</en></lang>
 * @returns {object} <lang><zh-CN>逐引用声明已证或未知边界的被动 manifest；mapsTo 始终为列表。</zh-CN><en>Passive manifest with proven or unknown bounds per reference and list-valued mapsTo.</en></lang>
 */
export function createVueSfcDocSourceMap(options) {
  const {
    vueArtifact,
    vueDocPath,
    htmDocPath,
    cssDocPath,
    hiaDocumentPath,
    templatePath,
    templateMapPath,
    scriptPath,
    scriptMapPath,
    stylePath,
    styleMapPath
  } = options ?? {};

  assertVueDocArtifact(vueArtifact);
  const normalizedSourcePath = normalizePath(vueArtifact.source.path);
  const sourceId = sourceIdForPath(normalizedSourcePath);
  // <lang><zh-CN>当前 Vue 链只表示单文件来源；异源符号不能偷偷挂到主源的生成边，须单独设计多源链后接入。</zh-CN><en>The current Vue chain represents one input file; a foreign symbol cannot silently inherit the primary source's generated stages before a multi-source chain is designed.</en></lang>
  if (vueArtifact.symbols.some((symbol) => normalizePath(symbol.source.path) !== normalizedSourcePath)) {
    throw new Error("Vue map symbol source path differs from primary source.");
  }
  const artifacts = [
    artifact("artifact:vuedoc:extraction", "extraction-artifact", vueDocPath, "json", VUEDOC_EXTRACTION_CONTRACT),
    artifact("artifact:htmdoc:bridge", "extraction-artifact", htmDocPath, "json", "hia-htmdoc-extraction"),
    artifact("artifact:cssdoc:bridge", "extraction-artifact", cssDocPath, "json", "hia-cssdoc-extraction"),
    artifact("artifact:hia:document", "extraction-artifact", hiaDocumentPath, "json", "hia-core-document")
  ];
  if (templatePath) {
    artifacts.push(artifact("artifact:vue-template:render", "generated-js", templatePath, "javascript"));
  }
  if (scriptPath) {
    artifacts.push(artifact("artifact:vue-script:compiled", "generated-js", scriptPath, "javascript"));
  }
  if (stylePath) {
    artifacts.push(artifact("artifact:vue-style:compiled", "generated-css", stylePath, "css"));
  }

  const sourceMaps = [
    sourceMap("sourcemap:vue-template", templateMapPath, templatePath, "artifact:vue-template:render", sourceId, "javascript"),
    sourceMap("sourcemap:vue-script", scriptMapPath, scriptPath, "artifact:vue-script:compiled", sourceId, "javascript"),
    sourceMap("sourcemap:vue-style", styleMapPath, stylePath, "artifact:vue-style:compiled", sourceId, "css")
  ].filter(Boolean);

  // <lang><zh-CN>生成边只在对应输出存在时声明；提取与 HIA 文档边始终存在。</zh-CN><en>Declare generated stages only when their outputs exist; extraction and HIA-document stages always exist.</en></lang>
  const stages = [{
    from: sourceId,
    to: "artifact:vuedoc:extraction",
    transform: "vue-sfc-to-vuedoc",
    sourceMap: null,
    linkage: vueArtifact.symbols.map((symbol) => entryIdForSymbol(symbol))
  }];
  if (templatePath) {
    stages.push({
      from: sourceId,
      to: "artifact:vue-template:render",
      transform: "@vue/compiler-sfc:compileTemplate",
      sourceMap: templateMapPath ? "sourcemap:vue-template" : null,
      // <lang><zh-CN>生成边按注释所在块归属；无注释组件仍是模板级回退。</zh-CN><en>A generated stage follows the annotation's actual block; an undocumented component remains a template-level fallback.</en></lang>
      linkage: vueArtifact.symbols.filter((symbol) => symbol.annotation?.source?.blockType === "template" || (symbol.kind === "vue-component" && !symbol.annotation)).map((symbol) => entryIdForSymbol(symbol))
    });
  }
  if (scriptPath) {
    stages.push({
      from: sourceId,
      to: "artifact:vue-script:compiled",
      transform: "@vue/compiler-sfc:compileScript",
      sourceMap: scriptMapPath ? "sourcemap:vue-script" : null,
      linkage: vueArtifact.symbols.filter((symbol) => ["script", "scriptSetup"].includes(symbol.annotation?.source?.blockType) || (symbol.kind === "vue-exposed-api" && !symbol.annotation)).map((symbol) => entryIdForSymbol(symbol))
    });
  }
  if (stylePath) {
    stages.push({
      from: sourceId,
      to: "artifact:vue-style:compiled",
      transform: "@vue/compiler-sfc:compileStyle",
      sourceMap: styleMapPath ? "sourcemap:vue-style" : null,
      linkage: vueArtifact.symbols.filter((symbol) => symbol.annotation?.source?.blockType === "style").map((symbol) => entryIdForSymbol(symbol))
    });
  }
  stages.push({
    from: "artifact:vuedoc:extraction",
    to: "artifact:hia:document",
    transform: "vuedoc-to-hia-core",
    sourceMap: null,
    linkage: vueArtifact.symbols.map((symbol) => entryIdForSymbol(symbol))
  });

  return {
    contract: "doc-source-map",
    contractVersion: VUE_SFC_DOC_SOURCE_MAP_CONTRACT_VERSION,
    id: options.id ?? `docmap:vue-sfc:${slug(normalizedSourcePath)}`,
    producer: {
      name: "@hia-doc/vue-sfc-doc-source-map",
      version: "0.0.0",
      profile: "vue-sfc-bridge"
    },
    artifacts,
    sources: [{
      id: sourceId,
      kind: "framework-source",
      path: normalizedSourcePath,
      language: "vue",
      role: "original",
      sourcesContentPolicy: "none"
    }],
    sourceMaps,
    chains: [
      {
        id: "chain:vue-sfc:document",
        stages
      }
    ],
    entries: vueArtifact.symbols.map((symbol, index) => createSymbolEntry(symbol, index, vueArtifact, { templatePath, scriptPath, stylePath })),
    privacy: {
      sourcesContentPolicy: "none",
      allowAbsolutePaths: false,
      allowUncPaths: false,
      allowPathTraversal: false,
      releaseGate: {
        requireExplicitEmbedOptIn: true,
        failOnUnsafePath: true,
        failOnUnexpectedSourcesContent: true
      }
    },
    diagnostics: [
      {
        code: "VUE_SFC_BRIDGE_SPIKE",
        severity: "info",
        message: "Vue SFC P1 is modeled as a framework bridge; Vue-specific semantics stay out of HTMDoc/CSSDoc core.",
        data: {
          bridgeBoundary: "framework-adapter"
        }
      }
    ]
  };
}

/**
 * @lang zh-CN 按单个符号的实际来源声明范围约定，保留无注释符号且不制造缺失的 annotation。
 * @lang en Declares range convention from each symbol's actual origin, retaining undocumented symbols without inventing annotations.
 * @param {object} symbol <lang><zh-CN>提取符号，可能来自注释、宏或人工回退。</zh-CN><en>Extracted symbol from an annotation, macro or artificial fallback.</en></lang>
 * @param {number} index <lang><zh-CN>符号在提取件中的稳定数组索引。</zh-CN><en>Stable symbol array index in the extraction artifact.</en></lang>
 * @param {object} vueArtifact <lang><zh-CN>用于核对生产者、块身份及解析诊断的提取工件。</zh-CN><en>Extraction artifact used to verify producer, block identity and parse diagnostics.</en></lang>
 * @param {object} outputPaths <lang><zh-CN>实际存在的可选生成产物路径。</zh-CN><en>Paths of optional generated outputs that actually exist.</en></lang>
 * @returns {object} <lang><zh-CN>带被动来源与产物引用的映射条目。</zh-CN><en>Map entry with passive source and artifact references.</en></lang>
 */
function createSymbolEntry(symbol, index, vueArtifact, outputPaths) {
  // <lang><zh-CN>注释优先保留原块范围；宏与人工占位读取符号自身范围，各自独立判断精度。</zh-CN><en>Prefer the annotation block range; macro and placeholder use their symbol ranges with independent precision checks.</en></lang>
  const range = symbol.annotation?.source?.range ?? symbol.source?.range;
  const provenance = sourceProvenance(vueArtifact, symbol);
  const knownTemplate = provenTemplateRange(vueArtifact, symbol, range);
  return {
    id: entryIdForSymbol(symbol),
    kind: "symbol",
    symbolKind: symbol.kind,
    symbolId: symbol.id,
    ...(symbol.annotation ? { annotation: {
          tag: symbol.annotation.tag,
          value: symbol.annotation.value
        } } : {}),
    sourceRefs: [
      {
        sourceId: sourceIdForPath(symbol.source.path),
        ...(range ? {
          range: { start: { ...range.start }, end: { ...range.end } },
          rangeConvention: knownTemplate
            ? { ...TEMPLATE_RANGE_CONVENTION }
            : { ...UNKNOWN_RANGE_CONVENTION }
        } : {}),
        rangeSource: provenance.rangeSource,
        rangeSourceDetail: provenance.rangeSourceDetail,
        confidence: knownTemplate
          ? symbol.source.confidence ?? "medium"
          : provenance.rangeSource === "unresolved" ? "none" : "low"
      }
    ],
    artifactRefs: [artifactRefForSymbol(symbol, index, outputPaths)],
    diagnostics: []
  };
}

/**
 * @lang zh-CN 将提取器的具体来源名映射到七类公共机制；仅输出固定的公开安全细节，不复制外来名称。
 * @lang en Maps extractor-specific origins to the seven common mechanisms; emits only fixed public-safe details instead of copying external names.
 * @param {object} artifact <lang><zh-CN>提取工件及其生产者。</zh-CN><en>Extraction artifact and its producer.</en></lang>
 * @param {object} symbol <lang><zh-CN>带原始来源标签的符号。</zh-CN><en>Symbol with its original origin label.</en></lang>
 * @returns {{rangeSource:string,rangeSourceDetail:string}} <lang><zh-CN>结构化来源类别与具体细节。</zh-CN><en>Structured origin mechanism and specific detail.</en></lang>
 */
function sourceProvenance(artifact, symbol) {
  // <lang><zh-CN>外来工件的自报名称可能是私有路径或账号信息；只保留固定的适配器类别。</zh-CN><en>A foreign artifact's self-reported name may contain a private path or account data; retain only a fixed adapter category.</en></lang>
  if (artifact.producer?.name !== "@hia-doc/vue-sfc-extractor") {
    return { rangeSource: "adapter", rangeSourceDetail: "external-vue-artifact" };
  }
  if (symbol.kind === "vue-component" && !symbol.annotation && symbol.source?.confidence === "low") {
    return { rangeSource: "heuristic", rangeSourceDetail: "vue-component-fallback" };
  }
  if (symbol.source?.rangeSource === "vue-compiler-macro") {
    return { rangeSource: "heuristic", rangeSourceDetail: "vue-compiler-macro" };
  }
  if (symbol.source?.rangeSource === "vue-sfc-parser") {
    return { rangeSource: "parser", rangeSourceDetail: "vue-sfc-parser" };
  }
  // <lang><zh-CN>未知标签同样不能原样进入公开工件，即使工件自报了本地生产者名称。</zh-CN><en>An unknown label also must not enter the public artifact verbatim, even when the artifact claims the local producer name.</en></lang>
  return { rangeSource: "unresolved", rangeSourceDetail: "unrecognized-vue-source" };
}

/**
 * @lang zh-CN 只接受本提取器无错误的 compiler-sfc 模板注释块；一致的块身份与坐标是已测语义的适用条件。
 * @lang en Accepts only error-free compiler-sfc template annotations from this extractor; matching block identity and coordinates scope the measured semantics.
 * @param {object} artifact <lang><zh-CN>Vue 提取件。</zh-CN><en>Vue extraction artifact.</en></lang>
 * @param {object} symbol <lang><zh-CN>候选符号。</zh-CN><en>Candidate symbol.</en></lang>
 * @param {object} range <lang><zh-CN>将写入来源引用的范围。</zh-CN><en>Range to write into the source reference.</en></lang>
 * @returns {boolean} <lang><zh-CN>仅在实测模板块条件全部满足时为真。</zh-CN><en>True only when all measured template-block conditions hold.</en></lang>
 */
function provenTemplateRange(artifact, symbol, range) {
  // <lang><zh-CN>契约名并非精度证明；同时核生产者版本、编译器和解析错误，以免外来 adapter 继承本地样本结论。</zh-CN><en>A contract name alone proves no precision; check producer version, compiler and parse errors so external adapters do not inherit local evidence.</en></lang>
  if (artifact.contractVersion !== VUEDOC_EXTRACTION_CONTRACT_VERSION
    || artifact.producer?.name !== "@hia-doc/vue-sfc-extractor"
    || artifact.producer?.compiler !== "@vue/compiler-sfc"
    || (Array.isArray(artifact.diagnostics) && artifact.diagnostics.some((diagnostic) => diagnostic?.severity === "error"))
    || symbol.annotation?.source?.blockType !== "template"
    || symbol.source?.rangeSource !== "vue-sfc-parser"
    || symbol.source?.path !== artifact.source?.path
    || !hasCompleteColumns(range)) {
    return false;
  }

  // <lang><zh-CN>只认与提取件模板块一致的注释范围；脚本、样式、宏和合成点均不能通过此条件。</zh-CN><en>Only an annotation range matching the extracted template block qualifies; script, style, macro and synthetic points cannot pass.</en></lang>
  return Array.isArray(artifact.blocks) && artifact.blocks.some((block) => block.type === "template"
    && block.id === symbol.annotation.source.blockId
    && block.path === symbol.annotation.source.path
    && block.path === symbol.source.path
    && sameRange(block.range, range));
}

/** @lang zh-CN 判断两端行列是否都有有效的一基 UTF-16 计数位置。 @lang en Checks that both endpoints have valid one-based line and column positions. */
function hasCompleteColumns(range) {
  return [range?.start?.line, range?.start?.column, range?.end?.line, range?.end?.column]
    .every((value) => Number.isSafeInteger(value) && value > 0);
}

/** @lang zh-CN 核对符号来源范围与其模板块的四个端点数值。 @lang en Compares all four endpoint numbers of a symbol source range and its template block. */
function sameRange(left, right) {
  return hasCompleteColumns(left) && hasCompleteColumns(right)
    && left.start.line === right.start.line && left.start.column === right.start.column
    && left.end.line === right.end.line && left.end.column === right.end.column;
}

/**
 * @lang zh-CN 仅引用实际存在的生成产物；缺少可选输出时退回精确的提取符号索引。
 * @lang en References only existing generated artifacts, falling back to the exact extracted-symbol index when an optional output is absent.
 * @param {object} symbol <lang><zh-CN>Vue 提取符号。</zh-CN><en>Vue extraction symbol.</en></lang>
 * @param {number} index <lang><zh-CN>提取数组索引。</zh-CN><en>Extraction array index.</en></lang>
 * @param {object} outputPaths <lang><zh-CN>实际可用的模板、脚本和样式路径。</zh-CN><en>Actually available template, script and style paths.</en></lang>
 * @returns {object} <lang><zh-CN>不悬空的产物引用。</zh-CN><en>Non-dangling artifact reference.</en></lang>
 */
function artifactRefForSymbol(symbol, index, outputPaths) {
  // <lang><zh-CN>产物引用与生成链用同一块身份，避免把脚本注释放到模板或样式输出；缺失对应输出时退回提取符号。</zh-CN><en>Artifact references and stages use the same block identity, avoiding script comments being assigned to template or style output; missing output falls back to the extracted symbol.</en></lang>
  const blockType = symbol.annotation?.source?.blockType;
  if (blockType === "style" && outputPaths.stylePath) {
    return {
      artifactId: "artifact:vue-style:compiled",
      ...(symbol.kind === "css-selector" && symbol.name ? { selector: symbol.name } : {}),
      rangeSource: "source-map",
      confidence: "medium"
    };
  }
  if ((["script", "scriptSetup"].includes(blockType) || (symbol.kind === "vue-exposed-api" && !symbol.annotation)) && outputPaths.scriptPath) {
    return {
      artifactId: "artifact:vue-script:compiled",
      rangeSource: "source-map",
      confidence: "medium"
    };
  }
  if ((blockType === "template" || (symbol.kind === "vue-component" && !symbol.annotation)) && outputPaths.templatePath) {
    return {
      artifactId: "artifact:vue-template:render",
      ...(symbol.kind === "vue-component" ? { selector: `[data-component="${symbol.name}"]` } : {}),
      rangeSource: "source-map",
      confidence: "medium"
    };
  }
  return { artifactId: "artifact:vuedoc:extraction", selector: `/symbols/${index}`, rangeSource: "adapter", confidence: "high" };
}

function artifact(id, kind, artifactPath, language, contract) {
  const normalized = normalizePath(artifactPath);
  return {
    id,
    kind,
    path: normalized,
    language,
    role: "generated",
    ...(contract ? { contractRefs: [{ contract, path: normalized }] } : {})
  };
}

/**
 * @lang zh-CN 构造普通 map 声明；mapsFrom 指向真实生成产物身份，一个原始源也使用 mapsTo 列表。
 * @lang en Constructs an ordinary-map declaration with mapsFrom pointing to an actual generated artifact and list-valued mapsTo even for one source.
 * @param {string} id <lang><zh-CN>普通映射身份。</zh-CN><en>Ordinary-map identity.</en></lang>
 * @param {string|undefined} mapPath <lang><zh-CN>可选映射路径。</zh-CN><en>Optional map path.</en></lang>
 * @param {string|undefined} targetPath <lang><zh-CN>对应生成产物路径。</zh-CN><en>Corresponding generated artifact path.</en></lang>
 * @param {string} targetArtifactId <lang><zh-CN>对应生成产物身份。</zh-CN><en>Corresponding generated artifact identity.</en></lang>
 * @param {string} sourceId <lang><zh-CN>原始 Vue 源身份。</zh-CN><en>Original Vue source identity.</en></lang>
 * @param {string} language <lang><zh-CN>映射语言。</zh-CN><en>Map language.</en></lang>
 * @returns {object|null} <lang><zh-CN>可追溯的普通映射，或无映射时为空。</zh-CN><en>Traceable ordinary map, or null when absent.</en></lang>
 */
function sourceMap(id, mapPath, targetPath, targetArtifactId, sourceId, language) {
  if (!mapPath) {
    return null;
  }
  if (!targetPath) {
    throw new Error(`Vue source map requires a generated target path: ${id}`);
  }
  return {
    id,
    kind: "ordinary-source-map",
    path: normalizePath(mapPath),
    language,
    mapsFrom: targetArtifactId,
    mapsTo: [sourceId]
  };
}

function sourceIdForPath(sourcePath) {
  return `source:vue:${slug(normalizePath(sourcePath))}`;
}

function entryIdForSymbol(symbol) {
  return `entry:${slug(symbol.id)}`;
}

function assertVueDocArtifact(artifactToCheck) {
  if (!artifactToCheck || artifactToCheck.contract !== VUEDOC_EXTRACTION_CONTRACT) {
    throw new Error(`Expected ${VUEDOC_EXTRACTION_CONTRACT} artifact.`);
  }
}

function normalizePath(value) {
  const normalized = String(value).replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe doc-source-map path: ${value}`);
  }
  return normalized;
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "unnamed";
}
