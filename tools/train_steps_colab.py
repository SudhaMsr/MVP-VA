# Fine-tune a steps/kerb detector in Google Colab (Runtime > GPU). Paste each block into a cell.
# 1) Label ~150-300 frames with classes: step_up, step_down, kerb  (export from Roboflow as "YOLOv8").
# 2) Upload/unzip the export so data.yaml is at /content/ds/data.yaml
#
# !pip -q install ultralytics
# from ultralytics import YOLO
# m = YOLO('yolov8n.pt')          # or start from weights/rod_best.pt to reuse what it knows
# m.train(data='/content/ds/data.yaml', epochs=80, imgsz=640, batch=16)
# YOLO('runs/detect/train/weights/best.pt').export(format='onnx', imgsz=416, opset=12, simplify=True)
# Download best.onnx, rename to steps416.onnx, put it in docs/models/ and send it to me to wire in.
