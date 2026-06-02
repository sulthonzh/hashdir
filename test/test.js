'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const {
  hashDirectory,
  diffDirectories,
  watchDirectory,
  collectFiles,
  hashContent,
  formatText,
  formatJson,
  formatMarkdown,
  formatDiffText,
  formatBytes,
} = require('../src/index');

let testDir;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function setupFixtures() {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hashdir-test-'));

  // Basic files
  fs.writeFileSync(path.join(testDir, 'hello.txt'), 'Hello World\n');
  fs.writeFileSync(path.join(testDir, 'foo.js'), 'console.log("foo");\n');
  fs.mkdirSync(path.join(testDir, 'sub'));
  fs.writeFileSync(path.join(testDir, 'sub', 'bar.txt'), 'Bar content\n');
  fs.mkdirSync(path.join(testDir, 'sub', 'deep'));
  fs.writeFileSync(path.join(testDir, 'sub', 'deep', 'nested.json'), '{"a":1}\n');

  // Dotfile
  fs.writeFileSync(path.join(testDir, '.hidden'), 'hidden content\n');

  // Node_modules
  fs.mkdirSync(path.join(testDir, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(testDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');

  // Symlink
  fs.symlinkSync(path.join(testDir, 'hello.txt'), path.join(testDir, 'link.txt'));
}

function cleanup() {
  fs.rmSync(testDir, { recursive: true, force: true });
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log('hashdir tests\n');

setupFixtures();

test('hashDirectory returns hash and file count', () => {
  const result = hashDirectory(testDir);
  assert.ok(result.hash, 'should have hash');
  assert.strictEqual(result.hash.length, 64, 'sha256 hex should be 64 chars');
  assert.ok(result.fileCount > 0);
  assert.ok(result.totalSize > 0);
});

test('hashDirectory is deterministic', () => {
  const a = hashDirectory(testDir);
  const b = hashDirectory(testDir);
  assert.strictEqual(a.hash, b.hash);
});

test('hashDirectory --files returns per-file hashes', () => {
  const result = hashDirectory(testDir, { includePerFile: true });
  assert.ok(Array.isArray(result.files));
  assert.strictEqual(result.files.length, result.fileCount);
  for (const f of result.files) {
    assert.ok(f.path);
    assert.ok(f.hash);
    assert.ok(typeof f.size === 'number');
  }
});

test('hashDirectory ignores dotfiles by default', () => {
  const result = hashDirectory(testDir, { includePerFile: true });
  const paths = result.files.map(f => f.path);
  assert.ok(!paths.some(p => p.includes('.hidden')), 'should not include dotfiles');
});

test('hashDirectory includes dotfiles when enabled', () => {
  const result = hashDirectory(testDir, { dotfiles: true, includePerFile: true });
  const paths = result.files.map(f => f.path);
  assert.ok(paths.some(p => p.includes('.hidden')), 'should include dotfiles');
});

test('hashDirectory --ignore filters out directories', () => {
  // Without ignore, node_modules files ARE included
  const result = hashDirectory(testDir, { includePerFile: true });
  const paths = result.files.map(f => f.path);
  assert.ok(paths.some(p => p.includes('node_modules')), 'node_modules should be included without ignore');
  // With ignore, node_modules files are excluded
  const result2 = hashDirectory(testDir, { ignore: ['node_modules'], includePerFile: true });
  const paths2 = result2.files.map(f => f.path);
  assert.ok(!paths2.some(p => p.includes('node_modules')));
});

test('hashDirectory --ext filters by extension', () => {
  const result = hashDirectory(testDir, { extensions: ['.js'], includePerFile: true });
  const paths = result.files.map(f => f.path);
  assert.ok(paths.every(p => p.endsWith('.js')));
  assert.ok(paths.some(p => p.includes('foo.js')));
});

test('hashDirectory --depth limits recursion', () => {
  const result = hashDirectory(testDir, { maxDepth: 0, includePerFile: true });
  const paths = result.files.map(f => f.path);
  assert.ok(!paths.some(p => p.includes('sub')), 'should not include nested files');
});

test('hashDirectory detects content changes', () => {
  const before = hashDirectory(testDir);
  fs.appendFileSync(path.join(testDir, 'hello.txt'), 'extra line\n');
  const after = hashDirectory(testDir);
  assert.notStrictEqual(before.hash, after.hash);
});

test('hashDirectory --normalize handles line endings', () => {
  const fileA = path.join(testDir, 'normalize-test.txt');
  const fileB = path.join(testDir, 'normalize-test-crlf.txt');
  fs.writeFileSync(fileA, 'line1\nline2\n');
  fs.writeFileSync(fileB, 'line1\r\nline2\r\n');

  const dirA = path.join(testDir, 'norm-a');
  const dirB = path.join(testDir, 'norm-b');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  fs.writeFileSync(path.join(dirA, 'test.txt'), 'line1\nline2\n');
  fs.writeFileSync(path.join(dirB, 'test.txt'), 'line1\r\nline2\r\n');

  // Without normalize, they differ
  const hashA = hashDirectory(dirA);
  const hashB = hashDirectory(dirB);
  assert.notStrictEqual(hashA.hash, hashB.hash);

  // With normalize, they match
  const hashAn = hashDirectory(dirA, { normalize: true });
  const hashBn = hashDirectory(dirB, { normalize: true });
  assert.strictEqual(hashAn.hash, hashBn.hash);

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
});

test('hashDirectory with different algorithms', () => {
  const sha256 = hashDirectory(testDir, { algorithm: 'sha256' });
  const sha1 = hashDirectory(testDir, { algorithm: 'sha1' });
  const md5 = hashDirectory(testDir, { algorithm: 'md5' });
  assert.strictEqual(sha256.hash.length, 64);
  assert.strictEqual(sha1.hash.length, 40);
  assert.strictEqual(md5.hash.length, 32);
  assert.notStrictEqual(sha256.hash, sha1.hash);
});

test('hashDirectory throws for invalid algorithm', () => {
  assert.throws(() => hashDirectory(testDir, { algorithm: 'invalid' }), /Unsupported algorithm/);
});

test('hashDirectory throws for missing directory', () => {
  assert.throws(() => hashDirectory('/nonexistent/path/xyz'), /Directory not found/);
});

test('hashDirectory empty directory', () => {
  const emptyDir = path.join(testDir, 'empty');
  fs.mkdirSync(emptyDir);
  const result = hashDirectory(emptyDir);
  assert.strictEqual(result.fileCount, 0);
  assert.strictEqual(result.totalSize, 0);
  assert.ok(result.hash);
});

test('collectFiles returns sorted paths', () => {
  const files = collectFiles(testDir);
  const paths = files.map(f => f.path);
  const sorted = [...paths].sort();
  assert.deepStrictEqual(paths, sorted);
});

test('hashContent hashes a buffer', () => {
  const hash = hashContent(Buffer.from('test'));
  assert.strictEqual(hash.length, 64);
  assert.ok(hash.match(/^[0-9a-f]+$/));
});

// ── Diff tests ──────────────────────────────────────────────────────────

test('diffDirectories detects identical dirs', () => {
  const dirA = path.join(testDir, 'diff-a');
  const dirB = path.join(testDir, 'diff-b');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  fs.writeFileSync(path.join(dirA, 'same.txt'), 'content\n');
  fs.writeFileSync(path.join(dirB, 'same.txt'), 'content\n');

  const diff = diffDirectories(dirA, dirB);
  assert.strictEqual(diff.identical, true);
  assert.strictEqual(diff.summary.unchanged, 1);

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
});

test('diffDirectories detects added files', () => {
  const dirA = path.join(testDir, 'diff-c');
  const dirB = path.join(testDir, 'diff-d');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  fs.writeFileSync(path.join(dirA, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(dirB, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(dirB, 'b.txt'), 'b\n');

  const diff = diffDirectories(dirA, dirB);
  assert.strictEqual(diff.identical, false);
  assert.strictEqual(diff.added.length, 1);
  assert.strictEqual(diff.added[0].path, 'b.txt');

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
});

test('diffDirectories detects removed files', () => {
  const dirA = path.join(testDir, 'diff-e');
  const dirB = path.join(testDir, 'diff-f');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  fs.writeFileSync(path.join(dirA, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(dirA, 'b.txt'), 'b\n');
  fs.writeFileSync(path.join(dirB, 'a.txt'), 'a\n');

  const diff = diffDirectories(dirA, dirB);
  assert.strictEqual(diff.removed.length, 1);
  assert.strictEqual(diff.removed[0].path, 'b.txt');

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
});

test('diffDirectories detects modified files', () => {
  const dirA = path.join(testDir, 'diff-g');
  const dirB = path.join(testDir, 'diff-h');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  fs.writeFileSync(path.join(dirA, 'a.txt'), 'original\n');
  fs.writeFileSync(path.join(dirB, 'a.txt'), 'modified\n');

  const diff = diffDirectories(dirA, dirB);
  assert.strictEqual(diff.modified.length, 1);
  assert.strictEqual(diff.modified[0].path, 'a.txt');
  assert.ok(diff.modified[0].hashA);
  assert.ok(diff.modified[0].hashB);

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
});

// ── Format tests ────────────────────────────────────────────────────────

test('formatText produces readable output', () => {
  const result = hashDirectory(testDir, { includePerFile: true });
  result.algorithm = 'sha256';
  const text = formatText(result);
  assert.ok(text.includes('Hash:'));
  assert.ok(text.includes('Files:'));
});

test('formatJson is valid JSON', () => {
  const result = hashDirectory(testDir);
  const json = formatJson(result);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.hash, result.hash);
});

test('formatMarkdown has table headers', () => {
  const result = hashDirectory(testDir, { includePerFile: true });
  result.algorithm = 'sha256';
  const md = formatMarkdown(result);
  assert.ok(md.includes('# Directory Hash'));
  assert.ok(md.includes('| Hash |'));
});

test('formatDiffText for identical dirs', () => {
  const text = formatDiffText({ identical: true, added: [], removed: [], modified: [] });
  assert.ok(text.includes('identical'));
});

test('formatBytes converts sizes', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(1024), '1.0 KB');
  assert.strictEqual(formatBytes(1048576), '1.0 MB');
});

// ── Watch test (basic) ─────────────────────────────────────────────────

test('watchDirectory calls callback and can stop', (done) => {
  const watchDir = path.join(testDir, 'watch');
  fs.mkdirSync(watchDir);
  fs.writeFileSync(path.join(watchDir, 'a.txt'), 'a\n');

  let called = false;
  const watcher = watchDirectory(watchDir, (event) => {
    if (!called) {
      called = true;
      assert.ok(event.hash);
      assert.strictEqual(event.fileCount, 1);
      watcher.stop();
    }
  }, { interval: 100 });

  // Give it a moment then clean up
  setTimeout(() => {
    watcher.stop();
    assert.ok(called, 'watch callback should have been called');
  }, 300);
});

// ── Summary ─────────────────────────────────────────────────────────────

cleanup();

setTimeout(() => {
  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}, 500);
