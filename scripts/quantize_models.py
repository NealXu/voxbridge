#!/usr/bin/env python3
"""Quantize ONNX models to INT8 for smaller size and faster inference."""
import sys
from pathlib import Path


def quantize_model(model_path: Path, output_path: Path):
    """Quantize a single ONNX model to INT8."""
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType

        print(f"Quantizing {model_path.name}...")
        quantize_dynamic(
            str(model_path),
            str(output_path),
            weight_type=QuantType.QInt8
        )

        # Show size reduction
        original_size = model_path.stat().st_size / 1024 / 1024
        quantized_size = output_path.stat().st_size / 1024 / 1024
        reduction = (1 - quantized_size / original_size) * 100

        print(f"  {original_size:.1f} MB → {quantized_size:.1f} MB ({reduction:.1f}% reduction)")
        return True
    except Exception as e:
        print(f"  Failed: {e}")
        return False


def main():
    print("=== ONNX Model Quantization ===\n")

    # Find all ONNX models
    models_dir = Path("models")
    if not models_dir.exists():
        print("No models directory found.")
        return 1

    onnx_files = list(models_dir.rglob("*.onnx"))
    if not onnx_files:
        print("No ONNX models found.")
        return 1

    print(f"Found {len(onnx_files)} ONNX model(s)\n")

    # Quantize each model
    results = []
    for model_path in onnx_files:
        if "quantized" in model_path.name or "int8" in model_path.name:
            continue  # Skip already quantized

        output_path = model_path.with_name(f"{model_path.stem}_int8{model_path.suffix}")
        success = quantize_model(model_path, output_path)
        results.append((model_path.name, success))
        print()

    # Summary
    print("=== Summary ===")
    for name, success in results:
        status = "✓" if success else "✗"
        print(f"{status} {name}")

    return 0 if all(s for _, s in results) else 1


if __name__ == "__main__":
    sys.exit(main())