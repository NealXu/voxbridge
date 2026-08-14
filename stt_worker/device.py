"""音频设备检查。"""
import sounddevice as sd


def check_audio_input_device() -> bool:
    """检查是否有可用的音频输入设备。

    Returns:
        True 如果有可用的输入设备。

    Raises:
        RuntimeError: 如果没有检测到音频输入设备。
    """
    try:
        devices = sd.query_devices(kind='input')
        # 如果有输入设备，返回 True
        # query_devices 可能返回 dict 或 list，取决于系统
        if isinstance(devices, dict):
            if devices.get('max_input_channels', 0) > 0:
                return True
        elif isinstance(devices, list) and len(devices) > 0:
            # 检查是否有任何设备有输入通道
            for d in devices:
                if d.get('max_input_channels', 0) > 0:
                    return True
        # 没有有效的输入设备
        raise RuntimeError("未检测到音频输入设备")
    except (ValueError, OSError) as e:
        # query_devices 在没有输入设备时会抛出异常
        raise RuntimeError("未检测到音频输入设备") from e