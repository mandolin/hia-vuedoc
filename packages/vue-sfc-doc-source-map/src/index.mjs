/** @file @lang zh-CN Vue单文件组件的文档语义映射，列表引用和可选字段遵守中性契约。 @lang en Vue single-file-component documentation maps with list references and optional fields following the neutral contract. */
import { VUEDOC_EXTRACTION_CONTRACT } from "@hia-doc/vuedoc-spec";

/**
 * @lang zh-CN 从已提取Vue工件和显式相对产物路径创建旧版映射；不读取普通map或源码正文。
 * @lang en Creates a legacy map from an extracted Vue artifact and explicit relative output paths, without reading ordinary maps or source bodies.
 * @param {object} options <lang><zh-CN>Vue工件、各文档路径及可选template/script/style和map路径。</zh-CN><en>Vue artifact, documentation paths and optional template/script/style/map paths.</en></lang>
 * @returns {object} <lang><zh-CN>被动manifest；mapsTo始终为列表，缺注释/选择器省略。</zh-CN><en>Passive manifest with list-valued mapsTo and absent annotations/selectors omitted.</en></lang>
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
    sourceMap("sourcemap:vue-template", templateMapPath, templatePath, sourceId, "javascript"),
    sourceMap("sourcemap:vue-script", scriptMapPath, scriptPath, sourceId, "javascript"),
    sourceMap("sourcemap:vue-style", styleMapPath, stylePath, sourceId, "css")
  ].filter(Boolean);

  return {
    contract: "doc-source-map",
    contractVersion: "0.1.0-draft",
    id: options.id ?? `docmap:vue-sfc:${slug(normalizedSourcePath)}`,
    producer: {
      name: "@hia-doc/vue-sfc-doc-source-map",
      version: "0.0.0",
      profile: "vue-sfc-bridge"
    },
    artifacts,
    sources: [
      {
        id: sourceId,
        kind: "framework-source",
        path: normalizedSourcePath,
        language: "vue",
        role: "original",
        sourcesContentPolicy: "none"
      }
    ],
    sourceMaps,
    chains: [
      {
        id: "chain:vue-sfc:document",
        stages: [
          {
            from: sourceId,
            to: "artifact:vue-template:render",
            transform: "@vue/compiler-sfc:compileTemplate",
            sourceMap: templateMapPath ? "sourcemap:vue-template" : null,
            linkage: vueArtifact.symbols.map((symbol) => entryIdForSymbol(symbol))
          },
          {
            from: sourceId,
            to: "artifact:vue-style:compiled",
            transform: "@vue/compiler-sfc:compileStyle",
            sourceMap: styleMapPath ? "sourcemap:vue-style" : null,
            linkage: vueArtifact.symbols.filter((symbol) => symbol.kind.startsWith("css-")).map((symbol) => entryIdForSymbol(symbol))
          },
          {
            from: "artifact:vuedoc:extraction",
            to: "artifact:hia:document",
            transform: "vuedoc-to-hia-core",
            sourceMap: null,
            linkage: vueArtifact.symbols.map((symbol) => entryIdForSymbol(symbol))
          }
        ]
      }
    ],
    entries: vueArtifact.symbols.map((symbol) => createSymbolEntry(symbol)),
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

/** @lang zh-CN 保留无注释符号但省略不存在的annotation字段。 @lang en Retains undocumented symbols while omitting absent annotation fields. */
function createSymbolEntry(symbol) {
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
        range: symbol.annotation?.source?.range ?? symbol.source.range,
        rangeSource: "vue-sfc-parser",
        confidence: symbol.source.confidence ?? "medium"
      }
    ],
    artifactRefs: [artifactRefForSymbol(symbol)],
    diagnostics: []
  };
}

/** @lang zh-CN 按符号领域选择产物引用，只在确有定位文本时写selector。 @lang en Selects the artifact by symbol domain and writes a selector only when location text exists. */
function artifactRefForSymbol(symbol) {
  if (symbol.kind.startsWith("css-")) {
    return {
      artifactId: "artifact:vue-style:compiled",
      ...(symbol.kind === "css-selector" && symbol.name ? { selector: symbol.name } : {}),
      rangeSource: "source-map",
      confidence: "medium"
    };
  }
  if (symbol.kind === "vue-exposed-api") {
    return {
      artifactId: "artifact:vue-script:compiled",
      rangeSource: "source-map",
      confidence: "medium"
    };
  }
  return {
    artifactId: "artifact:vue-template:render",
    ...(symbol.kind === "vue-component" ? { selector: `[data-component="${symbol.name}"]` } : {}),
    rangeSource: "source-map",
    confidence: "medium"
  };
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

/** @lang zh-CN 构造普通map声明；一个原始源也必须使用mapsTo引用列表。 @lang en Constructs an ordinary-map declaration; even one original source requires a mapsTo reference list. */
function sourceMap(id, mapPath, targetPath, sourceId, language) {
  if (!mapPath) {
    return null;
  }
  return {
    id,
    kind: "ordinary-source-map",
    path: normalizePath(mapPath),
    language,
    mapsFrom: sourceIdForPath(targetPath ?? mapPath),
    mapsTo: [sourceId]
  };
}

function sourceIdForPath(sourcePath) {
  return `source:vue:${slug(sourcePath)}`;
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
