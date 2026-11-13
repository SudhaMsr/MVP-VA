# Kaggle keeps only the first 500 files of a notebook's output, so a dataset with thousands of images must be saved as one
# zip. Run after a dataset script in the same cell (set ZIP_SRC first, e.g. ZIP_SRC = '/kaggle/working/vip640'):
#   exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/zip_output.py").read())
# Writes ZIP_SRC + '.zip' (stored, not recompressed: the images are JPEG already) and deletes each file once it is in the
# zip, so the disk never holds two copies (/kaggle/working is limited to about 19.5 GB). Unzip it before training.
import os, zipfile, shutil

SRC = globals()['ZIP_SRC'].rstrip('/')
DST = SRC + '.zip'
n = size = 0
with zipfile.ZipFile(DST, 'w', zipfile.ZIP_STORED, allowZip64=True) as z:
    for root, dirs, files in os.walk(SRC):
        dirs.sort()
        for f in sorted(files):
            if f.endswith('.part'):
                continue
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, os.path.dirname(SRC)))
            size += os.path.getsize(p); n += 1
            os.remove(p)
            if n % 20000 == 0:
                print(f'zipped {n} files, {size / 1e9:.2f} GB', flush=True)
shutil.rmtree(SRC, ignore_errors=True)
with zipfile.ZipFile(DST) as z:
    bad = z.testzip() if os.path.getsize(DST) < 3e9 else None  # full CRC check only on smaller zips (time)
    count = len(z.infolist())
print(f'saved {DST}: {count} files, {os.path.getsize(DST) / 1e9:.2f} GB, bad entry: {bad}')
