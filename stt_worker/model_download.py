"""模型下载与存在性检查。"""
import os
from typing import Callable

from huggingface_hub import snapshot_download
from tqdm import tqdm

# 模型仓库 ID 映射
MODEL_REPO = {
    "large-v3": "Systran/faster-whisper-large-v3",
    "medium": "Systran/faster-whisper-medium",
    "small": "Systran/faster-whisper-small",
    "base": "Systran/faster-whisper-base",
}


class ProgressTqdm(tqdm):
    """自定义 tqdm，每次更新时调用回调函数。"""

    def __init__(self, *args, callback: Callable[[float], None] | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._callback = callback
        self._last_reported = -1

    def update(self, n=1):
        result = super().update(n)
        if self._callback and self.total and self.total > 0:
            # 报告进度（0~1）
            progress = min(1.0, self.n / self.total)
            # 只在进度变化 >= 1% 时报告，避免过于频繁
            if progress - self._last_reported >= 0.01 or progress >= 1.0:
                self._callback(progress)
                self._last_reported = progress
        return result


def ensure_model(
    model_name: str,
    model_dir: str,
    progress_callback: Callable[[float], None] | None = None
) -> bool:
    """确保模型存在，缺失时自动下载。

    Args:
        model_name: 模型名称（如 "large-v3"）
        model_dir: 模型目录路径
        progress_callback: 可选的进度回调函数，接收 0.0~1.0 的进度值

    Returns:
        True 如果模型可用（已存在或下载成功）

    Raises:
        下载失败时的异常
    """
    # 检查模型是否已存在（通过检查 model.bin 文件）
    model_bin = os.path.join(model_dir, "model.bin")
    if os.path.isfile(model_bin):
        return True

    # 模型不存在，需要下载
    repo_id = MODEL_REPO.get(model_name, f"Systran/faster-whisper-{model_name}")

    # 确保目录存在
    os.makedirs(model_dir, exist_ok=True)

    # 创建自定义 tqdm 类
    tqdm_class = None
    if progress_callback:
        tqdm_class = lambda *args, **kwargs: ProgressTqdm(*args, callback=progress_callback, **kwargs)

    # 下载模型
    snapshot_download(
        repo_id=repo_id,
        local_dir=model_dir,
        local_dir_use_symlinks=False,
        tqdm_class=tqdm_class,
    )

    return True