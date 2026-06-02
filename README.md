# hashdir

Content-hash entire directory trees. Zero dependencies.

Perfect for **CI cache keys**, **build verification**, and **change detection**.

## Why

You need to know if a directory actually changed — not just timestamps, but real content. Whether it's busting a CI cache, verifying a build output matches, or watching a source tree for edits, you need a content-addressable hash of the whole tree.

Existing solutions either pull in heavy dependencies, don't handle cross-platform edge cases (CRLF vs LF), or can't diff two trees.

hashdir does one thing well: hash a directory deterministically by content.

## Install

```bash
npm install -g hashdir
```

## Usage

### Hash a directory

```bash
$ hashdir ./src
Hash:       a3f8c2e1d4b5...
Algorithm:  sha256
Files:      23
Total size: 45.2 KB
```

### Compare two directories

```bash
$ hashdir diff ./build ./dist
Directories differ.

Modified (1):
  ~ bundle.js

Added (2):
  + sourcemap.js.map
  + manifest.json
```

Exit code is `1` when directories differ — perfect for CI:

```bash
hashdir diff ./expected ./actual || echo "Build output changed!"
```

### Watch for changes

```bash
$ hashdir watch ./src --interval 1000
Watching: /path/to/src (interval: 1000ms, algo: sha256)
[2026-06-02T02:00:00.000Z] CHANGED → b7e3f1a2... (24 files, 47.1 KB)
```

### List files that would be hashed

```bash
$ hashdir list ./src --ext .js,.ts
```

### As CI cache key

```yaml
# GitHub Actions
- name: Get source hash
  run: echo "HASH=$(hashdir ./src --json | jq -r .hash)" >> $GITHUB_ENV

- name: Cache
  uses: actions/cache@v3
  with:
    path: ./build
    key: build-${{ env.HASH }}
```

## Commands

| Command | Description |
|---------|-------------|
| `hash <dir>` | Hash a directory tree (default) |
| `diff <dirA> <dirB>` | Compare two directories by content |
| `watch <dir>` | Poll for content changes |
| `list <dir>` | List files that would be hashed |

## Options

| Flag | Description |
|------|-------------|
| `-a, --algo <algo>` | Hash algorithm: sha256, sha1, md5, sha512 (default: sha256) |
| `-i, --ignore <names>` | Comma-separated file/directory names to skip |
| `-e, --ext <exts>` | Only hash these extensions (e.g. `.js,.ts`) |
| `-d, --depth <n>` | Max directory depth |
| `-n, --normalize` | Normalize text files (CRLF→LF, strip trailing whitespace) |
| `--dotfiles` | Include dotfiles (hidden files) |
| `--follow-links` | Follow symbolic links |
| `--files` | Show per-file hashes in output |
| `--json` | JSON output |
| `--markdown` | Markdown output |
| `-w, --watch` | Watch mode |

## Normalize Mode

Cross-platform builds often produce different files due to line endings. Use `--normalize` to treat CRLF and LF as identical:

```bash
hashdir diff ./build-mac ./build-windows --normalize
```

This normalizes line endings, strips trailing whitespace, and ensures a trailing newline before hashing.

## Programmatic API

```js
const { hashDirectory, diffDirectories, watchDirectory } = require('hashdir');

// Hash a directory
const result = hashDirectory('./src', {
  algorithm: 'sha256',
  ignore: ['node_modules', '.git'],
  extensions: ['.js', '.ts'],
  normalize: true,
  includePerFile: true,
});
// → { hash: 'a3f8...', fileCount: 23, totalSize: 46284, files: [...] }

// Compare directories
const diff = diffDirectories('./build', './dist');
// → { identical: false, added: [...], removed: [...], modified: [...], unchanged: [...] }

// Watch for changes
const watcher = watchDirectory('./src', (event) => {
  if (event.changed) console.log('Content changed:', event.hash);
}, { interval: 2000 });

watcher.stop(); // cleanup
```

## How It Works

1. Walk the directory tree (sorted for determinism)
2. Read each file's content
3. Hash each file individually
4. Concatenate `path\0hash\0` for all files
5. Hash the combined string → final tree hash

This means:
- Renaming a file changes the hash (path is part of the input)
- Reordering files doesn't change the hash (sorted)
- Two identical trees always produce the same hash

## Zero Dependencies

No npm install black hole. Uses only Node.js built-ins: `fs`, `path`, `crypto`.

## License

MIT
