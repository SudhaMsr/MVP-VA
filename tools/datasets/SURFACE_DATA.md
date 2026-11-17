# Surface data: what we have, what is public, what is missing (15 Nov 2026)

Written for later phases. Nothing here is in the app. The app today has no surface model: it draws boxes around objects only.
"Road" is detected by rod2 but never spoken. Crossings are spoken ("Crossing, ahead") but plain and zebra are not told apart.
Manholes are spoken when close. Kerb is only in the optional hazard lane (log only, off by default).

## The 9 surfaces

| Surface | In our Kaggle account now | Public, not yet in hand | Missing / not usable |
|---|---|---|---|
| background | n/a | n/a | n/a |
| terrain | none | Mapillary Vistas; Belgium sidewalk set (non-commercial) | commercial-safe source |
| road | Outdoor Navigation (1,251 imgs, CC BY 4.0); rod2 "Road" boxes | Vistas, Cityscapes | |
| curb | Kerbs YOLO640, Barcelona kerbs, Road Obstacles (boxes mostly tiny) | Campus Accessibility Barriers (Kaggle), Vistas | good large set |
| curb cut / dropped kerb | "Ramp" in Outdoor Navigation; tiny dropped-kerb boxes (Barcelona, Vistas) | Vistas; RampNet (~214k Street View panoramas, image licence unclear) | clean commercial image set |
| sidewalk | Outdoor Navigation | Belgium sidewalk set (CC BY-NC, gated); "Sidewalk from a Robot's Point of View" and others on Kaggle; Vistas; Cityscapes | |
| plain crosswalk | Outdoor Navigation; rod2 "Pedestrian crosswalk" | FPVCrosswalk2025 (Kaggle copy by Jocelyn Dumlao; original 3,000 AI-generated + 300 real, CC BY 4.0); other Kaggle crosswalk sets | |
| zebra crosswalk | none labelled | Vistas (separate labels); a few Kaggle zebra sets | clean zebra-vs-plain set |
| covering (manhole) | rod2 data only | Vistas | nothing else found |

## Datasets and licences

| Dataset | Source | Licence | State |
|---|---|---|---|
| Outdoor Navigation Dataset (Crosswalk, Pedestrian, Ramp, Road, Sidewalk; 1,123 train / 123 valid / 5 test; YOLO segmentation) | https://zenodo.org/records/14043015 (Mihai Craciunescu, UPB) | CC BY 4.0, credit needed | Downloaded: private Kaggle dataset `sudharanimsr/surfaces-raw-public`. Not converted yet. |
| FPVCrosswalk2025 | https://data.mendeley.com/datasets/mcr2jwk5bp | CC BY 4.0 | Mendeley download is blocked (403) from Kaggle. Kaggle has a public copy to attach. Not downloaded. |
| Mapillary Vistas 2.0 (124 classes) | https://www.mapillary.com/dataset/vistas | Believed non-commercial: check before shipping | Needs the user's fresh download link. Keep copies private. |
| Sidewalk semantic (35 classes, Belgium) | https://huggingface.co/datasets/segments/sidewalk-semantic | CC BY-NC 4.0, gated | Not downloaded. |
| RampNet (curb ramp points on panoramas) | https://huggingface.co/datasets/projectsidewalk/rampnet-dataset | MIT label tag; images look like Street View, terms unconfirmed | Not downloaded. Street View sources were rejected earlier. |
| Cityscapes copies on Kaggle | Kaggle search | Research-only (not verified here) | Not downloaded. |
| Project Sidewalk, OpenSidewalks NYC | project pages / GitHub | not checked | Labels and map data, not training images. |

## Image gaps

No images at all: terrain; zebra vs plain crossing; coverings other than manholes; labelled background-only scenes.

Images exist but are too weak: dropped kerb and kerb edge (median box about 3-4 px on the short side, 64% under 6 px at 640 px);
street-level poles (earlier ones were close-ups; round 5 adds Road Obstacles); sidewalk (one 1,251-image set, viewpoint not stated).

Missing whatever the class: walking-height phone footage; UK pavements, crossings and kerbs, left-hand traffic; night, rain, low sun;
footage from blind users (most valuable, hardest to find; the supervised walks are the main source).

## Not a data problem

Road, sidewalk, terrain and crossing areas are pixel regions. The current model draws boxes. A surface layer needs a segmentation
model (probably plus ground geometry), as its own PR after the rod3 gates, the speed checks and the street walks.

## Rules that still apply

Keep Vistas, Cityscapes and non-commercial sets as private Kaggle datasets. Decide licences before any shipped model uses them.
Credit CC BY sources. Downloads need the user's OK. Never say "safe" in app speech.

## Getting the Vistas surface classes in the same run

`tools/datasets/vistas_kaggle.py` (PR #47) takes `WANT_SEG` as well as `WANT`. One Vistas link then gives, in one pass, the poles and
vehicles for the box model (`labels/`) and polygons for road, sidewalk, terrain, curb, curb cut, plain and zebra crossing, manhole,
pedestrian area and bike lane (`labels_seg/`). The exact lists are in the script header. Vistas class names that do not match the
dataset config are printed as NOT FOUND, so check with `LIST_ONLY = True` first. Not run yet: it needs the user's fresh signed link.
