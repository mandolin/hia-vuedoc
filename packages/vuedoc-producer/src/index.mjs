import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { vueDocToCssExtraction, vueDocToHiaDocument, vueDocToHtmlExtraction } from "@hia-doc/vue-sfc-bridge";
import { createVueSfcDocSourceMap } from "@hia-doc/vue-sfc-doc-source-map";
import { compileVueSfc, extractVueSfc } from "@hia-doc/vue-sfc-extractor";
import {
  VUEDOC_EXTRACTION_CONTRACT,
  VUEDOC_EXTRACTION_CONTRACT_VERSION
} from "@hia-doc/vuedoc-spec";

/**
 * Declares the runtime version of the VueDoc producer adapter.
 *
 * @constant {string}
 * @lang zh-CN 声明 VueDoc producer adapter 的运行时版本。
 * @lang en Declares the runtime version of the VueDoc producer adapter.
 */
export const VUEDOC_PRODUCER_VERSION = "0.0.0";

/**
 * Lists the VueDoc input kinds accepted by the producer adapter.
 *
 * @constant {string[]}
 * @lang zh-CN 列出 VueDoc producer adapter 接受的输入类型。
 * @lang en Lists the VueDoc input kinds accepted by the producer adapter.
 */
export const VUEDOC_INPUT_KINDS = Object.freeze(["vue-sfc"]);

/**
 * Lists the artifact kinds emitted by the VueDoc producer adapter.
 *
 * @constant {string[]}
 * @lang zh-CN 列出 VueDoc producer adapter 可能产出的 artifact 类型。
 * @lang en Lists the artifact kinds emitted by the VueDoc producer adapter.
 */
export const VUEDOC_OUTPUT_KINDS = Object.freeze([
  "generated-js",
  "generated-css",
  "ordinary-source-map",
  "vuedoc-extraction",
  "htmdoc-extraction",
  "cssdoc-extraction",
  "hia-document",
  "doc-source-map"
]);

const RESULT_CONTRACT = "documentation-producer-result";
const RESULT_CONTRACT_VERSION = "0.1.0-draft";
const PRODUCER_ID = "vuedoc";
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Describes the VueDoc producer for HIA project manifest orchestration.
 *
 * @constant {object}
 * @lang zh-CN 描述供 HIA project manifest 编排层加载的 VueDoc producer 能力。
 * @lang en Describes the VueDoc producer for HIA project manifest orchestration.
 */
export const vuedocProducerDescriptor = Object.freeze({
  contract: "documentation-producer",
  contractVersion: "0.1.0-draft",
  id: PRODUCER_ID,
  version: VUEDOC_PRODUCER_VERSION,
  displayName: "VueDoc",
  inputKinds: [...VUEDOC_INPUT_KINDS],
  outputKinds: [...VUEDOC_OUTPUT_KINDS],
  capabilities: {
    sourceLinkage: true,
    incremental: false,
    watch: false
  }
});

/**
 * Runs Vue SFC extraction, framework bridges, generated artifacts, and doc-source-map emission.
 *
 * @constant {object}
 * @lang zh-CN 运行 Vue SFC extraction、framework bridge、生成产物和 doc-source-map 输出。
 * @lang en Runs Vue SFC extraction, framework bridges, generated artifacts, and doc-source-map emission.
 */
export const vuedocProducer = Object.freeze({
  descriptor: vuedocProducerDescriptor,
  produce(request, context = {}) {
    return runVueDoc(request, context);
  }
});

export default vuedocProducer;

async function runVueDoc(request, context = {}) {
  const normalized = normalizeRequest(request);
  await mkdir(normalized.outputDirectory, { recursive: true });

  const artifacts = [];
  const diagnostics = [];
  let completed = 0;

  for (const [index, input] of normalized.inputs.entries()) {
    if (context.signal?.aborted) {
      diagnostics.push(createDiagnostic("VUEDOC_PRODUCER_ABORTED", "VueDoc producer was aborted before all inputs completed.", "error"));
      break;
    }

    context.reportProgress?.({
      phase: "extract",
      current: index,
      total: normalized.inputs.length,
      message: input.path
    });

    try {
      const generated = await processInput(input, normalized, index);
      artifacts.push(...generated.artifacts);
      diagnostics.push(...generated.diagnostics);
      completed += 1;
    } catch (error) {
      diagnostics.push(createDiagnostic(
        "VUEDOC_PRODUCER_INPUT_FAILED",
        `Unable to process VueDoc input ${input.path} (${errorCode(error)}).`,
        "error",
        input.path
      ));
    }
  }

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const result = {
    contract: RESULT_CONTRACT,
    contractVersion: RESULT_CONTRACT_VERSION,
    producer: {
      id: PRODUCER_ID,
      version: VUEDOC_PRODUCER_VERSION
    },
    status: hasErrors ? (artifacts.length > 0 ? "partial" : "failed") : "success",
    artifacts,
    diagnostics
  };

  if (normalized.options.writeResultManifest) {
    await writeJson(path.join(normalized.outputDirectory, "vuedoc.producer-result.json"), result);
  }

  context.reportProgress?.({
    phase: "complete",
    current: completed,
    total: normalized.inputs.length
  });

  return result;
}

async function processInput(input, request, index) {
  const sourcePath = input.path;
  const source = await readFile(path.resolve(request.workspaceRoot, sourcePath), "utf8");
  const basePath = outputBasePath(input, index);
  const vueDocPath = `${basePath}.vuedoc.json`;
  const htmDocPath = `${basePath}.htmdoc.json`;
  const cssDocPath = `${basePath}.cssdoc.json`;
  const hiaDocumentPath = `${basePath}.hia.json`;
  const docSourceMapPath = `${basePath}.docmap.json`;
  const vueArtifact = extractVueSfc(source, {
    path: sourcePath
  });
  const compiled = compileVueSfc(source, {
    path: sourcePath,
    id: request.options.componentId ?? slug(sourcePath)
  });
  const outputRefs = await writeCompiledOutputs(compiled.outputs, basePath, request.outputDirectory);
  const htmDoc = vueDocToHtmlExtraction(vueArtifact, {
    docSourceMapPath,
    templatePath: outputRefs.templatePath ?? sourcePath
  });
  const cssDoc = vueDocToCssExtraction(vueArtifact, {
    docSourceMapPath,
    stylePath: outputRefs.stylePath ?? sourcePath
  });
  const hiaDocument = vueDocToHiaDocument(vueArtifact, {
    id: `vuedoc:${sourcePath}`,
    title: path.posix.basename(sourcePath),
    docSourceMapPath,
    entryArtifact: outputRefs.templatePath ?? null
  });
  const docSourceMap = createVueSfcDocSourceMap({
    vueArtifact,
    vueDocPath,
    htmDocPath,
    cssDocPath,
    hiaDocumentPath,
    ...outputRefs
  });

  await writeJson(path.join(request.outputDirectory, vueDocPath), vueArtifact);
  await writeJson(path.join(request.outputDirectory, htmDocPath), htmDoc);
  await writeJson(path.join(request.outputDirectory, cssDocPath), cssDoc);
  await writeJson(path.join(request.outputDirectory, hiaDocumentPath), hiaDocument);
  if (request.options.emitDocSourceMap) {
    await writeJson(path.join(request.outputDirectory, docSourceMapPath), docSourceMap);
  }

  const artifactIdBase = `input-${index + 1}`;
  const artifacts = [
    ...compiledOutputArtifacts(outputRefs, artifactIdBase, request.profileIds),
    {
      ...artifact(`${artifactIdBase}-vuedoc`, "vuedoc-extraction", vueDocPath, "json", "application/json", request.profileIds),
      contract: VUEDOC_EXTRACTION_CONTRACT,
      contractVersion: VUEDOC_EXTRACTION_CONTRACT_VERSION
    },
    {
      ...artifact(`${artifactIdBase}-htmdoc`, "htmdoc-extraction", htmDocPath, "json", "application/json", request.profileIds),
      contract: "hia-htmdoc-extraction",
      contractVersion: "0.1.0-draft"
    },
    {
      ...artifact(`${artifactIdBase}-cssdoc`, "cssdoc-extraction", cssDocPath, "json", "application/json", request.profileIds),
      contract: "hia-cssdoc-extraction",
      contractVersion: "0.1.0-draft"
    },
    artifact(`${artifactIdBase}-hia-document`, "hia-document", hiaDocumentPath, "json", "application/json", request.profileIds)
  ];

  if (request.options.emitDocSourceMap) {
    artifacts.push({
      ...artifact(`${artifactIdBase}-doc-source-map`, "doc-source-map", docSourceMapPath, "json", "application/json", request.profileIds),
      contract: "doc-source-map",
      contractVersion: "0.1.0-draft"
    });
  }

  return {
    artifacts,
    diagnostics: [
      ...normalizeDiagnostics(vueArtifact.diagnostics, sourcePath),
      ...normalizeCompileDiagnostics(compiled, sourcePath)
    ]
  };
}

async function writeCompiledOutputs(outputs, basePath, outputDirectory) {
  const refs = {};
  for (const output of outputs) {
    if (output.kind === "template-render") {
      refs.templatePath = `${basePath}.template.js`;
      await writeText(path.join(outputDirectory, refs.templatePath), ensureTrailingNewline(output.content));
      if (output.map) {
        refs.templateMapPath = `${refs.templatePath}.map`;
        await writeJson(path.join(outputDirectory, refs.templateMapPath), output.map);
      }
    }
    if (output.kind === "script") {
      refs.scriptPath = `${basePath}.script.js`;
      await writeText(path.join(outputDirectory, refs.scriptPath), ensureTrailingNewline(output.content));
      if (output.map) {
        refs.scriptMapPath = `${refs.scriptPath}.map`;
        await writeJson(path.join(outputDirectory, refs.scriptMapPath), output.map);
      }
    }
    if (output.kind === "style") {
      refs.stylePath = `${basePath}.style.css`;
      await writeText(path.join(outputDirectory, refs.stylePath), ensureTrailingNewline(output.content));
      if (output.map) {
        refs.styleMapPath = `${refs.stylePath}.map`;
        await writeJson(path.join(outputDirectory, refs.styleMapPath), output.map);
      }
    }
  }
  return refs;
}

function compiledOutputArtifacts(outputRefs, artifactIdBase, profileIds) {
  const artifacts = [];
  if (outputRefs.templatePath) {
    artifacts.push(artifact(`${artifactIdBase}-template-js`, "generated-js", outputRefs.templatePath, "javascript", "text/javascript", profileIds));
  }
  if (outputRefs.scriptPath) {
    artifacts.push(artifact(`${artifactIdBase}-script-js`, "generated-js", outputRefs.scriptPath, "javascript", "text/javascript", profileIds));
  }
  if (outputRefs.stylePath) {
    artifacts.push(artifact(`${artifactIdBase}-style-css`, "generated-css", outputRefs.stylePath, "css", "text/css", profileIds));
  }
  for (const [key, value] of Object.entries(outputRefs)) {
    if (key.endsWith("MapPath")) {
      artifacts.push(artifact(`${artifactIdBase}-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, "ordinary-source-map", value, "json", "application/json", profileIds));
    }
  }
  return artifacts;
}

function normalizeRequest(value) {
  assertRecord(value, "VueDoc producer request must be an object.");
  assertAbsoluteDirectory(value.workspaceRoot, "workspaceRoot");
  assertAbsoluteDirectory(value.outputDirectory, "outputDirectory");
  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    throw new TypeError("inputs must be a non-empty array.");
  }

  const inputs = value.inputs.map((input, index) => {
    assertRecord(input, `inputs[${index}] must be an object.`);
    assertKnownKeys(input, ["kind", "path", "language"], `inputs[${index}]`);
    const inputPath = normalizeSafeRelativePath(input.path, `inputs[${index}].path`);
    const kind = input.kind ?? "vue-sfc";
    if (!VUEDOC_INPUT_KINDS.includes(kind)) {
      throw new TypeError(`Unsupported VueDoc input kind: ${kind}`);
    }
    return {
      kind,
      path: inputPath,
      ...(typeof input.language === "string" ? { language: input.language } : {})
    };
  });

  const options = value.options ?? {};
  assertRecord(options, "options must be an object.");
  assertKnownKeys(options, ["componentId", "emitDocSourceMap", "sourcesContentPolicy", "writeResultManifest"], "options");
  const sourcesContentPolicy = options.sourcesContentPolicy ?? "none";
  if (!["none", "reference", "embed"].includes(sourcesContentPolicy)) {
    throw new TypeError(`Unsupported sourcesContentPolicy: ${sourcesContentPolicy}`);
  }
  const profileIds = value.profileIds ?? ["htmdoc", "cssdoc", "doc-source-map"];
  if (!Array.isArray(profileIds) || profileIds.length === 0 || profileIds.some((id) => typeof id !== "string" || !SAFE_ID_PATTERN.test(id))) {
    throw new TypeError("profileIds must be a non-empty array of lower-case identifiers.");
  }

  return {
    workspaceRoot: path.resolve(value.workspaceRoot),
    outputDirectory: path.resolve(value.outputDirectory),
    inputs,
    profileIds: [...profileIds],
    options: {
      componentId: typeof options.componentId === "string" ? options.componentId : null,
      emitDocSourceMap: options.emitDocSourceMap !== false,
      sourcesContentPolicy,
      writeResultManifest: options.writeResultManifest !== false
    }
  };
}

function outputBasePath(input, index) {
  const parsed = path.posix.parse(input.path);
  const directory = parsed.dir ? `${parsed.dir}/` : "";
  return normalizeSafeRelativePath(
    `artifacts/${directory}${parsed.name}.vue-sfc-${index + 1}`,
    "artifact base path"
  );
}

function normalizeDiagnostics(diagnostics, fallbackPath) {
  return (diagnostics ?? []).map((diagnostic) => ({
    code: typeof diagnostic?.code === "string" ? diagnostic.code : "VUEDOC_PRODUCER_DIAGNOSTIC",
    message: typeof diagnostic?.message === "string" ? diagnostic.message : "VueDoc producer diagnostic.",
    severity: ["error", "warning", "info"].includes(diagnostic?.severity) ? diagnostic.severity : "info",
    path: typeof diagnostic?.path === "string" ? diagnostic.path : fallbackPath,
    ...(isJsonObject(diagnostic?.data) ? { data: diagnostic.data } : {})
  }));
}

function normalizeCompileDiagnostics(compiled, sourcePath) {
  const diagnostics = [];
  for (const output of compiled.outputs ?? []) {
    for (const error of output.errors ?? []) {
      diagnostics.push(createDiagnostic(
        "VUEDOC_COMPILE_ERROR",
        typeof error === "string" ? error : String(error?.message ?? error),
        "error",
        sourcePath
      ));
    }
    for (const tip of output.tips ?? []) {
      diagnostics.push(createDiagnostic(
        "VUEDOC_COMPILE_TIP",
        typeof tip === "string" ? tip : String(tip),
        "info",
        sourcePath
      ));
    }
  }
  return diagnostics;
}

function artifact(id, kind, artifactPath, language, mediaType, profileIds) {
  return {
    id,
    kind,
    path: artifactPath,
    language,
    mediaType,
    profileIds
  };
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function normalizeSafeRelativePath(value, label) {
  if (typeof value !== "string" || !isSafeRelativePath(value)) {
    throw new TypeError(`${label} must be a safe relative path.`);
  }
  return value.replaceAll("\\", "/");
}

function isSafeRelativePath(value) {
  const normalized = String(value).replaceAll("\\", "/");
  return Boolean(normalized)
    && !path.posix.isAbsolute(normalized)
    && !path.win32.isAbsolute(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)
    && !normalized.split("/").includes("..");
}

function assertAbsoluteDirectory(value, label) {
  if (typeof value !== "string" || (!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value))) {
    throw new TypeError(`${label} must be an absolute runtime path.`);
  }
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
}

function assertRecord(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(message);
  }
}

function isJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function createDiagnostic(code, message, severity, diagnosticPath) {
  return {
    code,
    message,
    severity,
    ...(diagnosticPath ? { path: diagnosticPath } : {})
  };
}

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : error?.name ?? "Error";
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "input";
}
