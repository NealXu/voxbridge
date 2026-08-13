"""下载 faster-whisper large-v3 到 D:\\Models\\faster-whisper-large-v3。"""
import os
from huggingface_hub import snapshot_download

MODEL_DIR = r"D:\Models\faster-whisper-large-v3"
os.makedirs(os.path.dirname(MODEL_DIR), exist_ok=True)
snapshot_download(
    "Systran/faster-whisper-large-v3",
    local_dir=MODEL_DIR,
    local_dir_use_symlinks=False,
)
print(f"模型就绪: {MODEL_DIR}")
