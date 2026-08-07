#!/usr/bin/env sh
#
# dscode 一键安装脚本（todos M8 P1）。
# 用法：curl -fsSL https://raw.githubusercontent.com/menghun3-cn/ai-dscode/master/scripts/install.sh | sh
# 从 GitHub Releases 下载对应平台二进制，安装到 ~/.dscode/bin（可 DCSCODE_INSTALL_DIR 覆盖）。
# 依赖：curl / uname（Linux、macOS）。

set -e

INSTALL_DIR="${DCSCODE_INSTALL_DIR:-$HOME/.dscode/bin}"
REPO="menghun3-cn/ai-dscode"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

# 平台/架构 → Release 产物名（与 .github/workflows/release.yml 的 asset 对齐）
os="$(uname -s)"
case "$os" in
  Linux) asset="dscode-linux-x64" ;;
  Darwin) asset="dscode-macos" ;;
  *) echo "不支持的平台: $os（Windows 请下载 dscode-windows-x64.exe）" >&2; exit 1 ;;
esac

echo "下载 dscode（$asset）..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$BASE_URL/$asset" -o "$INSTALL_DIR/dscode"
chmod +x "$INSTALL_DIR/dscode"

# PATH 提示
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "已将 dscode 安装到 $INSTALL_DIR，请把它加入 PATH：" >&2
     echo '  export PATH="$HOME/.dscode/bin:$PATH"' >&2 ;;
esac

"$INSTALL_DIR/dscode" --version
echo "安装完成。首次运行前设置 API key：export DSCODE_API_KEY=sk-..."
