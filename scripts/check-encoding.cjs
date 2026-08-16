#!/usr/bin/env node
/**
 * check-encoding.js - 检测文件中的 U+FFFD 替换字符（UTF-8 编码损坏）
 *
 * 用途：
 *   - pre-commit hook：阻止乱码入库
 *   - CI：定期扫描
 *   - 手动：npm run check-encoding
 *
 * 退出码：
 *   0 - 无乱码
 *   1 - 发现乱码
 *   2 - 参数错误
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// U+FFFD 替换字符
const REPLACEMENT_CHAR = '�';

// 默认扫描的文件类型
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.md', '.json', '.yaml', '.yml'];

// 解析参数
const args = process.argv.slice(2);
let mode = 'staged'; // 'staged' | 'all' | 'files'
let extensions = DEFAULT_EXTENSIONS;
let files = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--all') {
    mode = 'all';
  } else if (arg === '--staged') {
    mode = 'staged';
  } else if (arg === '--ext' && args[i + 1]) {
    extensions = args[++i].split(',').map(e => e.startsWith('.') ? e : '.' + e);
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
用法: node check-encoding.js [选项] [文件...]

选项:
  --staged    只检查暂存区的文件（默认）
  --all       检查所有跟踪的文件
  --ext <扩展名>  指定扩展名（逗号分隔），默认: ${DEFAULT_EXTENSIONS.join(',')}
  --help      显示帮助信息

示例:
  node scripts/check-encoding.js                    # 检查暂存区
  node scripts/check-encoding.js --all              # 检查所有文件
  node scripts/check-encoding.js --ext .ts,.py      # 只检查 .ts 和 .py
  node scripts/check-encoding.js docs/*.md          # 检查指定文件
`);
    process.exit(0);
  } else if (!arg.startsWith('--')) {
    files.push(arg);
    mode = 'files';
  }
}

/**
 * 获取要检查的文件列表
 */
function getFilesToCheck() {
  if (mode === 'files') {
    return files;
  }

  const gitCmd = mode === 'staged'
    ? 'git diff --cached --name-only --diff-filter=AM'
    : 'git ls-files';

  try {
    const output = execSync(gitCmd, { encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.error('获取文件列表失败:', err.message);
    return [];
  }
}

/**
 * 检查文件是否包含 U+FFFD
 */
function checkFile(filePath) {
  const ext = path.extname(filePath);
  if (!extensions.includes(ext)) {
    return null; // 跳过不检查的扩展名
  }

  if (!fs.existsSync(filePath)) {
    return null; // 文件不存在（可能被删除）
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const issues = [];

    lines.forEach((line, idx) => {
      let pos = 0;
      while ((pos = line.indexOf(REPLACEMENT_CHAR, pos)) !== -1) {
        issues.push({
          line: idx + 1,
          column: pos + 1,
          context: line.slice(Math.max(0, pos - 10), pos + 11).replace(/\n/g, '\\n')
        });
        pos++;
      }
    });

    return issues.length > 0 ? { file: filePath, issues } : null;
  } catch (err) {
    // 二进制文件或其他读取错误，跳过
    return null;
  }
}

// 主逻辑
const filesToCheck = getFilesToCheck();

if (filesToCheck.length === 0) {
  console.log('没有文件需要检查');
  process.exit(0);
}

console.log(`检查 ${filesToCheck.length} 个文件...`);

const results = [];
for (const file of filesToCheck) {
  const result = checkFile(file);
  if (result) {
    results.push(result);
  }
}

if (results.length === 0) {
  console.log('✓ 无编码损坏');
  process.exit(0);
}

// 输出问题
console.error('\n✗ 检测到 U+FFFD 替换字符（编码损坏）:\n');
let totalIssues = 0;
for (const { file, issues } of results) {
  console.error(`  ${file}`);
  for (const { line, column, context } of issues.slice(0, 5)) { // 最多显示 5 处
    console.error(`    L${line}:C${column} "...${context}..."`);
  }
  if (issues.length > 5) {
    console.error(`    ... 还有 ${issues.length - 5} 处`);
  }
  totalIssues += issues.length;
}

console.error(`\n共 ${results.length} 个文件，${totalIssues} 处编码损坏`);
console.error('请修复这些文件后重新提交');
process.exit(1);