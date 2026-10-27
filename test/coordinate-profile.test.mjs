/**
 * @file
 * @lang zh-CN Vue 模板坐标侧载的真实编译链、关闭与保守拒绝回归。
 * @lang en Real Vue template compilation, opt-out and conservative rejection regressions for the coordinate sidecar.
 */
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { vuedocProducer } from "../packages/vuedoc-producer/src/index.mjs";

/** @lang zh-CN 测试仓根只用于公开安全合成输入。 @lang en The test repository root hosts only public-safe synthetic input. */
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @lang zh-CN 在仓内临时目录跑同轮 Vue producer，结束后移除这一个已验证边界的临时目录。
 * @lang en Runs a same-build Vue producer in a repository-local temporary directory, then removes only that bounded directory.
 */
async function withVueInput(source, action) {
  const sandbox = await fs.mkdtemp(path.join(repositoryRoot, "fixtures", "coordinate-vue-"));
  const inputPath = `${path.relative(repositoryRoot, sandbox).replaceAll("\\", "/")}/src/Card.vue`;
  const outputDirectory = path.join(sandbox, "out");
  try {
    await fs.mkdir(path.join(sandbox, "src"));
    await fs.writeFile(path.join(sandbox, "src", "Card.vue"), source, "utf8");
    await action({ inputPath, outputDirectory, sourceBytes: Buffer.from(source, "utf8") });
  } finally {
    assert.equal(path.dirname(sandbox), path.join(repositoryRoot, "fixtures"));
    await fs.rm(sandbox, { recursive: true, force: true });
  }
}

/** @lang zh-CN 用本次源路径和输出根构造最小 producer 请求。 @lang en Builds a minimal producer request for this source and output root. */
function request(inputPath, outputDirectory, emitCoordinateProfile) {
  return {
    workspaceRoot: repositoryRoot,
    outputDirectory,
    inputs: [{ kind: "vue-sfc", path: inputPath }],
    options: { emitDocSourceMap: true, emitCoordinateProfile, sourcesContentPolicy: "none", writeResultManifest: true }
  };
}

/** @lang zh-CN 将实际读取字节的 SHA-256 作为摘要本身 Base64 编码。 @lang en Encodes the SHA-256 digest of actual read bytes as Base64. */
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64");
}

test("opt-in signs only the native template slot from actual CRLF and non-BMP input", async () => {
  await withVueInput("<template>\r\n  <!-- @component Card -->\r\n  <div>😀{{ label }}</div>\r\n</template>\r\n<script setup>const label = 'ok'</script>\r\n<style>.card { color: blue; }</style>\r\n", async ({ inputPath, outputDirectory, sourceBytes }) => {
    const result = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
    const sidecarArtifact = result.artifacts.find((item) => item.kind === "ordinary-source-map-coordinate-profile");
    assert.ok(sidecarArtifact);
    const profile = JSON.parse(await fs.readFile(path.join(outputDirectory, sidecarArtifact.path), "utf8"));
    assert.equal(profile.contractVersion, "0.1.0-draft");
    assert.deepEqual(profile.sourceSlots.map(({ sectionIndex, sourceIndex, columnUnit }) => ({ sectionIndex, sourceIndex, columnUnit })), [
      { sectionIndex: null, sourceIndex: 0, columnUnit: "utf16-code-unit" }
    ]);
    assert.equal(profile.sourceSlots[0].sourceByteDigest.value, digest(sourceBytes));
    assert.equal(profile.sourceSlots[0].sourceTextDigest.value, digest(Buffer.from(sourceBytes.toString("utf8"), "utf16le")));
    assert.equal(JSON.stringify(profile).includes("😀"), false);
    const ordinaryArtifact = result.artifacts.find((item) => item.path.endsWith(".template.js.map"));
    const docArtifact = result.artifacts.find((item) => item.kind === "doc-source-map");
    assert.equal(profile.ordinaryMap.digest.value, digest(await fs.readFile(path.join(outputDirectory, ordinaryArtifact.path))));
    assert.equal(profile.documentationMap.digest.value, digest(await fs.readFile(path.join(outputDirectory, docArtifact.path))));
    assert.equal(result.artifacts.filter((item) => item.kind === "ordinary-source-map-coordinate-profile").length, 1);
    assert.ok(result.artifacts.some((item) => item.path.endsWith(".script.js.map")));
    assert.ok(result.artifacts.some((item) => item.path.endsWith(".style.css.map")));
    assert.equal(profile.ordinaryMap.sourceMapId, "sourcemap:vue-template");
  });
});

test("opt-out removes a stale template profile and preserves ordinary outputs", async () => {
  await withVueInput("<template>\n<!-- @component Card -->\n<div>Card</div>\n</template>\n", async ({ inputPath, outputDirectory }) => {
    const enabled = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(enabled.status, "success", JSON.stringify(enabled.diagnostics));
    const sidecar = enabled.artifacts.find((item) => item.kind === "ordinary-source-map-coordinate-profile");
    assert.ok(sidecar);
    const disabled = await vuedocProducer.produce(request(inputPath, outputDirectory, false));
    assert.equal(disabled.status, "success", JSON.stringify(disabled.diagnostics));
    assert.equal(disabled.artifacts.some((item) => item.kind === "ordinary-source-map-coordinate-profile"), false);
    await assert.rejects(fs.access(path.join(outputDirectory, sidecar.path)), { code: "ENOENT" });
    assert.ok(disabled.artifacts.some((item) => item.path.endsWith(".template.js.map")));
  });
});

test("inline template with lost original column offset cannot issue a profile", async () => {
  await withVueInput("<template><div>😀{{ label }}</div></template>\n<script setup>const label = 'ok'</script>\n", async ({ inputPath, outputDirectory }) => {
    const result = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(result.status, "failed");
    assert.equal(result.artifacts.some((item) => item.kind === "ordinary-source-map-coordinate-profile"), false);
  });
});

test("a coordinate profile requires a documentation map", async () => {
  await withVueInput("<template>\n<div>Card</div>\n</template>\n", async ({ inputPath, outputDirectory }) => {
    await assert.rejects(vuedocProducer.produce({
      ...request(inputPath, outputDirectory, true),
      options: { emitDocSourceMap: false, emitCoordinateProfile: true, sourcesContentPolicy: "none" }
    }), { name: "TypeError", message: /requires doc-source-map/ });
  });
});

test("failed inline rebuild revokes an old template profile", async () => {
  await withVueInput("<template>\n<!-- @component Card -->\n<div>Card</div>\n</template>\n", async ({ inputPath, outputDirectory }) => {
    const first = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(first.status, "success", JSON.stringify(first.diagnostics));
    const sidecar = first.artifacts.find((item) => item.kind === "ordinary-source-map-coordinate-profile");
    assert.ok(sidecar);
    await fs.writeFile(path.join(repositoryRoot, inputPath), "<template><div>Card</div></template>\n", "utf8");
    const rebuilt = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(rebuilt.status, "failed");
    await assert.rejects(fs.access(path.join(outputDirectory, sidecar.path)), { code: "ENOENT" });
  });
});

test("missing source on rebuild revokes an old template profile before reading", async () => {
  await withVueInput("<template>\n<!-- @component Card -->\n<div>Card</div>\n</template>\n", async ({ inputPath, outputDirectory }) => {
    const first = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(first.status, "success", JSON.stringify(first.diagnostics));
    const sidecar = first.artifacts.find((item) => item.kind === "ordinary-source-map-coordinate-profile");
    assert.ok(sidecar);
    await fs.rm(path.join(repositoryRoot, inputPath));
    const rebuilt = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(rebuilt.status, "failed");
    await assert.rejects(fs.access(path.join(outputDirectory, sidecar.path)), { code: "ENOENT" });
  });
});

test("malformed UTF-8 cannot be signed as a replacement-character source", async () => {
  await withVueInput("<template>\n<!-- @component Card -->\n<div>Card</div>\n</template>\n", async ({ inputPath, outputDirectory }) => {
    const first = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(first.status, "success", JSON.stringify(first.diagnostics));
    const sidecar = first.artifacts.find((item) => item.kind === "ordinary-source-map-coordinate-profile");
    assert.ok(sidecar);
    await fs.writeFile(path.join(repositoryRoot, inputPath), Buffer.from([0x3c, 0x74, 0x65, 0x6d, 0x70, 0x6c, 0x61, 0x74, 0x65, 0x3e, 0xff]));
    const rebuilt = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
    assert.equal(rebuilt.status, "failed");
    await assert.rejects(fs.access(path.join(outputDirectory, sidecar.path)), { code: "ENOENT" });
  });
});

test("runner CLI enables the sidecar only with the explicit flag", async () => {
  await withVueInput("<template>\n<!-- @component Card -->\n<div>Card</div>\n</template>\n", async ({ inputPath, outputDirectory }) => {
    const configPath = path.join(path.dirname(outputDirectory), "runner-config.json");
    await fs.writeFile(configPath, `${JSON.stringify({
      contract: "hia-vuedoc-runner-config",
      contractVersion: "0.1.0-draft",
      workspaceRoot: repositoryRoot,
      outputDirectory,
      inputs: [{ kind: "vue-sfc", path: inputPath }],
      options: { emitDocSourceMap: true, sourcesContentPolicy: "none" }
    })}\n`, "utf8");
    const cli = path.join(repositoryRoot, "packages", "vuedoc-runner", "src", "cli.mjs");
    const baseline = spawnSync(process.execPath, [cli, "--config", configPath], { encoding: "utf8" });
    assert.equal(baseline.status, 0, baseline.stderr);
    const baselineResult = JSON.parse(await fs.readFile(path.join(outputDirectory, "vuedoc.producer-result.json"), "utf8"));
    assert.equal(baselineResult.artifacts.some((item) => item.kind === "ordinary-source-map-coordinate-profile"), false);
    const enabled = spawnSync(process.execPath, [cli, "--config", configPath, "--coordinate-profile"], { encoding: "utf8" });
    assert.equal(enabled.status, 0, enabled.stderr);
    const enabledResult = JSON.parse(await fs.readFile(path.join(outputDirectory, "vuedoc.producer-result.json"), "utf8"));
    assert.equal(enabledResult.artifacts.filter((item) => item.kind === "ordinary-source-map-coordinate-profile").length, 1);
  });
});

test("opt-in rejects an external output directory before creating it", async () => {
  await withVueInput("<template>\n<div>Card</div>\n</template>\n", async ({ inputPath }) => {
    const external = path.join(os.tmpdir(), `vue-coordinate-external-${randomUUID()}`);
    await assert.rejects(vuedocProducer.produce(request(inputPath, external, true)), /Coordinate output escapes/);
    await assert.rejects(fs.access(external), { code: "ENOENT" });
  });
});

test("opt-in rejects a linked output parent before writing through it", async () => {
  await withVueInput("<template>\n<div>Card</div>\n</template>\n", async ({ inputPath, outputDirectory }) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "vue-coordinate-linked-"));
    const link = path.join(path.dirname(outputDirectory), "linked-out");
    try {
      await fs.symlink(external, link, "junction");
      await assert.rejects(vuedocProducer.produce(request(inputPath, path.join(link, "out"), true)), /linked or non-directory/);
      await assert.rejects(fs.access(path.join(external, "out")), { code: "ENOENT" });
    } finally {
      await fs.rm(link, { force: true });
      assert.equal(path.dirname(external), os.tmpdir());
      assert.ok(path.basename(external).startsWith("vue-coordinate-linked-"));
      await fs.rm(external, { recursive: true, force: true });
    }
  });
});

test("opt-in rejects a linked ordinary map target before changing external bytes", async () => {
  await withVueInput("<template>\n<div>Card</div>\n</template>\n", async ({ inputPath, outputDirectory }) => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "vue-coordinate-target-"));
    const sentinel = path.join(external, "sentinel.map");
    const parsed = path.posix.parse(inputPath);
    const base = `artifacts/${parsed.dir}/${parsed.name}.vue-sfc-1`;
    const mapTarget = path.join(outputDirectory, `${base}.template.js.map`);
    try {
      await fs.mkdir(path.dirname(mapTarget), { recursive: true });
      await fs.writeFile(sentinel, "sentinel", "utf8");
      await fs.symlink(sentinel, mapTarget, "file");
      const result = await vuedocProducer.produce(request(inputPath, outputDirectory, true));
      assert.equal(result.status, "failed");
      assert.equal(result.artifacts.length, 0);
      assert.equal(await fs.readFile(sentinel, "utf8"), "sentinel");
    } finally {
      await fs.rm(mapTarget, { force: true });
      assert.equal(path.dirname(external), os.tmpdir());
      assert.ok(path.basename(external).startsWith("vue-coordinate-target-"));
      await fs.rm(external, { recursive: true, force: true });
    }
  });
});
