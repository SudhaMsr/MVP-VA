# No training happens here. This only converts the already-trained COCO YOLOv8n to ONNX for Vision Assist's third lane. Run in Google Colab (free CPU is fine).
# Paste each block into a cell, run it, then download coco320.onnx and put it in docs/models/ in the repo.
#
# !pip -q install ultralytics onnx onnxslim
# from ultralytics import YOLO
# YOLO('yolov8n.pt').export(format='onnx', imgsz=320, opset=12, simplify=True)   # writes yolov8n.onnx
# !mv yolov8n.onnx coco320.onnx
# from google.colab import files; files.download('coco320.onnx')
#
# The app uses almost all COCO classes except the ones the other two models already cover (see TERTIARY in docs/js/config.js).
# If the file is missing the app simply runs without this lane.
