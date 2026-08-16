#!/usr/bin/env pwsh
# install-hooks.ps1 - 安装 Git hooks (PowerShell)
#
# 用法: ./scripts/install-hooks.ps1
#
# 此脚本将 pre-commit hook 复制到 .git/hooks/ 目录。
# 需要在主仓库 checkout 中运行（非 worktree）。

$ErrorActionPreference = "Stop"

$Root = git rev-parse --show-toplevel
$HooksDir = Join-Path $Root ".git\hooks"

Write-Host "安装 Git hooks..."

# 确保 hooks 目录存在
if (-not (Test-Path $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null
}

# 创建 pre-commit hook
$HookContent = @'
#!/bin/sh
#
# pre-commit hook - 检测 U+FFFD 替换字符，防止乱码入库
#
# 此脚本在 git commit 前自动运行，扫描暂存区的文件。
# 如果发现 U+FFFD（UTF-8 解码错误时的替换字符），提交将被拒绝。
#

# 项目根目录
ROOT="$(git rev-parse --show-toplevel)"

# 运行编码检查脚本
if [ -f "$ROOT/scripts/check-encoding.js" ]; then
  node "$ROOT/scripts/check-encoding.js" --staged
  exit $?
fi

# 备用：直接用 grep 检测（不依赖 Node.js）
# 搜索 U+FFFD（UTF-8 编码为 EF BF BD）
FILES=$(git diff --cached --name-only --diff-filter=AM -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.py' '*.md' '*.json' 2>/dev/null)

if [ -n "$FILES" ]; then
  MATCH=$(printf '%s\n' $FILES | xargs grep -l $'\xef\xbf\xbd' 2>/dev/null)
  if [ -n "$MATCH" ]; then
    echo "ERROR: 检测到 U+FFFD 替换字符，提交被拒绝。"
    echo "请检查以下文件是否存在编码损坏："
    printf '  %s\n' $MATCH
    exit 1
  fi
fi

exit 0
'@

$HookPath = Join-Path $HooksDir "pre-commit"
$HookContent | Out-File -FilePath $HookPath -Encoding utf8 -NoNewline

Write-Host "✓ pre-commit hook 已安装"
Write-Host ""
Write-Host "Hook 功能："
Write-Host "  - 检测暂存区文件中的 U+FFFD 替换字符"
Write-Host "  - 阻止包含乱码的提交入库"
Write-Host ""
Write-Host "测试方法："
Write-Host "  npm run check-encoding        # 检查暂存区"
Write-Host "  npm run check-encoding:all    # 检查所有文件"