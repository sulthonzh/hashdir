#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  hashDirectory,
  diffDirectories,
  watchDirectory,
  formatText,
  formatJson,
  formatMarkdown,
  formatDiffText,
  ALGORITHMS,
} = require('./src/index');

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--json') {
      args.format = 'json';
    } else if (arg === '--markdown' || arg === '--md') {
      args.format = 'markdown';
    } else if (arg === '--text' || arg === '-t') {
      args.format = 'text';
    } else if (arg === '--files') {
      args.includeFiles = true;
    } else if (arg === '--normalize' || arg === '-n') {
      args.normalize = true;
    } else if (arg === '--dotfiles') {
      args.dotfiles = true;
    } else if (arg === '--follow-links') {
      args.followLinks = true;
    } else if (arg === '--algo' || arg === '-a') {
      args.algorithm = argv[++i];
    } else if (arg === '--ignore' || arg === '-i') {
      args.ignore = (args.ignore || []).concat(argv[++i].split(','));
    } else if (arg === '--ext' || arg === '-e') {
      args.extensions = (args.extensions || []).concat(argv[++i].split(','));
    } else if (arg === '--depth' || arg === '-d') {
      args.maxDepth = parseInt(argv[++i], 10);
    } else if (arg === '--watch' || arg === '-w') {
      args.watch = true;
    } else if (arg === '--interval') {
      args.interval = parseInt(argv[++i], 10);
    } else if (arg === 'diff') {
      args.command = 'diff';
    } else if (arg === 'hash') {
      args.command = 'hash';
    } else if (arg === 'watch') {
      args.command = 'watch';
    } else if (arg === 'list') {
      args.command = 'list';
    } else if (arg.startsWith('-')) {
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function showHelp() {
  console.log(`hashdir — content-hash directory trees

Usage:
  hashdir hash <dir>              Hash a directory (default command)
  hashdir diff <dirA> <dirB>      Compare two directories
  hashdir watch <dir>             Watch for content changes
  hashdir list <dir>              List files that would be hashed

Options:
  -a, --algo <algorithm>    Hash algorithm (default: sha256)
                            Supported: ${ALGORITHMS.join(', ')}
  -i, --ignore <names>      Comma-separated names to ignore
  -e, --ext <extensions>    Only hash these extensions (e.g. .js,.ts)
  -d, --depth <n>           Max directory depth
  -n, --normalize           Normalize text files (line endings, whitespace)
      --dotfiles            Include dotfiles
      --follow-links        Follow symbolic links
      --files               Show per-file hashes
      --json                JSON output
      --markdown, --md      Markdown output
      --text, -t            Text output (default)
  -w, --watch               Watch mode (alias for 'watch' command)
      --interval <ms>       Watch interval in ms (default: 2000)
  -h, --help                Show this help

Examples:
  hashdir ./src                          Hash the src directory
  hashdir hash ./src --files             Include per-file hashes
  hashdir diff ./build ./dist           Compare two directories
  hashdir watch ./src --interval 1000   Watch for changes
  hashdir list ./src --ext .js,.ts      List files that would be hashed
  hashdir ./src -a md5 --normalize      Use MD5 with text normalization
  hashdir . -i node_modules,.git        Ignore common directories
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) return showHelp();

  const dir = args._[0] || '.';
  const command = args.command || 'hash';

  const hashOpts = {
    algorithm: args.algorithm || 'sha256',
    ignore: args.ignore || [],
    extensions: args.extensions || [],
    maxDepth: args.maxDepth,
    normalize: args.normalize || false,
    followLinks: args.followLinks || false,
    dotfiles: args.dotfiles || false,
    includePerFile: args.includeFiles || false,
  };

  const format = args.format || 'text';

  try {
    switch (command) {
      case 'hash': {
        const result = hashDirectory(dir, hashOpts);
        result.algorithm = hashOpts.algorithm;
        if (format === 'json') console.log(formatJson(result));
        else if (format === 'markdown') console.log(formatMarkdown(result));
        else console.log(formatText(result));
        break;
      }

      case 'diff': {
        const dirB = args._[1];
        if (!dirB) {
          console.error('Error: diff requires two directories. Usage: hashdir diff <dirA> <dirB>');
          process.exit(1);
        }
        const diff = diffDirectories(dir, dirB, hashOpts);
        if (format === 'json') {
          console.log(formatJson(diff));
        } else if (format === 'markdown') {
          console.log('```');
          console.log(formatDiffText(diff));
          console.log('```');
        } else {
          console.log(formatDiffText(diff));
        }
        if (!diff.identical) process.exit(1);
        break;
      }

      case 'watch': {
        const interval = args.interval || 2000;
        let lastHash = null;
        console.log(`Watching: ${path.resolve(dir)} (interval: ${interval}ms, algo: ${hashOpts.algorithm})`);
        const watcher = watchDirectory(dir, (event) => {
          if (event.changed) {
            console.log(`[${new Date().toISOString()}] CHANGED → ${event.hash} (${event.fileCount} files, ${formatBytes(event.totalSize)})`);
          }
        }, { ...hashOpts, interval });

        process.on('SIGINT', () => {
          watcher.stop();
          console.log('\nStopped watching.');
          process.exit(0);
        });
        break;
      }

      case 'list': {
        const { collectFiles: cf } = require('./src/index');
        const resolved = path.resolve(dir);
        const files = cf(resolved, hashOpts);
        if (format === 'json') {
          console.log(JSON.stringify(files.map(f => ({ path: f.path, size: fs.statSync(f.fullPath).size })), null, 2));
        } else {
          console.log(`Files to hash in ${resolved} (${files.length}):\n`);
          for (const f of files) {
            console.log(`  ${f.path}`);
          }
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

const fs = require('fs');

main();
