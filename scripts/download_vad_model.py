"""下载 silero-vad ONNX 模型。

使用方法：
    python scripts/download_vad_model.py

模型会保存到 stt_worker/models/silero_vad.onnx
"""
import urllib.request
from pathlib import Path
import sys


def download_silero_model():
    """下载 silero-vad 模型。"""
    # 模型保存路径
    model_dir = Path(__file__).parent.parent / "stt_worker" / "models"
    model_path = model_dir / "silero_vad.onnx"

    # 创建目录
    model_dir.mkdir(parents=True, exist_ok=True)

    # 尝试多个下载源
    urls = [
        "https://raw.githubusercontent.com/snakers4/silero-vad/master/files/silero_vad.onnx",
        "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx",
        "https://huggingface.co/silero/silero-vad/resolve/main/silero_vad.onnx",
    ]

    for url in urls:
        print(f"尝试从 {url} 下载...")
        try:
            urllib.request.urlretrieve(url, str(model_path))
            print(f"成功下载模型到 {model_path}")
            print(f"文件大小: {model_path.stat().st_size / 1024 / 1024:.2f} MB")
            return True
        except Exception as e:
            print(f"下载失败: {e}")
            continue

    print("\n所有下载源都失败了。")
    print("你可以手动下载模型并放到以下位置：")
    print(f"  {model_path}")
    print("\n下载地址：")
    print("  https://github.com/snakers4/silero-vad/tree/master/files")
    return False


if __name__ == "__main__":
    success = download_silero_model()
    sys.exit(0 if success else 1)