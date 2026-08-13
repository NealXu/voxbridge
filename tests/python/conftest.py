"""pytest 配置：integration 标记默认跳过（需真实模型/硬件），显式 -m 时运行。"""
import pytest


def pytest_collection_modifyitems(config, items):
    # 用户显式传入 -m（如 `-m integration`）时，交给 pytest 自身过滤，不在此干预。
    if config.getoption("markexpr"):
        return
    skip_integration = pytest.mark.skip(
        reason="integration test (需要真实模型): 用 `-m integration` 运行"
    )
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_integration)
