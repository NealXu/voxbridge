"""Tests for audio device checking."""
import pytest
from unittest.mock import patch, MagicMock


class TestCheckAudioInputDevice:
    def test_has_input_device(self):
        """有输入设备时返回 True。"""
        from stt_worker.device import check_audio_input_device

        with patch("stt_worker.device.sd") as mock_sd:
            mock_sd.query_devices.return_value = {"name": "Microphone", "max_input_channels": 1}
            assert check_audio_input_device() is True

    def test_no_input_device_raises(self):
        """无输入设备时抛出 RuntimeError。"""
        from stt_worker.device import check_audio_input_device

        with patch("stt_worker.device.sd") as mock_sd:
            mock_sd.query_devices.side_effect = ValueError("No input device found")
            with pytest.raises(RuntimeError, match="未检测到音频输入设备"):
                check_audio_input_device()

    def test_zero_channels_raises(self):
        """设备列表为空或无输入通道时抛出 RuntimeError。"""
        from stt_worker.device import check_audio_input_device

        with patch("stt_worker.device.sd") as mock_sd:
            mock_sd.query_devices.return_value = {"name": "Speaker", "max_input_channels": 0}
            with pytest.raises(RuntimeError, match="未检测到音频输入设备"):
                check_audio_input_device()