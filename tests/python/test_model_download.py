"""Tests for model downloading with progress."""
import pytest
from unittest.mock import patch, MagicMock, create_autospec
import os


class TestModelDownload:
    def test_model_exists_returns_true(self):
        """模型已存在时返回 True，不触发下载。"""
        from stt_worker.model_download import ensure_model

        with patch("os.path.isfile", return_value=True):
            result = ensure_model("large-v3", r"D:\Models\faster-whisper-large-v3")
            assert result is True

    def test_model_missing_triggers_download(self):
        """模型缺失时触发下载并报告进度。"""
        from stt_worker.model_download import ensure_model

        progress_calls = []

        # 模拟 snapshot_download 调用 tqdm_class
        def fake_snapshot_download(*args, tqdm_class=None, **kwargs):
            if tqdm_class:
                # 创建一个模拟的 tqdm 实例
                mock_tqdm = tqdm_class(total=100)
                mock_tqdm.n = 25
                mock_tqdm.update(25)  # 触发进度 50%
                mock_tqdm.n = 50
                mock_tqdm.update(50)  # 触发进度 100%

        with patch("os.path.isfile", return_value=False):
            with patch("stt_worker.model_download.snapshot_download", side_effect=fake_snapshot_download):
                with patch("os.makedirs"):
                    result = ensure_model(
                        "large-v3",
                        r"D:\Models\faster-whisper-large-v3",
                        progress_callback=progress_calls.append
                    )
                    assert result is True
                    # 进度回调应该被调用（至少报告进度变化）
                    assert len(progress_calls) >= 1

    def test_model_missing_no_progress_callback(self):
        """无进度回调时下载也能完成。"""
        from stt_worker.model_download import ensure_model

        with patch("os.path.isfile", return_value=False):
            with patch("stt_worker.model_download.snapshot_download"):
                with patch("os.makedirs"):
                    result = ensure_model("large-v3", r"D:\Models\faster-whisper-large-v3")
                    assert result is True

    def test_download_error_propagates(self):
        """下载失败时异常向上传播。"""
        from stt_worker.model_download import ensure_model

        with patch("os.path.isfile", return_value=False):
            with patch("stt_worker.model_download.snapshot_download", side_effect=ConnectionError("network")):
                with patch("os.makedirs"):
                    with pytest.raises(ConnectionError):
                        ensure_model("large-v3", r"D:\Models\faster-whisper-large-v3")