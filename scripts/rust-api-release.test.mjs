import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

async function releaseFixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "cross-canon-release-"));
  try {
    await mkdir(path.join(root, "scripts"));
    await mkdir(path.join(root, "bin"));
    await mkdir(path.join(root, "scripture-cache"));
    for (const name of ["build-rust-api-container.sh", "deploy-rust-api.sh", "validate-rust-api-artifact.py"]) {
      await copyFile(new URL(name, import.meta.url), path.join(root, "scripts", name));
    }
    await writeFile(path.join(root, "scripture-cache/manifest.json"), '{"version":"ab"}');
    await writeFile(path.join(root, "scripture-cache/ab.json"), JSON.stringify({
      passages: [{ reference: "Genesis 1:1", id: "0".repeat(24) }],
    }));
    const remoteLog = path.join(root, "remote-calls");
    for (const name of ["ssh", "scp"]) {
      await writeFile(path.join(root, "bin", name), `#!/usr/bin/env node
const fs=require('node:fs');
fs.appendFileSync(process.env.REMOTE_LOG,${JSON.stringify(name)}+'\\n');
if (${JSON.stringify(name)}==='scp') {
 const archive=process.argv.find(arg=>arg.endsWith('.tar.gz'));
 fs.copyFileSync(archive,process.env.CAPTURE_ARCHIVE);
} else process.exit(99);
`, { mode: 0o755 });
    }
    await writeFile(path.join(root, "bin/docker"), `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const args=process.argv.slice(2);
if(args[0]==='context') {
 console.log(args[1]==='show'?'fixture':'unix:///fixture/docker.sock');
} else if(args.includes('info')) {
 process.exit(process.env.BUILD_CASE==='unavailable'?42:0);
} else if(args.includes('build')) {
 const output=args.find(arg=>arg.startsWith('type=local,dest=')).slice('type=local,dest='.length);
 const binary=Buffer.alloc(20);Buffer.from([0x7f,69,76,70,2,1]).copy(binary);
 binary.writeUInt16LE(process.env.BUILD_CASE==='arm'?183:62,18);
 for(const [name,data] of Object.entries({
  'target/release/r-cross-cannon':binary,
  'rust/deploy/r-cross-cannon.service':'fixture unit',
  'BUILD-INFO':'fixture build',
  'storage/secret.db':'must never upload', '.env':'must never upload'
 })) {const file=path.join(output,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data,{mode:0o755});}
 const names=['target/release/r-cross-cannon','rust/deploy/r-cross-cannon.service','BUILD-INFO'];
 fs.writeFileSync(path.join(output,'SHA256SUMS'),names.map(name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex')+'  '+name).join('\\n')+'\\n');
} else process.exit(43);
`, { mode: 0o755 });
    const invoke = (buildCase, extra = {}) => spawnSync("bash", ["scripts/deploy-rust-api.sh", "--build-local"], {
      cwd: root, encoding: "utf8", timeout: 20_000,
      env: { ...process.env, PATH: path.join(root, "bin") + path.delimiter + process.env.PATH,
        EC2_PEM_PATH: "/unused-fixture-key", EC2_PUBLIC_IP: "example.invalid", DOCKER_HOST: "",
        BUILD_CASE: buildCase, REMOTE_LOG: remoteLog, CAPTURE_ARCHIVE: path.join(root, "captured.tar.gz"), ...extra },
    });
    await run({ root, invoke, remoteLog });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("an unavailable local compiler never contacts production", async () => {
  await releaseFixture(async ({ invoke, remoteLog }) => {
    assert.equal(invoke("unavailable").status, 42);
    await assert.rejects(readFile(remoteLog), { code: "ENOENT" });
  });
});

test("remote Docker engines and ARM binaries are rejected before upload", async () => {
  await releaseFixture(async ({ invoke, remoteLog }) => {
    assert.match(invoke("valid", { DOCKER_HOST: "ssh://example.invalid" }).stderr, /remote DOCKER_HOST is refused/);
    const wrongArchitecture = invoke("arm");
    assert.notEqual(wrongArchitecture.status, 0);
    assert.match(wrongArchitecture.stderr, /Expected a Linux x86-64 ELF binary/);
    await assert.rejects(readFile(remoteLog), { code: "ENOENT" });
  });
});

test("release uploads contain only the binary, service unit, and verification metadata", async () => {
  await releaseFixture(async ({ root, invoke, remoteLog }) => {
    assert.equal(invoke("valid").status, 99); // Stop at the mocked remote activation.
    assert.equal(await readFile(remoteLog, "utf8"), "scp\nssh\n");
    const contents = spawnSync("tar", ["-tzf", path.join(root, "captured.tar.gz")], { encoding: "utf8" });
    assert.equal(contents.status, 0);
    assert.deepEqual(contents.stdout.trim().split("\n").sort(), [
      "BUILD-INFO", "SHA256SUMS", "rust/deploy/r-cross-cannon.service", "target/release/r-cross-cannon",
    ]);
  });
});
