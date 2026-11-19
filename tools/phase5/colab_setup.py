# Colab runner for the Phase 5 merged-model training (rod5), for when the Kaggle GPU quota is used up.
# Colab: Runtime > Change runtime type > T4 GPU. In Colab "Secrets" (key icon) add KAGGLE_USERNAME and KAGGLE_KEY and switch
# "Notebook access" on for both (the key is made in Kaggle: Settings > API > Create New Token). Then run in one cell:
#   MAP_COMMIT='<commit>'; import urllib.request as u; exec(u.urlopen(f"https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{MAP_COMMIT}/tools/phase5/colab_setup.py").read())
# What it does: mounts Google Drive (checkpoints survive a disconnect: run the same cell again and training resumes), downloads
# the three private Kaggle datasets the run needs with kagglehub, links them under /kaggle/input/<slug> (the folder layout the
# Kaggle scripts expect), then runs train_rod3.py unchanged with MODEL_NAME='rod5'. Results are written to Google Drive
# (My Drive/va_rod5/) and are uploaded to the private Kaggle dataset sudharanimsr/rod5-results at the end.
import os, glob, subprocess, sys, urllib.request
from google.colab import drive, userdata
os.environ['KAGGLE_USERNAME'] = userdata.get('KAGGLE_USERNAME'); os.environ['KAGGLE_KEY'] = userdata.get('KAGGLE_KEY')
drive.mount('/content/drive')
subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'kagglehub', 'ultralytics'], check=True)
import kagglehub
COMMIT = globals().get('MAP_COMMIT', 'main')
DATASETS = globals().get('COLAB_DATASETS', ['sudharanimsr/phase5-trainset-416-v1', 'sudharanimsr/rod2-phase2-best-pt', 'sudharanimsr/sanpo-test-boxes-phase5-v2'])
os.makedirs('/kaggle/input', exist_ok=True); os.makedirs('/kaggle/working', exist_ok=True)
for ref in DATASETS:
    path = kagglehub.dataset_download(ref); link = f"/kaggle/input/{ref.split('/')[1]}"
    if not os.path.lexists(link): os.symlink(path, link)
    print(ref, '->', path, flush=True)
RUN = '/content/drive/MyDrive/va_rod5'; os.makedirs(RUN, exist_ok=True)
g = {'MAP_COMMIT': COMMIT, 'MODEL_NAME': 'rod5', 'RUN_DIR': RUN, 'PSEUDO': True, 'BATCH': globals().get('BATCH', 64)}
exec(urllib.request.urlopen(f'https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{COMMIT}/tools/phase5/train_rod3.py').read(), g)
kagglehub.dataset_upload('sudharanimsr/rod5-results', RUN, version_notes='rod5 run from Colab')
print('uploaded results to sudharanimsr/rod5-results')
