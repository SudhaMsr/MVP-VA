#!/usr/bin/env python3
"""Make docs/models/hazard320.onnx: YOLOE (Ultralytics, open-vocabulary) set to the RNIB obstacle list. No training.
Run on your own computer (it downloads YOLOE and MobileCLIP weights from Ultralytics' GitHub releases):
    pip install ultralytics onnx onnxslim
    python3 tools/phase4/export_hazard_model.py            # writes docs/models/hazard320.onnx (~40 MB)
    python3 tools/phase4/export_hazard_model.py --int8     # also tries an int8 copy (~11 MB) and reports if it agrees
Then: python3 tools/stamp.py, npm test, and commit docs/models/hazard320.onnx.
The app loads it if present (log only: 'hazard-detect' events, and answers to "is there an e-scooter?").
"""
import argparse, json, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[2]
VOCAB = json.loads((ROOT / 'tools/phase4/hazard_vocab.json').read_text())['classes']

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--weights', default='yoloe-11s-seg.pt'); ap.add_argument('--size', type=int, default=320)
    ap.add_argument('--int8', action='store_true'); a = ap.parse_args()
    from ultralytics import YOLOE
    m = YOLOE(a.weights)
    prompts = [c['prompt'] for c in VOCAB]
    m.set_classes(prompts, m.get_text_pe(prompts))
    out = pathlib.Path(m.export(format='onnx', imgsz=a.size, simplify=True, opset=17))
    dest = ROOT / f'docs/models/hazard{a.size}.onnx'
    shutil.copy(out, dest); print('wrote', dest, f'{dest.stat().st_size / 1e6:.1f} MB')
    if a.int8:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        q = dest.with_name(f'hazard{a.size}_int8.onnx'); quantize_dynamic(str(dest), str(q), weight_type=QuantType.QUInt8)
        print('wrote', q, f'{q.stat().st_size / 1e6:.1f} MB (check it with eval_hazard_model.py --model before using it)')

if __name__ == '__main__':
    main()
