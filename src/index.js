'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readFileContent(filePath, normalize) {
  let content = fs.readFileSync(filePath);
  if (normalize) {
    let text = content.toString('utf-8');
    // Normalize line endings to LF
    text = text.replace(/\r\n/g, '\n');
    // Strip trailing whitespace per line
    text = text.replace(/[ \t]+$/gm, '');
    // Strip trailing newlines
    text = text.replace(/\n+$/, '');
    text += '\n';
    content = Buffer.from(text, 'utf-8');
  }
  return content;
}

function collectFiles(dir, options = {}) {
  const {
    ignore = [],
    extensions = [],
    maxDepth = Infinity,
    followLinks = false,
    dotfiles = false,
  } = options;

  const ignoreSet = new Set(ignore);
  const extSet = new Set(extensions.map(e => e.startsWith('.') ? e : '.' + e));
  const results = [];

  function walk(currentDir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort for deterministic order
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const name = entry.name;
      const fullPath = path.join(currentDir, name);

      if (!dotfiles && name.startsWith('.')) continue;

      if (ignoreSet.has(name)) continue;

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (extSet.size > 0) {
          const ext = path.extname(name);
          if (!extSet.has(ext)) continue;
        }

        const rel = path.relative(dir, fullPath);
        results.push({ path: rel, fullPath });
      }
      else if (followLinks && entry.isSymbolicLink()) {
        try {
          const real = fs.realpathSync(fullPath);
          const stat = fs.statSync(real);
          if (stat.isFile()) {
            if (extSet.size > 0) {
              const ext = path.extname(name);
              if (!extSet.has(ext)) continue;
            }
            const rel = path.relative(dir, fullPath);
            results.push({ path: rel, fullPath });
          } else if (stat.isDirectory()) {
            walk(real, depth + 1);
          }
        } catch {
          // Broken symlink, skip
        }
      }
    }
  }

  walk(dir, 0);
  return results;
}

const ALGORITHMS = ['sha256', 'sha1', 'md5', 'sha512', 'blake2b512', 'sha384'];

function isValidAlgorithm(algo) {
  return ALGORITHMS.includes(algo) || crypto.getHashes().includes(algo);
}

function hashContent(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content).digest('hex');
}

/**
 * Hash a directory tree.
 * @param {string} dir - Directory path
 * @param {object} options
 * @param {string} [options.algorithm='sha256'] - Hash algorithm
 * @param {string[]} [options.ignore=[]] - File/directory names to ignore
 * @param {string[]} [options.extensions=[]] - Only include these extensions
 * @param {number} [options.maxDepth=Infinity] - Max recursion depth
 * @param {boolean} [options.normalize=false] - Normalize text files (line endings, whitespace)
 * @param {boolean} [options.followLinks=false] - Follow symbolic links
 * @param {boolean} [options.dotfiles=false] - Include dotfiles
 * @param {boolean} [options.includePerFile=false] - Return per-file hashes too
 * @returns {object} { hash, fileCount, totalSize, files? }
 */
function hashDirectory(dir, options = {}) {
  const {
    algorithm = 'sha256',
    ignore = [],
    extensions = [],
    maxDepth = Infinity,
    normalize = false,
    followLinks = false,
    dotfiles = false,
    includePerFile = false,
  } = options;

  if (!isValidAlgorithm(algorithm)) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }

  const resolvedDir = path.resolve(dir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Directory not found: ${resolvedDir}`);
  }

  const stat = fs.statSync(resolvedDir);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolvedDir}`);
  }

  const files = collectFiles(resolvedDir, { ignore, extensions, maxDepth, followLinks, dotfiles });

  if (files.length === 0) {
    const result = { hash: hashContent(Buffer.alloc(0), algorithm), fileCount: 0, totalSize: 0 };
    if (includePerFile) result.files = [];
    return result;
  }

  // Build combined hash: hash each file's relative path + content
  const perFileHashes = [];
  let totalSize = 0;

  for (const file of files) {
    const content = readFileContent(file.fullPath, normalize);
    totalSize += content.length;
    const fileHash = hashContent(content, algorithm);
    perFileHashes.push({ path: file.path, hash: fileHash, size: content.length });
  }

  // Combine: hash the concatenation of "path\0hash\0" for each file
  const combined = perFileHashes.map(f => f.path + '\0' + f.hash + '\0').join('');
  const treeHash = hashContent(Buffer.from(combined, 'utf-8'), algorithm);

  const result = { hash: treeHash, fileCount: files.length, totalSize };
  if (includePerFile) result.files = perFileHashes;
  return result;
}

/**
 * Compare two directory trees by content hash.
 * @param {string} dirA - First directory
 * @param {string} dirB - Second directory
 * @param {object} options - Same as hashDirectory options
 * @returns {object} { identical, added, removed, modified, unchanged }
 */
function diffDirectories(dirA, dirB, options = {}) {
  const optsA = { ...options, includePerFile: true };
  const resultA = hashDirectory(dirA, optsA);
  const resultB = hashDirectory(dirB, optsA);

  const mapA = new Map(resultA.files.map(f => [f.path, f]));
  const mapB = new Map(resultB.files.map(f => [f.path, f]));

  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  for (const [p, f] of mapB) {
    if (!mapA.has(p)) {
      added.push({ path: p, hash: f.hash, size: f.size });
    }
  }

  for (const [p, f] of mapA) {
    if (!mapB.has(p)) {
      removed.push({ path: p, hash: f.hash, size: f.size });
    } else {
      const fb = mapB.get(p);
      if (f.hash !== fb.hash) {
        modified.push({ path: p, hashA: f.hash, hashB: fb.hash, sizeA: f.size, sizeB: fb.size });
      } else {
        unchanged.push({ path: p, hash: f.hash, size: f.size });
      }
    }
  }

  return {
    identical: added.length === 0 && removed.length === 0 && modified.length === 0,
    added,
    removed,
    modified,
    unchanged,
    summary: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      unchanged: unchanged.length,
      totalA: resultA.fileCount,
      totalB: resultB.fileCount,
    },
  };
}

/**
 * Poll a directory for content changes.
 * @param {string} dir - Directory to watch
 * @param {function} callback - Called with { hash, fileCount, changed } when hash changes
 * @param {object} options - Same as hashDirectory options + interval (default 2000ms)
 * @returns {object} { stop() }
 */
function watchDirectory(dir, callback, options = {}) {
  const { interval = 2000, ...hashOpts } = options;
  let lastHash = null;
  let running = true;

  const timer = setInterval(() => {
    if (!running) return;
    try {
      const result = hashDirectory(dir, hashOpts);
      const changed = lastHash !== null && result.hash !== lastHash;
      lastHash = result.hash;
      callback({ hash: result.hash, fileCount: result.fileCount, changed, totalSize: result.totalSize });
    } catch {
      // Directory might be temporarily unavailable
    }
  }, interval);

  try {
    const result = hashDirectory(dir, hashOpts);
    lastHash = result.hash;
    callback({ hash: result.hash, fileCount: result.fileCount, changed: false, totalSize: result.totalSize });
  } catch {
  }

  return {
    stop() {
      running = false;
      clearInterval(timer);
    },
  };
}

function formatText(result) {
  let out = `Hash:       ${result.hash}\n`;
  out += `Algorithm:  ${result.algorithm || 'sha256'}\n`;
  out += `Files:      ${result.fileCount}\n`;
  out += `Total size: ${formatBytes(result.totalSize)}\n`;
  if (result.files && result.files.length > 0) {
    out += '\nPer-file hashes:\n';
    for (const f of result.files) {
      out += `  ${f.hash.slice(0, 12)}...  ${f.path}  (${formatBytes(f.size)})\n`;
    }
  }
  return out;
}

function formatJson(result) {
  return JSON.stringify(result, null, 2);
}

function formatMarkdown(result) {
  let out = `# Directory Hash\n\n`;
  out += `| Property | Value |\n|---|---|\n`;
  out += `| Hash | \`${result.hash}\` |\n`;
  out += `| Algorithm | ${result.algorithm || 'sha256'} |\n`;
  out += `| Files | ${result.fileCount} |\n`;
  out += `| Total size | ${formatBytes(result.totalSize)} |\n`;
  if (result.files && result.files.length > 0) {
    out += `\n## File Hashes\n\n| Hash | Path | Size |\n|---|---|---|\n`;
    for (const f of result.files) {
      out += `| \`${f.hash.slice(0, 16)}...\` | ${f.path} | ${formatBytes(f.size)} |\n`;
    }
  }
  return out;
}

function formatDiffText(diff) {
  if (diff.identical) return 'Directories are identical.';
  let out = 'Directories differ.\n\n';
  if (diff.added.length) {
    out += `Added (${diff.added.length}):\n`;
    for (const f of diff.added) out += `  + ${f.path}\n`;
  }
  if (diff.removed.length) {
    out += `Removed (${diff.removed.length}):\n`;
    for (const f of diff.removed) out += `  - ${f.path}\n`;
  }
  if (diff.modified.length) {
    out += `Modified (${diff.modified.length}):\n`;
    for (const f of diff.modified) out += `  ~ ${f.path}\n`;
  }
  return out;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

module.exports = {
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
  ALGORITHMS,
};
