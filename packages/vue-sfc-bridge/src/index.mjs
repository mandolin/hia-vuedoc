import { VUEDOC_EXTRACTION_CONTRACT } from "@hia-doc/vuedoc-spec";

const HIA_CORE_SCHEMA_VERSION = "0.2.0";
const HIA_SOURCE_MODEL = "hia-source";
const HIA_SOURCE_MODEL_VERSION = "0.2.0";
/** @lang zh-CN 单独调用桥接器时默认链接当前新版映射；调用方可传入实际映射版本。 @lang en Standalone bridge calls default to the current map version; callers may supply the actual map version. */
const DEFAULT_DOC_SOURCE_MAP_CONTRACT_VERSION = "1.1.0";

export function vueDocToHtmlExtraction(vueArtifact, options = {}) {
  assertVueDocArtifact(vueArtifact);
  const templatePath = normalizePath(options.templatePath ?? vueArtifact.source.path);
  const defaultLocale = options.defaultLocale ?? vueArtifact.defaultLocale ?? "en";
  const symbols = vueArtifact.symbols
    .filter((symbol) => symbol.kind === "vue-component" || symbol.kind.startsWith("html-"))
    .map((symbol) => ({
      id: symbol.id,
      kind: symbol.kind === "vue-component" ? "html-component" : symbol.kind,
      name: symbol.name,
      parentId: symbol.parentId,
      summary: symbol.i18n?.fields?.description?.defaultText ?? symbol.summary,
      source: {
        path: vueArtifact.source.path,
        range: symbol.source.range,
        rangeSource: symbol.source.rangeSource,
        confidence: symbol.source.confidence
      },
      annotation: symbol.annotation,
      ...(symbol.i18n ? { i18n: symbol.i18n } : {}),
      metadata: {
        bridge: "vue-sfc-htmdoc",
        vueSymbolKind: symbol.kind,
        templateArtifact: templatePath
      }
    }));

  return {
    contract: "hia-htmdoc-extraction",
    contractVersion: "0.1.0-draft",
    producer: {
      name: "@hia-doc/vue-sfc-bridge",
      version: "0.0.0"
    },
    profile: {
      name: "vue-sfc-htmdoc-bridge",
      version: "0.1.0-draft"
    },
    defaultLocale,
    locales: collectDocumentLocales(options.locales, vueArtifact.locales, symbols, defaultLocale),
    source: {
      kind: "vue-template",
      path: vueArtifact.source.path
    },
    symbols,
    annotations: vueArtifact.annotations.filter((annotation) => annotation.source.blockType === "template"),
    diagnostics: vueArtifact.diagnostics ?? [],
    sourceMap: {
      kind: "hia-doc-source-map-ref",
      href: options.docSourceMapPath ?? null,
      sourcesContentPolicy: "none"
    },
    metadata: {
      sourceContract: vueArtifact.contract,
      bridgeBoundary: "framework-adapter"
    }
  };
}

/**
 * @lang zh-CN 将现有Vue样式子集投影为CSS提取1.0.0与配对profile，不改变原Vue工件或HTM桥接身份。
 * @lang en Projects the existing Vue style subset into CSS extraction1.0.0 and its paired profile without changing the Vue artifact or HTML bridge identity.
 * @param {object} vueArtifact <lang><zh-CN>已支持的Vue提取对象。</zh-CN><en>Supported Vue extraction object.</en></lang>
 * @param {object} [options] <lang><zh-CN>样式路径与语言覆写。</zh-CN><en>Style path and locale overrides.</en></lang>
 * @returns {object} <lang><zh-CN>新CSS对象，省略未定义可选字段，嵌套i18n/annotation仍共享；无I/O。</zh-CN><en>Fresh CSS object omitting undefined optionals, with shared nested i18n/annotation and no I/O.</en></lang>
 * @throws {Error} <lang><zh-CN>不支持的Vue工件或路径。</zh-CN><en>Unsupported Vue artifact or path.</en></lang>
 */
export function vueDocToCssExtraction(vueArtifact, options = {}) {
  assertVueDocArtifact(vueArtifact);
  // <lang><zh-CN>样式定位只规范化字符串，不读取生成文件。</zh-CN><en>The style locator only normalizes a string without reading generated files.</en></lang>
  const stylePath = normalizePath(options.stylePath ?? vueArtifact.source.path);
  // <lang><zh-CN>显式语言优先于已提取默认；不会重新解析注释。</zh-CN><en>Explicit locale precedes the extracted default without reparsing comments.</en></lang>
  const defaultLocale = options.defaultLocale ?? vueArtifact.defaultLocale ?? "en";
  // <lang><zh-CN>仅现有css-*节点参与桥接，缺省字段不写undefined以符合真实JSON契约。</zh-CN><en>Bridge existing css-* nodes only, omitting undefined fields to satisfy the real JSON contract.</en></lang>
  const symbols = vueArtifact.symbols
    .filter((symbol) => symbol.kind.startsWith("css-"))
    .map((symbol) => ({
      id: symbol.id,
      kind: symbol.kind,
      name: symbol.name,
      ...(symbol.parentId === undefined ? {} : { parentId: symbol.parentId }),
      ...((symbol.i18n?.fields?.description?.defaultText ?? symbol.summary) === undefined ? {} : { summary: symbol.i18n?.fields?.description?.defaultText ?? symbol.summary }),
      source: {
        path: vueArtifact.source.path,
        range: symbol.source.range,
        rangeSource: symbol.source.rangeSource,
        confidence: symbol.source.confidence
      },
      ...(symbol.annotation === undefined ? {} : { annotation: symbol.annotation }),
      ...(symbol.i18n ? { i18n: symbol.i18n } : {}),
      metadata: {
        bridge: "vue-sfc-cssdoc",
        styleArtifact: stylePath
      }
    }));

  return {
    contract: "hia-cssdoc-extraction",
    contractVersion: "1.0.0",
    producer: {
      name: "@hia-doc/vue-sfc-bridge",
      version: "0.0.0"
    },
    profile: {
      name: "vue-sfc-cssdoc-bridge",
      version: "1.0.0"
    },
    defaultLocale,
    locales: collectDocumentLocales(options.locales, vueArtifact.locales, symbols, defaultLocale),
    source: {
      kind: "vue-style",
      path: vueArtifact.source.path
    },
    symbols,
    annotations: vueArtifact.annotations.filter((annotation) => annotation.source.blockType === "style"),
    diagnostics: vueArtifact.diagnostics ?? [],
    sourceMap: {
      kind: "hia-doc-source-map-ref",
      href: options.docSourceMapPath ?? null,
      sourcesContentPolicy: "none"
    },
    metadata: {
      sourceContract: vueArtifact.contract,
      bridgeBoundary: "framework-adapter"
    }
  };
}

/**
 * @lang zh-CN 将 VueDoc 提取件投影为 HIA 文档；只有确有映射路径时才写链接及其实际契约版本。
 * @lang en Projects VueDoc extraction to an HIA document, writing a link and its actual contract version only when a map path exists.
 * @param {object} vueArtifact <lang><zh-CN>VueDoc 提取件。</zh-CN><en>VueDoc extraction artifact.</en></lang>
 * @param {object} [options] <lang><zh-CN>文档身份、标题、本地化和可选映射路径/版本。</zh-CN><en>Document identity, title, locales and optional map path/version.</en></lang>
 * @returns {object} <lang><zh-CN>带可选源码映射元数据的 HIA 文档。</zh-CN><en>HIA document with optional source-map metadata.</en></lang>
 */
export function vueDocToHiaDocument(vueArtifact, options = {}) {
  assertVueDocArtifact(vueArtifact);
  const title = options.title ?? "Vue SFC Document";
  const symbols = vueArtifact.symbols.map((symbol) => mapVueSymbol(symbol));
  const defaultLocale = options.defaultLocale ?? vueArtifact.defaultLocale ?? "en";

  return {
    schemaVersion: HIA_CORE_SCHEMA_VERSION,
    id: options.id ?? `vuedoc:${vueArtifact.source.path}`,
    title,
    defaultLocale,
    locales: collectDocumentLocales(options.locales, vueArtifact.locales, symbols, defaultLocale),
    nodes: [
      {
        id: "root",
        kind: "root",
        title,
        symbolIds: symbols.map((symbol) => symbol.id)
      }
    ],
    symbols,
    diagnostics: vueArtifact.diagnostics ?? [],
    metadata: {
      sourceContract: vueArtifact.contract,
      sourceContractVersion: vueArtifact.contractVersion,
      producer: vueArtifact.producer,
      bridgeBoundary: "framework-adapter",
      docSourceMaps: options.docSourceMapPath
        ? [
            {
              contract: "doc-source-map",
              contractVersion: options.docSourceMapContractVersion ?? DEFAULT_DOC_SOURCE_MAP_CONTRACT_VERSION,
              path: options.docSourceMapPath,
              entryArtifact: options.entryArtifact ?? null
            }
          ]
        : []
    }
  };
}

export function assertVueDocArtifact(artifact) {
  if (!artifact || artifact.contract !== VUEDOC_EXTRACTION_CONTRACT) {
    throw new Error(`Expected ${VUEDOC_EXTRACTION_CONTRACT} artifact.`);
  }
  if (!Array.isArray(artifact.symbols)) {
    throw new Error("VueDoc extraction artifact must contain symbols array.");
  }
}

function mapVueSymbol(symbol) {
  const mapped = {
    id: symbol.id,
    name: symbol.name,
    kind: coreKindForSymbol(symbol),
    parentId: symbol.parentId,
    summary: symbol.i18n?.fields?.description?.defaultText ?? symbol.summary,
    source: {
      model: HIA_SOURCE_MODEL,
      modelVersion: HIA_SOURCE_MODEL_VERSION,
      mode: "link",
      definedIn: {
        kind: "defined-in",
        relativePath: symbol.source?.path ?? "Component.vue",
        language: "vue",
        position: symbol.source?.range?.start ?? { line: 1, column: 1 },
        range: symbol.source?.range,
        link: {
          enabled: false,
          openMode: "same-tab"
        }
      },
      primaryBlock: null,
      references: [],
      fragments: [],
      diagnostics: []
    },
    diagnostics: symbol.diagnostics ?? [],
    metadata: {
      vuedoc: {
        vueSymbolKind: symbol.kind,
        annotation: symbol.annotation ?? null,
        bridgeTargets: symbol.metadata?.bridgeTargets ?? [],
        macro: symbol.metadata?.macro ?? null,
        localName: symbol.metadata?.localName ?? null
      }
    }
  };
  if (symbol.i18n) {
    mapped.i18n = symbol.i18n;
  }
  return mapped;
}

function coreKindForSymbol(symbol) {
  if (symbol.kind === "vue-component") {
    return "html-component";
  }
  return symbol.kind;
}

function normalizePath(value) {
  const normalized = String(value).replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe Vue bridge path: ${value}`);
  }
  return normalized;
}

function collectDocumentLocales(optionLocales, artifactLocales, symbols, defaultLocale) {
  const locales = [
    defaultLocale,
    ...(Array.isArray(optionLocales) ? optionLocales : []),
    ...(Array.isArray(artifactLocales) ? artifactLocales : [])
  ];
  for (const symbol of symbols) {
    locales.push(...(Array.isArray(symbol.i18n?.locales) ? symbol.i18n.locales : []));
  }
  return [...new Set(locales.map((locale) => normalizeLocale(locale)).filter(Boolean))];
}

function normalizeLocale(value) {
  const locale = String(value ?? "").trim().replace(/_/g, "-");
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : "";
}
